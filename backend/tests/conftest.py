from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Ajoute backend/ au PYTHONPATH pour que les imports absolus fonctionnent
_BACKEND_DIR = Path(__file__).parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))


@pytest.fixture
def sample_page_entry() -> dict:
    """Entry de plan type pour tester execute_page_with_evv."""
    return {
        "title": "Crédit d'impôt RS&DE",
        "type": "règle",
        "priority": 5,
        "justification": "Règle fiscale centrale du mandat",
        "alerte": "fact-check-requis",
    }


@pytest.fixture
def sample_run_config() -> dict:
    """Config de run type."""
    return {
        "mode": "factory",
        "domaine": "Fiscalité QC",
        "mandat": "Synthèse TPS/TVQ commerce de détail 2026",
        "description": "",
        "nb_pages_cible": 30,
        "pages_pilote": 6,
        "batch_size": 6,
        "budget_max_eur": 15.0,
        "temps_max_min": 90,
        "niveau_rigueur": "professionnel",
        "sensibilite": "professionnel",
        "chemin_vault": "./workspace/test-vault",
    }


@pytest.fixture
def sample_valid_page_md() -> str:
    """Page markdown qui passe le verify structurel."""
    body = " ".join(["mot"] * 850)  # >= 800 mots
    links = " ".join(f"[[Concept{i}]]" for i in range(6))  # 6 wikilinks
    return (
        "---\n"
        "titre: Test Page\n"
        "type: concept\n"
        "statut: draft\n"
        "---\n"
        f"\nIntroduction dense sur le sujet. {body}\n\n"
        f"Liens contextuels : {links}\n"
    )
