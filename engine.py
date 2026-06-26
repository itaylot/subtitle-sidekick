"""engine.py — לוגיקת התמלול + שמירה/ייצוא, מנותקת לחלוטין מה-UI.

faster-whisper + מודל ivrit-ai. זיהוי GPU אוטומטי (NVIDIA → פי כמה מהר).
"""

import os
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
        m = WhisperModel(name, device=dev, compute_type=ct, cpu_threads=CPU_THREADS)
        return m, dev
    except Exception:
        m = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=CPU_THREADS)
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


def transcribe(video_path, fast=False, on_progress=None):
    """מתמלל קובץ → SRT + cues. on_progress(dict) נקרא לאורך הדרך."""
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
        video_path, language="he", vad_filter=True, beam_size=1)
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
