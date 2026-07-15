// app.js — UI ↔ Python bridge (pywebview): transcription queue, synced player, fullscreen.

// capture JS errors → crash.log for diagnostics
function _log(m) { try { window.pywebview.api.log(m); } catch (e) {} }
window.onerror = (m, s, l, c) => _log(`onerror: ${m} @${l}:${c}`);
window.addEventListener("unhandledrejection", (e) => _log("reject: " + e.reason));

const $ = (id) => document.getElementById(id);

// ── demo mode (index.html?demo): mock the Python bridge with canned data so the REAL UI runs
// standalone for a screen-recordable product tour. No effect on the normal app. ──
const DEMO = new URLSearchParams(location.search).has("demo");
if (DEMO) installDemoBridge();
function installDemoBridge() {
  const courses = ["הרצאות אורח", "מבוא לבינה מלאכותית", "אלגוריתמים"];
  // real excerpt from a transcribed lecture (TEDx — Yossi Yeshurun on decision-making),
  // re-based to start at t=0 so the demo's playFake loop can drive it from the beginning.
  const demoCues = [
    { start: 0.00, end: 1.76, text: "40 שנה אני לומד" },
    { start: 2.30, end: 3.38, text: "ומלמד קבלת החלטות." },
    { start: 4.26, end: 7.24, text: "האם יש לי איזה מסר שאני יכול לתת לאנשים שמקבלים החלטות?" },
    { start: 8.70, end: 10.68, text: "ויש לי שלושה מסרים, אני חושב." },
    { start: 11.86, end: 16.06, text: "הראשון זה לנסות להתעלם מאמונות טפלות" },
    { start: 16.96, end: 21.06, text: "כמו אסטרולוגיה ונומרולוגיה וגרפולוגיה" },
    { start: 21.72, end: 23.46, text: "וכל הקשקושים האלה," },
    { start: 24.04, end: 25.66, text: "ובאמת לחשוב בצורה יותר מדעית." },
  ];
  const lectures = [
    { video: "demo/tedx-yeshurun.mp4", srt: "demo/tedx-yeshurun.srt", course: "הרצאות אורח", title: "הרצאת TEDx — פרופ' יוסי יסעור: קבלת החלטות", added: 1782900000, viewed: false },
    { video: "demo/ai-03.mp4", srt: "demo/ai-03.srt", course: "מבוא לבינה מלאכותית", title: "AI — Lecture 3: Search", added: 1782700000, viewed: true },
    { video: "demo/algo-02.mp4", srt: "demo/algo-02.srt", course: "אלגוריתמים", title: "אלגוריתמים — שיעור 2", added: 1782600000, viewed: true },
  ];
  const settings = { transcription_mode: "cloud", transcription_language: "he", subtitle_size: "md",
    subtitle_bg: "dark", library_dir: "C:\\הרצאות",
    cloud: { endpoint_url: "https://api.runpod.ai/v2/demo", api_key: "demo", price_per_hour: 0.39, total_seconds: 5400, total_cost: 0.59 } };
  const course_meta = { "הרצאות אורח": { notes: "מרצה מומלץ — לבדוק אם יש עוד הרצאות שלו", tasks: [{ text: "לסכם את שלושת המסרים", done: false }, { text: "לצפות שוב בקטע ההסתברותי", done: true }] } };
  const demoResume = { last: "demo/tedx-yeshurun.mp4", positions: { "demo/tedx-yeshurun.mp4": { pos: 8.5, dur: 25.66 } } };
  const ok = () => Promise.resolve(true);
  window.__demoCues = demoCues;   // the demo controller animates player playback from these
  window.pywebview = { api: {
    log: () => {},
    get_settings: () => Promise.resolve(settings),
    save_settings: (d) => { if (d && d.cloud) Object.assign(settings.cloud, d.cloud); Object.assign(settings, d || {}); return Promise.resolve(settings); },
    library: () => Promise.resolve({ courses, lectures, course_meta }),
    load_queue: () => Promise.resolve([]), save_queue: ok,
    open_lecture: () => Promise.resolve({ video: "demo/tedx-yeshurun.mp4", cues: demoCues, srt: "demo/tedx-yeshurun.srt" }),
    media_url: () => Promise.resolve("demo/tedx.mp4"),   // real lecture clip (local-only, gitignored) so the demo player shows a real feed
    search: (q) => { q = (q || "").trim(); const hits = demoCues.filter((c) => c.text.includes(q));
      return Promise.resolve(q && hits.length ? [{ video: "demo/tedx-yeshurun.mp4", title: "הרצאת TEDx — פרופ' יוסי יסעור: קבלת החלטות", course: "הרצאות אורח", hits }] : []); },
    version: () => Promise.resolve("1.0.0"),
    check_update: () => Promise.resolve({ current: "1.0.0", latest: "1.0.0", update_available: false }),
    get_dictionary: () => Promise.resolve({ rules: [{ from: "פאי תורץ", to: "PyTorch" }, { from: "ניורל נטוורק", to: "Neural Network" }] }),
    save_dictionary: (r) => Promise.resolve({ rules: r }), reapply_dictionary: () => Promise.resolve(3),
    apply_dictionary_to_cues: (c) => Promise.resolve(c),
    set_viewed: (v, b) => { const l = lectures.find((x) => x.video === v); if (l) l.viewed = b; return ok(); },
    reorder_lectures: (course, videos) => {   // mirror the real reorder: re-slot this course's rows
      const idxs = lectures.map((l, i) => [l, i]).filter(([l]) => (l.course || "") === course).map(([, i]) => i);
      const ordered = videos.map((v) => lectures.find((l) => l.video === v)).filter(Boolean);
      idxs.forEach((slot, k) => { if (ordered[k]) lectures[slot] = ordered[k]; });
      return Promise.resolve({ courses, lectures, course_meta });
    },
    get_resume: () => Promise.resolve(demoResume),
    save_resume: (v, pos, dur) => { demoResume.positions[v] = { pos, dur }; demoResume.last = v; return Promise.resolve(demoResume); },
    save_course_meta: (name, meta) => { const c = course_meta[name] = course_meta[name] || { notes: "", tasks: [] };
      if (meta.icon != null) c.icon = meta.icon; if (meta.notes != null) c.notes = meta.notes; if (meta.tasks != null) c.tasks = meta.tasks;
      return Promise.resolve({ courses, lectures, course_meta }); },
    create_course: ok, set_lecture_course: ok, rename_lecture: ok, remove_lecture: ok, remove_course: ok,
    rename_course: ok, save_srt: ok, export: () => Promise.resolve("demo.txt"),
    export_lecture: (v, fmt) => Promise.resolve("demo — תמליל." + fmt),
    pick_file: () => Promise.resolve("C:\\הרצאות\\הרצאת TEDx — קבלת החלטות.mp4"),
    pick_folder: () => Promise.resolve(""),
    open_in_browser: ok, win_close: () => {}, win_minimize: () => {}, win_fullscreen: () => {},
    // simulate a transcription: stream progress then finish, driving the real processing screen
    start: (path) => {
      let p = 0;
      window.onProgress({ stage: "extract", percent: 100, device: "cloud" });
      const t = setInterval(() => {
        p += 10;                                          // deterministic ~4s run for the demo
        if (p >= 100) { clearInterval(t);
          window.onDone({ video: path, cues: demoCues, srt: "demo.srt", viewer: "demo.html", count: demoCues.length });
        } else { window.onProgress({ stage: "transcribe", percent: Math.round(p), eta: (100 - p) * 0.6, device: "cloud" }); }
      }, 420);
      return Promise.resolve(true);
    },
  } };
  try { localStorage.setItem("onboarded", "1"); localStorage.setItem("theme", "light"); } catch (e) {}
  setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 0);   // real app boots off this
}

// queue: each job { id, sourcePath, name, courseName, status:'queued'|'running'|'done'|'failed', error, createdAt, res }
// JS owns the queue state; Python is a worker + persists it (engine.save_queue/load_queue).
let queue = [];
let processing = false;
let lastError = "";

// ── screen switching ──
let currentView = "home";
function show(view) {
  for (const id of ["view-home", "view-open", "view-proc", "view-play", "view-guide", "view-library"]) {
    $(id).hidden = id !== "view-" + view;
  }
  currentView = view;
  if (view === "home") refreshHome();
  if (view === "library") { libOpenCourse = null; refreshLibrary(); }
}

// where "back" in the player leads — set based on which screen we came from
let returnView = "open";
function setReturnView(v) {
  returnView = v;
  $("backBtn").title = v === "proc" ? "חזרה לתור" : "חזרה לרשימה";
}

// ── background transcription indicator in the top bar: visible from any screen ──
function updateJobPill(pct) {
  const pill = $("jobPill");
  pill.hidden = !processing;
  if (processing && typeof pct === "number") $("jobPct").textContent = pct + "%";
}
$("jobPill").addEventListener("click", () => show("proc"));
$("homeBtn").addEventListener("click", () => show("home"));
$("helpBtn").addEventListener("click", () => show("guide"));
$("guideBack").addEventListener("click", () => show("home"));

// ── light / dark theme ──
function applyTheme(t) {
  const dark = t === "dark";
  document.body.classList.toggle("dark", dark);
  // label/tooltip describe the NEXT action (what a click will switch to)
  const label = dark ? "מעבר למצב בהיר" : "מעבר למצב כהה";
  const btn = $("themeBtn");
  if (btn) { btn.title = label; btn.setAttribute("aria-label", label); }
  try { localStorage.setItem("theme", t); } catch (e) {}
}
$("themeBtn").addEventListener("click", () =>
  applyTheme(document.body.classList.contains("dark") ? "light" : "dark"));
applyTheme(localStorage.getItem("theme") || "light");

// ── subtitle appearance (size + background) — applied to the native <track> captions via CSS ──
function applySubtitleStyle(size, bg) {
  document.body.dataset.subSize = size || "md";
  document.body.dataset.subBg = bg || "dark";
}
applySubtitleStyle("md", "dark");   // sensible default until settings load

// ── window buttons (the colored dots) ──
$("winClose").addEventListener("click", () => window.pywebview.api.win_close());
$("winMin").addEventListener("click", () => window.pywebview.api.win_minimize());

// OS-level fullscreen. pywebview only exposes a *toggle*, not a setter, so every caller (the green
// dot and the player's fullscreen button) must go through here — otherwise they desync and one
// click ends up doing nothing.
let _osFullscreen = false;
function toggleOsFullscreen() {
  _osFullscreen = !_osFullscreen;
  try { window.pywebview.api.win_fullscreen(); } catch (e) {}
}
$("winFull").addEventListener("click", toggleOsFullscreen);

// The native <video> fullscreen button only fills the *webview* — the OS window stays merely
// maximized, so the Windows taskbar and title bar stay on screen. Mirror the player's fullscreen
// onto the real window so the video actually covers the screen.
document.addEventListener("fullscreenchange", () => {
  if (!!document.fullscreenElement !== _osFullscreen) toggleOsFullscreen();
});

