// app.js — חיבור ה-UI ל-Python (pywebview): תור תמלולים, נגן מסונכרן, מסך מלא.

const $ = (id) => document.getElementById(id);
let fastMode = false;

// תור: כל פריט { path, name, status:'wait'|'proc'|'done'|'err', res }
let queue = [];
let processing = false;

// ── מעבר בין מסכים ──
function show(view) {
  for (const id of ["view-open", "view-proc", "view-play"]) {
    $(id).hidden = id !== "view-" + view;
  }
}

// ── מצב בהיר/כהה ──
function applyTheme(t) {
  document.body.classList.toggle("dark", t === "dark");
  try { localStorage.setItem("theme", t); } catch (e) {}
}
$("themeBtn").addEventListener("click", () =>
  applyTheme(document.body.classList.contains("dark") ? "light" : "dark"));
applyTheme(localStorage.getItem("theme") || "light");

// ── מצב מהיר ──
$("fastToggle").addEventListener("click", () => {
  fastMode = !fastMode;
  $("fastSw").classList.toggle("on", fastMode);
});

// ── בחירת קובץ (ריבוי) ──
async function pickAndStart() {
  const res = await window.pywebview.api.pick_file();
  if (res) window.enqueueFiles(Array.isArray(res) ? res : [res]);
}
$("pickBtn").addEventListener("click", (e) => { e.stopPropagation(); pickAndStart(); });
$("drop").addEventListener("click", pickAndStart);

// ── הורדה מקישור ──
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
  $("bar2").classList.remove("loading");
  $("stageHeading").textContent = "מוריד את ההרצאה…";
  const pct = p.percent || 0;
  $("fill").style.width = pct + "%";
  $("pct").textContent = pct + "%";
  $("eta").textContent = p.status === "finished" ? "ההורדה הושלמה — מתחיל תמלול…" : "מוריד מהאינטרנט…";
};

// ── גרירה (הטיפול בקובץ ב-Python; כאן ויזואל בלבד) ──
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());
const drop = $("drop");
drop.addEventListener("dragenter", (e) => { e.preventDefault(); drop.classList.add("drag"); });
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("drag"); });
drop.addEventListener("mouseenter", () => drop.classList.add("hover"));
drop.addEventListener("mouseleave", () => drop.classList.remove("hover"));

// ── תור ──
window.enqueueFiles = function (paths) {
  for (const p of paths) {
    if (!p || queue.some((q) => q.path === p)) continue;
    queue.push({ path: p, name: p.split(/[\\/]/).pop(), status: "wait", res: null });
  }
  renderQueue();
  show("proc");
  if (!processing) processNext();
};

function processNext() {
  const item = queue.find((q) => q.status === "wait");
  if (!item) {
    processing = false;
    $("stageHeading").textContent = queue.length > 1 ? "כל ההרצאות מוכנות ✓" : "הכתוביות מוכנות ✓";
    $("eta").textContent = "בחרו הרצאה מהרשימה כדי לצפות, או גררו עוד קבצים.";
    $("fill").style.width = "100%"; $("pct").textContent = "100%";
    resetSteps(true);
    return;
  }
  processing = true;
  item.status = "proc";
  const idx = queue.filter((q) => q.status === "done").length + 1;
  $("procName").textContent = (queue.length > 1 ? `(${idx}/${queue.length}) ` : "") + item.name;
  $("fill").style.width = "0"; $("pct").textContent = "0%"; $("eta").textContent = "";
  resetSteps();
  renderQueue();
  window.pywebview.api.start(item.path, fastMode);
}

function resetSteps(allDone) {
  for (const s of ["extract", "transcribe", "sync"]) {
    const el = $("step-" + s);
    el.className = "step" + (allDone ? " done" : "");
    el.textContent = (allDone ? "✓ " : "") + { extract: "אודיו", transcribe: "תמלול", sync: "סנכרון" }[s];
  }
}

function renderQueue() {
  if (queue.length < 2 && !queue.some((q) => q.status === "done")) { $("queue").innerHTML = ""; return; }
  $("queue").innerHTML = "";
  const ICON = { wait: "•", proc: "●", done: "✓", err: "✕" };
  queue.forEach((q, i) => {
    const row = document.createElement("div");
    row.className = "qitem " + q.status;
    row.innerHTML = `<span class="qicon">${ICON[q.status]}</span><span class="qname">${esc(q.name)}</span>`;
    if (q.status === "done") {
      const b = document.createElement("button");
      b.className = "qwatch"; b.textContent = "▶ צפה";
      b.onclick = () => watchItem(i);
      row.appendChild(b);
    }
    $("queue").appendChild(row);
  });
}
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

const STAGE_HEAD = {
  extract: "מכין את האודיו…",
  transcribe: "מתמלל את ההרצאה לעברית…",
  sync: "מסנכרן את הכתוביות…",
};
const STAGE_ORDER = ["extract", "transcribe", "sync"];

// ── עדכון התקדמות (נקרא מ-Python) ──
window.onProgress = function (p) {
  $("stageHeading").textContent = STAGE_HEAD[p.stage] || "";
  const idx = STAGE_ORDER.indexOf(p.stage);
  STAGE_ORDER.forEach((s, i) => {
    const lbl = { extract: "אודיו", transcribe: "תמלול", sync: "סנכרון" }[s];
    $("step-" + s).className = "step" + (i < idx ? " done" : i === idx ? " now" : "");
    $("step-" + s).textContent = (i < idx ? "✓ " : "") + lbl;
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

// ── סיום קובץ → המשך לתור ──
window.onDone = function (res) {
  const cur = queue.find((q) => q.status === "proc");
  if (cur) { cur.status = "done"; cur.res = res; }
  renderQueue();
  processNext();
  // אם זה הקובץ היחיד — פתח אותו ישר בנגן
  if (queue.length === 1 && cur) watchItem(0);
};

window.onError = function (msg) {
  const cur = queue.find((q) => q.status === "proc");
  if (cur) cur.status = "err";
  $("eta").textContent = "שגיאה: " + (msg || "");
  $("bar2").classList.remove("loading");
  renderQueue();
  processNext();
};

// ── נגן ──
const video = $("video");
const screenEl = document.querySelector(".screen");
let cues = [];
let currentVideo = null;
let rowEls = [];
let curRow = -1;

function watchItem(i) {
  const it = queue[i];
  if (!it || !it.res) return;
  cues = it.res.cues || [];
  currentVideo = it.res.video;
  video.src = "file:///" + currentVideo.replace(/\\/g, "/");
  show("play");
  video.load();
  renderTranscript();
}

// ── פאנל תמליל: עריכה + קפיצה ──
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

// חיפוש
$("tcSearch").addEventListener("input", (e) => {
  const q = e.target.value.trim();
  rowEls.forEach((row, idx) => {
    row.hidden = q && !cues[idx].text.includes(q);
  });
});

// שמירת עריכות
$("saveBtn").addEventListener("click", async () => {
  $("tcStatus").textContent = "שומר…";
  const r = await window.pywebview.api.save_srt(currentVideo, cues);
  $("tcStatus").textContent = r === true ? "✓ הכתוביות נשמרו" : "שגיאה: " + r;
});

// ייצוא
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
      // גלילה רק אם לא עורכים כרגע
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

// מסך מלא על המכל (לא על ה-video) — כך הכתובית נשארת מוצגת
$("fsBtn").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (screenEl.requestFullscreen) screenEl.requestFullscreen();
});

$("backBtn").addEventListener("click", () => {
  video.pause();
  show("proc");
});

function clock(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

show("open");
