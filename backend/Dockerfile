# syntax=docker/dockerfile:1
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    iputils-ping \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /bin/uv

WORKDIR /app

COPY pyproject.toml uv.lock README.md ./
RUN uv sync --no-dev --no-install-project --extra scrapli

COPY alembic.ini ./
COPY migrations ./migrations
COPY netops ./netops
RUN uv sync --no-dev --extra scrapli

RUN useradd --create-home --uid 1000 netops && chown -R netops:netops /app
USER netops

EXPOSE 8000
CMD ["uvicorn", "netops.main:app", "--host", "0.0.0.0", "--port", "8000"]
