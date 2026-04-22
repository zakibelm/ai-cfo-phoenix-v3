"""
kb_storage.py
─────────────────────────────────────────────────────────────────────────────
Couche de persistence pour la Knowledge Base et les runs Factory.
Migration 100% Locale (Postgres + PgVector via psycopg)
"""

import json
import os
import threading
import uuid
from datetime import datetime
from pathlib import Path

try:
    import psycopg
    from psycopg.rows import dict_row
    _HAS_PSYCOPG = True
except ImportError:
    psycopg = None
    dict_row = None
    _HAS_PSYCOPG = False

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://ai_cfo:ai_cfo_password@localhost:5432/ai_cfo_db")

# Fallback local (JSON) au cas où la BD ne répond vraiment pas
_DATA_DIR = Path(__file__).parent / "data" / "cfo_kf"
_DATA_DIR.mkdir(parents=True, exist_ok=True)
_DOCS_FILE = _DATA_DIR / "knowledge_docs.json"
_RUNS_FILE = _DATA_DIR / "runs.json"
_STEPS_FILE = _DATA_DIR / "steps.json"
_PAGES_FILE = _DATA_DIR / "pages.json"

_lock = threading.RLock()

def _load(path: Path) -> list:
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"[WARN] kb_storage._load failed ({path}): {e}")
        return []

def _save(path: Path, data: list) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding="utf-8")

def get_conn():
    if not _HAS_PSYCOPG:
        return None
    try:
        return psycopg.connect(DATABASE_URL, row_factory=dict_row)
    except psycopg.Error as e:
        print(f"[ERROR] Connexion PostgreSQL echouee: {e}")
        return None

# ─────────────────────────────────────────────────────────────────────────────
# CRUD Knowledge Docs
# ─────────────────────────────────────────────────────────────────────────────

def insert_kb_doc(doc: dict) -> dict:
    doc.setdefault("doc_id", str(uuid.uuid4()))
    doc.setdefault("uploaded_at", datetime.utcnow().isoformat())
    doc.setdefault("status", "indexed")
    doc.setdefault("use_count", 0)
    doc.setdefault("used_in_runs", [])
    doc.setdefault("regulatory_refs", [])
    doc.setdefault("tags", [])
    doc.setdefault("agents_assigned", [])
    doc.setdefault("version", 1)

    conn = get_conn()
    if conn:
        try:
            with conn.cursor() as cur:
                # Filtrer les clés pour ne garder que celles qui existent dans le schéma
                allowed = ["doc_id", "filename", "filepath", "file_size_bytes", "file_type", "mime_type",
                           "domaine", "fiscal_year", "sensibilite", "doc_type", "regulatory_refs", "tags",
                           "agents_assigned", "client_id", "status", "status_message", "text_content",
                           "text_excerpt", "embedding", "version", "uploaded_at"]
                insert_data = {k: v for k, v in doc.items() if k in allowed}

                cols = ", ".join(insert_data.keys())
                vals = ", ".join([f"%({k})s" for k in insert_data])
                # Special cast for vector
                if "embedding" in insert_data and insert_data["embedding"] is not None:
                    insert_data["embedding"] = str(insert_data["embedding"])

                cur.execute(f"INSERT INTO cfo_knowledge_docs ({cols}) VALUES ({vals}) RETURNING *", insert_data)
                res = cur.fetchone()
                conn.commit()
                return res or doc
        except psycopg.Error as e:
            print(f"[WARN] Postgres insert failed, fallback to local: {e}")
            conn.rollback()
        finally:
            conn.close()

    with _lock:
        docs = _load(_DOCS_FILE)
        docs.insert(0, doc)
        _save(_DOCS_FILE, docs)
    return doc

