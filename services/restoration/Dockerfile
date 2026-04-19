FROM python:3.11-slim-bookworm

WORKDIR /app

# Install system dependencies (ffmpeg for video pipeline)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY server.py .

# Models are mounted as a volume (not baked into image for size)
# docker run -v ./models:/app/models ...
RUN mkdir -p /app/models

ENV RESTORATION_PORT=7860

EXPOSE 7860

CMD ["python", "server.py"]
