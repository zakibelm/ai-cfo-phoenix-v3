"""
cfo_kf_routes.py
─────────────────────────────────────────────────────────────────────────────
Router FastAPI pour tous les endpoints CFO Knowledge Factory + Knowledge Base.

À monter dans main.py :
    from cfo_kf_routes import router as cfo_kf_router
    app.include_router(cfo_kf_router)

Endpoints exposés :
    Knowledge Base :
      POST   /api/knowledge/ingest
      GET    /api/knowledge/list
      GET    /api/knowledge/{doc_id}
      PATCH  /api/knowledge/{doc_id}
      DELETE /api/knowledge/{doc_id}
      POST   /api/knowledge/start-factory-run
      GET    /api/knowledge/{doc_id}/runs

    Factory :
      POST   /api/cfo-kf/launch
      GET    /api/cfo-kf/runs
      GET    /api/cfo-kf/runs/{run_id}
      POST   /api/cfo-kf/checkpoint
"""

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Body, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from kb_ingest import ingest_files
from kb_storage import (
    delete_kb_doc,
    get_kb_doc,
    get_run,
    list_kb_docs,
    list_runs,
    update_kb_doc,
)
from observability import get_logger, get_metrics_snapshot
from z_kernel import CFOZKernel, get_kernel, register_kernel

_log = get_logger(__name__)

router = APIRouter(prefix="/api", tags=["CFO Knowledge Factory"])


# ═════════════════════════════════════════════════════════════════════════════
# SSE STREAMING — progression live d'un run
# ═════════════════════════════════════════════════════════════════════════════

async def _run_event_stream(run_id: str) -> AsyncIterator[str]:
    """Génère un flux SSE pour suivre un run en temps réel.

    Polle la DB chaque 2s, émet un event à chaque changement d'état ou de
    métrique. Termine quand status ∈ {COMPLETED, COMPLETED_WITH_WARNINGS, FAILED}.
    """
    last_payload: dict[str, Any] = {}
    terminal = {"COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED"}

    for _ in range(1800):  # max ~1h (1800 × 2s)
        run = get_run(run_id)
        if not run:
            yield f"event: error\ndata: {json.dumps({'error': 'run not found'})}\n\n"
            return

        payload = {
            "run_id": run_id,
            "status": run.get("status"),
            "pages_created": run.get("pages_created", 0),
            "pages_verified": run.get("pages_verified", 0),
            "pages_to_verify": run.get("pages_to_verify", 0),
            "budget_used_eur": float(run.get("budget_used_eur") or 0),
            "budget_max_eur": float(run.get("budget_max_eur") or 0),
            "avg_quality_score": run.get("avg_quality_score"),
        }
        if payload != last_payload:
            yield f"event: update\ndata: {json.dumps(payload, default=str)}\n\n"
            last_payload = payload

        if payload["status"] in terminal:
            yield f"event: done\ndata: {json.dumps(payload, default=str)}\n\n"
            return

        await asyncio.sleep(2)
    # Timeout 1h : ferme proprement
    yield "event: timeout\ndata: {}\n\n"


@router.get("/cfo-kf/runs/{run_id}/stream")
async def stream_run(run_id: str) -> StreamingResponse:
    """Server-Sent Events pour suivre la progression d'un run.

    Client React : `new EventSource('/api/cfo-kf/runs/{id}/stream')`
    """
    return StreamingResponse(
        _run_event_stream(run_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # nginx : désactive le buffering
        },
    )


# ═════════════════════════════════════════════════════════════════════════════
# METRICS — pour dashboard observabilité
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/cfo-kf/metrics")
async def cfo_kf_metrics() -> dict[str, Any]:
    """Snapshot des métriques in-memory (LLM calls, coûts, latences par phase)."""
    return get_metrics_snapshot()