// ── transcription mode selector: local-accurate / local-fast / cloud ──
// persisted in settings so the last choice is remembered.
function applyPrivNote() {
  const note = $("privNote");
  if ($("modeSel").value === "cloud") {
    note.textContent = "☁ האודיו יועלה לשרת שהגדרתם";
  } else {
    note.textContent = "🔒 הכול נשאר אצלכם במחשב";
  }
}
$("langSel").addEventListener("change", () => {
  window.pywebview.api.save_settings({ transcription_language: $("langSel").value }).catch(() => {});
});
$("modeSel").addEventListener("change", () => {
  applyPrivNote();
  const mode = $("modeSel").value;
  window.pywebview.api.save_settings({ transcription_mode: mode }).catch(() => {});
  // if user switched away from unconfigured cloud mode while queue is waiting — resume
  if (mode !== "cloud" && !processing && queue.some((q) => q.status === "queued")) processNext();
});

// ── cloud server settings drawer ──
function fmtCost(n) { return "$" + (Number(n) || 0).toFixed(2); }
function openSettingsDrawer() {
  $("settingsDrawer").hidden = false; $("settingsOv").hidden = false;
  $("settingsStatus").textContent = "";
  window.pywebview.api.get_settings().then((s) => {
    const cloud = (s && s.cloud) || {};
    $("settingsLibDir").value = (s && s.library_dir) || "";
    $("settingsEndpoint").value = cloud.endpoint_url || "";
    $("settingsKey").value = cloud.api_key || "";
    $("settingsPrice").value = cloud.price_per_hour || "";
    $("settingsSubSize").value = (s && s.subtitle_size) || "md";
    $("settingsSubBg").value = (s && s.subtitle_bg) || "dark";
    renderCost(cloud);
  });
  $("dictStatus").textContent = "";
  loadDict();
  loadVersion();
}

// ── updates ──
async function loadVersion() {
  $("updateStatus").textContent = "";
  $("updateNowBtn").hidden = true;
  try {
    const v = await window.pywebview.api.version();
    $("updateVer").textContent = "גרסה נוכחית: " + v;
  } catch (e) { $("updateVer").textContent = ""; }
}
$("updateCheckBtn").addEventListener("click", async () => {
  $("updateStatus").textContent = "בודק…";
  $("updateNowBtn").hidden = true;
  let r;
  try { r = await window.pywebview.api.check_update(); } catch (e) { r = null; }
  if (!r || r.error) { $("updateStatus").textContent = "לא ניתן לבדוק כרגע — בדקו את חיבור האינטרנט."; return; }
  if (r.update_available) {
    $("updateStatus").textContent = `יש גרסה חדשה! (${r.current} ← ${r.latest})`;
    $("updateNowBtn").hidden = false;
  } else {
    $("updateStatus").textContent = `אתם מעודכנים — גרסה ${r.current} היא האחרונה ✓`;
  }
});
$("updateNowBtn").addEventListener("click", async () => {
  if (processing) {   // updating restarts the app — never do it mid-transcription (DIST-3)
    $("updateStatus").textContent = "יש תמלול פעיל — המתינו לסיומו לפני העדכון.";
    return;
  }
  const ok = await confirmModal({
    title: "עדכון לגרסה האחרונה",
    body: "האפליקציה תיסגר, תוריד ותתקין את הגרסה החדשה, ותיפתח מחדש אוטומטית (כדקה). ההרצאות וההגדרות שלכם לא מושפעות.",
    buttons: [{ label: "עדכן עכשיו", value: "go" }],
  });
  if (!ok) return;
  $("updateStatus").textContent = "מוריד ומתקין… האפליקציה תיסגר בקרוב.";
  await window.pywebview.api.run_update();
});
// subtitle appearance: apply immediately and persist on change
$("settingsSubSize").addEventListener("change", () => {
  applySubtitleStyle($("settingsSubSize").value, $("settingsSubBg").value);
  window.pywebview.api.save_settings({ subtitle_size: $("settingsSubSize").value }).catch(() => {});
});
$("settingsSubBg").addEventListener("change", () => {
  applySubtitleStyle($("settingsSubSize").value, $("settingsSubBg").value);
  window.pywebview.api.save_settings({ subtitle_bg: $("settingsSubBg").value }).catch(() => {});
});
$("settingsLibDirBtn").addEventListener("click", async () => {
  const dir = await window.pywebview.api.pick_folder();
  if (!dir) return;
  $("settingsLibDir").value = dir;
  await window.pywebview.api.save_settings({ library_dir: dir });
  $("settingsStatus").textContent = "תיקיית הספרייה עודכנה ✓";
});
function renderCost(cloud) {
  const secs = Number(cloud.total_seconds) || 0;
  $("costTotal").textContent = "≈ " + fmtCost(cloud.total_cost);   // estimate — see below
  const mins = Math.round(secs / 60);
  $("costSub").textContent = secs > 0
    ? `${mins} דקות עיבוד מצטבר על השרת`
    : "טרם בוצע תמלול בשרת";
}
function closeSettingsDrawer() { $("settingsDrawer").hidden = true; $("settingsOv").hidden = true; }
// settings are reached from the ☰ drawer now (no duplicate home button)
$("drawerSettingsBtn").addEventListener("click", () => { closeDrawer(); openSettingsDrawer(); });
$("settingsClose").addEventListener("click", closeSettingsDrawer);
$("settingsOv").addEventListener("click", closeSettingsDrawer);
$("settingsSaveBtn").addEventListener("click", () => {
  const endpoint_url = $("settingsEndpoint").value.trim();
  const api_key = $("settingsKey").value.trim();
  const price_per_hour = parseFloat($("settingsPrice").value) || 0;
  window.pywebview.api.save_settings({ cloud: { endpoint_url, api_key, price_per_hour } })
    .then(() => { $("settingsStatus").textContent = "נשמר ✓"; });
});
$("costReset").addEventListener("click", async () => {
  const ok = await confirmModal({
    title: "איפוס מונה העלות",
    body: "מונה זמן העיבוד והעלות המצטברת יתאפסו לאפס. הפעולה לא משפיעה על ההרצאות שלכם — רק על מספר ההערכה המוצג כאן.",
    buttons: [{ label: "איפוס המונה", value: "reset", danger: true }],
  });
  if (!ok) return;
  const s = await window.pywebview.api.save_settings({ cloud: { total_seconds: 0, total_cost: 0 } });
  renderCost((s && s.cloud) || {});
});

// ── personal correction dictionary ──
let dictionary = { rules: [] };
async function loadDict() {
  try { dictionary = await window.pywebview.api.get_dictionary(); } catch (e) { dictionary = { rules: [] }; }
  if (!dictionary || !Array.isArray(dictionary.rules)) dictionary = { rules: [] };
  renderDict();
}
function renderDict() {
  const list = $("dictList");
  list.innerHTML = "";
  if (!dictionary.rules.length) {
    list.innerHTML = '<div class="dict-empty">אין עדיין תיקונים.</div>';
    return;
  }
  dictionary.rules.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "dict-item";
    const f = document.createElement("span"); f.className = "dict-f"; f.textContent = r.from;
    const a = document.createElement("span"); a.className = "dict-a"; a.textContent = "⟵";
    const t = document.createElement("span"); t.className = "dict-t"; t.textContent = r.to || "(מחיקה)";
    const del = document.createElement("button"); del.className = "dict-del"; del.textContent = "✕"; del.title = "מחיקת התיקון";
    del.onclick = async () => {
      dictionary.rules.splice(i, 1);
      dictionary = await window.pywebview.api.save_dictionary(dictionary.rules);
      renderDict();
    };
    row.append(f, a, t, del);
    list.appendChild(row);
  });
}
async function addDictRule(from, to) {
  from = (from || "").trim(); to = (to || "").trim();
  if (!from) return;
  dictionary.rules = dictionary.rules.filter((r) => r.from !== from).concat([{ from, to }]);
  dictionary = await window.pywebview.api.save_dictionary(dictionary.rules);
  renderDict();
}
$("dictAddBtn").addEventListener("click", () => {
  addDictRule($("dictFrom").value, $("dictTo").value);
  $("dictFrom").value = ""; $("dictTo").value = "";
});
$("dictTo").addEventListener("keydown", (e) => { if (e.key === "Enter") $("dictAddBtn").click(); });
$("dictApplyBtn").addEventListener("click", async () => {
  $("dictStatus").textContent = "מחיל על הספרייה…";
  const n = await window.pywebview.api.reapply_dictionary();
  $("dictStatus").textContent = n ? `✓ הוחל — ${n} שורות כתוביות עודכנו בספרייה.` : "לא נמצאו התאמות לעדכון.";
});
// add the selected transcript word/phrase to the dictionary and apply it to the open lecture now
$("dictAddSelBtn").addEventListener("click", async () => {
  const sel = (window.getSelection().toString() || "").trim();
  const from = (sel || prompt("איזו מילה/ביטוי מתומללים בצורה שגויה?", "") || "").trim();
  if (!from) return;
  const to = prompt(`מה התיקון הנכון עבור "${from}"?`, "");
  if (to === null) return;
  await addDictRule(from, to);
  // apply immediately to the lecture on screen (Python does the whole-word replace, then re-sync)
  cues = await window.pywebview.api.apply_dictionary_to_cues(cues);
  await window.pywebview.api.save_srt(currentVideo, cues);
  buildVtt(cues); renderTranscript();
  $("tcStatus").textContent = "✓ התיקון נוסף למילון והוחל על ההרצאה";
});

// returns {endpoint_url, api_key} if valid, null if not in cloud mode, undefined if cloud not configured (cancel)
async function resolveCloudCfg() {
  if ($("modeSel").value !== "cloud") return null;
  const s = await window.pywebview.api.get_settings();
  const cloud = (s && s.cloud) || {};
  if (!cloud.endpoint_url) {
    // gently guide to setup instead of a dead-end alert
    openSettingsDrawer();
    $("settingsStatus").textContent = "כדי להשתמש במצב הענן — הזינו כתובת שרת ומפתח, ושמרו.";
    return undefined;
  }
  return cloud;
}

// ── first-run onboarding (explains the 3 modes once) ──
$("onboardClose").addEventListener("click", () => {
  $("onboardOv").hidden = true;
  try { localStorage.setItem("onboarded", "1"); } catch (e) {}
});
(function showOnboardingIfFirstRun() {
  try { if (localStorage.getItem("onboarded")) return; } catch (e) { return; }
  $("onboardOv").hidden = false;
})();

// restore saved transcription mode on startup
window.addEventListener("pywebviewready", () => {
  window.pywebview.api.get_settings().then((s) => {
    if (s && s.transcription_mode) {
      const opt = [...$("modeSel").options].find((o) => o.value === s.transcription_mode);
      if (opt) $("modeSel").value = s.transcription_mode;
    }
    if (s && s.transcription_language != null) {
      const opt = [...$("langSel").options].find((o) => o.value === s.transcription_language);
      if (opt) $("langSel").value = s.transcription_language;
    }
    if (s) applySubtitleStyle(s.subtitle_size, s.subtitle_bg);
    applyPrivNote();
  }).catch(() => {});

  // load persisted playback positions before the home renders, so "continue watching" shows up
  window.pywebview.api.get_resume()
    .then((r) => { if (r && r.positions) resumeData = r; })
    .catch(() => {})
    .finally(() => refreshHome());

  refreshHome();   // populate the dashboard immediately on launch (not only after clicking 'home')

  // crash recovery: resume any queue left over from a previous run (runs in background)
  Promise.resolve(refreshLibrary()).finally(() => {
    window.pywebview.api.load_queue().then((jobs) => {
      if (!Array.isArray(jobs) || !jobs.length) return;
      // merge, don't overwrite: files enqueued before this async load resolves must survive (STAB-5)
      const have = new Set(queue.map((q) => q.sourcePath));
      const restored = jobs
        .filter((j) => j && j.sourcePath && !have.has(j.sourcePath))
        .map((j) => ({ ...j, name: j.name || j.sourcePath.split(/[\\/]/).pop(), res: null }));
      if (!restored.length) return;
      queue = restored.concat(queue);   // restored (older) first, keep any live additions after
      renderQueue();
      if (!processing) processNext();
    }).catch(() => {});
  });
});

