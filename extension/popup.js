// popup.js — UI קטן: סטטוס + כפתור Start/Stop (אלטרנטיבה לכפתור על הסרטון).
//
// ל-popup אין sender.tab, לכן הוא שולח tabId מפורש (חוזה A, popup ↔ SW).

const statusEl = document.getElementById('status');
const toggleBtn = document.getElementById('toggle');
const optionsLink = document.getElementById('options-link');

let activeTabId = null;
let capturing = false;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function render() {
  toggleBtn.disabled = activeTabId == null;
  if (capturing) {
    statusEl.textContent = '● לכידה פעילה';
    statusEl.classList.add('active');
    toggleBtn.textContent = '■ עצור כתוביות';
    toggleBtn.classList.add('stop');
  } else {
    statusEl.textContent = activeTabId != null ? 'מוכן' : 'אין טאב פעיל';
    statusEl.classList.remove('active');
    toggleBtn.textContent = '▶ הפעל כתוביות';
    toggleBtn.classList.remove('stop');
  }
}

async function init() {
  const tab = await getActiveTab();
  activeTabId = tab ? tab.id : null;

  // שאל את ה-SW מה המצב הנוכחי
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (resp) => {
    if (resp) capturing = resp.active && resp.activeTabId === activeTabId;
    render();
  });
  render();
}

toggleBtn.addEventListener('click', () => {
  if (activeTabId == null) return;
  if (capturing) {
    chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' });
    capturing = false;
  } else {
    chrome.runtime.sendMessage({ type: 'START_CAPTURE', tabId: activeTabId });
    capturing = true;
  }
  render();
});

optionsLink.addEventListener('click', () => chrome.runtime.openOptionsPage());

init();
