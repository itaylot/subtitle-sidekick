// app.js — חיבור ה-UI ל-Python (pywebview): תור תמלולים, נגן מסונכרן, מסך מלא.

// תפיסת שגיאות JS → crash.log (לאבחון קריסות)
function _log(m) { try { window.pywebview.api.log(m); } catch (e) {} }
window.onerror = (m, s, l, c) => _log(`onerror: ${m} @${l}:${c}`);
window.addEventListener("unhandledrejection", (e) => _log("reject: " + e.reason));

const $ = (id) => document.getElementById(id);

// תור: כל פריט { path, name, status:'wait'|'proc'|'done'|'err', res }
let queue = [];
let processing = false;
let lastError = "";

// ── מעבר בין מסכים ──
function show(view) {
  for (const id of ["view-home", "view-open", "view-proc", "view-play"]) {
    $(id).hidden = id !== "view-" + view;
  }
  if (view === "home") refreshHome();
}
function currentView() {
  for (const v of ["home", "open", "proc", "play"]) if (!$("view-" + v).hidden) return v;
  return "home";
}
let returnView = "open";  // לאן "חזרה" בנגן תוביל — נקבע לפי המסך שהיינו בו לפני הפעלת ההרצאה
function setReturnView(v) {
  returnView = v;
  $("backBtn").title = v === "proc" ? "חזרה לתור" : "חזרה לרשימה";
}

// ── שבשבת תמלול-ברקע בסרגל העליון: גלוי מכל מסך, מאפשר לעבור ולחזור לתור ──
function updateJobPill(pct) {
  const pill = $("jobPill");
  pill.hidden = !processing;
  if (processing && typeof pct === "number") $("jobPct").textContent = pct + "%";
}
$("jobPill").addEventListener("click", () => show("proc"));
$("homeBtn").addEventListener("click", () => show("home"));

// ── מצב בהיר/כהה ──
function applyTheme(t) {
  document.body.classList.toggle("dark", t === "dark");
  try { localStorage.setItem("theme", t); } catch (e) {}
}
$("themeBtn").addEventListener("click", () =>
  applyTheme(document.body.classList.contains("dark") ? "light" : "dark"));
applyTheme(localStorage.getItem("theme") || "light");

// ── כפתורי חלון (הנקודות הצבעוניות) ──
$("winClose").addEventListener("click", () => window.pywebview.api.win_close());
$("winMin").addEventListener("click", () => window.pywebview.api.win_minimize());
$("winFull").addEventListener("click", () => window.pywebview.api.win_fullscreen());

// ── בורר מצב תמלול: מקומי-מדויק / מקומי-מהיר / שרת(ענן) ──
// נשמר/נטען מההגדרות כדי לזכור את הבחירה האחרונה.
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
  // אם החזרנו ממצב שרת ללא-קונפיג למצב מקומי בזמן שתור ממתין — להמשיך לתמלל
  if (mode !== "cloud" && !processing && queue.some((q) => q.status === "wait")) processNext();
});

// ── מגירת הגדרות שרת (Cloud GPU אישי) ──
function fmtCost(n) { return "$" + (Number(n) || 0).toFixed(2); }
function openSettingsDrawer() {
  $("settingsDrawer").hidden = false; $("settingsOv").hidden = false;
  $("settingsStatus").textContent = "";
  window.pywebview.api.get_settings().then((s) => {
    const cloud = (s && s.cloud) || {};
    $("settingsEndpoint").value = cloud.endpoint_url || "";
    $("settingsKey").value = cloud.api_key || "";
    $("settingsPrice").value = cloud.price_per_hour || "";
    renderCost(cloud);
  });
}
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

