# נספח: חלוקת הבנייה לסוכנים (Multi-Agent Build)

> **הבהרה קריטית — קרא קודם:** הסוכנים המתוארים כאן הם **כלי פיתוח של Claude Code בזמן הבנייה בלבד**. הם בונים את התוסף ואז נעלמים. התוסף הסופי שהמשתמשים מתקינים הוא JS/HTML/CSS סטטי + שרת תמלול. **אין שום קריאה ל-Claude API בזמן ריצת התוסף. אף משתמש קצה לא צריך API key ולא משלם דבר.** הסוכנים הם פיגום בנייה, לא חלק מהמוצר.

---

## 1. למה בכלל לפרק לסוכנים, ולמה זה מתאים כאן

הפרויקט מתחלק לשלוש שכבות עם **גבולות נקיים** ומעט נקודות מגע:
- שכבת לכידת אודיו (Chrome internals)
- שכבת UI בדף (DOM, עיצוב)
- שכבת שרת התמלול (Python, ML)

כל שכבה דורשת הקשר מנטלי שונה לגמרי. סוכן שמתמקד בשכבה אחת לא צריך להחזיק בראש את הפרטים של השתיים האחרות — מספיק שהוא מכיר את **החוזה** (interface) שמחבר ביניהן. זה בדיוק התרחיש שבו עבודה מקבילית עוזרת: גבולות ברורים, חוזים מוגדרים, חפיפה מינימלית.

**עיקרון העל:** מגדירים את החוזים **לפני** שמפצלים. אחרי שהחוזים קפואים, כל סוכן עובד מולם בלי לדעת איך השני מימש את הצד שלו.

---

## 2. שני החוזים הקפואים (Frozen Contracts)

הסוכן הראשי (lead) חייב להגדיר ולהקפיא את שני אלה **לפני** פיצול לסוכנים. אלה היחידים שכל הסוכנים חולקים:

### חוזה A — פרוטוקול ההודעות הפנימי (בין רכיבי התוסף)
```
content → service-worker:
  { type: 'START_CAPTURE' }              // tabId מגיע מ-sender.tab.id
  { type: 'STOP_CAPTURE' }

service-worker → content (chrome.tabs.sendMessage):
  { type: 'SHOW_SUBTITLE', text: string, isFinal: boolean }
  { type: 'CAPTURE_STATE', active: boolean }   // לסנכרון UI

service-worker ↔ offscreen (chrome.runtime.sendMessage, target:'offscreen'):
  { target:'offscreen', type:'START', streamId: string, config: {...} }
  { target:'offscreen', type:'STOP' }
  { type:'TRANSCRIPT', from:'offscreen', tabId: number, text, isFinal }
```

### חוזה B — פרוטוקול ה-WebSocket (תוסף ↔ שרת)
```
Client → Server (הודעה ראשונה, JSON):
  { "language":"he", "sample_rate":16000, "encoding":"pcm_s16le" }
Client → Server (binary frames):
  ArrayBuffer של Int16 PCM, 16kHz mono, ~100ms
Server → Client (JSON):
  { "type":"partial"|"final", "text": string, "is_final": boolean }
```

> שני החוזים האלה נכנסים לקובץ `CONTRACTS.md` בשורש הריפו. כל סוכן קורא אותו ראשון. אם סוכן רוצה לשנות חוזה — הוא **חייב** לעצור ולתאם עם ה-lead, לא לשנות חד-צדדית.

---

## 3. חלוקת הסוכנים

ארבעה סוכנים. אחד lead (מתזמר) ושלושה workers שעובדים במקביל ב-git worktrees נפרדים.

### 🎯 Agent 0 — Lead / Orchestrator
**רץ ראשון ולבד.** לא במקביל.
- יוצר את שלד הריפו, `manifest.json`, `CONTRACTS.md` (שני החוזים).
- יוצר icons placeholder.
- מקים את ה-git worktrees לשלושת ה-workers.
- בסוף: עושה אינטגרציה, מריץ את שלב הבדיקה end-to-end, פותר התנגשויות.