def list_kb_docs(filters: dict | None = None) -> list[dict]:
    filters = filters or {}
    conn = get_conn()
    if conn:
        try:
            with conn.cursor() as cur:
                query = "SELECT * FROM cfo_knowledge_docs WHERE 1=1"
                params = {}
                if filters.get("domaine"):
                    query += " AND domaine = %(domaine)s"
                    params["domaine"] = filters["domaine"]
                if filters.get("sensibilite"):
                    query += " AND sensibilite = %(sensibilite)s"
                    params["sensibilite"] = filters["sensibilite"]
                if filters.get("year"):
                    query += " AND fiscal_year = %(year)s"
                    params["year"] = int(filters["year"])
                if filters.get("agent"):
                    query += " AND %(agent)s = ANY(agents_assigned)"
                    params["agent"] = filters["agent"]

                query += " ORDER BY uploaded_at DESC"
                cur.execute(query, params)
                docs = cur.fetchall()

                if filters.get("q"):
                    qstr = filters["q"].lower()
                    docs = [d for d in docs if qstr in (d.get("filename", "")).lower()
                            or qstr in (d.get("text_excerpt") or "").lower()]
                return docs
        except psycopg.Error as e:
            print(f"[WARN] Postgres list failed, fallback: {e}")
        finally:
            conn.close()

    with _lock:
        docs = _load(_DOCS_FILE)

    out = []
    for d in docs:
        if filters.get("domaine") and d.get("domaine") != filters["domaine"]:

            continue
        if filters.get("sensibilite") and d.get("sensibilite") != filters["sensibilite"]:

            continue
        if filters.get("year") and d.get("fiscal_year") != int(filters["year"]):

            continue
        if filters.get("agent") and filters["agent"] not in (d.get("agents_assigned") or []):

            continue
        if filters.get("q"):
            qstr = filters["q"].lower()
            if qstr not in (d.get("filename", "")).lower() and qstr not in (d.get("text_excerpt") or "").lower():
                continue
        out.append(d)
    return out

def get_kb_doc(doc_id: str) -> dict | None:
    conn = get_conn()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM cfo_knowledge_docs WHERE doc_id = %s", (doc_id,))
                return cur.fetchone()
        except psycopg.Error as _e:
            pass  # fallback silencieux (DB down → JSON local)
        finally:
            conn.close()
    with _lock:
        docs = _load(_DOCS_FILE)
    return next((d for d in docs if d.get("doc_id") == doc_id), None)

def update_kb_doc(doc_id: str, patch: dict) -> dict | None:
    conn = get_conn()
    if conn:
        try:
            with conn.cursor() as cur:
                set_clauses = ", ".join([f"{k} = %({k})s" for k in patch])
                patch["_doc_id"] = doc_id
                cur.execute(f"UPDATE cfo_knowledge_docs SET {set_clauses} WHERE doc_id = %(_doc_id)s RETURNING *", patch)
                res = cur.fetchone()
                conn.commit()
                return res
        except psycopg.Error as _e:
            pass  # fallback silencieux (DB down → JSON local)
        finally:
            conn.close()
    with _lock:
        docs = _load(_DOCS_FILE)
        for i, d in enumerate(docs):
            if d.get("doc_id") == doc_id:
                docs[i] = {**d, **patch}
                _save(_DOCS_FILE, docs)
                return docs[i]
    return None

def delete_kb_doc(doc_id: str) -> bool:
    conn = get_conn()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM cfo_knowledge_docs WHERE doc_id = %s", (doc_id,))
                conn.commit()
                return cur.rowcount > 0
        except psycopg.Error as _e:
            pass  # fallback silencieux (DB down → JSON local)
        finally:
            conn.close()
    with _lock:
        docs = _load(_DOCS_FILE)
        new = [d for d in docs if d.get("doc_id") != doc_id]
        if len(new) != len(docs):
            _save(_DOCS_FILE, new)
            return True
    return False

# ─────────────────────────────────────────────────────────────────────────────
# CRUD Runs
# ─────────────────────────────────────────────────────────────────────────────

def insert_run(run: dict) -> dict:
    run.setdefault("run_id", f"cfokf-{datetime.utcnow().strftime('%Y-%m-%d')}-{uuid.uuid4().hex[:8]}")
    run.setdefault("started_at", datetime.utcnow().isoformat())
    run.setdefault("status", "PLANNED")
    run.setdefault("budget_used_eur", 0.0)
    run.setdefault("pages_created", 0)
    run.setdefault("pages_verified", 0)
    run.setdefault("pages_to_verify", 0)

    conn = get_conn()
    if conn:
        try:
            with conn.cursor() as cur:
                allowed = ["run_id", "module", "mode", "domaine", "mandat", "description", "client_id",
                           "parent_run_id", "run_index", "status", "budget_max_eur", "temps_max_min",
                           "nb_pages_cible", "batch_size", "pages_pilote", "niveau_rigueur", "objectif_vault",
                           "sensibilite", "seuil_qualite", "seuil_to_verify", "chemin_vault", "mode_sortie",
                           "started_at", "config_snapshot"]
                insert_data = {k: v for k, v in run.items() if k in allowed}
                if "config_snapshot" in insert_data and isinstance(insert_data["config_snapshot"], dict):
                    insert_data["config_snapshot"] = json.dumps(insert_data["config_snapshot"])

                cols = ", ".join(insert_data.keys())
                vals = ", ".join([f"%({k})s" for k in insert_data])
                cur.execute(f"INSERT INTO cfo_runs ({cols}) VALUES ({vals}) RETURNING *", insert_data)
                res = cur.fetchone()
                conn.commit()
                return res or run
        except psycopg.Error as _e:
            conn.rollback()  # DB erreur -> fallback JSON
        finally:
            conn.close()

    with _lock:
        runs = _load(_RUNS_FILE)
        runs.insert(0, run)
        _save(_RUNS_FILE, runs)
    return run

