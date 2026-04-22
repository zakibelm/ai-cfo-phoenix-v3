-- ════════════════════════════════════════════════════════════════════════════
-- AI CFO Suite v2 — Migration CFO Knowledge Factory + Knowledge Base
-- Date    : 2026-04-20
-- Module  : cfo-knowledge-factory
-- Auteur  : Adaptation ZAKI OS / KVF pour AI CFO Suite
-- ════════════════════════════════════════════════════════════════════════════

-- Extensions requises
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Fonction trigger updated_at (créée si pas déjà présente)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ════════════════════════════════════════════════════════════════════════════
-- TABLE 1 : cfo_knowledge_docs — Documents-source de la KB
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cfo_knowledge_docs (
  doc_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename          TEXT NOT NULL,
  filepath          TEXT NOT NULL,
  file_size_bytes   BIGINT,
  file_type         TEXT,
  mime_type         TEXT,

  -- Métadonnées finance-specific
  domaine           TEXT NOT NULL,
  fiscal_year       INTEGER,
  sensibilite       TEXT NOT NULL DEFAULT 'professionnel'
                    CHECK (sensibilite IN ('public','professionnel','confidentiel-client')),
  doc_type          TEXT NOT NULL DEFAULT 'autre'
                    CHECK (doc_type IN ('loi','bulletin','norme','rapport-client',
                                        'manuel-interne','jurisprudence','autre')),
  regulatory_refs   TEXT[] DEFAULT '{}',
  tags              TEXT[] DEFAULT '{}',
  agents_assigned   TEXT[] DEFAULT '{}',
  client_id         UUID,

  -- Status
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','extracting','embedding','indexed','failed')),
  status_message    TEXT,

  -- Contenu
  text_content      TEXT,
  text_excerpt      TEXT,
  embedding         VECTOR(1024),

  -- Usage
  used_in_runs      TEXT[] DEFAULT '{}',
  last_used_at      TIMESTAMPTZ,
  use_count         INTEGER DEFAULT 0,

  -- Versioning
  parent_doc_id     UUID REFERENCES cfo_knowledge_docs(doc_id),
  version           INTEGER DEFAULT 1,

  uploaded_by       TEXT,
  uploaded_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kb_domaine     ON cfo_knowledge_docs(domaine);
CREATE INDEX IF NOT EXISTS idx_kb_sensibilite ON cfo_knowledge_docs(sensibilite);
CREATE INDEX IF NOT EXISTS idx_kb_year        ON cfo_knowledge_docs(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_kb_agents      ON cfo_knowledge_docs USING GIN (agents_assigned);
CREATE INDEX IF NOT EXISTS idx_kb_regulatory  ON cfo_knowledge_docs USING GIN (regulatory_refs);
CREATE INDEX IF NOT EXISTS idx_kb_tags        ON cfo_knowledge_docs USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_kb_embedding   ON cfo_knowledge_docs
  USING ivfflat (embedding vector_cosine_ops) WITH (nlist = 100);

DROP TRIGGER IF EXISTS set_cfo_kb_updated_at ON cfo_knowledge_docs;
CREATE TRIGGER set_cfo_kb_updated_at
  BEFORE UPDATE ON cfo_knowledge_docs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ════════════════════════════════════════════════════════════════════════════
-- TABLE 2 : cfo_runs — Runs Knowledge Factory
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cfo_runs (
  run_id            TEXT PRIMARY KEY
                    DEFAULT 'cfokf-' || to_char(NOW(), 'YYYY-MM-DD') || '-' || substr(gen_random_uuid()::text, 1, 8),
  module            TEXT NOT NULL DEFAULT 'cfo-knowledge-factory',
  mode              TEXT NOT NULL CHECK (mode IN ('factory','client')),
  domaine           TEXT NOT NULL,
  mandat            TEXT NOT NULL,
  description       TEXT,
  client_id         UUID,
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
  avg_quality_score NUMERIC(3,1),
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

CREATE INDEX IF NOT EXISTS idx_cfo_runs_status    ON cfo_runs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cfo_runs_mode      ON cfo_runs(mode, domaine);
CREATE INDEX IF NOT EXISTS idx_cfo_runs_client    ON cfo_runs(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cfo_runs_parent    ON cfo_runs(parent_run_id);

DROP TRIGGER IF EXISTS set_cfo_runs_updated_at ON cfo_runs;
CREATE TRIGGER set_cfo_runs_updated_at
  BEFORE UPDATE ON cfo_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ════════════════════════════════════════════════════════════════════════════
-- TABLE 3 : cfo_steps — Log par étape
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cfo_steps (
  step_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            TEXT NOT NULL REFERENCES cfo_runs(run_id) ON DELETE CASCADE,
  phase_name        TEXT NOT NULL,
  agent_name        TEXT NOT NULL,
  agent_role_kvf    TEXT,
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

CREATE INDEX IF NOT EXISTS idx_cfo_steps_run    ON cfo_steps(run_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cfo_steps_agent  ON cfo_steps(run_id, agent_name);
CREATE INDEX IF NOT EXISTS idx_cfo_steps_status ON cfo_steps(run_id, status);


-- ════════════════════════════════════════════════════════════════════════════
-- TABLE 4 : cfo_pages — Pages produites
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cfo_pages (
  page_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            TEXT NOT NULL REFERENCES cfo_runs(run_id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  type              TEXT NOT NULL
                    CHECK (type IN ('concept','règle','procédure','cas-type',
                                    'critique','modèle-calcul','synthèse','page-pont')),
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
  regulatory_refs   TEXT[],
  fiscal_year       INTEGER,
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

CREATE INDEX IF NOT EXISTS idx_cfo_pages_run       ON cfo_pages(run_id, quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_cfo_pages_status    ON cfo_pages(status, run_id);
CREATE INDEX IF NOT EXISTS idx_cfo_pages_type      ON cfo_pages(type, run_id);
CREATE INDEX IF NOT EXISTS idx_cfo_pages_embedding ON cfo_pages
  USING ivfflat (embedding vector_cosine_ops) WITH (nlist = 100);
CREATE INDEX IF NOT EXISTS idx_cfo_pages_regul     ON cfo_pages USING GIN (regulatory_refs);

DROP TRIGGER IF EXISTS set_cfo_pages_updated_at ON cfo_pages;
CREATE TRIGGER set_cfo_pages_updated_at
  BEFORE UPDATE ON cfo_pages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ════════════════════════════════════════════════════════════════════════════
-- FONCTION : similarité inter-pages d'un même run
-- ════════════════════════════════════════════════════════════════════════════
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
  SELECT cp.page_id, cp.title, cp.type,
         1 - (cp.embedding <=> target_embedding) AS similarity
  FROM cfo_pages cp
  WHERE cp.page_id != target_page_id
    AND cp.run_id   = target_run_id
    AND 1 - (cp.embedding <=> target_embedding) >= similarity_min
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;


-- ════════════════════════════════════════════════════════════════════════════
-- FONCTION : recherche sémantique dans la KB
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION search_kb_docs(
  query_embedding   VECTOR(1024),
  similarity_min    FLOAT DEFAULT 0.5,
  match_count       INTEGER DEFAULT 10,
  filter_domaine    TEXT DEFAULT NULL,
  filter_agent      TEXT DEFAULT NULL
) RETURNS TABLE(
  doc_id     UUID,
  filename   TEXT,
  domaine    TEXT,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT d.doc_id, d.filename, d.domaine,
         1 - (d.embedding <=> query_embedding) AS similarity
  FROM cfo_knowledge_docs d
  WHERE d.embedding IS NOT NULL
    AND (filter_domaine IS NULL OR d.domaine = filter_domaine)
    AND (filter_agent IS NULL OR filter_agent = ANY(d.agents_assigned)
         OR cardinality(d.agents_assigned) = 0)
    AND 1 - (d.embedding <=> query_embedding) >= similarity_min
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
