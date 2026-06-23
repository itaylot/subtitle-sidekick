# מסמך אפיון מלא: תוסף כתוביות בעברית בזמן אמת ל-Moodle

> **למי מיועד המסמך:** Claude Code, כבסיס לבניית התוסף מאפס.
> **מה זה:** תוסף Chrome (Manifest V3) שלוכד את אודיו הסרטון בדף Moodle, מתמלל אותו לעברית בזמן אמת, ומציג כתוביות (overlay) על גבי הסרטון.
> **רמת פירוט:** מכוון. כל החלטה ארכיטקטונית כאן מבוססת על מחקר של מגבלות Chrome MV3 בפועל. אל תסטה מהארכיטקטורה בלי סיבה טובה — היא נבחרה כדי לעקוף מלכודות אמיתיות.

---

## 0. TL;DR של ההחלטות הקריטיות (קרא קודם)

1. **אי אפשר לתפוס את אודיו הסרטון דרך `video.captureStream()`** — ב-Moodle הסרטונים כמעט תמיד ב-cross-origin iframe, וזה נחסם. **הפתרון:** `chrome.tabCapture`.
2. **`chrome.tabCapture` לא עובד ב-Service Worker** — MediaStreams לא קיימים בהקשר של service worker ב-MV3. **הפתרון:** ה-service worker קורא רק ל-`getMediaStreamId()`, וה-MediaStream עצמו נצרך ב-**Offscreen Document**.
3. **Web Speech API לא מתאים** — הוא מקשיב למיקרופון בלבד, לא ל-stream שרירותי, ולא מדויק בעברית. **הפתרון:** ללכוד PCM גולמי ולשלוח ל-backend תמלול.
4. **Google Cloud STT streaming הוא gRPC-only** — דפדפן לא יכול לדבר gRPC ישירות. צריך **שרת relay** בכל מקרה. לכן בחרנו ב-backend עצמאי מבוסס Whisper (ראה §5), שגם נותן עברית טובה יותר.
5. **חובה offscreen document** כי הוא ה-DOM context היחיד היציב שיכול להריץ `AudioContext`/`AudioWorklet` ולא נהרג כמו service worker.
6. **כשתופסים tab audio — האודיו מפסיק להישמע למשתמש.** חובה לחבר את ה-stream חזרה ל-`AudioContext.destination` כדי שימשיך לשמוע את ההרצאה.

---

## 1. סקירת המוצר

### מה המשתמש רואה
1. נכנס לדף Moodle עם סרטון (הרצאה מוקלטת).
2. מופיע כפתור צף קטן על הסרטון: "▶ כתוביות".
3. לחיצה → התוסף מתחיל ללכוד את אודיו הטאב, שולח לתמלול, וכתוביות בעברית מתחילות לרוץ בתחתית הסרטון — בדיוק כמו כתוביות Netflix.
4. לחיצה נוספת → עצירה.

