"""app.py — משגר האפליקציה: חלון pywebview שמרנדר את ה-UI (ui/), עם bridge ל-Python.

ה-UI הוא HTML/CSS/JS נקי (ui/). הלוגיקה כולה ב-engine.py (faster-whisper / ivrit-ai).
מחלקת Api מחברת את כפתורי ה-UI לפונקציות התמלול ומזרימה התקדמות חזרה ל-DOM.
"""

import os
import json
import threading

import webview

import engine

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(HERE, "ui", "index.html")


class Api:
    def __init__(self):
        self.window = None

    # בורר קבצים נייטיב — ריבוי בחירה (מחזיר רשימת נתיבים ל-JS)
    def pick_file(self):
        types = (
            "וידאו/אודיו (*.mp4;*.mkv;*.webm;*.mov;*.avi;*.m4v;*.mp3;*.m4a;*.wav)",
            "כל הקבצים (*.*)",
        )
        res = self.window.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=True, file_types=types)
        if res:
            return list(res)
        return None

    # התחלת תמלול (לא חוסם — רץ ב-thread, מזרים התקדמות ל-UI)
    def start(self, path, fast):
        threading.Thread(target=self._run, args=(path, bool(fast)), daemon=True).start()

    def _run(self, path, fast):
        try:
            res = engine.transcribe(path, fast=fast, on_progress=lambda p: self._js("window.onProgress", p))
            self._js("window.onDone", {
                "video": res["video"], "cues": res["cues"],
                "srt": res["srt"], "count": res["count"],
            })
        except Exception as e:  # noqa: BLE001
            self._js("window.onError", str(e))

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
            self.window.evaluate_js(f"{fn}({json.dumps(arg, ensure_ascii=True)})")
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
    api = Api()
    window = webview.create_window(
        "כתוביות עברית",
        url=INDEX,
        js_api=api,
        width=660,
        height=730,
        min_size=(560, 640),
        background_color="#efe3d0",
    )
    api.window = window
    window.events.loaded += lambda: _register_drop(window)
    webview.start(debug=False)


if __name__ == "__main__":
    main()
