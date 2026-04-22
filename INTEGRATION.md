# Intégration CFO Knowledge Factory + Knowledge Base — Guide

> Ce document décrit comment activer les nouveaux modules **Knowledge Base** et **CFO Knowledge Factory** intégrés à l'AI CFO Suite v2.

---

## 1. Vue d'ensemble des changements

### Nouveaux fichiers

**Frontend** (`pages/`, `components/`)
- `pages/KnowledgeBase.tsx` — page d'injection et gestion KB (3 onglets)
- `pages/Factory.tsx` — page de pilotage du pipeline Factory (lancement + runs)
- `components/icons/KnowledgeBaseIcon.tsx`
- `components/icons/FactoryIcon.tsx`

**Backend** (`backend/`)
- `backend/agent_prompts_factory.py` — prompts spécifiques au pipeline Factory
- `backend/kb_storage.py` — couche persistence (Supabase ou fallback JSON local)
- `backend/kb_ingest.py` — ingestion fichiers + extraction texte + embedding HF
- `backend/z_kernel.py` — machine d'états + orchestration agents
- `backend/cfo_kf_routes.py` — router FastAPI avec tous les endpoints `/api/knowledge/*` et `/api/cfo-kf/*`

**Database** (`supabase/migrations/`)
- `supabase/migrations/20260420_cfo_kvf_schema.sql` — 4 tables + 2 fonctions pgvector

**Documentation** (racine)
- `AI-CFO-KVF-ADAPTATION-SPEC-v1.0.md` — spec d'architecture détaillée
- `KB-INJECTION-INTERFACE-SPEC.md` — spec interface KB
- `INTEGRATION.md` — ce document

### Fichiers modifiés (intégration)

- `types.ts` — ajout des entrées d'enum `Page.KNOWLEDGE_BASE` et `Page.FACTORY`
- `App.tsx` — import + routing des deux nouvelles pages
- `components/Sidebar.tsx` — nouvelles entrées de navigation
- `styles.css` — bloc CSS premium (~600 lignes) ajouté à la fin
- `backend/main.py` — import du `cfo_kf_router`

---

## 2. Installation — étapes dans l'ordre

### 2.1 Dépendances Python additionnelles

Ajouter au `requirements.txt` du back (ou à `backend/requirements.txt`) :

```
httpx>=0.27.0          # déjà présent normalement
supabase>=2.0.0        # uniquement si SUPABASE_URL est utilisé
```

Puis :
```bash
cd backend
pip install supabase httpx
```

> Note : `supabase` est optionnel. Sans Supabase, la KB stocke en JSON local dans `backend/data/cfo_kf/`.

### 2.2 Variables d'environnement

Ajouter dans le fichier `.env` à la racine du projet :

```bash
# OpenRouter (déjà présent normalement)
OPENROUTER_API_KEY=sk-or-...

# Hugging Face — pour embeddings (recommandé, gratuit)
# Token : https://huggingface.co/settings/tokens
HF_API_TOKEN=hf_...

# Supabase — optionnel (sinon fallback JSON local)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJ...
```

> Sans `HF_API_TOKEN` : l'ingestion fonctionne mais les docs ne sont pas indexés vectoriellement (le similarity search est désactivé).
> Sans `SUPABASE_URL` : tout est stocké en JSON dans `backend/data/cfo_kf/`. Pratique pour le dev.

### 2.3 Migration Supabase (si applicable)

Si vous utilisez Supabase :

**Option A — via SQL Editor de Supabase**
1. Ouvrir Supabase Studio → SQL Editor
2. Coller le contenu de `supabase/migrations/20260420_cfo_kvf_schema.sql`
3. Exécuter

**Option B — via Supabase CLI**
```bash
npx supabase db push
```

**Option C — via psql direct**
```bash
psql -h db.xxx.supabase.co -U postgres -d postgres -f supabase/migrations/20260420_cfo_kvf_schema.sql
```

### 2.4 Démarrage

```bash
# Tout en un (concurrent)
npm start

# Ou séparément
npm run dev:backend   # FastAPI sur :8000
npm run dev           # Vite sur :5173
```

Au démarrage, le back affiche normalement :
```
[INFO] CFO Knowledge Factory router mounted at /api/knowledge/* and /api/cfo-kf/*
```

---

## 3. Utilisation

### 3.1 Page Knowledge Base — `/knowledge-base`

**Onglet Injecter** : workflow 4 étapes
1. Dropzone — sélection fichiers
2. Métadonnées en lot (domaine, année fiscale, sensibilité, type, tags, agents)
3. Affinage par fichier (optionnel)
4. Ingestion (extraction + embedding + insert DB)

**Onglet Explorer** : table filtrable de tous les docs ingérés. Sélection multi → bouton **"Démarrer un run Factory →"** qui ouvre une modale pré-remplie.

**Onglet Usage en Factory** : vue inversée — pour chaque run Factory, quels documents ont été consommés.

### 3.2 Page Factory — `/factory`

