"""
security_pii.py — ZAKI OS Z12 AI CFO Suite
─────────────────────────────────────────────────────────────────────────────
Détection et scrubbing de données personnelles identifiables (PII).

Conformité visée :
- Loi 25 (Québec) — protection des renseignements personnels
- LPRPDE (Canada) — Loi sur la protection des renseignements personnels
- Secret professionnel CPA — Code de déontologie de l'Ordre des CPA

Stratégie en 3 niveaux :
- LIGHT : nettoie les patterns évidents (NAS, emails, téléphones, cartes)
- MEDIUM : ajoute la détection de noms propres et adresses (heuristique)
- STRICT : tout ce qui précède + flag de tout token suspect
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum


class ScrubLevel(str, Enum):
    LIGHT = "light"
    MEDIUM = "medium"
    STRICT = "strict"


@dataclass
class PIIReport:
    """Rapport de détection PII."""
    detected: dict[str, list[str]] = field(default_factory=dict)
    detected_count: int = 0
    scrubbed_text_length: int = 0
    original_text_length: int = 0
    level_used: ScrubLevel = ScrubLevel.LIGHT

    def summary(self) -> str:
        if self.detected_count == 0:
            return "Aucune PII détectée"
        types = ", ".join(f"{k}({len(v)})" for k, v in self.detected.items())
        return f"{self.detected_count} entité(s) PII détectée(s) : {types}"


# ORDRE IMPORTANT : patterns longs AVANT patterns courts (évite chevauchements)
PATTERNS_CA: dict[str, re.Pattern[str]] = {
    "BANK_ACCOUNT": re.compile(r"\b\d{5}[\s\-]?\d{3}[\s\-]?\d{7}\b"),
    "BN_ENTERPRISE": re.compile(r"\b\d{9}\s?(?:RT|RC|RR|RP|RZ)\d{4}\b", re.IGNORECASE),
    "CREDIT_CARD": re.compile(r"\b(?:\d{4}[\s\-]?){3}\d{4}\b"),
    "NAS": re.compile(r"\b\d{3}[\s\-]\d{3}[\s\-]\d{3}\b"),
    "EMAIL": re.compile(r"\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b"),
    "PHONE_CA": re.compile(
        r"(?<![\d\-])(?:\+?1[\s\-\.]?)?\(?([2-9]\d{2})\)?[\s\-\.]?(\d{3})[\s\-\.]?(\d{4})(?![\d\-])"
    ),
    "POSTAL_CODE_CA": re.compile(r"\b[A-Z]\d[A-Z][\s\-]?\d[A-Z]\d\b"),
    "IP_ADDRESS": re.compile(
        r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b"
    ),
    "DATE_OF_BIRTH": re.compile(
        r"\b(?:0[1-9]|[12]\d|3[01])[\/\-\.](?:0[1-9]|1[012])[\/\-\.](?:19|20)\d{2}\b"
    ),
}

NAME_HEURISTIC_PATTERN = re.compile(
    r"\b(?:M\.|Mme|Monsieur|Madame|Dr|Maître|Me)\s+[A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+){0,3}\b"
)

PROPER_NAME_PATTERN = re.compile(r"\b[A-Z][a-zà-ÿ]{2,}\s+[A-Z][a-zà-ÿ]{2,}\b")

WHITELIST: set[str] = {
    "Revenu Québec", "Agence Revenu", "Cour Suprême", "Loi de l'Impôt",
    "Code Civil", "Code Criminel", "CPA Canada", "CPA Québec",
    "Banque Royale", "Banque Nationale", "Banque Toronto", "Banque Montréal",
    "Mouvement Desjardins", "Caisse Desjardins",
    "Loi Canadienne", "Loi Québécoise", "Cour Fédérale", "Cour Supérieure",
    "Crédit Impôt", "Déduction Pour", "Régime Enregistré",
}


def _validate_nas(value: str) -> bool:
    """Validation Luhn pour numéro d'assurance sociale CA."""
    digits = [int(c) for c in re.sub(r"\D", "", value)]
    if len(digits) != 9:
        return False
    total = 0
    for i, d in enumerate(digits):
        if i % 2 == 1:
            doubled = d * 2
            total += (doubled // 10) + (doubled % 10)
        else:
            total += d
    return total % 10 == 0


def scrub_text(
    text: str,
    level: ScrubLevel = ScrubLevel.LIGHT,
    placeholder_fn: Callable[[str], str] | None = None,
) -> tuple[str, PIIReport]:
    """Détecte et masque les PII. Retourne (texte nettoyé, rapport)."""
    if not text:
        return text, PIIReport(level_used=level)

    if placeholder_fn is None:
        def placeholder_fn(t: str) -> str:
            return f"[REDACTED-{t}]"

    report = PIIReport(level_used=level, original_text_length=len(text))
    cleaned = text

    # LIGHT : patterns canoniques
    for pii_type, pattern in PATTERNS_CA.items():
        matches = list(pattern.finditer(cleaned))
        if not matches:
            continue
        if pii_type == "NAS":
            matches = [m for m in matches if _validate_nas(m.group())]
        if pii_type == "CREDIT_CARD":
            matches = [m for m in matches if len(re.sub(r"\D", "", m.group())) == 16]
        if not matches:
            continue
        sample = [m.group() for m in matches[:5]]
        report.detected[pii_type] = sample
        report.detected_count += len(matches)
        for m in reversed(matches):
            cleaned = cleaned[:m.start()] + placeholder_fn(pii_type) + cleaned[m.end():]

    # MEDIUM/STRICT : noms titrés
    if level in (ScrubLevel.MEDIUM, ScrubLevel.STRICT):
        for m in reversed(list(NAME_HEURISTIC_PATTERN.finditer(cleaned))):
            value = m.group()
            if any(w in value for w in WHITELIST):
                continue
            report.detected.setdefault("NAME_WITH_TITLE", []).append(value)
            report.detected_count += 1
            cleaned = cleaned[:m.start()] + placeholder_fn("NAME_WITH_TITLE") + cleaned[m.end():]

    # STRICT : tous noms propres
    if level == ScrubLevel.STRICT:
        for m in reversed(list(PROPER_NAME_PATTERN.finditer(cleaned))):
            value = m.group()
            if value in WHITELIST or any(w in value for w in WHITELIST):
                continue
            report.detected.setdefault("PROPER_NAME", []).append(value)
            report.detected_count += 1
            cleaned = cleaned[:m.start()] + placeholder_fn("PROPER_NAME") + cleaned[m.end():]

    report.scrubbed_text_length = len(cleaned)
    return cleaned, report


def contains_pii(text: str, level: ScrubLevel = ScrubLevel.LIGHT) -> bool:
    """Test rapide : True si PII détecté (sans modification)."""
    _, report = scrub_text(text, level=level)
    return report.detected_count > 0


class PIIDetectedError(Exception):
    """Levée quand du PII est détecté dans un payload qui ne devrait pas en contenir."""

    def __init__(self, report: PIIReport) -> None:
        self.report = report
        super().__init__(f"PII détectée — appel cloud bloqué : {report.summary()}")


def assert_no_pii(text: str, level: ScrubLevel = ScrubLevel.MEDIUM) -> None:
    """Lève PIIDetectedError si PII détecté. Garde-fou pour appels LLM cloud."""
    _, report = scrub_text(text, level=level)
    if report.detected_count > 0:
        raise PIIDetectedError(report)