// ── file picker (multi-select) ──
async function pickAndStart() {
  const res = await window.pywebview.api.pick_file();
  if (res) window.enqueueFiles(Array.isArray(res) ? res : [res]);
}
$("pickBtn").addEventListener("click", (e) => { e.stopPropagation(); pickAndStart(); });
$("drop").addEventListener("click", pickAndStart);

// ── download from URL ──
function startDownload() {
  const url = $("urlIn").value.trim();
  if (!url) return;
  show("proc");
  $("procName").textContent = "הורדה מקישור";
  $("stageHeading").textContent = "מוריד את ההרצאה…";
  $("fill").style.width = "0"; $("pct").textContent = "0%"; $("eta").textContent = "";
  $("queue").innerHTML = "";
  resetSteps();
  window.pywebview.api.download(url);
  $("urlIn").value = "";
}
$("urlBtn").addEventListener("click", startDownload);
$("urlIn").addEventListener("keydown", (e) => { if (e.key === "Enter") startDownload(); });

window.onDownload = function (p) {
  $("stageHeading").textContent = "מוריד את ההרצאה…";
  const pct = p.percent || 0;
  if (p.status === "finished") {
    $("bar2").classList.remove("loading");
    $("fill").style.width = "100%"; $("pct").textContent = "100%";
    $("eta").textContent = "ההורדה הושלמה — מתחיל תמלול…";
  } else if (pct > 0) {
    // known size — real progress bar
    $("bar2").classList.remove("loading");
    $("fill").style.width = pct + "%"; $("pct").textContent = pct + "%";
    $("eta").textContent = "מוריד מהאינטרנט…";
  } else {
    // unknown size (streaming/Moodle) — animated bar instead of stuck 0%
    $("bar2").classList.add("loading");
    $("pct").textContent = "";
    $("eta").textContent = "מוריד מהאינטרנט…";
  }
};

// ── drag-and-drop (file handling is in Python; this is visual only) ──
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());
const drop = $("drop");
drop.addEventListener("dragenter", (e) => { e.preventDefault(); drop.classList.add("drag"); });
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("drag"); });
drop.addEventListener("mouseenter", () => drop.classList.add("hover"));
drop.addEventListener("mouseleave", () => drop.classList.remove("hover"));

// ── queue persistence (atomic JSON in Python; debounced from JS) ──
function serializeQueue() {
  // res is runtime-only; persist a custom name only if the user set one (else it's derived from the path)
  return queue.map(({ id, sourcePath, courseName, language, status, error, createdAt, renamed, name }) =>
    ({ id, sourcePath, courseName, language, status, error: error || null, createdAt,
       ...(renamed ? { renamed: true, name } : {}) }));
}
let _saveTimer = null;
function saveQueueSoon() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try { window.pywebview.api.save_queue(serializeQueue()); } catch (e) {}
  }, 300);
}
// immediate, un-debounced save — used at status transitions (running/done/failed) so a fast
// app close can't lose a "done" flag and re-transcribe a finished lecture on next launch (STAB-3).
function saveQueueNow() {
  clearTimeout(_saveTimer);
  try { window.pywebview.api.save_queue(serializeQueue()); } catch (e) {}
}

// ── queue ──
window.enqueueFiles = function (paths) {
  const course = $("courseSel").value || "";  // current course = destination folder for this batch
  const language = $("langSel").value;         // "" = auto-detect
  for (const p of paths) {
    if (!p || queue.some((q) => q.sourcePath === p)) continue;
    queue.push({
      id: crypto.randomUUID(),
      sourcePath: p,
      name: p.split(/[\\/]/).pop(),
      courseName: course,
      language,
      status: "queued",
      error: null,
      createdAt: new Date().toISOString(),
      res: null,
    });
  }
  renderQueue();
  saveQueueSoon();
  show("proc");
  if (!processing) processNext();
};

let _starting = false;   // guards processNext across its await, so two triggers can't start two jobs (STAB-2)
async function processNext() {
  if (_starting) return;
  _starting = true;
  try {
    return await _processNext();
  } finally {
    _starting = false;
  }
}
async function _processNext() {
  const item = queue.find((q) => q.status === "queued");
  if (!item) {
    processing = false;
    stopProcTips();
    const doneCount = queue.filter((q) => q.status === "done").length;
    const errCount = queue.filter((q) => q.status === "failed").length;
    if (doneCount > 0) {
      $("stageHeading").textContent = doneCount > 1 ? "ההרצאות מוכנות ✓" : "הכתוביות מוכנות ✓";
      $("eta").textContent = errCount
        ? `${errCount} מתוך ${doneCount + errCount} נכשלו — השאר מוכנות.`
        : "בחרו הרצאה כדי לצפות, או גררו עוד קבצים.";
      $("fill").style.width = "100%"; $("pct").textContent = "100%";
      resetSteps(true);
      $("watchDone").hidden = false;
      updateJobPill();
    } else {
      // everything failed — show error instead of "ready"
      $("stageHeading").textContent = "התמלול נכשל ✕";
      $("eta").textContent = lastError || "אירעה שגיאה. בדקו את crash.log לפרטים.";
      $("fill").style.width = "0"; $("pct").textContent = "";
      $("bar2").classList.remove("loading");
      $("watchDone").hidden = true;
      updateJobPill();
    }
    setJobCtrl(false);
    return;
  }
  const cloudCfg = await resolveCloudCfg();
  if (cloudCfg === undefined) {
    // cloud mode without config — don't start, let user pick a mode or configure server
    return;
  }
  const fast = $("modeSel").value === "local_fast";
  processing = true;
  $("watchDone").hidden = true;
  updateJobPill(0);
  item.status = "running";
  saveQueueNow();   // persist the running-state immediately (STAB-3)
  const idx = queue.filter((q) => q.status === "done").length + 1;
  $("procName").textContent = (queue.length > 1 ? `(${idx}/${queue.length}) ` : "") + item.name;
  showProcMeta($("modeSel").value, item.language);
  $("fill").style.width = "0"; $("pct").textContent = "0%"; $("eta").textContent = "";
  resetSteps();
  renderQueue();
  startProcTips();               // rotating learning tips while the job runs
  setJobCtrl(true, !!cloudCfg);  // local: pause+cancel; cloud: cancel only (can't pause a remote job)
  const lang = item.language == null ? "he" : item.language;   // "" = auto; undefined (old items) → he
  // catch a rejected bridge call so a failed start surfaces as an error instead of freezing the queue (STAB-4)
  Promise.resolve(window.pywebview.api.start(item.sourcePath, fast, item.courseName || "", cloudCfg, lang))
    .catch((err) => window.onError("שגיאה בהפעלת התמלול: " + err));
}

// ── pause / cancel controls for the running job ──
let paused = false;
function setJobCtrl(show, cloud) {
  $("jobCtrl").hidden = !show;
  $("pauseBtn").hidden = !!cloud;   // pausing only works for the local subprocess
  if (!show) { paused = false; $("pauseBtn").textContent = "⏸ השהה"; }
}
$("pauseBtn").addEventListener("click", () => {
  paused = !paused;
  if (paused) {
    window.pywebview.api.pause();
    $("pauseBtn").textContent = "▶ המשך";
    $("stageHeading").textContent = "מושהה — לחצו 'המשך' כדי להמשיך";
  } else {
    window.pywebview.api.resume();
    $("pauseBtn").textContent = "⏸ השהה";
  }
});
let cancelling = false;
$("cancelBtn").addEventListener("click", async () => {
  const ok = await confirmModal({
    title: "ביטול התמלול הנוכחי",
    body: "ההתקדמות עד כה תימחק ולא תישמר — תצטרכו להתחיל את ההרצאה הזו מחדש. שאר ההרצאות בתור ימשיכו כרגיל.",
    buttons: [{ label: "בטל את התמלול", value: "cancel", danger: true }],
  });
  if (!ok) return;
  cancelling = true;                       // suppress further progress + show immediate feedback
  stopSmooth();
  $("jobCtrl").hidden = true;
  $("stageHeading").textContent = "מבטל…";
  $("eta").textContent = "";
  $("bar2").classList.remove("loading");
  window.pywebview.api.cancel();
});

const STAGE_LABEL = { extract: "אודיו", transcribe: "תמלול", sync: "סנכרון" };
const STAGE_HEAD = {
  extract: "מכין את האודיו…",
  transcribe: "מתמלל את ההרצאה…",
  sync: "מסנכרן את הכתוביות…",
};

// small "language · model" descriptor shown during transcription so the user knows what's running
function showProcMeta(mode, language) {
  const lang = language === "en" ? "אנגלית" : language === "" ? "זיהוי אוטומטי" : "עברית";
  let model;
  if (mode === "cloud") model = "שרת GPU";
  else if (mode === "local_fast" || language !== "he") model = "מקומי · מודל מהיר";
  else model = "מקומי · מודל מדויק";
  const el = $("procMeta");
  el.textContent = `${lang} · ${model}`;
  el.hidden = false;
}
const STAGE_ORDER = ["extract", "transcribe", "sync"];

function resetSteps(allDone) {
  for (const s of STAGE_ORDER) {
    const el = $("step-" + s);
    el.className = "step" + (allDone ? " done" : "");
    el.textContent = (allDone ? "✓ " : "") + STAGE_LABEL[s];
  }
}

