FROM python:3.11-slim-bookworm

WORKDIR /app

# Install system dependencies (ffmpeg for video pipeline, libgl for OpenCV)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY server.py .

# Models and weights are mounted as volumes (not baked into image for size)
# docker run -v ./models:/app/models -v ./gfpgan/weights:/app/gfpgan/weights ...
RUN mkdir -p /app/models /app/gfpgan/weights

ENV RESTORATION_PORT=7860

EXPOSE 7860

CMD ["python", "server.py"]
