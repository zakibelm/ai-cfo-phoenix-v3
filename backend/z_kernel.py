"""
z_kernel.py
─────────────────────────────────────────────────────────────────────────────
Machine d'états Z-Kernel CFO + orchestration du pipeline Knowledge Factory.

Cette implémentation est volontairement minimale pour un MVP : la machine
d'états est complète, le routeur multi-LLM est simplifié, et l'exécution
réelle des agents (Planner, Writer, FactCheck, Linker, Audit, Debrief) est
exposée comme stubs avec hooks clairs pour la production.

Pour passer en prod :
- Implémenter chaque _execute_*_phase avec les vrais appels OpenRouter
- Brancher la persistance pgvector pour l'embedding similarity
- Ajouter le streaming d'événements via SSE pour l'UI temps réel
"""

import asyncio
import json
import os
import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from enum import Enum
from pathlib import Path

import httpx

from agent_prompts_factory import get_factory_prompt
from kb_storage import get_run, insert_run, insert_step, update_run
from observability import get_logger
from ollama_client import OllamaUnavailableError, call_ollama, check_ollama_alive
from security_pii import ScrubLevel, scrub_text

_log = get_logger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "").strip()
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# ─────────────────────────────────────────────────────────────────────────────
# États
# ─────────────────────────────────────────────────────────────────────────────

class State(str, Enum):
    PLANNED = "PLANNED"
    BOOTSTRAPPING = "BOOTSTRAPPING"
    MAPPING = "MAPPING"
    WAITING_APPROVAL_CP1 = "WAITING_APPROVAL_CP1"
    PILOT_WRITING = "PILOT_WRITING"
    PILOT_QA = "PILOT_QA"
    WAITING_APPROVAL_CP2 = "WAITING_APPROVAL_CP2"
    FULL_WRITING = "FULL_WRITING"
    LINKING = "LINKING"
    AUDITING = "AUDITING"
    COMPLIANCE_CHECK = "COMPLIANCE_CHECK"
    DEBRIEFING = "DEBRIEFING"
    COMPLETED = "COMPLETED"
    COMPLETED_WITH_WARNINGS = "COMPLETED_WITH_WARNINGS"
    RETRYING = "RETRYING"
    WAITING_HUMAN_REVIEW = "WAITING_HUMAN_REVIEW"
    FAILED = "FAILED"


# ─────────────────────────────────────────────────────────────────────────────
# Router multi-LLM minimal
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# FREE FIRST policy (ZAKI OS directive) — 80% modèles gratuits, 20% premium
# Claude Sonnet = OBLIGATOIRE pour données financières Z12 (Loi 25)
# OpenAI = INTERDIT pour données québécoises
# ─────────────────────────────────────────────────────────────────────────────

AGENT_DEFAULT_MODEL: dict[str, str] = {
    # Données financières sensibles → Claude obligatoire (directive Z12)
    "CFO":                    "anthropic/claude-3.5-sonnet",
    "TaxAgent":               "anthropic/claude-3.5-sonnet",       # fiscal → audit-grade
    "AccountingAgent":        "anthropic/claude-3.5-sonnet",       # écritures comptables
    # Agents auxiliaires → FREE tier (Gemini/DeepSeek/Qwen/Llama)
    "FinanceAgent":           "google/gemini-2.0-flash-exp:free",  # planification structurée
    "CommsAgent":             "qwen/qwen-2.5-72b-instruct",        # rédaction standard
    "InvestmentAgent":        "deepseek/deepseek-r1:free",         # calculs VAN/TRI
    "DerivativePricingAgent": "deepseek/deepseek-r1:free",         # dérivés complexes
    "AuditAgent":             "google/gemini-2.0-flash-exp:free",  # factcheck rapide
    "SupervisorAgent":        "meta-llama/llama-3.3-70b-instruct", # QA structuré
    "ForecastAgent":          "google/gemini-2.0-flash-exp:free",  # projections
}

# EVV : le validateur doit être ≠ du rédacteur (anti-auto-validation)
EVV_VALIDATOR_MODEL: str = "google/gemini-2.0-flash-exp:free"

# Escalade niveau 2 si qualité insuffisante (toujours Claude pour Z12)
ESCALATION_MODEL: str = "anthropic/claude-3.5-sonnet"

