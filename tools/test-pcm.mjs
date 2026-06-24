// test-pcm.mjs — בדיקת לוגיקת ההמרה ב-pcm-processor.js (Float32→Int16 + chunking).
// מספק stubs ל-AudioWorkletProcessor/registerProcessor ומריץ את ה-process האמיתי.
// הרצה:  node tools/test-pcm.mjs
import fs from 'fs';

const outputs = [];
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = { postMessage: (buf) => outputs.push(new Int16Array(buf)) };
  }
};
let Registered = null;
globalThis.registerProcessor = (_name, cls) => { Registered = cls; };

const code = fs.readFileSync(new URL('../extension/pcm-processor.js', import.meta.url), 'utf8');
// eslint-disable-next-line no-eval
eval(code);

const assert = (cond, name) => {
  if (!cond) { console.error('❌ FAIL:', name); process.exit(1); }
  console.log('✓', name);
};

assert(Registered, 'registerProcessor נקרא עם המחלקה');
const proc = new Registered();
assert(proc.targetSamples === 1600, 'targetSamples = 1600 (~100ms @16kHz)');

// 1) פחות מ-1600 דגימות → לא נשלח כלום עדיין (צבירה)
proc.process([[new Float32Array(1000).fill(0.5)]]);
assert(outputs.length === 0, 'מתחת ל-1600 דגימות: עדיין לא נשלח chunk');

// 2) עוד 700 → סה"כ 1700 ≥ 1600 → chunk אחד של 1600, נשארות 100
proc.process([[new Float32Array(700).fill(1.0)]]);
assert(outputs.length === 1, 'מעל הסף: נשלח chunk אחד');
assert(outputs[0].length === 1600, 'גודל chunk = 1600 דגימות');
assert(outputs[0] instanceof Int16Array, 'הפלט הוא Int16');

// 3) בדיקת ערכי המרה: 0.5→16383, 1.0(clamp)→32767, -1.0→-32768, 0→0
outputs.length = 0;
const p2 = new Registered();
const mix = new Float32Array(1600);
mix[0] = 0.5; mix[1] = 1.0; mix[2] = 2.0 /*clamp*/; mix[3] = -1.0; mix[4] = -2.0 /*clamp*/; mix[5] = 0;
p2.process([[mix]]);
const out = outputs[0];
assert(out[0] === Math.round(0.5 * 0x7fff) || out[0] === Math.trunc(0.5 * 0x7fff), '0.5 → ~16383');
assert(out[1] === 32767, '1.0 → 32767');
assert(out[2] === 32767, '2.0 → clamp ל-32767');
assert(out[3] === -32768, '-1.0 → -32768');
assert(out[4] === -32768, '-2.0 → clamp ל--32768');
assert(out[5] === 0, '0 → 0');

// 4) ערוץ ריק → לא קורס, מחזיר true (השארת processor חי)
const alive = p2.process([[]]);
assert(alive === true, 'process מחזיר true (נשאר חי)');
assert(p2.process([]) === true, 'inputs ריק → לא קורס');

console.log('\n✅ כל בדיקות ה-PCM עברו');
process.exit(0);
