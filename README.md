# 🎬 כתוביות עברית בזמן אמת ל-Moodle

תוסף Chrome (Manifest V3) שלוכד את אודיו ההרצאה בדף, מתמלל אותו לעברית בזמן אמת, ומציג כתוביות overlay על הסרטון — כמו כתוביות Netflix, רק חיות.

> תוסף סטטי (JS/HTML/CSS) + שרת תמלול קטן שרץ בצד. **אין תלות ב-API חיצוני בזמן ריצה, ואין עלות למשתמש.**

---

## ✨ מה הוא עושה

- 🎧 **לוכד את אודיו הטאב** (`chrome.tabCapture`) — עובד גם כשהסרטון בתוך iframe (המצב הנפוץ ב-Moodle).
- 🔊 **לא קוטע את ההאזנה** — האודיו ממשיך להישמע רגיל תוך כדי הלכידה.
- 🇮🇱 **תמלול עברי** דרך Whisper (מודל ייעודי לעברית), עם כתוביות זמניות (אפור) שמתייצבות לסופיות (לבן).
- ⚙️ **ניתן להגדרה** — כתובת שרת, גודל פונט ומיקום הכתוביות (popup + עמוד הגדרות).

## 🧠 איך זה עובד

```
כפתור בדף  →  service-worker  →  offscreen document            →  שרת תמלול
(content.js)   (tabCapture)       (AudioWorklet: PCM 16kHz)        (faster-whisper)
     ▲                                   │  WebSocket (PCM)              │
     └──────────  כתובית עברית  ◄─────────┴──────  partial / final  ◄────┘
```

הארכיטקטורה המלאה והנימוקים: [BUILD_SPEC.md](BUILD_SPEC.md). החוזים בין הרכיבים: [CONTRACTS.md](CONTRACTS.md).

## 🚀 התחלה מהירה

```bash
# 1. שרת תמלול (התחל מ-mock — בלי הורדת מודל)
cd backend
python -m venv .venv && .venv\Scripts\activate
pip install websockets
python mock_server.py            # מאזין על ws://localhost:9090
```

```text
# 2. טען את התוסף ב-Chrome
chrome://extensions  →  Developer mode  →  Load unpacked  →  בחר את תיקיית extension/

# 3. פתח דף עם וידאו בעברית ולחץ "▶ כתוביות"
```

לתמלול עברית **אמיתי** (faster-whisper, CPU/GPU): [backend/README.md](backend/README.md).
הוראות הרצה מפורטות ובדיקת קבלה: [RUN.md](RUN.md).

## 📁 מבנה

```
extension/     התוסף עצמו (זה מה שטוענים ב-Chrome)
backend/       שרת התמלול — mock_server.py (בדיקה) + server.py (אמיתי)
tools/         ui-mock.html — בדיקת ה-UI בלי הפייפליין המלא
CONTRACTS.md   החוזים הקפואים (הודעות פנימיות + WebSocket)
GOAL.md        הגדרת "סיימנו" + בדיקת הקבלה
```

## 📊 סטטוס

✅ **רמה A — מוכן לשימוש ראשוני.** הצינור עובד מקצה-לקצה: כתוביות עברית חיות על הסרטון, האודיו נשמר, עצירה נקייה ([GOAL.md](GOAL.md), בדיקת הקבלה 1-7).

🚧 **רמה B — הפצה למשתמשים רבים** ([GOAL_LEVEL_B.md](GOAL_LEVEL_B.md)): הקוד והתשתית מוכנים — עמידות (reconnection/שגיאות/עצירה אוטומטית), שרת `wss://` turnkey ([backend/DEPLOY.md](backend/DEPLOY.md)), [מדיניות פרטיות](PRIVACY.md), ואריזה לחנות ([STORE_LISTING.md](STORE_LISTING.md)). נותרו פעולות תפעוליות: הקמת השרת המשותף, פרסום לחנות, ובדיקה עם חברים.

## 🔒 פרטיות

אודיו ההרצאה נשלח לשרת התמלול. כשהשרת מקומי (`localhost`) — הכל נשאר על המחשב שלך.

---

<sub>נבנה כפרויקט סטודנטיאלי בסיוע <a href="https://claude.com/claude-code">Claude Code</a>. עברית קוראת מימין לשמאל, וגם הכתוביות 🙂</sub>
