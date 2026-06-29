"""cloud_backend.py — transcription via the user's own RunPod Serverless endpoint.

Each user brings their own RunPod endpoint/API key — no shared server here.
Returns the same dict structure as engine.transcribe (srt/cues/viewer/count/video),
so the rest of the app doesn't need to know whether transcription was local or remote.

RunPod Serverless contract: POST {endpoint}/run starts an async job and returns immediately
with an id; the actual transcription (minutes, for a lecture) happens in the background, so we
poll GET {endpoint}/status/<id> until it's COMPLETED/FAILED. See runpod_server/ for the handler.
"""

import os
import time
import base64
import tempfile

import requests

import engine

REQUEST_TIMEOUT = 30     # seconds — for each individual HTTP call (submit / poll), not the whole job
POLL_INTERVAL = 3        # seconds between status checks
MAX_WAIT = 3600          # seconds — give up after an hour (a stuck job, not a slow one)


def _extract_audio(video_path):
    """Extract audio-only to a temporary Opus file to avoid uploading heavy video. Requires av (faster-whisper dependency)."""
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
    """Transcribe via a RunPod Serverless endpoint. Returns {srt, cues, viewer, count, video, seconds}."""
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

        base = endpoint_url.rstrip("/")
        headers = {"Authorization": "Bearer " + (api_key or ""), "Content-Type": "application/json"}
        with open(audio_path, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode("ascii")

        job_id = _submit(base, headers, audio_b64)
        output = _poll(base, headers, job_id, emit)

        segments = output.get("segments") or []
        emit(stage="transcribe", percent=100, eta=0, elapsed=0)

        cues = [
            {"start": round(s["start"], 3), "end": round(s["end"], 3), "text": s["text"].strip()}
            for s in segments if s.get("text", "").strip()
        ]

        srt = os.path.splitext(video_path)[0] + ".srt"
        engine.write_srt(srt, cues)
        emit(stage="sync", percent=99, eta=0, elapsed=0)
        viewer = engine.make_viewer(video_path, cues)

        # processing time reported by RunPod (ms) — for cumulative cost. 0 if not reported.
        seconds = float(output.get("executionTime") or 0) / 1000.0

        return {"srt": srt, "cues": cues, "viewer": viewer, "count": len(cues),
                "video": video_path, "seconds": seconds}
    finally:
        try:
            os.remove(audio_path)
        except OSError:
            pass


def _submit(base, headers, audio_b64):
    """POST /run — starts the job asynchronously, returns its id."""
    body = {"input": {"audio_b64": audio_b64, "language": "he", "beam_size": 5}}
    try:
        resp = requests.post(base + "/run", headers=headers, json=body, timeout=REQUEST_TIMEOUT)
    except requests.exceptions.Timeout as e:
        raise RuntimeError("השרת לא הגיב בזמן (timeout) בעת שליחת הבקשה.") from e
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

    job_id = payload.get("id")
    if not job_id:
        raise RuntimeError("השרת לא החזיר מזהה עבודה (id).")
    return job_id


def _poll(base, headers, job_id, emit):
    """GET /status/<id> repeatedly until COMPLETED/FAILED. Returns the job's `output` dict."""
    t0 = time.time()
    while True:
        if time.time() - t0 > MAX_WAIT:
            raise RuntimeError("השרת לא סיים בזמן סביר — נסו שוב או בדקו את ה-endpoint.")
        time.sleep(POLL_INTERVAL)
        try:
            resp = requests.get(base + "/status/" + job_id, headers=headers, timeout=REQUEST_TIMEOUT)
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError):
            continue  # transient network hiccup during a long job — just retry on the next tick

        if resp.status_code != 200:
            continue
        try:
            payload = resp.json()
        except ValueError:
            continue

        status = payload.get("status")
        emit(stage="transcribe", percent=None, eta=None, elapsed=time.time() - t0)
        if status == "COMPLETED":
            output = dict(payload.get("output") or {})
            output["executionTime"] = payload.get("executionTime")  # RunPod puts this at the top level
            if not output.get("ok", True):
                raise RuntimeError(output.get("error") or "התמלול בשרת נכשל.")
            return output
        if status in ("FAILED", "CANCELLED", "TIMED_OUT"):
            err = (payload.get("error") or status)
            raise RuntimeError(f"התמלול בשרת נכשל: {err}")
        # IN_QUEUE / IN_PROGRESS — keep polling
