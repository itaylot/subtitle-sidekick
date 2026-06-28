"""cloud_backend.py — תמלול דרך שרת GPU חיצוני שהמשתמש מגדיר בעצמו.

לכל משתמש יש endpoint/api_key משלו (RunPod וכו') — אין כאן שום חיבור קבוע.
מחזיר את אותו מבנה dict כמו engine.transcribe (srt/cues/viewer/count/video),
כך שאר האפליקציה לא צריכה לדעת אם התמלול היה מקומי או מרוחק.
"""

import os
import tempfile

import requests

import engine

REQUEST_TIMEOUT = 600  # שניות — תמלול הרצאה ארוכה יכול לקחת זמן


def _extract_audio(video_path):
    """מחלץ פס קול בלבד לקובץ אופוס זמני, כדי לא להעלות וידאו כבד. דורש av (תלות של faster-whisper)."""
    import av

    fd, audio_path = tempfile.mkstemp(suffix=".ogg")
    os.close(fd)
    try:
        with av.open(video_path) as in_container:
            in_stream = next(s for s in in_container.streams if s.type == "audio")
            with av.open(audio_path, "w", format="ogg") as out_container:
                out_stream = out_container.add_stream("libopus", rate=16000)
                for frame in in_container.decode(in_stream):
                    for packet in out_stream.encode(frame):
                        out_container.mux(packet)
                for packet in out_stream.encode(None):
                    out_container.mux(packet)
        return audio_path
    except Exception:
        try:
            os.remove(audio_path)
        except OSError:
            pass
        raise


def transcribe_remote(video_path, endpoint_url, api_key, on_progress=None):
    """מתמלל דרך שרת חיצוני. מחזיר {srt, cues, viewer, count, video} — זהה למקומי."""
    if not endpoint_url:
        raise RuntimeError("לא הוגדרה כתובת שרת. פתחו את הגדרות השרת והזינו endpoint.")

    def emit(**kw):
        if on_progress:
            kw.setdefault("device", "cloud")
            on_progress(kw)

    emit(stage="extract", percent=0, eta=None, elapsed=0, loading=True)
    try:
        audio_path = _extract_audio(video_path)
    except Exception as e:  # noqa: BLE001
        raise RuntimeError("חילוץ האודיו מהווידאו נכשל: " + str(e)) from e

    try:
        emit(stage="extract", percent=100, eta=None, elapsed=0)
        emit(stage="transcribe", percent=0, eta=None, elapsed=0)

        url = endpoint_url.rstrip("/") + "/transcribe"
        headers = {"Authorization": "Bearer " + (api_key or "")}
        data = {
            "language": "he",
            "model": "ivrit-ai/whisper-large-v3-turbo-ct2",
            "vad_filter": "true",
            "beam_size": "1",
        }
        try:
            with open(audio_path, "rb") as f:
                resp = requests.post(
                    url, headers=headers, data=data,
                    files={"audio_file": ("audio.ogg", f, "audio/ogg")},
                    timeout=REQUEST_TIMEOUT,
                )
        except requests.exceptions.Timeout as e:
            raise RuntimeError("השרת לא הגיב בזמן (timeout). נסו שוב או חזרו למצב מקומי.") from e
        except requests.exceptions.ConnectionError as e:
            raise RuntimeError("לא ניתן להתחבר לשרת — בדקו את כתובת ה-endpoint וזמינות השרת.") from e

        if resp.status_code == 401:
            raise RuntimeError("מפתח ה-API שגוי או לא תקין.")
        if resp.status_code != 200:
            raise RuntimeError(f"השרת החזיר שגיאה (קוד {resp.status_code}).")

        try:
            payload = resp.json()
        except ValueError as e:
            raise RuntimeError("תשובת השרת אינה JSON תקין.") from e

        if not payload.get("ok"):
            raise RuntimeError(payload.get("error") or "התמלול בשרת נכשל.")

        segments = payload.get("segments") or []
        emit(stage="transcribe", percent=100, eta=0, elapsed=0)

        cues = [
            {"start": round(s["start"], 3), "end": round(s["end"], 3), "text": s["text"].strip()}
            for s in segments if s.get("text", "").strip()
        ]

        srt = os.path.splitext(video_path)[0] + ".srt"
        engine.write_srt(srt, cues)
        emit(stage="sync", percent=99, eta=0, elapsed=0)
        viewer = engine.make_viewer(video_path, cues)

        # זמן עיבוד שהשרת מדווח (שניות) — לחישוב עלות מצטברת. 0 אם השרת לא מחזיר.
        seconds = float(payload.get("execution_time") or 0)

        return {"srt": srt, "cues": cues, "viewer": viewer, "count": len(cues),
                "video": video_path, "seconds": seconds}
    finally:
        try:
            os.remove(audio_path)
        except OSError:
            pass
