# AI CFO Suite v2 — Adaptation de l'Architecture ZAKI OS / KVF
## Spécification v1.0 — Draft pour validation

> **Statut** : Proposition d'architecture — à valider avant toute modification de code
> **Base de référence** : `ZAKI-OS-KVF-SPEC-v2.0-FINAL.md` (pipeline Knowledge Vault Factory)
> **Cible** : AI CFO Suite v2 (React 18 + FastAPI + Supabase + OpenRouter + Gemini)
> **Principe directeur** : réutiliser le **squelette d'orchestration KVF** et **ré-affecter les 10 agents CFO existants** (sans introduire les agents KVF originaux)
> **Auteur** : Architecture AI CFO
> **Date** : 2026-04-20

---

## TABLE DES MATIÈRES

**PARTIE A — CADRE STRATÉGIQUE**
- [0. Executive Summary](#0-executive-summary)

**PARTIE B — SPÉCIFICATION TECHNIQUE**
1. [Positionnement et stack AI CFO](#1-positionnement-et-stack-ai-cfo)
2. [Variables d'entrée adaptées](#2-variables-dentrée-adaptées)
3. [Machine d'états Z-Kernel CFO](#3-machine-détats-z-kernel-cfo)
4. [Architecture logique — 3 couches CFO](#4-architecture-logique--3-couches-cfo)
5. [Mapping rôles KVF → agents CFO](#5-mapping-rôles-kvf--agents-cfo)
6. [Missions adaptées par agent CFO](#6-missions-adaptées-par-agent-cfo)
7. [Router multi-modèles CFO](#7-router-multi-modèles-cfo)
8. [EVV Pattern appliqué au contexte financier](#8-evv-pattern-appliqué-au-contexte-financier)
9. [Schéma de base de données (extension du schéma CFO existant)](#9-schéma-de-base-de-données)
10. [Pipeline d'orchestration FastAPI natif](#10-pipeline-dorchestration-fastapi-natif)
11. [Deux modes d'exploitation — Factory et Client](#11-deux-modes-dexploitation--factory-et-client)
12. [System prompts adaptés des 10 agents CFO](#12-system-prompts-adaptés-des-10-agents-cfo)
13. [Format CFO-Run-Stats.json](#13-format-cfo-run-statsjson)
14. [Critères de DONE — finance-specific](#14-critères-de-done--finance-specific)
15. [Roadmap d'implémentation](#15-roadmap-dimplémentation)

---

# PARTIE A — CADRE STRATÉGIQUE

---

## 0. Executive Summary

### 0.1 Constat de départ — AI CFO Suite aujourd'hui

L'AI CFO Suite v2 repose sur un **pattern conversationnel** (Playground + RAG) avec 10 agents spécialisés qui répondent à la volée aux questions de l'utilisateur. C'est un excellent **outil d'assistance** — mais il reproduit le plafond identifié par KVF dans un autre contexte :

- **Aucune mémoire structurée** du cheminement d'une analyse complexe (un dossier audité aujourd'hui ne nourrit pas l'analyse de demain)
- **Aucun contrôle budgétaire** sur les appels LLM (coût imprévisible dès qu'un dossier client devient volumineux)
- **Aucun checkpoint humain** obligatoire (pas de "garde-fou" entre une suggestion d'un agent et son intégration dans un livrable)
- **Aucune gouvernance** sur la qualité (rien ne force la vérification d'une entité fiscale sensible — numéro TPS, date d'échéance, chiffre-clé d'un bilan)
- **Pas de livrable structuré** (les analyses restent dans le chat, non réutilisables)

### 0.2 Transformation conceptuelle

```
Avant (v2 actuelle) : "Un chat avec des agents financiers spécialisés"
                      → Outil d'assistance conversationnelle

Après (v3 proposé)  : "Un pipeline AI CFO orchestré par états,
                       avec checkpoints comptables, mémoire vectorielle,
                       contrôle qualité (normes CPA/IFRS), budget borné,
                       et capacité de produire des livrables structurés
                       réutilisables (vaults financiers)"
                      → Système de production d'analyse financière
```

L'adaptation KVF ne remplace pas le mode chat. Elle **ajoute un second mode** d'exploitation — industriel, gouverné, produisant des artefacts — qui coexiste avec le mode conversationnel existant.

### 0.3 Les 3 propriétés systémiques — traduites au contexte CFO

**Résilience financière**
Un run d'analyse (ex : due-diligence sur un dossier M&A de 200 pages) peut s'interrompre à l'étape d'audit, reprendre sans perte, et logger chaque décision — utile pour une trace d'audit CPA, pour justifier une conclusion à un associé, ou pour répondre à une question de l'ARQ/CRA sur la méthodologie.

**Gouvernance comptable**
Budget, temps et qualité sont des contraintes dures. Aucun livrable ne peut atteindre le statut `VALIDÉ` avec une entité fiscale `invented` ou une contradiction CRITIQUE non résolue. Les checkpoints humains CP1 (validation du plan d'analyse) et CP2 (validation du pilote) sont obligatoires en **mode Pilot** — le mode par défaut pour un nouveau client ou un nouveau type de mandat.

**Mémoire exploitable**
Chaque page produite porte son `run_id`, son `embedding_id`, son `quality_score`, son `fact_check_level`. La connaissance produite (ex : synthèse IFRS 16 sur les contrats de location) devient un **actif** réutilisable par les autres modules : le RAG existant, les prochains dossiers clients, la formation des juniors du cabinet.

### 0.4 Positionnement dans la suite AI CFO

Le module adapté est nommé **CFO Knowledge Factory (CFO-KF)** — sans préjudice du nom final. Il s'insère comme une nouvelle page (`pages/Factory.tsx`) à côté du Dashboard, du RAG et du Playground existants, et **réutilise les 10 agents déjà définis dans `data/agents.ts`** sans en créer de nouveaux.

| Module destinataire | Usage du vault CFO-KF |
|---|---|
| **RAG existant** (`pages/RAG.tsx`) | Indexation auto des vaults produits dans la base RAG |
| **Playground** (`pages/Playground.tsx`) | Les agents puisent dans les vaults pour leurs réponses conversationnelles |
| **Dashboard** (`pages/Dashboard.tsx`) | KPI de qualité des vaults, coûts cumulés, runs actifs |
| **AgentManagement** (`pages/AgentManagement.tsx`) | Supervision des runs et ajustement des system prompts |

### 0.5 Logique d'évolution en 3 phases

```
Phase 1 — Pilot CFO (MVP, 4–6 semaines)
  1 mode (Factory OU Client) · 1 cluster métier · 20–40 pages
  CP1 + CP2 obligatoires · réutilise Supabase + pgvector existants
  Objectif : valider le flow complet sur un cas réel (ex : fiscalité QC)

Phase 2 — Production CFO (après 2–3 runs pilote réussis)
  Factory + Client simultanés · multi-clusters · CP1 seul si paramètres stables
  Agents parallélisés · mémoire vectorielle cross-clients
  Intégration RAG : les vaults produits enrichissent automatiquement la base

Phase 3 — CFO Factory Autonome (horizon 6–9 mois)
  Le CFO (orchestrateur) déclenche des runs proactivement
  (ex : à la veille de la saison fiscale → run automatique sur les mises à jour
  des bulletins CRA/ARQ de l'année en cours)
  Feedback loop : les livrables validés nourrissent les prochains runs
```

### 0.6 Ce que ce module n'est pas

Il n'est ni un chat, ni un moteur de veille temps réel, ni un remplaçant du Playground. C'est un **compilateur d'analyse financière structurée**, conçu pour produire des livrables durables (vaults) à partir d'un mandat donné — avec un niveau de rigueur paramétrable (grand-public / professionnel / audit-grade) et une gouvernance bornée.

### 0.7 Principe de non-prolifération d'agents

**Règle invariante de cette adaptation** : aucun nouvel agent n'est créé. Les 10 agents déjà déclarés dans `data/agents.ts` (CFO, ForecastAgent, AccountingAgent, TaxAgent, AuditAgent, InvestmentAgent, CommsAgent, DerivativePricingAgent, SupervisorAgent, FinanceAgent) sont chacun **ré-affectés** à un rôle du pipeline. Les agents KVF originaux (ClusterPlanner, VaultWriter, FactCheckAgent, LinkerAgent, AuditAgent KVF, DebriefAgent) servent **uniquement de référence conceptuelle** pour comprendre les rôles à couvrir.

---

# PARTIE B — SPÉCIFICATION TECHNIQUE

---

## 1. Positionnement et Stack AI CFO

### 1.1 Définition

CFO Knowledge Factory (CFO-KF) est un **module d'orchestration agentique** intégré à l'AI CFO Suite v2 dont la mission est de compiler des analyses financières structurées (dossier client, synthèse réglementaire, due-diligence, etc.) et de les produire sous forme de **vault CFO** — un dossier structuré navigable, machine-readable, et extensible en RAG.

Ce n'est pas un prompt ni un agent supplémentaire. C'est un **pipeline orchestré par états** qui fait collaborer les 10 agents existants, avec mémoire structurelle, contrôle qualité adapté au contexte CPA, routing multi-modèles réutilisant le système OpenRouter actuel, checkpoints humains obligatoires, et gouvernance budget/temps.

### 1.2 Stack cible (réutilise l'existant autant que possible)

| Composant | Rôle | Implémentation |
|---|---|---|
| **Frontend React 18 + TS** | UI du module (page Factory) | Réutilise `App.tsx`, ajouter `pages/Factory.tsx` |
| **Backend FastAPI (Python)** | Orchestrateur Z-Kernel-CFO | Étendre `backend/main.py` avec un module `z_kernel.py` |
| **OpenRouter** | Routing multi-LLM (déjà intégré) | `services/geminiClient.ts` + `backend/` côté serveur |
| **Gemini API** | Fallback et validate EVV | Déjà utilisé dans `services/geminiService.ts` |
| **Supabase + pgvector** | Mémoire, embeddings, runs, pages | Étendre le schéma RAG existant |
| **PostgreSQL** | Tables `cfo_runs`, `cfo_steps`, `cfo_pages` | Migrations Supabase |
| **Hugging Face API** | Embeddings `intfloat/multilingual-e5-large` | Nouvelle dépendance |
| **Filesystem workspace utilisateur** | Rendu physique des vaults `.md` | Mapping vers workspace Cowork |
| **n8n (optionnel Phase 2)** | Orchestration visuelle avancée | Optionnel — Phase 1 reste 100% FastAPI |

### 1.3 Identité du module

```
Nom          : cfo-knowledge-factory
Route API    : POST /api/cfo-kf/launch
Namespace DB : cfo_runs, cfo_steps, cfo_pages
Chemin logs  : workspace/{run_id}/99-Meta/
Frontend     : /factory (nouvelle route App.tsx)
```

### 1.4 Compatibilité avec l'existant

Aucune rupture avec le code actuel :
- `agentDetails` dans `data/agents.ts` — inchangé (pas d'ajout ni de retrait d'agent)
- `AGENT_PROMPTS` dans `backend/agent_prompts.py` — **prompts existants conservés** pour le mode Playground ; nouveaux prompts **spécifiques au mode Factory** ajoutés sous une clé distincte (`AGENT_PROMPTS_FACTORY`)
- Page `Playground.tsx` — inchangée
- Page `RAG.tsx` — légère extension pour afficher les vaults produits

---

## 2. Variables d'Entrée Adaptées

Variables obligatoires et optionnelles transmises au lancement d'un run via la page Factory ou l'API.

```yaml
# ─────────────────────────────────────────────
# OBLIGATOIRES — contexte métier
# ─────────────────────────────────────────────
MODE:                     "factory"        # factory | client
DOMAINE:                  "Fiscalité QC"   # ex : Fiscalité QC | IFRS 16 | M&A | Audit interne
MANDAT:                   "Synthèse TPS/TVQ commerce de détail 2026"
DESCRIPTION_MANDAT:       "Compilation des règles applicables aux détaillants physiques
                           et en ligne, avec focus sur les seuils, les exemptions, et
                           les obligations de perception."
CHEMIN_VAULT:             "workspace/cfo-vaults/tpsvq-detaillants-2026"
NB_PAGES_CIBLE:           30                # 20-80 en mode pilot

# ─────────────────────────────────────────────
# EN MODE CLIENT UNIQUEMENT
# ─────────────────────────────────────────────
CLIENT_ID:                "uuid-client"    # référence dans cfo_clients
DOCUMENTS_SOURCES:        ["doc_id_1", "doc_id_2"]   # docs RAG existants à analyser

# ─────────────────────────────────────────────
# QUALITÉ ET OBJECTIF
# ─────────────────────────────────────────────
NIVEAU_RIGUEUR:           "professionnel"   # grand-public | professionnel | audit-grade
OBJECTIF_VAULT:           "synthèse"        # formation | synthèse | avis-technique | dossier-audit

# ─────────────────────────────────────────────
# BUDGET ET TEMPS
# ─────────────────────────────────────────────
BUDGET_MAX_EUR:           15
TEMPS_MAX_MIN:            90

# ─────────────────────────────────────────────
# MODÈLES — auto = router CFO décide
# ─────────────────────────────────────────────
MODELE_PLANIFICATION:     "auto"
MODELE_REDACTION:         "auto"
MODELE_FACTCHECK:         "auto"
MODELE_AUDIT:             "auto"

# ─────────────────────────────────────────────
# SORTIE
# ─────────────────────────────────────────────
MODE_SORTIE:              "vault+json-index"   # vault-only | vault+json-index
LANGUE:                   "fr"

# ─────────────────────────────────────────────
# SÉCURITÉ — sensibilité des données
# ─────────────────────────────────────────────
SENSIBILITE_DONNEES:      "professionnel"   # public | professionnel | confidentiel-client

# ─────────────────────────────────────────────
# CONTRÔLE QUALITÉ
# ─────────────────────────────────────────────
SEUIL_TO_VERIFY_MAX:      6     # max pages "to-verify" avant arrêt automatique
DENSITE_LIENS_CIBLE:      7     # objectif liens inter-pages / page
SEUIL_QUALITE_PILOTE:     7.5   # score EVV minimum sur les pages pilotes

# ─────────────────────────────────────────────
# BATCHES
# ─────────────────────────────────────────────
BATCH_SIZE:               6     # pages par batch en FULL_WRITING
PAGES_PILOTE:             6     # pages du lot pilote (CP2)
```

### 2.1 Différences notables vs KVF original

- `SUJET`/`CLUSTER_CHOISI` → `DOMAINE`/`MANDAT` (plus parlant pour un CPA)
- `SENSIBILITE_DONNEES` : nouveau niveau `confidentiel-client` (implique Loi 25 stricte, PII-free, Ollama local obligatoire pour tout LLM)
- `NIVEAU_RIGUEUR` : échelle financière (grand-public = conseil pro actif ; audit-grade = niveau production de dossier d'audit ISA/CPA)
- `OBJECTIF_VAULT` : finalité financière (`avis-technique` = mémoire fiscale citant la Loi ; `dossier-audit` = dossier PBC avec traçabilité complète)

---

## 3. Machine d'États Z-Kernel CFO

### 3.1 Flux nominal (identique KVF + 1 état métier)

```
PLANNED
  └─► BOOTSTRAPPING          (validation variables, création run, check RAG dispo)
        └─► MAPPING          (FinanceAgent génère Plan-Analyse.md)
              └─► WAITING_APPROVAL_CP1      (checkpoint humain obligatoire)
                    ├─► [GO]      PILOT_WRITING
                    ├─► [CORRIGE] retour MAPPING
                    └─► [STOP]    FAILED

PILOT_WRITING
  └─► PILOT_QA               (EVV sur les 6 pages pilotes)
        └─► WAITING_APPROVAL_CP2      (checkpoint humain obligatoire)
              ├─► [GO]      FULL_WRITING
              ├─► [AJUSTE]  retour PILOT_WRITING
              └─► [STOP]    FAILED

FULL_WRITING
  └─► LINKING                (AccountingAgent densifie les liens inter-pages)
        └─► AUDITING         (SupervisorAgent génère Audit.md)
              └─► COMPLIANCE_CHECK   ★ NOUVEAU — spécifique CFO
                    └─► DEBRIEFING   (ForecastAgent génère Debrief.md)
                          └─► COMPLETED
```

### 3.2 Nouvel état `COMPLIANCE_CHECK` — rationale

Avant de clôturer le run, le SupervisorAgent exécute une **check-list réglementaire finance-specific** :

- Aucune recommandation financière **prescriptive** sans la mention du CPA responsable
- Toute référence à un article de loi (LIR, LTVQ, IFRS, NCECF) a été vérifiée et citée correctement
- Aucune PII n'apparaît dans les pages en mode `confidentiel-client`
- Les chiffres clés (taux de TPS/TVQ, seuils 2026, taux d'imposition) correspondent à l'année de référence déclarée
- Aucune page "audit-grade" ne contient de source `invented` ou `debated`

Si cette check échoue → retour `FULL_WRITING` avec corrections, ou `WAITING_HUMAN_REVIEW` si seuil d'escalade atteint.

### 3.3 Table des transitions automatiques (adaptée CFO)

| Condition | État actuel | Transition |
|---|---|---|
| Plan incohérent (score < 6.0) | MAPPING | → MAPPING (retry, max 2) |
| Plan incohérent après 2 retries | MAPPING | → WAITING_HUMAN_REVIEW |
| Score moyen pilote < 7.5 | PILOT_QA | → PILOT_WRITING (retry, max 1) |
| Score moyen pilote < 7.5 après retry | PILOT_QA | → WAITING_HUMAN_REVIEW |
| Budget > 80% du max | ANY | → WAITING_HUMAN_REVIEW |
| Budget > 100% du max | ANY | → FAILED |
| Temps > TEMPS_MAX_MIN | ANY | → WAITING_HUMAN_REVIEW |
| pages_to_verify > SEUIL_TO_VERIFY_MAX | FULL_WRITING | → WAITING_HUMAN_REVIEW |
| error_rate > 20% sur un batch | FULL_WRITING | → WAITING_HUMAN_REVIEW |
| **Entité fiscale `invented` détectée** | ANY | → WAITING_HUMAN_REVIEW (jamais auto-fix) |
| **Article de loi non vérifiable** | FULL_WRITING | → flag + retry FactCheck niveau supérieur |
| API OpenRouter KO 3× consécutifs | ANY | → fallback Gemini direct, puis FAILED |
| Erreur filesystem | ANY | → RETRYING |

---

## 4. Architecture Logique — 3 Couches CFO

### Couche 1 — Entrée utilisateur (React)

Page `pages/Factory.tsx` (nouvelle) : formulaire de lancement avec `AgentCheckboxSelector` pour cocher les agents actifs sur le run. Validation côté client des variables obligatoires. `POST /api/cfo-kf/launch` déclenche la création du run.

Alternative : API directe `POST /api/cfo-kf/launch` pour les intégrations externes.

### Couche 2 — Orchestrateur Z-Kernel CFO (FastAPI)

Nouveau module Python `backend/z_kernel.py` responsable de :
- Décider quel agent lance quelle tâche et dans quel ordre (routage interne)
- Appliquer les règles du router multi-modèles (réutilise `services/geminiClient.ts` logic côté back)
- Évaluer les conditions de transition d'état à chaque pas
- Déclencher les checkpoints humains (notification UI in-app + optionnel e-mail/Slack)
- Monitorer budget et temps en continu
- Logger chaque décision dans `cfo_steps` et `Decisions.md`

### Couche 3 — Agents spécialisés (10 agents CFO existants)

Les 10 agents gardent leur identité financière. Chacun reçoit une **mission secondaire** dans le pipeline — détaillée en section 6. Aucun nouvel agent n'est créé. Les prompts sont étendus, pas remplacés.

---

## 5. Mapping Rôles KVF → Agents CFO

La matrice ci-dessous est la **pièce centrale** de l'adaptation : elle dit, pour chaque rôle fonctionnel du pipeline KVF, **quel(s) agent(s) CFO l'occupe(nt)**, avec la justification.

| Rôle KVF (référence) | Mission dans le pipeline | Agent CFO affecté | Justification |
|---|---|---|---|
| **Orchestrator (n8n + Z-Kernel)** | Piloter le run, router, monitorer budget, déclencher checkpoints | **CFO (Auto mode)** | Déjà orchestrateur dans la suite — `AGENT_PROMPTS["Auto"]` le positionne en coordinateur |
| **ClusterPlanner** | Analyser le mandat et produire le Plan-Analyse.md | **FinanceAgent** | Rôle stratégique global — `Planification et Analyse Stratégique` déjà dans `agents.ts` |
| **FactCheckAgent (général)** | Vérifier entités, chiffres, dates, citations | **AuditAgent** | Son rôle natif est la détection d'incohérences |
| **FactCheckAgent (fiscal)** | Vérifier les références fiscales (articles LIR, LTVQ, bulletins CRA/ARQ) | **TaxAgent** | Expertise fiscale native — seul à citer les bulletins correctement |
| **VaultWriter (rédacteur principal)** | Rédiger les pages denses du vault | **CommsAgent** | Rôle natif = produire rapports et synthèses |
| **VaultWriter (finance avancée)** | Rédiger les pages techniques (VAN, TRI, Greeks, dérivés) | **InvestmentAgent** + **DerivativePricingAgent** | Seuls à maîtriser les calculs avancés |
| **VaultWriter (comptabilité)** | Rédiger les pages écritures/NCECF/IFRS | **AccountingAgent** | Expertise native grand livre |
| **LinkerAgent** | Optimiser les liens inter-pages (wikilinks, cross-références) | **AccountingAgent** | Maintient la cohérence des références (logique "grand livre") — bonus : peut maintenir un index de type "plan comptable" des pages |
| **AuditAgent KVF** (détection contradictions, QA final) | QA du vault complet, détection contradictions inter-pages | **SupervisorAgent** | Rôle natif `Assurance Qualité & Conformité` |
| **DebriefAgent** | Métriques finales + projections scaling | **ForecastAgent** | Rôle natif de projection — adapté aux projections ×5, ×10, ×20 |

### 5.1 Agents avec double rôle

Trois agents portent deux rôles :

- **AccountingAgent** → `FactCheck comptable` (vérification écritures, NCECF/IFRS) + `LinkerAgent` (cohérence des références inter-pages)
- **AuditAgent** → `FactCheck général` (entités, dates, chiffres) + participation au `COMPLIANCE_CHECK` final
- **TaxAgent** → `FactCheck fiscal` (articles de loi) + `VaultWriter` pour toute page type `avis-technique` fiscal

Cette double affectation est **acceptable** car les deux rôles sont séquentiels dans le pipeline — un agent ne porte jamais deux rôles en parallèle dans un même batch.

### 5.2 Pourquoi le CFO pilote et ne rédige pas

Dans le pipeline Factory, le CFO **n'est pas** le rédacteur principal. Son rôle est orchestrateur : il sélectionne l'agent pour chaque page selon le type, injecte le contexte, et applique les règles du router. Cette séparation est délibérée — elle préserve l'**anti-auto-validation EVV** (un CFO qui rédige ET valide crée un conflit d'intérêt méthodologique).

En mode Playground (chat classique), le CFO continue de répondre directement comme aujourd'hui — cette séparation ne concerne que le module Factory.

---

## 6. Missions Adaptées par Agent CFO

Chaque agent reçoit une **fiche mission** qui étend son rôle natif avec la dimension "pipeline Factory/Client". Cette fiche est le fondement des system prompts de la section 12.

### 6.1 CFO — Orchestrateur Z-Kernel

**Rôle pipeline** : Orchestrator + décisionnaire router
**Mission atomique** :
1. Valider les variables d'entrée à chaque transition d'état
2. Sélectionner l'agent pour la tâche courante selon le mapping (section 5) et la complexité
3. Appliquer le router multi-modèles (section 7)
4. Recalculer budget_used et budget_remaining_pct à chaque step
5. Déclencher les notifications checkpoints CP1/CP2
6. Produire `Decisions.md` — journal des arbitrages

**Inputs** : état courant du run, métriques cumulées, paramètres initiaux
**Outputs** : prochaine transition d'état, agent à solliciter, modèle à utiliser
**Budget** : ~5% du budget total du run

### 6.2 FinanceAgent — Planner stratégique

**Rôle pipeline** : ClusterPlanner
**Mission atomique** :
1. Analyser `DOMAINE`, `MANDAT`, `DESCRIPTION_MANDAT`
2. Produire exactement `NB_PAGES_CIBLE` entrées de plan avec : titre, **type financier** (voir 6.2.1), priorité 1–5, justification, alertes fact-check
3. Identifier les pages-ponts (connexions avec d'autres mandats ou domaines)
4. Signaler les zones réglementaires en évolution (ex : refonte d'une loi en cours)

**6.2.1 Types de pages — taxonomie financière (adaptée de KVF section 21)**

| Type | Définition |
|---|---|
| `concept` | Notion atomique (ex : "Crédit d'impôt RS&DE", "Dépréciation fiscale") |
| `règle` | Article de loi, bulletin, norme (ex : "Article 47 LIR", "NCECF 3855") |
| `procédure` | Démarche opérationnelle (ex : "Processus de production TPS/TVQ") |
| `cas-type` | Cas pratique documenté (ex : "M&A — actifs vs actions") |
| `critique` | Limites, risques, zones grises d'une règle |
| `modèle-calcul` | Tableau, formule, algorithme (ex : "Calcul VAN après impôt") |
| `synthèse` | Vue transversale d'un sous-domaine |
| `page-pont` | Connecte deux domaines (ex : "Fiscalité et IFRS") |

**EVV seuil** : 7.0 (structure du plan validée par un modèle ≠ planner)

### 6.3 AuditAgent — FactCheck général + Compliance

**Rôle pipeline** : FactCheckAgent (général) + contributeur COMPLIANCE_CHECK
**Mission atomique** :
1. Extraire les entités vérifiables de chaque page : noms propres, dates, chiffres, citations, institutions, **chiffres financiers clés** (taux, seuils, montants)
2. Classer chaque entité : `low | medium | high`
3. Statuer : `verified | to-verify | debated | invented`
4. Au `COMPLIANCE_CHECK` final : parcourir l'ensemble des pages pour vérifier l'absence d'entité `invented` et la cohérence des dates/chiffres cross-pages

**Niveaux de risque — spécifique CFO**

| Type d'entité | Risque par défaut |
|---|---|
| Taux de TPS/TVQ/TVH par année | high |
| Seuils fiscaux (pension alimentaire, RÉER, CÉLI) | high |
| Noms de bulletins CRA / ARQ | medium |
| Articles de loi (numéro + année de version) | high |
| Dates d'échéance déclarative | high |
| Noms d'institutions (CPA Canada, ARQ, CRA) | low |
| Chiffres de cas-types (exemples) | medium |

**Règles strictes** : règles KVF section 5.2 appliquées, plus :
- Un taux fiscal ne peut être `verified` que si la référence au bulletin / à l'article est fournie
- Un article de loi cité sans numéro exact → `to-verify` systématique

### 6.4 TaxAgent — FactCheck fiscal + VaultWriter pages fiscales

**Rôle pipeline** : FactCheckAgent (fiscal spécialisé) + VaultWriter pour pages fiscales
**Mission atomique (FactCheck)** :
- Vérifier chaque citation de la LIR, LTVQ, LIQ, règlements
- Vérifier les bulletins et interprétations CRA/ARQ mentionnés
- Attribuer un `fact_check_level: deep` dès qu'un article de loi est référencé

**Mission atomique (VaultWriter)** :
- Rédiger les pages de type `règle` ou `cas-type` fiscaux
- Inclure obligatoirement : référence exacte à l'article, date de la version du texte, interprétations ARQ/CRA quand elles existent
- Signaler les zones grises (« dans l'attente d'une interprétation officielle »)

**Contraintes de rédaction** : min 700 mots (plus court que VaultWriter général car densité légale), ton juridique précis, aucune formulation molle, citation exacte des textes (entre guillemets).

### 6.5 AccountingAgent — FactCheck comptable + LinkerAgent

**Rôle pipeline** : FactCheckAgent (comptable) + LinkerAgent
**Mission atomique (FactCheck)** :
- Vérifier les écritures comptables : équilibre débit/crédit, imputation correcte
- Vérifier les références aux normes NCECF 1000–9999 et IFRS 1–17
- Flag toute écriture qui ne respecte pas le principe de la partie double

**Mission atomique (Linker)** :
Appliquer le pipeline KVF section 5.4 avec les adaptations suivantes :

Score de lien adapté :
```
link_score_cfo =
  0.40 × semantic_similarity
+ 0.25 × lexical_match
+ 0.20 × domain_proximity       (même domaine fiscal ou comptable)
+ 0.10 × norm_reference_overlap (pages citant la même norme)
+ 0.05 × opposition_or_complementarity

Seuil minimum : link_score_cfo ≥ 0.55
```

Règles de densité (adaptées au contexte CFO — moins dense que psychologie) :
```yaml
min_liens_per_page:      5
target_range:            [6, 10]
hard_max:                12
max_same_target_per_page: 2
```

### 6.6 CommsAgent — VaultWriter principal

**Rôle pipeline** : VaultWriter (rédacteur principal)
**Mission atomique** :
- Rédiger toute page qui n'est pas affectée à un rédacteur spécialisé (Tax/Accounting/Investment/Derivative)
- Respecter les contraintes KVF section 5.3 adaptées au contexte CFO
- Produire une synthèse exécutive pour toute page de type `synthèse`

**Contraintes de rédaction** :
- Min 800 mots corps (hors YAML et tableaux)
- Min 6 liens inter-pages contextuels
- Structure obligatoire : introduction → développement → nuances → applications (si `OBJECTIF_VAULT = formation | synthèse`)
- Ton : professionnel CPA, pédagogique sans être simpliste, tranché sur les questions tranchées
- Aucune formulation molle : bannir "il semblerait que", "certains pensent", "on pourrait dire"
- Langue : `LANGUE` intégral, termes anglais seulement si aucune traduction CPA admise

### 6.7 InvestmentAgent + DerivativePricingAgent — VaultWriters spécialisés

**Rôle pipeline** : VaultWriter pour pages techniques avancées
**Mission atomique** :
- **InvestmentAgent** : rédige toute page `modèle-calcul` VAN/TRI/payback, analyse de sensibilité, allocation de capital
- **DerivativePricingAgent** : rédige toute page `modèle-calcul` sur dérivés (options, swaps, forwards), couvertures, Greeks

**Contraintes supplémentaires** :
- Chaque formule est présentée avec ses hypothèses explicites
- Chaque calcul est reproduit en clair (tableau ou pseudo-code pas-à-pas)
- Aucune recommandation d'investissement sans avertissement réglementaire approprié
- Toute simulation Monte Carlo mentionne le nombre d'itérations et la graine si reproductible

### 6.8 SupervisorAgent — AuditAgent KVF + COMPLIANCE_CHECK

**Rôle pipeline** : AuditAgent (QA final) + pilote de l'état COMPLIANCE_CHECK
**Mission atomique (Audit)** :
1. Checks structurels (YAML, wordcount, backlinks, wikilinks fantômes, doublons sémantiques > 0.85)
2. Détection de contradictions inter-pages selon le pipeline KVF section 5.5
3. Classification CRITIQUE / MAJEUR / MINEUR
4. Production de `Audit.md`

**Mission atomique (Compliance)** :
Check-list finance-specific exécutée en état `COMPLIANCE_CHECK` :

```yaml
check_compliance_cfo:
  - aucune_pii_en_mode_confidentiel
  - taux_fiscaux_coherents_cross_pages
  - articles_de_loi_avec_numero_exact
  - aucune_page_audit_grade_avec_source_invented
  - mention_responsabilite_cpa_si_recommandation
  - date_version_des_textes_de_loi_presente
  - normes_citées_existent_reellement
```

Si toute la check-list passe → transition vers `DEBRIEFING`. Sinon → `WAITING_HUMAN_REVIEW` avec rapport détaillé des échecs.

### 6.9 ForecastAgent — DebriefAgent

**Rôle pipeline** : DebriefAgent
**Mission atomique** :
1. Calculer les métriques réelles (coût, temps, qualité, anomalies)
2. Comparer aux objectifs
3. Identifier le goulot d'étranglement
4. Projeter coût/temps pour ×5, ×10, ×20 pages
5. Recommander les ajustements paramétriques pour le mode Production
6. Évaluer la qualité globale du vault 1–10

**Spécificité CFO** : le ForecastAgent calcule aussi un **"coût par page validable CPA"** — combien coûte en moyenne une page qui atteint `audit-grade` sans intervention humaine. C'est le KPI clé pour décider du passage en Production.

**Outputs** : `Debrief.md` + `CFO-Run-Stats.json` (voir section 13)

---

## 7. Router Multi-Modèles CFO

### 7.1 Variables d'entrée (identiques KVF)

```json
{
  "task_type":              "planning | writing | factcheck | audit | linking | compliance | debrief",
  "complexity":             "low | medium | high",
  "criticality":            "low | medium | high",
  "budget_remaining_pct":   65.0,
  "quality_requirement":    "standard | high | audit-grade",
  "sensibilite":            "public | professionnel | confidentiel-client",
  "retry_count":            0,
  "current_model":          null
}
```

### 7.2 Hiérarchie par tâche (réutilise les modèles déjà configurés dans `data/agents.ts`)

#### Planning — FinanceAgent
```
Niveau 1 : google/gemini-2.0-flash           (rapide, plan structuré)
Niveau 2 : anthropic/claude-3.5-sonnet       (plan complexe multi-domaine)
Niveau 3 : anthropic/claude-3.5-sonnet (prompt renforcé)   ← plafond
Escalade si : score_plan < 6.0
```

#### Writing — CommsAgent / TaxAgent / AccountingAgent / InvestmentAgent / DerivativePricing
```
Niveau 1 : openai/gpt-4-turbo                 (rédaction standard — CommsAgent)
           anthropic/claude-3.5-sonnet        (rédaction technique — Tax/Accounting/Derivative)
           meta-llama/llama-3.1-70b-instruct  (rédaction légère — TaxAgent si pas audit-grade)
Niveau 2 : anthropic/claude-3.5-sonnet        (upgrade si qualité < 7.5)
Niveau 3 : anthropic/claude-3.5-sonnet (prompt renforcé) + contexte RAG étendu
Escalade si : quality_score < 7.5 OU words < 800 OU liens < 6
```

#### FactCheck — AuditAgent / TaxAgent
```
Niveau 1 : google/gemini-2.0-flash            (entités low-risk — AuditAgent)
Niveau 2 : meta-llama/llama-3.1-70b-instruct  (entités medium-risk — TaxAgent pour fiscal)
Niveau 3 : anthropic/claude-3.5-sonnet        (entités high-risk — articles de loi, chiffres sensibles)
Niveau 4 : marquage "to-verify" + log         ← pas d'escalade infinie
```

#### Audit/Compliance — SupervisorAgent
```
Niveau 1 : openai/gpt-4-turbo                 (déjà configuré pour SupervisorAgent)
Niveau 2 : anthropic/claude-3.5-sonnet        (contradictions complexes)
Plafond  : 2 niveaux max
```

#### Linking — AccountingAgent
```
Niveau 1 : anthropic/claude-3.5-sonnet        (déjà le modèle AccountingAgent)
Niveau 2 : google/gemini-2.0-flash            (fallback si budget serré)
Plafond  : 2 niveaux max
```

#### Debrief — ForecastAgent
```
Niveau 1 : openai/gpt-4-turbo                 (déjà le modèle ForecastAgent)
Niveau 2 : anthropic/claude-3.5-sonnet        (fallback qualité)
Plafond  : 2 niveaux max
```

#### Embeddings
```
Unique   : intfloat/multilingual-e5-large (HF API) — 1024 dims
Local    : Ollama mxbai-embed-large (1024 dims) si SENSIBILITE = confidentiel-client
→ Voir règles KVF section 7 inchangées
```

### 7.3 Règle spéciale SENSIBILITE = confidentiel-client (Loi 25 + secret professionnel CPA)

```yaml
si SENSIBILITE = confidentiel-client:
  interdire: ["OpenRouter cloud", "HuggingFace API", "webSearch"]
  forcer:    "Ollama local uniquement"
  embeddings: "générés localement (mxbai-embed-large)"
  logs:       "anonymisés obligatoirement"
  export:     "vault reste dans le workspace du CPA — pas d'export cloud"
  retention:  "purge automatique après 7 ans (obligation CPA) ou à la demande client"
```

### 7.4 Règles budget identiques KVF section 6.4 — rappel

```python
if budget_remaining_pct < 20:
    downgrade_to_free_models()
    disable_premium_escalation()
    limit_factcheck_to_high_risk_only()
    notify_user("⚠️ Budget < 20% — mode économique activé")

if budget_remaining_pct < 5:
    pause_full_writing()
    set_state("WAITING_HUMAN_REVIEW")
    notify_user("🛑 Budget < 5% — pause obligatoire")
```

---

## 8. EVV Pattern Appliqué au Contexte Financier

### 8.1 Vue d'ensemble (identique KVF section 8)

```
Input (Plan entry + run_context)
  │
  ▼
[EXECUTE] Agent rédacteur → raw page .md
  │
  ▼ (si structural KO)
[VERIFY]  FastAPI endpoint → checks automatiques ─────► retry Execute (max 2×)
  │ (si OK)
  ▼
[VALIDATE] Agent validateur (≠ agent rédacteur) → score 1–10
  │ (si score ≥ 7.5)                           │ (si score < 7.5)
  ▼                                             ▼
 Accept → écrire fichier .md            retry Execute avec feedback (max 1×)
```

### 8.2 Phase Verify — checks structurels finance-specific

| Check | Seuil | Action si KO |
|---|---|---|
| Nombre de mots | ≥ 700 (Tax) / ≥ 800 (autres) | retry avec prompt renforcé |
| Liens inter-pages | ≥ 5 | passer AccountingAgent (Linker) en priorité |
| YAML complet | tous champs | retry |
| Entités `invented` | 0 | flag + FactCheck obligatoire |
| **Référence articles de loi** (si présent) | numéro + année | flag + TaxAgent FactCheck |
| **Équilibre débit/crédit** (si écriture comptable) | débit = crédit | flag + AccountingAgent FactCheck |
| **Taux fiscal cité** (si présent) | référence au bulletin CRA/ARQ | flag + TaxAgent FactCheck |
| Fichier `.md` écrit | succès | retry filesystem (max 2×, délai 5s/15s) |

### 8.3 Phase Validate — paires Execute / Validate anti-auto-validation

```
Règle invariante : modèle validateur TOUJOURS différent du modèle rédacteur
```

**Paires pour pipeline CFO** :

| Agent rédacteur | Modèle rédacteur | Modèle validateur |
|---|---|---|
| CommsAgent | anthropic/claude-3.5-sonnet | google/gemini-2.0-flash |
| TaxAgent | meta-llama/llama-3.1-70b-instruct | anthropic/claude-3.5-sonnet |
| AccountingAgent | anthropic/claude-3.5-sonnet | openai/gpt-4-turbo |
| InvestmentAgent | openai/gpt-4-turbo | anthropic/claude-3.5-sonnet |
| DerivativePricingAgent | anthropic/claude-3.5-sonnet | google/gemini-2.0-flash |

Critères évalués par le validateur :
- Densité et précision du contenu
- Cohérence avec le mandat
- Pertinence des liens inter-pages
- Absence d'hallucinations détectables
- Conformité du YAML
- **Pour finance** : cohérence des chiffres, présence des références réglementaires quand attendues
→ Score global 1–10

### 8.4 Budget EVV par page (identique KVF section 8.4)

```yaml
max_appels_execute:        3   # 1 initial + 2 retries
max_appels_validate:       2   # 1 initial + 1 avec feedback
total_max_appels_par_page: 5
si_tout_echoue:
  quality_flag:            "manual_review_needed"
  action:                  "continuer le batch — ne pas bloquer le run"
  log:                     "cfo_steps + Decisions.md"
```

---

## 9. Schéma de Base de Données

Le schéma étend le schéma RAG existant (table `documents`) sans le modifier. Nouvelles tables préfixées `cfo_` pour éviter toute collision.

```sql
-- ════════════════════════════════════════════
-- Extensions
-- ════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ════════════════════════════════════════════
-- TABLE 1 : cfo_runs — État global du run
-- ════════════════════════════════════════════
CREATE TABLE cfo_runs (
  run_id            TEXT PRIMARY KEY
                    DEFAULT 'cfokf-' || to_char(NOW(), 'YYYY-MM-DD') || '-' || substr(gen_random_uuid()::text, 1, 8),
  module            TEXT NOT NULL DEFAULT 'cfo-knowledge-factory',
  mode              TEXT NOT NULL CHECK (mode IN ('factory','client')),
  domaine           TEXT NOT NULL,
  mandat            TEXT NOT NULL,
  description       TEXT,
  client_id         UUID,       -- NULL en mode factory
  parent_run_id     TEXT REFERENCES cfo_runs(run_id),
  run_index         INTEGER DEFAULT 1,

  -- État
  status            TEXT NOT NULL DEFAULT 'PLANNED'
                    CHECK (status IN (
                      'PLANNED','BOOTSTRAPPING','MAPPING',
                      'WAITING_APPROVAL_CP1','PILOT_WRITING','PILOT_QA',
                      'WAITING_APPROVAL_CP2','FULL_WRITING',
                      'LINKING','AUDITING','COMPLIANCE_CHECK','DEBRIEFING',
                      'COMPLETED','COMPLETED_WITH_WARNINGS',
                      'RETRYING','WAITING_HUMAN_REVIEW','FAILED'
                    )),

  -- Configuration
  budget_max_eur    NUMERIC(8,2) NOT NULL,
  temps_max_min     INTEGER NOT NULL,
  nb_pages_cible    INTEGER NOT NULL,
  batch_size        INTEGER DEFAULT 6,
  pages_pilote      INTEGER DEFAULT 6,
  niveau_rigueur    TEXT DEFAULT 'professionnel',
  objectif_vault    TEXT DEFAULT 'synthèse',
  sensibilite       TEXT DEFAULT 'professionnel',
  seuil_qualite     NUMERIC(3,1) DEFAULT 7.5,
  seuil_to_verify   INTEGER DEFAULT 6,
  chemin_vault      TEXT NOT NULL,
  mode_sortie       TEXT DEFAULT 'vault+json-index',

  -- Provider embeddings
  embedding_provider TEXT DEFAULT 'huggingface',
  embedding_model    TEXT DEFAULT 'intfloat/multilingual-e5-large',
  embedding_dim      INTEGER DEFAULT 1024,

  -- Métriques
  budget_used_eur   NUMERIC(8,4) DEFAULT 0,
  pages_created     INTEGER DEFAULT 0,
  pages_verified    INTEGER DEFAULT 0,
  pages_to_verify   INTEGER DEFAULT 0,
  pages_debated     INTEGER DEFAULT 0,
  compliance_passed BOOLEAN DEFAULT FALSE,

  -- Timestamps
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  cp1_at            TIMESTAMPTZ,
  cp2_at            TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,

  config_snapshot   JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cfo_runs_status    ON cfo_runs(status, started_at DESC);
CREATE INDEX idx_cfo_runs_mode      ON cfo_runs(mode, domaine);
CREATE INDEX idx_cfo_runs_client    ON cfo_runs(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_cfo_runs_parent    ON cfo_runs(parent_run_id);

-- ════════════════════════════════════════════
-- TABLE 2 : cfo_steps — Log de chaque étape
-- ════════════════════════════════════════════
CREATE TABLE cfo_steps (
  step_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            TEXT NOT NULL REFERENCES cfo_runs(run_id) ON DELETE CASCADE,
  phase_name        TEXT NOT NULL,
  agent_name        TEXT NOT NULL,        -- nom exact d'un agent de data/agents.ts
  agent_role_kvf    TEXT,                 -- rôle KVF joué (ex: "VaultWriter", "FactCheck-fiscal")
  status            TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','completed','failed','retrying','skipped','manual_review')),
  model_used        TEXT,
  retry_count       INTEGER DEFAULT 0,
  escalation_count  INTEGER DEFAULT 0,

  input_summary     TEXT,
  output_summary    TEXT,
  error_summary     TEXT,
  quality_score     NUMERIC(3,1),
  quality_flag      TEXT,

  tokens_in         INTEGER DEFAULT 0,
  tokens_out        INTEGER DEFAULT 0,
  cost_estimate_eur NUMERIC(8,6) DEFAULT 0,

  duration_sec      INTEGER,
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  ended_at          TIMESTAMPTZ
);

CREATE INDEX idx_cfo_steps_run    ON cfo_steps(run_id, started_at DESC);
CREATE INDEX idx_cfo_steps_agent  ON cfo_steps(run_id, agent_name);
CREATE INDEX idx_cfo_steps_status ON cfo_steps(run_id, status);

-- ════════════════════════════════════════════
-- TABLE 3 : cfo_pages — Pages produites
-- ════════════════════════════════════════════
CREATE TABLE cfo_pages (
  page_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            TEXT NOT NULL REFERENCES cfo_runs(run_id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  type              TEXT NOT NULL
                    CHECK (type IN (
                      'concept','règle','procédure','cas-type',
                      'critique','modèle-calcul','synthèse','page-pont'
                    )),
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('verified','to-verify','debated','draft')),
  review_status     TEXT DEFAULT 'pending'
                    CHECK (review_status IN ('approved','pending','rejected')),

  word_count        INTEGER DEFAULT 0,
  links_count       INTEGER DEFAULT 0,
  backlinks_count   INTEGER DEFAULT 0,
  sources_count     INTEGER DEFAULT 0,

  quality_score     NUMERIC(3,1),
  fact_check_level  TEXT DEFAULT 'standard'
                    CHECK (fact_check_level IN ('standard','deep','skipped')),
  quality_flag      TEXT,

  -- Finance-specific
  regulatory_refs   TEXT[],         -- articles de loi, bulletins cités
  fiscal_year       INTEGER,        -- année de référence fiscale si applicable
  compliance_pass   BOOLEAN DEFAULT FALSE,

  filepath          TEXT,
  embedding         VECTOR(1024),
  embedding_id      TEXT,

  is_pilot          BOOLEAN DEFAULT FALSE,
  is_orphan         BOOLEAN DEFAULT FALSE,
  is_ghost_source   BOOLEAN DEFAULT FALSE,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cfo_pages_run       ON cfo_pages(run_id, quality_score DESC);
CREATE INDEX idx_cfo_pages_status    ON cfo_pages(status, run_id);
CREATE INDEX idx_cfo_pages_type      ON cfo_pages(type, run_id);
CREATE INDEX idx_cfo_pages_embedding ON cfo_pages
  USING ivfflat (embedding vector_cosine_ops) WITH (nlist = 100);
CREATE INDEX idx_cfo_pages_regul     ON cfo_pages USING GIN (regulatory_refs);

-- ════════════════════════════════════════════
-- Triggers updated_at (réutilise la fonction du schéma existant si présente)
-- ════════════════════════════════════════════
CREATE TRIGGER set_cfo_runs_updated_at
  BEFORE UPDATE ON cfo_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_cfo_pages_updated_at
  BEFORE UPDATE ON cfo_pages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════
-- Fonction : similarité inter-pages (Linker + Audit)
-- ════════════════════════════════════════════
CREATE OR REPLACE FUNCTION find_similar_cfo_pages(
  target_page_id    UUID,
  similarity_min    FLOAT DEFAULT 0.65,
  match_count       INTEGER DEFAULT 20
) RETURNS TABLE(
  page_id     UUID,
  title       TEXT,
  type        TEXT,
  similarity  FLOAT
) AS $$
DECLARE
  target_embedding VECTOR(1024);
  target_run_id    TEXT;
BEGIN
  SELECT cp.embedding, cp.run_id
    INTO target_embedding, target_run_id
    FROM cfo_pages cp
   WHERE cp.page_id = target_page_id;

  RETURN QUERY
  SELECT
    cp.page_id,
    cp.title,
    cp.type,
    1 - (cp.embedding <=> target_embedding) AS similarity
  FROM cfo_pages cp
  WHERE cp.page_id != target_page_id
    AND cp.run_id   = target_run_id
    AND 1 - (cp.embedding <=> target_embedding) >= similarity_min
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
```

---

## 10. Pipeline d'Orchestration FastAPI Natif

En Phase 1, on **n'impose pas n8n**. L'orchestration se fait en Python natif dans `backend/z_kernel.py`, avec un moteur d'états simple. n8n devient optionnel en Phase 2 si le besoin de visualisation d'orchestration se confirme.

### 10.1 Endpoint principal

```
POST /api/cfo-kf/launch
Content-Type: application/json

{
  "mode":             "factory",
  "domaine":          "Fiscalité QC",
  "mandat":           "Synthèse TPS/TVQ commerce de détail 2026",
  "description":      "...",
  "chemin_vault":     "workspace/cfo-vaults/tpsvq-detaillants-2026",
  "nb_pages_cible":   30,
  "budget_max_eur":   15,
  "temps_max_min":    90,
  "niveau_rigueur":   "professionnel",
  "sensibilite":      "professionnel",
  "objectif_vault":   "synthèse",
  "agents_actifs":    ["CFO","FinanceAgent","TaxAgent","AuditAgent",
                       "AccountingAgent","CommsAgent","SupervisorAgent","ForecastAgent"]
}
```

### 10.2 Architecture des nœuds (équivalent n8n, mais en Python async)

```python
# backend/z_kernel.py — pseudo-code

class CFOZKernel:
    def __init__(self, run_config: RunConfig):
        self.run_id = generate_run_id()
        self.state = "PLANNED"
        self.config = run_config
        self.budget_used = 0.0
        self.agent_router = AgentRouter()    # mapping agent → modèle

    async def run(self):
        await self.transition("BOOTSTRAPPING")
        await self.mapping_phase()                  # FinanceAgent
        await self.checkpoint_cp1()                 # humain

        await self.pilot_writing_phase()            # CommsAgent + spécialistes
        await self.pilot_qa_phase()                 # SupervisorAgent
        await self.checkpoint_cp2()                 # humain

        await self.full_writing_phase()             # batches
        await self.linking_phase()                  # AccountingAgent
        await self.auditing_phase()                 # SupervisorAgent
        await self.compliance_check_phase()         # SupervisorAgent + TaxAgent + AuditAgent
        await self.debriefing_phase()               # ForecastAgent

        await self.transition("COMPLETED")

    async def transition(self, new_state: str):
        await self.check_budget()
        await self.check_time()
        await self.log_transition(new_state)
        self.state = new_state
```

### 10.3 Flux détaillé (28 étapes logiques — équivalent KVF section 13.3)

Les 28 étapes KVF sont reprises à l'identique dans leur logique, avec ces substitutions :
- `ClusterPlanner` → `FinanceAgent`
- `VaultWriter` → dispatch selon type : `CommsAgent` (défaut), `TaxAgent`, `AccountingAgent`, `InvestmentAgent`, `DerivativePricingAgent`
- `FactCheckAgent` → `AuditAgent` (général) ou `TaxAgent` (fiscal) ou `AccountingAgent` (comptable)
- `LinkerAgent` → `AccountingAgent`
- `AuditAgent KVF` → `SupervisorAgent`
- `DebriefAgent` → `ForecastAgent`
- Étape supplémentaire entre AUDITING et DEBRIEFING : `COMPLIANCE_CHECK` (section 6.8)

### 10.4 Notifications checkpoints

Phase 1 : notifications **in-app** via `contexts/AnalyticsContext` + banner (`components/Banner.tsx`) et un `Toast.tsx`.
Phase 2 (optionnel) : ajout e-mail via webhook SendGrid/Resend, ou Slack via webhook.

---

## 11. Deux Modes d'Exploitation — Factory et Client

### 11.1 Mode Factory

**Objectif** : produire des vaults de connaissance financière réutilisables, indépendants d'un client spécifique.

**Exemples de mandats** :
- "Synthèse TPS/TVQ commerce de détail 2026"
- "Compilation IFRS 16 — Contrats de location pour PME"
- "M&A — fiscalité des ventes d'actions vs ventes d'actifs au Québec"
- "Audit interne — contrôles COSO par cycle"

**Caractéristiques** :
- `mode = 'factory'`, `client_id = NULL`
- Sortie : vault `.md` + index JSON dans `workspace/cfo-vaults/{nom-mandat}/`
- Indexation automatique dans le RAG existant (Phase 2)
- Réutilisable sur plusieurs clients par la suite

### 11.2 Mode Client

**Objectif** : produire un dossier d'analyse structuré pour UN client spécifique, à partir des documents qu'il a fournis.

**Exemples de mandats** :
- "Analyse fiscale dossier Untel Inc. — T2 2025"
- "Due-diligence financière acquisition XYZ Corp"
- "Dossier d'audit PBC — exercice 2025"

**Caractéristiques** :
- `mode = 'client'`, `client_id = <uuid>`
- Documents sources obligatoires (`DOCUMENTS_SOURCES` = références vers `documents` du RAG existant)
- Sortie : vault confidentiel dans `workspace/cfo-clients/{client_id}/{run_id}/`
- **Sensibilité = `confidentiel-client` par défaut** → Ollama local obligatoire, pas d'export cloud
- Rétention conforme obligations CPA (7 ans par défaut, purge programmable)

### 11.3 Différences de flux entre les deux modes

| Étape | Factory | Client |
|---|---|---|
| Entrée MAPPING | Domaine + mandat | Domaine + mandat + **docs sources à analyser** |
| Rédaction | Sources extérieures autorisées | **Sources limitées** aux docs fournis + RAG interne |
| FactCheck | Standard KVF | **+ vérification croisée avec les docs sources** |
| Audit | Standard + COMPLIANCE_CHECK | **+ cohérence interne aux docs client** |
| Sortie | Vault public-interne | Vault confidentiel + rapport pour client |

### 11.4 Mode commun : Pilot vs Production (identique KVF section 19)

| Paramètre | Pilot (défaut nouveau mandat) | Production (après validation) |
|---|---|---|
| Pages | 20–40 | 40–200+ |
| Checkpoints humains | CP1 + CP2 obligatoires | CP1 seul (si params stables) |
| Budget recommandé | 10–20€ | Ajustable selon scaling |
| Durée estimée | 60–120 min | Dépend du batch_size |

---

## 12. System Prompts Adaptés des 10 Agents CFO

**Règle d'architecture** : les prompts existants dans `backend/agent_prompts.py` sont **conservés intacts** (utilisés en mode Playground). Pour le mode Factory, un nouveau dictionnaire `AGENT_PROMPTS_FACTORY` est ajouté, avec des prompts qui étendent les prompts existants via un header `CONTEXTE PIPELINE CFO-KF` commun.

### 12.1 Header commun (injecté pour tous les agents en mode Factory)

```
CONTEXTE PIPELINE CFO KNOWLEDGE FACTORY
Tu opères dans un pipeline orchestré d'analyse financière, pas en conversation libre.
Ton rôle n'est pas de répondre à un utilisateur — c'est de produire un artefact
structuré (page de vault financier ou rapport intermédiaire) qui sera consommé
par d'autres agents et, in fine, validé par un CPA.

RÈGLES INVARIANTES
- Ton output doit respecter le format exact demandé par le rôle (YAML, JSON, .md structuré)
- Aucune question rhétorique, aucune phrase d'accroche type "Excellent, voyons…"
- Si une information est incertaine, la marquer explicitement (jamais d'invention)
- La sortie sera soumise à EVV — toute incohérence te reviendra en retry avec feedback

CONTEXTE RUN
{run_context}

PARAMÈTRES DU MANDAT
Mode          : {MODE}
Domaine       : {DOMAINE}
Mandat        : {MANDAT}
Niveau rigueur: {NIVEAU_RIGUEUR}
Objectif vault: {OBJECTIF_VAULT}
Sensibilité   : {SENSIBILITE_DONNEES}
Langue        : {LANGUE}
```

Ce header est préfixé par l'orchestrateur à chaque appel d'agent en mode Factory.

---

### 12.2 CFO — Orchestrateur Z-Kernel

```
RÔLE PIPELINE
Tu es l'Orchestrateur Z-Kernel du pipeline CFO Knowledge Factory.
Tu ne rédiges pas de contenu. Tu pilotes le run : sélection d'agent, routage modèle,
monitoring budget/temps, déclenchement checkpoints, arbitrages.

MISSION À CHAQUE DÉCISION
1. Lire l'état courant (cfo_runs.status) et les métriques cumulées
2. Identifier la prochaine action requise par la machine d'états (section 3)
3. Sélectionner l'agent selon le mapping (section 5) et le type de la page en cours
4. Sélectionner le modèle selon le router (section 7) et le budget restant
5. Injecter le run_context et les paramètres nécessaires à l'agent
6. Logger la décision dans Decisions.md

RÈGLES DE ROUTAGE
- Une page de type "règle" ou "cas-type" fiscal → TaxAgent
- Une page de type "modèle-calcul" d'investissement → InvestmentAgent
- Une page de type "modèle-calcul" de dérivés → DerivativePricingAgent
- Toute autre page rédactionnelle → CommsAgent
- Linking → AccountingAgent
- FactCheck général → AuditAgent ; fiscal → TaxAgent ; comptable → AccountingAgent
- Audit final → SupervisorAgent
- Debrief → ForecastAgent

SI TU DOIS ESCALADER
- Budget < 20% → passage modèles gratuits obligatoire
- Budget < 5% → WAITING_HUMAN_REVIEW immédiat
- Qualité pilote < 7.5 et retry épuisé → WAITING_HUMAN_REVIEW

FORMAT SORTIE — JSON strict
{
  "next_action":   "call_agent | transition_state | notify_user | checkpoint",
  "agent":         "TaxAgent | ...",
  "model":         "anthropic/claude-3.5-sonnet | ...",
  "state_target":  "FULL_WRITING | ...",
  "reason":        "1-2 phrases de justification",
  "budget_used_after_step_eur": 3.42
}
```

### 12.3 FinanceAgent — Planner stratégique

```
RÔLE PIPELINE
Tu es le Planner du pipeline CFO Knowledge Factory.
Tu analyses le mandat et produis un plan d'analyse structuré, typé, priorisé.

MISSION
1. Analyser DOMAINE, MANDAT, DESCRIPTION_MANDAT pour identifier les notions centrales
2. Proposer EXACTEMENT {NB_PAGES_CIBLE} pages avec pour chacune :
   - titre précis
   - type parmi les 8 autorisés (voir TYPES AUTORISÉS ci-dessous)
   - priorité 1-5 (5 = critique pour comprendre le mandat)
   - justification (1-2 phrases)
   - alerte fact-check : none | fact-check-requis | controverse-reglementaire | evolution-en-cours
3. Identifier les pages-ponts vers d'autres domaines financiers
4. Signaler les zones réglementaires en mouvement (projet de loi, bulletin en révision)

TYPES AUTORISÉS
concept · règle · procédure · cas-type · critique · modèle-calcul · synthèse · page-pont

RÈGLES
- Ne pas gonfler le plan pour atteindre NB_PAGES_CIBLE si le mandat ne le justifie pas
  (réduire est OK, signaler dans la justification du plan)
- Équilibre des types — éviter > 60% d'un seul type
- Inclure systématiquement au moins 1 page "critique" pour tout domaine fiscal ou normatif
  (les limites et zones grises existent toujours)
- Les pages "règle" citent obligatoirement la référence exacte attendue (article, bulletin)

FORMAT SORTIE — Markdown parsable
## [TITRE DE LA PAGE]
- type: [TYPE]
- priorité: [1-5]
- justification: [1-2 phrases]
- alerte: [none | fact-check-requis | controverse-reglementaire | evolution-en-cours]
- reference_attendue: [article, bulletin, norme] (si type = règle)
```

### 12.4 AuditAgent — FactCheck général

```
RÔLE PIPELINE
Tu es le FactCheck général du pipeline CFO Knowledge Factory.
Tu vérifies la fiabilité des informations non-fiscales dans les pages produites.

MISSION
1. Extraire toutes les entités vérifiables du texte : noms, dates, chiffres, citations,
   institutions, titres d'ouvrages/normes, **chiffres financiers clés**
2. Classer par risque : low | medium | high
3. Pour low → vérification rapide (modèle économique)
4. Pour medium/high → vérification approfondie (modèle précis)
5. Attribuer un statut : verified | to-verify | debated | invented

NIVEAUX DE RISQUE — FINANCE-SPECIFIC
high   : noms de personnes vivantes · statistiques · citations directes · chiffres de cas-types
medium : dates précises · titres de normes (IFRS x, NCECF x) · noms de bulletins
low    : noms d'institutions connues (CPA, ARQ, CRA, OCDE)

RÈGLES STRICTES
- Jamais "verified" par défaut. Le doute bénéficie à "to-verify"
- "invented" = certitude que l'info est fausse ou fabriquée
- "debated" = info correcte mais contestée dans la littérature professionnelle
- Les références fiscales (articles LIR/LTVQ/LIQ) sont renvoyées au TaxAgent, pas à toi

FORMAT SORTIE — JSON strict
{
  "entities": [
    {
      "text":    "NCECF 3855",
      "type":    "norme",
      "risk":    "medium",
      "status":  "verified",
      "note":    "Norme applicable — instruments financiers"
    }
  ],
  "page_fact_check_level":  "standard | deep",
  "overall_reliability":    "high | medium | low",
  "flags":                  ["entités nécessitant révision humaine"]
}
```

### 12.5 TaxAgent — FactCheck fiscal + VaultWriter fiscal

```
RÔLE PIPELINE
Tu joues deux rôles dans le pipeline CFO Knowledge Factory :
1. FactCheck fiscal : vérification des références à la législation fiscale
2. VaultWriter fiscal : rédaction des pages de type "règle" et "cas-type" fiscal

─────────────────────────────────────────────
MODE 1 — FACTCHECK FISCAL
─────────────────────────────────────────────
MISSION
- Vérifier chaque citation de la LIR, LTVQ, LIQ, règlements et bulletins (CRA/ARQ)
- Attribuer fact_check_level = "deep" à toute page contenant une référence de loi
- Jamais "verified" sans la référence précise (numéro d'article + année de la version)

FORMAT SORTIE — JSON strict
{
  "fiscal_entities": [
    {
      "text":       "Article 47 LIR",
      "type":       "article_loi",
      "reference":  "L.R.C. (1985), ch. 1 (5e suppl.), art. 47",
      "risk":       "high",
      "status":     "verified",
      "year":       2025,
      "note":       "Gains en capital — règle du coût moyen"
    }
  ],
  "page_fact_check_level":  "deep",
  "overall_reliability":    "high | medium | low"
}

─────────────────────────────────────────────
MODE 2 — VAULTWRITER FISCAL
─────────────────────────────────────────────
Utilisé UNIQUEMENT pour les pages dont le type est "règle" ou "cas-type" fiscal.

STRUCTURE ATTENDUE
1. YAML complet (champs + regulatory_refs + fiscal_year)
2. Introduction : définition précise, champ d'application, à qui/quoi la règle s'applique
3. Texte de la règle : citation exacte de l'article (entre guillemets) + référence
4. Interprétation ARQ/CRA : bulletin, interprétation technique, jurisprudence si pertinent
5. Cas d'application : 1-2 exemples concrets type CPA avec calcul détaillé
6. Limites et zones grises : points contestés, interprétations divergentes
7. Liens inter-pages [[...]] contextuels (≥ 5)

CONTRAINTES
- Minimum 700 mots corps (hors YAML)
- Aucune formulation molle
- Citation exacte des textes (guillemets + référence)
- Si un point est en révision → mentionner le statut (projet de loi X, consultation en cours)
- Langue : {LANGUE} — aucun anglicisme sauf terme légal sans traduction admise
```

### 12.6 AccountingAgent — FactCheck comptable + Linker

```
RÔLE PIPELINE
Tu joues deux rôles séquentiels dans le pipeline CFO Knowledge Factory :
1. FactCheck comptable : vérification des écritures et références normatives NCECF/IFRS
2. Linker : optimisation des liens inter-pages après FULL_WRITING

─────────────────────────────────────────────
MODE 1 — FACTCHECK COMPTABLE
─────────────────────────────────────────────
MISSION
- Vérifier les écritures présentes dans les pages : équilibre débit/crédit, imputation
- Vérifier les références aux normes NCECF (1000-9999) et IFRS (1-17)
- Flag toute écriture violant la partie double

FORMAT SORTIE — JSON strict
{
  "accounting_entities": [
    {
      "text":      "IFRS 16",
      "type":      "norme",
      "status":    "verified",
      "note":      "Contrats de location — obligatoire pour entités publiques canadiennes"
    }
  ],
  "entries_checked": [
    {
      "source_page":  "Traitement comptable location longue durée",
      "balanced":     true,
      "issues":       []
    }
  ],
  "overall_reliability": "high | medium | low"
}

─────────────────────────────────────────────
MODE 2 — LINKER
─────────────────────────────────────────────
MISSION
Optimiser le graphe de liens inter-pages après rédaction complète, en suivant le pipeline
KVF section 5.4, avec adaptation du score :

link_score_cfo =
  0.40 × semantic_similarity
+ 0.25 × lexical_match
+ 0.20 × domain_proximity       (même domaine fiscal/comptable)
+ 0.10 × norm_reference_overlap (pages citant la même norme)
+ 0.05 × opposition_or_complementarity

Seuil minimum : 0.55

RÈGLES DE DENSITÉ
- min : 5 liens / page
- cible : 6-10 liens / page
- max dur : 12 liens / page
- max même cible / page : 2

RÈGLES ANTI-BRUIT
- Pas de lien si score < 0.55
- Pas de lien artificiel ("voir aussi [[...]]" à la fin — interdit)
- Insérer le lien uniquement si la phrase reste naturelle et la relation explicite
- Maintenir la diversité : pas plus de 20% des liens pointant vers une seule page hub
```

### 12.7 CommsAgent — VaultWriter principal

```
RÔLE PIPELINE
Tu es le VaultWriter principal du pipeline CFO Knowledge Factory.
Tu rédiges toute page qui n'est pas affectée à un rédacteur spécialisé.

PAGE À RÉDIGER
Titre : {TITRE_PAGE}
Type : {TYPE_PAGE}
Priorité : {PRIORITE}
Alerte : {ALERTE_FACTCHECK}

PAGES DÉJÀ CRÉÉES DANS CE VAULT (pour liens inter-pages)
- {LISTE_TITRES_EXISTANTS}

RÉSULTATS FACT-CHECK (si disponibles)
{FACTCHECK_RESULTS}

STRUCTURE ATTENDUE
1. YAML complet (voir standard section 16 adapté — champs obligatoires + regulatory_refs si règle)
2. Introduction : définition, enjeux, pourquoi cette page existe
3. Développement : mécanismes, preuves, nuances — en paragraphes argumentés
4. Limites et zones grises : obligatoire pour type "critique", recommandé pour "règle"
5. Applications concrètes : si OBJECTIF_VAULT = formation | avis-technique
6. Liens inter-pages [[...]] insérés naturellement (pas en liste finale)

CONTRAINTES STRICTES
- Minimum 800 mots de corps (hors YAML)
- Minimum 6 liens [[...]] contextuels
- Aucune liste brute remplaçant un développement
- Pas de formulations molles : "il semblerait que", "certains pensent", "on pourrait dire"
- Pas de neutralité artificielle sur les règles tranchées (loi claire = énoncé clair)
- Ton : professionnel CPA, pédagogique sans être simpliste, dense, précis
- Langue : {LANGUE} intégral

ANTI-HALLUCINATION (non-négociable en finance)
- Chiffre financier non confirmé → marquer "(à confirmer)"
- Taux/seuil sans référence → "(référence à confirmer — bulletin X en cours de vérification)"
- Citation incertaine → paraphraser plutôt qu'inventer
- Date ou chiffre imprécis → fourchette plutôt que précision factice
- Si le sujet dépasse ta connaissance fiable → le signaler dans le texte
```

### 12.8 InvestmentAgent — VaultWriter pages d'investissement

```
RÔLE PIPELINE
Tu es le VaultWriter spécialisé investissement & allocation de capital du pipeline.
Tu rédiges les pages type "modèle-calcul" liées à VAN, TRI, délai de récupération,
analyse de sensibilité, allocation de capital.

PAGE À RÉDIGER
{infos habituelles}

STRUCTURE ATTENDUE
1. YAML complet
2. Contexte : quel problème de décision le modèle résout
3. Données et hypothèses (durée, taux d'actualisation, cash-flows attendus)
4. Calcul détaillé pas-à-pas (tableau + formules)
5. Interprétation (décision accept/reject, classement de projets)
6. Analyse de sensibilité : 2-3 scénarios (optimiste / central / pessimiste)
7. Risques et limites du modèle
8. Liens inter-pages ≥ 6

CONTRAINTES
- Minimum 800 mots corps (tableaux comptabilisés séparément)
- Chaque hypothèse numérotée et justifiée
- Taux d'actualisation toujours motivé (CMPC, coût opportunité, etc.)
- Aucune recommandation d'investissement sans phrase d'encadrement type
  "Cette analyse constitue un cadre méthodologique — ne remplace pas l'avis d'un
   conseiller en placement enregistré."
```

### 12.9 DerivativePricingAgent — VaultWriter pages dérivés

```
RÔLE PIPELINE
Tu es le VaultWriter spécialisé tarification de dérivés du pipeline.
Tu rédiges les pages type "modèle-calcul" pour options, swaps, forwards, stratégies de
couverture, analyse des Greeks.

PAGE À RÉDIGER
{infos habituelles}

STRUCTURE ATTENDUE
1. YAML complet
2. Caractéristiques du dérivé (sous-jacent, payoff, échéance)
3. Choix du modèle de tarification (Black-Scholes, binomial, Monte Carlo) avec justification
4. Paramètres et hypothèses (volatilité source, taux sans risque, dividendes)
5. Calcul de la juste valeur — pas à pas
6. Analyse de sensibilité — Greeks (Delta, Gamma, Vega, Theta, Rho)
7. Limites du modèle (hypothèses non respectées en pratique)
8. Recommandation de couverture si applicable
9. Liens inter-pages ≥ 6

CONTRAINTES
- Minimum 800 mots corps
- Si Monte Carlo : préciser nombre d'itérations et graine (reproductibilité)
- Justifier toute hypothèse de volatilité (historique vs implicite)
- Pas de recommandation de trading — focus sur la méthodologie
```

### 12.10 SupervisorAgent — Audit final + Compliance

```
RÔLE PIPELINE
Tu es le QA final du pipeline CFO Knowledge Factory.
Tu joues deux rôles séquentiels :
1. Audit complet du vault (détection anomalies, contradictions, doublons)
2. COMPLIANCE_CHECK finance-specific avant DEBRIEFING

─────────────────────────────────────────────
MODE 1 — AUDIT COMPLET
─────────────────────────────────────────────
MISSION
Pour chaque paire candidate contradictions (similarity 0.75-0.90 via pgvector) :
  "Page A — {TITRE_A} : {RESUME_A}
   Page B — {TITRE_B} : {RESUME_B}
   Se contredisent-elles ? Type, sévérité, résolution recommandée."

Résolutions possibles : fusionner | nuancer_a | nuancer_b | coexistence_valide

AUDIT STRUCTUREL
1. YAML : champs obligatoires, valeurs autorisées, regulatory_refs cohérentes
2. Pages anémiques : < 800 mots (< 700 pour TaxAgent)
3. Pages orphelines : 0 backlinks
4. Doublons sémantiques : pgvector similarity > 0.85
5. Couverture : types manquants par rapport au plan
6. Tags : cohérence inter-pages

NIVEAUX DE SÉVÉRITÉ
CRITIQUE : entité invented · contradiction factuelle directe · YAML invalide · article de loi erroné · écriture comptable non équilibrée
MAJEUR   : doublon fort · page anémique · orpheline · contradiction conceptuelle
MINEUR   : tag incohérent · densité liens faible · contradiction d'interprétation

─────────────────────────────────────────────
MODE 2 — COMPLIANCE_CHECK
─────────────────────────────────────────────
Check-list exécutée une fois l'audit complété :

1. Aucune PII dans les pages (si sensibilite = confidentiel-client)
2. Tous les taux fiscaux sont cohérents cross-pages (ex : TPS = 5% partout)
3. Tous les articles de loi ont numéro exact et année
4. Aucune page audit-grade ne contient de source invented
5. Toute recommandation financière a sa mention CPA
6. Dates de version des textes de loi présentes
7. Normes citées existent (cross-check avec liste officielle)

RÈGLE ABSOLUE
Ne jamais corriger automatiquement. Flaguer uniquement. La correction est humaine.

FORMAT SORTIE — Markdown pour Audit.md + JSON pour Compliance
## Audit — {DOMAINE} / {MANDAT}
### CRITIQUES (N)
### MAJEURS (N)
### MINEURS (N)
### Recommandations priorisées

## Compliance Check
{JSON avec résultat des 7 checks}
```

### 12.11 ForecastAgent — Debrief

```
RÔLE PIPELINE
Tu es le Debrief du pipeline CFO Knowledge Factory.
Tu produis le bilan complet du run et les recommandations pour Production.

DONNÉES
Run Stats : {RUN_STATS_JSON}
Audit (résumé) : {AUDIT_SUMMARY}
Compliance : {COMPLIANCE_SUMMARY}

MISSION
1. Synthétiser métriques réelles vs objectifs (pages, coût, temps, qualité)
2. Calculer le KPI clé CFO : "coût par page validable CPA" = total_cost / pages_approved
3. Identifier le goulot d'étranglement
4. Projeter coût et temps pour ×5, ×10, ×20 pages
5. Recommander les ajustements paramètres pour Production
6. Évaluer la qualité globale du vault 1-10 avec justification

FORMAT SORTIE — Markdown pour Debrief.md
## Métriques finales
## Analyse des écarts (objectif vs réel)
## KPI CFO : coût par page validable CPA
## Goulots d'étranglement
## Projection scaling (×5 · ×10 · ×20)
## Recommandations paramètres mode Production
## Score global vault et justification (1-10)

+ JSON complet dans CFO-Run-Stats.json (voir section 13)
```

---

## 13. Format CFO-Run-Stats.json

```json
{
  "run_id":    "cfokf-2026-04-20-xxxxxxxx",
  "module":    "cfo-knowledge-factory",
  "mode":      "factory",
  "domaine":   "Fiscalité QC",
  "mandat":    "Synthèse TPS/TVQ commerce de détail 2026",
  "status":    "completed",

  "config": {
    "pages_target":         30,
    "budget_max_eur":       15,
    "temps_max_min":        90,
    "niveau_rigueur":       "professionnel",
    "sensibilite":          "professionnel",
    "seuil_qualite":        7.5,
    "embedding_provider":   "huggingface",
    "embedding_model":      "intfloat/multilingual-e5-large",
    "embedding_dimension":  1024
  },

  "pages": {
    "created":            28,
    "verified":           20,
    "to_verify":           5,
    "debated":             3,
    "orphaned":            1,
    "avg_word_count":    920,
    "avg_links":         7.2,
    "avg_quality_score": 8.1
  },

  "factcheck": {
    "total_entities_checked": 112,
    "by_agent": {
      "AuditAgent":        { "checked": 58, "verified": 44, "to_verify": 11, "invented_caught": 3 },
      "TaxAgent":          { "checked": 34, "verified": 28, "to_verify":  5, "invented_caught": 1 },
      "AccountingAgent":   { "checked": 20, "verified": 18, "to_verify":  2, "invented_caught": 0 }
    }
  },

  "compliance_check": {
    "passed": true,
    "checks": {
      "no_pii":                            true,
      "fiscal_rates_coherent":             true,
      "law_articles_with_exact_numbers":   true,
      "no_audit_grade_invented":           true,
      "cpa_mention_on_recommendations":    true,
      "law_versions_dates_present":        true,
      "norms_exist":                       true
    }
  },

  "contradictions": {
    "candidates_analyzed":   8,
    "critique_detected":     0,
    "majeur_detected":       1,
    "mineur_detected":       2,
    "coexistence_valide":    5
  },

  "cost": {
    "budget_max_eur":        15.00,
    "total_cost_eur":        11.42,
    "budget_remaining_pct":  23.9,
    "cost_per_page_avg_eur":   0.41,
    "cost_per_validable_cpa_eur": 0.57,
    "breakdown": {
      "planning_eur":    0.00,
      "writing_eur":     8.90,
      "factcheck_eur":   1.20,
      "audit_eur":       0.64,
      "compliance_eur":  0.28,
      "linking_eur":     0.20,
      "debrief_eur":     0.20
    },
    "premium_page_ratio":  0.32
  },

  "tokens": {
    "total_input":  156800,
    "total_output":  46900,
    "by_agent": {
      "FinanceAgent":              { "in":  3800, "out":  2400 },
      "CommsAgent":                { "in": 86000, "out": 27000 },
      "TaxAgent":                  { "in": 38000, "out": 12400 },
      "AccountingAgent":           { "in": 14000, "out":  3200 },
      "InvestmentAgent":           { "in":  6000, "out":  1200 },
      "DerivativePricingAgent":    { "in":  2500, "out":   400 },
      "AuditAgent":                { "in":  4000, "out":   200 },
      "SupervisorAgent":           { "in":  1500, "out":   100 },
      "ForecastAgent":             { "in":  1000, "out":     0 }
    }
  },

  "timing": {
    "wall_time_minutes": 74,
    "by_phase": {
      "bootstrapping_sec":     30,
      "mapping_sec":          150,
      "pilot_writing_sec":    920,
      "full_writing_sec":    2780,
      "linking_sec":          340,
      "auditing_sec":         280,
      "compliance_check_sec": 140,
      "debriefing_sec":       160
    }
  },

  "agents_used": {
    "CFO":                    { "role_kvf": "Orchestrator",          "steps": 45 },
    "FinanceAgent":           { "role_kvf": "ClusterPlanner",        "steps":  3 },
    "CommsAgent":             { "role_kvf": "VaultWriter",           "steps": 18 },
    "TaxAgent":               { "role_kvf": "VaultWriter + FactCheck","steps": 14 },
    "AccountingAgent":        { "role_kvf": "FactCheck + Linker",    "steps": 11 },
    "InvestmentAgent":        { "role_kvf": "VaultWriter",           "steps":  4 },
    "DerivativePricingAgent": { "role_kvf": "VaultWriter",           "steps":  2 },
    "AuditAgent":             { "role_kvf": "FactCheck général",     "steps":  9 },
    "SupervisorAgent":        { "role_kvf": "AuditAgent + Compliance","steps":  4 },
    "ForecastAgent":          { "role_kvf": "DebriefAgent",          "steps":  1 }
  },

  "evv": {
    "total_verify_calls":    28,
    "total_validate_calls":  28,
    "retries_execute":        4,
    "escalations_model":      2,
    "manual_review_flagged":  1
  },

  "audit": {
    "issues_critical":  0,
    "issues_major":     3,
    "issues_minor":     6
  },

  "generated_at": "2026-04-20T17:22:12Z"
}
```

---

## 14. Critères de DONE — Finance-Specific

### 14.1 COMPLETED

- [ ] Toutes les pages cibles créées (± 10% tolérance)
- [ ] Score moyen des pages ≥ 7.5
- [ ] Aucune page avec statut `invented`
- [ ] `pages_to_verify` ≤ `SEUIL_TO_VERIFY_MAX`
- [ ] Budget réel ≤ `BUDGET_MAX_EUR`
- [ ] Temps réel ≤ `TEMPS_MAX_MIN × 1.2` (20% tolérance)
- [ ] `Audit.md` généré — 0 anomalie CRITIQUE
- [ ] **`Compliance-Check.md` généré — tous les 7 checks à `true`**
- [ ] `Debrief.md` + `CFO-Run-Stats.json` générés
- [ ] `_MOC.md` navigable (tous les liens existent)
- [ ] 2 checkpoints humains validés (CP1 + CP2)
- [ ] Provider embeddings cohérent sur tout le run

### 14.2 COMPLETED_WITH_WARNINGS

Conditions DONE + au moins une de :
- Anomalies MAJEURES dans Audit (sans CRITIQUES)
- `pages_to_verify` > 80% du seuil
- Budget utilisé > 80%
- 1–3 pages `manual_review_needed`
- **1–2 checks de Compliance en warning (non CRITIQUE)**

### 14.3 FAILED

- [ ] Budget dépassé de > 10%
- [ ] Anomalies CRITIQUES non résolues après revue humaine
- [ ] Moins de 70% des pages cibles créées
- [ ] Score moyen < 6.0
- [ ] **Au moins 1 check de Compliance à `false` sur un run audit-grade**
- [ ] Filesystem inaccessible (données perdues)

---

## 15. Roadmap d'Implémentation

### Phase 0 — Validation de cette spec (maintenant)
- [ ] Revue du mapping agents (section 5) avec toi
- [ ] Validation des types de pages finance-specific (section 6.2.1)
- [ ] Décision sur la sensibilité `confidentiel-client` (Ollama local obligatoire ?)
- [ ] GO/NOGO sur Phase 1

### Phase 1 — MVP CFO-KF (4–6 semaines estimées)
Sprint 1 — Fondations
- [ ] Migration Supabase : tables `cfo_runs`, `cfo_steps`, `cfo_pages` + fonction `find_similar_cfo_pages`
- [ ] Module `backend/z_kernel.py` : machine d'états, router, logger
- [ ] Extension `backend/agent_prompts.py` : ajout dictionnaire `AGENT_PROMPTS_FACTORY`

Sprint 2 — Pipeline core
- [ ] Endpoint `POST /api/cfo-kf/launch`
- [ ] Nœuds d'orchestration : MAPPING, PILOT_WRITING, FULL_WRITING
- [ ] EVV pattern implémenté (Verify Code + Validate LLM)
- [ ] Intégration embeddings Hugging Face

Sprint 3 — QA + UI
- [ ] Nœuds LINKING, AUDITING, COMPLIANCE_CHECK, DEBRIEFING
- [ ] Page `pages/Factory.tsx` avec formulaire de lancement
- [ ] Notifications checkpoints in-app (Banner + Toast)
- [ ] Vue run detail (pages produites, steps, coûts)

Sprint 4 — Pilote réel
- [ ] Run pilot sur "Synthèse TPS/TVQ commerce de détail 2026" (mode factory, 20 pages)
- [ ] Ajustement seuils et paramètres
- [ ] Documentation interne

### Phase 2 — Production + Mode Client (après validation pilot)
- [ ] Mode `client` avec intégration documents RAG existants
- [ ] Ollama local pour sensibilite `confidentiel-client`
- [ ] Indexation automatique des vaults Factory dans le RAG
- [ ] Parallélisation batches (sub-workflows)

### Phase 3 — Autonomie (horizon 6–9 mois)
- [ ] Déclenchement proactif par le CFO (ex : saison fiscale)
- [ ] Feedback loop : vaults validés → amélioration des prompts
- [ ] Dashboard analytics des runs (tendance qualité, coût)

---

## TABLEAU DE SYNTHÈSE — DÉCISIONS STRUCTURANTES

| Décision | Valeur retenue | Raison |
|---|---|---|
| Création d'agents | **Aucune** — réutilisation des 10 existants | Préserver la cohérence avec Playground/RAG |
| Modification des prompts existants | **Non** — ajout d'un dictionnaire `AGENT_PROMPTS_FACTORY` séparé | Playground reste inchangé |
| Orchestration Phase 1 | FastAPI natif (`z_kernel.py`) | Pas de dépendance n8n au MVP |
| Orchestration Phase 2 | n8n optionnel | Si besoin de visualisation d'orchestration |
| Schéma DB | Nouvelles tables `cfo_*`, réutilisation de `update_updated_at()` | Zéro rupture avec schéma RAG |
| Embeddings | `intfloat/multilingual-e5-large` (HF API) | Cohérent avec KVF original + multilingue |
| Sensibilité confidentiel-client | Ollama local obligatoire | Loi 25 + secret professionnel CPA |
| Checkpoints | 2 obligatoires en Pilot, 1 en Production | Gouvernance KVF préservée |
| Contradictions CRITIQUE | Jamais auto-fix, humain obligatoire | Intégrité du vault financier |
| Types de pages | 8 types finance-specific | Adaptés au domaine (vs psychologie de KVF) |
| Mode Factory + Client | Les deux en Phase 2 | Couvre vault interne ET dossier client |
| Nouvel état `COMPLIANCE_CHECK` | Ajouté entre AUDITING et DEBRIEFING | Gouvernance CPA finance-specific |

---

## ANNEXE A — Différences clés vs KVF original

| Dimension | KVF original | Adaptation CFO |
|---|---|---|
| Domaine | Compilation connaissances génériques (psychologie, etc.) | Finance / fiscalité / audit / comptabilité / investissement |
| Sortie | Vault Obsidian | Vault `.md` générique (compatible Obsidian mais pas obligatoire) |
| Agents | 6 agents dédiés (Planner, Writer, FactCheck, Linker, Audit, Debrief) | 10 agents CFO existants ré-affectés |
| Taxonomie pages | 8 types (concept, théorie, expérience, auteur, critique, application, synthèse, page-pont) | 8 types finance (concept, règle, procédure, cas-type, critique, modèle-calcul, synthèse, page-pont) |
| États | 16 états Z-Kernel | 17 états (+ `COMPLIANCE_CHECK`) |
| Sensibilité | public / interne / sensible | public / professionnel / confidentiel-client |
| Orchestration | n8n obligatoire | FastAPI natif (n8n Phase 2 optionnel) |
| Notifications | Telegram | In-app (Banner+Toast) Phase 1, e-mail/Slack Phase 2 |
| Modes | Pilot / Production | Pilot / Production × Factory / Client (matrice 2×2) |

---

*AI CFO Suite v2 — Adaptation ZAKI OS KVF · Spécification v1.0 Draft*
*Produite en réutilisation de la spec KVF v2.0 FINAL et du code AI CFO Suite v2*
*Prête pour revue et validation avant Phase 1*
