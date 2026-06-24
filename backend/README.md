# Backend — שרת התמלול

שרת WebSocket שמקבל אודיו PCM מהתוסף ומחזיר כתוביות עברית. מדבר לפי **חוזה B** ([CONTRACTS.md](../CONTRACTS.md)).

יש שתי גרסאות:

| קובץ | מה | מתי להשתמש |
|------|-----|-----------|
| `mock_server.py` | מחזיר טקסט עברי **מזויף**, בלי ML | לבדוק שהתוסף עובד מקצה-לקצה מיד (ממליץ להתחיל מכאן) |
| `server.py` | תמלול **אמיתי** עם faster-whisper + Silero VAD | לתמלול עברית אמיתי |

---

## ⚠️ הערת גרסת Python (חשוב)

faster-whisper מסתמך על `ctranslate2`, שזקוק ל-wheels מהודרים. **נכון להיום אין עדיין wheels ל-Python 3.14.** לשרת האמיתי מומלץ **Python 3.11 או 3.12**.
ה-`mock_server.py` עובד על כל גרסת Python (תלוי רק ב-`websockets`).

---

## התקנה

```bash
cd backend
# חשוב: לשרת האמיתי השתמש ב-Python 3.11/3.12 (לא 3.14)
py -3.12 -m venv .venv          # Windows;  macOS/Linux: python3.12 -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate

# ל-mock בלבד מספיק:  pip install websockets
# לשרת האמיתי (faster-whisper + numpy + websockets):
pip install -r requirements.txt
```

## הרצה

### 1) שרת mock (התחל מכאן — בלי הורדת מודל)
```bash
python mock_server.py
# מאזין על ws://localhost:9090, מחזיר עברית מזויפת
```

### 2) שרת אמיתי
```bash
python server.py
# בהרצה ראשונה יוריד את המודל העברי (~1.5GB)
```

**ברירת המחדל: מודל עברי ייעודי `ivrit-ai/whisper-large-v3-turbo-ct2` על CPU (INT8)** — הכי מדויק לעברית (אומת: תמלל דגימת עברית במדויק, כולל פיסוק). על CPU ה-latency גבוה יותר.

- **מחשב חלש/איטי?** מודל קל ומהיר יותר (פחות מדויק):  `$env:MHS_MODEL="small"`
- **יש NVIDIA GPU?** ל-latency נמוך:  `$env:MHS_DEVICE="cuda"; $env:MHS_COMPUTE="float16"`

| משתנה | ברירת מחדל | אפשרויות |
|-------|-----------|----------|
| `MHS_MODEL` | `ivrit-ai/whisper-large-v3-turbo-ct2` | כל מודל faster-whisper, למשל `small` (קל ומהיר) |
| `MHS_DEVICE` | `cpu` | `cuda` |
| `MHS_COMPUTE` | `int8` | `float16` (GPU), `int8_float16` |
| `MHS_LANG` | `he` | קוד שפה |
| `MHS_HOST` / `MHS_PORT` | `localhost` / `9090` | |

## בדיקה
```bash
# בטרמינל נפרד, כשהשרת רץ:
python test_client.py
# אמור להדפיס הודעות partial/final
```

---

## פריסה לחברים (רמה B — בהמשך)

דפי Moodle הם HTTPS, ולכן הדפדפן **חוסם** `ws://` לשרת מרוחק. שרת משותף חייב **`wss://`** (TLS).
מסלול מקובל: להריץ את `server.py` מאחורי reverse-proxy (nginx / caddy) שמטפל ב-TLS, ולהגדיר בתוסף (options) endpoint כמו `wss://your-server.example/`. ראה הערת mixed-content ב-[CONTRACTS.md](../CONTRACTS.md).

## מגבלות v1 (גילוי נאות)
- `server.py` מתמלל את ה-buffer המצטבר מחדש בכל partial — פשוט וקריא, אך לא אופטימלי לטווח ארוך. ה-buffer מתאפס בסוף כל מבע (שקט). מספיק ל-v1; לעומסים כבדים שקול WhisperLive.
