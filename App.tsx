import React, { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Document } from './types';
import { mockDocuments } from './data/mockData';
import Dashboard from './pages/Dashboard';
import RAG from './pages/RAG';
import Playground from './pages/Playground';
import Admin from './pages/Admin';
import AgentManagement from './pages/AgentManagement';
import KnowledgeBase from './pages/KnowledgeBase';
import Factory from './pages/Factory';
import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import { AnalyticsProvider } from './contexts/AnalyticsContext';
import { ToastProvider } from './contexts/ToastContext';

// LocalStorage keys
const STORAGE_KEY_DOCUMENTS = 'ai-cfo-suite-documents';
const STORAGE_KEY_RAG_CONTEXT = 'ai-cfo-suite-rag-context';

export default function App() {
  
  // Load documents from localStorage or use defaults
  const loadDocuments = (): Document[] => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_DOCUMENTS);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Migrate old format if needed
        return parsed.map((doc: any) => {
          if (doc.agent && !doc.agents) {
            return {
              ...doc,
              agents: doc.agent === 'Non assigné' ? [] : [doc.agent],
            };
          }
          return doc;
        });
      }
    } catch (error) {
      console.error('Failed to load documents from localStorage:', error);
    }
    return mockDocuments;
  };
  
  // Load RAG context from localStorage
  const loadRagContext = (): Document | null => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_RAG_CONTEXT);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to load RAG context from localStorage:', error);
    }
    return null;
  };
  
  const [documents, setDocuments] = useState<Document[]>(loadDocuments);
  const [ragContext, setRagContext] = useState<Document | null>(loadRagContext);

  // Save documents to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_DOCUMENTS, JSON.stringify(documents));
    } catch (error) {
      console.error('Failed to save documents to localStorage:', error);
    }
  }, [documents]);
  
  // Save RAG context to localStorage whenever it changes
  useEffect(() => {
    try {
      if (ragContext) {
        localStorage.setItem(STORAGE_KEY_RAG_CONTEXT, JSON.stringify(ragContext));
      } else {
        localStorage.removeItem(STORAGE_KEY_RAG_CONTEXT);
      }
    } catch (error) {
      console.error('Failed to save RAG context to localStorage:', error);
    }
  }, [ragContext]);

  const addDocument = (doc: Document) => {
    setDocuments(prev => [doc, ...prev]);
  };

  const updateDocument = (updatedDoc: Document) => {
    setDocuments(prev => prev.map(doc => 
      doc.id === updatedDoc.id ? updatedDoc : doc
    ));
  };

  const updateDocumentAgents = (docId: number | string, newAgents: string[]) => {
    setDocuments(prev => prev.map(doc => 
      doc.id === docId ? { ...doc, agents: newAgents } : doc
    ));
  };
  
  const removeDocument = (docId: number | string) => {
    setDocuments(prev => prev.filter(doc => doc.id !== docId));
    // If removed document was the active RAG context, clear it
    if (ragContext?.id === docId) {
      setRagContext(null);
    }
  };


  return (
    <ErrorBoundary>
      <AnalyticsProvider>
        <ToastProvider>
          <div className="app-shell">
            <Sidebar />
            <div className="content-wrapper">
              <main className="app-main">
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/rag" element={<RAG documents={documents} ragContext={ragContext} setRagContext={setRagContext} addDocument={addDocument} updateDocument={updateDocument} updateDocumentAgents={updateDocumentAgents} removeDocument={removeDocument} />} />
                  <Route path="/kb" element={<KnowledgeBase />} />
                  <Route path="/factory" element={<Factory />} />
                  <Route path="/chat" element={<Playground ragContext={ragContext} setRagContext={setRagContext} />} />
                  <Route path="/settings" element={<Admin />} />
                  <Route path="/agents" element={<AgentManagement />} />
                  <Route path="*" element={<Dashboard />} />
                </Routes>
              </main>
            </div>
          </div>
        </ToastProvider>
      </AnalyticsProvider>
    </ErrorBoundary>
  );
}