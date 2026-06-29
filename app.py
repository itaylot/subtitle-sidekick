"""app.py — application launcher: pywebview window rendering the UI (ui/), with a Python bridge.

The UI is plain HTML/CSS/JS (ui/). All logic lives in engine.py (faster-whisper / ivrit-ai).
The Api class connects UI buttons to transcription functions and streams progress back to the DOM.
"""

import os
import sys
import json
import mimetypes
import threading
import traceback
import subprocess
import faulthandler
import socketserver
import http.server
import urllib.parse

import webview

import engine

HERE = os.path.dirname(os.path.abspath(__file__))
WORKER = os.path.join(HERE, "worker.py")
INDEX = os.path.join(HERE, "ui", "index.html")
ICON = os.path.join(HERE, "ui", "icons", "app.ico")
CRASH_LOG = os.path.join(HERE, "crash.log")

# write crashes to crash.log so silent crashes can be diagnosed without a CMD window
_crash_fh = open(CRASH_LOG, "a", encoding="utf-8")
faulthandler.enable(_crash_fh)


def _log(msg):
    _crash_fh.write(str(msg) + "\n")
    _crash_fh.flush()


def _excepthook(exc_type, exc, tb):
    _log("PY EXC: " + "".join(traceback.format_exception(exc_type, exc, tb)))


sys.excepthook = _excepthook
if hasattr(threading, "excepthook"):
    threading.excepthook = lambda a: _log(
        "THREAD EXC: " + "".join(traceback.format_exception(a.exc_type, a.exc_value, a.exc_traceback)))


# ── local media server ──
# The UI is served through pywebview's HTTP server, so the browser blocks video from file://
# (cross-origin). This small server streams any local file by absolute path with Range support
# so the video element can seek.
_media_port = None


class _MediaHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):  # silence
        pass

    def do_GET(self):
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        path = urllib.parse.unquote(params.get("p", [""])[0])
        if not path or not os.path.isfile(path):
            self.send_error(404)
            return
        try:
            size = os.path.getsize(path)
            ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
            rng = self.headers.get("Range", "")
            start, end = 0, size - 1
            if rng.startswith("bytes="):
                s, _, e = rng[6:].partition("-")
                start = int(s) if s else 0
                end = int(e) if e else size - 1
                end = min(end, size - 1)
            length = end - start + 1
            self.send_response(206 if rng else 200)
            self.send_header("Content-Type", ctype)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(length))
            self.send_header("Access-Control-Allow-Origin", "*")
            if rng:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            with open(path, "rb") as f:
                f.seek(start)
                while length > 0:
                    chunk = f.read(min(65536, length))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    length -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:  # noqa: BLE001
            _log("MEDIA ERR: " + traceback.format_exc())


def _start_media_server():
    global _media_port
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _MediaHandler)
    httpd.daemon_threads = True
    _media_port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    _log("media server on port %s" % _media_port)


