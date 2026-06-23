// options.js — שמירה/טעינה של הגדרות ב-chrome.storage.sync.
//
// המפתחות שנשמרים: endpoint, language (נצרכים ע"י service worker),
// fontSize, position (נצרכים ע"י content.js). ראה סכמת Config ב-CONTRACTS.md.

const DEFAULTS = {
  endpoint: 'ws://localhost:9090',
  language: 'he',
  fontSize: 28,
  position: 'bottom',
};

const els = {
  endpoint: document.getElementById('endpoint'),
  language: document.getElementById('language'),
  fontSize: document.getElementById('fontSize'),
  position: document.getElementById('position'),
};
const savedMsg = document.getElementById('saved');

function load() {
  chrome.storage.sync.get(Object.keys(DEFAULTS), (s) => {
    els.endpoint.value = s.endpoint || DEFAULTS.endpoint;
    els.language.value = s.language || DEFAULTS.language;
    els.fontSize.value = s.fontSize || DEFAULTS.fontSize;
    els.position.value = s.position || DEFAULTS.position;
  });
}

function save() {
  const fontSize = parseInt(els.fontSize.value, 10);
  const values = {
    endpoint: els.endpoint.value.trim() || DEFAULTS.endpoint,
    language: els.language.value.trim() || DEFAULTS.language,
    fontSize: Number.isFinite(fontSize) ? fontSize : DEFAULTS.fontSize,
    position: els.position.value || DEFAULTS.position,
  };
  chrome.storage.sync.set(values, () => {
    savedMsg.classList.add('show');
    setTimeout(() => savedMsg.classList.remove('show'), 1500);
  });
}

document.getElementById('save').addEventListener('click', save);
load();
