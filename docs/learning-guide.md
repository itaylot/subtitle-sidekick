# Learning Guide — Understanding Subtitle Sidekick

A guided path to *learn* this project later: the architecture, the code, and — most importantly —
**why** each decision was made. Written for future-you (or an interviewer conversation). Not a plan to
execute; a map to study. Work through it top to bottom when you're ready.

---

## 1. The one-paragraph mental model

A **pywebview desktop app**: a native window that renders a plain HTML/CSS/JS UI (`ui/`) and talks to
Python through a bridge object. The UI never does heavy work — it sends requests over the bridge to
`app.py`, which delegates to `engine.py` (the transcription + library logic). Long transcriptions run
in a **separate `worker.py` process** so they can be cancelled/paused. Audio is transcribed either
**locally** (faster-whisper / ivrit-ai model) or on the user's **own RunPod GPU server**
(`cloud_backend.py`). User data lives in `~/Videos/Subtitle Sidekick`, *outside* the repo.

If you understand that paragraph, everything else is detail.

---

## 2. The layers (and which file owns each)

```
┌─────────────────────────────────────────────────────────┐
│  UI  — ui/index.html, ui/app.js, ui/style.css            │  vanilla JS, RTL Hebrew, no build step
│  (screens: home · open · processing · player · guide)    │
└───────────────┬─────────────────────────────────────────┘
                │  window.pywebview.api.*   (the bridge)
┌───────────────▼─────────────────────────────────────────┐
│  app.py  — Api class: one method per UI action           │  launcher + bridge + internal media server
│            + a tiny HTTP media server (Range requests)   │
└───────────────┬─────────────────────────────────────────┘
                │  engine.*  /  spawns worker.py
┌───────────────▼─────────────────────────────────────────┐
│  engine.py  — transcribe, library, dictionary, export,   │  all real logic, UI-agnostic
│               SRT/VTT, course management                 │
│  worker.py  — runs one local transcription in a subprocess (cancel/pause)   │
│  cloud_backend.py  — RunPod submit/poll, chunking, billing │
└───────────────┬─────────────────────────────────────────┘
                │
        local model (faster-whisper)   |   RunPod Serverless (runpod_server/handler.py)
```

**Reading order for the first pass:** `app.py` (see the Api surface) → `engine.py` (top to bottom) →
`ui/app.js` (follow one flow) → `cloud_backend.py` → `runpod_server/handler.py`.

---

## 3. Trace one flow end-to-end (do this — it's the fastest way to learn)

**"User drags a file and gets subtitles":**

1. `ui/app.js` `enqueueFiles()` → builds a queue item (course + language) → `processNext()`.
2. `processNext()` resolves cloud config, then calls `window.pywebview.api.start(path, fast, course, cloudCfg, lang)`.
3. `app.py` `Api.start()` → `_run_local` (spawns `worker.py` as a subprocess) or `_run_cloud`.
4. `worker.py` calls `engine.transcribe(...)`, which streams progress via a callback.
5. Progress crosses the bridge back to JS `window.onProgress(...)` → updates the bar/steps/tips.
6. `engine.transcribe` splits Whisper segments into ≤6-word cues (`_split_words`/`_split_text`),
   applies the correction dictionary, writes the SRT, builds the viewer HTML.
7. Done → `window.onDone(res)` → the lecture is registered in `library.json`, the "▶ play" button appears.
8. Player: `watchItem()` sets `video.src` (from the internal media server), builds a WebVTT `<track>`,
   renders the editable transcript.

Put a mental breakpoint at each hop. Once you can narrate this without the code, you know the app.

---

## 4. The architecture decisions worth understanding (the interview gold)

These are the "why," not the "what." Each is a real judgment call with a tradeoff — exactly what an
interviewer probes. Several are already written up in the README's *Engineering challenges* section;
this is the study version.

- **pywebview + vanilla JS, no build step.** Why: a small single-purpose desktop app doesn't need
  React/bundlers; HTML/CSS/JS renders instantly, ships as plain files, and stays hackable. Tradeoff:
  manual DOM code (`renderDrawer`, etc.) instead of a component framework. *When would you switch?* When
  state/UI complexity outgrows hand-rolled rendering.

- **Native WebVTT `<track>` for captions (not a custom overlay div).** Why: the browser renders `<track>`
  captions itself, so they stay visible in the *native* fullscreen (which only shows the `<video>`). A
  hand-rolled overlay `div` vanished in fullscreen. Lesson: prefer the platform feature over re-implementing it.

