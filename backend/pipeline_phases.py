"""
pipeline_phases.py
─────────────────────────────────────────────────────────────────────────────
Implémentation réelle des 6 phases du pipeline CFO Knowledge Factory.

Chaque phase :
- Sélectionne l'agent via le mapping KVF → CFO (section 5 de la spec)
- Appelle le LLM approprié via z_kernel.call_llm (routage sensibilité inclus)
- Applique le pattern EVV (Execute → Verify → Validate avec modèle différent)
- Produit des artefacts réels sur filesystem
- Logge chaque step dans cfo_steps avec cost/tokens/quality_score
- Met à jour les métriques du run dans cfo_runs

Architecture :
- PhaseResult : dataclass de retour avec status, artifacts, metrics
- verify_*() : checks structurels Python (word count, YAML, links)
- validate_llm() : validation qualité par un modèle ≠ rédacteur (anti-auto-validation)
- execute_*() : orchestre Execute + Verify + Validate + retry + escalade
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from agent_prompts_factory import get_factory_prompt
from kb_storage import get_run, insert_page, insert_step, update_run
from observability import Timer, get_logger

log = get_logger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Configuration des phases (réutilise le mapping de la spec)
# ─────────────────────────────────────────────────────────────────────────────

# Mapping type de page → agent rédacteur
WRITER_BY_PAGE_TYPE = {
    "règle":          "TaxAgent",
    "cas-type":       "TaxAgent",
    "modèle-calcul":  "InvestmentAgent",   # override pour dérivés ci-dessous
    "concept":        "CommsAgent",
    "procédure":      "CommsAgent",
    "critique":       "CommsAgent",
    "synthèse":       "CommsAgent",
    "page-pont":      "CommsAgent",
}

# EVV — modèle validateur toujours ≠ rédacteur
VALIDATOR_MODEL = "google/gemini-2.0-flash-exp:free"

# Seuils EVV
MIN_WORDS_PER_PAGE = 800
MIN_WORDS_PER_PAGE_TAX = 700
MIN_LINKS_PER_PAGE = 5
QUALITY_THRESHOLD = 7.5
MAX_EXECUTE_RETRIES = 2
MAX_VALIDATE_RETRIES = 1

# Estimation coût (en €) — valeurs empiriques, à ajuster
COST_PER_1K_TOKENS_IN = {
    "anthropic/claude-3.5-sonnet": 0.003,
    "openai/gpt-4-turbo": 0.010,
    "google/gemini-2.0-flash-exp:free": 0.0,
    "meta-llama/llama-3.1-70b-instruct": 0.0009,
}
COST_PER_1K_TOKENS_OUT = {
    "anthropic/claude-3.5-sonnet": 0.015,
    "openai/gpt-4-turbo": 0.030,
    "google/gemini-2.0-flash-exp:free": 0.0,
    "meta-llama/llama-3.1-70b-instruct": 0.0009,
}


# ─────────────────────────────────────────────────────────────────────────────
# Dataclasses
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class PlanEntry:
    title: str
    type: str           # concept | règle | etc.
    priority: int       # 1..5
    justification: str
    alerte: str = "none"
    reference_attendue: str | None = None


@dataclass
class PageArtifact:
    title: str
    type: str
    filepath: Path
    content: str
    word_count: int
    links_count: int
    quality_score: float
    status: str          # verified | to-verify | debated | draft
    quality_flag: str | None = None
    cost_eur: float = 0.0
    regulatory_refs: list[str] = field(default_factory=list)


@dataclass
class PhaseResult:
    phase: str
    success: bool
    artifacts: list[Any] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers : estimation tokens / coût
# ─────────────────────────────────────────────────────────────────────────────

def estimate_tokens(text: str) -> int:
    """Estimation grossière : 1 token ≈ 4 chars (français un peu plus)."""
    return max(1, len(text) // 4)


def compute_cost(model: str, tokens_in: int, tokens_out: int) -> float:
    cin = COST_PER_1K_TOKENS_IN.get(model, 0.002)
    cout = COST_PER_1K_TOKENS_OUT.get(model, 0.010)
    return (tokens_in / 1000 * cin) + (tokens_out / 1000 * cout)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers : Verify (checks structurels Python — pas de LLM)
# ─────────────────────────────────────────────────────────────────────────────

def count_words(text: str) -> int:
    body = re.sub(r"^---.*?---\n", "", text, count=1, flags=re.DOTALL)
    return len(re.findall(r"\b\w+\b", body))


def count_wikilinks(text: str) -> int:
    return len(re.findall(r"\[\[([^\]]+)\]\]", text))


def has_valid_yaml(text: str) -> bool:
    if not text.startswith("---"):
        return False
    end = text.find("\n---", 3)
    return end > 0


def count_soft_language(text: str) -> int:
    """Détecte les formulations molles interdites par le prompt."""
    patterns = [
        r"\bil semblerait\b",
        r"\bcertains pensent\b",
        r"\bon pourrait dire\b",
        r"\bprobablement\b.{0,30}\bque\b",
    ]
    count = 0
    for p in patterns:
        count += len(re.findall(p, text, re.IGNORECASE))
    return count


def verify_page_structural(text: str, page_type: str) -> tuple[bool, list[str]]:
    """Checks structurels synchrones. Retourne (passed, issues)."""
    issues = []
    min_words = MIN_WORDS_PER_PAGE_TAX if page_type in ("règle", "cas-type") else MIN_WORDS_PER_PAGE
    wc = count_words(text)
    if wc < min_words:
        issues.append(f"word_count={wc} < {min_words}")
    lc = count_wikilinks(text)
    if lc < MIN_LINKS_PER_PAGE:
        issues.append(f"links_count={lc} < {MIN_LINKS_PER_PAGE}")
    if not has_valid_yaml(text):
        issues.append("YAML front-matter invalide ou manquant")
    soft = count_soft_language(text)
    if soft > 2:
        issues.append(f"soft_language_count={soft} > 2")
    return (len(issues) == 0, issues)


# ─────────────────────────────────────────────────────────────────────────────
# Validate — appel LLM validateur (modèle ≠ rédacteur)
# ─────────────────────────────────────────────────────────────────────────────

async def validate_llm(call_llm_fn, content: str, page_type: str, sensibilite: str) -> tuple[float, str]:
    """
    Valide la qualité d'une page via un modèle validateur différent.
    Retourne (score 1-10, feedback).
    """
    validator_prompt = (
        f"Tu es un validateur qualité indépendant pour un vault financier CPA.\n"
        f"Évalue rigoureusement cette page de type '{page_type}' sur ces critères :\n"
        f"- Densité et précision du contenu financier\n"
        f"- Cohérence interne, absence de contradictions\n"
        f"- Qualité des wikilinks (contextuels, naturels)\n"
        f"- Absence d'hallucinations détectables\n"
        f"- Conformité des références réglementaires citées\n"
        f"- Absence de formulations molles (non professionnelles)\n\n"
        f"Retourne UNIQUEMENT un JSON strict :\n"
        f'{{"score": <1-10>, "feedback": "1-2 phrases actionnables si score < 8"}}'
    )
    user = f"PAGE À ÉVALUER\n\n{content[:8000]}"  # cap pour coût
    try:
        raw = await call_llm_fn(
            model=VALIDATOR_MODEL,
            system_prompt=validator_prompt,
            user_prompt=user,
            max_tokens=250,
            temperature=0.1,
            sensibilite=sensibilite,
        )
        # Extraction JSON robuste
        m = re.search(r"\{[^{}]*\"score\"[^{}]*\}", raw)
        if m:
            obj = json.loads(m.group())
            score = float(obj.get("score", 0))
            feedback = str(obj.get("feedback", ""))[:500]
            return score, feedback
        return 6.0, "Validateur n'a pas renvoyé un JSON parsable"
    except (ValueError, KeyError, TypeError) as e:
        log.warn("evv.validate.exception", error=str(e))
        return 6.0, f"Exception validateur : {e}"


# ─────────────────────────────────────────────────────────────────────────────
# Execute+Verify+Validate : boucle complète pour une page
# ─────────────────────────────────────────────────────────────────────────────

async def execute_page_with_evv(
    call_llm_fn,
    run_id: str,
    user_id: str | None,
    plan_entry: PlanEntry,
    existing_titles: list[str],
    run_context: dict,
    vault_dir: Path,
    sensibilite: str,
) -> PageArtifact:
    """
    Boucle EVV complète pour une page :
      1. Execute via l'agent rédacteur approprié
      2. Verify structurel (Python, sync)
      3. Validate via modèle différent
      4. Retry + escalade selon budget
      5. Écriture .md sur filesystem + insert cfo_pages + insert cfo_steps
    """
    from z_kernel import select_model  # lazy import pour éviter cycle

    # Route vers le bon agent
    writer_agent = WRITER_BY_PAGE_TYPE.get(plan_entry.type, "CommsAgent")
    # Override pour dérivés (heuristique titre)
    if plan_entry.type == "modèle-calcul" and re.search(r"\b(dérivé|option|swap|forward|black.scholes|greek)", plan_entry.title, re.I):
        writer_agent = "DerivativePricingAgent"

    writer_model = select_model(writer_agent, budget_remaining_pct=100)

    sys_prompt = get_factory_prompt(
        writer_agent,
        run_context=json.dumps(run_context),
        mode=run_context.get("mode", "factory"),
        domaine=run_context.get("domaine", ""),
        mandat=run_context.get("mandat", ""),
        niveau_rigueur=run_context.get("niveau_rigueur", "professionnel"),
        sensibilite=sensibilite,
        titre_page=plan_entry.title,
        type_page=plan_entry.type,
        liste_titres_existants="\n- ".join(existing_titles[-50:]) or "(vault vide)",
        factcheck_results="{}",
    )
    user_prompt = (
        f"Rédige la page '{plan_entry.title}' (type: {plan_entry.type}, priorité: {plan_entry.priority}).\n"
        f"Justification du plan : {plan_entry.justification}\n"
        f"Alerte fact-check : {plan_entry.alerte}\n"
        f"{'Référence attendue : ' + plan_entry.reference_attendue if plan_entry.reference_attendue else ''}"
    )

    total_cost = 0.0
    total_tokens_in = 0
    total_tokens_out = 0
    final_content = ""
    final_score = 0.0
    issues_history: list[str] = []
    quality_flag: str | None = None

    for execute_retry in range(MAX_EXECUTE_RETRIES + 1):
        # Escalade de modèle aux retries
        model_used = writer_model
        if execute_retry == 1:
            model_used = "anthropic/claude-3.5-sonnet"  # niveau 2
        elif execute_retry == 2:
            model_used = "anthropic/claude-3.5-sonnet"  # niveau 3 avec prompt renforcé
            sys_prompt = sys_prompt + (
                "\n\n⚠ ESCALADE NIVEAU 2 : l'essai précédent a échoué les critères EVV. "
                f"Issues détectées : {', '.join(issues_history[-5:])}. "
                "Applique les contraintes de manière stricte."
            )

        with Timer():
            content = await call_llm_fn(
                model=model_used,
                system_prompt=sys_prompt,
                user_prompt=user_prompt,
                max_tokens=2500,
                temperature=0.5,
                sensibilite=sensibilite,
            )
        tokens_in = estimate_tokens(sys_prompt + user_prompt)
        tokens_out = estimate_tokens(content)
        cost = compute_cost(model_used, tokens_in, tokens_out)
        total_cost += cost
        total_tokens_in += tokens_in
        total_tokens_out += tokens_out

        # Verify structurel
        passed, issues = verify_page_structural(content, plan_entry.type)
        issues_history.extend(issues)
        if not passed:
            log.info("evv.verify.failed", run_id=run_id, page=plan_entry.title,
                     retry=execute_retry, issues=issues)
            if execute_retry < MAX_EXECUTE_RETRIES:
                continue
            # Plafond atteint → flag manual review mais on continue
            quality_flag = "manual_review_needed"

        # Validate LLM (modèle différent)
        score, feedback = await validate_llm(call_llm_fn, content, plan_entry.type, sensibilite)
        if score < QUALITY_THRESHOLD:
            log.info("evv.validate.below_threshold", run_id=run_id, page=plan_entry.title,
                     score=score, feedback=feedback)
            if execute_retry < MAX_VALIDATE_RETRIES:
                user_prompt = user_prompt + f"\n\n[Feedback validateur précédent] {feedback}"
                continue
            quality_flag = quality_flag or "manual_review_needed"

        final_content = content
        final_score = score
        break

    # Écriture filesystem
    pages_dir = vault_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^\w\-àâäéèêëîïôöùûüç ]", "", plan_entry.title.lower()).strip().replace(" ", "-")[:80]
    filepath = pages_dir / f"{safe_name}.md"
    try:
        filepath.write_text(final_content, encoding="utf-8")
    except OSError as e:
        log.error("evv.filesystem.write_failed", path=str(filepath), error=str(e))

    # Extraction regulatory refs (heuristique)
    reg_refs = re.findall(r"\b(?:article|art\.?)\s*(\d+[a-z]?)\s*(?:de\s+la\s+)?(?:LIR|LTVQ|LIQ)", final_content, re.I)
    # Dedup
    reg_refs = list(set(reg_refs))[:10]

    wc = count_words(final_content)
    lc = count_wikilinks(final_content)

    status = "verified" if final_score >= QUALITY_THRESHOLD and not quality_flag else "to-verify"

    artifact = PageArtifact(
        title=plan_entry.title,
        type=plan_entry.type,
        filepath=filepath,
        content=final_content,
        word_count=wc,
        links_count=lc,
        quality_score=final_score,
        status=status,
        quality_flag=quality_flag,
        cost_eur=total_cost,
        regulatory_refs=reg_refs,
    )

    # Insert cfo_pages
    insert_page({
        "run_id": run_id,
        "user_id": user_id,
        "title": plan_entry.title,
        "type": plan_entry.type,
        "status": status,
        "word_count": wc,
        "links_count": lc,
        "quality_score": round(final_score, 1),
        "fact_check_level": "standard",
        "quality_flag": quality_flag,
        "regulatory_refs": reg_refs,
        "fiscal_year": run_context.get("fiscal_year"),
        "filepath": str(filepath),
    })

    # Insert cfo_steps
    insert_step({
        "run_id": run_id,
        "user_id": user_id,
        "phase_name": "PAGE_WRITING",
        "agent_name": writer_agent,
        "agent_role_kvf": "VaultWriter",
        "status": "completed" if not quality_flag else "manual_review",
        "model_used": writer_model,
        "retry_count": execute_retry,
        "tokens_in": total_tokens_in,
        "tokens_out": total_tokens_out,
        "cost_estimate_eur": round(total_cost, 6),
        "quality_score": round(final_score, 1),
        "quality_flag": quality_flag,
        "input_summary": f"Page: {plan_entry.title} ({plan_entry.type})",
        "output_summary": final_content[:500],
    })

    return artifact


# ─────────────────────────────────────────────────────────────────────────────
# PHASES
# ─────────────────────────────────────────────────────────────────────────────

async def phase_bootstrap(run_id: str, user_id: str | None, config: dict, vault_dir: Path) -> PhaseResult:
    """Crée la structure du vault sur filesystem + Run-Config.md."""
    vault_dir.mkdir(parents=True, exist_ok=True)
    (vault_dir / "pages").mkdir(exist_ok=True)
    meta_dir = vault_dir / "99-Meta"
    meta_dir.mkdir(exist_ok=True)
    (vault_dir / "98-Index").mkdir(exist_ok=True)

    config_md = [
        f"# Run-Config — {run_id}",
        "",
        f"- **Mode** : {config.get('mode')}",
        f"- **Domaine** : {config.get('domaine')}",
        f"- **Mandat** : {config.get('mandat')}",
        f"- **Sensibilité** : {config.get('sensibilite', 'professionnel')}",
        f"- **Niveau rigueur** : {config.get('niveau_rigueur', 'professionnel')}",
        f"- **Pages cibles** : {config.get('nb_pages_cible', 30)}",
        f"- **Budget max** : {config.get('budget_max_eur', 15)}€",
        "- **Embedding provider** : huggingface (intfloat/multilingual-e5-large, 1024d)",
        f"- **Démarré** : {datetime.utcnow().isoformat()}Z",
    ]
    (meta_dir / "Run-Config.md").write_text("\n".join(config_md), encoding="utf-8")

    log.info("phase.bootstrap.completed", run_id=run_id, vault=str(vault_dir))
    return PhaseResult(phase="BOOTSTRAPPING", success=True,
                       metrics={"vault_dir": str(vault_dir)})


def parse_plan_md(md: str) -> list[PlanEntry]:
    """Parse le Plan-Analyse.md au format standard vers des PlanEntry."""
    entries = []
    # Section par ## titre
    sections = re.split(r"^##\s+", md, flags=re.MULTILINE)[1:]
    for section in sections:
        lines = section.strip().split("\n")
        if not lines:
            continue
        title = lines[0].strip()
        type_ = "concept"
        priority = 3
        justification = ""
        alerte = "none"
        ref = None
        for line in lines[1:]:
            m = re.match(r"-\s*type\s*:\s*(\S+)", line, re.I)
            if m:
                type_ = m.group(1).strip().lower()
                continue
            m = re.match(r"-\s*priorité\s*:\s*(\d)", line, re.I)
            if m:
                priority = int(m.group(1))
                continue
            m = re.match(r"-\s*justification\s*:\s*(.+)", line, re.I)
            if m:
                justification = m.group(1).strip()
                continue
            m = re.match(r"-\s*alerte\s*:\s*(.+)", line, re.I)
            if m:
                alerte = m.group(1).strip()
                continue
            m = re.match(r"-\s*reference_attendue\s*:\s*(.+)", line, re.I)
            if m:
                ref = m.group(1).strip()
        # Normalise type (retire accents manquants)
        VALID_TYPES = {"concept", "règle", "procédure", "cas-type", "critique", "modèle-calcul", "synthèse", "page-pont"}
        if type_ not in VALID_TYPES:
            # fallback sur le plus proche
            type_ = "concept"
        entries.append(PlanEntry(
            title=title, type=type_, priority=priority,
            justification=justification, alerte=alerte, reference_attendue=ref,
        ))
    return entries


async def phase_mapping(
    call_llm_fn, run_id: str, user_id: str | None, config: dict, vault_dir: Path,
) -> PhaseResult:
    """FinanceAgent produit le Plan-Analyse.md."""
    from z_kernel import select_model
    sys_prompt = get_factory_prompt(
        "FinanceAgent",
        run_context=json.dumps({"run_id": run_id, "phase": "MAPPING"}),
        mode=config.get("mode", "factory"),
        domaine=config.get("domaine", ""),
        mandat=config.get("mandat", ""),
        niveau_rigueur=config.get("niveau_rigueur", "professionnel"),
        sensibilite=config.get("sensibilite", "professionnel"),
        nb_pages_cible=config.get("nb_pages_cible", 30),
    )
    user_prompt = (
        f"Produis le Plan-Analyse.md pour le mandat suivant :\n\n"
        f"Mandat : {config.get('mandat', '')}\n"
        f"Description : {config.get('description', '')}\n"
    )
    model = select_model("FinanceAgent", 100)
    with Timer() as t:
        plan_md = await call_llm_fn(
            model=model, system_prompt=sys_prompt, user_prompt=user_prompt,
            max_tokens=3000, temperature=0.4,
            sensibilite=config.get("sensibilite", "professionnel"),
        )
    tokens_in = estimate_tokens(sys_prompt + user_prompt)
    tokens_out = estimate_tokens(plan_md)
    cost = compute_cost(model, tokens_in, tokens_out)

    # Sauvegarde
    plan_path = vault_dir / "99-Meta" / "Plan-Analyse.md"
    plan_path.write_text(plan_md, encoding="utf-8")

    # Parse
    entries = parse_plan_md(plan_md)

    # Log step
    insert_step({
        "run_id": run_id, "user_id": user_id,
        "phase_name": "MAPPING", "agent_name": "FinanceAgent",
        "agent_role_kvf": "ClusterPlanner", "status": "completed",
        "model_used": model, "duration_sec": int(t.elapsed),
        "tokens_in": tokens_in, "tokens_out": tokens_out,
        "cost_estimate_eur": round(cost, 6),
        "output_summary": f"Plan produit : {len(entries)} pages proposées",
    })
    update_run(run_id, {"budget_used_eur": cost})

    log.info("phase.mapping.completed", run_id=run_id, pages_planned=len(entries), cost=cost)
    return PhaseResult(
        phase="MAPPING", success=True,
        artifacts=entries,
        metrics={"plan_path": str(plan_path), "pages_planned": len(entries), "cost_eur": cost},
    )


async def phase_pilot_writing(
    call_llm_fn, run_id: str, user_id: str | None, config: dict,
    plan_entries: list[PlanEntry], vault_dir: Path,
) -> PhaseResult:
    """Rédige les N pages pilotes (top priorité)."""
    n_pilot = min(config.get("pages_pilote", 6), len(plan_entries))
    # Trie par priorité décroissante
    sorted_entries = sorted(plan_entries, key=lambda e: -e.priority)[:n_pilot]

    artifacts: list[PageArtifact] = []
    existing_titles: list[str] = []
    total_cost = 0.0

    run_context = {
        "run_id": run_id, "phase": "PILOT_WRITING",
        "mode": config.get("mode"), "domaine": config.get("domaine"),
        "mandat": config.get("mandat"),
        "niveau_rigueur": config.get("niveau_rigueur", "professionnel"),
        "fiscal_year": None,
    }

    for entry in sorted_entries:
        artifact = await execute_page_with_evv(
            call_llm_fn=call_llm_fn, run_id=run_id, user_id=user_id,
            plan_entry=entry, existing_titles=existing_titles,
            run_context=run_context, vault_dir=vault_dir,
            sensibilite=config.get("sensibilite", "professionnel"),
        )
        artifacts.append(artifact)
        existing_titles.append(artifact.title)
        total_cost += artifact.cost_eur

    run = get_run(run_id) or {}
    new_used = float(run.get("budget_used_eur", 0)) + total_cost
    update_run(run_id, {
        "budget_used_eur": round(new_used, 4),
        "pages_created": len(artifacts),
    })

    log.info("phase.pilot_writing.completed", run_id=run_id,
             pages_created=len(artifacts), cost_batch=total_cost)
    return PhaseResult(
        phase="PILOT_WRITING", success=True, artifacts=artifacts,
        metrics={"pages_created": len(artifacts), "cost_eur": total_cost},
    )


async def phase_pilot_qa(run_id: str, artifacts: list[PageArtifact]) -> PhaseResult:
    """QA du lot pilote : score moyen, compte des to-verify."""
    if not artifacts:
        return PhaseResult(phase="PILOT_QA", success=False,
                           errors=["Aucune page à QA"])
    scores = [a.quality_score for a in artifacts]
    avg = sum(scores) / len(scores)
    verified = sum(1 for a in artifacts if a.status == "verified")
    to_verify = sum(1 for a in artifacts if a.status == "to-verify")
    passed = avg >= QUALITY_THRESHOLD and to_verify <= 2

    update_run(run_id, {
        "avg_quality_score": round(avg, 1),
        "pages_verified": verified,
        "pages_to_verify": to_verify,
    })
    log.info("phase.pilot_qa.completed", run_id=run_id, avg_score=avg, passed=passed)
    return PhaseResult(
        phase="PILOT_QA", success=passed,
        metrics={"avg_score": avg, "verified": verified, "to_verify": to_verify},
    )


async def phase_full_writing(
    call_llm_fn, run_id: str, user_id: str | None, config: dict,
    plan_entries: list[PlanEntry], already_written: list[PageArtifact], vault_dir: Path,
) -> PhaseResult:
    """Rédige les pages restantes par batches."""
    written_titles = {a.title for a in already_written}
    remaining = [e for e in plan_entries if e.title not in written_titles]
    batch_size = config.get("batch_size", 6)

    artifacts = list(already_written)
    existing_titles = [a.title for a in already_written]
    total_cost = 0.0

    run_context = {
        "run_id": run_id, "phase": "FULL_WRITING",
        "mode": config.get("mode"), "domaine": config.get("domaine"),
        "mandat": config.get("mandat"),
        "niveau_rigueur": config.get("niveau_rigueur", "professionnel"),
    }

    # Budget check à chaque batch
    for batch_start in range(0, len(remaining), batch_size):
        run = get_run(run_id) or {}
        budget_used = float(run.get("budget_used_eur", 0))
        budget_max = float(run.get("budget_max_eur", 15))
        budget_pct = (budget_used / budget_max) * 100 if budget_max else 0
        if budget_pct >= 95:
            log.warning("phase.full_writing.budget_exhausted", run_id=run_id, pct=budget_pct)
            break

        batch = remaining[batch_start:batch_start + batch_size]
        for entry in batch:
            artifact = await execute_page_with_evv(
                call_llm_fn=call_llm_fn, run_id=run_id, user_id=user_id,
                plan_entry=entry, existing_titles=existing_titles,
                run_context=run_context, vault_dir=vault_dir,
                sensibilite=config.get("sensibilite", "professionnel"),
            )
            artifacts.append(artifact)
            existing_titles.append(artifact.title)
            total_cost += artifact.cost_eur

        # Update running metrics
        run = get_run(run_id) or {}
        update_run(run_id, {
            "budget_used_eur": round(float(run.get("budget_used_eur", 0)) + total_cost, 4),
            "pages_created": len(artifacts),
        })
        total_cost = 0.0  # reset for next batch

    log.info("phase.full_writing.completed", run_id=run_id, total_pages=len(artifacts))
    return PhaseResult(
        phase="FULL_WRITING", success=True, artifacts=artifacts,
        metrics={"total_pages": len(artifacts)},
    )


async def phase_linking(
    call_llm_fn, run_id: str, user_id: str | None, config: dict,
    artifacts: list[PageArtifact], vault_dir: Path,
) -> PhaseResult:
    """AccountingAgent enrichit les liens inter-pages (version simplifiée : lexical + co-occurrence)."""
    titles = {a.title: a for a in artifacts}
    links_added = 0

    for artifact in artifacts:
        content = artifact.content
        # Pour chaque autre page, si son titre apparaît en clair et n'est pas déjà un lien, on wikilink-e
        for other_title in titles:
            if other_title == artifact.title:
                continue
            # Déjà un lien ?
            if f"[[{other_title}]]" in content:
                continue
            # Match lexical (case-insensitive)
            pattern = re.compile(r"\b" + re.escape(other_title) + r"\b", re.IGNORECASE)
            match = pattern.search(content)
            if match:
                # Un seul lien pour éviter la pollution
                content = content[:match.start()] + f"[[{other_title}]]" + content[match.end():]
                links_added += 1
        if content != artifact.content:
            artifact.content = content
            artifact.links_count = count_wikilinks(content)
            artifact.filepath.write_text(content, encoding="utf-8")

    insert_step({
        "run_id": run_id, "user_id": user_id,
        "phase_name": "LINKING", "agent_name": "AccountingAgent",
        "agent_role_kvf": "LinkerAgent", "status": "completed",
        "output_summary": f"{links_added} liens inter-pages ajoutés",
    })
    log.info("phase.linking.completed", run_id=run_id, links_added=links_added)
    return PhaseResult(phase="LINKING", success=True,
                       metrics={"links_added": links_added})


async def phase_auditing(
    call_llm_fn, run_id: str, user_id: str | None, config: dict,
    artifacts: list[PageArtifact], vault_dir: Path,
) -> PhaseResult:
    """SupervisorAgent produit Audit.md. Version simplifiée : checks structurels + 1 appel LLM global."""
    critiques: list[str] = []
    majeurs: list[str] = []
    mineurs: list[str] = []

    for a in artifacts:
        if a.status == "to-verify":
            majeurs.append(f"Page '{a.title}' en to-verify (score {a.quality_score:.1f})")
        if a.quality_flag == "manual_review_needed":
            majeurs.append(f"Page '{a.title}' flaggée manual_review_needed")
        if a.word_count < (MIN_WORDS_PER_PAGE_TAX if a.type in ("règle", "cas-type") else MIN_WORDS_PER_PAGE):
            mineurs.append(f"Page '{a.title}' anémique ({a.word_count} mots)")
        if a.links_count < MIN_LINKS_PER_PAGE:
            mineurs.append(f"Page '{a.title}' densité liens faible ({a.links_count})")

    # Doublons approximatifs par titre
    titles_seen: dict[str, str] = {}
    for a in artifacts:
        key = a.title.lower()[:40]
        if key in titles_seen:
            mineurs.append(f"Doublon probable : '{a.title}' vs '{titles_seen[key]}'")
        else:
            titles_seen[key] = a.title

    audit_md = [
        f"# Audit — {config.get('domaine')} / {config.get('mandat')}",
        "",
        f"*Généré le {datetime.utcnow().isoformat()}Z — SupervisorAgent*",
        "",
        "## Résumé",
        f"- Pages auditées : {len(artifacts)}",
        f"- CRITIQUES : **{len(critiques)}**",
        f"- MAJEURS : **{len(majeurs)}**",
        f"- MINEURS : **{len(mineurs)}**",
        "",
    ]
    for section, items in [("CRITIQUES", critiques), ("MAJEURS", majeurs), ("MINEURS", mineurs)]:
        audit_md.append(f"## {section} ({len(items)})")
        if items:
            audit_md.extend(f"- {it}" for it in items)
        else:
            audit_md.append("*Aucun.*")
        audit_md.append("")

    audit_path = vault_dir / "99-Meta" / "Audit.md"
    audit_path.write_text("\n".join(audit_md), encoding="utf-8")

    insert_step({
        "run_id": run_id, "user_id": user_id,
        "phase_name": "AUDITING", "agent_name": "SupervisorAgent",
        "agent_role_kvf": "AuditAgent", "status": "completed",
        "output_summary": f"C:{len(critiques)} M:{len(majeurs)} m:{len(mineurs)}",
    })
    log.info("phase.auditing.completed", run_id=run_id,
             critiques=len(critiques), majeurs=len(majeurs), mineurs=len(mineurs))
    return PhaseResult(
        phase="AUDITING", success=len(critiques) == 0,
        artifacts=[str(audit_path)],
        metrics={"issues_critical": len(critiques), "issues_major": len(majeurs), "issues_minor": len(mineurs)},
    )


async def phase_compliance_check(
    run_id: str, user_id: str | None, config: dict,
    artifacts: list[PageArtifact], vault_dir: Path,
) -> PhaseResult:
    """Check-list 7 points finance-specific."""
    from security_pii import ScrubLevel, scrub_text

    checks: dict[str, bool] = {}
    sensibilite = config.get("sensibilite", "professionnel")

    # 1. No PII si confidentiel
    if sensibilite == "confidentiel-client":
        has_pii = False
        for a in artifacts:
            _, report = scrub_text(a.content, ScrubLevel.STRICT)
            if report.detected_count > 0:
                has_pii = True
                break
        checks["no_pii"] = not has_pii
    else:
        checks["no_pii"] = True  # Non applicable

    # 2. Taux fiscaux cohérents (heuristique simple : même taux TPS mentionné partout)
    tps_rates = set()
    for a in artifacts:
        for m in re.finditer(r"\bTPS\s*(?:de|à)?\s*(\d+(?:[.,]\d+)?)\s*%", a.content, re.I):
            tps_rates.add(m.group(1).replace(",", "."))
    checks["fiscal_rates_coherent"] = len(tps_rates) <= 1

    # 3. Articles de loi avec numéro exact + année
    articles_with_year = 0
    articles_total = 0
    for a in artifacts:
        for _ in re.finditer(r"\b(?:article|art\.?)\s*\d+", a.content, re.I):
            articles_total += 1
        for _ in re.finditer(r"\b(?:article|art\.?)\s*\d+.{0,80}(?:19|20)\d{2}", a.content, re.I):
            articles_with_year += 1
    checks["law_articles_with_exact_numbers"] = (articles_total == 0) or (articles_with_year / articles_total >= 0.8)

    # 4. Aucune page audit-grade avec source invented
    if config.get("niveau_rigueur") == "audit-grade":
        checks["no_audit_grade_invented"] = all(a.status != "to-verify" or a.quality_score >= 7.5 for a in artifacts)
    else:
        checks["no_audit_grade_invented"] = True

    # 5. Mention CPA sur toute recommandation financière
    has_recommendations = any(re.search(r"\b(recommand|conseil|placement)", a.content, re.I) for a in artifacts)
    has_cpa_mention = any(re.search(r"\bCPA\b", a.content, re.I) for a in artifacts)
    checks["cpa_mention_on_recommendations"] = (not has_recommendations) or has_cpa_mention

    # 6. Dates de version des textes de loi
    if articles_total > 0:
        checks["law_versions_dates_present"] = articles_with_year / articles_total >= 0.5
    else:
        checks["law_versions_dates_present"] = True

    # 7. Normes citées existent (check basique : NCECF 1000-9999 ou IFRS 1-17)
    norms_valid = True
    for a in artifacts:
        for m in re.finditer(r"\bNCECF\s*(\d+)\b", a.content):
            n = int(m.group(1))
            if not (1000 <= n <= 9999):
                norms_valid = False
        for m in re.finditer(r"\bIFRS\s*(\d+)\b", a.content):
            n = int(m.group(1))
            if not (1 <= n <= 17):
                norms_valid = False
    checks["norms_exist"] = norms_valid

    passed = all(checks.values())

    compliance_path = vault_dir / "99-Meta" / "Compliance-Check.md"
    compliance_path.write_text(
        f"# Compliance Check — {run_id}\n\n"
        f"*Généré le {datetime.utcnow().isoformat()}Z*\n\n"
        f"## Résultat : {'✅ PASSED' if passed else '❌ FAILED'}\n\n"
        f"```json\n{json.dumps(checks, indent=2, ensure_ascii=False)}\n```\n",
        encoding="utf-8",
    )

    insert_step({
        "run_id": run_id, "user_id": user_id,
        "phase_name": "COMPLIANCE_CHECK", "agent_name": "SupervisorAgent",
        "agent_role_kvf": "Compliance", "status": "completed",
        "output_summary": f"Checks: {sum(checks.values())}/{len(checks)} passed",
    })
    update_run(run_id, {"compliance_passed": passed})

    log.info("phase.compliance.completed", run_id=run_id, passed=passed, checks=checks)
    return PhaseResult(
        phase="COMPLIANCE_CHECK", success=passed,
        artifacts=[str(compliance_path)],
        metrics={"passed": passed, "checks": checks},
    )


async def phase_debriefing(
    run_id: str, user_id: str | None, config: dict,
    artifacts: list[PageArtifact], audit_metrics: dict, compliance_metrics: dict, vault_dir: Path,
) -> PhaseResult:
    """ForecastAgent produit Debrief.md + CFO-Run-Stats.json."""
    run = get_run(run_id) or {}

    total_cost = float(run.get("budget_used_eur", 0))
    budget_max = float(run.get("budget_max_eur", 15))
    pages_created = len(artifacts)
    pages_target = int(config.get("nb_pages_cible", 30))
    avg_score = run.get("avg_quality_score") or (
        sum(a.quality_score for a in artifacts) / len(artifacts) if artifacts else 0
    )
    verified = sum(1 for a in artifacts if a.status == "verified")
    to_verify = sum(1 for a in artifacts if a.status == "to-verify")
    cost_per_validable = total_cost / verified if verified > 0 else 0

    # Projection scaling
    cost_per_page = total_cost / pages_created if pages_created else 0
    proj_5x = cost_per_page * pages_created * 5
    proj_10x = cost_per_page * pages_created * 10
    proj_20x = cost_per_page * pages_created * 20

    debrief_md = [
        f"# Debrief — {config.get('mandat')}",
        "",
        f"*Généré le {datetime.utcnow().isoformat()}Z — ForecastAgent*",
        "",
        "## Métriques finales",
        f"- **Pages** : {pages_created} / {pages_target} cibles",
        f"- **Score qualité moyen** : {avg_score:.2f} / 10",
        f"- **Pages verified** : {verified}",
        f"- **Pages to-verify** : {to_verify}",
        f"- **Coût total** : {total_cost:.2f} € / {budget_max:.2f} € budget ({total_cost/budget_max*100:.1f}%)",
        "",
        "## KPI CFO — Coût par page validable CPA",
        f"**{cost_per_validable:.3f} €/page**",
        "",
        "## Audit / Compliance",
        f"- CRITIQUES : {audit_metrics.get('issues_critical', 0)}",
        f"- MAJEURS : {audit_metrics.get('issues_major', 0)}",
        f"- MINEURS : {audit_metrics.get('issues_minor', 0)}",
        f"- Compliance 7-point : **{'PASSED' if compliance_metrics.get('passed') else 'FAILED'}**",
        "",
        "## Projection scaling",
        "| Échelle | Coût estimé |",
        "|---|---|",
        f"| ×5 ({pages_created * 5} pages) | {proj_5x:.2f} € |",
        f"| ×10 ({pages_created * 10} pages) | {proj_10x:.2f} € |",
        f"| ×20 ({pages_created * 20} pages) | {proj_20x:.2f} € |",
        "",
        "## Recommandations mode Production",
        f"- {'Augmenter premium_page_ratio' if avg_score < 7.5 else 'Seuils atteints, prêt pour Production'}",
        f"- {'Renforcer fact-check' if to_verify > pages_created * 0.2 else 'Fact-check calibrage OK'}",
        f"- {'Investiguer le goulot rédaction' if cost_per_page > budget_max/pages_target else 'Coût par page dans la cible'}",
    ]
    debrief_path = vault_dir / "99-Meta" / "Debrief.md"
    debrief_path.write_text("\n".join(debrief_md), encoding="utf-8")

    # Run-Stats.json
    stats = {
        "run_id": run_id,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "config": {k: config.get(k) for k in ("mode", "domaine", "mandat", "niveau_rigueur", "sensibilite", "nb_pages_cible", "budget_max_eur")},
        "pages": {
            "created": pages_created, "target": pages_target,
            "verified": verified, "to_verify": to_verify,
            "avg_quality_score": round(avg_score, 2),
        },
        "cost": {
            "total_eur": round(total_cost, 4),
            "budget_max_eur": budget_max,
            "cost_per_page_avg": round(cost_per_page, 4),
            "cost_per_validable_cpa": round(cost_per_validable, 4),
            "budget_remaining_pct": round((1 - total_cost/budget_max) * 100, 1) if budget_max else 0,
        },
        "audit": audit_metrics,
        "compliance": compliance_metrics,
        "scaling_projection": {
            "x5_eur": round(proj_5x, 2),
            "x10_eur": round(proj_10x, 2),
            "x20_eur": round(proj_20x, 2),
        },
    }
    stats_path = vault_dir / "99-Meta" / "CFO-Run-Stats.json"
    stats_path.write_text(json.dumps(stats, indent=2, ensure_ascii=False), encoding="utf-8")

    insert_step({
        "run_id": run_id, "user_id": user_id,
        "phase_name": "DEBRIEFING", "agent_name": "ForecastAgent",
        "agent_role_kvf": "DebriefAgent", "status": "completed",
        "output_summary": f"Debrief produit — KPI {cost_per_validable:.3f}€/page",
    })

    log.info("phase.debrief.completed", run_id=run_id,
             pages=pages_created, cost=total_cost, score=avg_score)
    return PhaseResult(
        phase="DEBRIEFING", success=True,
        artifacts=[str(debrief_path), str(stats_path)],
        metrics=stats,
    )
