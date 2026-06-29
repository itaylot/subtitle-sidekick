"""benchmark.py — measure transcription time on a fixed clip to evaluate setting changes (cpu_threads, VAD).

Usage:
  python tools/benchmark.py "10min_clip.mp3"
  python tools/benchmark.py "10min_clip.mp3" --threads 4 --silence 700

Run several times with different values on the same file and compare "real_time_factor".
"""

import os
import sys
import time
import argparse

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from faster_whisper import WhisperModel

import engine


def main():
    p = argparse.ArgumentParser()
    p.add_argument("src", help="video/audio file to test")
    p.add_argument("--threads", type=int, default=engine.CPU_THREADS, help="cpu_threads")
    p.add_argument("--silence", type=int, default=500, help="min_silence_duration_ms for VAD")
    p.add_argument("--fast", action="store_true", help="use the fast model")
    args = p.parse_args()

    if not os.path.isfile(args.src):
        print(f"קובץ לא נמצא: {args.src}")
        sys.exit(1)

    name = engine.MODEL_FAST if args.fast else engine.MODEL_ACCURATE
    dev, ct = engine._resolve_device()

    print(f"model: {name} | device={dev} compute={ct} cpu_threads={args.threads} silence={args.silence}ms")
    t_load = time.time()
    model = WhisperModel(name, device=dev, compute_type=ct, cpu_threads=args.threads, num_workers=1)
    print(f"model load: {time.time() - t_load:.1f}s")

    t0 = time.time()
    segments, info = model.transcribe(
        args.src, language="he", vad_filter=True, beam_size=1,
        vad_parameters={"min_silence_duration_ms": args.silence})
    n = sum(1 for _ in segments)
    elapsed = time.time() - t0
    dur = getattr(info, "duration", 0) or 0
    rtf = elapsed / dur if dur else 0

    print(f"\nfile duration: {dur:.1f}s | transcription time: {elapsed:.1f}s | cues: {n}")
    print(f"real_time_factor (time/duration, lower=faster): {rtf:.2f}")


if __name__ == "__main__":
    main()
