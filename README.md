# 🧠 AI CFO Suite — Phoenix v3

> **Orchestrateur de Processus Financiers propulsé par IA**  
> Plateforme multi-agents de nouvelle génération pour l'analyse documentaire financière, la gouvernance des données et l'intelligence décisionnelle.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/Frontend-React%2018-61DAFB?logo=react)](https://react.dev)
[![Docker](https://img.shields.io/badge/Infrastructure-Docker-2496ED?logo=docker)](https://docker.com)
[![pgvector](https://img.shields.io/badge/DB-PostgreSQL%20%2B%20pgvector-336791?logo=postgresql)](https://github.com/pgvector/pgvector)

---

## 🌟 Aperçu

L'**AI CFO Suite Phoenix v3** est un système SaaS d'entreprise combinant :
- Un **frontend React** ultra-performant (Vite + TypeScript) avec le design system *Phoenix* (glassmorphism, micro-animations GSAP)
- Un **backend FastAPI** structuré en architecture RAG (Retrieval-Augmented Generation) avec pipeline Z-Kernel
- Une **base de données vectorielle** PostgreSQL + `pgvector` auto-hébergée via Docker
- Un système **multi-agents IA** orchestré via OpenRouter, avec routage intelligent selon la sensibilité des données (conformité Loi 25)

**Score d'évaluation expert : 8.8 / 10** *(Prêt pour production SaaS)*

---

## ✨ Fonctionnalités Clés

| Module | Description |
|--------|-------------|
| 📊 **Dashboard Phoenix** | KPIs financiers en temps réel, visualisation de l'état du système |
| 🏭 **CFO Knowledge Factory** | Pipeline Z-Kernel avec machine à états visuelle, checkpoints CP1/CP2, contrôle budget/pages |
| 📚 **Knowledge Base Unifiée** | Ingestion documentaire bulk + affinage par fichier, avec contrôle de sensibilité |
| 💬 **Playground Multi-Agents** | Chat IA avec 10 agents spécialisés (CFO Oracle, Analyste, Auditeur, etc.) |
| 🔍 **RAG Explorer** | Exploration et gestion des documents vectorisés |
| 🔐 **Gouvernance Privacy-First** | Routage automatique vers Ollama (local) pour données confidentielles-client (Loi 25) |
| 🤖 **Agent Management** | Configuration et supervision des agents IA disponibles |
| ⚙️ **Settings** | Gestion des intégrations API (OpenRouter, Ollama, etc.) |

---

## 🏗️ Architecture

```
ai-cfo-phoenix-v3/
├── 🖥️  Frontend (React + Vite)
│   ├── components/          # Composants réutilisables (Sidebar, Chat, DiffModal…)
│   ├── pages/               # Pages principales (Dashboard, Factory, KnowledgeBase…)
│   ├── contexts/            # React Context (Auth, Theme…)
│   ├── hooks/               # Custom hooks
│   ├── services/            # Clients API REST
│   └── styles.css           # Design System Phoenix (CSS variables)
│
├── 🐍  Backend (FastAPI + Python)
│   ├── main.py              # Point d'entrée FastAPI
│   ├── z_kernel.py          # Orchestrateur du pipeline Z-Kernel
│   ├── agent_prompts.py     # Prompts des agents IA
│   ├── pipeline_phases.py   # Phases du pipeline RAG
│   ├── kb_storage.py        # Gestion du stockage vectoriel
│   ├── security_pii.py      # Détection et gouvernance des données sensibles
│   ├── observability.py     # Métriques et traçabilité
│   ├── api/                 # Routes API v1
│   ├── services/            # Services métier (RAG, ingestion…)
│   └── models/              # Modèles Pydantic
│
└── 🐳  Infrastructure
    └── docker-compose.yml   # PostgreSQL (pgvector) + Backend
```

---

## 🛠️ Stack Technique

**Frontend**
- React 18 + TypeScript
- Vite (bundler ultra-rapide)
- GSAP (animations premium)
- TanStack React Query (data fetching)
- React Router DOM v7

**Backend**
- Python 3.11+ / FastAPI
- Poetry (gestion des dépendances)
- LangChain / pgvector (pipeline RAG)
- OpenRouter API (routage multi-LLM)
- Ollama (inférence locale, données confidentielles)

**Infrastructure**
- Docker + Docker Compose
- PostgreSQL 16 + pgvector
- Vercel (déploiement frontend)

---

## 📦 Prérequis

- [Node.js](https://nodejs.org) v18+ (avec `npm`)
- [Python](https://python.org) 3.11+
- [Poetry](https://python-poetry.org)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

---

## ⚙️ Installation & Démarrage

### 1. Cloner le projet

```bash
git clone https://github.com/zakibelm/ai-cfo-phoenix-v3.git
cd ai-cfo-phoenix-v3
```

### 2. Configurer les variables d'environnement

```bash
# Frontend
cp .env.example .env.local
# Renseigner VITE_API_URL=http://localhost:8000

# Backend
cp backend/.env.example backend/.env
# Renseigner OPENROUTER_API_KEY, DATABASE_URL, etc.
```

### 3a. 🐳 Démarrage avec Docker (Recommandé)

Lance automatiquement PostgreSQL + pgvector + Backend :

```bash
docker-compose up --build
```

Puis dans un second terminal, lancez le frontend :

```bash
npm install
npm run dev
```

### 3b. 🔧 Démarrage Manuel

**Backend :**
```bash
cd backend
poetry install
poetry run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Frontend :**
```bash
npm install
npm run dev
```

### 4. Tout lancer en une commande

```bash
npm run start
# Équivaut à : concurrently backend + frontend
```

**URLs disponibles :**
- 🖥️ **Frontend** : `http://localhost:5173`
- 📖 **API Docs (Swagger)** : `http://localhost:8000/docs`
- 🔍 **ReDoc** : `http://localhost:8000/redoc`

---

## 👤 Comptes de Démonstration

| Rôle | Email | Mot de passe |
|------|-------|-------------|
| 🔑 Admin | `admin@aicfo.com` | `admin123` |
| 👤 Utilisateur | `user@aicfo.com` | `user123` |

> ⚠️ Ces comptes sont générés en mémoire au démarrage. À remplacer par une vraie base d'utilisateurs en production.

---

## 🧪 Tests

### Backend
```bash
cd backend
poetry run pytest -v
```

### Vérification TypeScript (Frontend)
```bash
npm run lint
```

---

## 🚀 Déploiement en Production

### Frontend → Vercel

```bash
# Installer Vercel CLI
npm i -g vercel

# Déployer
vercel --prod
```

Configurer la variable d'environnement `VITE_API_URL` dans le tableau de bord Vercel en la pointant vers votre serveur backend.

### Backend → Docker sur VPS

```bash
# Sur votre serveur (SSH)
git clone https://github.com/zakibelm/ai-cfo-phoenix-v3.git
cd ai-cfo-phoenix-v3
docker-compose up -d --build
```

> 💡 Voir `DEPLOY_RAG.md` pour le guide complet de déploiement sur VPS.

---

## 📖 Documentation Complémentaire

| Fichier | Contenu |
|---------|---------|
| [`EXPERT_EVALUATION.md`](./EXPERT_EVALUATION.md) | Audit expert complet — score 8.8/10 |
| [`DEPLOY_RAG.md`](./DEPLOY_RAG.md) | Guide de déploiement RAG en production |
| [`INTEGRATION.md`](./INTEGRATION.md) | Guide d'intégration des APIs externes |
| [`AI-CFO-KVF-ADAPTATION-SPEC-v1.0.md`](./AI-CFO-KVF-ADAPTATION-SPEC-v1.0.md) | Spécification technique complète du Z-Kernel |

---

## 🤝 Contribution

1. Fork le projet
2. Créer une branche feature : `git checkout -b feature/ma-fonctionnalite`
3. Committer vos changements : `git commit -m 'feat: ajouter ma fonctionnalité'`
4. Pousser la branche : `git push origin feature/ma-fonctionnalite`
5. Ouvrir une Pull Request

---

## 📄 Licence

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

---

<div align="center">
  <strong>AI CFO Suite — Phoenix v3</strong><br>
  Conçu pour les équipes financières qui veulent l'avantage de l'IA sans compromis sur la souveraineté des données.
</div>