# Modèle économique d'urgence si budget < 20%
BUDGET_SAVE_MODEL: str = "google/gemini-2.0-flash-exp:free"


def select_model(agent: str, budget_remaining_pct: float) -> str:
    """Sélectionne le modèle pour un agent selon FREE FIRST + budget.

    Règles :
    - Budget < 5% → FAIL (handled by caller)
    - Budget < 20% → downgrade vers BUDGET_SAVE_MODEL (sauf agents Z12 financiers)
    - Agent Z12 financier (TaxAgent, AccountingAgent, CFO) → toujours Claude
    - Sinon → modèle par défaut (FREE FIRST)
    """
    # Agents Z12 financiers : toujours Claude même en budget serré (directive Loi 25)
    z12_financial_agents = {"CFO", "TaxAgent", "AccountingAgent"}
    if agent in z12_financial_agents:
        return AGENT_DEFAULT_MODEL[agent]
    # Budget serré → downgrade pour les autres
    if budget_remaining_pct < 20:
        return BUDGET_SAVE_MODEL
    return AGENT_DEFAULT_MODEL.get(agent, BUDGET_SAVE_MODEL)


# ─────────────────────────────────────────────────────────────────────────────
# Appel LLM
# ─────────────────────────────────────────────────────────────────────────────

async def call_llm(
    model: str,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 2500,
    temperature: float = 0.6,
    sensibilite: str = "professionnel",
) -> str:
    """
    Appel LLM avec routage sécurisé selon la sensibilité.

    Règles d'enforcement (Loi 25 + secret professionnel CPA) :
    - sensibilite='confidentiel-client' → Ollama local OBLIGATOIRE
                                          + PII scrubbing strict avant envoi
                                          + bloque tout call cloud
    - sensibilite='professionnel'       → cloud OK, mais PII scrubbing medium
                                          (les noms titrés sont masqués)
    - sensibilite='public'              → cloud OK, scrubbing light (NAS/email/CB seulement)

    En cas de PII détecté en mode confidentiel, on REFUSE l'appel et on lève une exception
    plutôt que de fuir la donnée.
    """

    # ───── 1. Routage CONFIDENTIEL-CLIENT → Ollama obligatoire ─────
    if sensibilite == "confidentiel-client":
        # Vérification présence Ollama
        if not await check_ollama_alive():
            raise OllamaUnavailableError(
                "Mode confidentiel-client : Ollama local indisponible. "
                "Vérifie que `ollama serve` tourne et qu'un modèle est pull. "
                "Aucun appel cloud autorisé sur cette donnée."
            )
        # Scrubbing strict avant envoi (zéro PII même en local — bonne pratique)
        scrubbed_user, report = scrub_text(user_prompt, level=ScrubLevel.STRICT)
        if report.detected_count > 0:
            print(f"[INFO] Mode confidentiel — PII scrubbée avant Ollama : {report.summary()}")
        # Appel Ollama
        return await call_ollama(
            model=None,  # utilise OLLAMA_DEFAULT_MODEL
            system_prompt=system_prompt,
            user_prompt=scrubbed_user,
            max_tokens=max_tokens,
            temperature=temperature,
        )

    # ───── 2. Niveau PROFESSIONNEL → cloud + scrub MEDIUM ─────
    if sensibilite == "professionnel":
        scrubbed_user, report = scrub_text(user_prompt, level=ScrubLevel.MEDIUM)
        if report.detected_count > 0:
            print(f"[WARN] PII détectée et masquée avant envoi cloud : {report.summary()}")
        user_prompt = scrubbed_user

    # ───── 3. Niveau PUBLIC → scrub LIGHT (sécurité minimale) ─────
    elif sensibilite == "public":
        scrubbed_user, report = scrub_text(user_prompt, level=ScrubLevel.LIGHT)
        if report.detected_count > 0:
            print(f"[WARN] PII détectée même en mode public — masquée : {report.summary()}")
        user_prompt = scrubbed_user

    # ───── 4. Appel OpenRouter standard ─────
    if not OPENROUTER_API_KEY:
        return f"[LLM stub — OPENROUTER_API_KEY non défini]\nAgent fictif aurait répondu pour : {user_prompt[:100]}"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                OPENROUTER_URL,
                json=payload,
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
            )
            if resp.status_code != 200:
                return f"[LLM error {resp.status_code}] {resp.text[:300]}"
            data = resp.json()
            return data["choices"][0]["message"]["content"]
    except (httpx.HTTPError, ValueError, KeyError) as e:
        return f"[LLM exception] {e}"


