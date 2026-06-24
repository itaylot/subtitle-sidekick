// service-worker.js — Orchestrator (background)
//
// אחריות: לתזמר את הלכידה. מקבל בקשות מ-content/popup, קורא ל-tabCapture,
// מנהל את ה-offscreen document, ומנתב הודעות בין offscreen ל-content.
//
// ⚠️ לא שומרים כאן state קריטי של מדיה — ה-service worker יכול להירדם.
//    כל לוגיקת האודיו חיה ב-offscreen (שלא נרדם בזמן עיבוד אודיו).

const OFFSCREEN_PATH = 'offscreen.html';

// ברירות מחדל אם אין הגדרות שמורות ב-storage
// ⚠️ רמה B (הפצה): שנה את ה-endpoint ל-`wss://<your-server>` של השרת המשותף
//    לפני אריזה לחנות, כדי שמשתמשים לא יצטרכו להגדיר ידנית. ראה GOAL_LEVEL_B.md.
const DEFAULT_CONFIG = {
  endpoint: 'ws://localhost:9090',
  language: 'he',
};

// איזה טאב כרגע בלכידה (לניתוב + עצירה). best-effort בלבד — לא לסמוך עליו אם ה-SW נרדם.
let activeTabId = null;

// ── ניהול offscreen document ──────────────────────────────
async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  // reason: USER_MEDIA כי אנחנו צורכים getUserMedia (tab capture) ב-offscreen.
  // אם גרסת Chrome לא מכירה אותו — נופלים ל-AUDIO_PLAYBACK (לכידת/עיבוד אודיו).
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['USER_MEDIA'],
      justification: 'Capturing tab audio for real-time Hebrew subtitles',
    });
  } catch (e) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Capturing tab audio for real-time Hebrew subtitles',
    });
  }
}

// בונה את אובייקט ה-Config (חוזה A) מ-storage + ערכים קבועים
async function getConfig() {
  const stored = await chrome.storage.sync.get(['endpoint', 'language']);
  return {
    endpoint: stored.endpoint || DEFAULT_CONFIG.endpoint,
    language: stored.language || DEFAULT_CONFIG.language,
    sampleRate: 16000, // קבוע — תואם Whisper/VAD (חוזה B)
    encoding: 'pcm_s16le', // קבוע (חוזה B)
  };
}

// ── התחלת לכידה ───────────────────────────────────────────
async function startCapture(tabId) {
  await ensureOffscreen();

  // ⚠️ streamId חד-פעמי, פג תוך שניות — חייבים להשתמש בו מיד ב-offscreen.
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

  const config = await getConfig();
  config.tabId = tabId; // כדי שה-offscreen ידע לאן להחזיר TRANSCRIPT

  chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'START',
    streamId,
    config,
  });

  activeTabId = tabId;
  notifyState(tabId, true);
}

function stopCapture() {
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP' });
  if (activeTabId != null) notifyState(activeTabId, false);
  activeTabId = null;
}

// מעדכן את ה-content (וכך גם את הכפתור) על מצב הלכידה
function notifyState(tabId, active) {
  chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_STATE', active }).catch(() => {});
}

// ── מאזין הודעות ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // tabId: מ-content מגיע ב-sender.tab.id; מ-popup מגיע מפורש ב-msg.tabId.
  const tabId = msg.tabId != null ? msg.tabId : sender.tab && sender.tab.id;

  if (msg.type === 'START_CAPTURE') {
    if (tabId != null) {
      startCapture(tabId).catch((e) => console.error('[sw] startCapture failed', e));
    }
  } else if (msg.type === 'STOP_CAPTURE') {
    stopCapture();
  } else if (msg.type === 'TRANSCRIPT' && msg.from === 'offscreen') {
    // נתב כתובית חזרה ל-content בטאב הנכון
    chrome.tabs
      .sendMessage(msg.tabId, {
        type: 'SHOW_SUBTITLE',
        text: msg.text,
        isFinal: msg.isFinal,
      })
      .catch(() => {});
  } else if (msg.type === 'CAPTURE_ENDED' && msg.from === 'offscreen') {
    // הלכידה הסתיימה בצד offscreen (ws נסגר/שגיאה/STOP) — עדכן UI
    if (msg.tabId != null) notifyState(msg.tabId, false);
    if (msg.tabId === activeTabId) activeTabId = null;
  } else if (msg.type === 'CAPTURE_STATUS' && msg.from === 'offscreen') {
    // סטטוס חיבור (מתחבר/מחובר/מתחבר מחדש/שגיאה) → הצג הודעה ב-content
    if (msg.tabId != null) {
      chrome.tabs
        .sendMessage(msg.tabId, { type: 'SHOW_NOTICE', status: msg.status, text: msg.message })
        .catch(() => {});
    }
  } else if (msg.type === 'GET_STATE') {
    // popup שואל מה המצב הנוכחי
    sendResponse({ active: activeTabId != null, activeTabId });
    return true; // תשובה אסינכרונית
  }
  return false;
});

// אם הטאב שבלכידה נסגר — עצור
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) stopCapture();
});
