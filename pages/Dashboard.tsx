import React, { useEffect, useState } from 'react';
import { DiffModal } from '../components/DiffModal';

const Dashboard: React.FC = () => {
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);
  
  // Backend State
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runState, setRunState] = useState<any>(null);
  const [isLoadingAction, setIsLoadingAction] = useState(false);
  const [isSealed, setIsSealed] = useState(false);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

  // Initial Fetch
  useEffect(() => {
    document.body.classList.add('phoenix-active');
    
    const fetchLatestRun = async () => {
      try {
        const res = await fetch(`${API_URL}/api/cfo-kf/runs`);
        if (res.ok) {
          const data = await res.json();
          if (data.runs && data.runs.length > 0) {
            const latest = data.runs[0];
            setActiveRunId(latest.run_id);
            setRunState(latest);
            if (['FULL_WRITING', 'LINKING', 'AUDITING', 'COMPLETED'].includes(latest.status)) {
              setIsSealed(true);
            }
          }
        }
      } catch (err) {
        console.log("Backend not reachable. Running in demo mode.");
      }
    };
    fetchLatestRun();

    return () => {
      document.body.classList.remove('phoenix-active');
    };
  }, []);

  // SSE Streaming
  useEffect(() => {
    if (!activeRunId) return;
    
    const eventSource = new EventSource(`${API_URL}/api/cfo-kf/runs/${activeRunId}/stream`);

    eventSource.addEventListener('update', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        setRunState((prev: any) => ({ ...prev, ...data }));
        if (['FULL_WRITING', 'LINKING', 'AUDITING', 'COMPLETED'].includes(data.status)) {
          setIsSealed(true);
        }
      } catch (err) {}
    });

    eventSource.addEventListener('done', (e: any) => {
      eventSource.close();
    });

    return () => {
      eventSource.close();
    };
  }, [activeRunId]);

  const handleStartDemo = async () => {
    setIsLoadingAction(true);
    try {
      const res = await fetch(`${API_URL}/api/cfo-kf/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: "factory",
          domaine: "Finance",
          mandat: "Fiducie Desjardins - Synthèse Q4",
          nb_pages_cible: 10,
          budget_max_eur: 15
        })
      });
      if (res.ok) {
        const data = await res.json();
        setActiveRunId(data.run_id);
        setRunState({ status: data.status, mandat: "Fiducie Desjardins - Synthèse Q4", budget_used_eur: 0 });
        setIsSealed(false);
      }
    } catch (err) {
      console.log("Failed to start run on backend. Mocking locally.");
      setRunState({ status: 'WAITING_APPROVAL_CP1', mandat: "Fiducie Desjardins - Synthèse Q4", budget_used_eur: 0 });
      setIsSealed(false);
    }
    setIsLoadingAction(false);
  };

  const handleApprove = async () => {
    setIsLoadingAction(true);
    if (!activeRunId) {
      setTimeout(() => {
        setIsSealed(true);
        setRunState((prev: any) => ({ ...prev, status: 'LINKING' }));
        setIsLoadingAction(false);
      }, 800);
      return;
    }
    
    try {
      const res = await fetch(`${API_URL}/api/cfo-kf/checkpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: activeRunId,
          checkpoint: "CP1",
          decision: "GO"
        })
      });
      if (res.ok) {
        setIsSealed(true);
      } else {
        setIsSealed(true);
      }
    } catch (err) {
      setIsSealed(true);
    }
    setIsLoadingAction(false);
  };

  // Status to Node color mapping
  const s = runState?.status || 'INIT';
  const nodes = {
    init: s === 'BOOTSTRAPPING' || s === 'INIT' ? '#cba660' : '#8a8a93',
    planner: s === 'MAPPING' ? '#cba660' : '#8a8a93',
    writer: s === 'PILOT_WRITING' || s === 'FULL_WRITING' ? '#cba660' : '#8a8a93',
    factcheck: s === 'WAITING_APPROVAL_CP1' ? '#cba660' : (isSealed ? '#8a8a93' : '#26314a'),
    linker: s === 'LINKING' ? '#cba660' : (isSealed ? '#26314a' : '#26314a'),
    cpii: s === 'WAITING_APPROVAL_CP2' ? '#cba660' : '#26314a',
    debrief: s === 'DEBRIEFING' || s === 'COMPLETED' ? '#cba660' : '#26314a'
  };

  const agents = [
    { id: "I", icon: "Ω", title: "Orchestrateur", subtitle: "CFO • PREMIER ASSOCIÉ", status: "présidence • séance", statusColor: "green" },
    { id: "II", icon: "F", title: "Fiscalité", subtitle: "IMPÔT • ARC • REVENU QC", status: "en délibéré • 3 dossiers", statusColor: "green" },
    { id: "III", icon: "C", title: "Comptabilité", subtitle: "NCECF • IFRS • PCGR", status: "compile • Q4", statusColor: "active" },
    { id: "IV", icon: "A", title: "Audit", subtitle: "ASSURANCE • CONTRÔLE", status: "disponible", statusColor: "inactive" },
    { id: "V", icon: "I", title: "Investissement", subtitle: "PORTEFEUILLE • STRATÉGIE", status: "disponible", statusColor: "inactive" },
    { id: "VI", icon: "D", title: "Dérivés", subtitle: "OPTIONS • CONTRATS À TERME", status: "disponible", statusColor: "inactive" },
    { id: "VII", icon: "C", title: "Communication", subtitle: "RAPPORT • CLIENT", status: "disponible", statusColor: "inactive" },
    { id: "VIII", icon: "S", title: "Supervision", subtitle: "FLUX • CONFORMITÉ", status: "disponible", statusColor: "inactive" },
    { id: "IX", icon: "P", title: "Prévisions", subtitle: "FLUX • HORIZON 24 MOIS", status: "disponible", statusColor: "inactive" },
    { id: "X", icon: "Σ", title: "Stratégie", subtitle: "FINANCE • GOUVERNANCE", status: "disponible", statusColor: "inactive" }
  ];

  return (
    <div className="phoenix-layout">
      {/* Header */}
      <header className="phoenix-header animate-fade-in-up">
        <div className="phoenix-logo-area">
          <div className="phoenix-logo-box">Φ</div>
          <div className="phoenix-title-block">
            <h1 className="phoenix-title">Phoenix</h1>
            <div className="phoenix-subtitle">CABINET AGENTIQUE • Me TREMBLAY</div>
          </div>
        </div>
        <div className="phoenix-meta">
          <div className="phoenix-meta-item">
            <span className="phoenix-meta-label">EXERCICE</span>
            <span className="phoenix-meta-value">MMXXV</span>
          </div>
          <div className="phoenix-meta-item">
            <span className="phoenix-meta-label">SESSION</span>
            <span className="phoenix-meta-value">14:32 HNE</span>
          </div>
          <div className="phoenix-meta-item">
            <button 
              onClick={handleStartDemo} 
              style={{ background: 'transparent', border: '1px solid var(--accent-gold-dark)', color: 'var(--accent-gold)', padding: '0.25rem 0.5rem', cursor: 'pointer', borderRadius: '4px', fontSize: '0.7rem', textTransform: 'uppercase' }}
            >
              {isLoadingAction ? 'CONNEXION...' : 'DÉMARRER TEST'}
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="phoenix-hero animate-fade-in-up delay-1">
        <div className="phoenix-hero-label">SALON • VUE D'ENSEMBLE</div>
        <div className="phoenix-hero-content">
          <div className="phoenix-headline-block">
            <h2 className="phoenix-headline">
              Dix <span>associés</span>,<br />
              un seul <span>jugement</span>.
            </h2>
            <div className="phoenix-quote">
              « Nihil verum nisi probatum. »<br />
              Rien n'est vrai avant d'avoir été vérifié.
            </div>
          </div>
          <div className="phoenix-hero-desc">
            Le Cabinet compile le dossier Q4 2024 pour la Fiducie Desjardins. Huit étapes accomplies. Le Planner soumet sa proposition à votre validation.
          </div>
        </div>
      </section>

      {/* Agents Section */}
      <section className="phoenix-section animate-fade-in-up delay-2">
        <div className="phoenix-section-header">
          <div className="phoenix-section-num">I.</div>
          <div className="phoenix-section-title-block">
            <h3 className="phoenix-section-title">Les Associés</h3>
            <div className="phoenix-section-subtitle">DIX INTELLIGENCES, CHACUNE À SON OFFICE</div>
          </div>
        </div>

        <div className="phoenix-grid">
          {agents.map((agent, index) => (
            <div key={agent.id} className={`phoenix-card animate-fade-in-up`} style={{ animationDelay: `${0.3 + index * 0.05}s` }}>
              <div className="phoenix-card-top">
                <div className="phoenix-card-num">{agent.id}.</div>
                <div className="phoenix-card-icon">{agent.icon}</div>
              </div>
              <div className="phoenix-card-content">
                <div className="phoenix-card-title">{agent.title}</div>
                <div className="phoenix-card-desc">{agent.subtitle}</div>
              </div>
              <div className="phoenix-card-status">
                <div className={`phoenix-status-dot ${agent.statusColor}`}></div>
                {agent.status}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section II: Le Registre */}
      <section className="phoenix-section animate-fade-in-up delay-3">
        <div className="phoenix-section-header">
          <div className="phoenix-section-num">II.</div>
          <div className="phoenix-section-title-block">
            <h3 className="phoenix-section-title">Le Registre</h3>
            <div className="phoenix-section-subtitle">DOSSIER EN COURS • PIPELINE GOUVERNÉ</div>
          </div>
        </div>

        <div className="registre-content">
          <div className="registre-details">
            <div className="registre-meta">DOSSIER # Q4 - MMXXIV - 018</div>
            <h4 className="registre-title">{runState?.mandat || "Fiducie Desjardins"}<br />— synthèse de l'exercice</h4>
            <div className="registre-subtitle">Pour Me Marc Tremblay, CPA - Cabinet Nord</div>

            <div className="registre-stats-list">
              <div className="registre-stat-row">
                <span className="registre-stat-label">GRAVURE - PAGES</span>
                <span className="registre-stat-value">{runState?.pages_created || 78} / {runState?.nb_pages_cible || 100}</span>
              </div>
              <div className="registre-stat-row">
                <span className="registre-stat-label">BOURSE - BUDGET</span>
                <span className="registre-stat-value">{runState?.budget_used_eur || '9 240'} / {runState?.budget_max_eur || '14 500'} $ CAD</span>
              </div>
              <div className="registre-stat-row">
                <span className="registre-stat-label">TENUE - QUALITÉ</span>
                <span className="registre-stat-value">{runState?.avg_quality_score || 92} / 100</span>
              </div>
              <div className="registre-stat-row">
                <span className="registre-stat-label">SENSIBILITÉ</span>
                <span className="registre-stat-value gold">Confidentiel-client</span>
              </div>
              <div className="registre-stat-row">
                <span className="registre-stat-label">TRAITEMENT</span>
                <span className="registre-stat-value italic">Ollama - local - Loi 25</span>
              </div>
            </div>
          </div>

          <div className="registre-pipeline">
            <div className="pipeline-header">
              <span>PIPELINE • Z-KERNEL</span>
              <span>STATUT = {runState?.status || 'EN ATTENTE'}</span>
            </div>
            <div className="pipeline-graph">
              <svg width="100%" height="100%" viewBox="0 0 400 200" style={{ overflow: 'visible' }}>
                <path d="M 20 160 Q 80 140 120 100 T 260 60" fill="none" stroke="#26314a" strokeWidth="2" strokeDasharray="4 4" />
                
                <circle cx="20" cy="160" r={nodes.init === '#cba660' ? 5 : 4} fill={nodes.init} />
                <text x="20" y="175" fill={nodes.init} fontSize="8" textAnchor="middle">Init</text>

                <circle cx="60" cy="130" r={nodes.planner === '#cba660' ? 5 : 4} fill={nodes.planner} />
                <text x="60" y="145" fill={nodes.planner} fontSize="8" textAnchor="middle">Planner</text>

                <circle cx="100" cy="100" r={4} fill="#8a8a93" />
                <text x="100" y="115" fill="#8a8a93" fontSize="8" textAnchor="middle">Retriever</text>

                <circle cx="140" cy="90" r={nodes.writer === '#cba660' ? 5 : 4} fill={nodes.writer} />
                <text x="140" y="105" fill={nodes.writer} fontSize="8" textAnchor="middle">Writer</text>

                <circle cx="180" cy="85" r="4" fill="#8a8a93" />
                <text x="180" y="100" fill="#8a8a93" fontSize="8" textAnchor="middle">-CP1-</text>

                <circle cx="220" cy="75" r={nodes.factcheck === '#cba660' ? 5 : 4} fill={nodes.factcheck} />
                <text x="220" y="90" fill={nodes.factcheck} fontSize="8" textAnchor="middle">FactCheck</text>

                <circle cx="260" cy="65" r={nodes.linker === '#cba660' ? 5 : 4} fill={nodes.linker} />
                <text x="260" y="80" fill={nodes.linker} fontSize="8" textAnchor="middle">Linker</text>
                
                <circle cx="300" cy="55" r={nodes.cpii === '#cba660' ? 5 : 4} fill={nodes.cpii} />
                <text x="300" y="70" fill={nodes.cpii} fontSize="8" textAnchor="middle">CP II</text>
                
                <circle cx="340" cy="50" r={nodes.debrief === '#cba660' ? 5 : 4} fill={nodes.debrief} />
                <text x="340" y="65" fill={nodes.debrief} fontSize="8" textAnchor="middle">Debrief</text>
              </svg>
            </div>
          </div>
        </div>
      </section>

      {/* Action Bar */}
      <div className="phoenix-action-bar-container animate-fade-in-up delay-3">
        <div className="phoenix-action-bar" style={{ borderColor: isSealed ? 'rgba(52, 211, 153, 0.5)' : 'var(--accent-gold-dark)' }}>
          <div className="action-bar-left">
            <div className="action-icon" style={{ background: isSealed ? 'var(--accent-green)' : 'radial-gradient(circle, var(--accent-gold), var(--accent-gold-dark))' }}>
              {isLoadingAction ? '⏳' : (isSealed ? '✔️' : '✦')}
            </div>
            <div className="action-text-content">
              <div className="action-label" style={{ color: isSealed ? 'var(--accent-green)' : 'var(--accent-gold)' }}>
                {isSealed ? 'DOSSIER SCELLÉ • EN TRAITEMENT' : 'ANTICHAMBRE • VALIDATION REQUISE'}
              </div>
              <div className="action-title">
                {isSealed ? 'Jugement appliqué.' : 'Le Planner sollicite votre jugement.'}
              </div>
              <div className="action-desc">
                {isSealed ? `La lecture a été scellée. Le pipeline Z-Kernel avance vers : ${runState?.status || 'Linker'}` : "Douze sections candidates ont été rédigées. Une lecture de votre part scelle l'entrée du dossier."}
              </div>
            </div>
          </div>
          <div className="action-buttons">
            <button 
              className="btn-phoenix btn-phoenix-outline"
              onClick={() => setIsDiffModalOpen(true)}
              disabled={isLoadingAction}
            >
              CONSULTER LE DIFF
            </button>
            <button 
              className="btn-phoenix btn-phoenix-solid"
              onClick={handleApprove}
              disabled={isSealed || isLoadingAction}
              style={{ opacity: isSealed ? 0.5 : 1, cursor: isSealed ? 'not-allowed' : 'pointer', background: isSealed ? 'var(--accent-green)' : '' }}
            >
              {isLoadingAction ? 'TRAITEMENT...' : (isSealed ? 'DOSSIER APPROUVÉ' : 'SCELLER ET AVANCER')}
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="phoenix-footer animate-fade-in-up delay-3">
        <div>@ AI CFO Phoenix 2026 by Zakibelm</div>
        <div className="footer-links">
          <span>LOI 25</span>
          <span>LPRPDE</span>
          <span>CODE CPA</span>
          <span>RLS - ACTIF</span>
        </div>
      </footer>

      <DiffModal 
        isOpen={isDiffModalOpen}
        onClose={() => setIsDiffModalOpen(false)}
        onApprove={handleApprove}
      />
    </div>
  );
};

export default Dashboard;