**Onglet Lancer un run** : formulaire complet
- Toggle Mode Factory (vault réutilisable) vs Client (dossier confidentiel)
- Domaine, mandat, description
- Pages cibles, budget €, temps max min
- Niveau de rigueur (grand-public / professionnel / audit-grade)
- Sensibilité (avec bascule auto vers Ollama local en confidentiel-client)
- Agents actifs (cochables — défaut : 8 agents pertinents)
- Mode Pilot (CP1+CP2) ou Production (CP1 seul)

**Onglet Runs** : liste live avec polling 5s tant qu'un run est actif
- Métriques visuelles : barres de progression Pages / Budget / Qualité
- Bandeau jaune pulsant quand un checkpoint humain est en attente (CP1 ou CP2)
- Boutons GO / CORRIGE / AJUSTE / STOP qui déclenchent la transition d'état
- Cliquer un run → expand qui affiche la machine d'états visuelle (animation GSAP)

---

## 4. Endpoints exposés

| Méthode | Endpoint | Usage |
|---|---|---|
| POST | `/api/knowledge/ingest` | Multi-files + métadonnées (FormData) |
| GET | `/api/knowledge/list` | Liste avec filtres `?domaine=&year=&agent=&q=` |
| GET | `/api/knowledge/{doc_id}` | Détail d'un doc |
| PATCH | `/api/knowledge/{doc_id}` | Update métadonnées |
| DELETE | `/api/knowledge/{doc_id}` | Suppression |
| POST | `/api/knowledge/start-factory-run` | Bridge KB → Factory mode Client |
| GET | `/api/knowledge/{doc_id}/runs` | Runs ayant consommé ce doc |
| POST | `/api/cfo-kf/launch` | Lancer un nouveau run |
| GET | `/api/cfo-kf/runs` | Liste des runs |
| GET | `/api/cfo-kf/runs/{run_id}` | Détail d'un run |
| POST | `/api/cfo-kf/checkpoint` | Décision humaine CP1 ou CP2 |

---

## 5. Architecture technique

### Frontend
- React 18 + TypeScript + Vite (existant inchangé)
- **GSAP 3.13** déjà présent — utilisé pour entrées de page, transitions d'onglet, modales, machine d'états
- Composants réutilisés : `Banner`, `Toast`, `AgentCheckboxSelector`, icônes existantes
- Design : dark premium avec gradients linéaires, glass morphism, animations subtiles, responsive 600/900px

### Backend
- FastAPI existant + nouveau router `cfo_kf_router`
- Persistence : double mode Supabase / JSON local — bascule auto via env vars
- LLM : OpenRouter pour les agents, HF Inference API pour embeddings
- Z-Kernel : machine d'états async avec hooks pour resume après checkpoint humain

### Pipeline (résumé)
```
PLANNED → BOOTSTRAPPING → MAPPING → CP1 → PILOT_WRITING → PILOT_QA → CP2
       → FULL_WRITING → LINKING → AUDITING → COMPLIANCE_CHECK → DEBRIEFING → COMPLETED
```

Voir `AI-CFO-KVF-ADAPTATION-SPEC-v1.0.md` pour le détail des 17 états et du mapping rôles KVF → 10 agents CFO.

---

## 6. Sécurité — couche conformité Loi 25 / CPA

**Cette section est CRITIQUE avant tout test avec un dossier client réel.**

### 6.1 Trois couches de protection

L'application applique automatiquement 3 niveaux de protection selon le champ `sensibilite` du run :

| Sensibilité | Routage LLM | Scrubbing PII | Embeddings | Logs |
|---|---|---|---|---|
| `public` | Cloud (OpenRouter) | LIGHT (NAS, email, CB, téléphone) | HF API | standards |
| `professionnel` | Cloud (OpenRouter) | MEDIUM (+ noms titrés type "M. Untel") | HF API | standards |
| `confidentiel-client` | **Ollama local OBLIGATOIRE** | STRICT (+ tous noms propres) | Ollama local | anonymisés |

L'enforcement se fait dans `backend/z_kernel.py` → `call_llm()`. En mode `confidentiel-client`, **aucun appel cloud n'est possible** — si Ollama est down, le run échoue plutôt que de fuir vers le cloud.

### 6.2 Configuration Ollama (requise pour mode confidentiel-client)

```bash
# Installer Ollama : https://ollama.ai
# Une fois installé :
ollama serve                          # démarre le service local
ollama pull qwen2.5-coder:7b          # ~4GB — modèle principal
ollama pull mxbai-embed-large         # ~670MB — embeddings 1024d (compat pgvector)
```

Variables d'environnement (`.env`) :
```
OLLAMA_HOST=http://localhost:11434
OLLAMA_DEFAULT_MODEL=qwen2.5-coder:7b
OLLAMA_TIMEOUT=120
```

### 6.3 RLS Supabase — application obligatoire

La migration `supabase/migrations/20260420_cfo_kvf_rls.sql` doit être appliquée APRÈS le schema principal. Elle :

- Active RLS sur `cfo_knowledge_docs`, `cfo_runs`, `cfo_steps`, `cfo_pages`
- Ajoute des colonnes `user_id` (rattachement à `auth.users`)
- Crée des policies SELECT/INSERT/UPDATE/DELETE par utilisateur authentifié
- Permet la lecture des docs publics (`user_id IS NULL AND sensibilite='public'`)
- Crée la table `cfo_audit_log` pour la traçabilité Loi 25

