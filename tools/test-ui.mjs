// test-ui.mjs — בדיקת ריצה של content.js תחת DOM מדומה (jsdom) + chrome מדומה.
// מאמת את ה-DoD של ה-UI: הזרקת SHOW_SUBTITLE / CAPTURE_STATE לפי חוזה A.
// הרצה:  node tools/test-ui.mjs
import { JSDOM } from 'jsdom';
import fs from 'fs';

const code = fs.readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');

const dom = new JSDOM('<!DOCTYPE html><body><video></video></body>', {
  pretendToBeVisual: true, // מספק requestAnimationFrame
  runScripts: 'dangerously', // מאפשר הרצת <script> בהקשר window תקין
  url: 'https://www.youtube.com/watch?v=test',
});
const { window } = dom;

const listeners = [];
let lastSent = null;
window.chrome = {
  runtime: {
    onMessage: { addListener: (fn) => listeners.push(fn) },
    sendMessage: (msg) => { lastSent = msg; },
  },
  storage: {
    sync: { get: (keys, cb) => cb({ fontSize: 32, position: 'bottom' }) },
    onChanged: { addListener: () => {} },
  },
};
const dispatch = (msg) => listeners.forEach((fn) => fn(msg));

// הרץ את content.js האמיתי דרך <script> (כך window/document גלובליים כמו בדפדפן)
const scriptEl = window.document.createElement('script');
scriptEl.textContent = code;
window.document.body.appendChild(scriptEl);

const assert = (cond, name) => {
  if (!cond) { console.error('❌ FAIL:', name); process.exit(1); }
  console.log('✓', name);
};

const doc = window.document;
const btn = doc.querySelector('.mhs-button');
const overlay = doc.querySelector('.mhs-overlay');
const line = doc.querySelector('.mhs-line');

assert(btn, 'נוצר כפתור .mhs-button');
assert(overlay, 'נוצר overlay .mhs-overlay');
assert(line, 'נוצר .mhs-line');
assert(btn.textContent.includes('כתוביות'), 'כפתור במצב התחלתי "כתוביות"');
assert(line.style.fontSize === '32px', 'fontSize מ-storage הוחל (32px)');
assert(overlay.style.display === 'none', 'overlay מוסתר בהתחלה');

// partial → אפור
dispatch({ type: 'SHOW_SUBTITLE', text: 'שלום לכ', isFinal: false });
assert(line.textContent === 'שלום לכ', 'partial: טקסט עודכן');
assert(line.className.includes('mhs-interim'), 'partial: class = interim (אפור)');
assert(overlay.style.display === '', 'partial: overlay מוצג');

// final → לבן
dispatch({ type: 'SHOW_SUBTITLE', text: 'שלום לכולם', isFinal: true });
assert(line.textContent === 'שלום לכולם', 'final: טקסט עודכן');
assert(line.className.includes('mhs-final'), 'final: class = final (לבן)');

// CAPTURE_STATE → כפתור מתחלף
dispatch({ type: 'CAPTURE_STATE', active: true });
assert(btn.textContent.includes('עצור'), 'CAPTURE_STATE active: כפתור "עצור"');
assert(btn.className.includes('mhs-active'), 'CAPTURE_STATE active: class active');
dispatch({ type: 'CAPTURE_STATE', active: false });
assert(btn.textContent.includes('כתוביות'), 'CAPTURE_STATE off: כפתור חזר ל"כתוביות"');

// קליק על הכפתור → שולח START_CAPTURE
btn.dispatchEvent(new window.Event('click'));
assert(lastSent && lastSent.type === 'START_CAPTURE', 'קליק שולח START_CAPTURE');

console.log('\n✅ כל בדיקות ה-UI עברו');
process.exit(0);