async def call_llm_stream(
    model: str,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 2500,
    temperature: float = 0.6,
    sensibilite: str = "professionnel",
) -> AsyncIterator[str]:
    """
    Version streaming de call_llm. 
    Enforce Loi 25 : les données 'confidentiel-client' passent par Ollama local.
    """
    # ───── 1. Ingestion / Scrubbing ─────
    if sensibilite == "confidentiel-client":
        scrubbed_user, _ = scrub_text(user_prompt, level=ScrubLevel.STRICT)
        # TODO: Implémenter call_ollama_stream dans ollama_client
        # Pour l'instant fallback non-stream
        resp = await call_ollama(model=None, system_prompt=system_prompt, user_prompt=scrubbed_user)
        yield resp
        return

    if sensibilite == "professionnel":
        user_prompt, _ = scrub_text(user_prompt, level=ScrubLevel.MEDIUM)
    elif sensibilite == "public":
        user_prompt, _ = scrub_text(user_prompt, level=ScrubLevel.LIGHT)

    # ───── 2. OpenRouter Streaming ─────
    if not OPENROUTER_API_KEY:
        yield "[LLM stream stub — API KEY manquante]"
        return

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST", OPENROUTER_URL, 
                json=payload, 
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"}
            ) as resp:
                if resp.status_code != 200:
                    yield f"[LLM error {resp.status_code}]"
                    return
                
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                        content = data["choices"][0]["delta"].get("content", "")
                        if content:
                            yield content
                    except (json.JSONDecodeError, KeyError):
                        continue
    except Exception as e:
        yield f"[LLM exception] {e}"

