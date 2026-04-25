/**
 * Factory.tsx — CFO Knowledge Factory : page de pilotage du pipeline Z-Kernel.
 *
 * 2 onglets :
 *   • Lancer un run : formulaire mode Factory (vault) ou Client (dossier)
 *   • Runs actifs  : liste live avec état, progression, coûts, checkpoints
 *
 * Back : /api/cfo-kf/launch, /api/cfo-kf/runs, /api/cfo-kf/runs/{id}, /api/cfo-kf/checkpoint
 * Design : dark premium, gradients, GSAP entrance + state machine visualizer.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { gsap } from 'gsap';
import Banner from '../components/Banner';
import AgentCheckboxSelector from '../components/AgentCheckboxSelector';
import { SpinnerIcon } from '../components/icons/SpinnerIcon';
import { CheckIcon } from '../components/icons/CheckIcon';
import { API_BASE_URL } from '../services/apiService';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type CfoRunStatus =
  | 'PLANNED' | 'BOOTSTRAPPING' | 'MAPPING'
  | 'WAITING_APPROVAL_CP1' | 'PILOT_WRITING' | 'PILOT_QA'
  | 'WAITING_APPROVAL_CP2' | 'FULL_WRITING'
  | 'LINKING' | 'AUDITING' | 'COMPLIANCE_CHECK' | 'DEBRIEFING'
  | 'COMPLETED' | 'COMPLETED_WITH_WARNINGS'
  | 'RETRYING' | 'WAITING_HUMAN_REVIEW' | 'FAILED';

export interface CfoRun {
  run_id: string;
  mode: 'factory' | 'client';
  domaine: string;
  mandat: string;
  description?: string;
  status: CfoRunStatus;
  nb_pages_cible: number;
  pages_created: number;
  pages_verified: number;
  pages_to_verify: number;
  budget_max_eur: number;
  budget_used_eur: number;
  temps_max_min: number;
  niveau_rigueur: string;
  sensibilite: string;
  avg_quality_score?: number;
  started_at: string;
  ended_at?: string;
  client_id?: string;
}

type TabKey = 'launch' | 'runs';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES — états du pipeline pour la visualisation
// ─────────────────────────────────────────────────────────────────────────────

const PIPELINE_STATES: { key: CfoRunStatus; label: string; phase: 'init' | 'pilot' | 'prod' | 'final' }[] = [
  { key: 'PLANNED', label: 'Planifié', phase: 'init' },
  { key: 'BOOTSTRAPPING', label: 'Bootstrap', phase: 'init' },
  { key: 'MAPPING', label: 'Plan', phase: 'init' },
  { key: 'WAITING_APPROVAL_CP1', label: 'CP1', phase: 'init' },
  { key: 'PILOT_WRITING', label: 'Pilote', phase: 'pilot' },
  { key: 'PILOT_QA', label: 'QA pilote', phase: 'pilot' },
  { key: 'WAITING_APPROVAL_CP2', label: 'CP2', phase: 'pilot' },
  { key: 'FULL_WRITING', label: 'Rédaction', phase: 'prod' },
  { key: 'LINKING', label: 'Linking', phase: 'prod' },
  { key: 'AUDITING', label: 'Audit', phase: 'prod' },
  { key: 'COMPLIANCE_CHECK', label: 'Compliance', phase: 'prod' },
  { key: 'DEBRIEFING', label: 'Debrief', phase: 'final' },
  { key: 'COMPLETED', label: 'Terminé', phase: 'final' },
];

const STATUS_TO_COLOR: Record<string, string> = {
  PLANNED: 'var(--secondary-text)',
  BOOTSTRAPPING: 'var(--accent-cyan)',
  MAPPING: 'var(--pie-blue)',
  WAITING_APPROVAL_CP1: 'var(--accent-yellow)',
  PILOT_WRITING: 'var(--pie-purple)',
  PILOT_QA: 'var(--pie-purple)',
  WAITING_APPROVAL_CP2: 'var(--accent-yellow)',
  FULL_WRITING: 'var(--accent-green)',
  LINKING: 'var(--accent-green)',
  AUDITING: 'var(--accent-green)',
  COMPLIANCE_CHECK: 'var(--accent-cyan)',
  DEBRIEFING: 'var(--accent-green)',
  COMPLETED: 'var(--accent-green)',
  COMPLETED_WITH_WARNINGS: 'var(--accent-yellow)',
  RETRYING: 'var(--accent-red)',
  WAITING_HUMAN_REVIEW: 'var(--accent-red)',
  FAILED: 'var(--accent-red)',
};

const DOMAINES_PRESETS = [
  'Fiscalité QC', 'Fiscalité fédérale CA', 'IFRS 16 — Contrats de location',
  'NCECF', 'Audit interne (COSO)', 'M&A — Due diligence',
  'Investissement / VAN-TRI', 'Dérivés financiers', 'Multi-domaine',
];

// ─────────────────────────────────────────────────────────────────────────────
// API HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function launchFactoryRun(payload: any): Promise<{ run_id: string }> {
  const response = await fetch(`${API_BASE_URL}/api/cfo-kf/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`HTTP ${response.status} : ${err}`);
  }
  return response.json();
}

async function listRuns(): Promise<CfoRun[]> {
  const response = await fetch(`${API_BASE_URL}/api/cfo-kf/runs`);
  if (!response.ok) return [];
  const data = await response.json();
  return (data.runs ?? []) as CfoRun[];
}

async function getRun(run_id: string): Promise<CfoRun | null> {
  const response = await fetch(`${API_BASE_URL}/api/cfo-kf/runs/${run_id}`);
  if (!response.ok) return null;
  return response.json();
}

async function respondCheckpoint(run_id: string, checkpoint: 'CP1' | 'CP2',
  decision: 'GO' | 'CORRIGE' | 'AJUSTE' | 'STOP'): Promise<void> {
  await fetch(`${API_BASE_URL}/api/cfo-kf/checkpoint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ run_id, checkpoint, decision }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SOUS-COMPOSANTS
// ─────────────────────────────────────────────────────────────────────────────

const StateMachineVisual: React.FC<{ currentStatus: CfoRunStatus }> = ({ currentStatus }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeIdx = PIPELINE_STATES.findIndex(s => s.key === currentStatus);

  useEffect(() => {
    if (!containerRef.current) return;
    const activeEl = containerRef.current.querySelector('.fx-state.fx-state-active') as HTMLElement | null;
    if (activeEl) {
      gsap.fromTo(activeEl,
        { scale: 1 }, { scale: 1.12, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }
    return () => { gsap.killTweensOf('.fx-state-active'); };
  }, [currentStatus]);

  return (
    <div ref={containerRef} className="fx-state-machine">
      {PIPELINE_STATES.map((s, i) => {
        const isPast = activeIdx >= 0 && i < activeIdx;
        const isActive = i === activeIdx;
        return (
          <React.Fragment key={s.key}>
            <div className={`fx-state ${isPast ? 'fx-state-past' : ''} ${isActive ? 'fx-state-active' : ''}`}
              title={s.key}>
              <div className="fx-state-dot">
                {isPast ? '✓' : isActive ? '●' : i + 1}
              </div>
              <span className="fx-state-label">{s.label}</span>
            </div>
            {i < PIPELINE_STATES.length - 1 && (
              <div className={`fx-state-line ${isPast ? 'fx-state-line-past' : ''}`}></div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

const RunCard: React.FC<{
  run: CfoRun;
  expanded: boolean;
  onToggle: () => void;
  onCheckpoint: (cp: 'CP1' | 'CP2', decision: 'GO' | 'CORRIGE' | 'AJUSTE' | 'STOP') => void;
}> = ({ run, expanded, onToggle, onCheckpoint }) => {
  const budgetPct = (run.budget_used_eur / run.budget_max_eur) * 100;
  const pagesPct = run.nb_pages_cible > 0 ? (run.pages_created / run.nb_pages_cible) * 100 : 0;
  const awaitingCp1 = run.status === 'WAITING_APPROVAL_CP1';
  const awaitingCp2 = run.status === 'WAITING_APPROVAL_CP2';
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cardRef.current) return;
    gsap.fromTo(cardRef.current,
      { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
  }, [run.run_id]);

  return (
    <div ref={cardRef} className={`fx-run-card ${expanded ? 'expanded' : ''}`}>
      <div className="fx-run-header" onClick={onToggle}>
        <div className="fx-run-left">
          <div className="fx-run-id-row">
            <span className="fx-run-id">{run.run_id}</span>
            <span className={`fx-mode-badge fx-mode-${run.mode}`}>
              {run.mode === 'factory' ? '🏭 Factory' : '👤 Client'}
            </span>
            {run.sensibilite === 'confidentiel-client' && (
              <span className="fx-conf-badge" title="Loi 25 + secret professionnel CPA · Ollama local uniquement · zéro envoi cloud">
                🔒 Confidentiel — local
              </span>
            )}
          </div>
          <div className="fx-run-mandat">{run.mandat}</div>
          <div className="fx-run-domain">📂 {run.domaine}</div>
        </div>
        <div className="fx-run-right">
          <span className="fx-run-status-badge"
            style={{ color: STATUS_TO_COLOR[run.status], borderColor: STATUS_TO_COLOR[run.status] }}>
            {run.status}
          </span>
          <span className="fx-expand-arrow">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      <div className="fx-run-metrics">
        <div className="fx-metric">
          <span className="fx-metric-label">Pages</span>
          <div className="fx-metric-bar">
            <div className="fx-metric-fill fx-metric-green" style={{ width: `${Math.min(pagesPct, 100)}%` }} />
          </div>
          <span className="fx-metric-value">{run.pages_created}/{run.nb_pages_cible}</span>
        </div>
        <div className="fx-metric">
          <span className="fx-metric-label">Budget</span>
          <div className="fx-metric-bar">
            <div className={`fx-metric-fill ${budgetPct > 80 ? 'fx-metric-red' : budgetPct > 60 ? 'fx-metric-yellow' : 'fx-metric-cyan'}`}
              style={{ width: `${Math.min(budgetPct, 100)}%` }} />
          </div>
          <span className="fx-metric-value">{run.budget_used_eur.toFixed(2)} / {run.budget_max_eur}€</span>
        </div>
        {run.avg_quality_score !== undefined && (
          <div className="fx-metric">
            <span className="fx-metric-label">Qualité moy.</span>
            <div className="fx-metric-bar">
              <div className="fx-metric-fill fx-metric-purple"
                style={{ width: `${(run.avg_quality_score / 10) * 100}%` }} />
            </div>
            <span className="fx-metric-value">{run.avg_quality_score.toFixed(1)}/10</span>
          </div>
        )}
      </div>

      {(awaitingCp1 || awaitingCp2) && (
        <div className="fx-checkpoint-banner">
          <span>⏸ En attente de validation humaine — {awaitingCp1 ? 'Checkpoint 1 (Plan)' : 'Checkpoint 2 (Pilote)'}</span>
          <div className="fx-cp-actions">
            <button className="fx-btn fx-btn-success"
              onClick={() => onCheckpoint(awaitingCp1 ? 'CP1' : 'CP2', 'GO')}>✓ GO</button>
            <button className="fx-btn fx-btn-warn"
              onClick={() => onCheckpoint(awaitingCp1 ? 'CP1' : 'CP2', awaitingCp1 ? 'CORRIGE' : 'AJUSTE')}>
              {awaitingCp1 ? '↺ CORRIGE' : '⚙ AJUSTE'}
            </button>
            <button className="fx-btn fx-btn-danger"
              onClick={() => onCheckpoint(awaitingCp1 ? 'CP1' : 'CP2', 'STOP')}>✗ STOP</button>
          </div>
        </div>
      )}

      {expanded && (
        <div className="fx-run-expanded">
          <StateMachineVisual currentStatus={run.status} />
          {run.description && (
            <div className="fx-description"><b>Description :</b> {run.description}</div>
          )}
          <div className="fx-run-extra">
            <span>🔒 Sensibilité : <b>{run.sensibilite}</b></span>
            <span>📏 Niveau : <b>{run.niveau_rigueur}</b></span>
            <span>⏱ Max : {run.temps_max_min}min</span>
            <span>📅 Démarré : {new Date(run.started_at).toLocaleString('fr-CA')}</span>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

const Factory: React.FC = () => {
  const [tab, setTab] = useState<TabKey>('launch');
  const pageRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Launch form state
  const [mode, setMode] = useState<'factory' | 'client'>('factory');
  const [domaine, setDomaine] = useState(DOMAINES_PRESETS[0]);
  const [mandat, setMandat] = useState('');
  const [description, setDescription] = useState('');
  const [nbPages, setNbPages] = useState(30);
  const [budget, setBudget] = useState(15);
  const [tempsMax, setTempsMax] = useState(90);
  const [niveau, setNiveau] = useState<'grand-public' | 'professionnel' | 'audit-grade'>('professionnel');
  const [sensibilite, setSensibilite] = useState<'public' | 'professionnel' | 'confidentiel-client'>('professionnel');
  const [modePilot, setModePilot] = useState(true);
  const [agentsActifs, setAgentsActifs] = useState<string[]>(['CFO', 'FinanceAgent', 'CommsAgent', 'TaxAgent', 'AccountingAgent', 'AuditAgent', 'SupervisorAgent', 'ForecastAgent']);
  // React Query Client
  const queryClient = useQueryClient();

  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launchSuccess, setLaunchSuccess] = useState<string | null>(null);

  // Runs state via React Query
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  const { data: runs = [], isFetching: loadingRuns, refetch: refreshRuns } = useQuery({
    queryKey: ['factory-runs'],
    queryFn: listRuns,
    refetchInterval: (query) => {
      if (tab !== 'runs') return false;
      const data = query.state.data as CfoRun[] | undefined;
      const activeExists = data?.some(r => !['COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED'].includes(r.status));
      return activeExists ? 5000 : false;
    },
    enabled: tab === 'runs',
  });

  // GSAP entrance
  useEffect(() => {
    if (!pageRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo('.fx-hero', { opacity: 0, y: -15 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' });
      gsap.fromTo('.fx-tab', { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.08, delay: 0.15, ease: 'power2.out' });
    }, pageRef);
    return () => ctx.revert();
  }, []);

  useEffect(() => {
    if (!panelRef.current) return;
    gsap.fromTo(panelRef.current, { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' });
  }, [tab]);

  const launchMutation = useMutation({
    mutationFn: launchFactoryRun,
    onSuccess: (data) => {
      setLaunchSuccess(`Run lancé : ${data.run_id}`);
      setMandat(''); setDescription('');
      queryClient.invalidateQueries({ queryKey: ['factory-runs'] });
      setTimeout(() => { setTab('runs'); }, 1500);
    },
    onError: (e) => {
      setLaunchError(e instanceof Error ? e.message : 'Erreur de lancement');
    }
  });

  const checkpointMutation = useMutation({
    mutationFn: ({ run_id, cp, decision }: { run_id: string, cp: 'CP1' | 'CP2', decision: 'GO' | 'CORRIGE' | 'AJUSTE' | 'STOP' }) => respondCheckpoint(run_id, cp, decision),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['factory-runs'] });
    },
    onError: (e) => {
      alert(`Erreur checkpoint : ${e instanceof Error ? e.message : 'inconnue'}`);
    }
  });

  const handleLaunch = () => {
    if (!mandat.trim()) { setLaunchError('Le mandat est requis.'); return; }
    setLaunchError(null); setLaunchSuccess(null);
    launchMutation.mutate({
      mode, domaine, mandat, description,
      nb_pages_cible: nbPages, budget_max_eur: budget, temps_max_min: tempsMax,
      niveau_rigueur: niveau, sensibilite,
      mode_pilot: modePilot, agents_actifs: agentsActifs,
    });
  };

  const handleCheckpoint = (run_id: string, cp: 'CP1' | 'CP2', decision: 'GO' | 'CORRIGE' | 'AJUSTE' | 'STOP') => {
    checkpointMutation.mutate({ run_id, cp, decision });
  };

  const runsActive = useMemo(() => runs.filter(r =>
    !['COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED'].includes(r.status)), [runs]);
  const runsFinished = useMemo(() => runs.filter(r =>
    ['COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED'].includes(r.status)), [runs]);

  return (
    <div ref={pageRef} className="page-container fx-page">
      <div className="fx-hero">
        <h1 className="fx-page-title">⚙ CFO Knowledge Factory</h1>
        <p className="fx-page-subtitle">
          Pipeline orchestré qui compile des analyses financières structurées — gouverné par états, budget borné, EVV, checkpoints humains.
        </p>
      </div>

      <div className="fx-tabs">
        <button className={`fx-tab ${tab === 'launch' ? 'on' : ''}`} onClick={() => setTab('launch')}>
          <span className="fx-tab-icon">🚀</span> Lancer un run
        </button>
        <button className={`fx-tab ${tab === 'runs' ? 'on' : ''}`} onClick={() => setTab('runs')}>
          <span className="fx-tab-icon">📊</span> Runs
          {runs.length > 0 && <span className="fx-tab-count">{runs.length}</span>}
          {runsActive.length > 0 && <span className="fx-tab-live">● live</span>}
        </button>
      </div>

      <div ref={panelRef} className="fx-tab-panel">

        {/* ════════ TAB 1 — LAUNCH ════════ */}
        {tab === 'launch' && (
          <div className="fx-card fx-glass">
            <div className="fx-card-header">
              <h2>🚀 Nouveau run — Knowledge Factory</h2>
            </div>
            <p className="fx-section-sub">
              Configurez le mandat et la gouvernance. Le pipeline Z-Kernel orchestrera ensuite les 10 agents selon le mapping KVF.
            </p>

            {launchError && <Banner type="error" message={launchError} />}
            {launchSuccess && <Banner type="info" message={launchSuccess} />}

            <div className="fx-mode-toggle">
              <button className={`fx-mode-btn ${mode === 'factory' ? 'on' : ''}`} onClick={() => setMode('factory')}>
                <div className="fx-mode-icon">🏭</div>
                <div>
                  <div className="fx-mode-title">Mode Factory</div>
                  <div className="fx-mode-desc">Vault de connaissance réutilisable (ex : synthèse TPS/TVQ 2026)</div>
                </div>
              </button>
              <button className={`fx-mode-btn ${mode === 'client' ? 'on' : ''}`} onClick={() => setMode('client')}>
                <div className="fx-mode-icon">👤</div>
                <div>
                  <div className="fx-mode-title">Mode Client</div>
                  <div className="fx-mode-desc">Dossier d'analyse confidentiel pour un client spécifique</div>
                </div>
              </button>
            </div>

            <div className="fx-form-grid">
              <div className="fx-field">
                <label>Domaine</label>
                <select value={domaine} onChange={(e) => setDomaine(e.target.value)}>
                  {DOMAINES_PRESETS.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div className="fx-field">
                <label>Niveau de rigueur</label>
                <select value={niveau} onChange={(e) => setNiveau(e.target.value as any)}>
                  <option value="grand-public">Grand-public</option>
                  <option value="professionnel">Professionnel</option>
                  <option value="audit-grade">Audit-grade (production)</option>
                </select>
              </div>
              <div className="fx-field fx-field-full">
                <label>Mandat *</label>
                <input type="text" value={mandat} onChange={(e) => setMandat(e.target.value)}
                  placeholder="Ex : Synthèse TPS/TVQ commerce de détail 2026" />
              </div>
              <div className="fx-field fx-field-full">
                <label>Description du mandat</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder="Contexte, enjeux, périmètre attendu…" />
              </div>
              <div className="fx-field">
                <label>Pages cibles</label>
                <input type="number" value={nbPages} onChange={(e) => setNbPages(Number(e.target.value))} min={5} max={80} />
              </div>
              <div className="fx-field">
                <label>Budget max (€)</label>
                <input type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value))} min={1} />
              </div>
              <div className="fx-field">
                <label>Temps max (min)</label>
                <input type="number" value={tempsMax} onChange={(e) => setTempsMax(Number(e.target.value))} min={15} />
              </div>
              <div className="fx-field">
                <label>Sensibilité</label>
                <select value={sensibilite} onChange={(e) => setSensibilite(e.target.value as any)}>
                  <option value="public">Public</option>
                  <option value="professionnel">Professionnel</option>
                  <option value="confidentiel-client">Confidentiel-client (Ollama local)</option>
                </select>
                {sensibilite === 'confidentiel-client' && (
                  <div className="fx-conf-banner">
                    <span className="fx-conf-icon">🔒</span>
                    <div>
                      <b>Traitement 100% local.</b> Ollama obligatoire — aucun appel cloud ne sera
                      effectué. PII automatiquement masquée avant même l'envoi local. Conforme Loi 25
                      du Québec et secret professionnel CPA. Vérifie que <code>ollama serve</code> tourne.
                    </div>
                  </div>
                )}
              </div>
              <div className="fx-field fx-field-full">
                <label>Agents actifs sur le run</label>
                <AgentCheckboxSelector selectedAgents={agentsActifs} onChange={setAgentsActifs} />
                <span className="fx-hint">
                  Par défaut : CFO, FinanceAgent, CommsAgent, TaxAgent, AccountingAgent, AuditAgent, SupervisorAgent, ForecastAgent.
                </span>
              </div>
              <div className="fx-field fx-field-full">
                <label>Mode d'exploitation</label>
                <div className="fx-radio-cards">
                  <button className={`fx-radio-card ${modePilot ? 'on' : ''}`} onClick={() => setModePilot(true)} type="button">
                    <div><b>Pilot</b> <span className="fx-recommended">recommandé</span></div>
                    <div className="fx-radio-card-desc">CP1 + CP2 obligatoires · calibration des paramètres</div>
                  </button>
                  <button className={`fx-radio-card ${!modePilot ? 'on' : ''}`} onClick={() => setModePilot(false)} type="button">
                    <div><b>Production</b></div>
                    <div className="fx-radio-card-desc">CP1 seul · après validation de 2-3 pilotes réussis</div>
                  </button>
                </div>
              </div>
            </div>

            <div className="fx-launch-footer">
              <div className="fx-cost-estimate">
                <span className="fx-cost-label">Coût estimé</span>
                <span className="fx-cost-value">
                  {Math.round(budget * 0.7)}–{budget}€
                </span>
              </div>
              <button className="fx-btn fx-btn-primary fx-btn-lg" onClick={handleLaunch} disabled={launchMutation.isPending}>
                {launchMutation.isPending ? <><SpinnerIcon className="animate-spin" /> Lancement…</> : <>🚀 Lancer le run</>}
              </button>
            </div>
          </div>
        )}

        {/* ════════ TAB 2 — RUNS ════════ */}
        {tab === 'runs' && (
          <>
            {runsActive.length > 0 && (
              <div className="fx-section-title">
                <h3>● Runs actifs ({runsActive.length})</h3>
                <button className="fx-btn fx-btn-sm" onClick={() => refreshRuns()}>
                  {loadingRuns ? <SpinnerIcon className="animate-spin" /> : '↻ Rafraîchir'}
                </button>
              </div>
            )}
            {runsActive.map(r => (
              <RunCard key={r.run_id} run={r}
                expanded={expandedRun === r.run_id}
                onToggle={() => setExpandedRun(expandedRun === r.run_id ? null : r.run_id)}
                onCheckpoint={(cp, dec) => handleCheckpoint(r.run_id, cp, dec)} />
            ))}

            {runsFinished.length > 0 && (
              <div className="fx-section-title fx-section-title-past">
                <h3>Runs terminés ({runsFinished.length})</h3>
              </div>
            )}
            {runsFinished.map(r => (
              <RunCard key={r.run_id} run={r}
                expanded={expandedRun === r.run_id}
                onToggle={() => setExpandedRun(expandedRun === r.run_id ? null : r.run_id)}
                onCheckpoint={(cp, dec) => handleCheckpoint(r.run_id, cp, dec)} />
            ))}

            {runs.length === 0 && !loadingRuns && (
              <div className="fx-card fx-glass">
                <p className="fx-empty">
                  Aucun run pour le moment. Lance ton premier run dans l'onglet <b>🚀 Lancer un run</b>.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Factory;
