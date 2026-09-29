"""ASGI entry point: ``uvicorn netops.main:app``."""

from netops.api import create_app

app = create_app()
