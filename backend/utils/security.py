"""
Utilitaires de sécurité pour l'AI CFO Suite.
Centralise la validation, la sanitisation et les contrôles d'accès.
"""
import os
import re
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────────
# Sanitisation des noms de fichiers (path traversal prevention)
# ─────────────────────────────────────────────────────────────────────────────

# Caractères autorisés dans un nom de fichier
_SAFE_FILENAME_RE = re.compile(r"[^\w\s\-.()\[\]]+", re.UNICODE)

def sanitize_filename(filename: str) -> str:
    """
    Nettoie un nom de fichier pour prévenir les attaques par traversée de chemin.

    - Supprime les composants de chemin (../, ..\\ etc.)
    - Supprime les caractères non autorisés
    - Tronque à 255 caractères (limite système)
    - Retourne 'unnamed_file' si le résultat est vide

    Examples:
        >>> sanitize_filename("../../etc/passwd")
        'passwd'
        >>> sanitize_filename("..\\\\windows\\\\system32")
        'system32'
        >>> sanitize_filename("rapport_Q4 2024.pdf")
        'rapport_Q4 2024.pdf'
    """
    if not filename:
        return "unnamed_file"

    # 1. Extraire uniquement le basename (supprime tout composant de chemin)
    name = os.path.basename(filename)

    # 2. Normaliser les séparateurs Windows
    name = name.replace("\\", "/")
    name = name.split("/")[-1]

    # 3. Supprimer les caractères de contrôle et spéciaux dangereux
    name = _SAFE_FILENAME_RE.sub("_", name)

    # 4. Supprimer les points en début de nom (fichiers cachés Unix)
    name = name.lstrip(".")

    # 5. Tronquer si trop long
    name = name[:255]

    return name if name else "unnamed_file"


def is_safe_path(base_dir: Path, target_path: Path) -> bool:
    """
    Vérifie qu'un chemin cible est bien contenu dans le répertoire de base.
    Empêche les attaques par traversée de chemin même après sanitisation.

    Args:
        base_dir: Répertoire de base autorisé (ex: UPLOAD_DIR)
        target_path: Chemin à valider

    Returns:
        True si le chemin est sûr, False sinon
    """
    try:
        base_resolved = base_dir.resolve()
        target_resolved = target_path.resolve()
        return str(target_resolved).startswith(str(base_resolved))
    except (OSError, ValueError):
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Validation des extensions de fichiers autorisées
# ─────────────────────────────────────────────────────────────────────────────

ALLOWED_EXTENSIONS = {
    # Documents
    "pdf", "docx", "doc", "pptx", "ppt",
    # Tableurs
    "xlsx", "xls", "csv",
    # Texte et données
    "txt", "json", "xml", "md", "log",
    # Images
    "png", "jpg", "jpeg", "bmp", "tiff", "gif",
    # Autres
    "rtf", "odt", "ods", "odp",
}


def is_allowed_file_type(filename: str) -> bool:
    """Vérifie que l'extension du fichier est autorisée."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ext in ALLOWED_EXTENSIONS


# ─────────────────────────────────────────────────────────────────────────────
# Validation de la clé API
# ─────────────────────────────────────────────────────────────────────────────

def validate_api_key(api_key: str | None) -> bool:
    """
    Vérifie qu'une clé API a un format minimal valide.
    Ne remplace pas une validation côté OpenRouter, mais évite
    d'envoyer des valeurs manifestement invalides.
    """
    if not api_key:
        return False
    # Les clés OpenRouter commencent par "sk-or-"
    if not api_key.startswith("sk-"):
        return False
    return not len(api_key) < 20