function renderQueue() {
  const wrap = $("queue");
  wrap.innerHTML = "";
  if (!queue.length) return;
  const ICON = { queued: "•", running: "●", done: "✓", failed: "✕" };
  const courses = (library && library.courses) || [];

  // header: title + live summary (active / done / failed)
  const done = queue.filter((q) => q.status === "done").length;
  const failed = queue.filter((q) => q.status === "failed").length;
  const active = queue.filter((q) => q.status === "queued" || q.status === "running").length;
  const head = document.createElement("div");
  head.className = "queue-head";
  const sum = [];
  if (active) sum.push(`${active} בתור`);
  if (done) sum.push(`${done} הושלמו`);
  if (failed) sum.push(`${failed} נכשלו`);
  head.innerHTML =
    `<span class="qh-title">תור התמלול</span><span class="qh-sub">${sum.join(" · ")}</span>`;
  wrap.appendChild(head);

  queue.forEach((q) => {
    const row = document.createElement("div");
    row.className = "qitem " + q.status;
    row.dataset.id = q.id;

    const icon = document.createElement("span");
    icon.className = "qicon"; icon.textContent = ICON[q.status] || "•";
    const name = document.createElement("span");
    name.className = "qname"; name.textContent = q.name; name.title = q.name;

    if (q.status === "queued") {
      const grip = document.createElement("span");        // visible drag affordance
      grip.className = "qgrip"; grip.textContent = "⋮⋮"; grip.title = "גררו לשינוי הסדר";
      grip.setAttribute("aria-hidden", "true");
      row.appendChild(grip);
    }
    row.appendChild(icon); row.appendChild(name);

    if (q.status === "queued" || q.status === "running") {
      // rename the lecture (as saved in the app) — works even while it's transcribing
      const edit = document.createElement("button");
      edit.className = "qedit"; edit.textContent = "✏"; edit.title = "שינוי שם ההרצאה";
      edit.onclick = (e) => {
        e.stopPropagation();
        const nn = prompt("שם חדש להרצאה:", q.name);
        if (!nn || !nn.trim()) return;
        q.name = nn.trim();
        q.renamed = true;          // apply this title to the library entry when the job finishes
        name.textContent = q.name; name.title = q.name;
        saveQueueSoon();
      };
      row.appendChild(edit);
    }

    if (q.status === "queued") {
      // drag to reorder + per-item destination course
      row.draggable = true;
      addDragHandlers(row, q);
      const sel = document.createElement("select");
      sel.className = "qcourse"; sel.title = "תיקיית יעד";
      sel.innerHTML = '<option value="">ללא קורס</option>';
      const opts = courses.includes(q.courseName) || !q.courseName ? courses : [q.courseName, ...courses];
      for (const c of opts) {
        const o = document.createElement("option");
        o.value = c; o.textContent = c;
        sel.appendChild(o);
      }
      sel.value = q.courseName || "";
      sel.onchange = () => { q.courseName = sel.value; saveQueueSoon(); };
      // dragging the row shouldn't start when interacting with the select
      sel.addEventListener("mousedown", (e) => e.stopPropagation());
      sel.draggable = false;
      row.appendChild(sel);

      const del = document.createElement("button");
      del.className = "qdel"; del.textContent = "✕"; del.title = "הסר מהתור";
      del.onclick = () => { queue = queue.filter((x) => x !== q); renderQueue(); saveQueueSoon(); };
      row.appendChild(del);
    } else if (q.courseName) {
      const tag = document.createElement("span");
      tag.className = "qtag"; tag.textContent = q.courseName;
      row.appendChild(tag);
    }

    if (q.status === "failed" && q.error) {
      const err = document.createElement("span");
      err.className = "qerr"; err.textContent = q.error; err.title = q.error;
      row.appendChild(err);
    }
    if (q.status === "done") {
      const b = document.createElement("button");
      b.className = "qwatch"; b.textContent = "▶ צפה";
      b.onclick = () => watchItem(queue.indexOf(q));
      row.appendChild(b);
    }
    // remove from the list — available for everything except the job currently running (use cancel for that)
    if (q.status !== "running" && q.status !== "queued") {
      const del = document.createElement("button");
      del.className = "qdel"; del.textContent = "✕";
      del.title = q.status === "done" ? "הסר מהרשימה" : "הסר מהתור";
      del.onclick = () => { queue = queue.filter((x) => x !== q); renderQueue(); saveQueueSoon(); };
      row.appendChild(del);
    }
    wrap.appendChild(row);
  });
}
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

// ── confirmation modal (replaces browser confirm() for destructive actions) ──
// buttons: [{label, value, danger}]. Resolves with the chosen value, or null on cancel/backdrop.
function confirmModal({ title, body, buttons }) {
  return new Promise((resolve) => {
    document.querySelectorAll(".modal-ov").forEach((m) => m.remove());
    const ov = document.createElement("div");
    ov.className = "modal-ov";
    const card = document.createElement("div");
    card.className = "modal";
    const h = document.createElement("div");
    h.className = "modal-title"; h.textContent = title;
    const b = document.createElement("div");
    b.className = "modal-body"; b.textContent = body;
    const row = document.createElement("div");
    row.className = "modal-actions";
    const done = (v) => { ov.remove(); document.removeEventListener("keydown", onKey, true); resolve(v); };
    const cancel = document.createElement("button");
    cancel.className = "modal-btn modal-cancel"; cancel.textContent = "ביטול";
    cancel.onclick = () => done(null);
    row.appendChild(cancel);
    for (const btn of buttons) {
      const el = document.createElement("button");
      el.className = "modal-btn" + (btn.danger ? " modal-danger" : "");
      el.textContent = btn.label;
      el.onclick = () => done(btn.value);
      row.appendChild(el);
    }
    card.appendChild(h); card.appendChild(b); card.appendChild(row);
    ov.appendChild(card);
    ov.addEventListener("click", (e) => { if (e.target === ov) done(null); });
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(ov);
  });
}

// ── native HTML5 drag-and-drop reorder (queued items only) ──
let dragId = null;
function addDragHandlers(row, q) {
  row.addEventListener("dragstart", (e) => {
    dragId = q.id; row.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", q.id); } catch (err) {}
  });
  row.addEventListener("dragend", () => {
    dragId = null; row.classList.remove("dragging");
    document.querySelectorAll(".qitem.drag-over").forEach((el) => el.classList.remove("drag-over"));
  });
  row.addEventListener("dragenter", (e) => { e.preventDefault(); if (dragId && q.id !== dragId) row.classList.add("drag-over"); });
  row.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; });
  row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
  row.addEventListener("drop", (e) => {
    e.preventDefault(); e.stopPropagation();
    row.classList.remove("drag-over");
    reorderQueue(dragId, q.id);
  });
}
function reorderQueue(fromId, toId) {
  if (!fromId || fromId === toId) return;
  const from = queue.findIndex((x) => x.id === fromId);
  const target = queue.find((x) => x.id === toId);
  if (from < 0 || !target || target.status !== "queued") return;  // only reorder among queued
  const [moved] = queue.splice(from, 1);
  const to = queue.findIndex((x) => x.id === toId);
  queue.splice(to, 0, moved);
  renderQueue();
  saveQueueSoon();
}

// ── progress update (called from Python) ──
window.onProgress = function (p) {
  if (cancelling) return;  // user is cancelling — ignore late progress from the dying job
  if (p.paused) {  // engine entered the paused wait — keep the paused UI, don't overwrite it
    $("stageHeading").textContent = "מושהה — לחצו 'המשך' כדי להמשיך";
    return;
  }
  $("stageHeading").textContent = STAGE_HEAD[p.stage] || "";
  const idx = STAGE_ORDER.indexOf(p.stage);
  STAGE_ORDER.forEach((s, i) => {
    $("step-" + s).className = "step" + (i < idx ? " done" : i === idx ? " now" : "");
    $("step-" + s).textContent = (i < idx ? "✓ " : "") + STAGE_LABEL[s];
  });

  if (p.loading) {
    $("bar2").classList.add("loading");
    $("pct").textContent = "";
    $("eta").textContent = p.device === "cloud"
      ? "מכין ומעלה את האודיו לשרת… (בהרצה ראשונה השרת מתעורר — עד דקה)"
      : "מאתחל את מנוע התמלול… (בהרצה הראשונה בלבד יורד המודל פעם אחת, כ-1.5GB — זה החלק הארוך)";
    return;
  }
  $("bar2").classList.remove("loading");

  if (p.stage === "transcribe" || p.stage === "sync") {
    if (p.device === "cloud" && p.eta != null) {
      // cloud sends only a handful of real updates (one per chunk); creep the bar smoothly
      // between them and tick the countdown locally so the wait never looks frozen.
      $("bar2").classList.add("running");
      smoothEta = { basePct: typeof p.percent === "number" ? p.percent : 0, eta: p.eta, t0: Date.now() };
      if (!smoothTimer) smoothTimer = setInterval(tickSmooth, 1000);
      tickSmooth();
    } else {
      if (typeof p.percent === "number") {
        $("fill").style.width = p.percent + "%";
        $("pct").textContent = p.percent + "%";
        updateJobPill(p.percent);
      }
      if (p.eta != null && p.eta > 0) {
        $("eta").textContent = "נותרו בערך " + fmtEta(p.eta) + " — אפשר להשאיר את זה רץ ברקע";
      }
    }
  }
};

// smooth, self-anchoring progress for cloud: each real update re-anchors basePct/eta, the
// 1s ticker interpolates toward 100% so the bar keeps creeping during the long server waits.
let smoothEta = null, smoothTimer = null;
function stopSmooth() {
  if (smoothTimer) { clearInterval(smoothTimer); smoothTimer = null; }
  smoothEta = null;
  $("bar2").classList.remove("running");
}
function tickSmooth() {
  if (!smoothEta) return;
  const { basePct, eta, t0 } = smoothEta;
  const dt = (Date.now() - t0) / 1000;
  const frac = eta > 0 ? Math.min(dt / eta, 0.985) : 0.985;
  const pct = Math.min(99, basePct + (100 - basePct) * frac);
  $("fill").style.width = pct + "%";
  $("pct").textContent = Math.round(pct) + "%";
  updateJobPill(Math.round(pct));
  const rem = eta > 0 ? eta - dt : 0;
  $("eta").textContent = rem > 1
    ? "נותרו בערך " + fmtEta(rem) + " — אפשר להשאיר את זה רץ ברקע"
    : "עוד רגע מסיים…";
}

