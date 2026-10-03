from __future__ import annotations

import hashlib
import secrets

TOKEN_BYTES = 32


def generate_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str) -> str:
    # Токен случайный и длинный, поэтому быстрого SHA-256 достаточно.
    return hashlib.sha256(token.encode()).hexdigest()
