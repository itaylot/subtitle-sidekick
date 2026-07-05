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
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

import engine

REQUEST_TIMEOUT = 30     # seconds — for each individual HTTP call (submit / poll), not the whole job
POLL_INTERVAL = 3        # seconds between status checks
MAX_WAIT = 3600          # seconds — give up after an hour (a stuck job, not a slow one)
MAX_PARALLEL = 4         # chunks sent at once — set RunPod Max Workers to match; extras queue server-side
DEFAULT_CALIB = 0.25     # seconds of GPU time per second of audio, until a real run calibrates it
COLD_START = 45          # seconds — rough first-worker wake/load, added to the initial estimate


SR = 16000               # whisper resamples to 16 kHz mono internally anyway
OPUS_BITRATE = 32000     # 32 kbps mono — transparent for speech; accuracy over file size
MAX_CHUNK_SEC = 1500     # 25 min/chunk → 32 kbps base64 stays well under RunPod's 10 MiB /run limit


def _decode_pcm(video_path):
    """Decode the video's audio to int16 mono 16 kHz PCM (one numpy array)."""
    import av
    import numpy as np

    resampler = av.AudioResampler(format="s16", layout="mono", rate=SR)
    parts = []
    with av.open(video_path) as c:
        stream = next(s for s in c.streams if s.type == "audio")
        for frame in c.decode(stream):
            for rf in resampler.resample(frame):
                parts.append(rf.to_ndarray().reshape(-1))
        for rf in resampler.resample(None):   # flush
            parts.append(rf.to_ndarray().reshape(-1))
    return np.concatenate(parts) if parts else np.zeros(0, dtype="int16")


def _split_indices(pcm, max_samples):
    """Split into (start, end) sample ranges ≤ max_samples, cutting at the quietest
    point near each boundary so we never slice through a spoken word."""
    import numpy as np

    n = len(pcm)
    if n <= max_samples:
        return [(0, n)]
    frame = SR // 20          # 50 ms granularity for the silence search
    band = 20 * SR            # look back up to 20 s for a quiet spot
    ranges, start = [], 0
    while start < n:
        if n - start <= max_samples:
            ranges.append((start, n))
            break
        target = start + max_samples
        lo = max(start + frame, target - band)
        window = np.abs(pcm[lo:target].astype("int32"))
        nf = len(window) // frame
        if nf:
            energies = window[:nf * frame].reshape(nf, frame).mean(axis=1)
            cut = lo + int(np.argmin(energies)) * frame
        else:
            cut = target
        if cut <= start:
            cut = target
        ranges.append((start, cut))
        start = cut
    return ranges


def _encode_b64(pcm_slice):
    """Encode an int16 mono PCM slice to Opus and return it base64-encoded."""
    import av
    import numpy as np

    fd, path = tempfile.mkstemp(suffix=".ogg")
    os.close(fd)
    try:
        with av.open(path, "w", format="ogg") as out:
            stream = out.add_stream("libopus", rate=SR)
            stream.bit_rate = OPUS_BITRATE
            stream.layout = "mono"
            step = SR // 50   # 20 ms frames — a size libopus accepts
            pts = 0
            for i in range(0, len(pcm_slice), step):
                block = pcm_slice[i:i + step]
                if len(block) < step:
                    block = np.pad(block, (0, step - len(block)))
                af = av.AudioFrame.from_ndarray(block.reshape(1, -1).astype("int16"),
                                                format="s16", layout="mono")
                af.sample_rate = SR
                af.pts = pts
                af.time_base = __import__("fractions").Fraction(1, SR)
                pts += step
                for pkt in stream.encode(af):
                    out.mux(pkt)
            for pkt in stream.encode(None):
                out.mux(pkt)
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode("ascii")
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


class Cancelled(Exception):
    """Raised when cancel_check() reports the user aborted the job."""


def _get_calib():
    """GPU-seconds per audio-second, learned from past runs (default until the first real run)."""
    try:
        c = (engine.load_settings().get("cloud") or {})
        v = float(c.get("calib_spa") or 0)
        return v if v > 0 else DEFAULT_CALIB
    except Exception:  # noqa: BLE001 — a missing/garbled setting must never block transcription
        return DEFAULT_CALIB


