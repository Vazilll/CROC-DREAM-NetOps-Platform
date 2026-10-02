# syntax=docker/dockerfile:1
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /bin/uv

WORKDIR /app

# Сначала зависимости: слой кэшируется, пока не изменится uv.lock.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY alembic.ini ./
COPY migrations ./migrations
COPY netops ./netops
RUN uv sync --frozen --no-dev

RUN useradd --create-home --uid 1000 netops
USER netops

EXPOSE 8000
# Этот же образ запускает API (по умолчанию), воркер и Beat:
#   celery -A netops.worker.tasks worker --loglevel=INFO
#   celery -A netops.worker.tasks beat --loglevel=INFO
CMD ["uvicorn", "netops.main:app", "--host", "0.0.0.0", "--port", "8000"]
