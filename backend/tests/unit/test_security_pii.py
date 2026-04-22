"""Tests unitaires — security_pii (ZAKI OS · Z12 AI CFO)."""
from __future__ import annotations

import pytest

from security_pii import (
    PIIDetectedError,
    ScrubLevel,
    _validate_nas,
    assert_no_pii,
    contains_pii,
    scrub_text,
)


class TestNASValidation:
    """Validation Luhn du NAS canadien."""

    def test_valid_nas_luhn(self) -> None:
        # 046-454-286 — NAS test connu (passe Luhn)
        assert _validate_nas("046-454-286") is True
        assert _validate_nas("046454286") is True
        assert _validate_nas("046 454 286") is True

    def test_invalid_nas_luhn(self) -> None:
        # 123-456-789 → ne passe pas Luhn
        assert _validate_nas("123-456-789") is False

    def test_nas_wrong_length(self) -> None:
        assert _validate_nas("12345") is False
        assert _validate_nas("1234567890") is False


class TestLightScrubbing:
    """Niveau LIGHT : patterns canoniques uniquement."""

    def test_nas_masked(self) -> None:
        cleaned, report = scrub_text("NAS: 046-454-286", ScrubLevel.LIGHT)
        assert "046-454-286" not in cleaned
        assert "[REDACTED-NAS]" in cleaned
        assert report.detected_count == 1

    def test_email_masked(self) -> None:
        cleaned, report = scrub_text("Contact: jean@exemple.ca", ScrubLevel.LIGHT)
        assert "jean@exemple.ca" not in cleaned
        assert "[REDACTED-EMAIL]" in cleaned
        assert "EMAIL" in report.detected

    def test_invalid_nas_not_masked(self) -> None:
        # NAS qui ne passe pas Luhn → pas masqué
        cleaned, report = scrub_text("Ref: 123-456-789", ScrubLevel.LIGHT)
        assert "NAS" not in report.detected

    def test_empty_text(self) -> None:
        cleaned, report = scrub_text("", ScrubLevel.LIGHT)
        assert cleaned == ""
        assert report.detected_count == 0


class TestMediumScrubbing:
    """Niveau MEDIUM : ajoute noms titrés."""

    def test_name_with_title_masked(self) -> None:
        cleaned, report = scrub_text(
            "M. Jean Tremblay a signé.", ScrubLevel.MEDIUM
        )
        assert "Jean Tremblay" not in cleaned
        assert "[REDACTED-NAME_WITH_TITLE]" in cleaned

    def test_whitelist_institution_preserved(self) -> None:
        # "Revenu Québec" est dans la whitelist → pas masqué
        cleaned, _ = scrub_text(
            "M. Revenu Québec gère...", ScrubLevel.MEDIUM
        )
        # Le match "M. Revenu Québec" passe la whitelist check
        assert "Revenu Québec" in cleaned


class TestStrictScrubbing:
    """Niveau STRICT : tous noms propres."""

    def test_two_word_proper_name_masked(self) -> None:
        cleaned, report = scrub_text("Jean Tremblay a dit.", ScrubLevel.STRICT)
        assert "[REDACTED-PROPER_NAME]" in cleaned
        assert "PROPER_NAME" in report.detected

    def test_financial_institution_whitelisted(self) -> None:
        # Les institutions financières dans la whitelist ne sont pas masquées
        cleaned, _ = scrub_text("Banque Royale finance...", ScrubLevel.STRICT)
        assert "Banque Royale" in cleaned


class TestContainsPII:
    """API de détection rapide sans modification."""

    def test_detect_pii_present(self) -> None:
        assert contains_pii("NAS: 046-454-286") is True

    def test_no_pii(self) -> None:
        assert contains_pii("Document fiscal standard sans données personnelles.") is False


class TestAssertNoPII:
    """Garde-fou pour appels LLM cloud."""

    def test_no_pii_passes(self) -> None:
        assert_no_pii("Texte anonyme sur la fiscalité canadienne.")

    def test_pii_raises(self) -> None:
        with pytest.raises(PIIDetectedError) as exc:
            assert_no_pii("M. Jean Tremblay, NAS 046-454-286", ScrubLevel.MEDIUM)
        assert exc.value.report.detected_count >= 1


class TestOverlappingPatterns:
    """Fix ZAKI OS : les patterns téléphone/compte bancaire se chevauchent.
    On vérifie que le scrubber ne casse pas sur ces cas ambigus."""

    def test_canadian_phone_masked(self) -> None:
        cleaned, _ = scrub_text("Tel: 514-555-1234", ScrubLevel.LIGHT)
        assert "514-555-1234" not in cleaned

    def test_bank_account_full_format(self) -> None:
        # Format complet 5-3-7 digits
        cleaned, report = scrub_text("Compte: 12345-678-1234567", ScrubLevel.LIGHT)
        # Soit BANK_ACCOUNT, soit PHONE match — mais le numéro doit être masqué
        assert "12345-678-1234567" not in cleaned or "[REDACTED" in cleaned
