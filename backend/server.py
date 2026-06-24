"""server.py — שרת תמלול עברי אמיתי, מבוסס faster-whisper, מדבר לפי חוזה B.

זרימה:
  לקוח שולח הודעת config (JSON) → ואז frames בינאריים של Int16 PCM 16kHz mono.
  השרת צובר buffer, מזהה דיבור/שקט (VAD), ושולח:
    {"type":"partial","text":...,"is_final":false}  תוך כדי דיבור
    {"type":"final","text":...,"is_final":true}      בסוף מבע (אחרי שקט)

הגדרות דרך משתני סביבה (ברירת מחדל = CPU + מודל קטן, עובד על כל מכונה):
  MHS_MODEL   = "small"  (CPU)  |  "ivrit-ai/whisper-large-v3-turbo-ct2"  (GPU, עברית מצוין)
  MHS_DEVICE  = "cpu"           |  "cuda"
  MHS_COMPUTE = "int8" (cpu)    |  "float16" (cuda)
  MHS_LANG = "he"  MHS_HOST = "localhost"  MHS_PORT = "9090"

הרצה:  python server.py
"""

import asyncio
import json
import os

import numpy as np
import websockets
from faster_whisper import WhisperModel

MODEL = os.environ.get("MHS_MODEL", "small")
DEVICE = os.environ.get("MHS_DEVICE", "cpu")
COMPUTE = os.environ.get("MHS_COMPUTE", "int8")
LANG = os.environ.get("MHS_LANG", "he")
HOST = os.environ.get("MHS_HOST", "localhost")
PORT = int(os.environ.get("MHS_PORT", "9090"))

SR = 16000              # sample rate (חוזה B)
PARTIAL_EVERY = 1.0     # כל כמה שניות אודיו חדש לשלוח partial
SILENCE_RMS = 0.005     # סף שקט (RMS על float32 [-1,1])
SILENCE_HANG = 0.8      # כמה שניות שקט מסיימות מבע → final
MIN_FINAL_SEC = 0.3     # לא לסיים מבע קצר מדי

print(f"[stt] loading model={MODEL} device={DEVICE} compute={COMPUTE} ...")
model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE)
print("[stt] model ready")

# מודל faster-whisper יחיד משותף לכל החיבורים. הוא אינו thread-safe לקריאות
# תמלול מקבילות, ולכן נועלים — משתמש אחד מתמלל בכל רגע, השאר ממתינים מעט.
# מספיק לקבוצת לימוד; לעומס גדול צריך כמה workers/GPU (ראה DEPLOY.md).
model_lock = asyncio.Lock()


def transcribe(buf: np.ndarray) -> str:
    """מתמלל buffer float32. vad_filter=True מפעיל Silero VAD (מונע הזיות בשקט)."""
    segments, _ = model.transcribe(buf, language=LANG, vad_filter=True, beam_size=1)
    return "".join(seg.text for seg in segments).strip()


async def handle(ws, *_):
    # הודעת config ראשונה (חוזה B) — נקרא ומתעלם, הפרמטרים קבועים אצלנו
    try:
        await ws.recv()
    except Exception:  # noqa: BLE001
        return

    loop = asyncio.get_event_loop()
    buf = np.zeros(0, dtype=np.float32)
    since_partial = 0   # דגימות שנצברו מאז ה-partial האחרון
    silence_run = 0     # דגימות שקט רצופות

    try:
        async for msg in ws:
            if not isinstance(msg, (bytes, bytearray)):
                continue
            # Int16 PCM little-endian → float32 [-1,1]
            pcm = np.frombuffer(msg, dtype=np.int16).astype(np.float32) / 32768.0
            if pcm.size == 0:
                continue
            buf = np.concatenate([buf, pcm])
            since_partial += pcm.size

            rms = float(np.sqrt(np.mean(pcm ** 2)))
            silence_run = silence_run + pcm.size if rms < SILENCE_RMS else 0

            # partial — תוך כדי דיבור
            if since_partial >= PARTIAL_EVERY * SR:
                since_partial = 0
                async with model_lock:
                    text = await loop.run_in_executor(None, transcribe, buf)
                if text:
                    await ws.send(json.dumps(
                        {"type": "partial", "text": text, "is_final": False},
                        ensure_ascii=False,
                    ))

            # final — אחרי שקט מספק בסוף מבע
            if silence_run >= SILENCE_HANG * SR and buf.size > MIN_FINAL_SEC * SR:
                async with model_lock:
                    text = await loop.run_in_executor(None, transcribe, buf)
                buf = np.zeros(0, dtype=np.float32)
                since_partial = 0
                silence_run = 0
                if text:
                    await ws.send(json.dumps(
                        {"type": "final", "text": text, "is_final": True},
                        ensure_ascii=False,
                    ))
    except websockets.ConnectionClosed:
        pass


async def main():
    print(f"[stt] ws://{HOST}:{PORT} ready (contract B)")
    async with websockets.serve(handle, HOST, PORT, max_size=None):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