**IMPORTANT** : le backend FastAPI doit utiliser la **`SERVICE_ROLE_KEY`** Supabase (et NON l'`anon_key`) pour bypass RLS lors des opérations système. Cette clé reste **côté serveur uniquement**, jamais exposée au front.

```bash
# .env (à la racine)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=<service_role_key>      # ← bypass RLS, JAMAIS exposé au front
```

### 6.4 Sans Supabase

Si tu n'utilises pas Supabase (mode JSON local), RLS ne s'applique pas. Le mode JSON local ne convient **PAS** pour de la production multi-utilisateur ni pour des données client réelles. Il est destiné au dev/test sur ton poste uniquement.

### 6.5 PII detection — usage du module

```python
from security_pii import scrub_text, ScrubLevel, contains_pii, assert_no_pii

# Vérifier si du PII est présent (sans modifier)
if contains_pii(text, level=ScrubLevel.MEDIUM):
    log.warn("PII détectée")

# Nettoyer + obtenir le rapport
cleaned, report = scrub_text(text, level=ScrubLevel.STRICT)
print(report.summary())  # "3 entité(s) PII détectée(s) : EMAIL(2), NAS(1)"

# Garde-fou (lève une exception si PII détectée)
assert_no_pii(text, level=ScrubLevel.MEDIUM)
```

Patterns détectés : NAS canadien (avec validation Luhn), email, téléphones CA, cartes de crédit (16 chiffres), comptes bancaires CA, BN entreprise, code postal CA, IP, date de naissance, noms titrés (M./Mme/Dr), tous noms propres (mode STRICT).

### 6.6 Indicateur visuel front

Quand un run tourne en `confidentiel-client`, un badge rouge **🔒 Confidentiel — local** apparaît sur la carte du run dans la page Factory. Le formulaire de lancement affiche aussi un bandeau d'avertissement explicatif quand l'utilisateur sélectionne ce niveau.

---

## 7. Limitations actuelles (MVP)

Cette intégration est **fonctionnellement complète** mais certaines parties sont volontairement simplifiées :

- **z_kernel.py** : la phase MAPPING fait un vrai appel LLM via FinanceAgent (avec enforcement de sensibilité). Les phases PILOT_WRITING / FULL_WRITING / LINKING / AUDITING / COMPLIANCE_CHECK / DEBRIEFING sont des transitions d'état avec sleep simulés. À compléter pour la prod en branchant les vraies boucles d'écriture, EVV, et linking — l'enforcement de sensibilité sera appliqué automatiquement via `call_llm()`.
- **Embeddings** : HF Inference API gratuit (rate-limit ~1000 req/jour). Pour la prod, basculer sur Ollama `mxbai-embed-large` (1024d compatible pgvector) ou endpoint HF dédié.
- **Streaming temps réel** : actuellement le front polle `/api/cfo-kf/runs` toutes les 5s. À remplacer par SSE `/api/cfo-kf/runs/{run_id}/stream` pour de la vraie progression live.
- **Auth Supabase côté front** : le front doit envoyer le JWT user dans les headers de toutes les requêtes vers le back, et le back doit transmettre `user_id` dans les inserts. Cette propagation n'est pas encore implémentée — à brancher.

---

## 7. Tests rapides après installation

```bash
# Health check
curl http://localhost:8000/health

# Vérifier que le router KF est monté
curl http://localhost:8000/api/cfo-kf/runs
# Retour attendu : {"runs": []}

# Test d'ingest
curl -X POST http://localhost:8000/api/knowledge/ingest \
  -F "files=@chemin/vers/un.pdf" \
  -F 'bulk_metadata={"domaine":"Fiscalité QC","fiscal_year":2026,"sensibilite":"professionnel","doc_type":"bulletin","tags":[],"agents_assigned":[]}' \
  -F 'per_file_refinements={}'

# Lister la KB
curl http://localhost:8000/api/knowledge/list

# Lancer un run Factory
curl -X POST http://localhost:8000/api/cfo-kf/launch \
  -H "Content-Type: application/json" \
  -d '{"mode":"factory","domaine":"Fiscalité QC","mandat":"Test TPS","nb_pages_cible":10,"budget_max_eur":5,"temps_max_min":30}'
```

Côté front : ouvrir `http://localhost:5173`, cliquer **Knowledge Base** dans la sidebar, tester l'upload.

---

## 8. Rollback / désactivation

Si tu veux désactiver temporairement les nouveaux modules sans rien désinstaller :

1. Dans `App.tsx` : commenter les `case Page.KNOWLEDGE_BASE` et `case Page.FACTORY` du switch
2. Dans `components/Sidebar.tsx` : commenter les deux nouvelles entrées du tableau `navLinks`
3. Dans `backend/main.py` : commenter le bloc `app.include_router(cfo_kf_router)`

Aucun fichier existant n'a été remplacé — uniquement étendu. Les pages `Upload.tsx` et `RAG.tsx` (legacy) restent fonctionnelles.

---

*Dernière mise à jour : 2026-04-20*
