# Distribution & Polish Plan — Subtitle Sidekick

Working checklist for turning the app into something clean enough to hand to an interviewer / share publicly.
Not for today — this is the backlog we build against. Ordered by priority; check items off as they land.

**Guiding constraints (do not break):** no embedded endpoint/API key, no shared server (each user runs their own RunPod), local mode stays the private default, commits without `Co-Authored-By`.

---

## Phase 0 — Decide the distribution format (blocks everything else)

The single biggest friction today: **the app requires the user to install Python 3.12 first.** For an interviewer who won't run it anyway, that's fine; for a real "download and it works" experience, it isn't. Pick one before polishing:

- [ ] **Option A — keep ZIP + `run.bat`** (current). Zero build tooling. Cost: user must install Python 3.12. Best if the audience is technical / it's a portfolio piece people *read* more than *run*.
- [ ] **Option B — bundle a standalone `.exe`** via PyInstaller or Nuitka. No Python needed on the user's machine. Cost: large artifact (bundles Python + torch + CUDA libs → hundreds of MB), build complexity, antivirus false positives are common with PyInstaller.
- [ ] **Option C — Inno Setup installer** wrapping either A or B. Most "professional" feel (real installer, Start-menu entry, uninstaller). Cost: extra tooling to maintain.

**Recommendation:** For a portfolio/interview context, **A + a great README + a demo video** is the highest polish-per-effort. Revisit B/C only if you want real non-technical users. Decide here, then the rest of the plan assumes it.

---

## Phase 1 — README polish (highest visible impact)

The README is what interviewers actually see. Current state is solid English prose; make it *look* like a real product page.

- [ ] **Hero visual at the top** — a screenshot or the demo GIF right under the title (people decide in 3 seconds). Export from `ui/demo.html`.
- [ ] **Demo GIF/video** — record `ui/demo.html` with Cap/FocuSee (gentle zoom, cursor highlight), export a short (~20–30s) loop, embed near the top. This is the single most impressive addition.
- [ ] **Screenshot gallery** — 3–4 stills: home dashboard (light + dark), the player with Hebrew captions, the processing screen. A small table or `<p align="center">` row.
- [ ] **"Why I built this" paragraph** — one honest paragraph on the problem (Hebrew lecture transcription is bad/expensive) and the constraint (private, local-first, no shared server). Interviewers care about *judgment*, not just features.
- [ ] **Tech-stack line/badges** — Python · pywebview · faster-whisper / ivrit-ai · RunPod Serverless · vanilla JS (no build step). Make the existing badges accurate.
- [ ] **Architecture diagram** — a simple box diagram (UI ↔ Python bridge ↔ engine/worker ↔ local model | cloud backend → RunPod). Even a clean ASCII/mermaid one reads as senior.
- [ ] **Trim length** — the cloud-setup appendix is long; keep it collapsed (`<details>`, already done) and make sure the *first screen* of the README is features + visuals, not setup.
- [ ] **Consistent voice** — pass it through once for tone; make sure nothing reads as machine-generated.

---

## Phase 2 — Repo hygiene (cheap, makes it look maintained)

- [ ] **Add a `LICENSE`** — MIT is the usual choice for a portfolio project. Add the file + a badge.
- [ ] **Model/tool attribution** — short "Credits & licenses" note: ivrit-ai Whisper model, OpenAI Whisper (`large-v3`/`small`), faster-whisper, yt-dlp. Link them.
- [ ] **`.gitignore` audit** — confirm `.venv/`, `crash.log`, `__pycache__/`, `*.backup-*.json`, any local `library.json` are ignored. (`.claude/` already is.)
- [ ] **Pin `requirements.txt`** — pin versions (or at least the majors) so a fresh install doesn't break on an upstream change. Currently unpinned.
- [ ] **Remove dead code** — e.g. unused `.appic` CSS (logo was removed), the `Frank Ruhl Libre` font if it's no longer referenced anywhere, any other leftovers. Run a quick ponytail-audit pass.
- [ ] **Secret scan** — confirm no endpoint/API key ever got committed (grep history for `runpod`, `api_key`, tokens).
- [ ] **Repo description + topics** on GitHub (whisper, hebrew, transcription, subtitles, desktop, pywebview) — cheap SEO/discoverability.

---

## Phase 3 — Robustness before anyone else runs it

