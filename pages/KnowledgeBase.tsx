/**
 * KnowledgeBase.tsx — Page unifiée d'injection et de gestion de la connaissance.
 *
 * Design : dark premium, gradients, glass morphism, animations GSAP.
 * Back    : /api/knowledge/* (ingest, list, patch, delete, start-factory-run)
 *
 * Architecture : types en haut, API helpers, sous-composants, composant principal.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { gsap } from 'gsap';
import Banner from '../components/Banner';
import AgentCheckboxSelector from '../components/AgentCheckboxSelector';
import { CheckIcon } from '../components/icons/CheckIcon';
import { SpinnerIcon } from '../components/icons/SpinnerIcon';
import { UploadIcon } from '../components/icons/UploadIcon';
import { CloseIcon } from '../components/icons/CloseIcon';
import { API_BASE_URL } from '../services/apiService';
import { agentDetails } from '../data/agents';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type Sensibilite = 'public' | 'professionnel' | 'confidentiel-client';
export type DocType = 'loi' | 'bulletin' | 'norme' | 'rapport-client' | 'manuel-interne' | 'jurisprudence' | 'autre';
export type IngestStatus = 'pending' | 'extracting' | 'embedding' | 'indexed' | 'failed';

export interface KnowledgeDoc {
  doc_id: string;
  filename: string;
  file_size_bytes?: number;
  file_type?: string;
  domaine: string;
  fiscal_year?: number;
  sensibilite: Sensibilite;
  doc_type: DocType;
  regulatory_refs: string[];
  tags: string[];
  agents_assigned: string[];
  client_id?: string;
  status: IngestStatus;
  status_message?: string;
  text_excerpt?: string;
  used_in_runs: string[];
  last_used_at?: string;
  use_count: number;
  version: number;
  uploaded_at: string;
}

export interface FactoryRunSummary {
  run_id: string;
  mandat: string;
  mode: 'factory' | 'client';
  status: string;
  pages_created: number;
  total_cost_eur: number;
  wall_time_minutes: number;
  docs_used: string[];
}

interface BulkMetadata {
  domaine: string;
  fiscal_year: number | '';
  sensibilite: Sensibilite;
  doc_type: DocType;
  tags: string[];
  agents_assigned: string[];
}

interface FileRefinement {
  domaine?: string;
  fiscal_year?: number;
  sensibilite?: Sensibilite;
  doc_type?: DocType;
}

interface FileProgress {
  id: string;
  name: string;
  status: 'uploading' | 'extracting' | 'embedding' | 'indexed' | 'failed';
  progress: number;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────────────

const DOMAINES_PRESETS = [
  'Fiscalité QC',
  'Fiscalité fédérale CA',
  'IFRS 16 — Contrats de location',
  'NCECF',
  'Audit interne (COSO)',
  'M&A — Due diligence',
  'Investissement / VAN-TRI',
  'Dérivés financiers',
  'Multi-domaine',
];

const DOC_TYPES: { value: DocType; label: string }[] = [
  { value: 'loi', label: 'Loi (LIR / LTVQ / LIQ / autre)' },
  { value: 'bulletin', label: 'Bulletin (CRA / ARQ)' },
  { value: 'norme', label: 'Norme (NCECF / IFRS)' },
  { value: 'rapport-client', label: 'Rapport client' },
  { value: 'manuel-interne', label: 'Manuel interne / SOP' },
  { value: 'jurisprudence', label: 'Jurisprudence' },
  { value: 'autre', label: 'Autre' },
];

const SENSIBILITE_LABELS: Record<Sensibilite, string> = {
  'public': 'Public',
  'professionnel': 'Professionnel',
  'confidentiel-client': 'Confidentiel-client',
};

const ACCEPT_EXTENSIONS = '.pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.csv,.txt,.md,.json,.xml,.rtf,.odt,.png,.jpg,.jpeg';

type TabKey = 'inject' | 'explorer' | 'runs';
type InjectStep = 1 | 2 | 3 | 4;

// ─────────────────────────────────────────────────────────────────────────────
// API HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function kbIngest(
  files: File[],
  bulk: BulkMetadata,
  refinements: Record<string, FileRefinement>,
  signal?: AbortSignal,
): Promise<KnowledgeDoc[]> {
  const formData = new FormData();
  files.forEach(f => formData.append('files', f));
  formData.append('bulk_metadata', JSON.stringify(bulk));
  formData.append('per_file_refinements', JSON.stringify(refinements));
  const response = await fetch(`${API_BASE_URL}/api/knowledge/ingest`, {
    method: 'POST', body: formData, signal,
  });
  if (!response.ok) throw new Error(`Ingest failed: HTTP ${response.status}`);
  const data = await response.json();
  return data.documents as KnowledgeDoc[];
}

async function kbList(filters: {
  q?: string; domaine?: string; sensibilite?: Sensibilite | ''; agent?: string; year?: number | '';
} = {}): Promise<KnowledgeDoc[]> {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.domaine) params.set('domaine', filters.domaine);
  if (filters.sensibilite) params.set('sensibilite', filters.sensibilite);
  if (filters.agent) params.set('agent', filters.agent);
  if (filters.year) params.set('year', String(filters.year));
  const response = await fetch(`${API_BASE_URL}/api/knowledge/list?${params.toString()}`);
  if (!response.ok) throw new Error(`List failed: HTTP ${response.status}`);
  const data = await response.json();
  return (data.documents ?? []) as KnowledgeDoc[];
}

async function kbDelete(doc_id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/knowledge/${doc_id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Delete failed: HTTP ${response.status}`);
}

async function startFactoryRun(doc_ids: string[], runConfig: {
  mandat: string; description?: string; nb_pages_cible: number; budget_max_eur: number;
  niveau_rigueur: 'grand-public' | 'professionnel' | 'audit-grade'; mode_pilot: boolean;
}): Promise<{ run_id: string }> {
  const response = await fetch(`${API_BASE_URL}/api/knowledge/start-factory-run`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc_ids, run_config: runConfig }),
  });
  if (!response.ok) throw new Error(`Start run failed: HTTP ${response.status}`);
  return await response.json();
}

async function kbListRuns(): Promise<FactoryRunSummary[]> {
  const response = await fetch(`${API_BASE_URL}/api/cfo-kf/runs`);
  if (!response.ok) return [];
  const data = await response.json();
  return (data.runs ?? []) as FactoryRunSummary[];
}

// ─────────────────────────────────────────────────────────────────────────────
// SOUS-COMPOSANTS
// ─────────────────────────────────────────────────────────────────────────────

const ChipsInput: React.FC<{
  values: string[]; onChange: (next: string[]) => void; placeholder?: string;
}> = ({ values, onChange, placeholder = 'Entrée pour ajouter…' }) => {
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setInput('');
  };
  return (
    <div className="kb-chips" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
      {values.map(v => (
        <span key={v} className="kb-chip">
          {v}
          <span className="kb-chip-x" onClick={(e) => { e.stopPropagation(); onChange(values.filter(x => x !== v)); }}>×</span>
        </span>
      ))}
      <input
        type="text" value={input} onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        onBlur={add} placeholder={placeholder}
      />
    </div>
  );
};

const Dropzone: React.FC<{ onFilesPicked: (files: File[]) => void }> = ({ onFilesPicked }) => {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dzRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dzRef.current) return;
    gsap.fromTo(dzRef.current,
      { opacity: 0, y: 20, scale: 0.98 },
      { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'power3.out' }
    );
  }, []);

  useEffect(() => {
    if (!dzRef.current) return;
    if (over) {
      gsap.to(dzRef.current, { scale: 1.01, duration: 0.2, ease: 'power2.out' });
    } else {
      gsap.to(dzRef.current, { scale: 1, duration: 0.2, ease: 'power2.out' });
    }
  }, [over]);

  return (
    <div
      ref={dzRef}
      className={`kb-dropzone ${over ? 'drag-over' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files?.length) onFilesPicked(Array.from(e.dataTransfer.files));
      }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
    >
      <input ref={inputRef} type="file" className="sr-only" accept={ACCEPT_EXTENSIONS} multiple
        onChange={(e) => { if (e.target.files) onFilesPicked(Array.from(e.target.files)); }} />
      <div className="kb-dropzone-glow"></div>
      <div className="kb-dropzone-content">
        <div className="kb-dropzone-icon"><UploadIcon /></div>
        <h2 className="kb-dropzone-title">Déposez vos documents-source ici</h2>
        <p className="kb-dropzone-subtitle">
          PDF, Word, Excel, CSV, TXT, MD, PPTX, images — glissez-déposez ou cliquez
        </p>
        <button type="button" className="kb-btn kb-btn-primary"
          onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
          Sélectionner des fichiers
        </button>
      </div>
    </div>
  );
};

const BulkMetadataForm: React.FC<{
  value: BulkMetadata; onChange: (next: BulkMetadata) => void;
}> = ({ value, onChange }) => {
  const update = <K extends keyof BulkMetadata>(k: K, v: BulkMetadata[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="kb-form-grid">
      <div className="kb-field">
        <label>Domaine</label>
        <select value={value.domaine} onChange={(e) => update('domaine', e.target.value)}>
          {DOMAINES_PRESETS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <div className="kb-field">
        <label>Année fiscale</label>
        <input type="number" value={value.fiscal_year}
          onChange={(e) => update('fiscal_year', e.target.value === '' ? '' : Number(e.target.value))} />
      </div>
      <div className="kb-field">
        <label>Type de document</label>
        <select value={value.doc_type} onChange={(e) => update('doc_type', e.target.value as DocType)}>
          {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <div className="kb-field">
        <label>Sensibilité</label>
        <div className="kb-radios">
          {(['public', 'professionnel', 'confidentiel-client'] as Sensibilite[]).map(s => (
            <label key={s} className={value.sensibilite === s ? 'active' : ''}>
              <input type="radio" name="kb-sens" checked={value.sensibilite === s}
                onChange={() => update('sensibilite', s)} />
              <span>{SENSIBILITE_LABELS[s]}</span>
            </label>
          ))}
        </div>
        {value.sensibilite === 'confidentiel-client' && (
          <span className="kb-hint kb-hint-warn">
            ⚠ "Confidentiel-client" force Ollama local — aucun envoi cloud (Loi 25 + secret professionnel CPA).
          </span>
        )}
      </div>
      <div className="kb-field kb-field-full">
        <label>Tags additionnels</label>
        <ChipsInput values={value.tags} onChange={(t) => update('tags', t)} />
      </div>
      <div className="kb-field kb-field-full">
        <label>Agents assignés (qui peuvent puiser dans ce doc)</label>
        <AgentCheckboxSelector selectedAgents={value.agents_assigned}
          onChange={(a) => update('agents_assigned', a)} />
        <span className="kb-hint">Si aucun agent coché, tous les agents y ont accès (recommandé pour docs publics).</span>
      </div>
    </div>
  );
};

const PerFileRefinement: React.FC<{
  files: File[]; refinements: Record<string, FileRefinement>;
  onChange: (fileKey: string, patch: FileRefinement) => void;
}> = ({ files, refinements, onChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    gsap.fromTo(containerRef.current.children,
      { opacity: 0, x: -10 },
      { opacity: 1, x: 0, duration: 0.4, stagger: 0.05, ease: 'power2.out' }
    );
  }, []);
  return (
    <div ref={containerRef} className="kb-refine-rows">
      {files.map((f, i) => {
        const key = `${f.name}-${i}`;
        const r = refinements[key] ?? {};
        return (
          <div key={key} className="kb-refine-row">
            <span className="kb-refine-name">📄 {f.name}</span>
            <select value={r.domaine ?? ''} onChange={(e) => onChange(key, { ...r, domaine: e.target.value || undefined })}>
              <option value="">Hérité du lot</option>
              {DOMAINES_PRESETS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <input type="number" value={r.fiscal_year ?? ''} placeholder="Année"
              onChange={(e) => onChange(key, { ...r, fiscal_year: e.target.value ? Number(e.target.value) : undefined })} />
            <select value={r.sensibilite ?? ''} onChange={(e) => onChange(key, { ...r, sensibilite: (e.target.value || undefined) as Sensibilite | undefined })}>
              <option value="">Hérité</option>
              <option value="public">Public</option>
              <option value="professionnel">Pro</option>
              <option value="confidentiel-client">Conf</option>
            </select>
          </div>
        );
      })}
    </div>
  );
};

const FactoryRunModal: React.FC<{
  selectedDocs: KnowledgeDoc[];
  onClose: () => void;
  onLaunched: (runId: string) => void;
}> = ({ selectedDocs, onClose, onLaunched }) => {
  const [mandat, setMandat] = useState('');
  const [description, setDescription] = useState('');
  const [nbPages, setNbPages] = useState(30);
  const [budget, setBudget] = useState(15);
  const [niveau, setNiveau] = useState<'grand-public' | 'professionnel' | 'audit-grade'>('professionnel');
  const [modePilot, setModePilot] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!overlayRef.current || !modalRef.current) return;
    gsap.fromTo(overlayRef.current, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power2.out' });
    gsap.fromTo(modalRef.current,
      { opacity: 0, scale: 0.95, y: 10 },
      { opacity: 1, scale: 1, y: 0, duration: 0.35, ease: 'power3.out' }
    );
  }, []);

  const domainesUniques = useMemo(() => Array.from(new Set(selectedDocs.map(d => d.domaine))), [selectedDocs]);
  const sensibiliteMax: Sensibilite = useMemo(() => {
    if (selectedDocs.some(d => d.sensibilite === 'confidentiel-client')) return 'confidentiel-client';
    if (selectedDocs.some(d => d.sensibilite === 'professionnel')) return 'professionnel';
    return 'public';
  }, [selectedDocs]);

  const handleClose = () => {
    if (!overlayRef.current || !modalRef.current) { onClose(); return; }
    gsap.to(modalRef.current, { opacity: 0, scale: 0.95, y: 10, duration: 0.2 });
    gsap.to(overlayRef.current, { opacity: 0, duration: 0.2, onComplete: onClose });
  };

  const handleLaunch = async () => {
    if (!mandat.trim()) { setError('Le mandat est requis.'); return; }
    setLaunching(true); setError(null);
    try {
      const { run_id } = await startFactoryRun(
        selectedDocs.map(d => d.doc_id),
        { mandat, description, nb_pages_cible: nbPages, budget_max_eur: budget, niveau_rigueur: niveau, mode_pilot: modePilot },
      );
      onLaunched(run_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div ref={overlayRef} className="kb-modal-overlay" onClick={handleClose}>
      <div ref={modalRef} className="kb-modal kb-glass" onClick={(e) => e.stopPropagation()}>
        <div className="kb-modal-header">
          <h2>⚙ Démarrer un run CFO Knowledge Factory</h2>
          <button className="kb-icon-btn" onClick={handleClose} aria-label="Fermer">×</button>
        </div>
        <p className="kb-modal-sub">
          Mode Client — les {selectedDocs.length} document(s) sélectionné(s) serviront de sources d'analyse.
        </p>
        {error && <Banner type="error" message={error} />}

        <div className="kb-form-grid" style={{ marginTop: 14 }}>
          <div className="kb-field kb-field-full">
            <label>Documents sources</label>
            <div className="kb-chips" style={{ cursor: 'default' }}>
              {selectedDocs.map(d => <span key={d.doc_id} className="kb-chip">{d.filename}</span>)}
            </div>
            <span className="kb-hint">
              Domaine(s) : <b>{domainesUniques.join(', ')}</b> · Sensibilité retenue : <b>{SENSIBILITE_LABELS[sensibiliteMax]}</b>
            </span>
          </div>
          <div className="kb-field kb-field-full">
            <label>Mandat</label>
            <input type="text" value={mandat} onChange={(e) => setMandat(e.target.value)}
              placeholder="Ex : Synthèse TPS/TVQ commerce de détail 2026" />
          </div>
          <div className="kb-field kb-field-full">
            <label>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Contexte du mandat (optionnel)…" />
          </div>
          <div className="kb-field">
            <label>Pages cibles</label>
            <input type="number" value={nbPages} onChange={(e) => setNbPages(Number(e.target.value))} min={5} max={80} />
          </div>
          <div className="kb-field">
            <label>Budget max (€)</label>
            <input type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value))} min={1} />
          </div>
          <div className="kb-field">
            <label>Niveau de rigueur</label>
            <select value={niveau} onChange={(e) => setNiveau(e.target.value as any)}>
              <option value="grand-public">Grand-public</option>
              <option value="professionnel">Professionnel</option>
              <option value="audit-grade">Audit-grade</option>
            </select>
          </div>
          <div className="kb-field">
            <label>Mode</label>
            <select value={modePilot ? 'pilot' : 'prod'} onChange={(e) => setModePilot(e.target.value === 'pilot')}>
              <option value="pilot">Pilot (CP1+CP2 obligatoires)</option>
              <option value="prod">Production (CP1 seul)</option>
            </select>
          </div>
        </div>

        <div className="kb-modal-foot">
          <button className="kb-btn" onClick={handleClose} disabled={launching}>Annuler</button>
          <button className="kb-btn kb-btn-primary" onClick={handleLaunch} disabled={launching}>
            {launching ? <><SpinnerIcon className="animate-spin" /> Lancement…</> : '🚀 Lancer le run'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

const KnowledgeBase: React.FC = () => {
  const [tab, setTab] = useState<TabKey>('inject');
  const pageRef = useRef<HTMLDivElement>(null);
  const tabPanelRef = useRef<HTMLDivElement>(null);

  // Inject state
  const [step, setStep] = useState<InjectStep>(1);
  const [files, setFiles] = useState<File[]>([]);
  const [bulk, setBulk] = useState<BulkMetadata>({
    domaine: DOMAINES_PRESETS[0],
    fiscal_year: new Date().getFullYear(),
    sensibilite: 'professionnel',
    doc_type: 'autre',
    tags: [], agents_assigned: [],
  });
  const [refinements, setRefinements] = useState<Record<string, FileRefinement>>({});
  const [progresses, setProgresses] = useState<FileProgress[]>([]);
  const [ingestError, setIngestError] = useState<string | null>(null);

  // Explorer state
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [fDomaine, setFDomaine] = useState('');
  const [fYear, setFYear] = useState<number | ''>('');
  const [fSens, setFSens] = useState<Sensibilite | ''>('');
  const [fAgent, setFAgent] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // React Query: Docs List
  const { data: docs = [], isFetching: loadingDocs, error: docsQueryError, refetch: refreshDocs } = useQuery({
    queryKey: ['kb-docs', search, fDomaine, fSens, fAgent, fYear],
    queryFn: () => kbList({ q: search, domaine: fDomaine, sensibilite: fSens, agent: fAgent, year: fYear }),
    enabled: tab === 'explorer',
  });
  const docsError = docsQueryError ? (docsQueryError as Error).message : null;

  const [factoryOpen, setFactoryOpen] = useState(false);

  // React Query: Runs List
  const { data: runs = [] } = useQuery({
    queryKey: ['factory-runs'],
    queryFn: kbListRuns,
    enabled: tab === 'runs',
  });

  // GSAP page entrance
  useEffect(() => {
    if (!pageRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo('.kb-page-title',
        { opacity: 0, y: -15 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' });
      gsap.fromTo('.kb-page-subtitle',
        { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.6, delay: 0.1, ease: 'power3.out' });
      gsap.fromTo('.kb-tab',
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.08, delay: 0.2, ease: 'power2.out' });
    }, pageRef);
    return () => ctx.revert();
  }, []);

  // GSAP tab transition
  useEffect(() => {
    if (!tabPanelRef.current) return;
    gsap.fromTo(tabPanelRef.current,
      { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out' });
  }, [tab]);

  // Mutations
  const deleteMutation = useMutation({
    mutationFn: kbDelete,
    onSuccess: (_, deletedId) => {
      setSelectedIds(prev => { const n = new Set(prev); n.delete(deletedId); return n; });
      queryClient.invalidateQueries({ queryKey: ['kb-docs'] });
    },
    onError: (e) => {
      alert(`Erreur suppression : ${e instanceof Error ? e.message : 'inconnue'}`);
    }
  });

  const onFilesPicked = (newFiles: File[]) => {
    setFiles(prev => [...prev, ...newFiles]);
    setIngestError(null);
  };
  const removeFile = (i: number) => setFiles(prev => prev.filter((_, idx) => idx !== i));
  const clearFiles = () => { setFiles([]); setRefinements({}); };

  const goStep = (n: InjectStep) => {
    setStep(n);
  };

  const startIngestion = async () => {
    if (files.length === 0) return;
    setStep(4); setIngestError(null);
    setProgresses(files.map((f, i) => ({
      id: `${f.name}-${i}`, name: f.name, status: 'uploading', progress: 0,
    })));
    try {
      const interval = setInterval(() => {
        setProgresses(prev => prev.map(p => p.status === 'uploading'
          ? { ...p, progress: Math.min(p.progress + Math.random() * 18, 95) } : p));
      }, 250);
      await kbIngest(files, bulk, refinements);
      clearInterval(interval);
      setProgresses(prev => prev.map(p => ({ ...p, status: 'indexed', progress: 100 })));
      queryClient.invalidateQueries({ queryKey: ['kb-docs'] });
    } catch (e) {
      setIngestError(e instanceof Error ? e.message : 'Erreur d\'ingestion');
      setProgresses(prev => prev.map(p => ({ ...p, status: 'failed', error: 'Échec' })));
    }
  };

  const finishIngest = () => {
    clearFiles(); setProgresses([]); setStep(1); setTab('explorer');
  };

  const selectedDocs = useMemo(() => docs.filter(d => selectedIds.has(d.doc_id)), [docs, selectedIds]);

  const toggleSel = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllSel = (checked: boolean) => {
    setSelectedIds(checked ? new Set(docs.map(d => d.doc_id)) : new Set());
  };

  const handleDelete = (docId: string) => {
    if (!confirm('Supprimer ce document de la KB ? Cette action est irréversible.')) return;
    deleteMutation.mutate(docId);
  };

  return (
    <div ref={pageRef} className="page-container kb-page">
      <div className="kb-hero">
        <h1 className="kb-page-title">📚 Expertise Métier</h1>
        <p className="kb-page-subtitle">
          Base de connaissances partagée : lois, règlements, normes (IFRS/NCECF) et doctrine fiscale. 
          Ces documents constituent le socle de compétences de vos agents IA.
        </p>
      </div>

      <div className="kb-tabs">
        <button className={`kb-tab ${tab === 'inject' ? 'on' : ''}`} onClick={() => setTab('inject')}>
          <span className="kb-tab-icon">📥</span> Injecter
        </button>
        <button className={`kb-tab ${tab === 'explorer' ? 'on' : ''}`} onClick={() => setTab('explorer')}>
          <span className="kb-tab-icon">🔍</span> Explorer la KB
          {docs.length > 0 && <span className="kb-tab-count">{docs.length}</span>}
        </button>
        <button className={`kb-tab ${tab === 'runs' ? 'on' : ''}`} onClick={() => setTab('runs')}>
          <span className="kb-tab-icon">⚙</span> Usage Factory
          {runs.length > 0 && <span className="kb-tab-count">{runs.length}</span>}
        </button>
      </div>

      <div ref={tabPanelRef} className="kb-tab-panel">

        {/* ════════ TAB 1 — INJECT ════════ */}
        {tab === 'inject' && (
          <>
            <div className="kb-steps">
              {[1, 2, 3, 4].map(n => (
                <React.Fragment key={n}>
                  <div className={`kb-step ${step === n ? 'on' : step > n ? 'done' : ''}`}>
                    <span className="kb-step-num">{step > n ? '✓' : n}</span>
                    <span>{['Sélection', 'Métadonnées', 'Affinage', 'Ingestion'][n - 1]}</span>
                  </div>
                  {n < 4 && <span className="kb-step-sep">›</span>}
                </React.Fragment>
              ))}
            </div>

            {step === 1 && (
              <div className="kb-card kb-glass">
                <Dropzone onFilesPicked={onFilesPicked} />
                {files.length > 0 && (
                  <>
                    <div className="kb-section">
                      <h3>Fichiers sélectionnés ({files.length})</h3>
                      <ul className="kb-file-list">
                        {files.map((f, i) => (
                          <li key={`${f.name}-${i}`} className="kb-file-item">
                            <span className="kb-file-name">📄 {f.name}</span>
                            <span className="kb-file-size">{(f.size / 1024).toFixed(1)} KB</span>
                            <button className="kb-icon-btn" onClick={() => removeFile(i)} aria-label="Retirer">×</button>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="kb-foot">
                      <button className="kb-btn" onClick={clearFiles}>Vider la sélection</button>
                      <button className="kb-btn kb-btn-primary" onClick={() => goStep(2)}>
                        Suivant : métadonnées <span className="kb-arrow">→</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="kb-card kb-glass">
                <div className="kb-card-header">
                  <h2>📋 Métadonnées appliquées au lot</h2>
                </div>
                <p className="kb-section-sub">
                  Les valeurs ci-dessous s'appliquent à tous les fichiers sélectionnés. Affinage par fichier possible à l'étape suivante.
                </p>
                <BulkMetadataForm value={bulk} onChange={setBulk} />
                <div className="kb-foot">
                  <button className="kb-btn" onClick={() => goStep(1)}>← Retour</button>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="kb-btn" onClick={startIngestion}>Ignorer et ingérer</button>
                    <button className="kb-btn kb-btn-primary" onClick={() => goStep(3)}>
                      Affiner par fichier <span className="kb-arrow">→</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="kb-card kb-glass">
                <div className="kb-card-header">
                  <h2>🔧 Affinage par fichier</h2>
                </div>
                <p className="kb-section-sub">
                  Override des champs si différents pour certains fichiers. "Hérité du lot" = utilise les valeurs de l'étape 2.
                </p>
                <PerFileRefinement files={files} refinements={refinements}
                  onChange={(k, patch) => setRefinements(prev => ({ ...prev, [k]: patch }))} />
                <div className="kb-foot">
                  <button className="kb-btn" onClick={() => goStep(2)}>← Retour</button>
                  <button className="kb-btn kb-btn-primary" onClick={startIngestion}>
                    Démarrer l'ingestion <span className="kb-arrow">→</span>
                  </button>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="kb-card kb-glass">
                <div className="kb-card-header">
                  <h2>{ingestError ? 'Échec du téléversement' : '🚀 Ingestion en cours…'}</h2>
                </div>
                <p className="kb-section-sub">
                  Extraction de texte, embedding (intfloat/multilingual-e5-large), indexation pgvector.
                </p>
                {ingestError && <Banner type="error" message={ingestError} />}
                <ul className="kb-progress-list">
                  {progresses.map(p => (
                    <li key={p.id} className={`kb-progress-item kb-progress-${p.status}`}>
                      <div className="kb-progress-icon">
                        {p.status === 'uploading' && <SpinnerIcon className="animate-spin" />}
                        {p.status === 'indexed' && <CheckIcon className="icon-success" />}
                        {p.status === 'failed' && <CloseIcon className="icon-error" />}
                      </div>
                      <div className="kb-progress-details">
                        <span className="kb-progress-name" title={p.name}>{p.name}</span>
                        <span className="kb-progress-status">
                          {p.status === 'uploading' && 'Téléversement + traitement…'}
                          {p.status === 'indexed' && '✓ Indexé · embedding 1024d'}
                          {p.status === 'failed' && (p.error ?? 'Échec')}
                        </span>
                        {p.status === 'uploading' && (
                          <div className="kb-progress-bar">
                            <div className="kb-progress-fill" style={{ width: `${p.progress}%` }} />
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="kb-foot">
                  {progresses.every(p => p.status === 'indexed' || p.status === 'failed') && (
                    <button className="kb-btn kb-btn-primary" onClick={finishIngest}>
                      ✓ Terminé — voir l'Explorer
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* ════════ TAB 2 — EXPLORER ════════ */}
        {tab === 'explorer' && (
          <div className="kb-card kb-glass">
            <div className="kb-filter-bar">
              <input className="kb-search-input" type="text" placeholder="🔍 Rechercher…"
                value={search} onChange={(e) => setSearch(e.target.value)} />
              <select value={fDomaine} onChange={(e) => setFDomaine(e.target.value)}>
                <option value="">Tous domaines</option>
                {DOMAINES_PRESETS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <input type="number" placeholder="Année" value={fYear}
                onChange={(e) => setFYear(e.target.value === '' ? '' : Number(e.target.value))} />
              <select value={fSens} onChange={(e) => setFSens(e.target.value as Sensibilite | '')}>
                <option value="">Toutes sensibilités</option>
                <option value="public">Public</option>
                <option value="professionnel">Professionnel</option>
                <option value="confidentiel-client">Confidentiel-client</option>
              </select>
              <select value={fAgent} onChange={(e) => setFAgent(e.target.value)}>
                <option value="">Tous agents</option>
                {agentDetails.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
              </select>
              <button className="kb-btn" onClick={() => refreshDocs()}>
                {loadingDocs ? <SpinnerIcon className="animate-spin" /> : '↻ Rafraîchir'}
              </button>
            </div>

            {docsError && <Banner type="error" message={docsError} />}

            <div className="kb-table-wrap">
              <table className="kb-table">
                <thead>
                  <tr>
                    <th className="kb-cb-cell">
                      <input type="checkbox" onChange={(e) => toggleAllSel(e.target.checked)}
                        checked={docs.length > 0 && docs.every(d => selectedIds.has(d.doc_id))} />
                    </th>
                    <th>Document</th>
                    <th>Domaine</th>
                    <th>Année</th>
                    <th>Sensibilité</th>
                    <th>Agents</th>
                    <th>Statut</th>
                    <th>Runs</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.doc_id} className={selectedIds.has(d.doc_id) ? 'selected' : ''}>
                      <td className="kb-cb-cell">
                        <input type="checkbox" checked={selectedIds.has(d.doc_id)} onChange={() => toggleSel(d.doc_id)} />
                      </td>
                      <td>
                        <div className="kb-doc-name">📄 {d.filename}</div>
                        <div className="kb-doc-meta">
                          {d.file_size_bytes ? `${(d.file_size_bytes / 1024).toFixed(0)} KB · ` : ''}
                          uploadé le {new Date(d.uploaded_at).toLocaleDateString('fr-CA')}
                        </div>
                      </td>
                      <td><span className="kb-badge kb-badge-dom">{d.domaine}</span></td>
                      <td>{d.fiscal_year ? <span className="kb-badge kb-badge-year">{d.fiscal_year}</span> : '—'}</td>
                      <td><span className={`kb-badge kb-badge-sens-${d.sensibilite.replace('-client', '')}`}>
                        {SENSIBILITE_LABELS[d.sensibilite]}
                      </span></td>
                      <td>
                        {d.agents_assigned.length === 0 ? (
                          <span className="kb-muted">Tous</span>
                        ) : (
                          <span className="kb-muted">
                            {d.agents_assigned.slice(0, 2).join(', ')}
                            {d.agents_assigned.length > 2 && ` +${d.agents_assigned.length - 2}`}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`kb-badge kb-badge-status-${d.status}`}>
                          {d.status === 'indexed' ? '✓ Indexé' :
                           d.status === 'failed' ? '✗ Échec' :
                           d.status === 'embedding' ? '◷ Embedding…' :
                           d.status === 'extracting' ? '◷ Extraction…' : '◷ En attente'}
                        </span>
                      </td>
                      <td>
                        {d.use_count > 0
                          ? <span className="kb-badge kb-badge-runs" title={`${d.use_count} runs Factory`}>⚙ {d.use_count}</span>
                          : <span className="kb-muted">—</span>}
                      </td>
                      <td>
                        <button className="kb-btn kb-btn-sm kb-btn-danger" onClick={() => handleDelete(d.doc_id)}>
                          Supprimer
                        </button>
                      </td>
                    </tr>
                  ))}
                  {docs.length === 0 && !loadingDocs && (
                    <tr><td colSpan={9} className="kb-empty">
                      Aucun document — commence par l'onglet <b>Injecter</b>.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {selectedIds.size > 0 && (
              <div className="kb-actions-bar">
                <span className="kb-selected-count">
                  <span className="kb-pulse-dot"></span>
                  {selectedIds.size} document(s) sélectionné(s)
                </span>
                <div style={{ flex: 1 }} />
                <button className="kb-btn">Réassigner agents</button>
                <button className="kb-btn">Exporter CSV</button>
                <button className="kb-btn kb-btn-primary" onClick={() => setFactoryOpen(true)}>
                  ⚙ Démarrer un run Factory <span className="kb-arrow">→</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* ════════ TAB 3 — RUNS ════════ */}
        {tab === 'runs' && (
          <div className="kb-card kb-glass">
            <div className="kb-card-header">
              <h2>⚙ Runs Factory récents</h2>
            </div>
            <p className="kb-section-sub">
              Vue inversée — pour chaque run du pipeline CFO Knowledge Factory, quels documents de la KB ont été consommés.
            </p>
            {runs.length === 0 && (
              <p className="kb-empty">
                Aucun run Factory pour le moment. Sélectionne des documents dans l'Explorer et lance un run.
              </p>
            )}
            <div className="kb-runs-list">
              {runs.map(r => (
                <div key={r.run_id} className="kb-run-card">
                  <div className="kb-run-header">
                    <div>
                      <div className="kb-run-id">{r.run_id}</div>
                      <div className="kb-run-mandat">{r.mandat}</div>
                      <div className="kb-run-meta">
                        <span>📦 <b>{r.mode}</b></span>
                        <span>📄 {r.pages_created} pages</span>
                        <span>💰 {r.total_cost_eur.toFixed(2)}€</span>
                        <span>⏱ {r.wall_time_minutes}min</span>
                      </div>
                    </div>
                    <span className={`kb-badge kb-badge-status-${r.status === 'COMPLETED' ? 'indexed' : 'pending'}`}>
                      {r.status}
                    </span>
                  </div>
                  <div className="kb-run-docs">
                    <b>Documents consommés :</b> {r.docs_used.length}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {factoryOpen && (
        <FactoryRunModal
          selectedDocs={selectedDocs}
          onClose={() => setFactoryOpen(false)}
          onLaunched={(run_id) => {
            setFactoryOpen(false);
            setSelectedIds(new Set());
            alert(`🚀 Run lancé : ${run_id}\n\nRendez-vous dans la page Factory pour suivre la progression.`);
          }}
        />
      )}
    </div>
  );
};

export default KnowledgeBase;
