"""app.py — אפליקציית כתוביות עברית להרצאות (ממשק גרפי, בלי שורת פקודה).

זרימה: בוחרים קובץ הרצאה → "צור כתוביות" → צופים עם כתוביות עברית מסונכרנות.
הכל בכפתורים. בלי CMD, בלי טרמינל.

מריצים דרך הקובץ run.bat / קיצור הדרך בשולחן העבודה (משתמשים ב-Python של backend/.venv312).
"""

import os
import json
import queue
import threading
import webbrowser
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

MODEL_ACCURATE = "ivrit-ai/whisper-large-v3-turbo-ct2"  # מדויק לעברית
MODEL_FAST = "small"                                    # מהיר, פחות מדויק


def fmt_time(t: float) -> str:
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int(round((t - int(t)) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


VIEWER_TEMPLATE = """<!DOCTYPE html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><title>__TITLE__</title>
<style>
 body{margin:0;background:#1c1c1e;font-family:system-ui,Arial,sans-serif}
 #stage{position:relative;max-width:1100px;margin:0 auto}
 video{width:100%;display:block}
 #subs{position:absolute;bottom:7%;left:50%;transform:translateX(-50%);max-width:90%;
  text-align:center;direction:rtl;background:rgba(0,0,0,.72);color:#fff;font-size:30px;
  font-weight:600;line-height:1.35;padding:4px 16px;border-radius:8px;
  text-shadow:0 1px 3px rgba(0,0,0,.9);pointer-events:none;white-space:pre-wrap}
 #subs:empty{display:none}
</style></head><body>
<div id="stage"><video id="v" src="__SRC__" controls autoplay></video><div id="subs"></div></div>
<script>
 const cues = __CUES__;
 const v=document.getElementById('v'), s=document.getElementById('subs');
 v.addEventListener('timeupdate',()=>{const t=v.currentTime;
   const c=cues.find(c=>t>=c.start&&t<=c.end); s.textContent=c?c.text:'';});
</script></body></html>"""


class App:
    def __init__(self, root):
        self.root = root
        root.title("כתוביות עברית להרצאות")
        root.geometry("580x500")
        self.video_path = None
        self.model = None
        self.model_name = None
        self.viewer_path = None
        self.q = queue.Queue()

        pad = {"padx": 14, "pady": 6}
        ttk.Label(root, text="🎬 כתוביות עברית להרצאות", font=("Segoe UI", 16, "bold")).pack(**pad)
        ttk.Label(root, text="בוחרים קובץ הרצאה, יוצרים כתוביות, וצופים — הכל כאן.",
                  foreground="#666").pack()

        f = ttk.Frame(root)
        f.pack(fill="x", **pad)
        ttk.Button(f, text="בחר קובץ הרצאה…", command=self.choose).pack(side="left")
        self.file_lbl = ttk.Label(f, text="לא נבחר קובץ", foreground="#888")
        self.file_lbl.pack(side="left", padx=10)

        self.fast_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(root, text="מצב מהיר (פחות מדויק) — למחשב איטי",
                        variable=self.fast_var).pack(**pad)

        self.go_btn = ttk.Button(root, text="צור כתוביות ▶", command=self.start, state="disabled")
        self.go_btn.pack(**pad)

        self.prog = ttk.Progressbar(root, mode="determinate", maximum=100)
        self.prog.pack(fill="x", **pad)

        self.log = tk.Text(root, height=12, wrap="word", state="disabled", font=("Segoe UI", 10))
        self.log.pack(fill="both", expand=True, **pad)

        self.watch_btn = ttk.Button(root, text="▶ צפה עם כתוביות", command=self.watch, state="disabled")
        self.watch_btn.pack(**pad)

    def choose(self):
        p = filedialog.askopenfilename(
            title="בחר קובץ הרצאה",
            filetypes=[("וידאו/אודיו", "*.mp4 *.mkv *.webm *.mov *.avi *.mp3 *.m4a *.wav"),
                       ("כל הקבצים", "*.*")])
        if p:
            self.video_path = p
            self.file_lbl.config(text=os.path.basename(p), foreground="#000")
            self.go_btn.config(state="normal")

    def logmsg(self, s):
        self.log.config(state="normal")
        self.log.insert("end", s + "\n")
        self.log.see("end")
        self.log.config(state="disabled")

    def start(self):
        self.go_btn.config(state="disabled")
        self.watch_btn.config(state="disabled")
        self.prog.config(value=0)
        threading.Thread(target=self.worker, daemon=True).start()
        self.root.after(120, self.poll)

    def worker(self):
        try:
            from faster_whisper import WhisperModel
            fast = self.fast_var.get()
            name = MODEL_FAST if fast else MODEL_ACCURATE
            if self.model is None or self.model_name != name:
                self.q.put(("log", f"טוען מודל ({'מהיר' if fast else 'מדויק'})… בפעם הראשונה זו הורדה, סבלנות."))
                self.model = WhisperModel(name, device="cpu", compute_type="int8")
                self.model_name = name
            self.q.put(("log", "מתמלל… (על המעבד זה לוקח זמן — רץ פעם אחת ושומר)"))
            segments, info = self.model.transcribe(
                self.video_path, language="he", vad_filter=True, beam_size=5)
            dur = getattr(info, "duration", 0) or 0
            base = os.path.splitext(self.video_path)[0]
            srt = base + ".srt"
            cues = []
            with open(srt, "w", encoding="utf-8") as fh:
                n = 0
                for seg in segments:
                    txt = seg.text.strip()
                    if not txt:
                        continue
                    n += 1
                    fh.write(f"{n}\n{fmt_time(seg.start)} --> {fmt_time(seg.end)}\n{txt}\n\n")
                    cues.append({"start": round(seg.start, 3), "end": round(seg.end, 3), "text": txt})
                    self.q.put(("log", f"[{fmt_time(seg.start)}] {txt}"))
                    if dur:
                        self.q.put(("prog", min(99.0, seg.end / dur * 100)))
            self.viewer_path = self.make_viewer(self.video_path, cues)
            self.q.put(("prog", 100))
            self.q.put(("done", (n, srt)))
        except Exception as e:  # noqa: BLE001
            self.q.put(("error", str(e)))

    def make_viewer(self, video, cues):
        """כותב דף HTML עצמאי ליד הסרטון (מפנה אליו בשם יחסי) — לצפייה בדפדפן."""
        folder = os.path.dirname(video)
        base = os.path.splitext(os.path.basename(video))[0]
        html = (VIEWER_TEMPLATE
                .replace("__TITLE__", base)
                .replace("__SRC__", os.path.basename(video))
                .replace("__CUES__", json.dumps(cues, ensure_ascii=False)))
        out = os.path.join(folder, base + " — כתוביות.html")
        with open(out, "w", encoding="utf-8") as f:
            f.write(html)
        return out

    def poll(self):
        try:
            while True:
                kind, val = self.q.get_nowait()
                if kind == "log":
                    self.logmsg(val)
                elif kind == "prog":
                    self.prog.config(value=val)
                elif kind == "done":
                    n, srt = val
                    self.logmsg(f"\n✓ נוצרו {n} כתוביות. אפשר לצפות.")
                    self.watch_btn.config(state="normal")
                    self.go_btn.config(state="normal")
                    return
                elif kind == "error":
                    messagebox.showerror("שגיאה", val)
                    self.logmsg("שגיאה: " + val)
                    self.go_btn.config(state="normal")
                    return
        except queue.Empty:
            pass
        self.root.after(150, self.poll)

    def watch(self):
        if self.viewer_path and os.path.exists(self.viewer_path):
            webbrowser.open("file:///" + self.viewer_path.replace("\\", "/"))


def main():
    root = tk.Tk()
    try:
        ttk.Style().theme_use("vista")
    except tk.TclError:
        pass
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
