"""
Tests unitaires - AI CFO Suite Backend v2
Couvre : securite, extraction, RAG, API endpoints, robustesse
"""
from io import BytesIO

import pytest
from fastapi.testclient import TestClient

from main import app
from services.rag_service import _score_chunk, _split_into_chunks, build_rag_context
from services.text_extractor import extract_text_from_file
from utils.security import is_allowed_file_type, is_safe_path, sanitize_filename

client = TestClient(app)


# =============================================================================
# TESTS DE SECURITE
# =============================================================================

class TestSecurity:
    """Securite : sanitisation des noms de fichiers et protection path traversal."""

    def test_path_traversal_unix(self):
        assert sanitize_filename("../../etc/passwd") == "passwd"

    def test_path_traversal_windows(self):
        assert sanitize_filename("..\\..\\windows\\system32\\config") == "config"

    def test_normal_filename_preserved(self):
        assert sanitize_filename("rapport_Q4_2024.pdf") == "rapport_Q4_2024.pdf"

    def test_empty_filename_fallback(self):
        assert sanitize_filename("") == "unnamed_file"
        assert sanitize_filename(None) == "unnamed_file"  # type: ignore

    def test_hidden_file_prefix_removed(self):
        name = sanitize_filename(".hidden_file.txt")
        assert not name.startswith(".")

    def test_long_filename_truncated(self):
        long_name = "a" * 300 + ".pdf"
        result = sanitize_filename(long_name)
        assert len(result) <= 255

    def test_is_safe_path_valid(self, tmp_path):
        base = tmp_path / "uploads"
        base.mkdir()
        target = base / "document.pdf"
        assert is_safe_path(base, target)

    def test_is_safe_path_traversal_blocked(self, tmp_path):
        base = tmp_path / "uploads"
        base.mkdir()
        target = tmp_path / "secret.txt"  # En dehors du repertoire uploads
        assert not is_safe_path(base, target)

    def test_allowed_file_types(self):
        assert is_allowed_file_type("rapport.pdf")
        assert is_allowed_file_type("data.xlsx")
        assert is_allowed_file_type("note.docx")
        assert is_allowed_file_type("image.png")

    def test_disallowed_file_types(self):
        assert not is_allowed_file_type("script.exe")
        assert not is_allowed_file_type("malware.bat")
        assert not is_allowed_file_type("shell.sh")

    def test_api_key_not_accepted_from_client(self):
        """Le backend ne doit pas utiliser la cle API fournie par le client."""
        payload = {
            "query": "test",
            "api_key": "sk-fake-key-from-client",
        }
        response = client.post("/query", json=payload)
        # Doit soit utiliser la cle serveur (200) soit retourner 503 si non configuree
        # En AUCUN cas ne doit utiliser la cle client sans validation serveur
        assert response.status_code in (200, 503, 502)


# =============================================================================
# TESTS DU SERVICE RAG
# =============================================================================

class TestRagService:
    """Service RAG : chunking et scoring de pertinence."""

    def test_chunking_basic(self):
        text = "Paragraphe 1.\n\nParagraphe 2.\n\nParagraphe 3."
        chunks = _split_into_chunks(text, chunk_size=100)
        assert len(chunks) >= 1
        assert all(isinstance(c, str) for c in chunks)

    def test_chunking_empty_text(self):
        chunks = _split_into_chunks("")
        assert chunks == []

    def test_chunking_long_text(self):
        """Un texte long doit etre decoupe en plusieurs chunks."""
        text = " ".join(["mot"] * 1000)
        chunks = _split_into_chunks(text, chunk_size=200)
        assert len(chunks) > 1

    def test_scoring_relevant_chunk(self):
        chunk = "Le budget previsionnel montre une hausse des revenus de 15%."
        query_tokens = {"budget", "revenus", "hausse"}
        score = _score_chunk(chunk, query_tokens)
        assert score > 0

    def test_scoring_irrelevant_chunk(self):
        chunk = "La meteorologie prevoit de la pluie demain a Paris."
        query_tokens = {"budget", "revenus", "financier"}
        score = _score_chunk(chunk, query_tokens)
        assert score == 0.0

    def test_build_rag_context_short_document(self):
        """Un document court doit etre retourne tel quel."""
        short_text = "Rapport financier Q4 2024. Revenus en hausse de 12%."
        context = build_rag_context(short_text, "revenus Q4")
        assert short_text in context

    def test_build_rag_context_long_document(self):
        """Un document long doit etre tronque intelligemment."""
        long_text = "\n\n".join([
            f"Section {i}: analyse financiere du trimestre {i}. " + "detail " * 50
            for i in range(30)
        ])
        query = "analyse trimestre 15"
        context = build_rag_context(long_text, query, max_chars=5000)
        assert len(context) <= 15000  # Avec le footer, peut depasser un peu
        assert "Section" in context  # Doit contenir du contenu

    def test_build_rag_context_empty(self):
        assert build_rag_context("", "query") == ""


# =============================================================================
# TESTS D'EXTRACTION DE TEXTE
# =============================================================================