class Api:
    def __init__(self):
        self._window = None
        self._proc = None         # the current local transcription subprocess (killable)
        self._cancelled = False

    # native file picker — multi-select (returns list of paths to JS)
    def pick_file(self):
        types = (
            "וידאו/אודיו (*.mp4;*.mkv;*.webm;*.mov;*.avi;*.m4v;*.mp3;*.m4a;*.wav)",
            "כל הקבצים (*.*)",
        )
        res = self._window.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=True, file_types=types)
        if res:
            return list(res)
        return None

    # native folder picker — for choosing the library base folder (where courses/lectures are stored)
    def pick_folder(self):
        res = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        return res[0] if res else None

    # download video from URL (yt-dlp) → after download, enqueue and transcribe
    def download(self, url):
        threading.Thread(target=self._download, args=(url,), daemon=True).start()

    def _download(self, url):
        try:
            path = engine.download(url, on_progress=lambda p: self._js("window.onDownload", p))
            if path:
                _log("DOWNLOAD OK: " + str(path))
                self._js("window.enqueueFiles", [path])
            else:
                _log("DOWNLOAD returned no path for: " + str(url))
                self._js("window.onError", "ההורדה נכשלה — בדוק את הקישור")
        except Exception as e:  # noqa: BLE001
            _log("DOWNLOAD ERR: " + traceback.format_exc())
            self._js("window.onError", "הורדה נכשלה: " + str(e))

    # start transcription (non-blocking). Local runs in a killable subprocess; cloud in a thread.
    def start(self, path, fast, course="", cloud_cfg=None):
        if cloud_cfg:
            threading.Thread(target=self._run_cloud, args=(path, course or "", cloud_cfg), daemon=True).start()
        else:
            threading.Thread(target=self._run_local, args=(path, bool(fast), course or ""), daemon=True).start()

    # pause / resume the running local job (cooperative — takes effect at the next segment)
    def pause(self):
        self._send_proc("pause\n")

    def resume(self):
        self._send_proc("resume\n")

    # cancel the running local job: kill the worker process outright (stops at any stage, instantly)
    def cancel(self):
        self._cancelled = True
        p = self._proc
        if p and p.poll() is None:
            try:
                p.terminate()
            except Exception:  # noqa: BLE001
                pass

    def _send_proc(self, line):
        p = self._proc
        if p and p.poll() is None and p.stdin:
            try:
                p.stdin.write(line)
                p.stdin.flush()
            except Exception:  # noqa: BLE001
                pass

    def _finish(self, res, course):
        """Shared success path: relocate into the course folder (if any), register, notify the UI."""
        if course:
            try:
                res = engine.relocate(res, course)
            except Exception:  # noqa: BLE001 — transcription succeeded; only the move failed
                _log("RELOCATE ERR: " + traceback.format_exc())
                engine.add_lecture(res["video"], res["srt"], course=course)
                self._js("window.onError", "ההעברה לתיקיית הקורס נכשלה — הקבצים נשארו בתיקיית המקור.")
                return
        engine.add_lecture(res["video"], res["srt"], course=course)
        _log("TRANSCRIBE OK: %s cues, srt=%s" % (res["count"], res["srt"]))
        self._js("window.onDone", {
            "video": res["video"], "cues": res["cues"],
            "srt": res["srt"], "count": res["count"],
        })

    def _run_local(self, path, fast, course):
        self._cancelled = False
        self._proc = None
        try:
            _log("TRANSCRIBE START (local): " + str(path))
            # ponytail: fresh process per job → model reloads each lecture; persistent worker if that latency bites
            flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            proc = subprocess.Popen(
                [sys.executable, WORKER, path, "1" if fast else "0"],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=_crash_fh,
                cwd=HERE, text=True, encoding="utf-8", bufsize=1, creationflags=flags)
            self._proc = proc
            if self._cancelled:           # cancel arrived before the handle was stored — honor it now
                try:
                    proc.terminate()
                except Exception:  # noqa: BLE001
                    pass

            result, error = None, None
            for line in proc.stdout:                  # streams until the worker exits / is killed
                if not line:
                    continue
                kind, body = line[0], line[1:].strip()
                if kind == "P":
                    try:
                        self._js("window.onProgress", json.loads(body))
                    except Exception:  # noqa: BLE001
                        pass
                elif kind == "D":
                    result = json.loads(body)
                elif kind == "E":
                    error = json.loads(body)
            proc.wait()

            if self._cancelled:
                _log("TRANSCRIBE CANCELLED: " + str(path))
                self._js("window.onCancelled", None)  # killed before SRT was written — nothing to clean up
            elif error is not None:
                _log("TRANSCRIBE ERR (worker): " + str(error))
                self._js("window.onError", str(error))
            elif result is not None:
                self._finish(result, course)
            else:
                self._js("window.onError", "התמלול נעצר באופן בלתי צפוי.")
        except Exception:  # noqa: BLE001
            _log("RUN LOCAL ERR: " + traceback.format_exc())
            self._js("window.onCancelled", None) if self._cancelled else self._js("window.onError", "שגיאה בהרצת התמלול")
        finally:
            self._proc = None

    def _run_cloud(self, path, course, cloud_cfg):
        self._cancelled = False
        try:
            _log("TRANSCRIBE START (cloud): " + str(path))
            res = engine.transcribe(path, fast=False, cloud=cloud_cfg,
                                     on_progress=lambda p: self._js("window.onProgress", p))
            if res.get("seconds"):  # accumulate cost by processing time reported by server
                engine.add_cloud_usage(res["seconds"])
            self._finish(res, course)
        except Exception as e:  # noqa: BLE001
            _log("TRANSCRIBE ERR: " + traceback.format_exc())
            self._js("window.onError", str(e))

    # log JS errors to crash.log for diagnostics
    def log(self, msg):
        _log("JS: " + str(msg))

    # URL for playing a local file through the media server (instead of file:// which is blocked)
    def media_url(self, path):
        if not _media_port or not path:
            return ""
        return "http://127.0.0.1:%s/?p=%s" % (_media_port, urllib.parse.quote(os.path.abspath(path)))

    # ── window buttons (the colored dots) ──
    def win_close(self):
        self._window.destroy()

    def win_minimize(self):
        self._window.minimize()

    def win_fullscreen(self):
        self._window.toggle_fullscreen()

    # ── settings (transcription mode + personal cloud server config) ──
    def get_settings(self):
        return engine.load_settings()

    def save_settings(self, data):
        return engine.save_settings(data)

    # ── transcription queue persistence (crash recovery) ──
    def save_queue(self, jobs):
        return engine.save_queue(jobs)

    def load_queue(self):
        return engine.load_queue()

    # ── lecture library ──
    def library(self):
        return engine.load_library()

    def create_course(self, name):
        return engine.create_course(name)

    def remove_course(self, name):
        return engine.remove_course(name)

    def set_lecture_course(self, video, course):
        return engine.set_lecture_course(video, course)

    def remove_lecture(self, video):
        return engine.remove_lecture(video)

    def open_lecture(self, video):
        return engine.open_lecture(video)

    def rename_lecture(self, video, title):
        return engine.rename_lecture(video, title)

    def search(self, query):
        return engine.search_library(query)

    # open the lecture's standalone HTML player in the default browser
    def open_in_browser(self, video):
        path = engine.viewer_path(video)
        if not os.path.isfile(path):
            return "ERR: לא נמצא נגן עבור ההרצאה הזו"
        try:
            os.startfile(path)  # noqa: SLF001
            return True
        except Exception as e:  # noqa: BLE001
            return "ERR: " + str(e)

    # save subtitles after editing
    def save_srt(self, video, cues):
        try:
            engine.save_srt(video, cues)
            return True
        except Exception as e:  # noqa: BLE001
            return str(e)

    # export transcript (txt / docx) — saved next to the video and opened
    def export(self, video, cues, fmt):
        try:
            out = engine.export_docx(video, cues) if fmt == "docx" else engine.export_txt(video, cues)
            try:
                os.startfile(out)  # noqa: SLF001
            except Exception:
                pass
            return os.path.basename(out)
        except Exception as e:  # noqa: BLE001
            return "ERR: " + str(e)

    def _js(self, fn, arg):
        try:
            self._window.evaluate_js(f"{fn}({json.dumps(arg, ensure_ascii=True)})")
        except Exception:
            pass


def _register_drop(window):
    """Register real drag-and-drop: pywebview provides the full path only via the DOM API handler."""
    def on_drop(e):
        try:
            files = (e or {}).get("dataTransfer", {}).get("files", [])
        except Exception:
            files = []
        paths = [f.get("pywebviewFullPath") for f in files if f.get("pywebviewFullPath")]
        if paths:
            window.evaluate_js(f"window.enqueueFiles({json.dumps(paths, ensure_ascii=True)})")

    el = window.dom.get_element("#drop")
    if el is not None:
        el.events.drop += on_drop


def main():
    _log("=== app start ===")
    _start_media_server()
    api = Api()
    window = webview.create_window(
        "Subtitle Sidekick",
        url=INDEX,
        js_api=api,
        width=660,
        height=730,
        min_size=(560, 640),
        background_color="#efe3d0",
    )
    api._window = window
    window.events.loaded += lambda: _register_drop(window)
    webview.start(debug=False, icon=ICON)


if __name__ == "__main__":
    main()
