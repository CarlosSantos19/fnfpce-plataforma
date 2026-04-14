FROM python:3.11-slim

# Instalar Chrome y dependencias del sistema
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    curl \
    unzip \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y /tmp/chrome.deb \
    && rm /tmp/chrome.deb \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Carpeta de trabajo
WORKDIR /app

# Copiar solo los archivos necesarios
COPY . .
RUN pip install --no-cache-dir -r requirements.txt
RUN cp config_render.py config.py

# Carpeta de descargas temporales
RUN mkdir -p /tmp/cne_descargas

EXPOSE 10000

CMD gunicorn servidor_render:app --bind 0.0.0.0:$PORT --timeout 600 --workers 1 --threads 4