- **A separate `worker.py` subprocess for local transcription.** Why: faster-whisper's C-level work can't
  be interrupted from within the same process, so *cancel* = kill the subprocess. Pause is cooperative
  (a callback that blocks between segments). Tradeoff: IPC/serialization overhead vs. real cancellation.

- **An internal Python media server with HTTP Range support.** Why: pywebview serves the UI over `http`,
  and browsers block `file://` media from an `http` origin (black screen, frozen at 0:00). Fix: a tiny
  local server streams the video with Range requests (so seeking works).

- **Silence-aligned chunking for the RunPod 10 MiB request limit.** Why: high-quality lecture audio
  doesn't fit one request. Split on silence, transcribe chunks in parallel, restitch with per-chunk time
  offsets. This is the most "systems" part of the codebase — study `cloud_backend.py`.

- **Local-first, no shared server, personal RunPod endpoint.** Why: privacy is the product's promise —
  audio never leaves the machine unless the user opts into *their own* cloud endpoint. No credentials are
  embedded; the prebuilt image is just the transcription code on the user's infrastructure. This constraint
  shaped many decisions — understand it deeply, it's the project's spine.

- **User data outside the repo (`~/Videos/Subtitle Sidekick`).** Why: updating the app (overwriting the
  code folder) can never touch the user's library/settings. This is what makes `update.bat` safe.

- **Course identity by display-name string (and the bug it caused).** A cautionary tale: courses were
  identified by their name string, and the move-menu built `<option value>` via string concat with an
  escaper that didn't escape `"`. A course named `חדו"א` truncated → phantom courses + wrong moves. Fix:
  build options via DOM APIs, self-heal the library on load, and repair the corrupted data once. Lesson:
  **string identity + manual HTML building = injection/truncation bugs.** Great story for "tell me about a
  bug you found."

- **Whole-word dictionary replacement.** Why: naive substring replace would corrupt valid text (replacing
  "network" inside "networking"). Using `\b…\b` (Unicode-aware in Python 3, incl. Hebrew) keeps it safe.

- **Hardware-aware model default.** Benchmarking on real CPU-only hardware showed a 7–8× gap between the
  "accurate" and "fast" models, which justified the fast/Lite fallback instead of a guessed default.

---

## 5. Files, one line each (the map)

| File | What it owns |
|---|---|
| `app.py` | Window launch, the `Api` bridge (one method per UI action), internal media server, update check |
| `engine.py` | Transcription, cue splitting, SRT/VTT, library + course management, correction dictionary, export |
| `worker.py` | Runs one local transcription in a subprocess (enables cancel/pause) |
| `cloud_backend.py` | RunPod submit/poll, silence-aligned chunking, cost/billing estimate |
| `runpod_server/handler.py` | Server-side transcription (Hebrew model + `large-v3` for English/auto) |
| `ui/index.html` | All screens + the SVG icon sprite + drawers/modals markup |
| `ui/app.js` | All UI logic: queue, player, library rendering, dictionary, updates, demo bridge |
| `ui/style.css` | Design tokens (light/dark), all component styling |
| `ui/demo.html` | Self-playing tour that drives the real UI (for screen recording) |
| `tools/` | CLI transcription, standalone player, desktop shortcut, protocol registration |

---

## 6. Study questions (test yourself — good oral-exam / interview prep)

1. Why does cancelling a transcription require a subprocess? What breaks if it runs in-process?
2. Why do native `<track>` captions survive fullscreen when a custom overlay div doesn't?
3. Walk through what happens to a 90-minute lecture's audio in cloud mode (hint: 10 MiB limit).
4. Where does user data live, and why is that the reason updates are safe?
5. What exactly caused the `חדו"א` course bug, and what are the *two* fixes (prevent + repair)?
6. Why `\b…\b` in the dictionary, and why does it work for Hebrew in Python but not naively in JS?
7. How does the app stay private by default while still offering GPU speed?
8. Why vanilla JS with no build step — and when would that choice stop paying off?

If you can answer these from memory, you understand the project at the level that matters.

---

## 7. Suggested learning path (order)

1. Read this doc + the README's *Engineering challenges* section.
2. Do the **§3 end-to-end trace** with the code open.
3. Read `engine.py` top-to-bottom (it's the heart, and UI-agnostic).
4. Read `cloud_backend.py` for the chunking/billing systems part.
5. Skim `ui/app.js` following the player + library rendering.
6. Answer the **§6 study questions** out loud.
