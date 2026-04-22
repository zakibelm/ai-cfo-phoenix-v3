import React, { useState } from 'react';
import { Document } from '../types';
import Upload from './Upload';
import Explore from './Explore';
import { ChevronDownIcon } from '../components/icons/ChevronDownIcon';
import { ChevronUpIcon } from '../components/icons/ChevronUpIcon';

interface RAGProps {
  documents: Document[];
  ragContext: Document | null;
  setRagContext: (doc: Document | null) => void;
  addDocument: (doc: Document) => void;
  updateDocument: (doc: Document) => void;
  updateDocumentAgents: (docId: number | string, newAgents: string[]) => void;
  removeDocument: (docId: number | string) => void;
}

const RAG: React.FC<RAGProps> = ({ 
  documents, 
  ragContext, 
  setRagContext, 
  addDocument, 
  updateDocument,
  updateDocumentAgents,
  removeDocument 
}) => {
  const [expandedSection, setExpandedSection] = useState<'upload' | 'explore'>('upload');

  const toggleSection = (section: 'upload' | 'explore') => {
    setExpandedSection(expandedSection === section ? section : section);
  };

  return (
    <div className="page-container">
      <h1 className="page-title">Base de Connaissances RAG</h1>
      <p className="page-subtitle" style={{ marginBottom: '2rem' }}>
        Gérez vos documents pour enrichir les connaissances des agents IA.
      </p>

      <div className="rag-accordion">
        {/* Section 1: Téléversement */}
        <div className="accordion-item">
          <button
            className={`accordion-header ${expandedSection === 'upload' ? 'active' : ''}`}
            onClick={() => toggleSection('upload')}
          >
            <div className="accordion-header-content">
              <h2>📤 Téléversement de Documents</h2>
              <p>Ajoutez de nouveaux documents à la base RAG</p>
            </div>
            {expandedSection === 'upload' ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </button>
          
          {expandedSection === 'upload' && (
            <div className="accordion-content">
              <Upload addDocument={addDocument} updateDocument={updateDocument} />
            </div>
          )}
        </div>

        {/* Section 2: Explorateur */}
        <div className="accordion-item">
          <button
            className={`accordion-header ${expandedSection === 'explore' ? 'active' : ''}`}
            onClick={() => toggleSection('explore')}
          >
            <div className="accordion-header-content">
              <h2>🔍 Explorateur de Documents</h2>
              <p>Consultez et gérez les {documents.length} document(s) dans la base RAG</p>
            </div>
            {expandedSection === 'explore' ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </button>
          
          {expandedSection === 'explore' && (
            <div className="accordion-content">
              <Explore
                documents={documents}
                ragContext={ragContext}
                setRagContext={setRagContext}
                updateDocumentAgents={updateDocumentAgents}
                removeDocument={removeDocument}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RAG;
