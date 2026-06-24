"""test_wav_client.py — מזרים קובץ WAV (16kHz mono 16-bit) לשרת, כמו התוסף.

מאמת תמלול אמיתי מקצה-לקצה. שולח frames של ~100ms ואז שקט (כדי לעורר final),
ומדפיס כל partial/final שמתקבל.

הרצה:  python test_wav_client.py [URI] [WAV]
דוגמה: python test_wav_client.py ws://localhost:9090 test_speech.wav
"""

import asyncio
import json
import sys
import wave

import websockets

URI = sys.argv[1] if len(sys.argv) > 1 else "ws://localhost:9090"
WAV = sys.argv[2] if len(sys.argv) > 2 else "test_speech.wav"
FRAME = 1600  # ~100ms ב-16kHz


async def main():
    wf = wave.open(WAV, "rb")
    assert wf.getframerate() == 16000 and wf.getnchannels() == 1 and wf.getsampwidth() == 2, \
        "WAV חייב להיות 16kHz mono 16-bit"

    async with websockets.connect(URI, max_size=None) as ws:
        await ws.send(json.dumps({"language": "he", "sample_rate": 16000, "encoding": "pcm_s16le"}))
        print(f"[wav] streaming {WAV} -> {URI}")

        async def sender():
            while True:
                frames = wf.readframes(FRAME)
                if not frames:
                    break
                await ws.send(frames)
                await asyncio.sleep(0.1)  # קצב real-time
            # שקט בסוף כדי לעורר final
            for _ in range(15):
                await ws.send(b"\x00" * (FRAME * 2))
                await asyncio.sleep(0.1)
            await asyncio.sleep(2.0)
            await ws.close()

        async def receiver():
            try:
                async for m in ws:
                    print("[wav] recv:", m)
            except websockets.ConnectionClosed:
                pass

        await asyncio.gather(sender(), receiver())
    print("[wav] done")


if __name__ == "__main__":
    asyncio.run(main())
