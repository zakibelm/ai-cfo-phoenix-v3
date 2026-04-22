# Interface d'Injection de Connaissance — Spec v1.0

> **Statut** : Spec courte pour la nouvelle page `KnowledgeBase.tsx`
> **Prérequis** : `AI-CFO-KVF-ADAPTATION-SPEC-v1.0.md` (le module Factory consomme cette KB)
> **Cible** : remplacer / enrichir le couple actuel `Upload.tsx` + `RAG.tsx`
> **Date** : 2026-04-20

---

## 1. Contexte et constat

L'AI CFO Suite v2 a déjà une mécanique d'injection de documents (`Upload.tsx`) qui pousse vers une base RAG explorée par `RAG.tsx`. Cette mécanique fonctionne pour le mode chat (Playground) — mais **manque les attributs nécessaires** pour servir efficacement le pipeline CFO Knowledge Factory que nous venons de spécifier.

Concrètement, à la fin d'un upload aujourd'hui, on a :
- nom du fichier, statut, date, agents assignés (vide par défaut), tags auto-détectés depuis le nom

Ce qui manque pour le mode Factory :
- **Domaine métier** (Fiscalité QC / IFRS 16 / Audit interne / M&A / etc.) — actuellement deviné depuis le nom du fichier, pas fiable
- **Année fiscale de référence** (essentiel pour les taux et seuils)
- **Sensibilité** (public / professionnel / confidentiel-client) — pour aiguiller vers Ollama local en mode confidentiel
- **Type de document** (loi, bulletin, rapport client, norme, manuel interne, jurisprudence)
- **Références réglementaires citées** (`regulatory_refs[]`)
- **Indicateur d'usage Factory** : combien de runs Factory ont consommé ce doc, dernier run, vault produit

## 2. Principe directeur

Une seule page `pages/KnowledgeBase.tsx` qui **remplace** la combinaison actuelle Upload + RAG, structurée en 3 vues navigables :

```
┌─────────────────────────────────────────────────────┐
│ Knowledge Base                                       │
│ ┌─────────┬──────────┬─────────────────────────┐    │
│ │ Inject  │ Explorer │ Used in Factory runs    │    │
│ └─────────┴──────────┴─────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

- **Inject** : drop + métadonnées + assignation agents + lancement ingestion
- **Explorer** : table filtrable de la KB avec actions (assigner agents, mettre à jour métadonnées, supprimer, démarrer un run Factory)
- **Used in Factory runs** : vue inverse — par run, quels documents ont été consommés (traçabilité audit-grade)

## 3. Workflow d'ingestion — flux à 4 étapes

```
[Étape 1] DROP
  Drop ou sélection de N fichiers (PDF/DOCX/XLSX/CSV/TXT/MD/PPTX/images)
       │
       ▼
[Étape 2] MÉTADONNÉES BULK
  Un seul formulaire qui s'applique à TOUS les fichiers sélectionnés :
    - Domaine (autocomplete avec liste fermée + free-text)
    - Année fiscale (input number, défaut = année courante)
    - Sensibilité (radio : public / professionnel / confidentiel-client)
    - Type de document (select : loi / bulletin / norme / rapport client / manuel / jurisprudence / autre)
    - Tags additionnels (input chips)
    - Agents assignés (AgentCheckboxSelector déjà existant)
       │
       ▼
[Étape 3] AFFINEMENT PAR FICHIER (optionnel — collapse par défaut)
  Pour chaque fichier individuellement :
    - Override des champs précédents si différent
    - Visibilité d'un aperçu textuel (premières 500 chars après extraction)
       │
       ▼
[Étape 4] INGESTION
  Affichage progressif comme aujourd'hui (file-progress-list)
  → POST /api/knowledge/ingest avec FormData + JSON metadata
  → Back : extraction texte + embedding HF + INSERT cfo_knowledge_docs
  → Toast succès + redirection vers Explorer
