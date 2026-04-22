"""
Service RAG (Retrieval-Augmented Generation) pour l'AI CFO Suite.
Chunking intelligent avec fenetre glissante et scoring par pertinence.

Architecture :
    - Decoupe le document en chunks semantiques (paragraphes + limite de taille)
    - Selectionne les chunks les plus pertinents par rapport a la requete
    - Assemble le contexte final optimise pour le modele LLM
"""
import re
from pathlib import Path

# Constantes de chunking
CHUNK_SIZE = 800          # caracteres par chunk (~200 tokens)
CHUNK_OVERLAP = 150       # chevauchement entre chunks
MAX_CONTEXT_CHARS = 12_000  # budget total de contexte envoye au LLM
MAX_CHUNKS = 8            # nombre maximum de chunks retenus


def _split_into_chunks(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list:
    """Decoupe un texte en chunks avec chevauchement aux limites de paragraphes."""
    if not text:
        return []

    text = re.sub(r"\n{3,}", "\n\n", text.strip())
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

    chunks = []
    current_chunk = ""

    for para in paragraphs:
        if len(para) > chunk_size:
            if current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = current_chunk[-overlap:] if len(current_chunk) > overlap else ""

            words = para.split()
            sub_chunk = ""
            for word in words:
                if len(sub_chunk) + len(word) + 1 > chunk_size:
                    if sub_chunk:
                        chunks.append(sub_chunk.strip())
                        sub_chunk_words = sub_chunk.split()
                        overlap_words = sub_chunk_words[max(0, len(sub_chunk_words) - 30):]
                        sub_chunk = " ".join(overlap_words) + " " + word
                    else:
                        chunks.append(word)
                        sub_chunk = ""
                else:
                    sub_chunk = (sub_chunk + " " + word).strip()
            if sub_chunk:
                current_chunk = sub_chunk
        else:
            candidate = (current_chunk + "\n\n" + para).strip() if current_chunk else para
            if len(candidate) <= chunk_size:
                current_chunk = candidate
            else:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                    overlap_text = current_chunk[-overlap:] if len(current_chunk) > overlap else current_chunk
                    current_chunk = (overlap_text + "\n\n" + para).strip()
                else:
                    current_chunk = para

    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    return chunks


def _tokenize(text: str) -> list:
    """Tokenise un texte en mots normalises."""
    return re.findall(r"\b\w{2,}\b", text.lower())


def _score_chunk(chunk: str, query_tokens: set) -> float:
    """Score de pertinence d'un chunk par rapport a la requete (TF simplifie)."""
    if not query_tokens:
        return 0.0
    chunk_tokens = set(_tokenize(chunk))
    matches = len(query_tokens & chunk_tokens)
    density = matches / max(len(chunk_tokens), 1)
    return matches * 0.7 + density * 0.3


def build_rag_context(
    document_text: str,
    query: str,
    max_chars: int = MAX_CONTEXT_CHARS,
    max_chunks: int = MAX_CHUNKS,
) -> str:
    """
    Construit un contexte RAG optimise : chunking + scoring par pertinence.

    Strategie :
    1. Decouper le document en chunks semantiques
    2. Scorer chaque chunk par pertinence vis-a-vis de la requete
    3. Retenir les N chunks les plus pertinents dans la limite de max_chars
    4. ReAssembler en ordre d'apparition dans le document

    Returns:
        Contexte formate pret a etre injecte dans le prompt LLM.
    """
    if not document_text:
        return ""

    # Si le document tient dans le budget, pas besoin de chunking
    if len(document_text) <= max_chars:
        return document_text

    chunks = _split_into_chunks(document_text)
    if not chunks:
        return document_text[:max_chars] + "\n\n[... contenu tronque ...]"

    # Scorer les chunks
    query_tokens = set(_tokenize(query)) if query else set()
    scored = [(i, chunk, _score_chunk(chunk, query_tokens)) for i, chunk in enumerate(chunks)]

    # Trier par score decroissant
    scored.sort(key=lambda x: x[2], reverse=True)

    # Selectionner les meilleurs chunks dans le budget
    selected_indices = set()
    total_chars = 0

    for idx, chunk, _score in scored[:max_chunks * 2]:
        if len(selected_indices) >= max_chunks:
            break
        if total_chars + len(chunk) > max_chars:
            if not selected_indices:
                selected_indices.add(idx)
            break
        selected_indices.add(idx)
        total_chars += len(chunk)

    # Reassembler dans l'ordre du document
    ordered = sorted(
        [x for x in scored if x[0] in selected_indices],
        key=lambda x: x[0]
    )

    context_parts = []
    prev_idx = -1
    for i, chunk, _ in ordered:
        if prev_idx >= 0 and i > prev_idx + 1:
            context_parts.append(f"\n[... {i - prev_idx - 1} section(s) omise(s) ...]\n")
        context_parts.append(chunk)
        prev_idx = i

    context = "\n\n".join(context_parts)
    coverage_pct = round(total_chars / len(document_text) * 100)
    footer = (
        f"\n\n[Contexte RAG : {len(ordered)} section(s) sur {len(chunks)} "
        f"-- {coverage_pct}% du document couvert]"
    )
    return context + footer


def load_document_text(uploads_dir: Path, document_name: str):
    """
    Charge le texte extrait d'un document depuis le dossier uploads.
    Returns: texte du document, ou None si non trouve.
    """
    text_path = uploads_dir / f"{document_name}.extracted.txt"
    if not text_path.exists():
        return None
    try:
        return text_path.read_text(encoding="utf-8")
    except OSError:
        return None
