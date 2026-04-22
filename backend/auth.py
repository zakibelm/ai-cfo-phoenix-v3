"""
auth.py — ZAKI OS Z12 AI CFO Suite
─────────────────────────────────────────────────────────────────────────────
Dependency FastAPI pour extraire user_id du JWT Bearer token ou Supabase JWT.

Stratégie en cascade :
1. Si Authorization: Bearer <jwt> → décoder (Supabase JWT ou JWT maison)
2. Si header X-User-Id présent (dev mode uniquement) → utiliser tel quel
3. Sinon → user_id par défaut DEV (configurable via .env)

Variables d'env :
    SUPABASE_JWT_SECRET        → pour valider les tokens Supabase (prod)
    AUTH_MODE                  → "strict" | "dev" (default "dev")
    DEV_DEFAULT_USER_ID        → UUID pour requêtes non auth (default: zéros)
"""

from __future__ import annotations

import os
import uuid
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request

from observability import get_logger, set_request_id

log = get_logger(__name__)

AUTH_MODE = os.getenv("AUTH_MODE", "dev").lower()  # "strict" | "dev"
DEV_DEFAULT_USER_ID = os.getenv(
    "DEV_DEFAULT_USER_ID", "00000000-0000-0000-0000-000000000001"
)
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "").strip()


def _decode_jwt(token: str) -> dict | None:
    """Décode un JWT. Retourne le payload ou None si invalide.
    Tente PyJWT si dispo, sinon fallback décodage base64 sans vérif (dev only)."""
    try:
        import jwt  # type: ignore
        if SUPABASE_JWT_SECRET:
            return jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=["HS256"],
                              options={"verify_aud": False})
        # Sans secret : décode sans vérif (dev uniquement)
        return jwt.decode(token, options={"verify_signature": False})
    except ImportError:
        # PyJWT absent → fallback décodage payload manuel (dev uniquement)
        try:
            import base64
            import json as _json
            parts = token.split(".")
            if len(parts) != 3:
                return None
            payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
            return _json.loads(base64.urlsafe_b64decode(payload_b64))
        except (ValueError, TypeError, _json.JSONDecodeError) as e:
            log.warning("auth.jwt.manual_decode_failed", error=str(e))
            return None
    except Exception as e:  # noqa: BLE001 — we need to catch jwt-specific errors
        # jwt.InvalidTokenError, etc. — on log + return None (pas de re-raise,
        # on veut basculer en fallback plutôt que crasher l'endpoint)
        log.warning("auth.jwt.decode_failed", error=str(e))
        return None


def _is_valid_uuid(s: str) -> bool:
    try:
        uuid.UUID(s)
        return True
    except ValueError:
        return False


async def get_current_user_id(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    x_user_id: Annotated[str | None, Header()] = None,
) -> str:
    """
    Dependency FastAPI : retourne le user_id courant (UUID string).

    Comportement :
    - AUTH_MODE=strict : JWT obligatoire ; 401 si absent/invalide
    - AUTH_MODE=dev    : tombe sur DEV_DEFAULT_USER_ID si pas d'auth
    """
    # Request ID correlation pour logs
    rid = request.headers.get("X-Request-Id") or None
    set_request_id(rid)

    # 1. Bearer JWT
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(None, 1)[1].strip()
        payload = _decode_jwt(token)
        if payload:
            # Supabase : sub = user UUID
            uid = payload.get("sub") or payload.get("user_id")
            if uid and _is_valid_uuid(uid):
                log.debug("auth.jwt.ok", user_id=uid)
                return uid
        if AUTH_MODE == "strict":
            raise HTTPException(status_code=401, detail="JWT invalide")

    # 2. Header X-User-Id (dev uniquement)
    if x_user_id and AUTH_MODE != "strict":
        if _is_valid_uuid(x_user_id):
            return x_user_id
        log.warning("auth.x_user_id.not_uuid", value=x_user_id)

    # 3. Strict mode sans token → 401
    if AUTH_MODE == "strict":
        raise HTTPException(status_code=401, detail="Authorization header requis")

    # 4. Dev fallback
    return DEV_DEFAULT_USER_ID


# Alias pour annotation plus claire côté endpoints
CurrentUserId = Annotated[str, Depends(get_current_user_id)]
