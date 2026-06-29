"""handler.py — RunPod Serverless handler: transcribes Hebrew audio with faster-whisper.

Input  (job["input"]):  {"audio_b64": "<base64 Opus/Ogg audio>", "language": "he", "beam_size": 5}
Output:                 {"ok": true, "segments": [{"start","end","text"}, ...]}
                      or {"ok": false, "error": "..."}
RunPod wraps this in {"id", "status", "output", "executionTime", ...} automatically.

The model loads once per worker (module scope) and is reused across jobs — only the first
request on a cold worker pays the load cost.
"""

import os
import base64
import tempfile

import runpod
from faster_whisper import WhisperModel

MODEL_NAME = "ivrit-ai/whisper-large-v3-turbo-ct2"

print("Loading model:", MODEL_NAME, flush=True)
model = WhisperModel(MODEL_NAME, device="cuda", compute_type="float16")
print("Model loaded.", flush=True)


def handler(job):
    inp = job.get("input") or {}
    audio_b64 = inp.get("audio_b64")
    if not audio_b64:
        return {"ok": False, "error": "audio_b64 חסר בקלט."}

    language = inp.get("language", "he")
    beam_size = int(inp.get("beam_size", 5))

    fd, audio_path = tempfile.mkstemp(suffix=".ogg")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(base64.b64decode(audio_b64))

        segments, _info = model.transcribe(
            audio_path, language=language, vad_filter=True, beam_size=beam_size)

        out = [
            {"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip()}
            for s in segments if s.text.strip()
        ]
        return {"ok": True, "segments": out}
    except Exception as e:  # noqa: BLE001 — surfaced to the client as a readable error
        return {"ok": False, "error": str(e)}
    finally:
        try:
            os.remove(audio_path)
        except OSError:
            pass


runpod.serverless.start({"handler": handler})
