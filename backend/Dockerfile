# Dockerfile — שרת התמלול (CPU). ל-GPU ראה DEPLOY.md.
# python:3.12 — בעל wheels תקינים ל-faster-whisper/ctranslate2 (בניגוד ל-3.14).
FROM python:3.12-slim

WORKDIR /app

# ffmpeg עשוי להידרש לעיבוד אודיו ע"י faster-whisper
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

# בקונטיינר מאזינים על כל הממשקים כדי ש-Caddy יוכל להגיע
ENV MHS_HOST=0.0.0.0 \
    MHS_PORT=9090 \
    MHS_MODEL=small \
    MHS_DEVICE=cpu \
    MHS_COMPUTE=int8

EXPOSE 9090
CMD ["python", "server.py"]
