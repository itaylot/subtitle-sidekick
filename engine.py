"""engine.py — לוגיקת התמלול + שמירה/ייצוא, מנותקת לחלוטין מה-UI.

faster-whisper + מודל ivrit-ai. זיהוי GPU אוטומטי (NVIDIA → פי כמה מהר).
"""

import os
import re
import json
import time

MODEL_ACCURATE = "ivrit-ai/whisper-large-v3-turbo-ct2"  # מדויק לעברית
MODEL_FAST = "small"                                    # מהיר, פחות מדויק
VIDEO_EXT = (".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v", ".mp3", ".m4a", ".wav", ".flac", ".ogg")

CPU_THREADS = max(4, os.cpu_count() or 4)

_model = None
_model_name = None
_device = "cpu"


def fmt_time(t: float) -> str:
    h = int(t // 3600); m = int((t % 3600) // 60); s = int(t % 60)
    ms = int(round((t - int(t)) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def human(sec: float) -> str:
    sec = max(0, int(sec))
    m, s = divmod(sec, 60)
    if m >= 60:
        h, m = divmod(m, 60)
        return f"{h}:{m:02d} שעות"
    if m:
        return f"{m}:{s:02d} דקות"
    return f"{s} שניות"


# ── זיהוי חומרה ──
def _resolve_device():
    """מחזיר (device, compute_type). אם יש GPU של NVIDIA — משתמשים בו."""
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


def _load_model(name):
    """טוען מודל; מנסה GPU ואם נכשל נופל ל-CPU."""
    from faster_whisper import WhisperModel
    dev, ct = _resolve_device()
    try:
        m = WhisperModel(name, device=dev, compute_type=ct, cpu_threads=CPU_THREADS, num_workers=1)
        return m, dev
    except Exception:
        m = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=CPU_THREADS, num_workers=1)
        return m, "cpu"


# ── SRT ──
def write_srt(srt_path, cues):
    with open(srt_path, "w", encoding="utf-8") as f:
        for i, c in enumerate(cues, 1):
            f.write(f"{i}\n{fmt_time(c['start'])} --> {fmt_time(c['end'])}\n{c['text'].strip()}\n\n")


def save_srt(video, cues):
    """שומר מחדש SRT + נגן אחרי עריכה."""
    srt = os.path.splitext(video)[0] + ".srt"
    write_srt(srt, cues)
    make_viewer(video, cues)
    return srt


# ── ייצוא תמליל ──
def export_txt(video, cues):
    out = os.path.splitext(video)[0] + " — תמליל.txt"
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(c["text"].strip() for c in cues))
    return out


def export_docx(video, cues):
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement

    def set_rtl(p):
        pPr = p._p.get_or_add_pPr()
        bidi = OxmlElement("w:bidi")
        pPr.append(bidi)
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT

    doc = Document()
    title = doc.add_heading(os.path.splitext(os.path.basename(video))[0], level=1)
    set_rtl(title)
    for c in cues:
        p = doc.add_paragraph(c["text"].strip())
        set_rtl(p)
    out = os.path.splitext(video)[0] + " — תמליל.docx"
    doc.save(out)
    return out


# נגן עצמאי (בונוס). כתוביות native דרך <track> VTT — מופיעות גם במסך מלא.
VIEWER_TEMPLATE = """<!DOCTYPE html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><title>__TITLE__</title>
<style>
 body{margin:0;background:#15151a;font-family:system-ui,Arial,sans-serif}
 #stage{position:relative;max-width:1100px;margin:0 auto}
 video{width:100%;display:block;background:#000}
 video::cue{background:rgba(0,0,0,.72);color:#fff;font-size:1.05em;line-height:1.4}
</style></head><body>
<div id="stage"><video id="v" src="__SRC__" controls autoplay></video></div>
<script>
 const cues=__CUES__,v=document.getElementById('v');
 function ts(t){const h=String(Math.floor(t/3600)).padStart(2,'0'),
   m=String(Math.floor(t%3600/60)).padStart(2,'0'),s=String(Math.floor(t%60)).padStart(2,'0'),
   ms=String(Math.round(t%1*1000)).padStart(3,'0');return `${h}:${m}:${s}.${ms}`;}
 let vtt="WEBVTT\\n\\n";
 for(const c of cues){vtt+=ts(c.start)+" --> "+ts(c.end)+"\\n"+c.text+"\\n\\n";}
 const tr=document.createElement('track');
 tr.kind='subtitles';tr.srclang='he';tr.label='עברית';tr.default=true;
 tr.src=URL.createObjectURL(new Blob([vtt],{type:'text/vtt'}));
 v.appendChild(tr);
 v.addEventListener('loadedmetadata',()=>{if(v.textTracks[0])v.textTracks[0].mode='showing';});
</script></body></html>"""


def make_viewer(video, cues):
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


# ── ספריית הרצאות (Library): קורסים + הרצאות שתמללנו, נשמר ב-JSON ──
LIB_DIR = os.path.join(os.path.expanduser("~"), "Videos", "Subtitle Sidekick")
LIB_PATH = os.path.join(LIB_DIR, "library.json")


def load_library():
    """מחזיר {courses: [...], lectures: [...]} (נוצר ריק אם אין)."""
    try:
        with open(LIB_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {}
    data.setdefault("courses", [])
    data.setdefault("lectures", [])
    # מסנן הרצאות שהקובץ שלהן כבר לא קיים
    data["lectures"] = [l for l in data["lectures"] if os.path.exists(l.get("video", ""))]
    return data


def save_library(data):
    os.makedirs(LIB_DIR, exist_ok=True)
    with open(LIB_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return data


# ── הגדרות משתמש (מצב תמלול + קונפיג שרת Cloud אישי) — נשמר ב-JSON מקומי ──
SETTINGS_PATH = os.path.join(LIB_DIR, "settings.json")


def load_settings():
    """מחזיר את ההגדרות עם כל ברירות-המחדל מולאות (מצב תמלול + קונפיג ומונה-עלות לשרת)."""
    try:
        with open(SETTINGS_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {}
    data.setdefault("transcription_mode", "local_accurate")
    data.setdefault("cloud", {})
    c = data["cloud"]
    c.setdefault("endpoint_url", "")
    c.setdefault("api_key", "")
    c.setdefault("price_per_hour", 0)        # מחיר ה-GPU לשעה ($) — לחישוב עלות
    c.setdefault("total_seconds", 0)         # זמן עיבוד מצטבר בשרת
    c.setdefault("total_cost", 0)            # עלות מצטברת ($)
    return data


def save_settings(update):
    """ממזג עדכון חלקי לתוך ההגדרות הקיימות (לא דורס) ושומר. מחזיר את ההגדרות המלאות."""
    data = load_settings()
    for k, v in (update or {}).items():
        if k == "cloud" and isinstance(v, dict):
            data["cloud"].update(v)
        else:
            data[k] = v
    os.makedirs(LIB_DIR, exist_ok=True)
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return data


def add_cloud_usage(seconds):
    """מצבר זמן עיבוד בשרת לעלות מצטברת (לפי המחיר-לשעה שהוגדר). מחזיר את ההגדרות המעודכנות."""
    data = load_settings()
    seconds = max(0, float(seconds or 0))
    rate = float(data["cloud"].get("price_per_hour") or 0)
    data["cloud"]["total_seconds"] = (float(data["cloud"].get("total_seconds") or 0) + seconds)
    data["cloud"]["total_cost"] = (float(data["cloud"].get("total_cost") or 0) + seconds / 3600.0 * rate)
    return save_settings({"cloud": {
        "total_seconds": data["cloud"]["total_seconds"],
        "total_cost": data["cloud"]["total_cost"],
    }})


def create_course(name):
    name = (name or "").strip()
    data = load_library()
    if name and name not in data["courses"]:
        data["courses"].append(name)
        save_library(data)
    return data


def remove_course(name):
    """מסיר קורס; הרצאותיו עוברות ל'ללא קורס' (הקבצים לא נמחקים)."""
    data = load_library()
    data["courses"] = [c for c in data["courses"] if c != name]
    for l in data["lectures"]:
        if l.get("course") == name:
            l["course"] = ""
    return save_library(data)


def add_lecture(video, srt=None, course="", title=None):
    """רושם הרצאה ב-library (מחליף רשומה קיימת לאותו קובץ). מחזיר את ה-library."""
    video = os.path.abspath(video)
    srt = srt or (os.path.splitext(video)[0] + ".srt")
    title = title or os.path.splitext(os.path.basename(video))[0]
    data = load_library()
    data["lectures"] = [l for l in data["lectures"] if l.get("video") != video]
    data["lectures"].insert(0, {
        "video": video, "srt": srt, "course": course or "",
        "title": title, "added": time.time(), "viewed": False,
    })
    if course and course not in data["courses"]:
        data["courses"].append(course)
    return save_library(data)


def remove_lecture(video):
    video = os.path.abspath(video)
    data = load_library()
    data["lectures"] = [l for l in data["lectures"] if l.get("video") != video]
    return save_library(data)


def set_lecture_course(video, course):
    video = os.path.abspath(video)
    data = load_library()
    for l in data["lectures"]:
        if l.get("video") == video:
            l["course"] = course or ""
    if course and course not in data["courses"]:
        data["courses"].append(course)
    return save_library(data)


def rename_lecture(video, title):
    """משנה את שם התצוגה ב-library (לא נוגע בקובץ עצמו בדיסק — בטוח גם בזמן ניגון)."""
    video = os.path.abspath(video)
    title = (title or "").strip()
    if not title:
        return load_library()
    data = load_library()
    for l in data["lectures"]:
        if l.get("video") == video:
            l["title"] = title
    return save_library(data)


def viewer_path(video):
    """נתיב נגן-ה-HTML העצמאי של ההרצאה (נוצר בזמן התמלול)."""
    folder = os.path.dirname(video)
    base = os.path.splitext(os.path.basename(video))[0]
    return os.path.join(folder, base + " — כתוביות.html")


def _parse_ts(s):
    s = s.strip().replace(",", ".")
    h, m, rest = s.split(":")
    return int(h) * 3600 + int(m) * 60 + float(rest)


def parse_srt(srt):
    """קורא קובץ SRT חזרה לרשימת cues (לפתיחת הרצאה מההיסטוריה בנגן)."""
    cues = []
    try:
        with open(srt, encoding="utf-8") as f:
            content = f.read()
    except Exception:
        return cues
    for block in re.split(r"\n\s*\n", content.strip()):
        lines = [l for l in block.splitlines() if l.strip()]
        tline = next((l for l in lines if "-->" in l), None)
        if not tline:
            continue
        try:
            a, b = tline.split("-->")
            start, end = _parse_ts(a), _parse_ts(b)
        except Exception:
            continue
        text = " ".join(lines[lines.index(tline) + 1:]).strip()
        if text:
            cues.append({"start": round(start, 3), "end": round(end, 3), "text": text})
    return cues


def open_lecture(video):
    """מחזיר {video, cues, srt} להרצאה שמורה — קורא את ה-SRT מהדיסק. מסמן כ'נצפתה'."""
    video = os.path.abspath(video)
    data = load_library()
    lec = next((l for l in data["lectures"] if l.get("video") == video), None)
    srt = (lec or {}).get("srt") or (os.path.splitext(video)[0] + ".srt")
    if lec and not lec.get("viewed"):
        lec["viewed"] = True
        save_library(data)
    return {"video": video, "cues": parse_srt(srt), "srt": srt}


def download(url, on_progress=None, browser="chrome"):
    """מוריד וידאו מקישור (yt-dlp). מחזיר נתיב הקובץ שירד.

    מנסה קודם עם cookies של הדפדפן (ל-Moodle מאחורי התחברות); אם נכשל —
    מוריד בלי cookies (לקישורים ציבוריים כמו YouTube).
    """
    from yt_dlp import YoutubeDL

    outdir = os.path.join(os.path.expanduser("~"), "Videos", "Subtitle Sidekick")
    os.makedirs(outdir, exist_ok=True)
    holder = {"path": None}

    def hook(d):
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            pct = int(done / total * 100) if total else 0
            if on_progress:
                on_progress({"percent": pct, "status": "downloading"})
        elif d.get("status") == "finished":
            holder["path"] = d.get("filename")
            if on_progress:
                on_progress({"percent": 100, "status": "finished"})

    base_opts = {
        "outtmpl": os.path.join(outdir, "%(title).80s.%(ext)s"),
        "format": "best",          # קובץ יחיד (וידאו+אודיו) — בלי צורך ב-ffmpeg למיזוג
        "progress_hooks": [hook],
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
    }

    def run(with_cookies):
        opts = dict(base_opts)
        if with_cookies and browser:
            opts["cookiesfrombrowser"] = (browser,)
        with YoutubeDL(opts) as ydl:
            ydl.extract_info(url, download=True)

    # 1) ניסיון עם cookies (ל-Moodle מאחורי התחברות)
    cookie_err = None
    try:
        run(True)
        return holder["path"]
    except Exception as e:  # noqa: BLE001
        cookie_err = str(e)
        holder["path"] = None

    # 2) נפילה לבלי-cookies (לקישורים ציבוריים כמו YouTube)
    try:
        run(False)
        return holder["path"]
    except Exception as e2:  # noqa: BLE001
        msg = str(e2)
        low = msg.lower()
        # (א) הקישור אינו וידאו ישיר — דף נגן (Moodle/אתר) שאין ממנו מה לחלץ
        if "unsupported url" in low or "no video" in low or "unable to extract" in low:
            raise RuntimeError(
                "הקישור הזה הוא דף נגן (למשל דף וידאו של Moodle), לא קובץ וידאו ישיר — "
                "אי אפשר להוריד אותו אוטומטית. הורד את הסרטון ידנית וגרור את הקובץ לכאן, "
                "או מצא את כתובת הווידאו הישירה (mp4/m3u8) והדבק אותה.")
        # (ב) בעיית קריאת cookies (כרום פתוח/נעול) — להתחברות מאחורי Moodle
        if "could not copy" in cookie_err.lower() or "cookie" in cookie_err.lower():
            raise RuntimeError(
                "ל-Moodle צריך להתחבר בכרום ואז לסגור אותו לגמרי (כדי שאפשר יהיה לקרוא את "
                "ההתחברות), ולנסות שוב.")
        raise RuntimeError(msg)


def transcribe(video_path, fast=False, on_progress=None, cloud=None):
    """מתמלל קובץ → SRT + cues. on_progress(dict) נקרא לאורך הדרך.

    cloud={"endpoint_url":..., "api_key":...} מנתב לתמלול בשרת חיצוני (cloud_backend)
    במקום למודל המקומי. שאר האפליקציה מקבלת תמיד את אותו מבנה תוצאה.
    """
    if cloud:
        import cloud_backend
        return cloud_backend.transcribe_remote(
            video_path, cloud.get("endpoint_url", ""), cloud.get("api_key", ""), on_progress)

    global _model, _model_name, _device

    def emit(**kw):
        if on_progress:
            kw.setdefault("device", _device)
            on_progress(kw)

    name = MODEL_FAST if fast else MODEL_ACCURATE
    if _model is None or _model_name != name:
        emit(stage="extract", percent=0, eta=None, elapsed=0, loading=True)
        _model, _device = _load_model(name)
        _model_name = name
    emit(stage="extract", percent=100, eta=None, elapsed=0)

    emit(stage="transcribe", percent=0, eta=None, elapsed=0)
    segments, info = _model.transcribe(
        video_path, language="he", vad_filter=True, beam_size=1,
        vad_parameters={"min_silence_duration_ms": 500})
    dur = getattr(info, "duration", 0) or 0

    base = os.path.splitext(video_path)[0]
    srt = base + ".srt"
    cues = []
    t0 = time.time()
    with open(srt, "w", encoding="utf-8") as fh:
        n = 0
        for seg in segments:
            txt = seg.text.strip()
            if not txt:
                continue
            n += 1
            fh.write(f"{n}\n{fmt_time(seg.start)} --> {fmt_time(seg.end)}\n{txt}\n\n")
            cues.append({"start": round(seg.start, 3), "end": round(seg.end, 3), "text": txt})
            if dur:
                elapsed = time.time() - t0
                rate = seg.end / elapsed if elapsed > 0 else 0
                eta = (dur - seg.end) / rate if rate > 0 else 0
                emit(stage="transcribe", percent=min(99, int(seg.end / dur * 100)),
                     eta=eta, elapsed=elapsed, line=txt)

    emit(stage="sync", percent=99, eta=0, elapsed=time.time() - t0)
    viewer = make_viewer(video_path, cues)
    return {"srt": srt, "cues": cues, "viewer": viewer, "count": n, "video": video_path}