### 🎧 Agent 1 — Capture Agent
**worktree:** `agent-capture`
**קבצים:** `service-worker.js`, `offscreen.html`, `offscreen.js`, `pcm-processor.js`
**אחריות:** כל מסלול האודיו — מ-`tabCapture.getMediaStreamId` ועד שליחת PCM ב-WebSocket וקבלת טקסט.
**עובד מול:** חוזה A (צד service-worker/offscreen) + חוזה B (צד client).
**בדיקת קבלה (DoD):**
- לחיצה מדומה → offscreen מקבל MediaStream, האודיו נשמע (מחובר ל-destination).
- AudioWorklet מוציא Int16 PCM 16kHz ~100ms (להדפיס גודל chunks ל-console).
- מתחבר ל-`ws://localhost:9090`, שולח config + PCM, מקבל הודעות `partial`/`final`.
- **לא תלוי** ב-UI Agent — בודק מול mock שמדפיס את הכתוביות ל-console.

### 🎨 Agent 2 — UI Agent
**worktree:** `agent-ui`
**קבצים:** `content.js`, `subtitles.css`, `popup.html`, `popup.js`, `options.html`, `options.js`
**אחריות:** כל מה שהמשתמש רואה — כפתור על הסרטון, overlay הכתוביות (RTL, interim אפור / final לבן), popup, options (endpoint, שפה, עיצוב, domains).
**עובד מול:** חוזה A (צד content) בלבד. **לא נוגע באודיו כלל.**
**בדיקת קבלה (DoD):**
- מזהה `<video>` בדף, מצייר כפתור + overlay.
- מאזין ל-`SHOW_SUBTITLE` ומעדכן נכון (interim vs final, RTL, fade).
- שולח `START_CAPTURE`/`STOP_CAPTURE`.
- options נשמרים ב-`chrome.storage.sync`.
- **לא תלוי** ב-Capture Agent — בודק ע"י הזרקת הודעות `SHOW_SUBTITLE` ידנית מה-console.

### 🧠 Agent 3 — Backend Agent
**worktree:** `agent-backend`
**קבצים:** `backend/` (README, docker-compose / סקריפט הרצה, adapter דק אם צריך)
**אחריות:** הקמת שרת תמלול עברי מבוסס **WhisperLive** (לא לבנות מאפס). חיבור מודל `ivrit-ai/whisper-large-v3-turbo-ct2` כ-faster-whisper backend. התאמת פורמט ההודעות לחוזה B (adapter דק אם הפורמט הטבעי של WhisperLive שונה).
**עובד מול:** חוזה B (צד server) בלבד.
**בדיקת קבלה (DoD):**
- שרת רץ על `ws://localhost:9090`, מקבל config + PCM frames.
- מתמלל עברית מקובץ בדיקה ומחזיר `partial`/`final` בפורמט החוזה.
- VAD פעיל (Silero) למניעת הזיות בשקט.
- README עם הוראות הרצה מדויקות (כולל אופציית CPU למי שאין GPU).
- **לא תלוי** באף סוכן אחר — נבדק עם סקריפט client פשוט ששולח PCM מקובץ wav.

> **למה Backend Agent מול שרת קיים ולא מאפס:** בניית שרת streaming-STT מאפס (chunking, buffering, VAD, ניהול sessions) היא מלכודות אינסופיות. WhisperLive כבר פתר את כל זה ותומך ב-`--raw_pcm_input` ובמודל מותאם. זה גם הופך את הסוכן הזה לקצר ביותר — כך הוא לא צוואר בקבוק בעבודה המקבילית.

---

## 4. תרשים התלויות

