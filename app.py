"""app.py — משגר האפליקציה: חלון pywebview שמרנדר את ה-UI (ui/), עם bridge ל-Python.

ה-UI הוא HTML/CSS/JS נקי (ui/). הלוגיקה כולה ב-engine.py (faster-whisper / ivrit-ai).
מחלקת Api מחברת את כפתורי ה-UI לפונקציות התמלול ומזרימה התקדמות חזרה ל-DOM.
"""

import os
import sys
import json
import mimetypes
import threading
import traceback
import faulthandler
import socketserver
import http.server
import urllib.parse

import webview

import engine

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(HERE, "ui", "index.html")
ICON = os.path.join(HERE, "ui", "icons", "app.ico")
CRASH_LOG = os.path.join(HERE, "crash.log")

# רישום קריסות לקובץ crash.log (כדי לאבחן קריסות שקטות בלי CMD)
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


# ── שרת מדיה מקומי ──
# ה-UI מוגש דרך שרת ה-HTTP של pywebview, ולכן הדפדפן חוסם וידאו מ-file:// (מקור שונה).
# שרת קטן זה מזרים כל קובץ מקומי לפי נתיב מוחלט (עם תמיכה ב-Range לקפיצה בסרטון).
_media_port = None


class _MediaHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):  # שקט
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

    # בורר קבצים נייטיב — ריבוי בחירה (מחזיר רשימת נתיבים ל-JS)
    def pick_file(self):
        types = (
            "וידאו/אודיו (*.mp4;*.mkv;*.webm;*.mov;*.avi;*.m4v;*.mp3;*.m4a;*.wav)",
            "כל הקבצים (*.*)",
        )
        res = self._window.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=True, file_types=types)
        if res:
            return list(res)
        return None

    # הורדת וידאו מקישור (yt-dlp) → אחרי שירד, נכנס לתור ומתמלל
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

    # התחלת תמלול (לא חוסם — רץ ב-thread, מזרים התקדמות ל-UI)
    def start(self, path, fast, course="", cloud_cfg=None):
        threading.Thread(target=self._run, args=(path, bool(fast), course or "", cloud_cfg or None), daemon=True).start()

    def _run(self, path, fast, course, cloud_cfg):
        try:
            _log("TRANSCRIBE START: " + str(path) + (" (cloud)" if cloud_cfg else ""))
            res = engine.transcribe(path, fast=fast, cloud=cloud_cfg,
                                     on_progress=lambda p: self._js("window.onProgress", p))
            engine.add_lecture(res["video"], res["srt"], course=course)  # רישום ל-library
            if cloud_cfg and res.get("seconds"):  # צבירת עלות לפי זמן העיבוד שהשרת דיווח
                engine.add_cloud_usage(res["seconds"])
            _log("TRANSCRIBE OK: %s cues, srt=%s" % (res["count"], res["srt"]))
            self._js("window.onDone", {
                "video": res["video"], "cues": res["cues"],
                "srt": res["srt"], "count": res["count"],
            })
        except Exception as e:  # noqa: BLE001
            _log("TRANSCRIBE ERR: " + traceback.format_exc())
            self._js("window.onError", str(e))

    # רישום שגיאות JS לקובץ crash.log (לאבחון)
    def log(self, msg):
        _log("JS: " + str(msg))

    # כתובת לניגון קובץ מקומי דרך שרת המדיה (במקום file:// שנחסם)
    def media_url(self, path):
        if not _media_port or not path:
            return ""
        return "http://127.0.0.1:%s/?p=%s" % (_media_port, urllib.parse.quote(os.path.abspath(path)))

    # ── כפתורי חלון (הנקודות הצבעוניות) ──
    def win_close(self):
        self._window.destroy()

    def win_minimize(self):
        self._window.minimize()

    def win_fullscreen(self):
        self._window.toggle_fullscreen()

    # ── הגדרות (מצב תמלול + קונפיג שרת Cloud אישי) ──
    def get_settings(self):
        return engine.load_settings()

    def save_settings(self, data):
        return engine.save_settings(data)

    # ── ספריית הרצאות (library) ──
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

    # פתיחת נגן-ה-HTML העצמאי של ההרצאה בדפדפן הרגיל
    def open_in_browser(self, video):
        path = engine.viewer_path(video)
        if not os.path.isfile(path):
            return "ERR: לא נמצא נגן עבור ההרצאה הזו"
        try:
            os.startfile(path)  # noqa: SLF001
            return True
        except Exception as e:  # noqa: BLE001
            return "ERR: " + str(e)

    # שמירת כתוביות אחרי עריכה
    def save_srt(self, video, cues):
        try:
            engine.save_srt(video, cues)
            return True
        except Exception as e:  # noqa: BLE001
            return str(e)

    # ייצוא תמליל (txt / docx) — נשמר ליד הסרטון ונפתח
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
    """גרירת קובץ אמיתית: pywebview מאכלס נתיב מלא רק כשרשום handler דרך ה-DOM API."""
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