# ═════════════════════════════════════════════════════════════════════════════
# KNOWLEDGE BASE
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/knowledge/ingest")
async def knowledge_ingest(
    files: list[UploadFile] = File(...),
    bulk_metadata: str = Form(...),
    per_file_refinements: str = Form("{}"),
):
    """Ingest multi-fichiers avec métadonnées en lot + overrides par fichier."""
    try:
        bulk = json.loads(bulk_metadata)
    except json.JSONDecodeError as err:
        raise HTTPException(400, "bulk_metadata invalide (JSON requis)") from err
    try:
        refinements = json.loads(per_file_refinements)
    except json.JSONDecodeError:
        refinements = {}

    # Lire tous les fichiers en mémoire (on passe bytes + filename)
    files_data: list[tuple[bytes, str]] = []
    for f in files:
        content = await f.read()
        files_data.append((content, f.filename or "sans-nom"))

    results = await ingest_files(files_data, bulk, refinements)
    return {"documents": results, "count": len(results)}


@router.get("/knowledge/list")
async def knowledge_list(
    q: str | None = None,
    domaine: str | None = None,
    sensibilite: str | None = None,
    agent: str | None = None,
    year: int | None = None,
):
    """Liste les docs de la KB avec filtres optionnels."""
    filters: dict[str, Any] = {}
    if q:
        filters["q"] = q
    if domaine:
        filters["domaine"] = domaine
    if sensibilite:
        filters["sensibilite"] = sensibilite
    if agent:
        filters["agent"] = agent
    if year:
        filters["year"] = year

    docs = list_kb_docs(filters)
    # Strip heavy fields
    for d in docs:
        d.pop("text_content", None)
        d.pop("embedding", None)
    return {"documents": docs}


@router.get("/knowledge/{doc_id}")
async def knowledge_detail(doc_id: str):
    doc = get_kb_doc(doc_id)
    if not doc:
        raise HTTPException(404, "Document non trouvé")
    doc.pop("embedding", None)
    return doc


@router.patch("/knowledge/{doc_id}")
async def knowledge_update(doc_id: str, patch: dict = Body(...)):
    # Ne pas permettre de modifier certains champs sensibles
    for forbidden in ("doc_id", "uploaded_at", "embedding", "text_content"):
        patch.pop(forbidden, None)
    updated = update_kb_doc(doc_id, patch)
    if not updated:
        raise HTTPException(404, "Document non trouvé")
    updated.pop("embedding", None)
    updated.pop("text_content", None)
    return updated


@router.delete("/knowledge/{doc_id}")
async def knowledge_delete(doc_id: str):
    ok = delete_kb_doc(doc_id)
    if not ok:
        raise HTTPException(404, "Document non trouvé")
    return {"deleted": doc_id}


@router.post("/knowledge/start-factory-run")
async def knowledge_start_factory_run(payload: dict = Body(...)):
    """Bridge : depuis la KB, démarrer un run Factory avec les docs sélectionnés."""
    doc_ids = payload.get("doc_ids", [])
    run_config = payload.get("run_config", {})
    if not doc_ids:
        raise HTTPException(400, "doc_ids requis")

    # Résout les docs pour dériver domaine et sensibilité
    docs = [get_kb_doc(did) for did in doc_ids]
    docs = [d for d in docs if d]
    if not docs:
        raise HTTPException(404, "Aucun document trouvé")

    # Sensibilité max
    sens_order = {"public": 0, "professionnel": 1, "confidentiel-client": 2}
    sens_max = max(docs, key=lambda d: sens_order.get(d.get("sensibilite", "public"), 0))["sensibilite"]

    # Domaine dominant
    domaines = [d.get("domaine", "Multi-domaine") for d in docs]
    domaine = domaines[0] if len(set(domaines)) == 1 else "Multi-domaine"

    config = {
        "mode": "client",
        "domaine": domaine,
        "mandat": run_config.get("mandat", ""),
        "description": run_config.get("description", ""),
        "nb_pages_cible": run_config.get("nb_pages_cible", 30),
        "budget_max_eur": run_config.get("budget_max_eur", 15),
        "niveau_rigueur": run_config.get("niveau_rigueur", "professionnel"),
        "sensibilite": sens_max,
        "documents_sources": doc_ids,
        "temps_max_min": 90,
    }

    kernel = CFOZKernel(config)
    run = kernel.start()
    register_kernel(kernel)
    return {"run_id": run["run_id"]}