class CFOZKernel:
    """
    Orchestrateur du pipeline CFO Knowledge Factory.

    Usage :
        kernel = CFOZKernel(run_config)
        run_id = kernel.start()                  # crée le run en DB, lance la tâche async
        # …interactions par /api/cfo-kf/checkpoint pour CP1/CP2…
    """

    def __init__(self, run_config: dict):
        self.config = run_config
        self.run_id: str | None = None

    def start(self) -> dict:
        """Crée le run en DB et lance l'exécution async en arrière-plan."""
        run = insert_run({
            "module": "cfo-knowledge-factory",
            "mode": self.config.get("mode", "factory"),
            "domaine": self.config.get("domaine", ""),
            "mandat": self.config.get("mandat", ""),
            "description": self.config.get("description", ""),
            "client_id": self.config.get("client_id"),
            "nb_pages_cible": int(self.config.get("nb_pages_cible", 30)),
            "budget_max_eur": float(self.config.get("budget_max_eur", 15)),
            "temps_max_min": int(self.config.get("temps_max_min", 90)),
            "niveau_rigueur": self.config.get("niveau_rigueur", "professionnel"),
            "sensibilite": self.config.get("sensibilite", "professionnel"),
            "objectif_vault": self.config.get("objectif_vault", "synthèse"),
            "chemin_vault": self.config.get("chemin_vault", f"workspace/cfo-vaults/{uuid.uuid4().hex[:8]}"),
            "config_snapshot": self.config,
            "status": State.PLANNED.value,
        })
        self.run_id = run["run_id"]

        # Lance l'exécution async en arrière-plan (non bloquant)
        asyncio.create_task(self._run_pipeline())
        return run

    async def _run_pipeline(self) -> None:
        """Exécute le pipeline complet, asynchrone.

        Phases réelles branchées via pipeline_phases :
          BOOTSTRAPPING → MAPPING → CP1 (pause humaine)
        Les phases post-CP1 sont exécutées par resume_after_checkpoint.
        """
        from observability import get_logger
        from pipeline_phases import phase_bootstrap, phase_mapping
        log = get_logger(__name__)

        try:
            vault_dir = Path(self.config.get(
                "chemin_vault", f"./workspace/cfo-vaults/{self.run_id}"
            ))
            self._vault_dir = vault_dir  # mémorisé pour les checkpoints suivants

            await self._transition(State.BOOTSTRAPPING)
            await phase_bootstrap(self.run_id, self.config.get("user_id"),
                                  self.config, vault_dir)

            await self._transition(State.MAPPING)
            result = await phase_mapping(call_llm, self.run_id,
                                         self.config.get("user_id"),
                                         self.config, vault_dir)
            # Stocke le plan pour la phase PILOT_WRITING
            self._plan_entries = result.artifacts

            # CP1 — attendre validation humaine
            await self._transition(State.WAITING_APPROVAL_CP1)
            log.info("pipeline.waiting_cp1", run_id=self.run_id)
        except OllamaUnavailableError as e:
            # Exception spécifique confidentiel-client : ne pas fallback cloud
            log.error("pipeline.ollama_required_unavailable",
                      run_id=self.run_id, error=str(e))
            update_run(self.run_id, {
                "status": State.FAILED.value,
                "ended_at": datetime.utcnow().isoformat(),
            })
        except (httpx.HTTPError, ValueError, KeyError) as e:
            log.error("pipeline.failed", run_id=self.run_id,
                      error_type=type(e).__name__, error=str(e))
            update_run(self.run_id, {
                "status": State.FAILED.value,
                "ended_at": datetime.utcnow().isoformat(),
            })

    async def _transition(self, new_state: State):
        update_run(self.run_id, {"status": new_state.value})
        insert_step({
            "run_id": self.run_id,
            "phase_name": new_state.value,
            "agent_name": "CFO",
            "agent_role_kvf": "Orchestrator",
            "status": "running",
        })

    # ────────────────────────────────────────────────────────────────────
    # PHASE EXECUTORS (stubs avec real LLM calls quand clé API présente)
    # ────────────────────────────────────────────────────────────────────

    async def _execute_mapping_phase(self):
        """FinanceAgent produit le Plan-Analyse.md."""
        run_context = json.dumps({
            "run_id": self.run_id,
            "phase": "MAPPING",
            "budget_used_pct": 0,
        })
        prompt = get_factory_prompt("FinanceAgent",
            run_context=run_context,
            mode=self.config["mode"],
            domaine=self.config["domaine"],
            mandat=self.config["mandat"],
            niveau_rigueur=self.config.get("niveau_rigueur", "professionnel"),
            sensibilite=self.config.get("sensibilite", "professionnel"),
            nb_pages_cible=self.config.get("nb_pages_cible", 30),
        )
        plan_md = await call_llm(
            model=select_model("FinanceAgent", 100),
            system_prompt=prompt,
            user_prompt=f"Produis le Plan-Analyse.md pour le mandat suivant :\n{self.config['mandat']}\n{self.config.get('description', '')}",
            max_tokens=3000,
            temperature=0.4,
            sensibilite=self.config.get("sensibilite", "professionnel"),
        )
        # Log step
        insert_step({
            "run_id": self.run_id,
            "phase_name": "MAPPING",
            "agent_name": "FinanceAgent",
            "agent_role_kvf": "ClusterPlanner",
            "status": "completed",
            "model_used": select_model("FinanceAgent", 100),
            "output_summary": plan_md[:500],
        })

    async def resume_after_checkpoint(self, checkpoint: str, decision: str) -> None:
        """Appelé par l'endpoint checkpoint pour reprendre le pipeline.

        Phases réelles : PILOT_WRITING → PILOT_QA → CP2 → FULL_WRITING
          → LINKING → AUDITING → COMPLIANCE_CHECK → DEBRIEFING → COMPLETED
        """
        from pipeline_phases import (
            phase_auditing,
            phase_compliance_check,
            phase_debriefing,
            phase_full_writing,
            phase_linking,
            phase_mapping,
            phase_pilot_qa,
            phase_pilot_writing,
        )

        run = get_run(self.run_id)
        if not run:
            _log.warning("kernel.resume.run_not_found", run_id=self.run_id)
            return

        vault_dir = getattr(self, "_vault_dir", None) or Path(
            self.config.get("chemin_vault", f"./workspace/cfo-vaults/{self.run_id}")
        )
        plan_entries = getattr(self, "_plan_entries", [])
        user_id = self.config.get("user_id")

        try:
            if checkpoint == "CP1" and decision == "GO":
                await self._transition(State.PILOT_WRITING)
                pilot_result = await phase_pilot_writing(
                    call_llm, self.run_id, user_id, self.config,
                    plan_entries, vault_dir,
                )
                self._pilot_artifacts = pilot_result.artifacts

                await self._transition(State.PILOT_QA)
                qa_result = await phase_pilot_qa(self.run_id, pilot_result.artifacts)
                if not qa_result.success:
                    _log.warning("kernel.pilot_qa.failed", run_id=self.run_id,
                                 metrics=qa_result.metrics)
                    # On passe quand même en WAITING_APPROVAL_CP2 pour que l'humain tranche
                await self._transition(State.WAITING_APPROVAL_CP2)

            elif checkpoint == "CP1" and decision == "CORRIGE":
                await self._transition(State.MAPPING)
                result = await phase_mapping(call_llm, self.run_id, user_id,
                                             self.config, vault_dir)
                self._plan_entries = result.artifacts
                await self._transition(State.WAITING_APPROVAL_CP1)

            elif checkpoint == "CP2" and decision == "GO":
                await self._transition(State.FULL_WRITING)
                full_result = await phase_full_writing(
                    call_llm, self.run_id, user_id, self.config,
                    plan_entries, getattr(self, "_pilot_artifacts", []), vault_dir,
                )
                all_artifacts = full_result.artifacts

                await self._transition(State.LINKING)
                await phase_linking(call_llm, self.run_id, user_id, self.config,
                                    all_artifacts, vault_dir)

                await self._transition(State.AUDITING)
                audit_result = await phase_auditing(
                    call_llm, self.run_id, user_id, self.config,
                    all_artifacts, vault_dir,
                )

                await self._transition(State.COMPLIANCE_CHECK)
                compliance_result = await phase_compliance_check(
                    self.run_id, user_id, self.config, all_artifacts, vault_dir,
                )

                await self._transition(State.DEBRIEFING)
                await phase_debriefing(
                    self.run_id, user_id, self.config, all_artifacts,
                    audit_result.metrics, compliance_result.metrics, vault_dir,
                )

                # Statut final : COMPLETED si compliance passed, sinon _WITH_WARNINGS
                final_status = (
                    State.COMPLETED if compliance_result.success
                    else State.COMPLETED_WITH_WARNINGS
                )
                update_run(self.run_id, {
                    "status": final_status.value,
                    "ended_at": datetime.utcnow().isoformat(),
                })
                _log.info("kernel.pipeline.completed", run_id=self.run_id,
                          status=final_status.value)

            elif checkpoint == "CP2" and decision == "AJUSTE":
                # Re-run pilote avec paramètres ajustés (simple : on re-rédige)
                await self._transition(State.PILOT_WRITING)
                pilot_result = await phase_pilot_writing(
                    call_llm, self.run_id, user_id, self.config,
                    plan_entries, vault_dir,
                )
                self._pilot_artifacts = pilot_result.artifacts
                await self._transition(State.WAITING_APPROVAL_CP2)

            elif decision == "STOP":
                update_run(self.run_id, {
                    "status": State.FAILED.value,
                    "ended_at": datetime.utcnow().isoformat(),
                })

        except OllamaUnavailableError as e:
            _log.error("kernel.resume.ollama_unavailable",
                       run_id=self.run_id, error=str(e))
            update_run(self.run_id, {
                "status": State.FAILED.value,
                "ended_at": datetime.utcnow().isoformat(),
            })
        except (httpx.HTTPError, ValueError, KeyError, OSError) as e:
            _log.error("kernel.resume.failed", run_id=self.run_id,
                       error_type=type(e).__name__, error=str(e))
            update_run(self.run_id, {
                "status": State.FAILED.value,
                "ended_at": datetime.utcnow().isoformat(),
            })


# ─────────────────────────────────────────────────────────────────────────────
# Registry des kernels actifs (en mémoire, pour reprise après checkpoint)
# ─────────────────────────────────────────────────────────────────────────────

_active_kernels: dict[str, CFOZKernel] = {}

def register_kernel(kernel: CFOZKernel) -> None:
    if kernel.run_id:
        _active_kernels[kernel.run_id] = kernel

def get_kernel(run_id: str) -> CFOZKernel | None:
    return _active_kernels.get(run_id)
