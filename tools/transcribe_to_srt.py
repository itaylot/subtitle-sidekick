"""transcribe_to_srt.py — transcribe a video/audio file to a synced Hebrew SRT subtitle file.

Intended for recorded lectures (Moodle etc.): download the lecture, run this once,
and get a .srt file with accurate timestamps. A player (VLC etc.) loads it automatically
when the SRT sits next to the video with the same base name.

Usage:
  python transcribe_to_srt.py "lecture.mp4"            -> creates lecture.srt
  python transcribe_to_srt.py "lecture.mp4" out.srt    -> custom output name

Model: default = accurate Hebrew model (ivrit-ai). Slow machine: MHS_MODEL=small.
Supports all formats (mp4/mkv/mp3/m4a/wav...) via PyAV — no separate ffmpeg needed.
"""

import os
import sys

# ensure correct Hebrew output in the console on Windows
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from faster_whisper import WhisperModel
from engine import fmt_time

MODEL = os.environ.get("MHS_MODEL", "ivrit-ai/whisper-large-v3-turbo-ct2")
DEVICE = os.environ.get("MHS_DEVICE", "cpu")
COMPUTE = os.environ.get("MHS_COMPUTE", "int8")
LANG = os.environ.get("MHS_LANG", "he")


def main():
    if len(sys.argv) < 2:
        print("שימוש: python transcribe_to_srt.py <קובץ וידאו/אודיו> [פלט.srt]")
        sys.exit(1)

    src = sys.argv[1]
    if not os.path.isfile(src):
        print(f"קובץ לא נמצא: {src}")
        sys.exit(1)
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(src)[0] + ".srt"

    print(f"טוען מודל {MODEL} ({DEVICE}/{COMPUTE})...", flush=True)
    model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE)

    print(f"מתמלל: {src}", flush=True)
    print("(על CPU זה יכול לקחת זמן — רץ פעם אחת ושומר קובץ)\n", flush=True)

    # vad_filter removes silences; beam_size=5 for high accuracy (offline, no speed penalty)
    segments, info = model.transcribe(src, language=LANG, vad_filter=True, beam_size=5)

    n = 0
    with open(out, "w", encoding="utf-8") as f:
        for seg in segments:
            text = seg.text.strip()
            if not text:
                continue
            n += 1
            f.write(f"{n}\n{fmt_time(seg.start)} --> {fmt_time(seg.end)}\n{text}\n\n")
            f.flush()
            print(f"  [{fmt_time(seg.start)} → {fmt_time(seg.end)}] {text}", flush=True)

    print(f"\n✓ נוצרו {n} כתוביות → {out}", flush=True)
    print("פתח את הסרטון ב-VLC. אם ה-SRT באותו שם וליד הסרטון — הוא ייטען אוטומטית ויהיה מסונכרן.", flush=True)


if __name__ == "__main__":
    main()