```
                    ┌──────────────────────────┐
                    │  Agent 0 (Lead)          │
                    │  שלד + CONTRACTS.md      │
                    └────────────┬─────────────┘
                                 │ מקפיא חוזים, יוצר worktrees
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
     ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
     │ Agent 1        │ │ Agent 2        │ │ Agent 3        │
     │ Capture        │ │ UI             │ │ Backend        │
     │ (חוזה A+B)     │ │ (חוזה A)       │ │ (חוזה B)       │
     │  ← mock UI     │ │  ← mock msgs   │ │  ← mock client │
     └────────┬───────┘ └───────┬────────┘ └───────┬────────┘
              └─────────────────┼──────────────────┘
                                ▼
                    ┌──────────────────────────┐
                    │  Agent 0 (Lead)          │
                    │  אינטגרציה + E2E + מיזוג │
                    └──────────────────────────┘
```

**מפתח להצלחה:** כל worker בודק את עצמו מול **mock** של הצד השני (לפי החוזה), לא מול הקוד האמיתי. כך שלושתם רצים באמת במקביל בלי לחכות אחד לשני.

---

## 5. הוראות הרצה ל-Claude Code (קונקרטי)

```
# שלב 1 — Lead (סדרתי)
- בנה שלד, manifest.json, CONTRACTS.md, icons.
- commit ל-main.
- הקם worktrees:
    git worktree add ../agent-capture  -b agent-capture
    git worktree add ../agent-ui        -b agent-ui
    git worktree add ../agent-backend   -b agent-backend

# שלב 2 — שלושה Task subagents במקביל
- הרץ שלושה סוכנים בו-זמנית (קריאת Task אחת עם שלוש משימות, או שלוש מקבילות).
- כל סוכן מקבל: (א) BUILD_SPEC.md  (ב) CONTRACTS.md  (ג) את ה-DoD שלו  (ד) הנחיה לעבוד רק ב-worktree שלו ורק בקבצים שלו.
- כל סוכן בונה + בודק מול mock + commit ל-branch שלו.

# שלב 3 — Lead (סדרתי)
- מזג את שלושת ה-branches ל-main.
- הרץ אינטגרציה end-to-end (milestone 4-5 מ-BUILD_SPEC):
    הקם backend → טען תוסף ב-Chrome → דף Moodle/וידאו בדיקה → לחץ כתוביות.
- תקן נקודות מגע שנשברו (בד"כ סביב פורמט ההודעות — שם החוזה מוכיח את עצמו).
```

---

## 6. כללי זהב למניעת התנגשויות

1. **בעלות בלעדית על קבצים.** אף קובץ לא נכתב ע"י שני סוכנים. החלוקה ב-§3 מבטיחה את זה. `manifest.json` בבעלות ה-lead בלבד — אם worker צריך הרשאה/resource חדש, הוא מבקש מה-lead.
2. **החוזים קדושים.** worker לא משנה את `CONTRACTS.md`. רוצה שינוי → עוצר, מתאם עם lead, ה-lead מעדכן והודיע לכולם.
3. **כל worker מול mock.** אסור לחכות לסוכן אחר. בודקים מול דמה לפי החוזה.
4. **commits קטנים ותכופים** בכל branch — מקל על המיזוג.
5. **ה-lead הוא היחיד שממזג ועושה E2E.** workers לא נוגעים ב-main.

---

## 7. סיכום מהיר

| סוכן | worktree | קבצים | חוזה | רץ במקביל? |
|------|----------|--------|------|-----------|
| Lead | main | manifest, CONTRACTS, שלד | מגדיר את שניהם | לא (ראשון+אחרון) |
| Capture | agent-capture | service-worker, offscreen, pcm-processor | A + B (client) | ✅ |
| UI | agent-ui | content, css, popup, options | A (content) | ✅ |
| Backend | agent-backend | backend/ | B (server) | ✅ |

זהו. הסוכנים בונים את התוסף במקביל, מתמזגים, והתוצר הוא תוסף עצמאי לחלוטין — בלי תלות ב-Claude, בלי API keys, בלי עלות למשתמש.