def _set_calib(spa):
    try:
        engine.save_settings({"cloud": {"calib_spa": round(spa, 4)}})
    except Exception:  # noqa: BLE001
        pass


def _billed_seconds(outputs):
    """(inference_seconds, billed_seconds) from RunPod chunk outputs (executionTime/delayTime in ms).

    RunPod bills for inference plus the cold-start spin-up. We sum every chunk's executionTime, then
    add the cold start ONCE as the largest delayTime seen — summing all delays would double-count the
    queue wait of chunks stacked behind a busy worker. An estimate, not RunPod-exact.
    ponytail: max(delayTime) approximates one cold start; refine only if billing drifts noticeably.
    """
    exec_sec, max_delay = 0.0, 0.0
    for o in outputs:
        exec_sec += float(o.get("executionTime") or 0) / 1000.0
        max_delay = max(max_delay, float(o.get("delayTime") or 0) / 1000.0)
    return exec_sec, exec_sec + max_delay


def transcribe_remote(video_path, endpoint_url, api_key, on_progress=None, cancel_check=None, language="he"):
    """Transcribe via a RunPod Serverless endpoint. Returns {srt, cues, viewer, count, video, seconds}.

    language: Whisper code sent to the server ("he"/"en"/...); "" or None means auto-detect.
    """
    if not endpoint_url:
        raise RuntimeError("לא הוגדרה כתובת שרת. פתחו את הגדרות השרת והזינו endpoint.")

    def emit(**kw):
        if on_progress:
            kw.setdefault("device", "cloud")
            on_progress(kw)

    abort = threading.Event()   # trips on cancel OR on the first chunk error, so siblings stop fast
    job_ids = []                # RunPod ids of submitted chunks — cancelled server-side on abort
    ids_lock = threading.Lock()

    def bail():
        if abort.is_set() or (cancel_check and cancel_check()):
            raise Cancelled()

    emit(stage="extract", percent=0, eta=None, elapsed=0, loading=True)
    try:
        pcm = _decode_pcm(video_path)
    except Exception as e:  # noqa: BLE001
        raise RuntimeError("חילוץ האודיו מהווידאו נכשל: " + str(e)) from e

    base = endpoint_url.rstrip("/")
    headers = {"Authorization": "Bearer " + (api_key or ""), "Content-Type": "application/json"}

    # high-quality audio rarely fits RunPod's 10 MiB /run limit in one shot, so send it in
    # silence-aligned chunks and re-stitch with a per-chunk time offset. Chunks are independent,
    # so we run up to MAX_PARALLEL at once and merge by offset (completion order doesn't matter).
    chunks = _split_indices(pcm, MAX_CHUNK_SEC * SR)
    total = len(chunks)
    audio_sec = len(pcm) / SR
    emit(stage="extract", percent=100, eta=None, elapsed=0)

    # initial estimate from the calibration learned on past runs, so the bar isn't blank up front
    calib = _get_calib()
    workers = min(MAX_PARALLEL, total)
    init_eta = COLD_START + (audio_sec * calib) / max(workers, 1)
    t0 = time.time()
    emit(stage="transcribe", percent=0, eta=init_eta, elapsed=0, chunk=0, chunks=total)

    def work(start, end):
        bail()
        job_id = _submit(base, headers, _encode_b64(pcm[start:end]), language)
        with ids_lock:
            job_ids.append(job_id)
        return _poll(base, headers, job_id, lambda **k: None, bail)

    results = [None] * total
    done = 0
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as ex:
        futs = {ex.submit(work, s, e): (i, s) for i, (s, e) in enumerate(chunks)}
        try:
            for fut in as_completed(futs):
                idx, start = futs[fut]
                results[idx] = (start / SR, fut.result())   # may raise Cancelled / RuntimeError
                done += 1
                elapsed = time.time() - t0
                eta = elapsed * (total - done) / done if done else None
                emit(stage="transcribe", percent=int(done / total * 100), eta=eta,
                     elapsed=elapsed, chunk=done, chunks=total)
        except BaseException:
            abort.set()          # let the other in-flight polls unwind instead of running to MAX_WAIT
            with ids_lock:
                pending = list(job_ids)
            _cancel_jobs(base, headers, pending)   # stop RunPod billing for jobs still running server-side
            raise

    cues = []
    for offset, output in results:
        for s in (output.get("segments") or []):
            if s.get("text", "").strip():
                cues.append({"start": round(s["start"] + offset, 3),
                             "end": round(s["end"] + offset, 3),
                             "text": s["text"].strip()})
    exec_sec, seconds = _billed_seconds(output for _, output in results)

    if audio_sec > 0 and exec_sec > 0:
        _set_calib(exec_sec / audio_sec)   # calibrate on pure inference time, excluding the cold start
    emit(stage="transcribe", percent=100, eta=0, elapsed=time.time() - t0)
    srt = os.path.splitext(video_path)[0] + ".srt"
    engine.write_srt(srt, cues)
    emit(stage="sync", percent=99, eta=0, elapsed=0)
    viewer = engine.make_viewer(video_path, cues)

    return {"srt": srt, "cues": cues, "viewer": viewer, "count": len(cues),
            "video": video_path, "seconds": seconds}


