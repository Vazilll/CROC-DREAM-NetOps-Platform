"""API token generation and hashing."""

from __future__ import annotations

import hashlib
import secrets

TOKEN_BYTES = 32


def generate_token() -> str:
    """A random URL-safe token with 256 bits of entropy."""
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str) -> str:
    # Tokens are long random strings, so a fast hash is enough to make a
    # leaked database useless and still allows lookup by hash.
    return hashlib.sha256(token.encode()).hexdigest()
