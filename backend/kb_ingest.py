"""
kb_ingest.py
─────────────────────────────────────────────────────────────────────────────
Logique d'ingestion des documents dans la Knowledge Base.

Pipeline :
1. Validation + sanitisation du nom de fichier
2. Sauvegarde physique dans uploads/
3. Extraction de texte (réutilise services/text_extractor.py existant)
4. Embedding via Hugging Face Inference API (intfloat/multilingual-e5-large)
5. Insertion en DB via kb_storage

Fallbacks :
- Si HF_API_TOKEN absent → on skip l'embedding (le doc reste indexé sans vecteur)
- Si SUPABASE absent → stockage local JSON via kb_storage
"""

import hashlib
import os
from datetime import datetime
from pathlib import Path

import httpx

from kb_storage import insert_kb_doc
from services.text_extractor import extract_text_from_file
from utils.security import is_allowed_file_type, is_safe_path, sanitize_filename

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

HF_API_TOKEN = os.getenv("HF_API_TOKEN", "").strip()
HF_EMBED_URL = "https://api-inference.huggingface.co/models/intfloat/multilingual-e5-large"


# ─────────────────────────────────────────────────────────────────────────────
# Embedding via Hugging Face
# ─────────────────────────────────────────────────────────────────────────────

async def generate_embedding(text: str) -> list[float] | None:
    """Génère un embedding 1024d. Retourne None si HF indisponible."""
    if not HF_API_TOKEN:
        return None
    if not text:
        return None
    # Tronquer à 8k tokens approx (e5-large max = 512 tokens mais on limite pour stability)
    text = text[:2000]
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post(
                HF_EMBED_URL,
                headers={"Authorization": f"Bearer {HF_API_TOKEN}"},
                json={"inputs": text, "options": {"wait_for_model": True}},
            )
            if resp.status_code != 200:
                print(f"[WARN] HF embedding failed: {resp.status_code} {resp.text[:200]}")
                return None
            data = resp.json()
            # HF retourne parfois [[...embeddings...]] parfois [...] directement
            if isinstance(data, list) and data and isinstance(data[0], list):
                return data[0]
            if isinstance(data, list) and data and isinstance(data[0], (int, float)):
                return data
            return None
    except (httpx.HTTPError, ValueError, KeyError) as e:
        print(f"[WARN] Embedding error: {e}")
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Ingestion principale
# ─────────────────────────────────────────────────────────────────────────────

async def ingest_file(
    file_path: Path,
    original_filename: str,
    bulk_metadata: dict,
    file_refinement: dict | None = None,
) -> dict:
    """
    Ingère un fichier : extraction texte + embedding + insert DB.
    Retourne le KnowledgeDoc créé.
    """
    # Merge bulk + refinement (refinement override)
    meta = dict(bulk_metadata)
    if file_refinement:
        for k, v in file_refinement.items():
            if v is not None:
                meta[k] = v

    # Extract text
    try:
        text_content = extract_text_from_file(str(file_path))
    except (OSError, ValueError, RuntimeError) as e:
        print(f"[WARN] Text extraction failed for {original_filename}: {e}")
        text_content = ""

    excerpt = (text_content[:500] + "…") if len(text_content) > 500 else text_content

    # Embedding (facultatif)
    embedding = await generate_embedding(text_content) if text_content else None

    # File size
    try:
        size = file_path.stat().st_size
    except OSError:
        size = 0

    # File type
    ext = file_path.suffix.lower().lstrip(".")

    doc = {
        "filename": original_filename,
        "filepath": str(file_path),
        "file_size_bytes": size,
        "file_type": ext,
        "domaine": meta.get("domaine", "Multi-domaine"),
        "fiscal_year": int(meta["fiscal_year"]) if meta.get("fiscal_year") else None,
        "sensibilite": meta.get("sensibilite", "professionnel"),
        "doc_type": meta.get("doc_type", "autre"),
        "regulatory_refs": meta.get("regulatory_refs", []),
        "tags": meta.get("tags", []),
        "agents_assigned": meta.get("agents_assigned", []),
        "status": "indexed" if text_content else "extracting",
        "text_excerpt": excerpt,
        "text_content": text_content[:50000],  # cap to 50k chars
        "embedding": embedding,
        "version": 1,
    }

    inserted = insert_kb_doc(doc)
    # Ne pas renvoyer text_content et embedding complets au client (trop lourd)
    inserted.pop("text_content", None)
    inserted.pop("embedding", None)
    return inserted


async def ingest_files(
    files_and_names: list[tuple[bytes, str]],
    bulk_metadata: dict,
    per_file_refinements: dict,
) -> list[dict]:
    """
    Traite une liste de fichiers en série.
    files_and_names : liste de tuples (bytes, original_filename)
    """
    results = []
    for idx, (content, name) in enumerate(files_and_names):
        safe_name = sanitize_filename(name)
        if not is_allowed_file_type(safe_name):
            print(f"[WARN] Skip {name} — type non autorisé")
            continue

        # Générer un nom unique
        prefix = hashlib.md5(f"{safe_name}-{datetime.utcnow().isoformat()}".encode()).hexdigest()[:8]
        unique_name = f"{prefix}-{safe_name}"
        file_path = UPLOAD_DIR / unique_name

        if not is_safe_path(UPLOAD_DIR, file_path):
            print(f"[WARN] Skip {name} — path traversal détecté")
            continue

        try:
            file_path.write_bytes(content)
        except OSError as e:
            print(f"[ERROR] Impossible d'écrire {file_path}: {e}")
            continue

        refinement = per_file_refinements.get(f"{name}-{idx}")
        try:
            doc = await ingest_file(file_path, name, bulk_metadata, refinement)
            results.append(doc)
        except (OSError, ValueError, RuntimeError) as e:
            print(f"[ERROR] Ingest failed for {name}: {e}")
            continue

    return results
