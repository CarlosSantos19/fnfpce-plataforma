FROM python:3.11-slim

# Instalar Chromium desde los repos de Debian (más confiable que descargar .deb de Google)
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
    --no-install-recommends \
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