```

## 4. Schéma DB — extension du schéma RAG existant

Nouvelle table `cfo_knowledge_docs` (ne casse pas la table `documents` existante — peut coexister ou la remplacer progressivement) :

```sql
CREATE TABLE cfo_knowledge_docs (
  doc_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename          TEXT NOT NULL,
  filepath          TEXT NOT NULL,            -- chemin sur disque
  file_size_bytes   BIGINT,
  file_type         TEXT,                     -- extension normalisée
  mime_type         TEXT,

  -- Métadonnées finance-specific
  domaine           TEXT NOT NULL,            -- ex: "Fiscalité QC"
  fiscal_year       INTEGER,                  -- ex: 2026
  sensibilite       TEXT NOT NULL DEFAULT 'professionnel'
                    CHECK (sensibilite IN ('public','professionnel','confidentiel-client')),
  doc_type          TEXT NOT NULL
                    CHECK (doc_type IN ('loi','bulletin','norme','rapport-client',
                                        'manuel-interne','jurisprudence','autre')),
  regulatory_refs   TEXT[] DEFAULT '{}',      -- articles, bulletins cités
  tags              TEXT[] DEFAULT '{}',
  agents_assigned   TEXT[] DEFAULT '{}',      -- noms d'agents de data/agents.ts
  client_id         UUID,                     -- NULL si non client-specific

  -- Status d'ingestion
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','extracting','embedding','indexed','failed')),
  status_message    TEXT,

  -- Contenu extrait
  text_content      TEXT,                     -- texte brut extrait
  text_excerpt      TEXT,                     -- premières 500 chars pour preview
  embedding         VECTOR(1024),

  -- Usage tracking
  used_in_runs      TEXT[] DEFAULT '{}',      -- run_ids des cfo_runs qui l'ont consommé
  last_used_at      TIMESTAMPTZ,
  use_count         INTEGER DEFAULT 0,

  -- Versioning léger
  parent_doc_id     UUID REFERENCES cfo_knowledge_docs(doc_id),
  version           INTEGER DEFAULT 1,

  uploaded_by       TEXT,                     -- user / API token
  uploaded_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_kb_domaine     ON cfo_knowledge_docs(domaine);
CREATE INDEX idx_kb_sensibilite ON cfo_knowledge_docs(sensibilite);
CREATE INDEX idx_kb_year        ON cfo_knowledge_docs(fiscal_year);
CREATE INDEX idx_kb_agents      ON cfo_knowledge_docs USING GIN (agents_assigned);
CREATE INDEX idx_kb_regulatory  ON cfo_knowledge_docs USING GIN (regulatory_refs);
CREATE INDEX idx_kb_tags        ON cfo_knowledge_docs USING GIN (tags);
CREATE INDEX idx_kb_embedding   ON cfo_knowledge_docs
  USING ivfflat (embedding vector_cosine_ops) WITH (nlist = 100);
```

## 5. Endpoints back à créer

```
POST   /api/knowledge/ingest          # FormData (files) + JSON (metadata bulk)
GET    /api/knowledge/list            # filtres : ?domaine=&sensibilite=&agent=&year=&q=
GET    /api/knowledge/{doc_id}        # détail + excerpt
PATCH  /api/knowledge/{doc_id}        # update métadonnées (agents, tags, etc.)
DELETE /api/knowledge/{doc_id}        # soft delete recommandé
POST   /api/knowledge/start-factory-run  # body : doc_ids[] + run_config → crée un cfo_run mode client
GET    /api/knowledge/{doc_id}/runs   # liste des runs Factory ayant consommé ce doc
```

## 6. Composant React — structure

```
pages/KnowledgeBase.tsx
├── components/kb/
│   ├── KbTabs.tsx                     # navigation 3 onglets
│   ├── KbInject.tsx                   # workflow 4 étapes
│   │   ├── Dropzone (réutilise styles upload-dropzone)
│   │   ├── BulkMetadataForm
│   │   ├── PerFileRefinement (collapse)
│   │   └── IngestionProgress (réutilise file-progress-list)
│   ├── KbExplorer.tsx                 # table filtrable
│   │   ├── KbFilters (domaine / année / sensibilité / agent / search)
│   │   ├── KbTable (rows avec agents, status, used_in_runs)
│   │   └── KbActions (modal édition, démarrer run Factory)
│   └── KbFactoryUsage.tsx             # vue inversée par run
└── (réutilise Banner, Toast, AgentCheckboxSelector existants)
```

## 7. Compatibilité avec l'existant

- **Pages actuelles** : `Upload.tsx` et `RAG.tsx` peuvent **rester** en place (mode "legacy") jusqu'à la migration complète. Une bannière "Cette page sera remplacée par Knowledge Base — essayer la nouvelle interface" peut pointer vers `/knowledge-base`.
- **Type `Document`** existant : étendu en `KnowledgeDoc` (nouveau type plus riche). Une fonction `documentToKnowledgeDoc()` permet de migrer les docs existants.
- **`apiService.ts`** : nouvelles fonctions `kbIngest()`, `kbList()`, `kbUpdate()`, etc. sans casser `uploadFiles()`.
- **`AgentCheckboxSelector`** : réutilisé tel quel.
- **Classes CSS** : on réutilise au maximum (`upload-dropzone`, `ingestion-config-card`, `file-progress-list`, `status-badge`) ; on ajoute quelques nouvelles classes (`kb-tabs`, `kb-table`, `kb-filter-bar`, `kb-metadata-form`).

## 8. Connexion avec le module Factory

Une fois la KB peuplée, le mode **Client** du Factory (cf. `AI-CFO-KVF-ADAPTATION-SPEC-v1.0.md` section 11) consomme les docs ainsi :

```
[KnowledgeBase Explorer] → user sélectionne N docs
  → bouton "Démarrer un run Factory"
    → ouvre formulaire Factory pré-rempli avec :
       MODE              = "client"
       DOMAINE           = domaine commun des docs sélectionnés (ou "Multi-domaine")
       SENSIBILITE       = max(sensibilité des docs)
       DOCUMENTS_SOURCES = [doc_id_1, doc_id_2, ...]
    → user complète MANDAT, NB_PAGES_CIBLE, BUDGET, etc.
    → POST /api/cfo-kf/launch
```

Le pipeline Z-Kernel injecte alors les docs comme contexte RAG au FactCheckAgent + VaultWriters via les embeddings pgvector.

## 9. Roadmap

| Sprint | Livrable |
|---|---|
| 1 | Migration DB (`cfo_knowledge_docs`) + endpoint `/api/knowledge/ingest` + extraction texte (réutilise `services/textExtraction` existant) + embedding HF |
| 2 | Composant React `KnowledgeBase.tsx` + `KbInject.tsx` + connexion ingest |
| 3 | `KbExplorer.tsx` + filtres + endpoint `/api/knowledge/list` + edit modal |
| 4 | `KbFactoryUsage.tsx` + bouton "Démarrer run Factory" + intégration avec module Factory |

---

*Spec courte produite en complément de AI-CFO-KVF-ADAPTATION-SPEC-v1.0.md*
