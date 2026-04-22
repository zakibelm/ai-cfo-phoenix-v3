"""
AI CFO Suite - Backend FastAPI
Point d'entree principal : configure l'app, les middlewares et les routes.

Architecture :
    - utils/security.py     : sanitisation et validation
    - services/text_extractor.py : extraction de texte multi-format
    - services/rag_service.py    : chunking et contexte RAG
    - agent_prompts.py           : prompts systeme des agents IA
"""
import json
import os
import sys
from collections.abc import AsyncGenerator
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# Modules internes
from agent_prompts import AGENT_PROMPTS
from services.rag_service import build_rag_context, load_document_text
from services.text_extractor import extract_text_from_file
from utils.security import is_allowed_file_type, is_safe_path, sanitize_filename

# Encodage UTF-8 sous Windows
if sys.platform == "win32":
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "strict")
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "strict")

# Charger le .env depuis la racine du projet (pas depuis backend/)
_project_root = Path(__file__).parent.parent
print(f"[DEBUG] Project root: {_project_root}")
print(f"[DEBUG] Env path: {_project_root / '.env'}")
print(f"[DEBUG] Env exists: {(_project_root / '.env').exists()}")
load_dotenv(_project_root / ".env", override=True)
OPENROUTER_API_KEY: str = os.getenv("OPENROUTER_API_KEY", "")
print(f"[DEBUG] API Key loaded: {OPENROUTER_API_KEY[:10] if OPENROUTER_API_KEY else 'EMPTY'}...")
DEFAULT_MODEL: str = os.getenv("DEFAULT_MODEL", "google/gemini-2.0-flash-exp:free")
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Dossier d'uploads
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# Limites de securite
MAX_FILE_SIZE = 50 * 1024 * 1024   # 50 MB par fichier
MAX_FILES_PER_REQUEST = 50          # max 50 fichiers par upload

# ─────────────────────────────────────────────────────────────────────────────
# Application FastAPI
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="AI CFO Suite API",
    description="API pour la suite AI CFO : upload, extraction, RAG et requetes IA.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────────────────────
# CFO Knowledge Factory — router (KB + Factory endpoints)
# ─────────────────────────────────────────────────────────────────────────────
try:
    from cfo_kf_routes import router as cfo_kf_router
    app.include_router(cfo_kf_router)
    print("[INFO] CFO Knowledge Factory router mounted at /api/knowledge/* and /api/cfo-kf/*")
except Exception as _e:
    print(f"[WARN] CFO Knowledge Factory router not loaded: {_e}")

# ─────────────────────────────────────────────────────────────────────────────
# Routes utilitaires
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {"message": "AI CFO Suite API", "status": "running", "version": "2.0.0"}


