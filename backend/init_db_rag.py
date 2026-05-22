"""Script d'initialisation DB - tables auth + RAG (auto-run au démarrage)"""
import psycopg, os, time

db = os.environ.get("DATABASE_URL", "postgresql://ai_cfo:ai_cfo_password@db:5432/ai_cfo_db")

sqls = [
    # Auth tables
    "CREATE TABLE IF NOT EXISTS local_users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, name VARCHAR(255), picture_url TEXT, password_hash VARCHAR(255) NOT NULL, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS user_sessions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES local_users(id) ON DELETE CASCADE, token VARCHAR(512) UNIQUE NOT NULL, jti VARCHAR(255) UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, expires_at TIMESTAMP, is_active BOOLEAN DEFAULT TRUE)",
    "ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS jti VARCHAR(255) UNIQUE",
    "CREATE TABLE IF NOT EXISTS google_users (id SERIAL PRIMARY KEY, google_id VARCHAR(255) UNIQUE NOT NULL, email VARCHAR(255) UNIQUE NOT NULL, name VARCHAR(255), picture_url TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
    # Memory table
    "CREATE TABLE IF NOT EXISTS agent_memory (id SERIAL PRIMARY KEY, user_id VARCHAR(255), session_id VARCHAR(255), role VARCHAR(50), content TEXT, embedding vector(1024), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
    # RAG tables
    "CREATE EXTENSION IF NOT EXISTS vector",
    """CREATE TABLE IF NOT EXISTS cfo_knowledge_docs (
        doc_id VARCHAR(255) PRIMARY KEY,
        filename TEXT, filepath TEXT, file_size_bytes INTEGER,
        file_type VARCHAR(50), mime_type VARCHAR(100),
        domaine VARCHAR(100), fiscal_year INTEGER,
        sensibilite VARCHAR(50) DEFAULT 'professionnel',
        doc_type VARCHAR(100), regulatory_refs JSONB DEFAULT '[]',
        tags JSONB DEFAULT '[]', agents_assigned JSONB DEFAULT '[]',
        client_id VARCHAR(255), status VARCHAR(50) DEFAULT 'indexed',
        status_message TEXT, text_content TEXT, text_excerpt TEXT,
        embedding vector(1024), version INTEGER DEFAULT 1,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        use_count INTEGER DEFAULT 0, used_in_runs JSONB DEFAULT '[]'
    )""",
    """CREATE TABLE IF NOT EXISTS cfo_runs (
        run_id VARCHAR(255) PRIMARY KEY, module VARCHAR(100), mode VARCHAR(50),
        domaine VARCHAR(100), mandat TEXT, description TEXT, client_id VARCHAR(255),
        parent_run_id VARCHAR(255), run_index INTEGER, status VARCHAR(50) DEFAULT 'PLANNED',
        budget_max_eur FLOAT, temps_max_min INTEGER, sensibilite VARCHAR(50),
        seuil_qualite FLOAT, seuil_to_verify FLOAT, chemin_vault TEXT,
        mode_sortie VARCHAR(100), started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMP, config_snapshot JSONB
    )""",
    """CREATE TABLE IF NOT EXISTS cfo_steps (
        step_id VARCHAR(255) PRIMARY KEY,
        run_id VARCHAR(255) REFERENCES cfo_runs(run_id) ON DELETE CASCADE,
        phase_name VARCHAR(100), agent_name VARCHAR(100), agent_role_kvf TEXT,
        status VARCHAR(50), model_used VARCHAR(100), input_summary TEXT,
        output_summary TEXT, duration_sec FLOAT,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS cfo_pages (
        page_id VARCHAR(255) PRIMARY KEY, run_id VARCHAR(255),
        title TEXT, type VARCHAR(100), status VARCHAR(50) DEFAULT 'draft',
        word_count INTEGER, quality_score FLOAT, filepath TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
    # Indexes
    "CREATE INDEX IF NOT EXISTS idx_cfo_kb_domaine ON cfo_knowledge_docs (domaine)",
    "CREATE INDEX IF NOT EXISTS idx_cfo_kb_status ON cfo_knowledge_docs (status)",
    "CREATE INDEX IF NOT EXISTS idx_cfo_runs_status ON cfo_runs (status)",
    "CREATE INDEX IF NOT EXISTS idx_cfo_steps_run ON cfo_steps (run_id)",
]

for i in range(10):
    try:
        c = psycopg.connect(db)
        c.autocommit = True
        cur = c.cursor()
        for sql in sqls:
            try:
                cur.execute(sql)
                print("[OK] " + sql[:60])
            except Exception as e2:
                print("[SKIP] " + str(e2)[:80])
        c.close()
        print("=== DB INIT COMPLETE ===")
        break
    except Exception as e:
        print(f"[{i}] DB not ready: {e}")
        time.sleep(3)
