# syntax=docker/dockerfile:1
# ==============================================================================
# CROC DREAM NetOps Platform — All-in-One Monolithic Container
# Включает внутри одного контейнера:
#   - PostgreSQL + Redis
#   - Prometheus + Node Exporter + SNMP Exporter
#   - FastAPI Backend + Threaded Worker/Beat + Telegram Bot
#   - React Frontend + Nginx Reverse Proxy (:5173)
#
# Сборка и запуск одной командой:
#   docker build -t croc-netops .
#   docker run -d --name croc-netops -p 5173:5173 -p 8000:8000 -p 9090:9090 croc-netops
# ==============================================================================

FROM node:20-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM prom/prometheus:v2.54.1 AS prom-bin
FROM prom/node-exporter:v1.8.2 AS node-exp-bin
FROM prom/snmp-exporter:v0.26.0 AS snmp-exp-bin

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    DEBIAN_FRONTEND=noninteractive \
    PATH="/app/backend/.venv/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql \
    postgresql-contrib \
    redis-server \
    nginx \
    git \
    openssh-client \
    iputils-ping \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /bin/uv
COPY --from=prom-bin /bin/prometheus /usr/local/bin/prometheus
COPY --from=node-exp-bin /bin/node_exporter /usr/local/bin/node_exporter
COPY --from=snmp-exp-bin /bin/snmp_exporter /usr/local/bin/snmp_exporter
COPY --from=snmp-exp-bin /etc/snmp_exporter/snmp.yml /etc/snmp_exporter/snmp.yml

WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock backend/README.md ./
RUN uv sync --no-dev --no-install-project --extra scrapli

COPY backend/ ./
RUN uv sync --no-dev --extra scrapli

WORKDIR /app
COPY intent ./intent
COPY templates ./templates
COPY lab ./lab
RUN rm -rf /app/lab/running/* && mkdir -p /app/lab/running && echo "[]" > /app/lab/running/prometheus_targets.json
COPY monitoring ./monitoring
COPY scripts ./scripts

# Frontend static bundle + Nginx config on port 5173 (and 80)
COPY --from=frontend-build /frontend/dist /usr/share/nginx/html
RUN rm -f /etc/nginx/sites-enabled/default && \
    printf 'server {\n\
    listen 5173 default_server;\n\
    listen 80 default_server;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location /api/ {\n\
        proxy_pass http://127.0.0.1:8000;\n\
        proxy_http_version 1.1;\n\
        proxy_set_header Upgrade $http_upgrade;\n\
        proxy_set_header Connection "upgrade";\n\
        proxy_set_header Host $host;\n\
        proxy_set_header X-Real-IP $remote_addr;\n\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n\
        proxy_set_header X-Client-Id $http_x_client_id;\n\
        proxy_read_timeout 300s;\n\
    }\n\
    location ~ ^/(healthz|readyz|metrics|docs|openapi\\.json)$ {\n\
        proxy_pass http://127.0.0.1:8000;\n\
        proxy_set_header Host $host;\n\
    }\n\
    location / {\n\
        try_files $uri /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/netops.conf

# Local Prometheus config inside the all-in-one container
RUN mkdir -p /etc/prometheus && \
    sed -e 's/api:8000/127.0.0.1:8000/g' \
        -e 's/snmp-exporter:9116/127.0.0.1:9116/g' \
        /app/monitoring/prometheus.yml > /etc/prometheus/prometheus.yml && \
    printf '\n  - job_name: "node_exporter"\n    static_configs:\n      - targets: ["127.0.0.1:9100"]\n' >> /etc/prometheus/prometheus.yml

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 5173 8000 9090
CMD ["/entrypoint.sh"]
