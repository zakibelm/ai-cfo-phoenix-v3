import React, { createContext, useContext, useState, ReactNode } from 'react';

export interface ActivityEvent {
  id: string;
  type: 'rag_upload' | 'chat_query' | 'chat_upload' | 'agent_response' | 'error';
  agent?: string;
  description: string;
  timestamp: string;
  metadata?: any;
}

export interface AnalyticsData {
  ragDocumentsCount: number;
  chatDocumentsCount: number;
  totalQueries: number;
  agentUsage: Record<string, number>;
  activities: ActivityEvent[];
  errorCount: number;
}

interface AnalyticsContextType {
  analytics: AnalyticsData;
  trackRagUpload: (count: number, files: string[]) => void;
  trackChatUpload: (count: number, files: string[]) => void;
  trackQuery: (agent: string, query: string) => void;
  trackAgentResponse: (agent: string, success: boolean) => void;
  trackError: (message: string) => void;
  syncDocumentCounts: () => void;
}

const AnalyticsContext = createContext<AnalyticsContextType | undefined>(undefined);

export const AnalyticsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [analytics, setAnalytics] = useState<AnalyticsData>(() => {
    // Load from localStorage if available
    const saved = localStorage.getItem('analytics_data');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // Fallback to default
      }
    }
    return {
      ragDocumentsCount: 0,
      chatDocumentsCount: 0,
      totalQueries: 0,
      agentUsage: {},
      activities: [],
      errorCount: 0,
    };
  });

  const saveAnalytics = (data: AnalyticsData) => {
    setAnalytics(data);
    localStorage.setItem('analytics_data', JSON.stringify(data));
  };

  const addActivity = (event: Omit<ActivityEvent, 'id' | 'timestamp'>) => {
    const newActivity: ActivityEvent = {
      ...event,
      id: `activity-${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
    };

    setAnalytics(prev => {
      const updated = {
        ...prev,
        activities: [newActivity, ...prev.activities].slice(0, 50), // Keep last 50
      };
      localStorage.setItem('analytics_data', JSON.stringify(updated));
      return updated;
    });
  };

  const trackRagUpload = (count: number, files: string[]) => {
    setAnalytics(prev => {
      const updated = {
        ...prev,
        ragDocumentsCount: prev.ragDocumentsCount + count,
      };
      saveAnalytics(updated);
      return updated;
    });

    addActivity({
      type: 'rag_upload',
      description: `${count} document(s) ajouté(s) à la base RAG: ${files.join(', ')}`,
    });
  };

  const trackChatUpload = (count: number, files: string[]) => {
    setAnalytics(prev => {
      const updated = {
        ...prev,
        chatDocumentsCount: prev.chatDocumentsCount + count,
      };
      saveAnalytics(updated);
      return updated;
    });

    addActivity({
      type: 'chat_upload',
      description: `${count} document(s) uploadé(s) pour analyse: ${files.join(', ')}`,
    });
  };

  const trackQuery = (agent: string, query: string) => {
    setAnalytics(prev => {
      const updated = {
        ...prev,
        totalQueries: prev.totalQueries + 1,
        agentUsage: {
          ...prev.agentUsage,
          [agent]: (prev.agentUsage[agent] || 0) + 1,
        },
      };
      saveAnalytics(updated);
      return updated;
    });

    addActivity({
      type: 'chat_query',
      agent,
      description: `Question posée à ${agent}: "${query.substring(0, 60)}${query.length > 60 ? '...' : ''}"`,
    });
  };

  const trackAgentResponse = (agent: string, success: boolean) => {
    if (success) {
      addActivity({
        type: 'agent_response',
        agent,
        description: `${agent} a répondu avec succès`,
      });
    } else {
      setAnalytics(prev => {
        const updated = {
          ...prev,
          errorCount: prev.errorCount + 1,
        };
        saveAnalytics(updated);
        return updated;
      });
    }
  };

  const trackError = (message: string) => {
    setAnalytics(prev => {
      const updated = {
        ...prev,
        errorCount: prev.errorCount + 1,
      };
      saveAnalytics(updated);
      return updated;
    });

    addActivity({
      type: 'error',
      description: `Erreur: ${message}`,
    });
  };
  
  // Sync document counts with actual localStorage data
  const syncDocumentCounts = () => {
    try {
      const documentsJson = localStorage.getItem('ai-cfo-suite-documents');
      const actualCount = documentsJson ? JSON.parse(documentsJson).length : 0;
      
      setAnalytics(prev => {
        const updated = {
          ...prev,
          ragDocumentsCount: actualCount,
        };
        saveAnalytics(updated);
        return updated;
      });
    } catch (error) {
      console.error('Failed to sync document counts:', error);
    }
  };

  // Sync document counts on mount
  React.useEffect(() => {
    syncDocumentCounts();
  }, []);

  return (
    <AnalyticsContext.Provider
      value={{
        analytics,
        trackRagUpload,
        trackChatUpload,
        trackQuery,
        trackAgentResponse,
        trackError,
        syncDocumentCounts,
      }}
    >
      {children}
    </AnalyticsContext.Provider>
  );
};

export const useAnalytics = () => {
  const context = useContext(AnalyticsContext);
  if (!context) {
    throw new Error('useAnalytics must be used within AnalyticsProvider');
  }
  return context;
};