// מחזיר {endpoint_url, api_key} אם תקין, null אם לא במצב שרת, או undefined אם שרת לא מוגדר (ביטול)
async function resolveCloudCfg() {
  if ($("modeSel").value !== "cloud") return null;
  const s = await window.pywebview.api.get_settings();
  const cloud = (s && s.cloud) || {};
  if (!cloud.endpoint_url) {
    alert("הגדירו שרת לפני שימוש במצב 'שרת GPU (ענן)' — לחצו ⚙ הגדרות שרת.");
    return undefined;
  }
  return cloud;
}

// טעינת מצב התמלול השמור בעת עליית האפליקציה
window.addEventListener("pywebviewready", () => {
  window.pywebview.api.get_settings().then((s) => {
    if (s && s.transcription_mode) {
      const opt = [...$("modeSel").options].find((o) => o.value === s.transcription_mode);
      if (opt) $("modeSel").value = s.transcription_mode;
    }
    applyPrivNote();
  }).catch(() => {});
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
  $("stageHeading").textContent = "מוריד את ההרצאה…";
  const pct = p.percent || 0;
  if (p.status === "finished") {
    $("bar2").classList.remove("loading");
    $("fill").style.width = "100%"; $("pct").textContent = "100%";
    $("eta").textContent = "ההורדה הושלמה — מתחיל תמלול…";
  } else if (pct > 0) {
    // יודעים את הגודל — פס התקדמות אמיתי
    $("bar2").classList.remove("loading");
    $("fill").style.width = pct + "%"; $("pct").textContent = pct + "%";
    $("eta").textContent = "מוריד מהאינטרנט…";
  } else {
    // גודל לא ידוע (סטרימינג/Moodle) — פס "רץ" במקום 0% תקוע
    $("bar2").classList.add("loading");
    $("pct").textContent = "";
    $("eta").textContent = "מוריד מהאינטרנט…";
  }
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

async function processNext() {
  const item = queue.find((q) => q.status === "wait");
  if (!item) {
    processing = false;
    const doneCount = queue.filter((q) => q.status === "done").length;
    const errCount = queue.filter((q) => q.status === "err").length;
    if (doneCount > 0) {
      // יש לפחות הרצאה אחת מוכנה
      $("stageHeading").textContent = doneCount > 1 ? "ההרצאות מוכנות ✓" : "הכתוביות מוכנות ✓";
      $("eta").textContent = errCount
        ? `${errCount} מתוך ${doneCount + errCount} נכשלו — השאר מוכנות.`
        : "בחרו הרצאה כדי לצפות, או גררו עוד קבצים.";
      $("fill").style.width = "100%"; $("pct").textContent = "100%";
      resetSteps(true);
      $("watchDone").hidden = false;
      updateJobPill();
    } else {
      // הכל נכשל — להציג את השגיאה במקום "מוכנות"
      $("stageHeading").textContent = "התמלול נכשל ✕";
      $("eta").textContent = lastError || "אירעה שגיאה. בדקו את crash.log לפרטים.";
      $("fill").style.width = "0"; $("pct").textContent = "";
      $("bar2").classList.remove("loading");
      $("watchDone").hidden = true;
      updateJobPill();
    }
    return;
  }
  const cloudCfg = await resolveCloudCfg();
  if (cloudCfg === undefined) {
    // מצב שרת בלי קונפיג — לא מתחילים, נותנים למשתמש לבחור מצב אחר או להגדיר שרת
    return;
  }
  const fast = $("modeSel").value === "local_fast";
  processing = true;
  $("watchDone").hidden = true;
  updateJobPill(0);
  item.status = "proc";
  const idx = queue.filter((q) => q.status === "done").length + 1;
  $("procName").textContent = (queue.length > 1 ? `(${idx}/${queue.length}) ` : "") + item.name;
  $("fill").style.width = "0"; $("pct").textContent = "0%"; $("eta").textContent = "";
  resetSteps();
  renderQueue();
  window.pywebview.api.start(item.path, fast, $("courseSel").value || "", cloudCfg);
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

// ── סיום קובץ → המשך לתור ──
window.onDone = function (res) {
  const cur = queue.find((q) => q.status === "proc");
  if (cur) { cur.status = "done"; cur.res = res; }
  renderQueue();
  refreshLibrary();  // ההרצאה נרשמה ב-library — לרענן את התפריט
  processNext();     // יציג את מסך הסיום + כפתור "הפעל את הכתוביות"
};

// אינדקס ההרצאה המוכנה האחרונה (לכפתור "הפעל את הכתוביות")
function lastDoneIndex() {
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].status === "done") return i;
  return -1;
}
$("watchDone").addEventListener("click", () => {
  const i = lastDoneIndex();
  if (i >= 0) watchItem(i);
});

// "הרצאה חדשה" — חזרה למסך הפתיחה כדי לתמלל עוד, בלי לסגור את האפליקציה
$("newLec").addEventListener("click", () => show("open"));

window.onError = function (msg) {
  lastError = msg || "";
  _log("UI onError: " + lastError);
  const cur = queue.find((q) => q.status === "proc");
  if (cur) cur.status = "err";
  $("bar2").classList.remove("loading");
  renderQueue();
  processNext();  // יחליט אם להציג "מוכנות" או "נכשל" לפי המצב בתור
};

// ── נגן ──
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
  setReturnView(currentView());
  setPlayTitle(currentVideo);
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

// דילוג 10 שניות קדימה/אחורה
$("skipBack").addEventListener("click", () => {
  video.currentTime = Math.max(0, video.currentTime - 10);
});
$("skipFwd").addEventListener("click", () => {
  video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
});

// מהירות ניגון — תפריט גלילה
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
// כפתור יציאה גלוי בתוך מסך מלא — לא כולם זוכרים ESC
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

// ── ספריית הרצאות + תפריט צד ──
let library = { courses: [], lectures: [] };

// כותרת מסך הנגן — לפי הרישום ב-library, או שם הקובץ אם עדיין לא נרשם
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

// בורר הקורס במסך הפתיחה (שומר את הבחירה הנוכחית)
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

// רשימת הקורסים בתפריט הצד, כל אחד נפתח להרצאות שלו
function renderDrawer() {
  const wrap = $("coursesList");
  wrap.innerHTML = "";
  const byCourse = {};
  for (const c of library.courses) byCourse[c] = [];
  for (const l of library.lectures) {
    const key = l.course || "";
    (byCourse[key] = byCourse[key] || []).push(l);
  }
  // סדר: קורסים לפי שם, ואז "ללא קורס" בסוף (אם יש)
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

// ── מסך הבית: סטטיסטיקה + טיפ + פעולות מהירות ──
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

// ── תפריט פעולות צף (שינוי שם / העברה לקורס / פתיחה בדפדפן / הסרה) ──
// משמש גם בשורות ההרצאה בתפריט הצד וגם בכפתור ה-⋯ במסך הנגן.
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

// פתיחת הרצאה שמורה בנגן (קורא את ה-SRT מהדיסק)
async function openLecture(path) {
  let r;
  try { r = await window.pywebview.api.open_lecture(path); } catch (e) { return; }
  if (!r) return;
  cues = r.cues || [];
  currentVideo = r.video;
  video.src = await window.pywebview.api.media_url(currentVideo);
  setReturnView(currentView());
  setPlayTitle(currentVideo);
  closeDrawer();
  show("play");
  video.load();
  renderTranscript();
}

// ── פתיחה/סגירה של התפריט ──
function openDrawer() { $("drawer").hidden = false; $("drawerOv").hidden = false; refreshLibrary(); }
function closeDrawer() { $("drawer").hidden = true; $("drawerOv").hidden = true; }
$("menuBtn").addEventListener("click", openDrawer);
$("drawerClose").addEventListener("click", closeDrawer);
$("drawerOv").addEventListener("click", closeDrawer);

// ── יצירת קורס חדש (קלט inline) ──
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

show("home");
