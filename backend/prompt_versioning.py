"""
prompt_versioning.py — ZAKI OS Z12 AI CFO Suite
─────────────────────────────────────────────────────────────────────────────
Traçabilité CPA-grade des prompts utilisés dans les runs Factory.

Règle Loi 25 + audit CPA : pour tout dossier client audit-grade, il doit être
possible de retracer EXACTEMENT le prompt utilisé au moment de la rédaction,
même si le prompt a été modifié depuis.

Stratégie : hash SHA256 du (template + inputs formatés) → snapshot immuable
stocké dans `cfo_prompt_versions`. Chaque step référence le hash.
"""

from __future__ import annotations

import hashlib
from datetime import datetime
from pathlib import Path

from kb_storage import _load, _save, get_conn
from observability import get_logger

log = get_logger(__name__)

_VERSIONS_FILE = Path(__file__).parent / "data" / "cfo_kf" / "prompt_versions.json"
_VERSIONS_FILE.parent.mkdir(parents=True, exist_ok=True)


def hash_prompt(template: str, rendered: str) -> str:
    """Hash SHA256 court (12 chars) du prompt complet."""
    h = hashlib.sha256()
    h.update(template.encode("utf-8"))
    h.update(b"\x00")
    h.update(rendered.encode("utf-8"))
    return h.hexdigest()[:12]


def register_prompt_version(
    agent_name: str, template: str, rendered: str, run_id: str | None = None,
) -> str:
    """Enregistre une version de prompt si elle n'existe pas déjà.

    Retourne le hash (toujours stable pour un même couple template+rendered).
    """
    ph = hash_prompt(template, rendered)

    conn = get_conn()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM cfo_prompt_versions WHERE prompt_hash = %s",
                    (ph,),
                )
                exists = cur.fetchone() is not None
                if not exists:
                    cur.execute(
                        "INSERT INTO cfo_prompt_versions "
                        "(prompt_hash, agent_name, template, rendered_preview, first_run_id, created_at) "
                        "VALUES (%s, %s, %s, %s, %s, %s)",
                        (ph, agent_name, template, rendered[:2000], run_id,
                         datetime.utcnow()),
                    )
                    conn.commit()
            return ph
        except Exception as e:  # noqa: BLE001 — psycopg.Error varies by version
            log.warning("prompt_versioning.db_failed", error=str(e))
            conn.rollback()
        finally:
            conn.close()

    # Fallback JSON local
    versions = _load(_VERSIONS_FILE)
    if not any(v.get("prompt_hash") == ph for v in versions):
        versions.insert(0, {
            "prompt_hash": ph,
            "agent_name": agent_name,
            "template": template,
            "rendered_preview": rendered[:2000],
            "first_run_id": run_id,
            "created_at": datetime.utcnow().isoformat(),
        })
        _save(_VERSIONS_FILE, versions)
    return ph


def get_prompt_version(prompt_hash: str) -> dict | None:
    """Retrouve une version de prompt par son hash (pour audit CPA)."""
    conn = get_conn()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT prompt_hash, agent_name, template, rendered_preview, "
                    "first_run_id, created_at FROM cfo_prompt_versions "
                    "WHERE prompt_hash = %s",
                    (prompt_hash,),
                )
                return cur.fetchone()
        except Exception:  # noqa: BLE001
            pass
        finally:
            conn.close()
    versions = _load(_VERSIONS_FILE)
    return next((v for v in versions if v.get("prompt_hash") == prompt_hash), None)


# SQL migration associée
MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS cfo_prompt_versions (
  prompt_hash         TEXT PRIMARY KEY,
  agent_name          TEXT NOT NULL,
  template            TEXT NOT NULL,
  rendered_preview    TEXT,
  first_run_id        TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prompt_agent ON cfo_prompt_versions(agent_name, created_at DESC);

-- Ajout colonne prompt_hash dans cfo_steps pour traçabilité
ALTER TABLE cfo_steps ADD COLUMN IF NOT EXISTS prompt_hash TEXT
  REFERENCES cfo_prompt_versions(prompt_hash);
CREATE INDEX IF NOT EXISTS idx_steps_prompt ON cfo_steps(prompt_hash);
"""