def _submit(base, headers, audio_b64, language="he"):
    """POST /run — starts the job asynchronously, returns its id."""
    body = {"input": {"audio_b64": audio_b64, "language": language or "", "beam_size": 5}}
    try:
        resp = requests.post(base + "/run", headers=headers, json=body, timeout=REQUEST_TIMEOUT)
    except requests.exceptions.Timeout as e:
        raise RuntimeError("השרת לא הגיב בזמן (timeout) בעת שליחת הבקשה.") from e
    except requests.exceptions.ConnectionError as e:
        raise RuntimeError("לא ניתן להתחבר לשרת — בדקו את כתובת ה-endpoint וזמינות השרת.") from e

    if resp.status_code == 401:
        raise RuntimeError("מפתח ה-API שגוי או לא תקין.")
    if resp.status_code != 200:
        raise RuntimeError(f"השרת החזיר שגיאה (קוד {resp.status_code}): {resp.text[:300]}")
    try:
        payload = resp.json()
    except ValueError as e:
        raise RuntimeError("תשובת השרת אינה JSON תקין.") from e

    job_id = payload.get("id")
    if not job_id:
        raise RuntimeError("השרת לא החזיר מזהה עבודה (id).")
    return job_id


def _cancel_jobs(base, headers, job_ids):
    """Fire-and-forget POST /cancel/<id> for each submitted chunk so a cancelled/failed run stops
    billing on RunPod instead of finishing in the background. Best-effort — errors are ignored."""
    for jid in job_ids:
        try:
            requests.post(base + "/cancel/" + jid, headers=headers, timeout=10)
        except Exception:  # noqa: BLE001 — cancellation is best-effort; a stuck job is not fatal here
            pass


def _poll(base, headers, job_id, emit, bail=None):
    """GET /status/<id> repeatedly until COMPLETED/FAILED. Returns the job's `output` dict."""
    t0 = time.time()
    while True:
        if bail:
            bail()   # raises Cancelled if the user aborted — stops waiting on the server
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
            output["executionTime"] = payload.get("executionTime")  # RunPod puts these at the top level
            output["delayTime"] = payload.get("delayTime")           # queue + cold-start spin-up (ms)
            if not output.get("ok", True):
                raise RuntimeError(output.get("error") or "התמלול בשרת נכשל.")
            return output
        if status in ("FAILED", "CANCELLED", "TIMED_OUT"):
            err = (payload.get("error") or status)
            raise RuntimeError(f"התמלול בשרת נכשל: {err}")
        # IN_QUEUE / IN_PROGRESS — keep polling


if __name__ == "__main__":
    # self-check for the billing math: two chunks on one worker — sum the inference, add the cold
    # start (largest delay) once; don't double-count the second chunk's queue wait.
    outs = [{"executionTime": 60000, "delayTime": 45000},   # chunk 1: 60s run, 45s cold start
            {"executionTime": 40000, "delayTime": 30000}]   # chunk 2: 40s run, 30s queued behind #1
    inf, billed = _billed_seconds(outs)
    assert inf == 100.0, inf                 # 60 + 40 inference seconds
    assert billed == 145.0, billed           # 100 inference + 45 cold start (NOT + 30)
    assert _billed_seconds([]) == (0.0, 0.0)
    print("billing self-check OK")
