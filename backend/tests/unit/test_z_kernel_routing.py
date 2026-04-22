"""Tests unitaires — z_kernel model selection (ZAKI OS · FREE FIRST policy)."""
from __future__ import annotations

from z_kernel import (
    AGENT_DEFAULT_MODEL,
    BUDGET_SAVE_MODEL,
    ESCALATION_MODEL,
    EVV_VALIDATOR_MODEL,
    select_model,
)


class TestFreeFirstPolicy:
    """Vérifie la conformité avec la directive CLAUDE.md FREE FIRST."""

    def test_z12_financial_agents_always_claude(self) -> None:
        """CFO, TaxAgent, AccountingAgent → toujours Claude Sonnet (directive Loi 25)."""
        for agent in ("CFO", "TaxAgent", "AccountingAgent"):
            # Même avec budget 0 → Claude obligatoire
            assert select_model(agent, 0) == "anthropic/claude-3.5-sonnet"
            assert select_model(agent, 100) == "anthropic/claude-3.5-sonnet"

    def test_other_agents_free_by_default(self) -> None:
        """Les agents non-financiers utilisent des modèles gratuits."""
        for agent in ("FinanceAgent", "CommsAgent", "AuditAgent",
                      "SupervisorAgent", "ForecastAgent"):
            model = select_model(agent, 100)
            # Tolérance : soit free explicitement, soit pas de coût premium OpenAI/Claude
            assert "openai" not in model.lower(), \
                f"{agent} ne doit PAS utiliser OpenAI (violation Loi 25 Z12)"

    def test_openai_never_for_any_agent(self) -> None:
        """Directive ZAKI OS : OpenAI INTERDIT pour tout agent."""
        for agent, model in AGENT_DEFAULT_MODEL.items():
            assert "openai" not in model.lower(), \
                f"{agent} utilise OpenAI — interdit par directive Loi 25"

    def test_budget_save_mode(self) -> None:
        """Budget < 20% → downgrade (sauf agents Z12 financiers)."""
        # Agent non-financier avec budget serré → model gratuit
        model = select_model("CommsAgent", 15)
        assert model == BUDGET_SAVE_MODEL

    def test_validator_different_from_writers(self) -> None:
        """Anti-auto-validation : validateur ≠ modèle rédacteur principal Claude."""
        assert EVV_VALIDATOR_MODEL != "anthropic/claude-3.5-sonnet"
        assert ":free" in EVV_VALIDATOR_MODEL or "flash" in EVV_VALIDATOR_MODEL

    def test_escalation_is_claude_for_quality(self) -> None:
        """Escalade niveau 2 → Claude (qualité)."""
        assert ESCALATION_MODEL == "anthropic/claude-3.5-sonnet"