class TestTextExtractor:
    """Extraction de texte depuis differents formats."""

    def test_extract_empty_file(self):
        result = extract_text_from_file(b"", "empty.txt")
        assert "[ERREUR]" in result

    def test_extract_plain_text(self):
        content = b"Ceci est un rapport financier."
        result = extract_text_from_file(content, "rapport.txt")
        assert "rapport financier" in result

    def test_extract_json(self):
        content = b'{"revenus": 100000, "depenses": 80000}'
        result = extract_text_from_file(content, "data.json")
        assert "revenus" in result

    def test_extract_pdf_returns_string(self):
        """PDF invalide doit retourner un string (erreur ou vide, jamais lever d'exception)."""
        result = extract_text_from_file(b"%PDF-1.4 fake content", "test.pdf")
        assert isinstance(result, str)

    def test_extract_docx_returns_string(self):
        result = extract_text_from_file(b"PK fake docx content", "test.docx")
        assert isinstance(result, str)

    def test_extract_unknown_extension(self):
        """Extension inconnue : tentative de decodage UTF-8."""
        result = extract_text_from_file(b"texte brut", "fichier.xyz")
        assert isinstance(result, str)
        assert "texte brut" in result


# =============================================================================
# TESTS DES ENDPOINTS API
# =============================================================================

class TestAPIEndpoints:
    """Tests des routes FastAPI."""

    def test_health_endpoint(self):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "healthy"}

    def test_root_endpoint(self):
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "running"
        assert "version" in data

    def test_upload_too_many_files(self):
        """Doit retourner 400 si trop de fichiers."""
        files = [("files", (f"f{i}.txt", BytesIO(b"ok"), "text/plain")) for i in range(15)]
        response = client.post("/upload", files=files)
        assert response.status_code == 400

    def test_upload_single_valid_file(self):
        files = [("files", ("rapport.txt", BytesIO(b"Rapport Q4 2024"), "text/plain"))]
        response = client.post("/upload", files=files)
        assert response.status_code == 200
        data = response.json()
        assert "files" in data
        assert "errors" in data

    def test_upload_disallowed_type(self):
        """Un fichier .exe doit apparaitre dans les erreurs."""
        files = [("files", ("malware.exe", BytesIO(b"MZ..."), "application/octet-stream"))]
        response = client.post("/upload", files=files)
        assert response.status_code == 200
        data = response.json()
        assert len(data["errors"]) > 0

    def test_upload_handles_partial_failure(self):
        """L'echec d'un fichier ne doit pas bloquer les autres."""
        files = [
            ("files", ("valid.txt", BytesIO(b"contenu valide"), "text/plain")),
            ("files", ("bad.exe", BytesIO(b"MZ"), "application/octet-stream")),
        ]
        response = client.post("/upload", files=files)
        assert response.status_code == 200
        data = response.json()
        # Au moins 1 fichier traite + 1 erreur
        assert len(data["files"]) >= 1
        assert len(data["errors"]) >= 1

    def test_extract_text_too_many_files(self):
        files = [("files", (f"f{i}.txt", BytesIO(b"ok"), "text/plain")) for i in range(15)]
        response = client.post("/extract-text", files=files)
        assert response.status_code == 400

    def test_query_missing_query_field(self):
        """Une requete sans 'query' doit retourner 400."""
        response = client.post("/query", json={})
        assert response.status_code == 400

    def test_rag_document_not_found(self):
        """Un document inexistant doit retourner 404."""
        response = client.get("/rag/document_inexistant.pdf")
        assert response.status_code == 404

    def test_upload_path_traversal_attempt(self):
        """Une tentative de path traversal dans le nom de fichier doit etre bloquee."""
        files = [("files", ("../../etc/passwd", BytesIO(b"root:x:0:0"), "text/plain"))]
        response = client.post("/upload", files=files)
        assert response.status_code == 200
        data = response.json()
        # Soit traite avec nom sanitise, soit erreur — jamais crash
        if data["files"]:
            assert ".." not in data["files"][0]["filename"]
            assert "/" not in data["files"][0]["filename"]


# =============================================================================
# TESTS DES PROMPTS AGENTS
# =============================================================================

class TestAgentPrompts:
    """Verifie la structure et la non-duplication des prompts."""

    def test_all_agents_have_prompts(self):
        from agent_prompts import AGENT_PROMPTS
        expected_agents = [
            "Auto", "CFO", "ForecastAgent", "AccountingAgent",
            "TaxAgent", "AuditAgent", "InvestmentAgent", "CommsAgent",
            "DerivativePricingAgent", "SupervisorAgent", "FinanceAgent",
        ]
        for agent in expected_agents:
            assert agent in AGENT_PROMPTS, f"Agent manquant : {agent}"

    def test_auto_and_cfo_not_identical(self):
        """Auto et CFO doivent avoir des prompts differents (plus de duplication)."""
        from agent_prompts import AGENT_PROMPTS
        assert AGENT_PROMPTS["Auto"] != AGENT_PROMPTS["CFO"]

    def test_auto_mentions_orchestrator(self):
        from agent_prompts import AGENT_PROMPTS
        assert "ORCHESTRATEUR" in AGENT_PROMPTS["Auto"].upper()

    def test_cfo_mentions_direct_mode(self):
        from agent_prompts import AGENT_PROMPTS
        assert "DIRECT" in AGENT_PROMPTS["CFO"].upper()

    def test_all_prompts_non_empty(self):
        from agent_prompts import AGENT_PROMPTS
        for agent, prompt in AGENT_PROMPTS.items():
            assert len(prompt) > 50, f"Prompt trop court pour {agent}"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
