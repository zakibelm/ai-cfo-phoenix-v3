# 📚 Déploiement des Documents RAG par Défaut

Ce guide explique comment configurer les documents RAG et leurs assignations d'agents comme données par défaut de l'application.

## 🎯 Objectif

Les documents RAG configurés seront automatiquement présents dans toutes les nouvelles installations et après déploiement, avec leurs assignations d'agents.

## 📋 Étapes

### 1. Configurer vos documents

1. Ouvrez l'application en mode développement : `npm run dev`
2. Allez dans **Base RAG**
3. Téléversez tous vos documents RAG
4. Assignez les agents appropriés à chaque document
5. Testez que tout fonctionne correctement

### 2. Exporter la configuration

#### Option A : Via le script (Recommandé)

1. Ouvrez la console du navigateur (F12)
2. Copiez tout le contenu de `scripts/exportRagDocuments.js`
3. Collez-le dans la console et appuyez sur Entrée
4. Le code TypeScript sera copié dans votre presse-papiers
5. Ouvrez `data/defaultRagDocuments.ts`
6. Remplacez le tableau vide par le code copié

#### Option B : Manuellement

1. Ouvrez la console du navigateur (F12)
2. Exécutez :
   ```javascript
   console.log(JSON.stringify(JSON.parse(localStorage.getItem('ai-cfo-suite-documents')), null, 2))
   ```
3. Copiez le résultat
4. Ouvrez `data/defaultRagDocuments.ts`
5. Formatez comme ceci :
   ```typescript
   export const defaultRagDocuments: Document[] = [
     // Collez ici le JSON copié
   ];
   ```

### 3. Sauvegarder les fichiers uploadés

Les fichiers uploadés sont dans `backend/uploads/`. Pour le déploiement :

1. **Gardez le dossier `backend/uploads/`** avec tous les fichiers `.extracted.txt`
2. Ces fichiers contiennent le contenu extrait des documents
3. Ajoutez-les au contrôle de version :
   ```bash
   git add backend/uploads/*.extracted.txt
   ```

### 4. Vérifier la configuration

1. Effacez le localStorage du navigateur :
   ```javascript
   localStorage.clear()
   ```
2. Rechargez la page (Ctrl+Shift+R)
3. Vérifiez que vos documents apparaissent avec leurs assignations

## 📦 Structure des fichiers

```
ai-cfo-suite/
├── data/
│   ├── defaultRagDocuments.ts    # Métadonnées et assignations
│   └── mockData.ts                # Import des documents par défaut
├── backend/
│   └── uploads/                   # Fichiers et contenus extraits
│       ├── document1.pdf.extracted.txt
│       ├── document2.docx.extracted.txt
│       └── ...
└── scripts/
    └── exportRagDocuments.js      # Script d'export
```

## 🚀 Déploiement

### Frontend

Les documents par défaut sont automatiquement intégrés au build :
```bash
npm run build
```

### Backend

Assurez-vous que le dossier `uploads/` est déployé avec les fichiers `.extracted.txt` :

```bash
# Dockerfile example
COPY backend/uploads/ /app/uploads/
```

Ou pour Vercel/Netlify, incluez le dossier dans la configuration de build.

## ⚠️ Important

- **NE PAS** committer de fichiers sensibles ou confidentiels
- Les documents deviennent publics dans le code source
- Utilisez uniquement des documents de référence/exemples
- Pour des données privées, utilisez le système d'upload normal

## 🔄 Mise à jour

Pour mettre à jour les documents par défaut :

1. Répétez les étapes 1-4
2. Commitez les changements :
   ```bash
   git add data/defaultRagDocuments.ts backend/uploads/*.extracted.txt
   git commit -m "Update default RAG documents"
   ```

## 📝 Exemple de configuration

```typescript
export const defaultRagDocuments: Document[] = [
  {
    id: 'doc-guide-comptabilite-1234567890',
    name: 'Guide Comptabilité IFRS.pdf',
    status: 'Traité',
    uploaded: '2025-01-06',
    agents: ['AccountingAgent', 'TaxAgent'],
    tags: ['Comptabilité', 'Fiscalité', 'IFRS'],
    content: 'Fichier stocké : uploads/Guide Comptabilité IFRS.pdf (234.5 KB)'
  },
  {
    id: 'doc-procedures-audit-9876543210',
    name: 'Procédures Audit.docx',
    status: 'Traité',
    uploaded: '2025-01-06',
    agents: ['AuditAgent', 'SupervisorAgent'],
    tags: ['Audit', 'Conformité'],
    content: 'Fichier stocké : uploads/Procédures Audit.docx (128.3 KB)'
  }
];
```

## ✅ Checklist de déploiement

- [ ] Documents RAG uploadés et testés
- [ ] Agents assignés correctement
- [ ] Configuration exportée vers `defaultRagDocuments.ts`
- [ ] Fichiers `.extracted.txt` présents dans `backend/uploads/`
- [ ] Test avec localStorage vide
- [ ] Build frontend réussi
- [ ] Backend configuré pour servir les fichiers uploads
