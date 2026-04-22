"""
ollama_client.py
─────────────────────────────────────────────────────────────────────────────
Wrapper async pour Ollama local. Utilisé en mode `confidentiel-client`
(Loi 25 + secret professionnel CPA) pour garantir qu'aucune donnée ne quitte
le VPS.

Pré-requis :
- Ollama installé sur le serveur : https://ollama.ai
- Au moins un modèle pull : `ollama pull qwen2.5-coder:7b`
                            `ollama pull qwen3:4b` (plus léger)
                            `ollama pull mxbai-embed-large` (pour embeddings)

Configuration .env :
    OLLAMA_HOST=http://localhost:11434
    OLLAMA_DEFAULT_MODEL=qwen2.5-coder:7b
"""

import json
import os
from collections.abc import AsyncIterator

import httpx

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
OLLAMA_DEFAULT_MODEL = os.getenv("OLLAMA_DEFAULT_MODEL", "qwen2.5-coder:7b")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "120"))


class OllamaUnavailableError(Exception):
    """Levée quand Ollama est inaccessible (mode confidentiel-client → blocage du run)."""
    pass


async def check_ollama_alive() -> bool:
    """Ping rapide de l'API Ollama. True si disponible."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{OLLAMA_HOST}/api/tags")
            return r.status_code == 200
    except (httpx.HTTPError, ValueError) as _e:
        return False


async def list_ollama_models() -> list[str]:
    """Retourne la liste des modèles installés localement."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{OLLAMA_HOST}/api/tags")
            if r.status_code != 200:
                return []
            data = r.json()
            return [m["name"] for m in data.get("models", [])]
    except (httpx.HTTPError, ValueError) as _e:
        return []


async def call_ollama(
    model: str | None,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 2500,
    temperature: float = 0.6,
) -> str:
    """
    Appel Ollama local. Retourne le contenu de la réponse.
    Lève OllamaUnavailableError si l'instance est inaccessible.
    """
    model = model or OLLAMA_DEFAULT_MODEL
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
        },
    }
    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            r = await client.post(f"{OLLAMA_HOST}/api/chat", json=payload)
            if r.status_code != 200:
                raise OllamaUnavailableError(
                    f"Ollama HTTP {r.status_code} : {r.text[:200]}"
                )
            data = r.json()
            return data.get("message", {}).get("content", "")
    except httpx.ConnectError as e:
        raise OllamaUnavailableError(
            f"Ollama injoignable à {OLLAMA_HOST} — vérifie que `ollama serve` tourne. ({e})"
        ) from e
    except httpx.ReadTimeout as e:
        raise OllamaUnavailableError(
            f"Ollama timeout après {OLLAMA_TIMEOUT}s — modèle trop lent ou bloqué. ({e})"
        ) from e


async def call_ollama_streaming(
    model: str | None,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 2500,
    temperature: float = 0.6,
) -> AsyncIterator[str]:
    """Variante streaming — yield les tokens un à un. Utile pour SSE côté API."""
    model = model or OLLAMA_DEFAULT_MODEL
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "stream": True,
        "options": {"temperature": temperature, "num_predict": max_tokens},
    }
    try:
        async with (
            httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client,
            client.stream("POST", f"{OLLAMA_HOST}/api/chat", json=payload) as r,
        ):
                if r.status_code != 200:
                    raise OllamaUnavailableError(f"Ollama HTTP {r.status_code}")
                async for line in r.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    msg = chunk.get("message", {}).get("content", "")
                    if msg:
                        yield msg
                    if chunk.get("done"):
                        break
    except (httpx.ConnectError, httpx.ReadTimeout) as e:
        raise OllamaUnavailableError(str(e)) from e


async def generate_embedding_ollama(text: str, model: str = "mxbai-embed-large") -> list[float] | None:
    """Génère un embedding 1024d via Ollama local. Retourne None en cas d'erreur."""
    if not text:
        return None
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{OLLAMA_HOST}/api/embeddings",
                json={"model": model, "prompt": text[:2000]},
            )
            if r.status_code != 200:
                return None
            data = r.json()
            return data.get("embedding")
    except (httpx.HTTPError, ValueError) as _e:
        return None
