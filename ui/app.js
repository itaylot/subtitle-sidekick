// app.js — UI ↔ Python bridge (pywebview): transcription queue, synced player, fullscreen.

// capture JS errors → crash.log for diagnostics
function _log(m) { try { window.pywebview.api.log(m); } catch (e) {} }
window.onerror = (m, s, l, c) => _log(`onerror: ${m} @${l}:${c}`);
window.addEventListener("unhandledrejection", (e) => _log("reject: " + e.reason));

const $ = (id) => document.getElementById(id);

// queue: each job { id, sourcePath, name, courseName, status:'queued'|'running'|'done'|'failed', error, createdAt, res }
// JS owns the queue state; Python is a worker + persists it (engine.save_queue/load_queue).
let queue = [];
let processing = false;
let lastError = "";

// ── screen switching ──
let currentView = "home";
function show(view) {
  for (const id of ["view-home", "view-open", "view-proc", "view-play"]) {
    $(id).hidden = id !== "view-" + view;
  }
  currentView = view;
  if (view === "home") refreshHome();
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

// ── light / dark theme ──
function applyTheme(t) {
  document.body.classList.toggle("dark", t === "dark");
  try { localStorage.setItem("theme", t); } catch (e) {}
}
$("themeBtn").addEventListener("click", () =>
  applyTheme(document.body.classList.contains("dark") ? "light" : "dark"));
applyTheme(localStorage.getItem("theme") || "light");

// ── window buttons (the colored dots) ──
$("winClose").addEventListener("click", () => window.pywebview.api.win_close());
$("winMin").addEventListener("click", () => window.pywebview.api.win_minimize());
$("winFull").addEventListener("click", () => window.pywebview.api.win_fullscreen());

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
    renderCost(cloud);
  });
}
$("settingsLibDirBtn").addEventListener("click", async () => {
  const dir = await window.pywebview.api.pick_folder();
  if (!dir) return;
  $("settingsLibDir").value = dir;
  await window.pywebview.api.save_settings({ library_dir: dir });
  $("settingsStatus").textContent = "תיקיית הספרייה עודכנה ✓";
});
function renderCost(cloud) {
  const secs = Number(cloud.total_seconds) || 0;
  $("costTotal").textContent = fmtCost(cloud.total_cost);
  const mins = Math.round(secs / 60);
  $("costSub").textContent = secs > 0
    ? `${mins} דקות עיבוד מצטבר על השרת`
    : "טרם בוצע תמלול בשרת";
}
function closeSettingsDrawer() { $("settingsDrawer").hidden = true; $("settingsOv").hidden = true; }
$("cloudSettingsBtn").addEventListener("click", openSettingsDrawer);
$("homeSettings").addEventListener("click", openSettingsDrawer);
$("settingsClose").addEventListener("click", closeSettingsDrawer);
$("settingsOv").addEventListener("click", closeSettingsDrawer);
$("settingsSaveBtn").addEventListener("click", () => {
  const endpoint_url = $("settingsEndpoint").value.trim();
  const api_key = $("settingsKey").value.trim();
  const price_per_hour = parseFloat($("settingsPrice").value) || 0;
  window.pywebview.api.save_settings({ cloud: { endpoint_url, api_key, price_per_hour } })
    .then(() => { $("settingsStatus").textContent = "נשמר ✓"; });
});
$("costReset").addEventListener("click", () => {
  window.pywebview.api.save_settings({ cloud: { total_seconds: 0, total_cost: 0 } })
    .then((s) => renderCost((s && s.cloud) || {}));
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
    applyPrivNote();
  }).catch(() => {});

  // crash recovery: resume any queue left over from a previous run (runs in background)
  Promise.resolve(refreshLibrary()).finally(() => {
    window.pywebview.api.load_queue().then((jobs) => {
      if (!Array.isArray(jobs) || !jobs.length) return;
      queue = jobs.map((j) => ({ ...j, name: j.sourcePath.split(/[\\/]/).pop(), res: null }));
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
  // res/name are runtime-only; persist just the schema fields
  return queue.map(({ id, sourcePath, courseName, status, error, createdAt }) =>
    ({ id, sourcePath, courseName, status, error: error || null, createdAt }));
}
let _saveTimer = null;
function saveQueueSoon() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try { window.pywebview.api.save_queue(serializeQueue()); } catch (e) {}
  }, 300);
}

