"""transcribe_to_srt.py — מתמלל קובץ וידאו/אודיו לקובץ כתוביות SRT עברי מסונכרן.

זו הגישה ל**הרצאות מוקלטות** (Moodle): מורידים את ההרצאה, מריצים את הכלי פעם אחת,
ומקבלים קובץ .srt עם חותמות זמן מדויקות. נגן (VLC וכו') טוען אותו אוטומטית
כשהוא נמצא ליד הסרטון באותו שם — והכתוביות מסונכרנות בול לאודיו.

שימוש:
  python transcribe_to_srt.py "lecture.mp4"            -> יוצר lecture.srt
  python transcribe_to_srt.py "lecture.mp4" out.srt    -> שם פלט מותאם

מודל: ברירת מחדל = המודל העברי המדויק (ivrit-ai). למחשב איטי: MHS_MODEL=small.
תומך בכל פורמט (mp4/mkv/mp3/m4a/wav...) דרך PyAV — בלי צורך ב-ffmpeg נפרד.
"""

import os
import sys

# עברית תקינה בפלט הקונסולה (Windows)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from faster_whisper import WhisperModel

MODEL = os.environ.get("MHS_MODEL", "ivrit-ai/whisper-large-v3-turbo-ct2")
DEVICE = os.environ.get("MHS_DEVICE", "cpu")
COMPUTE = os.environ.get("MHS_COMPUTE", "int8")
LANG = os.environ.get("MHS_LANG", "he")


def fmt_time(t: float) -> str:
    """שניות -> HH:MM:SS,mmm (פורמט SRT)."""
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int(round((t - int(t)) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


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

    # vad_filter מסנן שתיקות; beam_size=5 לדיוק גבוה (זה offline, אפשר להרשות)
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