function fmtEta(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m}:${String(s).padStart(2, "0")} דקות` : `${s} שניות`;
}

// ── file done → advance queue ──
window.onDone = function (res) {
  stopSmooth();
  const cur = queue.find((q) => q.status === "running");
  if (cur) {
    cur.status = "done"; cur.res = res;
    // user renamed the lecture during transcription → apply it to the saved library entry
    if (cur.renamed && res && res.video) {
      window.pywebview.api.rename_lecture(res.video, cur.name).then(refreshLibrary);
    }
  }
  renderQueue();
  saveQueueNow();    // persist the done-state immediately so a fast close can't re-run it (STAB-3)
  refreshLibrary();  // lecture registered in library — refresh sidebar
  processNext();     // show finish screen + "play subtitles" button
};

// index of the last completed lecture (for "play subtitles" button)
function lastDoneIndex() {
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].status === "done") return i;
  return -1;
}
$("watchDone").addEventListener("click", () => {
  const i = lastDoneIndex();
  if (i >= 0) watchItem(i);
});

// "new lecture" — go back to the open screen without closing the app
$("newLec").addEventListener("click", () => show("open"));

window.onError = function (msg) {
  stopSmooth();
  lastError = msg || "";
  _log("UI onError: " + lastError);
  const cur = queue.find((q) => q.status === "running");
  if (cur) { cur.status = "failed"; cur.error = lastError; }
  $("bar2").classList.remove("loading");
  renderQueue();
  saveQueueNow();   // persist the failed-state immediately (STAB-3)
  processNext();  // decides whether to show "ready" or "failed" based on queue state
};

// user cancelled the current job → drop it (no output was written) and continue with the rest
window.onCancelled = function () {
  stopSmooth();
  cancelling = false;
  paused = false;
  processing = false;
  const cur = queue.find((q) => q.status === "running");
  if (cur) queue = queue.filter((q) => q !== cur);
  setJobCtrl(false);
  $("bar2").classList.remove("loading");
  $("fill").style.width = "0"; $("pct").textContent = "";
  updateJobPill();
  renderQueue();
  saveQueueSoon();
  if (queue.some((q) => q.status === "queued")) {
    processNext();          // more lectures waiting → keep going
  } else {
    show("open");           // nothing left → leave the processing screen, ready for a new file
  }
};

// ── player ──
// We use the browser's built-in <video controls> (seek / speed / fullscreen) — battle-tested and
// visible in native fullscreen. The Hebrew captions come from the <track> VTT; the transcript
// highlight + resume are driven by the 'timeupdate' event below.
const video = $("video");
video.setAttribute("controls", "");

// match the player box to the video's real shape so there are no black letterbox bars around it.
// falls back to the CSS default (16:9) until metadata loads / if dimensions are unknown.
video.addEventListener("loadedmetadata", () => {
  const box = video.closest(".screen");
  if (box && video.videoWidth && video.videoHeight) {
    box.style.aspectRatio = video.videoWidth + " / " + video.videoHeight;
  }
});

// Native WebVTT captions: the browser renders these itself, so they stay visible in the native
// player's own fullscreen (a custom overlay div would not — fullscreen only shows the <video>).
let _vttUrl = null;
function vttTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  const s = (sec % 60).toFixed(3).padStart(6, "0");
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s}`;
}
function buildVtt(cs) {
  const body = cs.map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}`).join("\n\n");
  if (_vttUrl) URL.revokeObjectURL(_vttUrl);
  _vttUrl = URL.createObjectURL(new Blob(["WEBVTT\n\n" + body], { type: "text/vtt" }));
  $("vtt").src = _vttUrl;
  if (video.textTracks[0]) video.textTracks[0].mode = "showing";
  $("ccToggle").classList.remove("off");   // captions start visible for each new lecture
}

let cues = [];
let currentVideo = null;
let rowEls = [];
let curRow = -1;

async function watchItem(i) {
  const it = queue[i];
  if (!it || !it.res) return;
  cues = it.res.cues || [];
  currentVideo = it.res.video;
  video.src = await window.pywebview.api.media_url(currentVideo);
  setReturnView(currentView);
  setPlayTitle(currentVideo);
  show("play");
  video.load();
  buildVtt(cues);
  renderTranscript();
}

// ── transcript panel: edit + jump ──
function renderTranscript() {
  const list = $("tcList");
  list.innerHTML = "";
  rowEls = [];
  curRow = -1;
  cues.forEach((c, idx) => {
    const row = document.createElement("div");
    row.className = "tc-row";
    const t = document.createElement("button");
    t.className = "tc-time";
    t.textContent = clock(c.start);
    t.onclick = () => { video.currentTime = c.start; video.play(); };
    const txt = document.createElement("div");
    txt.className = "tc-text";
    txt.contentEditable = "true";
    txt.spellcheck = false;
    txt.textContent = c.text;
    txt.addEventListener("input", () => { cues[idx].text = txt.textContent; });
    row.appendChild(t);
    row.appendChild(txt);
    list.appendChild(row);
    rowEls.push(row);
  });
  $("tcStatus").textContent = "";
}

// search within transcript
$("tcSearch").addEventListener("input", (e) => {
  const q = e.target.value.trim();
  rowEls.forEach((row, idx) => {
    row.hidden = q && !cues[idx].text.includes(q);
  });
});

// save edits
$("saveBtn").addEventListener("click", async () => {
  $("tcStatus").textContent = "שומר…";
  const r = await window.pywebview.api.save_srt(currentVideo, cues);
  $("tcStatus").textContent = r === true ? "✓ הכתוביות נשמרו" : "שגיאה: " + r;
  if (r === true) buildVtt(cues);   // refresh native captions to reflect the edits
});

// export
async function doExport(fmt) {
  $("tcStatus").textContent = "מייצא…";
  const r = await window.pywebview.api.export(currentVideo, cues, fmt);
  $("tcStatus").textContent = r && r.startsWith("ERR") ? "שגיאה בייצוא" : "✓ נוצר: " + r;
}
$("txtBtn").addEventListener("click", () => doExport("txt"));
$("docxBtn").addEventListener("click", () => doExport("docx"));

// remember where to resume next time the video pauses (native controls fire 'pause')
video.addEventListener("pause", () => saveResume(currentVideo, video.currentTime, video.duration));

let _lastResumeSave = 0;
video.addEventListener("timeupdate", () => {
  const t = video.currentTime, d = video.duration || 0;
  if (t - _lastResumeSave > 5 || _lastResumeSave - t > 5) {   // persist progress at most every ~5s
    _lastResumeSave = t;
    saveResume(currentVideo, t, d);
  }
  const idx = cues.findIndex((c) => t >= c.start && t <= c.end);
  if (idx !== curRow) {
    if (rowEls[curRow]) rowEls[curRow].classList.remove("cur");
    if (rowEls[idx]) {
      rowEls[idx].classList.add("cur");
      // only auto-scroll when not actively editing
      if (!(document.activeElement && document.activeElement.classList.contains("tc-text"))) {
        rowEls[idx].scrollIntoView({ block: "nearest" });
      }
    }
    curRow = idx;
  }
});

$("backBtn").addEventListener("click", () => {
  video.pause();
  show(returnView);
});

function clock(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── lecture library + sidebar ──
let library = { courses: [], lectures: [] };

// player title — from library entry if registered, otherwise filename
function setPlayTitle(path) {
  const lec = library.lectures.find((l) => l.video === path);
  $("playTitle").textContent = lec ? lec.title : path.split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
}
$("playKebab").addEventListener("click", (e) => {
  e.stopPropagation();
  const lec = library.lectures.find((l) => l.video === currentVideo);
  showActionMenu($("playKebab"), currentVideo, lec ? lec.course : "", lec ? lec.title : $("playTitle").textContent);
});

async function refreshLibrary() {
  try {
    library = await window.pywebview.api.library();
  } catch (e) { return; }
  renderCourseSelect();
  renderDrawer();
  if (currentView === "library") {
    if (libOpenCourse !== null) renderLibraryDetail(); else renderLibraryOverview();
  }
  // library.json went missing externally and was recovered from its rolling backup — tell the
  // user once so a silent recovery never looks like the app just "lost" their lectures.
  if (library.recovered) {
    confirmModal({
      title: "הספרייה שוחזרה מגיבוי",
      body: "קובץ הספרייה לא נמצא באתחול, ושוחזר אוטומטית מהגיבוי האחרון. כל ההרצאות והקורסים כאן — אבל אם משהו חסר, בדקו את library.json.bak בתיקיית הנתונים.",
      buttons: [{ label: "הבנתי", value: "ok" }],
    });
  }
}

// course selector on the open screen (preserves current selection)
function renderCourseSelect() {
  const sel = $("courseSel");
  const cur = sel.value;
  sel.innerHTML = '<option value="">ללא קורס</option>';
  for (const c of library.courses) {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  }
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

// shared course rename/delete flows — used by both the sidebar drawer and the Library screen
// so the two surfaces can never drift out of sync.
async function renameCourseFlow(name) {
  const nn = prompt("שם חדש לקורס:", name);
  if (!nn || !nn.trim() || nn.trim() === name) return null;
  const newName = nn.trim();
  await window.pywebview.api.rename_course(name, newName);
  if (openCourses.has(name)) { openCourses.delete(name); openCourses.add(newName); }
  await refreshLibrary();
  return newName;
}
async function deleteCourseFlow(name, lecCount) {
  const ok = await confirmModal({
    title: `מחיקת הקורס "${name}"`,
    body: lecCount
      ? `${lecCount} ${lecCount === 1 ? "הרצאה תעבור" : "הרצאות יעברו"} ל"ללא קורס". קובצי הווידאו והכתוביות לא נמחקים — רק הקורס עצמו.`
      : "הקורס ריק — אין הרצאות מושפעות.",
    buttons: [{ label: "מחיקת הקורס", value: "del", danger: true }],
  });
  if (!ok) return false;
  await window.pywebview.api.remove_course(name);
  openCourses.delete(name);
  await refreshLibrary();
  return true;
}

// a single lecture row (title + ⋯ action menu) — shared by the drawer and the Library detail list
// drag-to-reorder lectures inside a course page — same native HTML5 pattern as the queue rows,
// keyed by video path (a lecture's unique id). Python persists the new order.
let _dragVideo = null;
function addLecDragHandlers(row, l) {
  row.draggable = true;
  row.addEventListener("dragstart", (e) => {
    _dragVideo = l.video; row.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", l.video); } catch (err) {}
  });
  row.addEventListener("dragend", () => {
    _dragVideo = null; row.classList.remove("dragging");
    document.querySelectorAll(".lec.drag-over").forEach((el) => el.classList.remove("drag-over"));
  });
  row.addEventListener("dragenter", (e) => {
    e.preventDefault();
    if (_dragVideo && l.video !== _dragVideo) row.classList.add("drag-over");
  });
  row.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; });
  row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
  row.addEventListener("drop", (e) => {
    e.preventDefault(); e.stopPropagation();
    row.classList.remove("drag-over");
    reorderLectures(_dragVideo, l.video);
  });
}
async function reorderLectures(fromVideo, toVideo) {
  if (!fromVideo || fromVideo === toVideo || libOpenCourse == null) return;
  // order comes from the FULL course list, not the filtered view, so the saved order stays complete
  const order = ((lecturesByCourse()[libOpenCourse]) || []).map((l) => l.video);
  const from = order.indexOf(fromVideo);
  if (from < 0) return;
  const [moved] = order.splice(from, 1);
  const to = order.indexOf(toVideo);
  if (to < 0) return;
  order.splice(to, 0, moved);
  library = await window.pywebview.api.reorder_lectures(libOpenCourse, order);
  renderLibraryDetail();
}

function renderLecRow(l, opts = {}) {
  const row = document.createElement("div");
  row.className = "lec" + (l.missing ? " lec-missing" : "");
  row.innerHTML =
    (opts.drag ? '<span class="lec-grip" aria-hidden="true" title="גררו לשינוי הסדר">⋮⋮</span>' : "") +
    `<span class="lec-name">${l.missing ? "⚠" : "▶"} ${esc(l.title)}</span>`;
  if (opts.drag) addLecDragHandlers(row, l);
  if (l.missing) {
    // file unreachable right now (disconnected drive / OneDrive offline) — kept in the catalog,
    // just not playable; the ⋯ menu stays so the user can still remove/rename it.
    row.title = "קובץ הווידאו לא זמין כרגע (כונן מנותק?) — ההרצאה תחזור כשהקובץ יהיה נגיש";
  } else {
    row.onclick = () => openLecture(l.video);
  }
  const seen = document.createElement("button");
  seen.className = "lec-seen" + (l.viewed ? " on" : "");
  seen.textContent = l.viewed ? "✓" : "○";
  seen.title = l.viewed ? "סמן כלא נצפה" : "סמן כנצפה";
  seen.onclick = async (e) => {
    e.stopPropagation();
    await window.pywebview.api.set_viewed(l.video, !l.viewed);
    refreshLibrary();
  };
  row.appendChild(seen);

  const kebab = document.createElement("button");
  kebab.className = "kebab"; kebab.textContent = "⋯"; kebab.title = "פעולות";
  kebab.onclick = (e) => { e.stopPropagation(); showActionMenu(kebab, l.video, l.course, l.title); };
  row.appendChild(kebab);
  return row;
}

// course list in sidebar, each collapsible to show its lectures
function renderDrawer() {
  const wrap = $("coursesList");
  wrap.innerHTML = "";
  const byCourse = {};
  for (const c of library.courses) byCourse[c] = [];
  for (const l of library.lectures) {
    const key = l.course || "";
    (byCourse[key] = byCourse[key] || []).push(l);
  }
  // order: courses alphabetically, then "no course" at the end (if any)
  const names = library.courses.slice();
  if (byCourse[""] && byCourse[""].length) names.push("");

  if (!names.length) {
    wrap.innerHTML = '<div class="courses-empty">אין עדיין קורסים.<br>צרו קורס חדש או תמללו הרצאה.</div>';
    return;
  }

  for (const name of names) {
    const lecs = byCourse[name] || [];
    const box = document.createElement("div");
    box.className = "course" + (openCourses.has(name) ? " open" : "");

    const head = document.createElement("div");
    head.className = "course-head";
    head.innerHTML =
      '<span class="course-arrow">▶</span>' +
      `<span class="course-ic">${name ? courseIcon(name) : "📂"}</span>` +
      `<span class="course-name">${esc(name || "ללא קורס")}</span>` +
      `<span class="course-count">${lecs.length}</span>`;
    if (name) {
      const ren = document.createElement("button");
      ren.className = "course-del"; ren.textContent = "✏"; ren.title = "שינוי שם הקורס";
      ren.onclick = (e) => { e.stopPropagation(); renameCourseFlow(name); };
      head.appendChild(ren);

      const del = document.createElement("button");
      del.className = "course-del"; del.textContent = "🗑"; del.title = "מחיקת קורס";
      del.onclick = (e) => { e.stopPropagation(); deleteCourseFlow(name, lecs.length); };
      head.appendChild(del);
    }
    head.onclick = () => {
      if (openCourses.has(name)) openCourses.delete(name); else openCourses.add(name);
      box.classList.toggle("open");
    };
    box.appendChild(head);

    const list = document.createElement("div");
    list.className = "lectures";
    if (!lecs.length) {
      const e = document.createElement("div");
      e.className = "lec"; e.style.color = "var(--muted)"; e.style.cursor = "default";
      e.textContent = "אין הרצאות בקורס הזה";
      list.appendChild(e);
    }
    for (const l of lecs) list.appendChild(renderLecRow(l));
    box.appendChild(list);
    wrap.appendChild(box);
  }
}

const openCourses = new Set();

// ── library screen: courses overview grid → course detail list ──
// (dedicated management view — the drawer stays a lightweight quick-nav)
let libOpenCourse = null;   // null = overview; "" = the "no course" bucket; otherwise a course name

function setLibraryMode(detail) {
  $("libBackBtn").hidden = !detail;
  $("libNewCourseBtn").hidden = detail;
  $("libNewCourseRow").hidden = true;
  $("libGrid").hidden = detail;
  $("libDetail").hidden = !detail;
}

function renderLibraryOverview() {
  libOpenCourse = null;
  setLibraryMode(false);
  const grid = $("libGrid");
  grid.innerHTML = "";
  const by = lecturesByCourse();
  const names = library.courses.slice();
  if (by[""] && by[""].length) names.push("");
  if (!names.length) {
    grid.innerHTML = '<div class="courses-empty">אין עדיין קורסים.<br>צרו קורס חדש או תמללו הרצאה.</div>';
    return;
  }
  for (const name of names) {
    const lecs = by[name] || [];
    const watched = lecs.filter((l) => l.viewed).length;
    const pct = lecs.length ? Math.round((watched / lecs.length) * 100) : 0;
    const card = document.createElement("button");
    card.className = "libcard";
    card.innerHTML =
      `<div class="libcard-ic">${name ? courseIcon(name) : "📂"}</div>` +
      `<div class="libcard-name">${esc(name || "ללא קורס")}</div>` +
      `<div class="libcard-count">${lecs.length} ${lecs.length === 1 ? "הרצאה" : "הרצאות"}</div>` +
      `<div class="resume-bar libcard-bar"><div class="resume-fill" style="width:${pct}%"></div></div>` +
      `<div class="libcard-sub">${watched}/${lecs.length} נצפו</div>`;
    card.onclick = () => openLibraryCourse(name);
    grid.appendChild(card);
  }
}

function openLibraryCourse(name) {
  libOpenCourse = name;
  setLibraryMode(true);
  renderLibraryDetail();
}

function renderLibraryDetail() {
  const name = libOpenCourse;
  const lecs = (lecturesByCourse()[name]) || [];
  $("libDetailTitle").textContent = name || "ללא קורס";
  $("libDetailCount").textContent = `${lecs.length} ${lecs.length === 1 ? "הרצאה" : "הרצאות"}`;
  const icBtn = $("libIconBtn");
  icBtn.hidden = !name;
  if (name) { icBtn.textContent = courseIcon(name); icBtn.onclick = (e) => { e.stopPropagation(); showIconPicker(icBtn, name); }; }
  $("libRenBtn").hidden = !name;
  $("libDelBtn").hidden = !name;
  $("libDetailSearch").value = "";
  renderLibraryDetailList(lecs, "");
  renderCourseExtras(name);
}

// ── course page extras: checklist + notes (named courses only) ──
const DEFAULT_COURSE_ICON = "📘";
const COURSE_ICONS = ["📘", "📗", "📙", "📕", "📓", "🧮", "📐", "🔬", "⚗️", "💻", "🧠", "🌍", "📊", "🎼", "🎨", "⚖️", "🏛️", "🩺"];
function courseMeta(name) {
  const m = (library.course_meta && library.course_meta[name]) || {};
  return { icon: m.icon || DEFAULT_COURSE_ICON, notes: m.notes || "", tasks: Array.isArray(m.tasks) ? m.tasks : [] };
}
function courseIcon(name) {
  return (name && library.course_meta && library.course_meta[name] && library.course_meta[name].icon) || DEFAULT_COURSE_ICON;
}
// emoji picker popover — anchored to the given element; saves the chosen icon for the course
function showIconPicker(anchorEl, name) {
  document.querySelectorAll(".actionmenu").forEach((m) => m.remove());
  const menu = document.createElement("div");
  menu.className = "actionmenu iconpicker";
  for (const ic of COURSE_ICONS) {
    const b = document.createElement("button");
    b.className = "ip-opt"; b.textContent = ic;
    b.onclick = async () => {
      menu.remove();
      library = await window.pywebview.api.save_course_meta(name, { icon: ic });
      if (currentView === "library") { if (libOpenCourse !== null) renderLibraryDetail(); else renderLibraryOverview(); }
      renderDrawer();
    };
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = anchorEl.getBoundingClientRect();
  let top = r.bottom + 4;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 4);
  menu.style.top = top + "px";
  let left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8));
  menu.style.left = left + "px";
  const close = (e) => { if (!menu.contains(e.target) && e.target !== anchorEl) { menu.remove(); document.removeEventListener("click", close, true); } };
  document.addEventListener("click", close, true);
}
let _noteTimer = null;
function renderCourseExtras(name) {
  const box = $("courseExtras");
  if (!name) { box.hidden = true; return; }   // "no course" bucket isn't a real course
  box.hidden = false;
  const meta = courseMeta(name);

  // checklist
  const list = $("courseTasks");
  list.innerHTML = "";
  if (!meta.tasks.length) {
    list.innerHTML = '<div class="cx-empty">אין עדיין משימות.</div>';
  } else {
    meta.tasks.forEach((t, i) => {
      const row = document.createElement("div");
      row.className = "cx-task" + (t.done ? " done" : "");
      const cb = document.createElement("button");
      cb.className = "cx-check"; cb.textContent = t.done ? "✓" : "";
      cb.onclick = () => { meta.tasks[i].done = !meta.tasks[i].done; saveTasks(name, meta.tasks); };
      const txt = document.createElement("span");
      txt.className = "cx-tasktext"; txt.textContent = t.text;
      const del = document.createElement("button");
      del.className = "cx-taskdel"; del.textContent = "✕"; del.title = "מחיקה";
      del.onclick = () => { meta.tasks.splice(i, 1); saveTasks(name, meta.tasks); };
      row.append(cb, txt, del);
      list.appendChild(row);
    });
  }

  // notes (debounced autosave)
  const ta = $("courseNotes");
  ta.value = meta.notes;
  $("courseNoteStatus").textContent = "";
  ta.oninput = () => {
    clearTimeout(_noteTimer);
    $("courseNoteStatus").textContent = "שומר…";
    _noteTimer = setTimeout(async () => {
      await window.pywebview.api.save_course_meta(name, { notes: ta.value });
      library = await window.pywebview.api.library();   // keep local cache fresh
      $("courseNoteStatus").textContent = "נשמר ✓";
    }, 600);
  };
}
async function saveTasks(name, tasks) {
  library = await window.pywebview.api.save_course_meta(name, { tasks });
  if (libOpenCourse === name) renderCourseExtras(name);
}
function addCourseTask() {
  const inp = $("courseTaskIn");
  const text = inp.value.trim();
  if (!text || libOpenCourse == null) return;
  const tasks = courseMeta(libOpenCourse).tasks.concat([{ text, done: false }]);
  inp.value = "";
  saveTasks(libOpenCourse, tasks);
}
$("courseTaskAdd").addEventListener("click", addCourseTask);
$("courseTaskIn").addEventListener("keydown", (e) => { if (e.key === "Enter") addCourseTask(); });

function renderLibraryDetailList(lecs, q) {
  const wrap = $("libDetailList");
  wrap.innerHTML = "";
  const filtered = q ? lecs.filter((l) => l.title.toLowerCase().includes(q.toLowerCase())) : lecs;
  if (!filtered.length) {
    wrap.innerHTML = `<div class="courses-empty">${q ? "אין תוצאות." : "אין הרצאות בקורס הזה."}</div>`;
    return;
  }
  // reordering is only offered on the unfiltered list — dragging within search results would move
  // a lecture relative to rows the user can't see
  for (const l of filtered) wrap.appendChild(renderLecRow(l, { drag: !q }));
}

$("libraryBtn").addEventListener("click", () => show("library"));
$("libBackBtn").addEventListener("click", renderLibraryOverview);
$("libDetailSearch").addEventListener("input", () => {
  const lecs = (lecturesByCourse()[libOpenCourse]) || [];
  renderLibraryDetailList(lecs, $("libDetailSearch").value.trim());
});
$("libRenBtn").addEventListener("click", async () => {
  const newName = await renameCourseFlow(libOpenCourse);
  if (newName != null) { libOpenCourse = newName; renderLibraryDetail(); }
});
$("libDelBtn").addEventListener("click", async () => {
  const lecCount = ((lecturesByCourse()[libOpenCourse]) || []).length;
  const ok = await deleteCourseFlow(libOpenCourse, lecCount);
  if (ok) renderLibraryOverview();
});

// create a course inline from the Library screen (same mechanism as the upload screen's "+ קורס")
$("libNewCourseBtn").addEventListener("click", () => {
  const row = $("libNewCourseRow");
  row.hidden = !row.hidden;
  if (!row.hidden) $("libNewCourseIn").focus();
});
// shared course-create — registers the course, refreshes the library, then applies the caller's
// follow-up (expand it in the drawer / auto-select it on the upload screen). One helper for the
// three inline "+ course" inputs (drawer, Library screen, upload screen).
async function createCourseNamed(name, opts = {}) {
  name = (name || "").trim();
  if (!name) return;
  await window.pywebview.api.create_course(name);
  if (opts.expand) openCourses.add(name);
  await refreshLibrary();
  if (opts.select) $("courseSel").value = name;
}
async function createLibraryCourseInline() {
  await createCourseNamed($("libNewCourseIn").value);
  $("libNewCourseIn").value = ""; $("libNewCourseRow").hidden = true;
}
$("libNewCourseOk").addEventListener("click", createLibraryCourseInline);
$("libNewCourseIn").addEventListener("keydown", (e) => {
  if (e.key === "Enter") createLibraryCourseInline();
  if (e.key === "Escape") { $("libNewCourseIn").value = ""; $("libNewCourseRow").hidden = true; }
});

// ── home screen: stats + tip + quick actions ──
const LEARNING_TIPS = [
  "שיטת פומודורו: 25 דקות למידה ממוקדת, 5 דקות הפסקה. אחרי 4 מחזורים — הפסקה ארוכה של 15-30 דקות.",
  "שמיעת הרצאה פעם שנייה במהירות 1.5x-2x עוזרת לחזק זכירה, אחרי שכבר הבנתם את התוכן בפעם הראשונה.",
  "סכמו הרצאה במילים שלכם תוך 24 שעות מהצפייה — זה משמעותית משפר זכירה לטווח ארוך (effect מוכר במחקר).",
  "השתמשו בחיפוש בכתוביות כדי למצוא מהר רגע ספציפי שאתם זוכרים חלקית, במקום לגלול בווידאו.",
  "למדו במקטעים קצרים וממוקדים (20-30 דקות) ולא במרתון אחד ארוך — הריכוז יורד אחרי כ-25 דקות רצופות.",
  "כתבו שאלות לעצמכם על החומר במקום רק לקרוא אותו מחדש — (Active Recall) — זה אפקטיבי הרבה יותר מקריאה חזרה.",
  "חזרה מרווחת (Spaced Repetition): חזרו על החומר יום למחרת, אחר כך אחרי שבוע, אחר כך אחרי חודש.",
  "לפני שמתחילים לצפות בהרצאה, הציצו רגע בכתוביות/תוכן — ידיעה מוקדמת על הנושא משפרת קליטה.",
  "סמנו לעצמכם בעת הצפייה את הקטעים שלא הבנתם, כדי לחזור אליהם ולא לדלג עליהם בטעות בפעם הבאה.",
  "למדו ביחד עם חבר לקורס והסבירו אחד לשני נושאים — הסבר בקול רם חושף מהר מאוד מה לא הובן עד הסוף.",
  "תרגלו אחזור מהזיכרון (לבדוק את עצמכם בלי להסתכל בחומר) — זה יעיל יותר מקריאה חזרה גם אם זה מרגיש קשה יותר.",
  "ארגנו את ההרצאות לפי קורסים בתפריט הצד — קל יותר למצוא חזרה הרצאה ספציפית כשצריך לחזור עליה.",
  "שלבו כמה ערוצי קלט: האזנה, קריאת כתוביות, וכתיבת הערות. שילוב חושים משפר זכירה.",
  "אל תלמדו עם הטלפון בקרבת יד פתוח — אפילו נוטיפיקציה אחת שוברת ריכוז למספר דקות.",
  "תכננו מראש כמה זמן תקדישו להרצאה, ועצרו בזמן שתכננתם — גבול זמן ברור מפחית דחיינות.",
  "אחרי הרצאה ארוכה, נסו לסכם אותה בשלוש-ארבע נקודות מרכזיות בלבד — זה מאלץ אתכם לבחור את החשוב.",
  "למדו בשעה שבה אתם הכי ערניים (בוקר/ערב, תלוי באדם) — לא כל השעות שוות מבחינת קליטה.",
  "שתו מים ושמרו על תנועה קלה בין מקטעי למידה — עייפות פיזית פוגעת ישירות בריכוז.",
  "אם משהו לא מובן בהרצאה — אל תדלגו עליו בתקווה ש'יתבהר אחר כך'. תחזרו אחורה ותקשיבו שוב לקטע הספציפי.",
  "ייצוא התמליל ל-Word/TXT מאפשר לכם לסמן ולהדגיש טקסט בקלות, ולהשתמש בו כבסיס לסיכום מסודר.",
];
// feature tips surface once the user has content — they point at app capabilities, not study habits
const FEATURE_TIPS = [
  "אפשר לערוך כל שורת תמליל ישירות בנגן ולשמור — מתקנים טעות תמלול בקליק.",
  "החיפוש למעלה סורק את כל הכתוביות בכל ההרצאות — מצאו רגע ספציפי בלי לגלול בווידאו.",
  "ייצוא התמליל ל-Word/TXT הופך אותו לבסיס מצוין לסיכום מסודר.",
  "ארגנו הרצאות לקורסים מתפריט הצד (☰) כדי למצוא אותן מהר אחר כך.",
  "אפשר לתמלל כמה הרצאות בבת אחת — הוסיפו אותן לתור ותנו להן לרוץ ברקע.",
];
let _lastTip = "";
function pickFrom(pool) {
  let t;
  do { t = pool[Math.floor(Math.random() * pool.length)]; } while (t === _lastTip && pool.length > 1);
  _lastTip = t;
  return t;
}
// home tip: alternates between study tips and app-usage tips, with a matching label
function showRandomTip() {
  if (!library.lectures.length) {
    $("tipKicker").textContent = "טיפ";
    $("tipText").textContent = "התחילו בתמלול ההרצאה הראשונה — גררו קובץ או הדביקו קישור למעלה.";
    return;
  }
  const feature = Math.random() < 0.5;
  $("tipKicker").textContent = feature ? "טיפ שימוש" : "טיפ ללמידה";
  $("tipText").textContent = pickFrom(feature ? FEATURE_TIPS : LEARNING_TIPS);
}
$("tipNext").addEventListener("click", showRandomTip);

// rotating tips on the processing screen — make the wait feel shorter (like a game's loading screen).
// here we also surface feature tips (edit/search/export) since the user is mid-flow.
let _procTipTimer = null;
function startProcTips() {
  const pool = LEARNING_TIPS.concat(FEATURE_TIPS);
  const set = () => { $("procTipText").textContent = pickFrom(pool); };
  set();
  $("procTip").hidden = false;
  clearInterval(_procTipTimer);
  _procTipTimer = setInterval(set, 15000);
}
function stopProcTips() {
  clearInterval(_procTipTimer); _procTipTimer = null;
  $("procTip").hidden = true;
}

// ── resume position (persisted in Python — localStorage doesn't survive pywebview restarts) ──
// resumeData mirrors the backend file so getResume() stays synchronous; writes are fire-and-forget.
let resumeData = { last: "", positions: {} };
function saveResume(video, pos, dur) {
  if (!video || !isFinite(pos) || pos < 3) return;   // ignore the first few seconds
  resumeData.positions[video] = { pos, dur: dur || 0 };
  resumeData.last = video;
  try { window.pywebview.api.save_resume(video, pos, dur || 0); } catch (e) {}
}
function getResume(video) {
  return (resumeData.positions && resumeData.positions[video]) || null;
}

// shared grouping used by the sidebar drawer and the home "recent courses" row
function lecturesByCourse() {
  const by = {};
  for (const c of library.courses) by[c] = [];
  for (const l of library.lectures) (by[l.course || ""] = by[l.course || ""] || []).push(l);
  return by;
}

function renderWidgets() {
  const wrap = $("statWidgets");
  wrap.innerHTML = "";
  const total = library.lectures.length;
  if (!total) return;
  const viewed = library.lectures.filter((l) => l.viewed).length;
  const firstUnwatched = library.lectures.find((l) => !l.viewed && !l.missing);
  const items = [
    { ic: "i-film", num: total, lbl: "הרצאות", act: openDrawer },
    { ic: "i-eye", num: viewed, lbl: "נצפו", act: openDrawer },
    { ic: "i-clock", num: total - viewed, lbl: "ממתינות",
      act: () => (firstUnwatched ? openLecture(firstUnwatched.video) : openDrawer()) },
    { ic: "i-library", num: library.courses.length, lbl: "קורסים", act: () => show("library") },
  ];
  for (const s of items) {
    const el = document.createElement("button");
    el.className = "widget";
    el.innerHTML = `<div class="w-ic"><svg class="ic-lg"><use href="#${s.ic}"/></svg></div>` +
      `<div class="w-num">${s.num}</div><div class="w-lbl">${esc(s.lbl)}</div>`;
    el.onclick = s.act;
    wrap.appendChild(el);
  }
}

function renderResume() {
  const card = $("resumeCard");
  const video = resumeData.last || "";
  const lec = video && library.lectures.find((l) => l.video === video);
  const r = lec && !lec.missing && getResume(video);   // don't offer resume for an unreachable file
  if (!lec || !r) { card.hidden = true; return; }
  card.hidden = false;
  $("resumeTitle").textContent = lec.title;
  $("resumeFill").style.width = (r.dur ? Math.min(100, (r.pos / r.dur) * 100) : 0) + "%";
  $("resumeWatch").onclick = () => openLecture(video, r.pos);
  $("resumeEdit").onclick = () => openLecture(video, r.pos);
}

function renderHomeCourses() {
  const wrap = $("homeCoursesList");
  const by = lecturesByCourse();
  const named = library.courses.filter((c) => (by[c] || []).length).slice(0, 3);
  if (!named.length) { wrap.innerHTML = ""; return; }
  wrap.innerHTML = '<div class="hc-label">קורסים אחרונים</div>';
  for (const name of named) {
    const chip = document.createElement("button");
    chip.className = "hc-chip";
    chip.innerHTML = `<span class="hc-name">${esc(name)}</span><span class="hc-count">${by[name].length}</span>`;
    chip.onclick = () => { show("library"); openLibraryCourse(name); };
    wrap.appendChild(chip);
  }
}

async function refreshHome() {
  await refreshLibrary();
  renderWidgets();
  renderResume();
  renderHomeCourses();
  showRandomTip();
}

// hero: both routes lead to the upload screen (where course + language are chosen); link focuses the URL box
$("heroFile").addEventListener("click", () => show("open"));
$("heroLink").addEventListener("click", () => { show("open"); setTimeout(() => $("urlIn").focus(), 50); });

// ── floating action menu (rename / move to course / open in browser / remove) ──
// used both in sidebar lecture rows and the ⋯ button in the player.
function showActionMenu(anchorEl, video, course, title) {
  document.querySelectorAll(".actionmenu").forEach((m) => m.remove());

  const menu = document.createElement("div");
  menu.className = "actionmenu";

  const renBtn = document.createElement("button");
  renBtn.className = "am-item"; renBtn.textContent = "✏ שינוי שם";
  renBtn.onclick = async () => {
    menu.remove();
    const t = prompt("שם חדש להרצאה:", title || "");
    if (t && t.trim()) {
      await window.pywebview.api.rename_lecture(video, t.trim());
      if (currentVideo === video) $("playTitle").textContent = t.trim();
      refreshLibrary();
    }
  };
  menu.appendChild(renBtn);

  const moveRow = document.createElement("div");
  moveRow.className = "am-item am-move";
  const sel = document.createElement("select");
  // build options via DOM (not innerHTML) so course names containing a double-quote can't break
  // the value attribute — that truncation was creating phantom courses and wrong-course moves.
  const none = document.createElement("option");
  none.value = ""; none.textContent = "ללא קורס";
  sel.appendChild(none);
  for (const c of library.courses) {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  }
  sel.value = course || "";
  sel.onchange = async () => {
    menu.remove();
    try {
      await window.pywebview.api.set_lecture_course(video, sel.value);
    } catch (err) {
      // most likely the file is locked because it's open in the player right now
      alert("לא ניתן להעביר את ההרצאה כרגע. אם היא פתוחה בנגן — חזרו אחורה ונסו שוב.");
    }
    refreshLibrary();
  };
  moveRow.innerHTML = "<span>📁 קורס:</span>";
  moveRow.appendChild(sel);
  menu.appendChild(moveRow);

  // export the transcript without opening the lecture (reads the saved SRT in Python)
  const expRow = document.createElement("div");
  expRow.className = "am-item am-move";
  expRow.innerHTML = "<span>⬇ ייצוא תמליל:</span>";
  for (const [fmt, label] of [["txt", "TXT"], ["docx", "Word"]]) {
    const b = document.createElement("button");
    b.className = "am-exp"; b.textContent = label;
    b.onclick = async () => {
      menu.remove();
      const r = await window.pywebview.api.export_lecture(video, fmt);
      if (r && String(r).startsWith("ERR")) alert(String(r).replace(/^ERR:\s*/, ""));
    };
    expRow.appendChild(b);
  }
  menu.appendChild(expRow);

  const browseBtn = document.createElement("button");
  browseBtn.className = "am-item"; browseBtn.textContent = "🌐 פתיחה בדפדפן";
  browseBtn.onclick = async () => {
    menu.remove();
    const r = await window.pywebview.api.open_in_browser(video);
    if (r && String(r).startsWith("ERR")) alert(r);
  };
  menu.appendChild(browseBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "am-item am-danger"; delBtn.textContent = "🗑 הסרה";
  delBtn.onclick = async () => {
    menu.remove();
    const choice = await confirmModal({
      title: "הסרת ההרצאה",
      body: `"${title || "ההרצאה"}"\n\n• הסרה מהרשימה: ההרצאה יורדת מהספרייה, אבל קובץ הווידאו והכתוביות נשארים על הדיסק.\n• מחיקה כולל קבצים: מוחק לצמיתות גם את הווידאו, הכתוביות והנגן. אי אפשר לשחזר.`,
      buttons: [
        { label: "הסרה מהרשימה", value: "list" },
        { label: "מחיקה כולל קבצים", value: "files", danger: true },
      ],
    });
    if (!choice) return;
    await window.pywebview.api.remove_lecture(video, choice === "files");
    if (currentVideo === video) show("home");
    refreshLibrary();
  };
  menu.appendChild(delBtn);

  document.body.appendChild(menu);
  const r = anchorEl.getBoundingClientRect();
  let top = r.bottom + 4;   // flip above the anchor if the menu would overflow the window bottom
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 4);
  menu.style.top = top + "px";
  let left = r.right - menu.offsetWidth;
  left = Math.max(8, Math.min(left, window.innerWidth - menu.offsetWidth - 8));
  menu.style.left = left + "px";

  const closeOnOutside = (e) => {
    if (!menu.contains(e.target) && e.target !== anchorEl) {
      menu.remove();
      document.removeEventListener("click", closeOnOutside, true);
    }
  };
  document.addEventListener("click", closeOnOutside, true);
}

// subtitle appearance popover in the player — quicker to reach than the settings drawer, and the
// most natural place to adjust captions (you're looking right at them). Stays in sync with settings.
function showSubtitleMenu(anchorEl) {
  document.querySelectorAll(".actionmenu").forEach((m) => m.remove());
  const menu = document.createElement("div");
  menu.className = "actionmenu submenu";
  const cur = { size: document.body.dataset.subSize || "md", bg: document.body.dataset.subBg || "dark" };
  const groups = [
    { key: "size", label: "גודל", save: "subtitle_size", opts: [["sm", "קטן"], ["md", "בינוני"], ["lg", "גדול"]] },
    { key: "bg", label: "רקע", save: "subtitle_bg", opts: [["dark", "כהה"], ["light", "בהיר"], ["none", "ללא"]] },
  ];
  for (const g of groups) {
    const row = document.createElement("div");
    row.className = "sm-row";
    row.innerHTML = `<span class="sm-lbl">${g.label}</span>`;
    const opts = document.createElement("div");
    opts.className = "sm-opts";
    for (const [val, txt] of g.opts) {
      const b = document.createElement("button");
      b.className = "sm-opt" + (cur[g.key] === val ? " on" : "");
      b.textContent = txt;
      b.onclick = () => {
        cur[g.key] = val;
        applySubtitleStyle(cur.size, cur.bg);
        window.pywebview.api.save_settings({ [g.save]: val }).catch(() => {});
        $(g.key === "size" ? "settingsSubSize" : "settingsSubBg").value = val;   // keep settings drawer in sync
        opts.querySelectorAll(".sm-opt").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
      };
      opts.appendChild(b);
    }
    row.appendChild(opts);
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  const r = anchorEl.getBoundingClientRect();
  let top = r.bottom + 4;   // flip above the anchor if the menu would overflow the window bottom
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 4);
  menu.style.top = top + "px";
  let left = r.right - menu.offsetWidth;
  left = Math.max(8, Math.min(left, window.innerWidth - menu.offsetWidth - 8));
  menu.style.left = left + "px";
  const closeOnOutside = (e) => {
    if (!menu.contains(e.target) && e.target !== anchorEl) {
      menu.remove();
      document.removeEventListener("click", closeOnOutside, true);
    }
  };
  document.addEventListener("click", closeOnOutside, true);
}
$("subBtn").addEventListener("click", (e) => { e.stopPropagation(); showSubtitleMenu($("subBtn")); });

// CC toggle — show/hide the native captions (language-neutral; no hardcoded language label)
$("ccToggle").addEventListener("click", () => {
  const tt = video.textTracks[0];
  if (!tt) return;
  const on = tt.mode !== "showing";
  tt.mode = on ? "showing" : "hidden";
  $("ccToggle").classList.toggle("off", !on);
});

// open a saved lecture in the player (reads SRT from disk). seekTo (seconds) is optional.
async function openLecture(path, seekTo) {
  let r;
  try { r = await window.pywebview.api.open_lecture(path); } catch (e) { return; }
  if (!r) return;
  cues = r.cues || [];
  currentVideo = r.video;
  // auto-resume: if opened without an explicit position, continue from where we stopped last time
  if (seekTo == null) {
    const saved = getResume(currentVideo);
    if (saved && saved.pos > 3 && (!saved.dur || saved.pos < saved.dur - 15)) seekTo = saved.pos;
  }
  video.src = await window.pywebview.api.media_url(currentVideo);
  setReturnView(currentView);
  setPlayTitle(currentVideo);
  closeDrawer();
  show("play");
  // attach the seek BEFORE load() — otherwise loadedmetadata can fire first and the resume is lost
  if (seekTo != null) {
    video.addEventListener("loadedmetadata", () => { video.currentTime = seekTo; video.play(); }, { once: true });
  }
  video.load();
  buildVtt(cues);
  renderTranscript();
}

// ── global search (home screen) ──
let _searchTimer = null;
$("searchIn").addEventListener("input", () => {
  clearTimeout(_searchTimer);
  const q = $("searchIn").value.trim();
  if (!q) { $("searchResults").hidden = true; return; }
  _searchTimer = setTimeout(async () => {
    const results = await window.pywebview.api.search(q);
    renderSearchResults(results, q);
  }, 300);
});

function renderSearchResults(results, q) {
  const el = $("searchResults");
  el.innerHTML = "";
  if (!results.length) {
    el.innerHTML = `<div class="sr-empty">לא נמצאו תוצאות עבור "${esc(q)}"</div>`;
    el.hidden = false;
    return;
  }
  for (const r of results) {
    for (const hit of r.hits) {
      const row = document.createElement("div");
      row.className = "sr-hit";
      row.innerHTML =
        `<span class="sr-time">${clock(hit.start)}</span>` +
        `<div class="sr-body"><div class="sr-title">${esc(r.title)}</div>` +
        `<div class="sr-text">${esc(hit.text)}</div></div>`;
      row.onclick = () => {
        $("searchIn").value = "";
        el.hidden = true;
        openLecture(r.video, hit.start);
      };
      el.appendChild(row);
    }
  }
  el.hidden = false;
}

// ── sidebar open/close ──
function openDrawer() { $("drawer").hidden = false; $("drawerOv").hidden = false; refreshLibrary(); }
function closeDrawer() { $("drawer").hidden = true; $("drawerOv").hidden = true; }
$("menuBtn").addEventListener("click", openDrawer);
$("drawerClose").addEventListener("click", closeDrawer);
$("drawerOv").addEventListener("click", closeDrawer);

// ── create new course (inline input) ──
$("newCourseBtn").addEventListener("click", async () => {
  const inp = $("newCourseIn");
  if (inp.hidden) { inp.hidden = false; inp.focus(); return; }
  await createCourseNamed(inp.value, { expand: true });
  inp.value = ""; inp.hidden = true;
});
$("newCourseIn").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("newCourseBtn").click();
  if (e.key === "Escape") { $("newCourseIn").value = ""; $("newCourseIn").hidden = true; }
});

// ── create a course inline on the upload screen (same mechanism, auto-selects the new course) ──
$("courseAddBtn").addEventListener("click", () => {
  const row = $("courseAddRow");
  row.hidden = !row.hidden;
  if (!row.hidden) $("courseAddIn").focus();
});
async function createCourseInline() {
  await createCourseNamed($("courseAddIn").value, { select: true });   // auto-select for this upload
  $("courseAddIn").value = ""; $("courseAddRow").hidden = true;
}
$("courseAddOk").addEventListener("click", createCourseInline);
$("courseAddIn").addEventListener("keydown", (e) => {
  if (e.key === "Enter") createCourseInline();
  if (e.key === "Escape") { $("courseAddIn").value = ""; $("courseAddRow").hidden = true; }
});

// ── player keyboard shortcuts (Space · ← · →) ──
// capture phase (true) — we intercept the arrows BEFORE the native <video> controls do, so we can
// cancel their own (much larger, duration-relative) seek and always skip exactly 10 seconds.
document.addEventListener("keydown", (e) => {
  if (currentView !== "play") return;
  const ae = document.activeElement;
  if (ae && (ae.tagName === "INPUT" || ae.tagName === "SELECT" || ae.isContentEditable)) return;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault(); e.stopImmediatePropagation();   // kill the native player's default seek
    const step = e.key === "ArrowLeft" ? -10 : 10;
    video.currentTime = Math.min(video.duration || Infinity, Math.max(0, video.currentTime + step));
    return;
  }
  // let the native player own other keys (space etc.) when it's focused
  if (ae === video) return;
  if (e.key === " ") { e.preventDefault(); video.paused ? video.play() : video.pause(); }
}, true);

show("home");