// ── queue ──
window.enqueueFiles = function (paths) {
  const course = $("courseSel").value || "";  // current course = destination folder for this batch
  for (const p of paths) {
    if (!p || queue.some((q) => q.sourcePath === p)) continue;
    queue.push({
      id: crypto.randomUUID(),
      sourcePath: p,
      name: p.split(/[\\/]/).pop(),
      courseName: course,
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

async function processNext() {
  const item = queue.find((q) => q.status === "queued");
  if (!item) {
    processing = false;
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
  saveQueueSoon();
  const idx = queue.filter((q) => q.status === "done").length + 1;
  $("procName").textContent = (queue.length > 1 ? `(${idx}/${queue.length}) ` : "") + item.name;
  $("fill").style.width = "0"; $("pct").textContent = "0%"; $("eta").textContent = "";
  resetSteps();
  renderQueue();
  setJobCtrl(!cloudCfg);  // pause/cancel only apply to local transcription (cloud is a single fast call)
  window.pywebview.api.start(item.sourcePath, fast, item.courseName || "", cloudCfg);
}

// ── pause / cancel controls for the running local job ──
let paused = false;
function setJobCtrl(show) {
  $("jobCtrl").hidden = !show;
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
$("cancelBtn").addEventListener("click", () => {
  const ok = confirm(
    "לבטל את התמלול הנוכחי?\n\n" +
    "ההתקדמות עד כה תימחק ולא תישמר — תצטרכו להתחיל את ההרצאה הזו מחדש. " +
    "שאר ההרצאות בתור ימשיכו כרגיל.");
  if (!ok) return;
  cancelling = true;                       // suppress further progress + show immediate feedback
  $("jobCtrl").hidden = true;
  $("stageHeading").textContent = "מבטל…";
  $("eta").textContent = "";
  $("bar2").classList.remove("loading");
  window.pywebview.api.cancel();
});

const STAGE_LABEL = { extract: "אודיו", transcribe: "תמלול", sync: "סנכרון" };
const STAGE_HEAD = {
  extract: "מכין את האודיו…",
  transcribe: "מתמלל את ההרצאה לעברית…",
  sync: "מסנכרן את הכתוביות…",
};
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

    if (q.status === "done") {
      const b = document.createElement("button");
      b.className = "qwatch"; b.textContent = "▶ צפה";
      b.onclick = () => watchItem(queue.indexOf(q));
      row.appendChild(b);
    }
    wrap.appendChild(row);
  });
}
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

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
    $("eta").textContent = "טוען את המודל העברי (בפעם הראשונה מוריד, כמה דקות)…";
    return;
  }
  $("bar2").classList.remove("loading");

  if (p.stage === "transcribe" || p.stage === "sync") {
    if (typeof p.percent === "number") {
      $("fill").style.width = p.percent + "%";
      $("pct").textContent = p.percent + "%";
      updateJobPill(p.percent);
    }
    if (p.eta != null && p.eta > 0) {
      $("eta").textContent = "נותרו בערך " + fmtEta(p.eta) + " — אפשר להשאיר את זה רץ ברקע";
    }
  }
};

function fmtEta(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m}:${String(s).padStart(2, "0")} דקות` : `${s} שניות`;
}

// ── file done → advance queue ──
window.onDone = function (res) {
  const cur = queue.find((q) => q.status === "running");
  if (cur) { cur.status = "done"; cur.res = res; }
  renderQueue();
  saveQueueSoon();
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
  lastError = msg || "";
  _log("UI onError: " + lastError);
  const cur = queue.find((q) => q.status === "running");
  if (cur) { cur.status = "failed"; cur.error = lastError; }
  $("bar2").classList.remove("loading");
  renderQueue();
  saveQueueSoon();
  processNext();  // decides whether to show "ready" or "failed" based on queue state
};

// user cancelled the current job → drop it (no output was written) and continue with the rest
window.onCancelled = function () {
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
const video = $("video");
const screenEl = document.querySelector(".screen");
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
});

// export
async function doExport(fmt) {
  $("tcStatus").textContent = "מייצא…";
  const r = await window.pywebview.api.export(currentVideo, cues, fmt);
  $("tcStatus").textContent = r && r.startsWith("ERR") ? "שגיאה בייצוא" : "✓ נוצר: " + r;
}
$("txtBtn").addEventListener("click", () => doExport("txt"));
$("docxBtn").addEventListener("click", () => doExport("docx"));

$("playBtn").addEventListener("click", () => { video.paused ? video.play() : video.pause(); });
video.addEventListener("play", () => ($("playBtn").textContent = "⏸"));
video.addEventListener("pause", () => ($("playBtn").textContent = "▶"));

// skip 10 seconds forward/back
$("skipBack").addEventListener("click", () => {
  video.currentTime = Math.max(0, video.currentTime - 10);
});
$("skipFwd").addEventListener("click", () => {
  video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
});

// playback speed
$("speedSel").addEventListener("change", () => {
  video.playbackRate = parseFloat($("speedSel").value);
});

video.addEventListener("timeupdate", () => {
  const t = video.currentTime, d = video.duration || 0;
  const idx = cues.findIndex((c) => t >= c.start && t <= c.end);
  $("subline").textContent = idx >= 0 ? cues[idx].text : "";
  $("pfill").style.width = (d ? (t / d) * 100 : 0) + "%";
  $("tc").textContent = clock(t) + " / " + clock(d);
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

$("track").addEventListener("click", (e) => {
  const r = $("track").getBoundingClientRect();
  const frac = (r.right - e.clientX) / r.width; // RTL
  if (video.duration) video.currentTime = Math.min(1, Math.max(0, frac)) * video.duration;
});

// fullscreen on the container (not the video element) — keeps subtitle overlay visible
$("fsBtn").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (screenEl.requestFullscreen) screenEl.requestFullscreen();
});
// exit button visible inside fullscreen — not everyone remembers ESC
$("exitFs").addEventListener("click", () => document.exitFullscreen());
document.addEventListener("fullscreenchange", () => {
  $("exitFs").hidden = document.fullscreenElement !== screenEl;
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
      `<span class="course-name">${esc(name || "ללא קורס")}</span>` +
      `<span class="course-count">${lecs.length}</span>`;
    if (name) {
      const del = document.createElement("button");
      del.className = "course-del"; del.textContent = "🗑"; del.title = "מחיקת קורס";
      del.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`למחוק את הקורס "${name}"? ההרצאות יעברו ל"ללא קורס" (הקבצים לא נמחקים).`)) return;
        await window.pywebview.api.remove_course(name);
        openCourses.delete(name);
        refreshLibrary();
      };
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
    for (const l of lecs) {
      const row = document.createElement("div");
      row.className = "lec";
      row.innerHTML = `<span class="lec-name">▶ ${esc(l.title)}</span>`;
      row.onclick = () => openLecture(l.video);

      const kebab = document.createElement("button");
      kebab.className = "kebab"; kebab.textContent = "⋯"; kebab.title = "פעולות";
      kebab.onclick = (e) => { e.stopPropagation(); showActionMenu(kebab, l.video, l.course, l.title); };
      row.appendChild(kebab);
      list.appendChild(row);
    }
    box.appendChild(list);
    wrap.appendChild(box);
  }
}

const openCourses = new Set();

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
let homeTipIdx = -1;
function showRandomTip() {
  if (LEARNING_TIPS.length <= 1) { homeTipIdx = 0; }
  else {
    let i;
    do { i = Math.floor(Math.random() * LEARNING_TIPS.length); } while (i === homeTipIdx);
    homeTipIdx = i;
  }
  $("tipText").textContent = LEARNING_TIPS[homeTipIdx];
}
$("tipNext").addEventListener("click", showRandomTip);

function renderStats() {
  const total = library.lectures.length;
  const viewed = library.lectures.filter((l) => l.viewed).length;
  const notViewed = total - viewed;
  const courses = library.courses.length;
  const items = [
    { num: total, lbl: "הרצאות שתומללו" },
    { num: courses, lbl: "קורסים" },
    { num: viewed, lbl: "הרצאות שנצפו" },
    { num: notViewed, lbl: "מחכות לצפייה" },
  ];
  $("statsGrid").innerHTML = items.map(
    (s) => `<div class="stat-box"><div class="stat-num">${s.num}</div><div class="stat-lbl">${esc(s.lbl)}</div></div>`
  ).join("");
}

function renderHomeActions() {
  const last = library.lectures[0];
  const btn = $("homeContinue");
  if (last) {
    $("homeContinueLabel").textContent = "המשך: " + last.title;
    btn.hidden = false;
    btn.onclick = () => openLecture(last.video);
  } else {
    btn.hidden = true;
  }
}

async function refreshHome() {
  await refreshLibrary();
  renderStats();
  renderHomeActions();
  showRandomTip();
}

$("homeNewLec").addEventListener("click", () => show("open"));
$("homeCourses").addEventListener("click", openDrawer);

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
  sel.innerHTML = '<option value="">ללא קורס</option>' +
    library.courses.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  sel.value = course || "";
  sel.onchange = async () => {
    await window.pywebview.api.set_lecture_course(video, sel.value);
    refreshLibrary();
  };
  moveRow.innerHTML = "<span>📁 קורס:</span>";
  moveRow.appendChild(sel);
  menu.appendChild(moveRow);

  const browseBtn = document.createElement("button");
  browseBtn.className = "am-item"; browseBtn.textContent = "🌐 פתיחה בדפדפן";
  browseBtn.onclick = async () => {
    menu.remove();
    const r = await window.pywebview.api.open_in_browser(video);
    if (r && String(r).startsWith("ERR")) alert(r);
  };
  menu.appendChild(browseBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "am-item am-danger"; delBtn.textContent = "🗑 הסרה מהרשימה";
  delBtn.onclick = async () => {
    menu.remove();
    await window.pywebview.api.remove_lecture(video);
    refreshLibrary();
  };
  menu.appendChild(delBtn);

  document.body.appendChild(menu);
  const r = anchorEl.getBoundingClientRect();
  menu.style.top = r.bottom + 4 + "px";
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

// open a saved lecture in the player (reads SRT from disk). seekTo (seconds) is optional.
async function openLecture(path, seekTo) {
  let r;
  try { r = await window.pywebview.api.open_lecture(path); } catch (e) { return; }
  if (!r) return;
  cues = r.cues || [];
  currentVideo = r.video;
  video.src = await window.pywebview.api.media_url(currentVideo);
  setReturnView(currentView);
  setPlayTitle(currentVideo);
  closeDrawer();
  show("play");
  video.load();
  renderTranscript();
  if (seekTo != null) {
    video.addEventListener("loadedmetadata", () => { video.currentTime = seekTo; video.play(); }, { once: true });
  }
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
  const name = inp.value.trim();
  if (name) {
    await window.pywebview.api.create_course(name);
    openCourses.add(name);
  }
  inp.value = ""; inp.hidden = true;
  refreshLibrary();
});
$("newCourseIn").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("newCourseBtn").click();
  if (e.key === "Escape") { $("newCourseIn").value = ""; $("newCourseIn").hidden = true; }
});

// ── player keyboard shortcuts (Space · ← · →) ──
document.addEventListener("keydown", (e) => {
  if (currentView !== "play") return;
  const ae = document.activeElement;
  if (ae && (ae.tagName === "INPUT" || ae.tagName === "SELECT" || ae.isContentEditable)) return;
  if (e.key === " ") { e.preventDefault(); video.paused ? video.play() : video.pause(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 10); }
  else if (e.key === "ArrowRight") { e.preventDefault(); video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10); }
});

show("home");