def list_runs(limit: int = 50) -> list[dict]:
    conn = get_conn()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM cfo_runs ORDER BY started_at DESC LIMIT %s", (limit,))
                return cur.fetchall()
        except psycopg.Error as _e:
            pass  # fallback silencieux (DB down → JSON local)
        finally:
            conn.close()
    with _lock:
        return _load(_RUNS_FILE)[:limit]

def get_run(run_id: str) -> dict | None:
    conn = get_conn()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM cfo_runs WHERE run_id = %s", (run_id,))
                return cur.fetchone()
        except psycopg.Error as _e:
            pass  # fallback silencieux (DB down → JSON local)
        finally:
            conn.close()
    with _lock:
        runs = _load(_RUNS_FILE)
    return next((r for r in runs if r.get("run_id") == run_id), None)

def update_run(run_id: str, patch: dict) -> dict | None:
    conn = get_conn()
    if conn:
        try:
            with conn.cursor() as cur:
                if "config_snapshot" in patch and isinstance(patch["config_snapshot"], dict):
                    patch["config_snapshot"] = json.dumps(patch["config_snapshot"])
                set_clauses = ", ".join([f"{k} = %({k})s" for k in patch])
                patch["_run_id"] = run_id
                cur.execute(f"UPDATE cfo_runs SET {set_clauses} WHERE run_id = %(_run_id)s RETURNING *", patch)
                res = cur.fetchone()
                conn.commit()
                return res
        except psycopg.Error as _e:
            conn.rollback()  # DB erreur -> fallback JSON
        finally:
            conn.close()
    with _lock:
        runs = _load(_RUNS_FILE)
        for i, r in enumerate(runs):
            if r.get("run_id") == run_id:
                runs[i] = {**r, **patch}
                _save(_RUNS_FILE, runs)
                return runs[i]
    return None

# ─────────────────────────────────────────────────────────────────────────────
# CRUD Steps + Pages
# ─────────────────────────────────────────────────────────────────────────────

def insert_step(step: dict) -> dict:
    step.setdefault("step_id", str(uuid.uuid4()))
    step.setdefault("started_at", datetime.utcnow().isoformat())
    conn = get_conn()
    if conn:
        try:
            with conn.cursor() as cur:
                allowed = ["step_id", "run_id", "phase_name", "agent_name", "agent_role_kvf", "status",
                           "model_used", "input_summary", "output_summary", "duration_sec", "started_at"]
                ins = {k: v for k, v in step.items() if k in allowed}
                cols = ", ".join(ins.keys())
                vals = ", ".join([f"%({k})s" for k in ins])
                cur.execute(f"INSERT INTO cfo_steps ({cols}) VALUES ({vals}) RETURNING *", ins)
                res = cur.fetchone()
                conn.commit()
                return res or step
        except psycopg.Error as _e:
            conn.rollback()  # DB erreur -> fallback JSON
        finally:
            conn.close()
    with _lock:
        steps = _load(_STEPS_FILE)
        steps.insert(0, step)
        _save(_STEPS_FILE, steps)
    return step

def insert_page(page: dict) -> dict:
    page.setdefault("page_id", str(uuid.uuid4()))
    page.setdefault("created_at", datetime.utcnow().isoformat())
    page.setdefault("status", "draft")
    conn = get_conn()
    if conn:
        try:
            with conn.cursor() as cur:
                allowed = ["page_id", "run_id", "title", "type", "status", "word_count",
                           "quality_score", "filepath", "created_at"]
                ins = {k: v for k, v in page.items() if k in allowed}
                cols = ", ".join(ins.keys())
                vals = ", ".join([f"%({k})s" for k in ins])
                cur.execute(f"INSERT INTO cfo_pages ({cols}) VALUES ({vals}) RETURNING *", ins)
                res = cur.fetchone()
                conn.commit()
                return res or page
        except psycopg.Error as _e:
            conn.rollback()  # DB erreur -> fallback JSON
        finally:
            conn.close()
    with _lock:
        pages = _load(_PAGES_FILE)
        pages.insert(0, page)
        _save(_PAGES_FILE, pages)
    return page
