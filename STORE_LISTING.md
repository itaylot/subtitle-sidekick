# Chrome Web Store — חומרי רישום (Listing)

טקסטים מוכנים להעתקה לדף הפרסום ב-Chrome Web Store Developer Console.

---

## שם (Name)
```
Moodle Hebrew Subtitles — כתוביות עברית בזמן אמת
```

## תיאור קצר (Summary, עד 132 תווים)
```
כתוביות עברית בזמן אמת על סרטוני הרצאה ב-Moodle. לוחצים כפתור — והכתוביות רצות על הסרטון.
```

## תיאור מלא (Description)
```
התוסף מוסיף כתוביות בעברית, בזמן אמת, על סרטוני הרצאה ב-Moodle (וגם YouTube).
לוחצים על כפתור "כתוביות" שמופיע על הסרטון — והכתוביות מתחילות לרוץ בתחתית, תוך
כדי שאתם ממשיכים לשמוע את ההרצאה כרגיל.

✓ עברית בזמן אמת (כתובית זמנית מתעדכנת → סופית יציבה)
✓ עובד גם כשהסרטון בתוך iframe (נפוץ ב-Moodle)
✓ האודיו ממשיך להישמע תוך כדי
✓ הגדרות: כתובת שרת, גודל ומיקום הכתוביות

התמלול מתבצע ע"י שרת Whisper (עברית). אפשר להריץ שרת מקומי (הכל נשאר אצלכם)
או להתחבר לשרת משותף. אין חשבונות, אין מעקב, אין פרסומות.

קוד פתוח: https://github.com/itaylot/moodle-hebrew-subtitles
```

## קטגוריה
```
Productivity  (או Education)
```

## שפה ראשית
```
Hebrew
```

---

## Single purpose (נדרש באישור)
```
Display real-time Hebrew subtitles over lecture videos by capturing the tab's
audio and transcribing it via a Whisper server.
```

## הצדקת הרשאות (Permission justifications)
- **tabCapture** — `Capture the lecture's audio to transcribe it into subtitles. This is the extension's core function.`
- **offscreen** — `Process the captured audio (convert to PCM) in an offscreen document, as required by Manifest V3.`
- **storage** — `Save user settings: transcription server address, subtitle size and position.`
- **activeTab / scripting / host permissions** — `Inject the subtitle overlay and button into the page where the video plays.`

## Privacy policy URL
```
https://github.com/itaylot/moodle-hebrew-subtitles/blob/main/PRIVACY.md
```

## Data usage (Data disclosure)
- האם נאסף מידע אישי? **לא.**
- שימוש באודיו: נשלח לשרת התמלול בזמן לכידה בלבד; לא נשמר (בשרת הייחוס).
- אין מכירה/שיתוף עם צד שלישי.

---

## נכסים גרפיים שצריך להכין (אתה)
- [ ] **Icon 128x128** — קיים ב-`extension/icons/icon128.png` (placeholder; שקול עיצוב יפה יותר).
- [ ] **Screenshot 1280x800 (לפחות אחד)** — צילום של כתובית עברית רצה על הרצאה.
- [ ] **(אופציונלי) Promo tile 440x280.**

> טיפ: לצילום מסך — הפעל את התוסף על סרטון, צלם כשהכתובית מופיעה.

## תהליך
1. הרץ `tools\package-extension.ps1` → נוצר zip ב-`dist/`.
2. https://chrome.google.com/webstore/devconsole → New item → העלה את ה-zip.
3. מלא את הטקסטים מהקובץ הזה + העלה צילום מסך + קישור מדיניות פרטיות.
4. שלם דמי רישום מפתח חד-פעמיים (~$5) אם זו הפעם הראשונה.
5. Submit for review (אישור גוגל לוקח כמה ימים).
