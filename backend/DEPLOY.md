# DEPLOY — הקמת שרת תמלול משותף (`wss://`) לרמה B

מדריך להקמת השרת המשותף שכל החברים יתחברו אליו. התוצאה: כתובת `wss://your-domain` שאפשר להגדיר כברירת מחדל בתוסף.

> למה `wss://` ולא `ws://`? דפי Moodle הם HTTPS, והדפדפן חוסם WebSocket לא-מאובטח לשרת מרוחק. Caddy כאן נותן TLS אוטומטי.

---

## דרישות מקדימות
- שרת Linux עם IP ציבורי (VPS רגיל ל-CPU, או מכונת GPU לאיכות מיטבית).
- **דומיין** שמצביע על ה-IP (רשומת `A`).
- פורטים **80** ו-**443** פתוחים.
- מותקנים **Docker** ו-**Docker Compose**.

## שלבים (CPU — עובד בכל מקום)
```bash
git clone https://github.com/itaylot/moodle-hebrew-subtitles.git
cd moodle-hebrew-subtitles/backend

cp .env.example .env
nano .env            # ערוך DOMAIN=stt.your-domain.com

docker compose up -d --build
```
Caddy יוציא תעודת TLS אוטומטית. בדיקה:
```bash
docker compose logs -f stt     # אמור להראות "model ready" ו-"ready (contract B)"
```
כעת השרת זמין ב-`wss://stt.your-domain.com`.

## חיבור התוסף
- **לבדיקה:** ב-options של התוסף הגדר `endpoint = wss://stt.your-domain.com`.
- **להפצה:** שנה את ברירת המחדל ב-`extension/service-worker.js` (`DEFAULT_CONFIG.endpoint`) לכתובת הזו **לפני** אריזה לחנות, כדי שמשתמשים לא יצטרכו להגדיר ידנית.

---

## GPU (איכות עברית מיטבית, latency נמוך)
דורש NVIDIA GPU + [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/).

1. ב-`.env`:
   ```
   MHS_MODEL=ivrit-ai/whisper-large-v3-turbo-ct2
   MHS_DEVICE=cuda
   MHS_COMPUTE=float16
   ```
2. ב-`Dockerfile` החלף את ה-base ל-CUDA (למשל `nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04`) והתקן Python+pip.
3. ב-`docker-compose.yml`, בשירות `stt`, הוסף גישת GPU:
   ```yaml
   deploy:
     resources:
       reservations:
         devices:
           - driver: nvidia
             count: 1
             capabilities: [gpu]
   ```
4. `docker compose up -d --build`.

---

## תפעול
- **עלות:** מכונת GPU מושכרת עולה לפי שעה — שקול לכבות בשעות מתות (`docker compose down`).
- **קיבולת:** המודל מטפל במשתמש אחד בכל רגע (נעילה), והשאר ממתינים מעט. מספיק לקבוצת לימוד. לעומס גדול — הרץ כמה replicas של `stt` מאחורי Caddy, או GPU חזק יותר.
- **עדכון:** `git pull && docker compose up -d --build`.
- **לוגים:** `docker compose logs -f`.
