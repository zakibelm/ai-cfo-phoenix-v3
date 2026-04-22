-- ════════════════════════════════════════════════════════════════════════════
-- AI CFO Suite v2 — Row Level Security (RLS) pour CFO Knowledge Factory
-- Date    : 2026-04-20 (à appliquer APRÈS 20260420_cfo_kvf_schema.sql)
--
-- Stratégie de sécurité :
--   1. Chaque document/run/page est attaché à un user_id (cabinet) et optionnellement client_id
--   2. RLS activé sur les 4 tables nouvelles
--   3. Policies : un utilisateur authentifié ne voit que SES propres données
--   4. service_role (côté backend FastAPI) bypasse les RLS pour les opérations système
--   5. Les docs publics (sensibilite='public', user_id = NULL) sont lisibles par tous les auth
--
-- Pré-requis : Supabase Auth doit être activé (auth.uid() doit retourner un UUID)
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Ajout des colonnes user_id / created_by si pas déjà présentes
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE cfo_knowledge_docs
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_kb_user_id ON cfo_knowledge_docs(user_id);

ALTER TABLE cfo_runs
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_runs_user_id ON cfo_runs(user_id);

ALTER TABLE cfo_steps
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_steps_user_id ON cfo_steps(user_id);

ALTER TABLE cfo_pages
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_pages_user_id ON cfo_pages(user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Activer RLS sur les 4 tables
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE cfo_knowledge_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfo_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfo_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfo_pages ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Policies : cfo_knowledge_docs
-- ────────────────────────────────────────────────────────────────────────────

-- READ : un user voit ses docs + les docs publics (user_id NULL ET sensibilite='public')
DROP POLICY IF EXISTS kb_select_own_or_public ON cfo_knowledge_docs;
CREATE POLICY kb_select_own_or_public ON cfo_knowledge_docs
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR (user_id IS NULL AND sensibilite = 'public')
  );

-- INSERT : auto-tag user_id sur insertion
DROP POLICY IF EXISTS kb_insert_own ON cfo_knowledge_docs;
CREATE POLICY kb_insert_own ON cfo_knowledge_docs
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- UPDATE : seulement ses propres docs
DROP POLICY IF EXISTS kb_update_own ON cfo_knowledge_docs;
CREATE POLICY kb_update_own ON cfo_knowledge_docs
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- DELETE : seulement ses propres docs
DROP POLICY IF EXISTS kb_delete_own ON cfo_knowledge_docs;
CREATE POLICY kb_delete_own ON cfo_knowledge_docs
  FOR DELETE
  USING (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Policies : cfo_runs
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS runs_select_own ON cfo_runs;
CREATE POLICY runs_select_own ON cfo_runs
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS runs_insert_own ON cfo_runs;
CREATE POLICY runs_insert_own ON cfo_runs
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS runs_update_own ON cfo_runs;
CREATE POLICY runs_update_own ON cfo_runs
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS runs_delete_own ON cfo_runs;
CREATE POLICY runs_delete_own ON cfo_runs
  FOR DELETE USING (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Policies : cfo_steps (héritent du run parent)
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS steps_select_own ON cfo_steps;
CREATE POLICY steps_select_own ON cfo_steps
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR run_id IN (SELECT run_id FROM cfo_runs WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS steps_insert_own ON cfo_steps;
CREATE POLICY steps_insert_own ON cfo_steps
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR run_id IN (SELECT run_id FROM cfo_runs WHERE user_id = auth.uid())
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Policies : cfo_pages
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS pages_select_own ON cfo_pages;
CREATE POLICY pages_select_own ON cfo_pages
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR run_id IN (SELECT run_id FROM cfo_runs WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS pages_insert_own ON cfo_pages;
CREATE POLICY pages_insert_own ON cfo_pages
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR run_id IN (SELECT run_id FROM cfo_runs WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS pages_update_own ON cfo_pages;
CREATE POLICY pages_update_own ON cfo_pages
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR run_id IN (SELECT run_id FROM cfo_runs WHERE user_id = auth.uid())
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Note critique sur le service_role
-- ────────────────────────────────────────────────────────────────────────────
--
-- Le backend FastAPI doit utiliser la SERVICE_ROLE_KEY de Supabase (et NON
-- l'anon key) pour bypasser ces RLS lors des opérations système (z_kernel,
-- ingestion, etc.). Le service_role contourne automatiquement RLS.
--
-- Configuration backend/.env :
--   SUPABASE_KEY=<service_role_key>      # ← bypass RLS, JAMAIS exposé au front
--   SUPABASE_ANON_KEY=<anon_key>          # ← optionnel pour tests
--
-- Le frontend, lui, n'appelle JAMAIS Supabase directement — il passe par
-- /api/* qui authentifie l'utilisateur via JWT et propage user_id au back.
-- Cette architecture garantit que RLS est bien appliquée.
--
-- ────────────────────────────────────────────────────────────────────────────


-- ────────────────────────────────────────────────────────────────────────────
-- 8. Helper function : récupérer le user_id courant (utile pour les triggers)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION current_user_id()
RETURNS UUID
LANGUAGE SQL STABLE
AS $$
  SELECT COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::UUID)
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Audit log — table simple pour traçabilité Loi 25 / CPA
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cfo_audit_log (
  log_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID,
  action        TEXT NOT NULL,           -- ex: 'kb_doc_uploaded', 'run_launched', 'pii_detected'
  resource_type TEXT,                    -- 'cfo_knowledge_docs' | 'cfo_runs' | etc.
  resource_id   TEXT,
  metadata      JSONB DEFAULT '{}',
  ip_address    INET,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON cfo_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON cfo_audit_log(action, created_at DESC);

ALTER TABLE cfo_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_select_own ON cfo_audit_log;
CREATE POLICY audit_select_own ON cfo_audit_log
  FOR SELECT USING (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────────────
-- FIN MIGRATION RLS
-- ────────────────────────────────────────────────────────────────────────────
