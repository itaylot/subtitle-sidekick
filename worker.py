"""worker.py — runs ONE local transcription in its own OS process.

Why a separate process: faster-whisper does its heavy work in C (model load, VAD over the whole
file, inference) which a Python thread can't interrupt. Running it as a child process means the
parent (app.py) can cancel by simply killing this process — instantly, at any stage.

Protocol with the parent:
  • stdout: one JSON line per message, prefixed by a single char —
      P<json>  progress dict   D<json>  final result dict   E<json>  error string
  • stdin : control commands, one per line — "pause" / "resume"
Cancel is not a command; the parent just terminates this process.
"""

import os
import sys
import json
import time
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import engine

_paused = threading.Event()


def _stdin_reader():
    for line in sys.stdin:
        cmd = line.strip()
        if cmd == "pause":
            _paused.set()
        elif cmd == "resume":
            _paused.clear()


def _emit(kind, obj):
    sys.stdout.write(kind + json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _pause_check():
    """Block while paused; return seconds spent paused (so ETA can discount it)."""
    if not _paused.is_set():
        return 0.0
    _emit("P", {"stage": "transcribe", "paused": True})
    t = time.time()
    while _paused.is_set():
        time.sleep(0.1)
    return time.time() - t


def main():
    video = sys.argv[1]
    fast = len(sys.argv) > 2 and sys.argv[2] == "1"
    threading.Thread(target=_stdin_reader, daemon=True).start()
    try:
        res = engine.transcribe(video, fast=fast,
                                on_progress=lambda p: _emit("P", p),
                                pause_check=_pause_check)
        _emit("D", res)
    except Exception as e:  # noqa: BLE001 — surfaced to the parent as an error message
        _emit("E", str(e))


if __name__ == "__main__":
    main()
