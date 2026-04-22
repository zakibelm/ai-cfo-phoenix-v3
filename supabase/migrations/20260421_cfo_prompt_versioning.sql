-- ════════════════════════════════════════════════════════════════════════════
-- Migration : Prompt versioning (audit trail CPA-grade)
-- Date      : 2026-04-21
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cfo_prompt_versions (
  prompt_hash         TEXT PRIMARY KEY,
  agent_name          TEXT NOT NULL,
  template            TEXT NOT NULL,
  rendered_preview    TEXT,
  first_run_id        TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_agent
  ON cfo_prompt_versions(agent_name, created_at DESC);

-- Lien dans cfo_steps pour traçabilité CPA
ALTER TABLE cfo_steps
  ADD COLUMN IF NOT EXISTS prompt_hash TEXT
  REFERENCES cfo_prompt_versions(prompt_hash);

CREATE INDEX IF NOT EXISTS idx_steps_prompt ON cfo_steps(prompt_hash);

COMMENT ON TABLE cfo_prompt_versions IS
  'Traçabilité audit CPA — tout prompt utilisé pendant un run reste immuable ici, référencé par hash SHA256 tronqué 12 chars.';
