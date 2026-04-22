import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Document } from '../types';
import { ContextIcon } from '../components/icons/ContextIcon';
import { CloseIcon } from '../components/icons/CloseIcon';
import { gsap } from 'gsap';
import { RagIcon } from '../components/icons/RagIcon';
import AgentCheckboxSelector from '../components/AgentCheckboxSelector';

const StatusBadge: React.FC<{ status: Document['status'] }> = ({ status }) => {
    const statusClassMap = {
        'Traité': 'processed',
        'En cours': 'in-progress',
        'En attente': 'queued',
        'Échoué': 'failed'
    };
    const statusClass = statusClassMap[status] || 'default';
    return <span className={`status-badge status-badge--${statusClass}`}>{status}</span>
}

const Tag: React.FC<{ tag: string }> = ({ tag }) => (
    <span className="tag-badge">{tag}</span>
)

interface ExploreProps {
    documents: Document[];
    ragContext: Document | null;
    setRagContext: (doc: Document | null) => void;
    updateDocumentAgents: (docId: number | string, newAgents: string[]) => void;
    removeDocument?: (docId: number | string) => void;
}

const Explore: React.FC<ExploreProps> = ({ documents, ragContext, setRagContext, updateDocumentAgents, removeDocument }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const tableRef = useRef<HTMLTableSectionElement>(null);
  
  const removeDuplicates = () => {
    const seen = new Map<string, Document>();
    const toRemove: (number | string)[] = [];
    
    documents.forEach(doc => {
      if (seen.has(doc.name)) {
        // Doublon trouvé
        const existing = seen.get(doc.name)!;
        const existingAgents = existing.agents?.length || 0;
        const currentAgents = doc.agents?.length || 0;
        
        // Garder celui avec le plus d'agents
        if (currentAgents > existingAgents) {
          toRemove.push(existing.id);
          seen.set(doc.name, doc);
        } else {
          toRemove.push(doc.id);
        }
      } else {
        seen.set(doc.name, doc);
      }
    });
    
    if (toRemove.length === 0) {
      alert('✅ Aucun doublon trouvé !');
      return;
    }
    
    // PREMIÈRE CONFIRMATION
    const firstConfirm = confirm(
      `⚠️ ATTENTION - Suppression de doublons\n\n` +
      `${toRemove.length} doublon(s) seront supprimé(s)\n` +
      `${seen.size} documents uniques seront conservés\n\n` +
      `Cette action ne peut pas être annulée.\n\n` +
      `Voulez-vous continuer ?`
    );
    
    if (!firstConfirm) {
      return;
    }
    
    // DEUXIÈME CONFIRMATION
    const secondConfirm = confirm(
      `🗑️ CONFIRMATION FINALE\n\n` +
      `Êtes-vous VRAIMENT sûr de vouloir supprimer ${toRemove.length} document(s) ?\n\n` +
      `Cliquez sur OK pour confirmer la suppression.`
    );
    
    if (secondConfirm && removeDocument) {
      toRemove.forEach(id => removeDocument(id));
      alert(`✅ ${toRemove.length} doublon(s) supprimé(s) avec succès !`);
    }
  };

  const filteredDocuments = useMemo(() => documents.filter(doc => 
    doc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    doc.agents.some(agent => agent.toLowerCase().includes(searchTerm.toLowerCase())) ||
    doc.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()))
  ), [documents, searchTerm]);

  useEffect(() => {
    const rows = tableRef.current?.children;
    if (rows) {
      gsap.fromTo(rows,
        { opacity: 0, x: -20 },
        { opacity: 1, x: 0, stagger: 0.08, duration: 0.5, ease: 'power3.out' }
      );
    }
  }, [filteredDocuments]);

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Explorateur RAG</h1>
        <button 
          onClick={removeDuplicates}
          className="admin-button"
          style={{ 
            background: 'var(--accent-red)', 
            color: 'white',
            padding: '0.75rem 1.5rem',
            borderRadius: '8px',
            border: 'none',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
          onMouseOver={(e) => e.currentTarget.style.opacity = '0.85'}
          onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
        >
          🗑️ Supprimer les doublons ({documents.length} docs)
        </button>
      </div>

      <input
        type="text"
        placeholder="Rechercher par nom, agent, ou tag..."
        className="search-input"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />

      <div className="table-container">
        <div style={{ overflowX: 'auto', overflowY: 'visible' }}>
          <table className="explore-table">
            <thead>
              <tr>
                <th>Nom du Document</th>
                <th>Statut</th>
                <th>Date d'Upload</th>
                <th>Agent Assigné</th>
                <th>Tags</th>
                <th style={{ textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody ref={tableRef}>
              {filteredDocuments.length > 0 ? (
                filteredDocuments.map(doc => {
                  const isSelected = ragContext?.id === doc.id;
                  return (
                  <tr key={doc.id} className={isSelected ? 'selected' : ''}>
                    <td style={{ fontWeight: 500 }}>{doc.name}</td>
                    <td><StatusBadge status={doc.status} /></td>
                    <td style={{ color: 'var(--secondary-text)' }}>{doc.uploaded}</td>
                    <td>
                      <AgentCheckboxSelector
                        selectedAgents={doc.agents}
                        onChange={(newAgents) => updateDocumentAgents(doc.id, newAgents)}
                      />
                    </td>
                    <td>
                        <div className="tag-list">
                            {doc.tags.map(tag => <Tag key={tag} tag={tag} />)}
                        </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', alignItems: 'center' }}>
                          <button 
                              onClick={() => setRagContext(isSelected ? null : doc)}
                              className={`action-button ${isSelected ? 'selected' : ''}`}
                              title={isSelected ? "Retirer le contexte" : "Utiliser comme contexte dans le Playground"}
                              aria-label={isSelected ? `Retirer le contexte de ${doc.name}` : `Utiliser ${doc.name} comme contexte`}
                          >
                              <ContextIcon />
                              {isSelected ? 'Contexte Actif' : 'Utiliser en Contexte'}
                          </button>
                          
                          {removeDocument && (
                            <button
                              onClick={() => {
                                const confirmed = confirm(`🗑️ Supprimer "${doc.name}" ?`);
                                if (confirmed) {
                                  removeDocument(doc.id);
                                }
                              }}
                              className="delete-button"
                              title="Supprimer ce document"
                              aria-label={`Supprimer ${doc.name}`}
                              style={{
                                background: 'transparent',
                                border: '1px solid var(--accent-red)',
                                color: 'var(--accent-red)',
                                padding: '0.6rem',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.2s ease',
                                minWidth: '38px',
                                height: '38px'
                              }}
                              onMouseOver={(e) => {
                                e.currentTarget.style.background = 'var(--accent-red)';
                                e.currentTarget.style.color = 'white';
                              }}
                              onMouseOut={(e) => {
                                e.currentTarget.style.background = 'transparent';
                                e.currentTarget.style.color = 'var(--accent-red)';
                              }}
                            >
                              <CloseIcon />
                            </button>
                          )}
                        </div>
                    </td>
                  </tr>
                )})
              ) : (
                <tr>
                  <td colSpan={6}>
                      <div className="empty-table-state">
                          <RagIcon />
                          <h3>Aucun Document Trouvé</h3>
                          <p>Les documents que vous téléversez apparaîtront ici.</p>
                      </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Explore;