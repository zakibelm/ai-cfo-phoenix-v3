# Configuration OCR pour Images (PNG, JPEG, etc.)

## Support des formats

L'application peut maintenant extraire du texte depuis les formats suivants :

### Images
- PNG
- JPEG / JPG
- BMP
- TIFF
- GIF

### PDF scannés (images)
- PDF contenant uniquement des images (sans texte extractible)
- PDF mixtes (texte + images)

## Dépendances requises

### 1. Bibliothèques Python
```bash
pip install Pillow pytesseract
```

### 2. Moteur Tesseract OCR

#### Windows
```powershell
winget install --id UB-Mannheim.TesseractOCR -e
```

Ou téléchargez depuis : https://github.com/UB-Mannheim/tesseract/wiki

#### Linux (Ubuntu/Debian)
```bash
sudo apt-get install tesseract-ocr tesseract-ocr-fra
```

#### macOS
```bash
brew install tesseract tesseract-lang
```

## Configuration

Le chemin de Tesseract est configuré automatiquement dans `main.py` :
- **Windows**: `C:\Program Files\Tesseract-OCR\tesseract.exe`
- **Linux/Mac**: Détecté automatiquement

## Langues supportées

Par défaut, l'OCR utilise :
- **Français** (fra)
- **Anglais** (eng)

Pour ajouter d'autres langues :
```python
# Dans main.py, ligne 188
text = pytesseract.image_to_string(image, lang='fra+eng+ara')  # Ajouter arabe
```

## Utilisation

### Upload pour RAG
Uploadez simplement vos images PNG/JPEG dans l'explorateur de documents RAG. Le texte sera extrait automatiquement.

### Analyse dans le Chat
Utilisez le bouton 📤 pour uploader une image et l'analyser avec l'agent AI.

## Limitations

- **Qualité de l'image** : Une meilleure résolution = meilleure extraction
- **Images sans texte** : Si l'image contient uniquement des graphiques/diagrammes, l'OCR retournera un avertissement
- **Taille maximale** : 200MB par fichier (configurable dans `main.py`)

## Dépannage

### Erreur "Tesseract not found"
Vérifiez que Tesseract est installé et que le chemin est correct dans `main.py`.

### Texte mal reconnu
- Augmentez la résolution de l'image
- Améliorez le contraste
- Assurez-vous que le texte est horizontal

### Performance
L'OCR peut être lent sur de grandes images. Considérez redimensionner les images très grandes avant l'upload.
