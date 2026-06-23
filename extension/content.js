// content.js — UI בדף: כפתור צף + overlay כתוביות.
//
// עובד מול חוזה A (צד content) בלבד. לא נוגע באודיו כלל.
//  - לחיצה על הכפתור → START_CAPTURE / STOP_CAPTURE ל-service worker.
//  - מאזין ל-SHOW_SUBTITLE → מצייר כתובית (interim אפור / final לבן, RTL).
//  - מאזין ל-CAPTURE_STATE → מסנכרן את מצב הכפתור.

(function () {
  if (window.__mhsInjected) return; // מניעת הזרקה כפולה (למשל ב-SPA)
  window.__mhsInjected = true;

  let capturing = false;
  let btn, overlay, line, hideTimer;
  let videoEl = null;

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

    document.body.appendChild(btn);
    document.body.appendChild(overlay);
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
      chrome.runtime.sendMessage({ type: 'START_CAPTURE' }); // tabId נלקח ב-SW מ-sender.tab.id
      capturing = true;
    }
    setButtonLabel();
  }

  // ── מיקום הכפתור וה-overlay יחסית לסרטון ─────────────────
  function findVideo() {
    const vids = Array.from(document.querySelectorAll('video')).filter(
      (v) => v.offsetWidth > 40 && v.offsetHeight > 40
    );
    if (!vids.length) return null;
    vids.sort(
      (a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight
    );
    return vids[0]; // הסרטון הגדול ביותר
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
      // כפתור: פינה עליונה-ימנית של הסרטון
      place(btn, r.right - 12, r.top + 12, 'translate(-100%, 0)');
      // overlay: תחתית הסרטון (או אמצע אם נבחר)
      if (positionMode === 'middle') {
        place(overlay, r.left + r.width / 2, r.top + r.height / 2, 'translate(-50%, -50%)');
      } else {
        place(overlay, r.left + r.width / 2, r.bottom - 12, 'translate(-50%, -100%)');
      }
      overlay.style.maxWidth = Math.min(r.width - 24, 900) + 'px';
    } else {
      // fallback: אין סרטון בפריים הזה (אולי בתוך iframe) — בר קבוע בתחתית המסך
      place(btn, window.innerWidth - 16, window.innerHeight - 16, 'translate(-100%, -100%)');
      place(overlay, window.innerWidth / 2, window.innerHeight - 40, 'translate(-50%, -100%)');
      overlay.style.maxWidth = Math.min(window.innerWidth - 24, 900) + 'px';
    }
  }

  // throttle עם requestAnimationFrame
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
    // הסתר אחרי כמה שניות ללא עדכון (כמו כתוביות אמיתיות)
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      overlay.style.display = 'none';
    }, 5000);
  }

  // ── מאזין הודעות (חוזה A, צד content) ───────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SHOW_SUBTITLE') {
      showSubtitle(msg.text, msg.isFinal);
    } else if (msg.type === 'CAPTURE_STATE') {
      capturing = msg.active;
      setButtonLabel();
      if (!msg.active) {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          overlay.style.display = 'none';
        }, 1500);
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
    setInterval(scheduleReposition, 800); // לתפוס שינויי layout / סרטון שנטען מאוחר
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
