FROM python:3.11-slim

WORKDIR /app

# Instalar dependencias del sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copiar requirements e instalar
COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar codigo fuente
COPY src/ ./src/
COPY api/ ./api/

# Directorio de trabajo para el API
WORKDIR /app/api

# Puerto (Render asigna PORT automaticamente)
ENV PORT=10000

EXPOSE ${PORT}

# Ejecutar con uvicorn
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT}