- [ ] **Clean-machine smoke test** — run the whole flow on a fresh Windows user/VM with only Python 3.12: install → first-run model download → transcribe a short clip → player → export. This surfaces path/permission/encoding bugs the dev machine hides.
- [ ] **No-GPU path** — confirm CPU-only transcription works and the "Lite" framing is honest about speed.
- [ ] **First-run messaging** — the ~1.5GB model download is the scariest moment; make sure the UI clearly says "one-time download, this is the long part" (already partly there).
- [ ] **Error surfaces** — Python missing (run.bat opens the download page ✓), disk full, model download interrupted, corrupt SRT. Make sure none of these hard-crash silently (crash.log exists — verify it captures them).
- [ ] **OneDrive path gotcha** — the project sometimes lives under OneDrive; the Docker build note already warns about placeholder files. Confirm the *app itself* runs fine from a OneDrive folder.
- [ ] **Update flow live test** — bump `version.txt`, push, then actually run Settings → Check for updates → Update now end-to-end on this machine (you're the only user, so it's safe to dogfood).

---

## Phase 4 — Release process (do once, then it's repeatable)

- [ ] **Adopt semantic-ish versioning** in `version.txt` (`MAJOR.MINOR.PATCH`). Bump it in the *same commit* as user-facing changes.
- [ ] **GitHub Releases** — tag releases (`v1.1.0`), write a short changelog per release. The in-app updater currently tracks `main`'s `version.txt`; decide whether it should track releases instead (more stable) — a small change to the raw-file URL / API call.
- [ ] **CHANGELOG.md** — even a terse one; interviewers read it as a signal of discipline.
- [ ] **Decide `:latest` vs pinned Docker tags** for the server image (already noted in README) — recommend pinning (`:v2`) so existing endpoints don't silently change.

---

## Phase 5 — Nice-to-have (only if time/energy)

- [ ] Social-preview image (GitHub repo → Settings → Social preview) — the app card renders nicely on shared links.
- [ ] A 60-second narrated walkthrough video (Loom-style) for the README, beyond the silent demo.
- [ ] Per-course correction dictionary (currently global-only — deliberately deferred; the data model leaves room for it).
- [ ] Keyboard shortcuts cheatsheet in the guide.

---

## Things to remember during the process (personal notes)

Easy to forget, costly if missed:

- [ ] **Bump `version.txt` in the same commit** as any user-facing change, or the in-app updater won't notice a new version.
- [ ] **Never commit secrets** — the RunPod endpoint/API key live only in `settings.json` under `Videos\Subtitle Sidekick` (outside the repo). Double-check before every push that nothing leaked into code or a test file.
- [ ] **User data lives outside the repo** (`~/Videos/Subtitle Sidekick`: `library.json`, `settings.json`, `queue.json`, `dictionary.json`, video files). This is *why* updates are safe — don't ever move data back into the repo folder.
- [ ] **Back up `library.json` before any manual edit** (a timestamped copy already sits next to it from the last repair).
- [ ] **Dogfood the update flow** — you're the only user, so bump the version, push, and actually run Settings → Check for updates → Update now to confirm `update.bat` works end-to-end.
- [ ] **Docker + OneDrive gotcha** — if the project is under OneDrive, `docker build` can fail on cloud-placeholder files (`invalid file request Dockerfile`). Build `runpod_server` from a non-OneDrive path (e.g. `C:\runpod_server`).
- [ ] **RunPod endpoint settings** — Max Workers = 4 (parallel chunk transcription), Min Workers = 0 (scale-to-zero, no idle cost). The image bundles both models (Hebrew + `large-v3`).
- [ ] **First-run model download (~1.5 GB)** is the scariest moment for a new user — keep the "one-time, this is the long part" messaging prominent.
- [ ] **Pin Docker tags** (`:v2`, not `:latest`) so existing endpoints don't silently change when you rebuild.
- [ ] **`.claude/` is gitignored** — launch.json and local tooling don't travel with the repo (fine, just remember it).

## Suggested order of execution (when you do sit down for it)

1. **Phase 0 decision** (5 min, unblocks the rest).
2. **Phase 1 README + demo recording** — biggest visible payoff.
3. **Phase 2 hygiene** — an afternoon, mostly mechanical.
4. **Phase 3 clean-machine test** — do this before you share the link with anyone.
5. **Phase 4 release process** — once, then it's muscle memory.
6. Phase 5 as bonus.