@router.get("/knowledge/{doc_id}/runs")
async def knowledge_doc_runs(doc_id: str):
    """Liste les runs Factory ayant consommé ce document."""
    doc = get_kb_doc(doc_id)
    if not doc:
        raise HTTPException(404)
    run_ids = doc.get("used_in_runs", [])
    runs = [get_run(rid) for rid in run_ids]
    return {"runs": [r for r in runs if r]}


# ═════════════════════════════════════════════════════════════════════════════
# FACTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/cfo-kf/launch")
async def cfo_kf_launch(payload: dict = Body(...)):
    """Lance un nouveau run Factory (ou Client) depuis la page Factory."""
    required = ["mode", "domaine", "mandat", "nb_pages_cible", "budget_max_eur"]
    for k in required:
        if k not in payload:
            raise HTTPException(400, f"Champ obligatoire manquant : {k}")

    kernel = CFOZKernel(payload)
    run = kernel.start()
    register_kernel(kernel)
    return {"run_id": run["run_id"], "status": run["status"]}


@router.get("/cfo-kf/runs")
async def cfo_kf_runs(limit: int = 50):
    """Liste les runs — résumés pour la vue Factory."""
    runs = list_runs(limit=limit)
    # Projette un résumé minimal pour le front
    summaries = []
    for r in runs:
        summaries.append({
            "run_id": r.get("run_id"),
            "mandat": r.get("mandat", ""),
            "mode": r.get("mode", "factory"),
            "domaine": r.get("domaine", ""),
            "description": r.get("description"),
            "status": r.get("status"),
            "nb_pages_cible": r.get("nb_pages_cible", 0),
            "pages_created": r.get("pages_created", 0),
            "pages_verified": r.get("pages_verified", 0),
            "pages_to_verify": r.get("pages_to_verify", 0),
            "budget_max_eur": r.get("budget_max_eur", 0),
            "budget_used_eur": r.get("budget_used_eur", 0),
            "temps_max_min": r.get("temps_max_min", 90),
            "niveau_rigueur": r.get("niveau_rigueur", "professionnel"),
            "sensibilite": r.get("sensibilite", "professionnel"),
            "avg_quality_score": r.get("avg_quality_score"),
            "started_at": r.get("started_at"),
            "ended_at": r.get("ended_at"),
            "client_id": r.get("client_id"),
            "total_cost_eur": r.get("budget_used_eur", 0),
            "wall_time_minutes": 0,  # calculé côté back en prod
            "docs_used": r.get("config_snapshot", {}).get("documents_sources", []),
        })
    return {"runs": summaries}


@router.get("/cfo-kf/runs/{run_id}")
async def cfo_kf_run_detail(run_id: str):
    run = get_run(run_id)
    if not run:
        raise HTTPException(404, "Run non trouvé")
    return run


@router.post("/cfo-kf/checkpoint")
async def cfo_kf_checkpoint(payload: dict = Body(...)):
    """Réponse CPA à un checkpoint CP1 ou CP2 — décision GO/CORRIGE/AJUSTE/STOP."""
    run_id = payload.get("run_id")
    checkpoint = payload.get("checkpoint")  # "CP1" or "CP2"
    decision = payload.get("decision")       # "GO" | "CORRIGE" | "AJUSTE" | "STOP"

    if not all([run_id, checkpoint, decision]):
        raise HTTPException(400, "run_id, checkpoint, decision requis")

    kernel = get_kernel(run_id)
    if not kernel:
        # Reconstruct kernel from DB (permet reprise après restart back)
        run = get_run(run_id)
        if not run:
            raise HTTPException(404, "Run non trouvé")
        kernel = CFOZKernel(run.get("config_snapshot", {}))
        kernel.run_id = run_id
        register_kernel(kernel)

    import asyncio
    asyncio.create_task(kernel.resume_after_checkpoint(checkpoint, decision))
    return {"accepted": True}
