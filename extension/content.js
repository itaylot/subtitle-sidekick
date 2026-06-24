// content.js — UI בדף: כפתור צף + overlay כתוביות + באנר סטטוס.
//
// עובד מול חוזה A (צד content) בלבד. לא נוגע באודיו.
//  - לחיצה על הכפתור → START_CAPTURE / STOP_CAPTURE.
//  - SHOW_SUBTITLE → כתובית (interim אפור / final לבן, RTL).
//  - SHOW_NOTICE   → באנר סטטוס (מתחבר / מתחבר מחדש / שגיאה).
//  - CAPTURE_STATE → סנכרון הכפתור + חיווט עצירה אוטומטית לסרטון.

(function () {
  if (window.__mhsInjected) return; // מניעת הזרקה כפולה
  window.__mhsInjected = true;

  let capturing = false;
  let btn, overlay, line, notice, hideTimer, noticeTimer;
  let videoEl = null;
  let watchedVideo = null; // הסרטון שאליו חיברנו מאזיני pause/ended

  // הגדרות תצוגה (נשמרות ע"י options ב-chrome.storage.sync)
  let fontSize = 28;
  let positionMode = 'bottom'; // 'bottom' | 'middle'

  // ── בניית ה-UI ─────────────────────────────────────────
  function buildUI() {
    btn = document.createElement('button');
    btn.className = 'mhs-button';
    btn.type = 'button';
    btn.addEventListener('click', toggleCapture);

    overlay = document.createElement('div');
    overlay.className = 'mhs-overlay';
    overlay.dir = 'rtl';
    overlay.style.display = 'none';
    line = document.createElement('span');
    line.className = 'mhs-line';
    overlay.appendChild(line);

    notice = document.createElement('div');
    notice.className = 'mhs-notice';
    notice.dir = 'rtl';
    notice.style.display = 'none';

    document.body.appendChild(btn);
    document.body.appendChild(overlay);
    document.body.appendChild(notice);
    setButtonLabel();
    applyFontSize();
  }

  function setButtonLabel() {
    btn.textContent = capturing ? '■ עצור כתוביות' : '▶ כתוביות';
    btn.classList.toggle('mhs-active', capturing);
  }

  function applyFontSize() {
    line.style.fontSize = fontSize + 'px';
  }

  function toggleCapture() {
    if (capturing) {
      chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' });
      capturing = false;
    } else {
      chrome.runtime.sendMessage({ type: 'START_CAPTURE' });
      capturing = true;
    }
    setButtonLabel();
  }

  // ── עצירה אוטומטית: כשהסרטון מושהה/נגמר → עצור לכידה ──────
  function onVideoStop() {
    if (capturing) {
      chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' });
      capturing = false;
      setButtonLabel();
    }
  }

  function watchVideo(v) {
    if (watchedVideo === v) return;
    unwatchVideo();
    if (!v) return;
    watchedVideo = v;
    // עוצרים רק כשהסרטון נגמר — לא בהשהיה (השהיה לא דורשת הפעלה מחדש)
    v.addEventListener('ended', onVideoStop);
  }

  function unwatchVideo() {
    if (!watchedVideo) return;
    watchedVideo.removeEventListener('ended', onVideoStop);
    watchedVideo = null;
  }

  // ── מיקום הכפתור/overlay/notice יחסית לסרטון ─────────────
  function findVideo() {
    const vids = Array.from(document.querySelectorAll('video')).filter(
      (v) => v.offsetWidth > 40 && v.offsetHeight > 40
    );
    if (!vids.length) return null;
    vids.sort((a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight);
    return vids[0];
  }

  function place(el, x, y, transform) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.transform = transform;
  }

  function reposition() {
    videoEl = findVideo();
    if (videoEl) {
      const r = videoEl.getBoundingClientRect();
      place(btn, r.right - 12, r.top + 12, 'translate(-100%, 0)');
      place(notice, r.left + r.width / 2, r.top + 12, 'translate(-50%, 0)');
      if (positionMode === 'middle') {
        place(overlay, r.left + r.width / 2, r.top + r.height / 2, 'translate(-50%, -50%)');
      } else {
        place(overlay, r.left + r.width / 2, r.bottom - 12, 'translate(-50%, -100%)');
      }
      overlay.style.maxWidth = Math.min(r.width - 24, 900) + 'px';
    } else {
      // fallback: אין סרטון בפריים הזה (אולי iframe) — בר קבוע בתחתית המסך
      place(btn, window.innerWidth - 16, window.innerHeight - 16, 'translate(-100%, -100%)');
      place(notice, window.innerWidth / 2, 12, 'translate(-50%, 0)');
      place(overlay, window.innerWidth / 2, window.innerHeight - 40, 'translate(-50%, -100%)');
      overlay.style.maxWidth = Math.min(window.innerWidth - 24, 900) + 'px';
    }
  }

  let rafPending = false;
  function scheduleReposition() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      reposition();
    });
  }

  // ── ציור כתובית ────────────────────────────────────────
  function showSubtitle(text, isFinal) {
    if (!text) return;
    line.textContent = text;
    line.className = 'mhs-line ' + (isFinal ? 'mhs-final' : 'mhs-interim');
    overlay.style.display = '';
    reposition();
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      overlay.style.display = 'none';
    }, 5000);
  }

  // ── באנר סטטוס ─────────────────────────────────────────
  function showNotice(status, text) {
    clearTimeout(noticeTimer);
    if (!text) {
      // 'connected' עם טקסט ריק → הסתר
      notice.style.display = 'none';
      return;
    }
    notice.textContent = text;
    notice.className = 'mhs-notice mhs-notice-' + status; // connecting/reconnecting/error
    notice.style.display = '';
    reposition();
    if (status === 'error') {
      // שגיאה — הסתר אחרי כמה שניות
      noticeTimer = setTimeout(() => {
        notice.style.display = 'none';
      }, 6000);
    }
  }

  // ── מאזין הודעות (חוזה A, צד content) ───────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SHOW_SUBTITLE') {
      showSubtitle(msg.text, msg.isFinal);
    } else if (msg.type === 'SHOW_NOTICE') {
      showNotice(msg.status, msg.text);
    } else if (msg.type === 'CAPTURE_STATE') {
      capturing = msg.active;
      setButtonLabel();
      if (msg.active) {
        watchVideo(findVideo()); // חבר מאזיני pause/ended לעצירה אוטומטית
      } else {
        unwatchVideo();
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          overlay.style.display = 'none';
        }, 1500);
        notice.style.display = 'none';
      }
    }
  });

  // ── הגדרות מ-storage ───────────────────────────────────
  function loadSettings() {
    chrome.storage.sync.get(['fontSize', 'position'], (s) => {
      if (s.fontSize) fontSize = s.fontSize;
      if (s.position) positionMode = s.position;
      applyFontSize();
      reposition();
    });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.fontSize) {
      fontSize = changes.fontSize.newValue || 28;
      applyFontSize();
    }
    if (changes.position) {
      positionMode = changes.position.newValue || 'bottom';
      reposition();
    }
  });

  // ── אתחול ──────────────────────────────────────────────
  function init() {
    buildUI();
    loadSettings();
    reposition();
    window.addEventListener('scroll', scheduleReposition, true);
    window.addEventListener('resize', scheduleReposition);
    setInterval(scheduleReposition, 800);
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
