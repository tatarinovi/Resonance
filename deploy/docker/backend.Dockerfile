FROM python:3.11-slim AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libolm-dev \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY backend/requirements.prod.txt ./requirements.txt
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade PyJWT==2.12.0 \
    && /opt/venv/bin/pip check

FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libolm-dev \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /usr/sbin/nologin app

WORKDIR /app
COPY --from=builder /opt/venv /opt/venv
RUN rm -f /opt/venv/bin/pip* \
    && find /opt/venv/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages \
        -maxdepth 1 \( \
            -iname "pip*" \
            -o -iname "setuptools*" \
            -o -iname "wheel*" \
            -o -iname "jaraco*" \
            -o -iname "backports.tarfile*" \
        \) -exec rm -rf {} +
COPY backend/alembic.ini ./
COPY backend/migrations ./migrations
COPY backend/app ./app

USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=60s CMD curl -fsS http://127.0.0.1:8000/health || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
