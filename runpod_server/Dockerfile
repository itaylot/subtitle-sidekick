FROM runpod/base:0.6.2-cuda12.1.0

COPY requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt

# bake the model into the image at build time — avoids a multi-GB download on every cold start
RUN python3 -c "from faster_whisper import WhisperModel; WhisperModel('ivrit-ai/whisper-large-v3-turbo-ct2', device='cpu', compute_type='int8')"

COPY handler.py /handler.py

CMD ["python3", "-u", "/handler.py"]
