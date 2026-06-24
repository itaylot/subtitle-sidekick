# מדיניות פרטיות — Moodle Hebrew Subtitles

_עודכן לאחרונה: 2026_

## עברית

**מה התוסף עושה.** התוסף לוכד את אודיו הטאב הנוכחי (אודיו ההרצאה) רק לאחר שלחצת על כפתור "כתוביות", שולח אותו לשרת תמלול שמוגדר בהגדרות, ומציג בחזרה כתוביות בעברית. בלחיצה על "עצור" (או כשהסרטון נעצר) הלכידה מפסיקה.

**איזה מידע נשלח.** רק זרם האודיו של הטאב, בזמן לכידה פעילה, אל כתובת השרת שמוגדרת ב-`endpoint`.

**לאן.**
- אם השרת הוא `localhost` (ברירת המחדל לפיתוח) — האודיו **לא יוצא מהמחשב שלך**.
- אם הוגדר שרת משותף (`wss://...`) — האודיו נשלח לאותו שרת לצורך תמלול בזמן אמת בלבד.

**שמירת מידע.** שרת התמלול הייחוס (`backend/server.py`) מעבד את האודיו **בזיכרון בלבד ואינו שומר** אודיו או תמלילים לדיסק. אין בסיס נתונים, אין לוגים של תוכן.

**מה התוסף לא עושה.** אין חשבונות, אין מעקב, אין אנליטיקס, אין פרסומות, אין מכירת מידע, אין שיתוף עם צד שלישי.

**הרשאות ולמה.**
- `tabCapture` — ללכוד את אודיו ההרצאה (ליבת הפעולה).
- `offscreen` — לעבד את האודיו (המרה ל-PCM) ברקע.
- `storage` — לשמור את ההגדרות שלך (כתובת שרת, גודל/מיקום כתוביות).
- `activeTab` / `scripting` / host permissions — להציג את הכתוביות בדף.

**שליטה שלך.** הלכידה מתחילה רק בלחיצה מפורשת ונעצרת בלחיצה. אתה בוחר לאיזה שרת להתחבר.

---

## English

**What it does.** The extension captures the current tab's audio (the lecture audio) only after you click the "Subtitles" button, sends it to the transcription server configured in settings, and displays Hebrew subtitles. Clicking "Stop" (or pausing the video) ends capture.

**What is sent.** Only the tab's audio stream, while capture is active, to the configured `endpoint`.

**Where.** If the server is `localhost` (the development default), audio **never leaves your computer**. If a shared server (`wss://...`) is configured, audio is sent there solely for real-time transcription.

**Retention.** The reference server (`backend/server.py`) processes audio **in memory only and does not store** audio or transcripts. No database, no content logs.

**What it does NOT do.** No accounts, no tracking, no analytics, no ads, no selling or sharing data with third parties.

**Permissions.** `tabCapture` (capture lecture audio), `offscreen` (process audio to PCM), `storage` (save your settings), `activeTab`/`scripting`/host permissions (render subtitles on the page).

**Your control.** Capture starts only on an explicit click and stops on click. You choose which server to connect to.

---

יצירת קשר / Contact: https://github.com/itaylot/moodle-hebrew-subtitles