@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.get("/debug/config")
async def debug_config():
    """Debug endpoint to check configuration."""
    return {
        "api_key_length": len(OPENROUTER_API_KEY),
        "api_key_prefix": OPENROUTER_API_KEY[:10] + "..." if OPENROUTER_API_KEY else "EMPTY",
        "default_model": DEFAULT_MODEL,
        "api_url": OPENROUTER_API_URL,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Upload de fichiers
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/upload", status_code=200)
async def upload_files(files: list[UploadFile] = File(...)):
    """
    Upload et traitement de fichiers financiers.
    - Valide les types et tailles de fichiers
    - Sanitise les noms de fichiers (securite path traversal)
    - Extrait le texte pour le RAG
    """
    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(
            status_code=400,
            detail=f"Trop de fichiers. Maximum {MAX_FILES_PER_REQUEST} par requete."
        )

    uploaded = []
    errors = []

    for file in files:
        raw_name = file.filename or "unnamed_file"

        # Sanitiser le nom de fichier
        safe_name = sanitize_filename(raw_name)

        # Verifier le type de fichier
        if not is_allowed_file_type(safe_name):
            errors.append({
                "filename": raw_name,
                "error": f"Type de fichier non autorise : .{safe_name.rsplit('.', 1)[-1]}"
            })
            continue

        try:
            content = await file.read(MAX_FILE_SIZE + 1)

            if len(content) > MAX_FILE_SIZE:
                errors.append({
                    "filename": raw_name,
                    "error": f"Fichier trop volumineux (>{MAX_FILE_SIZE // 1024 // 1024} MB)"
                })
                continue

            # Chemin de destination securise
            dest_path = UPLOAD_DIR / safe_name
            if not is_safe_path(UPLOAD_DIR, dest_path):
                errors.append({"filename": raw_name, "error": "Nom de fichier invalide"})
                continue

            # Sauvegarder le fichier original
            dest_path.write_bytes(content)

            # Extraire le texte pour le RAG
            extracted_text = extract_text_from_file(content, safe_name)
            text_path = UPLOAD_DIR / f"{safe_name}.extracted.txt"
            text_path.write_text(extracted_text, encoding="utf-8")

            uploaded.append({
                "filename": safe_name,
                "original_filename": raw_name,
                "size": len(content),
                "path": str(dest_path),
                "extracted_preview": extracted_text[:500] + "..." if len(extracted_text) > 500 else extracted_text,
                "text_path": str(text_path),
            })

        except Exception as exc:
            errors.append({"filename": raw_name, "error": str(exc)})

    return {
        "message": f"{len(uploaded)} fichier(s) traite(s)",
        "files": uploaded,
        "errors": errors,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Extraction de texte (sans sauvegarde)
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/extract-text", status_code=200)
async def extract_text_endpoint(files: list[UploadFile] = File(...)):
    """Extrait le texte de fichiers uploades sans les sauvegarder."""
    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(
            status_code=400,
            detail=f"Trop de fichiers. Maximum {MAX_FILES_PER_REQUEST} par requete."
        )

    results = []
    for file in files:
        raw_name = file.filename or "unnamed_file"
        safe_name = sanitize_filename(raw_name)

        try:
            content = await file.read(MAX_FILE_SIZE + 1)
            if len(content) > MAX_FILE_SIZE:
                results.append({
                    "filename": safe_name,
                    "content": f"[ERREUR] Fichier trop volumineux (>{MAX_FILE_SIZE // 1024 // 1024} MB)",
                    "size": len(content),
                })
                continue

            text = extract_text_from_file(content, safe_name)
            results.append({"filename": safe_name, "content": text, "size": len(content)})
            del content

        except Exception as exc:
            results.append({"filename": safe_name, "content": f"[Erreur extraction: {exc}]", "size": 0})

    return {"files": results}


# ─────────────────────────────────────────────────────────────────────────────
# RAG - recuperation d'un document
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/rag/{filename}")
async def get_rag_document(filename: str):
    """Recupere le contenu extrait d'un document RAG."""
    safe_name = sanitize_filename(filename)
    doc_text = load_document_text(UPLOAD_DIR, safe_name)

    if doc_text is None:
        raise HTTPException(status_code=404, detail=f"Document '{safe_name}' introuvable dans le RAG.")

    return {"filename": safe_name, "content": doc_text, "size": len(doc_text)}


# ─────────────────────────────────────────────────────────────────────────────
# Helper : construction des messages pour l'API LLM
# ─────────────────────────────────────────────────────────────────────────────

def _build_messages(
    query_text: str,
    selected_agent: str,
    document_name: str | None,
    conversation_history: list,
) -> list:
    """Construit la liste de messages pour l'API OpenRouter."""
    system_prompt = AGENT_PROMPTS.get(selected_agent, AGENT_PROMPTS["Auto"])
    system_prompt += "\n\nTu reponds de maniere professionnelle et concise en francais."

    messages = [{"role": "system", "content": system_prompt}]

    # Charger le contexte RAG si un document est specifie
    rag_content = ""
    if document_name:
        safe_name = sanitize_filename(document_name)
        raw_text = load_document_text(UPLOAD_DIR, safe_name)
        if raw_text:
            rag_content = build_rag_context(raw_text, query_text)

    if rag_content and conversation_history:
        first_msg = conversation_history[0]
        enhanced = (
            f"CONTEXTE (Document RAG: {document_name}):\n{rag_content}\n\n---\n\n"
            f"{first_msg.get('content', '')}"
        )
        messages.append({"role": "user", "content": enhanced})
        messages.extend(conversation_history[1:])
    elif rag_content:
        user_prompt = (
            f"CONTEXTE (Document RAG: {document_name}):\n{rag_content}\n\n---\n\n"
            f"QUESTION: {query_text}"
        )
        messages.append({"role": "user", "content": user_prompt})
    elif conversation_history:
        messages.extend(conversation_history)
    else:
        messages.append({"role": "user", "content": query_text})

    return messages


# ─────────────────────────────────────────────────────────────────────────────
# Requete IA standard (non-streaming)
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/query", status_code=200)
async def query(payload: dict):
    """
    Requete IA avec contexte RAG optionnel et historique de conversation.
    La cle API est lue exclusivement depuis les variables d'environnement serveur.
    """
    query_text: str = payload.get("query", "").strip()
    if not query_text:
        raise HTTPException(status_code=400, detail="Le champ 'query' est obligatoire.")

    document_name: str | None = payload.get("document_name")
    selected_agent: str = payload.get("agent", "Auto")
    selected_model: str = payload.get("model", DEFAULT_MODEL)
    conversation_history: list = payload.get("history", [])

    # Securite : la cle API vient uniquement du serveur
    api_key = OPENROUTER_API_KEY
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Cle API OpenRouter non configuree sur le serveur. Contactez l'administrateur."
        )

    messages = _build_messages(query_text, selected_agent, document_name, conversation_history)
    agent_name = "CFO" if selected_agent == "Auto" else selected_agent

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                OPENROUTER_API_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "HTTP-Referer": "http://localhost:5173",
                    "X-Title": "AI CFO Suite",
                },
                json={"model": selected_model, "messages": messages},
                timeout=60.0,
            )

        if response.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Erreur API OpenRouter [{response.status_code}]: {response.text[:300]}"
            )

        data = response.json()
        choices = data.get("choices", [])
        if not choices:
            err_msg = data.get("error", {}).get("message", "Format de reponse inattendu")
            raise HTTPException(status_code=502, detail=f"Reponse API invalide: {err_msg}")

        return {
            "agent": agent_name,
            "response": choices[0]["message"]["content"],
            "tool_calls": [],
        }

    except HTTPException:
        raise
    except Exception as exc:
        safe_msg = str(exc).encode("ascii", "ignore").decode("ascii")
        raise HTTPException(status_code=500, detail=f"Erreur interne: {safe_msg}")


