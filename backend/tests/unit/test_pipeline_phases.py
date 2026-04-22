"""Tests unitaires — pipeline_phases (ZAKI OS · Z12 AI CFO)."""
from __future__ import annotations

import pytest

from pipeline_phases import (
    WRITER_BY_PAGE_TYPE,
    compute_cost,
    count_soft_language,
    count_wikilinks,
    count_words,
    estimate_tokens,
    has_valid_yaml,
    parse_plan_md,
    verify_page_structural,
)


class TestHelpers:
    """Fonctions utilitaires pures."""

    def test_estimate_tokens(self) -> None:
        assert estimate_tokens("") == 1  # plancher à 1
        assert estimate_tokens("abcd") == 1
        assert estimate_tokens("abcdefgh") == 2

    def test_compute_cost_free_model(self) -> None:
        # Gemini flash free → coût 0
        cost = compute_cost("google/gemini-2.0-flash-exp:free", 1000, 500)
        assert cost == 0.0

    def test_compute_cost_claude(self) -> None:
        # 1000 in × 0.003 + 500 out × 0.015 / 1000 = 0.003 + 0.0075 = 0.0105
        cost = compute_cost("anthropic/claude-3.5-sonnet", 1000, 500)
        assert cost == pytest.approx(0.0105, abs=1e-6)


class TestVerifyStructural:
    """Tests du Verify structurel Python (sans LLM)."""

    def test_count_words_skips_yaml(self) -> None:
        md = "---\ntitre: Test\n---\n" + "mot " * 50
        wc = count_words(md)
        assert wc == 50  # Le YAML n'est pas compté

    def test_count_wikilinks(self) -> None:
        md = "Texte avec [[Lien1]] et [[Lien2]] et encore [[Lien3]]."
        assert count_wikilinks(md) == 3

    def test_has_valid_yaml_true(self) -> None:
        assert has_valid_yaml("---\ntitre: X\n---\nContenu") is True

    def test_has_valid_yaml_false(self) -> None:
        assert has_valid_yaml("Pas de YAML") is False

    def test_count_soft_language(self) -> None:
        md = "Il semblerait que la situation... Certains pensent que..."
        assert count_soft_language(md) >= 2

    def test_verify_passes(self, sample_valid_page_md: str) -> None:
        ok, issues = verify_page_structural(sample_valid_page_md, "concept")
        assert ok is True, f"Should pass but issues: {issues}"

    def test_verify_anemic_fails(self) -> None:
        md = "---\ntitre: X\n---\nTrop court. [[L1]][[L2]][[L3]][[L4]][[L5]][[L6]]"
        ok, issues = verify_page_structural(md, "concept")
        assert ok is False
        assert any("word_count" in i for i in issues)

    def test_verify_no_links_fails(self) -> None:
        md = "---\ntitre: X\n---\n" + "mot " * 900
        ok, issues = verify_page_structural(md, "concept")
        assert ok is False
        assert any("links_count" in i for i in issues)

    def test_tax_page_lower_threshold(self) -> None:
        # TaxAgent : 700 mots minimum (vs 800 pour concept)
        md = "---\ntitre: X\n---\n" + "mot " * 750 + " ".join(f"[[L{i}]]" for i in range(6))
        ok, _ = verify_page_structural(md, "règle")
        assert ok is True


class TestParsePlan:
    """Parsing du Plan-Analyse.md produit par FinanceAgent."""

    def test_parse_basic(self) -> None:
        md = """
## Crédit d'impôt RS&DE
- type: règle
- priorité: 5
- justification: Règle fiscale centrale
- alerte: fact-check-requis
- reference_attendue: Article 127 LIR

## Dépréciation fiscale
- type: concept
- priorité: 4
- justification: Mécanisme de base
- alerte: none
"""
        entries = parse_plan_md(md)
        assert len(entries) == 2
        assert entries[0].title == "Crédit d'impôt RS&DE"
        assert entries[0].type == "règle"
        assert entries[0].priority == 5
        assert entries[0].reference_attendue == "Article 127 LIR"
        assert entries[1].type == "concept"

    def test_parse_invalid_type_fallback(self) -> None:
        md = """
## Test
- type: invalid_type
- priorité: 3
- justification: test
"""
        entries = parse_plan_md(md)
        assert entries[0].type == "concept"  # fallback

    def test_parse_empty(self) -> None:
        assert parse_plan_md("") == []


class TestWriterMapping:
    """Routage type de page → agent rédacteur (directive KVF mapping)."""

    def test_regle_goes_to_tax(self) -> None:
        assert WRITER_BY_PAGE_TYPE["règle"] == "TaxAgent"

    def test_cas_type_goes_to_tax(self) -> None:
        assert WRITER_BY_PAGE_TYPE["cas-type"] == "TaxAgent"

    def test_concept_goes_to_comms(self) -> None:
        assert WRITER_BY_PAGE_TYPE["concept"] == "CommsAgent"