### דרישות מפתח
- **שפה:** עברית (`he` / `he-IL`). RTL.
- **אתרים:** Moodle (כולל התקנות אוניברסיטאיות תחת `*.ac.il` וכו').
- **תצוגה:** overlay על הסרטון (לא בר נפרד).
- **זמן אמת:** כתוביות interim (אפורות, מתעדכנות) → final (לבנות, יציבות).

---

## 2. ארכיטקטורה כללית

```
┌─────────────────────────────────────────────────────────────────┐
│                         Chrome Extension (MV3)                    │
│                                                                   │
│  ┌──────────────┐   click    ┌────────────────────────────────┐  │
│  │  popup.html  │──────────▶ │     service-worker.js          │  │
│  │  / action    │            │  (background, orchestrator)    │  │
│  └──────────────┘            │                                │  │
│                              │  • chrome.tabCapture            │  │
│                              │    .getMediaStreamId()          │  │
│                              │  • יוצר/סוגר offscreen doc      │  │
│                              │  • מנתב הודעות                  │  │
│                              └───────┬────────────────┬───────┘  │
│                                      │ streamId       │ msgs     │
│                                      ▼                ▼          │
│                          ┌────────────────────┐  ┌────────────┐ │
│                          │  offscreen.html/js │  │ content.js │ │
│                          │                    │  │ (בדף)      │ │
│                          │  • getUserMedia עם │  │            │ │
│                          │    chromeMediaSource│  │ • כפתור    │ │
│                          │  • AudioContext     │  │ • overlay  │ │
│                          │  • AudioWorklet     │  │   כתוביות  │ │
│                          │    (PCM 16k mono)   │  │            │ │
│                          │  • חיבור חזרה ל-    │  │            │ │
│                          │    destination      │  │            │ │
│                          │  • WebSocket ──────────────┐        │ │
│                          └────────────────────┘  └────│───────┘ │
└──────────────────────────────────────────────────────│─────────┘
                                                        │ PCM chunks
                                                        ▼
                              ┌───────────────────────────────────┐
                              │   Transcription Backend (§5)      │
                              │   FastAPI + faster-whisper        │
                              │   מודל עברי (ivrit.ai) + VAD      │
                              │   מחזיר interim + final בעברית    │
                              └───────────────────────────────────┘
```

### זרימת הנתונים (data flow) — שלב אחר שלב
1. משתמש לוחץ על הכפתור (ב-`content.js`) או על ה-action icon.
2. `content.js` שולח הודעה ל-`service-worker.js`: `START_CAPTURE` עם `tabId`.
3. ה-service worker קורא ל-`chrome.tabCapture.getMediaStreamId({ targetTabId })` ומקבל `streamId` (חד-פעמי, פג תוך כמה שניות — להשתמש מיד).
4. ה-service worker מוודא ש-offscreen document קיים (יוצר אם לא), ושולח לו את ה-`streamId`.
5. ה-offscreen document קורא ל-`getUserMedia` עם `chromeMediaSource: "tab"` + ה-streamId → מקבל `MediaStream`.
6. ה-offscreen מקים `AudioContext`, מחבר את ה-stream ל-`AudioWorklet` שממיר ל-PCM 16kHz mono, **וגם** מחבר חזרה ל-`destination` (כדי שהמשתמש ימשיך לשמוע).
7. ה-AudioWorklet שולח chunks דרך `port.postMessage` ל-offscreen, שמעביר אותם ב-WebSocket ל-backend.
8. ה-backend מתמלל ומחזיר `{type: "interim"|"final", text: "..."}`.
9. ה-offscreen מעביר את הטקסט ל-service worker → ל-`content.js` → שמעדכן את ה-overlay.

> **הערה על נתיב ההודעות:** offscreen documents יכולים לתקשר רק דרך `chrome.runtime` messaging. הם לא יכולים לגעת ב-DOM של הדף. לכן הטקסט חייב לעבור: offscreen → service worker → content script. אל תנסה לגשת ל-DOM של הדף מתוך ה-offscreen.

---

## 3. מבנה הקבצים

```
moodle-hebrew-subtitles/
├── manifest.json
├── service-worker.js          # orchestrator (background)
├── offscreen.html             # מארח את לוגיקת האודיו
├── offscreen.js               # tabCapture consumer + WebSocket + AudioWorklet loader
├── pcm-processor.js           # AudioWorklet: המרה ל-PCM 16k mono (קובץ נפרד, חובה!)
├── content.js                 # כפתור + overlay כתוביות בדף
├── subtitles.css              # עיצוב ה-overlay
├── popup.html                 # UI קטן (סטטוס, הגדרות endpoint)
├── popup.js
├── options.html               # הגדרות: כתובת ה-backend, שפה, גודל פונט
├── options.js
├── lib/
│   └── (ריק או ספריות עזר אם צריך)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

> **חשוב:** `pcm-processor.js` **חייב** להיות קובץ נפרד. מודולי AudioWorklet לא ניתנים ל-bundle עם שאר הקוד — הם נטענים דרך `audioContext.audioWorklet.addModule(url)`. השתמש ב-`chrome.runtime.getURL('pcm-processor.js')` כדי לקבל את ה-URL הנכון. ודא שהקובץ מופיע ב-`web_accessible_resources` אם נדרש.

---

## 4. פירוט כל רכיב

### 4.1 `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "Moodle Hebrew Subtitles",
  "version": "1.0.0",
  "description": "כתוביות בעברית בזמן אמת לסרטוני Moodle",
  "permissions": [
    "tabCapture",
    "offscreen",
    "activeTab",
    "scripting",
    "storage"
  ],
  "host_permissions": [
    "*://*.moodle.com/*",
    "*://*.moodle.org/*",
    "*://*.moodlecloud.com/*",
    "*://moodle.*/*",
    "*://*/moodle/*",
    "*://*.ac.il/*"
  ],
  "background": {
    "service_worker": "service-worker.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_title": "Moodle Hebrew Subtitles"
  },
  "options_page": "options.html",
  "content_scripts": [
    {
      "matches": [
        "*://*.moodle.com/*",
        "*://*.moodle.org/*",
        "*://*.moodlecloud.com/*",
        "*://moodle.*/*",
        "*://*/moodle/*",
        "*://*.ac.il/*"
      ],
      "js": ["content.js"],
      "css": ["subtitles.css"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["pcm-processor.js", "offscreen.html"],
      "matches": ["<all_urls>"]
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

**נקודות קריטיות:**
- `tabCapture` + `offscreen` + `storage` הן ההרשאות החדשות והחיוניות.
- `tabCapture` יציג אזהרת הרשאה למשתמש — זה צפוי.
- ה-`host_permissions` ל-`*.ac.il` רחב מאוד. שקול לצמצם או להוסיף הגדרה שמאפשרת למשתמש להזין domains ידנית (דרך options).

### 4.2 `service-worker.js` (orchestrator)

**אחריות:**
- מאזין להודעות מ-content/popup.
- קורא ל-`chrome.tabCapture.getMediaStreamId()`.
- מנהל את מחזור החיים של ה-offscreen document (יצירה/סגירה יחידה לכל התוסף).
- מנתב הודעות בין offscreen ל-content.

**לוגיקה מרכזית:**

```js
// קבוע
const OFFSCREEN_PATH = 'offscreen.html';

// ── ניהול offscreen document ──────────────────────────────
async function hasOffscreen() {
  // ב-Chrome מודרני:
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['USER_MEDIA'],   // ראה הערה למטה על reason
    justification: 'Capturing tab audio for real-time Hebrew subtitles'
  });
}

// ── התחלת לכידה ───────────────────────────────────────────
async function startCapture(tabId) {
  await ensureOffscreen();
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tabId
  });
  // שלח את ה-streamId ל-offscreen — חובה להשתמש בו מיד (פג תוך שניות)
  chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'START',
    streamId,
    config: await getConfig()  // endpoint, language וכו' מ-storage
  });
}

// ── מאזין הודעות ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_CAPTURE') {
    startCapture(msg.tabId);
  } else if (msg.type === 'STOP_CAPTURE') {
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP' });
  } else if (msg.type === 'TRANSCRIPT' && msg.from === 'offscreen') {
    // נתב את הכתוביות חזרה ל-content script בטאב הנכון
    chrome.tabs.sendMessage(msg.tabId, {
      type: 'SHOW_SUBTITLE',
      text: msg.text,
      isFinal: msg.isFinal
    });
  }
  return true; // async
});
```

> **הערה חשובה על `reasons`:** ה-API של offscreen דורש reason תקין. נכון להיום אין reason ייעודי בשם `USER_MEDIA` בכל גרסאות Chrome — הערכים התקינים כוללים `AUDIO_PLAYBACK`, `USER_MEDIA`, `DISPLAY_MEDIA`, `WEB_RTC` ועוד (תלוי גרסה). **בדוק בתיעוד `chrome.offscreen.Reason` הנוכחי איזה reason קיים בגרסת Chrome היעד.** אם `USER_MEDIA` לא קיים, השתמש ב-`AUDIO_PLAYBACK` (לכידת/עיבוד אודיו). זה משפיע גם על תוחלת החיים: `AUDIO_PLAYBACK` נסגר אוטומטית אחרי 30 שניות ללא אודיו — מה שמתאים לנו כי אנחנו כן מחברים אודיו ל-destination.

> **על מגבלת ה-streamId:** החל מ-Chrome 116, streamId שנוצר ב-service worker שמיש ב-offscreen document (אותו security origin, אותו render process). זה בדיוק התרחיש שלנו ולכן זה עובד. אל תנסה לצרוך אותו ב-content script.

### 4.3 `offscreen.js` (לב המערכת)

**אחריות:**
- מקבל `streamId` → יוצר `MediaStream`.
- מקים `AudioContext` + `AudioWorklet`.
- מחבר חזרה ל-`destination` (קריטי לשמיעה!).
- פותח WebSocket ל-backend, שולח PCM, מקבל טקסט.

```js
let audioContext, workletNode, ws, mediaStream;

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'START') {
    await start(msg.streamId, msg.config);
  } else if (msg.type === 'STOP') {
    stop();
  }
});

async function start(streamId, config) {
  // 1. קבל MediaStream מה-streamId
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  // 2. AudioContext ב-16kHz (תואם ל-Whisper/VAD)
  audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(mediaStream);

  // 3. טען את ה-AudioWorklet (קובץ נפרד!)
  await audioContext.audioWorklet.addModule(
    chrome.runtime.getURL('pcm-processor.js')
  );
  workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');

  // 4. חבר: source → worklet (ל-PCM)  + source → destination (לשמיעה)
  source.connect(workletNode);
  source.connect(audioContext.destination);   // ← בלי זה המשתמש לא ישמע כלום!

  // 5. WebSocket ל-backend
  ws = new WebSocket(config.endpoint);  // למשל ws://localhost:9090
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    // שלח הודעת config ראשונה (שפה, sample rate)
    ws.send(JSON.stringify({
      language: 'he',
      sample_rate: 16000,
      encoding: 'pcm_s16le'
    }));
  };
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    // העבר ל-service worker → content
    chrome.runtime.sendMessage({
      type: 'TRANSCRIPT',
      from: 'offscreen',
      tabId: config.tabId,
      text: data.text,
      isFinal: data.is_final
    });
  };

  // 6. כשה-worklet שולח PCM — העבר ל-WebSocket
  workletNode.port.onmessage = (e) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(e.data);  // ArrayBuffer של Int16 PCM
    }
  };
}

function stop() {
  if (workletNode) workletNode.disconnect();
  if (audioContext) audioContext.close();
  if (ws) ws.close();
  if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
  audioContext = workletNode = ws = mediaStream = null;
}
```

### 4.4 `pcm-processor.js` (AudioWorklet — קובץ נפרד!)

ממיר Float32 (מה שהדפדפן נותן) ל-Int16 PCM little-endian, שזה מה ש-Whisper/Vosk דורשים. צובר frames לבלוקים סבירים (למשל ~100ms) לפני שליחה כדי לא להציף את ה-WebSocket.

```js
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.targetSamples = 1600; // ~100ms ב-16kHz
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0]; // mono (ערוץ ראשון)

    for (let i = 0; i < channel.length; i++) {
      this.buffer.push(channel[i]);
    }

    while (this.buffer.length >= this.targetSamples) {
      const chunk = this.buffer.splice(0, this.targetSamples);
      const pcm = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        // המרת float [-1,1] ל-int16
        const s = Math.max(-1, Math.min(1, chunk[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]); // transferable
    }
    return true; // השאר חי
  }
}
registerProcessor('pcm-processor', PCMProcessor);
```

> **שים לב ל-sample rate:** אם תקבע `AudioContext({sampleRate: 16000})`, הדפדפן כבר נותן לך 16kHz ולא צריך downsampling ידני. אם מסיבה כלשהי ה-context רץ ב-44.1/48kHz, תצטרך להוסיף resampling ב-worklet. עדיף לאלץ 16kHz ב-constructor.

> **על stereo→mono:** אנחנו לוקחים רק `input[0]` (ערוץ ראשון). אם רוצים מיקס נכון של סטריאו, ממצעים את שני הערוצים. לתמלול דיבור, ערוץ אחד מספיק כמעט תמיד.

### 4.5 `content.js` (בדף — UI הכתוביות)

**אחריות:**
- מזהה את אלמנט ה-`<video>` בדף (כולל בתוך iframes אם נגיש — ראה מלכודת למטה).
- מצייר כפתור צף + overlay.
- מאזין להודעות `SHOW_SUBTITLE` ומעדכן את ה-overlay.

מבנה דומה ל-content.js שכבר נכתב בגרסה הראשונית (אפשר לעשות reuse של ה-overlay/CSS), אבל **בלי** הניסיון להשתמש ב-Web Speech API או captureStream. במקום זה:
- לחיצה על הכפתור → `chrome.runtime.sendMessage({type: 'START_CAPTURE', tabId: ...})`.
- (ה-content script לא יודע את ה-tabId שלו ישירות — אפשר לקבל אותו מה-service worker, או שה-service worker ישתמש ב-`sender.tab.id`).

**עדכון כתוביות:**
```js
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SHOW_SUBTITLE') {
    renderSubtitle(msg.text, msg.isFinal);
  }
});
```

> **מלכודת iframe:** אם הסרטון ב-Moodle נמצא בתוך iframe מ-origin אחר, ה-content script שלך לא בהכרח רץ בתוך ה-iframe. אבל **זה לא משנה לתפיסת האודיו** — `tabCapture` תופס את כל אודיו הטאב כולל iframes. ה-overlay של הכתוביות: אם אפשר, הצג אותו ב-content script של ה-iframe (הוסף `"all_frames": true` ל-content_scripts). אם ה-iframe חוסם, fallback: הצג בר כתוביות בתחתית הטאב הראשי (position: fixed).

### 4.6 `popup.html` / `popup.js`
- מציג סטטוס (האם בטאב Moodle, האם לכידה פעילה).
- כפתור Start/Stop (אלטרנטיבה לכפתור על הסרטון).
- קישור ל-options.

### 4.7 `options.html` / `options.js`
שמירה ב-`chrome.storage.sync`:
- **Backend endpoint** (ברירת מחדל `ws://localhost:9090`).
- שפה (ברירת מחדל `he`).
- גודל פונט כתוביות, מיקום (תחתית/אמצע).
- domains מותאמים אישית (להוסיף אתרי Moodle נוספים).

---

## 5. ה-Backend (שרת התמלול)

זה החלק שבלעדיו אין תמלול עברי איכותי. שלוש אפשרויות, מהמומלצת לפחות:

### אפשרות A (מומלצת): faster-whisper + מודל עברי, בשרת WebSocket עצמאי
- **למה:** עברית קשה לתמלול (מורפולוגיה עשירה). מודל ייעודי לעברית (ivrit.ai, מבוסס Whisper) נותן תוצאות טובות בהרבה מ-Web Speech API או Whisper גנרי.
- **בסיס קוד מומלץ:** `WhisperLive` (collabora) או `whisper_streaming_web` (ScienceIO) — שניהם שרתי WebSocket מוכנים שתומכים ב-`faster_whisper` backend, VAD, ו-interim/final results. `WhisperLive` אף תומך ב-`--raw_pcm_input` שמתאים בדיוק ל-PCM שאנחנו שולחים.
- **מודל עברי:** `ivrit-ai/whisper-large-v3-turbo-ct2` (פורמט CTranslate2, תואם faster-whisper) — להגדיר כ-custom model עם דגל `-fw`.
- **VAD:** Silero VAD (מובנה בפרויקטים האלה) — מונע הזיות בקטעי שקט ומקצר עיבוד.
- **חומרה:** GPU עם CUDA מומלץ ל-real-time. על CPU זה יעבוד אבל עם latency גבוה — להשתמש במודל קטן יותר (`small`/`turbo`) או INT8.

**פרוטוקול WebSocket (להגדיר במדויק, שני הצדדים צריכים להסכים):**
```
Client → Server (הודעה ראשונה, JSON טקסט):
  { "language": "he", "sample_rate": 16000, "encoding": "pcm_s16le" }

Client → Server (לאחר מכן, binary frames):
  ArrayBuffer של Int16 PCM, 16kHz, mono, ~100ms כל אחד

Server → Client (JSON טקסט):
  { "type": "partial", "text": "שלום לכ", "is_final": false }
  { "type": "final",   "text": "שלום לכולם", "is_final": true }
```

> אם משתמשים ב-WhisperLive/whisper_streaming_web כמו שהם — יש להם פורמט הודעות משלהם. או להתאים את ה-offscreen.js לפורמט שלהם, או להוסיף שכבת adapter דקה בשרת שמתרגמת לפורמט שלמעלה. **בחר אחת ותעד אותה.**

### אפשרות B: Google Cloud STT (gRPC) דרך relay
- צריך שרת relay (Node/Python) כי הדפדפן לא מדבר gRPC.
- הזרימה: extension → WS → relay → gRPC streamingRecognize → relay → WS → extension.
- `languageCode: "he-IL"`, `interimResults: true`, `enableAutomaticPunctuation: true`, `model: "latest_long"`.
- **מגבלה:** stream נסגר אחרי ~5 דקות — חובה reconnection logic (לפתוח stream חדש ולהמשיך).
- עלות: 60 דקות חינם בחודש, אחר כך בתשלום. $300 קרדיט למשתמשים חדשים.
- עברית סבירה אבל פחות טובה ממודל ייעודי.

### אפשרות C (לא מומלץ): Web Speech API
- חינם אך מקשיב למיקרופון בלבד → דורש Virtual Audio Cable לניתוב אודיו מערכת. מסורבל, שביר, לא לפרודקשן. **דלג על זה** אלא אם רוצים POC מהיר ללא backend.

**המלצה ל-Claude Code:** ממש את אפשרות A. בנה את ה-offscreen.js עם endpoint מתצורה (configurable), כך שאפשר להחליף בקלות ל-Google relay אם רוצים. התחל מבדיקה מול שרת מקומי (`ws://localhost:9090`).

---

## 6. סדר בנייה מומלץ (milestones)

בנה ובדוק בשלבים — אל תכתוב הכל ואז תריץ. כל שלב צריך להיות בדיק בנפרד.

1. **שלד התוסף + לכידת אודיו בלבד.**
   manifest, service-worker, offscreen. מטרה: ללחוץ על הכפתור, לראות ב-console של ה-offscreen שמתקבל MediaStream, והאודיו ממשיך להישמע (חיבור ל-destination). עוד אין תמלול.

2. **PCM extraction.**
   הוסף את ה-AudioWorklet. הדפס ל-console את גודל ה-chunks המתקבלים. ודא 16kHz, Int16, ~100ms.

3. **Backend מקומי + WebSocket.**
   הקם WhisperLive/whisper_streaming_web מקומי עם מודל עברי. ודא חיבור WS, שליחת config, קבלת תמלול על קובץ בדיקה.

4. **חיבור end-to-end.**
   חבר את ה-PCM ל-WebSocket. ודא שמתקבל טקסט עברי חזרה ל-offscreen.

5. **תצוגת overlay.**
   נתב את הטקסט ל-content.js, צייר את הכתוביות על הסרטון. טפל ב-interim vs final.

6. **ליטוש:**
   כפתור Start/Stop נקי, popup, options, טיפול בשגיאות (WS נופל, offscreen נסגר, טאב נסגר), עצירה אוטומטית כשהסרטון עוצר.

---

## 7. מלכודות ידועות (checklist)

- [ ] **אודיו נעלם למשתמש** → לא חיברת `source.connect(audioContext.destination)`.
- [ ] **`tabCapture is not a function`** → קראת לו ב-service worker במקום `getMediaStreamId`, או חסר permission.
- [ ] **streamId לא עובד ב-offscreen** → ודא Chrome 116+, ואל תצרוך אותו פעמיים (חד-פעמי, פג תוך שניות).
- [ ] **AudioWorklet לא נטען** → הקובץ לא ב-`web_accessible_resources`, או השתמשת בנתיב יחסי במקום `chrome.runtime.getURL`.
- [ ] **offscreen reason לא תקין** → בדוק את `chrome.offscreen.Reason` הנוכחי; אולי `AUDIO_PLAYBACK` במקום `USER_MEDIA`.
- [ ] **service worker נרדם** → אל תשמור state קריטי בו; כל לוגיקת המדיה ב-offscreen (שלא נרדם בזמן עיבוד אודיו).
- [ ] **כפילות offscreen** → התוסף יכול להחזיק רק offscreen document אחד. בדוק קיום לפני יצירה.
- [ ] **sample rate לא תואם** → אלץ 16kHz ב-AudioContext, או הוסף resampling.
- [ ] **stereo מבלבל את המודל** → קח ערוץ אחד או מיצוע.
- [ ] **Google STT stream נסגר אחרי 5 דק'** → reconnection logic (רק באפשרות B).
- [ ] **iframe חוסם overlay** → `"all_frames": true` או fallback לבר בטאב הראשי.
- [ ] **הזיות בקטעי שקט** → ודא ש-VAD פעיל בשרת.

---

## 8. שיקולי פרטיות ו-UX (לציין למשתמש)
- התוסף שולח את אודיו ההרצאה לשרת תמלול. אם השרת מקומי (localhost) — הכל נשאר על המכונה. אם ענן — לציין.
- לבקש את לכידת האודיו רק אחרי לחיצה מפורשת של המשתמש (user gesture חובה ל-tabCapture).
- להציג אינדיקציה ברורה כשהלכידה פעילה.

---

## 9. סיכום הסטאק

| שכבה | טכנולוגיה |
|------|-----------|
| לכידת אודיו | `chrome.tabCapture.getMediaStreamId` (service worker) |
| עיבוד אודיו | Offscreen Document + `AudioContext` (16kHz) + `AudioWorklet` |
| פורמט שידור | Int16 PCM mono, ~100ms chunks, על WebSocket |
| תמלול | faster-whisper + מודל עברי ivrit.ai (WhisperLive/whisper_streaming_web) |
| VAD | Silero VAD (בשרת) |
| תצוגה | Content script + CSS overlay, RTL, interim/final |
| תצורה | `chrome.storage.sync` (endpoint, שפה, עיצוב) |

---

### נספח: למה לא הדרך ה"פשוטה"
- `<track>` + קובץ VTT — דורש כתוביות מוכנות מראש. אין לנו.
- `video.captureStream()` — נחסם ב-cross-origin iframe (המצב הנפוץ ב-Moodle).
- Web Speech API ישירות — מיקרופון בלבד, לא stream, עברית חלשה.
- gRPC ישיר מהדפדפן — לא נתמך; חייב relay.

זו הסיבה שהארכיטקטורה למעלה היא הדרך הנכונה היחידה שעובדת אמינות ב-MV3.