# ─────────────────────────────────────────────────────────────────────────────
# Requete IA avec streaming SSE (Server-Sent Events)
# ─────────────────────────────────────────────────────────────────────────────

async def _stream_openrouter(
    messages: list,
    model: str,
    api_key: str,
) -> AsyncGenerator[str, None]:
    """Generateur de tokens SSE depuis l'API OpenRouter (streaming)."""
    async with httpx.AsyncClient() as client, client.stream(
        "POST",
        OPENROUTER_API_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": "http://localhost:5173",
            "X-Title": "AI CFO Suite",
        },
        json={"model": model, "messages": messages, "stream": True},
        timeout=90.0,
    ) as response:
        if response.status_code != 200:
            await response.aread()
            yield f"data: {json.dumps({'error': f'API error {response.status_code}'})}\n\n"
            return

        async for line in response.aiter_lines():
            if not line.startswith("data: "):
                continue
            data_str = line[6:]
            if data_str == "[DONE]":
                yield "data: [DONE]\n\n"
                return
            try:
                data = json.loads(data_str)
                delta = data["choices"][0]["delta"]
                content = delta.get("content", "")
                if content:
                    yield f"data: {json.dumps({'content': content})}\n\n"
            except (KeyError, json.JSONDecodeError):
                continue


@app.post("/stream-query")
async def stream_query(payload: dict):
    """
    Requete IA avec reponse en streaming (Server-Sent Events).
    Avantage UX : l'utilisateur voit les tokens apparaitre progressivement.
    """
    query_text: str = payload.get("query", "").strip()
    if not query_text:
        raise HTTPException(status_code=400, detail="Le champ 'query' est obligatoire.")

    document_name: str | None = payload.get("document_name")
    selected_agent: str = payload.get("agent", "Auto")
    selected_model: str = payload.get("model", DEFAULT_MODEL)
    conversation_history: list = payload.get("history", [])

    api_key = OPENROUTER_API_KEY
    if not api_key:
        raise HTTPException(status_code=503, detail="Cle API OpenRouter non configuree.")

    messages = _build_messages(query_text, selected_agent, document_name, conversation_history)
    agent_name = "CFO" if selected_agent == "Auto" else selected_agent

    # Envoyer le nom de l'agent en premier event
    async def event_stream() -> AsyncGenerator[str, None]:
        yield f"data: {json.dumps({'agent': agent_name})}\n\n"
        async for chunk in _stream_openrouter(messages, selected_model, api_key):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ─────────────────────────────────────────────────────────────────────────────
# Entrypoint
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
