# CONTRACTS — החוזים הקפואים

> זהו **מקור האמת** לכל נקודות המגע בין רכיבי המערכת. כל סוכן (Capture / UI / Backend) קורא קובץ זה ראשון ועובד מולו.
>
> **כלל ברזל:** סוכן לא משנה קובץ זה חד-צדדית. רוצה שינוי בחוזה → עוצר, מתאם עם ה-Lead, ה-Lead מעדכן כאן ומודיע לכולם.
>
> סטטוס: **קפוא** (גרסה 1.0). עודכן: שלב 1 (Lead).

---

## חוזה A — פרוטוקול ההודעות הפנימי (בין רכיבי התוסף)

כל ההודעות עוברות דרך `chrome.runtime` / `chrome.tabs` messaging. **ה-offscreen לא נוגע ב-DOM של הדף** — טקסט הכתוביות חייב לעבור: `offscreen → service-worker → content`.

### content → service-worker  (`chrome.runtime.sendMessage`)
```js
{ type: 'START_CAPTURE' }   // ה-tabId לא נשלח — ה-SW לוקח אותו מ-sender.tab.id
{ type: 'STOP_CAPTURE'  }
```

### service-worker → content  (`chrome.tabs.sendMessage(tabId, ...)`)
```js
{ type: 'SHOW_SUBTITLE', text: string, isFinal: boolean }
{ type: 'CAPTURE_STATE', active: boolean }   // לסנכרון מצב הכפתור/ה-UI
```

### service-worker ↔ offscreen  (`chrome.runtime.sendMessage`, מסומן ב-`target:'offscreen'`)
```js
// SW → offscreen
{ target: 'offscreen', type: 'START', streamId: string, config: Config }
{ target: 'offscreen', type: 'STOP'  }

// offscreen → SW
{ type: 'TRANSCRIPT', from: 'offscreen', tabId: number, text: string, isFinal: boolean }
```

### אובייקט ה-`Config` (נשלח מ-SW ל-offscreen בהודעת START)
ה-SW בונה אותו מ-`chrome.storage.sync` (מה שה-UI שמר) + ה-`tabId`:
```js
{
  endpoint:    string,   // כתובת ה-WebSocket של ה-backend. ברירת מחדל: 'ws://localhost:9090'
  language:    string,   // ברירת מחדל: 'he'
  sampleRate:  number,   // קבוע: 16000
  encoding:    string,   // קבוע: 'pcm_s16le'
  tabId:       number    // אליו ה-offscreen יחזיר TRANSCRIPT דרך ה-SW
}
```

> **למה זה כאן:** חוזה A המקורי כתב `config: {...}` בלי לפרט. כדי ש-Capture (צורך) ו-UI (מייצר דרך options) יסכימו — השדות נעולים כאן. UI שומר ב-storage לפחות `endpoint` ו-`language`; שדות עיצוב (גודל פונט, מיקום) הם פנימיים ל-UI ולא חלק מה-Config שעובר ל-offscreen.

---

## חוזה B — פרוטוקול ה-WebSocket (תוסף ↔ שרת התמלול)

### Client → Server — הודעה ראשונה (JSON טקסט, פעם אחת בפתיחת החיבור)
```json
{ "language": "he", "sample_rate": 16000, "encoding": "pcm_s16le" }
```

### Client → Server — לאחר מכן (binary frames)
```
ArrayBuffer של Int16 PCM little-endian, 16kHz, mono, ~100ms לכל frame (≈3200 בייט)
```

### Server → Client (JSON טקסט)
```json
{ "type": "partial", "text": "שלום לכ",    "is_final": false }
{ "type": "final",   "text": "שלום לכולם", "is_final": true  }
```

**כללי הכרעה (כדי שלא תהיה עמימות בין הסוכנים):**
- שדה **`type`** הוא הסמכותי: `"partial"` = כתובית זמנית (מתעדכנת, אפורה), `"final"` = כתובית יציבה (לבנה).
- `is_final` הוא נוחות בלבד וחייב להיות עקבי: `is_final === (type === "final")`.
- צד ה-offscreen ממיר ל-חוזה A כך: `isFinal = (data.type === 'final')`.
- אם משתמשים ב-WhisperLive כמו שהוא והפורמט הטבעי שלו שונה — **Backend Agent מוסיף adapter דק בשרת** שמתרגם לפורמט הזה. הצד של התוסף עובד רק מול הפורמט שלמעלה.

---

## הערות פריסה קריטיות (להוסיף ל-checklist של האפיון)

1. **`ws://` מול `wss://` — mixed content.** דפי Moodle הם HTTPS. הדפדפן **חוסם** WebSocket לא-מאובטח (`ws://`) לשרת **מרוחק** מתוך דף HTTPS. החריג היחיד: `ws://localhost` / `ws://127.0.0.1` נחשבים secure context ומותרים — ולכן הם תקינים לבדיקה מקומית.
   - **לפיתוח (עכשיו):** `ws://localhost:9090` — עובד.
   - **לפריסה לחברים (בהמשך):** שרת משותף חייב `wss://` עם תעודת TLS, אחרת החיבור ייחסם בדפדפן. זה לא משנה קוד תוסף — רק את ה-endpoint שב-options ואת הקמת ה-TLS בשרת.

2. **חומרת ה-backend.** ברירת מחדל לבנייה: **CPU + מודל קטן/INT8** (עובד על כל מכונה לבדיקות). מעבר ל-GPU/CUDA + מודל עברי מלא הוא דגל `device` ב-config השרת — לא שינוי ארכיטקטוני. (ראה README של ה-backend.)

---

## בעלות על קבצים (אף קובץ לא נכתב ע"י שני סוכנים)

| סוכן | קבצים | חוזה |
|------|--------|------|
| **Lead** | `extension/manifest.json`, `CONTRACTS.md`, `README.md`, `extension/icons/*` | מגדיר את שניהם |
| **Capture** | `extension/service-worker.js`, `extension/offscreen.html`, `extension/offscreen.js`, `extension/pcm-processor.js` | A (SW/offscreen) + B (client) |
| **UI** | `extension/content.js`, `extension/subtitles.css`, `extension/popup.html`, `extension/popup.js`, `extension/options.html`, `extension/options.js` | A (content) |
| **Backend** | `backend/**` | B (server) |

> `manifest.json` בבעלות ה-Lead בלבד. worker שצריך הרשאה/resource חדש — מבקש מה-Lead, לא עורך בעצמו.
