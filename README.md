<p align="center"><img src="ui/icons/app.png" width="84" alt="Subtitle Sidekick" /></p>

# 🎬 Subtitle Sidekick — lecture transcription & synced subtitles

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.12-blue" alt="Python 3.12" />
  <img src="https://img.shields.io/badge/Whisper-ivrit--ai-c56a43" alt="ivrit-ai Whisper" />
  <img src="https://img.shields.io/badge/Local--first-privacy-5f9e7a" alt="Local-first" />
  <img src="https://img.shields.io/badge/Windows-desktop-c59a3f" alt="Windows desktop" />
</p>

*A local-first desktop app that transcribes recorded lectures into perfectly time-synced subtitles — free, private, and account-free. Runs entirely on your machine by default, with an optional personal GPU-cloud mode for speed.*

Built primarily for Hebrew lectures (using a Hebrew-specialized Whisper model), with English and auto-detect support. Point it at a recorded lecture — a local file or a link — and get an interactive player with searchable, editable, exportable subtitles.

---

## Table of contents

- [Highlights](#-highlights)
- [Installation](#-installation-one-time)
- [How to use](#-how-to-use)
- [Fast cloud mode (optional)](#-fast-cloud-mode-optional)
- [Privacy](#-privacy)
- [Engineering challenges solved](#️-engineering-challenges-solved)
- [Advanced — command line](#advanced--command-line)
- [Project structure](#-project-structure)

---

## ⭐ Highlights

- 🏠 **Home dashboard** — prominent "New transcription" action, "Resume where you left off," at-a-glance stat widgets, and recent courses.
- 🌍 **Language choice** — Hebrew (specialized model), English, or auto-detect, chosen per lecture.
- 📚 **Course library** — every lecture organized by course, with a per-lecture action menu.
- ⬇️ **Download from a link** (YouTube / Moodle) — flows straight into the transcription queue.
- 🗂️ **Transcription queue** — drag in several files at once; they transcribe one-by-one in the background.
- ⚡ **Automatic GPU detection** — NVIDIA is used automatically when present; a "fast" toggle drops to a lighter model on CPU-only machines.
- 🔎 **Subtitle search** with direct jump-to-moment.
- ✏️ **Built-in subtitle editor** for fixing transcription mistakes.
- 📄 **Export** transcripts to TXT / Word.
- ⛶ **Full player**: fullscreen, 10-second skip, 0.5x–2x playback speed, and subtitle size/background controls (🅰).
- 📖 **Built-in usage guide** — a ❓ button in the top bar opens an in-app guide.
- 🔒 **Local by default** — no cloud, no account; audio never leaves your machine unless you explicitly opt into cloud mode.

---

## 📥 Installation (one-time)

1. **Install Python 3.12** — [download here](https://www.python.org/downloads/release/python-3120/). During setup, check ✅ **"Add Python to PATH."**
2. **Download the project** — green **Code** button → **Download ZIP** → extract to a folder.
3. **Double-click `run.bat`** — it installs everything itself (a few minutes, once) and creates a **"Subtitle Sidekick"** desktop icon.

That's it. From then on, just double-click the desktop icon. **No command line required.**

> On first run, the Hebrew model (~1.5 GB) downloads automatically. If an NVIDIA GPU is present, the app detects and uses it (much faster).

---

## ⭐ How to use

1. **Get a lecture** — paste a direct link (YouTube / Moodle / any direct video link) and click **Download**, or download it yourself (e.g. with the Video DownloadHelper Chrome extension).
2. **Open the app** (desktop icon, or a `subsidekick://open` bookmark in Chrome) — it opens to the **home screen**.
3. From home: **New transcription** → **drag or pick** a file (several at once is fine — they enter a **queue** that transcribes sequentially). Before uploading you can choose a **course** and the **lecture language** (Hebrew / English / auto-detect) → **Create subtitles** → **▶ Watch with subtitles**.

Every transcribed lecture is automatically registered in the sidebar (☰), organized by course, with a per-lecture action menu (⋯): rename, move to another course, open in browser, remove.

> On a slow, GPU-less machine, the **"fast"** mode transcribes several times faster (a lighter model). A long lecture on CPU takes a while — you can let it run in the background (progress stays visible from every screen).

---

## ☁ Fast cloud mode (optional)

<details>
<summary>Transcribe through your own GPU server — very fast, but optional (click to expand)</summary>

The default is, and remains, **local** — no config, no account. If you want especially fast transcription, you can choose **"☁ GPU server (cloud)"** on the upload screen after setting up a personal RunPod endpoint (one-time, ~5 minutes — no Docker required).

Important: **this is not a shared server.** Each user has their own RunPod endpoint and API key, and audio is uploaded only to your own server — no endpoint or key is embedded in the app.

The recommended path uses a prebuilt, public image, so there's nothing to install or build. (For full control, there's a build-it-yourself appendix at the end.)

The image bundles **two models**: a Hebrew-specialized model and a general multilingual model for English / auto-detect — so cloud transcription works in every language Whisper supports, not just Hebrew.

### Prerequisites

- ☑ A [RunPod](https://www.runpod.io/) account with credit (even $5–10 is enough to start).

### Step 1 — RunPod API key

1. Sign in at [runpod.io](https://www.runpod.io/).
2. Side menu → **Settings** → **API Keys** tab → **+ Create API Key**.
3. Name it (e.g. `subtitle-sidekick`) → **Create**.
4. **Copy the key now** — it is shown only once.

### Step 2 — Create the endpoint with the prebuilt image

1. In RunPod: side menu → **Serverless** → **+ New Endpoint**.
2. Choose **Custom Source** (Docker image).
3. In the image field paste exactly: `itaylot/subtitle-sidekick-server:latest`
4. Pick a GPU — a cheap option is plenty (RTX A4000 or A5000); no powerful GPU is needed for transcription.
5. Set Workers: Min Workers = `0` (no charge when idle), Max Workers = `4` (enables parallel transcription of audio chunks — faster; `1` also works for frugal use).
6. Click **Create Endpoint**.
7. On the endpoint page, the **Endpoint ID** (an alphanumeric string) appears at the top — copy it.

### Step 3 — Enter the details in the app

In Subtitle Sidekick: open the sidebar (☰) → **⚙ Settings** → "Cloud server" section:
- **Server URL:** `https://api.runpod.ai/v2/ENDPOINT_ID` (replace `ENDPOINT_ID` with what you copied in step 2.7)
- **API key:** the key from step 1.4
- **GPU price per hour:** the price RunPod shows for your chosen GPU (for the estimated-cost display).
- **Save server settings.**

Done — from the next upload, choose **☁ GPU server (cloud)** in the transcription-mode menu. The API key is stored on your machine and doesn't need to be re-entered.

**Cost:** RunPod Serverless bills only for actual processing time (scale-to-zero — no charge when idle). The app shows a cumulative **estimated** cost based on the price-per-hour you entered; it's an estimate only — RunPod also bills for cold-start spin-up and rounding, so it may differ slightly from your actual invoice.

If the server is unconfigured, unavailable, or returns an error — a clear message is shown, and you can switch to local mode and continue without losing the file.

### Appendix — build your own image

<details>
<summary>For full control over the server code or a private image (click to expand)</summary>

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running, and a free [Docker Hub](https://hub.docker.com/) account.

> ⚠️ **If the project folder is under OneDrive**, Docker may fail to read cloud-placeholder files with an error like `invalid file request Dockerfile`. If that happens, copy the `runpod_server` folder somewhere outside OneDrive (e.g. `C:\runpod_server`) and build from there.

In a terminal, from the `runpod_server` folder:

```bash
docker login
docker build -t YOUR_DOCKERHUB_USERNAME/subtitle-sidekick-server:v1 .
docker push YOUR_DOCKERHUB_USERNAME/subtitle-sidekick-server:v1
```

Replace `YOUR_DOCKERHUB_USERNAME` with your Docker Hub username. The `build` step downloads the models (several GB) and bakes them into the image — this **takes 20–30 minutes**, one time. Then use the full name (`YOUR_DOCKERHUB_USERNAME/subtitle-sidekick-server:v1`) in step 2.3 above instead of the prebuilt image.

> 💡 Tagging a version (`:v1`, `:v2`) instead of `:latest` gives you control: a future image update won't reach existing endpoints until you point them at the new tag.

</details>

</details>

## 🔒 Privacy

Local mode (the default): everything runs on your machine — audio never leaves the computer and is never stored anywhere.

Server mode (optional, only when deliberately enabled): audio is uploaded only to the RunPod endpoint **you create on your own account**. The app ships with no server and no embedded credentials — the prebuilt image is just the transcription code, running on your own infrastructure.

---

## 🛠️ Engineering challenges solved

<details>
<summary>For readers interested in the engineering side (click to expand)</summary>

- **Infinite-recursion bug in pywebview:** exposing the window object (`Window`) on the API class used as the JS bridge caused pywebview to walk it recursively while building the bridge — random crashes/freezes, mostly while dragging the window. Traced by reading the library source, and fixed with the `_`-prefix attribute convention (which pywebview skips automatically).
- **`file://` video playback blocked:** pywebview serves the UI over a local HTTP server, and the browser blocks media loaded from `file://` when the origin is `http` (black screen, frozen at 0:00). The fix: a small internal Python media server with HTTP Range support (to allow seeking), streamed to JS via a dedicated URL.
- **Subtitles disappearing in fullscreen:** after switching to the native browser player, the hand-rolled subtitle overlay wasn't included in fullscreen (which only shows the `<video>` element). Solved by moving to a native WebVTT `<track>` — the browser renders captions itself and keeps them visible in every mode.
- **Benchmarking on real hardware (CPU-only, no supported GPU):** comparing the "accurate" vs. "fast" model on a 7.7-minute clip showed a 7–8×+ runtime gap, which drove a hardware-aware default instead of a generic assumption.
- **RunPod's 10 MiB request limit:** high-quality lecture audio doesn't fit in one request, so it's split into silence-aligned chunks, transcribed in parallel, and re-stitched with per-chunk time offsets — preserving accuracy while staying under the limit.

</details>

---

## Advanced — command line

<details>
<summary>Direct file → SRT transcription (for VLC or any player)</summary>

```bash
py -3.12 -m venv .venv && .venv\Scripts\activate    # macOS/Linux: python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python tools/transcribe_to_srt.py "lecture.mp4"      # produces lecture.srt
```
To watch: open the video in VLC (if the `.srt` sits next to the video with the same name, it loads automatically), or in [`tools/player.html`](tools/player.html).
</details>

---

## 📁 Project structure

```
app.py                      launches the pywebview window + Python bridge
engine.py                   transcription engine (faster-whisper / ivrit-ai) + export
worker.py                   runs a local transcription in a separate process (so it can be paused/cancelled)
cloud_backend.py            transcription via a personal GPU server (RunPod) — see fast cloud mode
ui/                         the user interface (HTML/CSS/JS + local fonts)
run.bat                     launcher (auto-install + desktop icon on first run)
requirements.txt            dependencies
tools/
  transcribe_to_srt.py      command-line transcription: file → SRT
  player.html               local player for watching with subtitles
  make_shortcut.py          creates the desktop icon
  register_protocol.py      registers subsidekick:// so a Chrome bookmark can open the app
runpod_server/              the server code (Docker image) for the optional fast cloud mode
  handler.py                the transcription function that runs on the server (Hebrew + general model for English)
  Dockerfile                builds the image (bakes the transcription models in)
```

---

<sub>Built as a student project with the help of <a href="https://claude.com/claude-code">Claude Code</a>.</sub>
