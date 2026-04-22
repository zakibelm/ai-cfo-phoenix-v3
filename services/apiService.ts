import { Document, ToolCall } from '../types';

// URL de base de l'API — centralise pour éviter les URLs hardcodées dans le code
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

// == TYPES ==
export interface QueryResponse {
  agent: string;
  content: string;
  tool_calls?: ToolCall[];
}


// == API FUNCTIONS ==

/**
 * Checks if the backend server is running and healthy.
 */
export const checkBackendHealth = async (): Promise<boolean> => {
    try {
        const response = await fetch(`${API_BASE_URL}/health`);
        return response.ok;
    } catch (error) {
        console.error("Health check failed:", error);
        return false;
    }
};


/**
 * Sends a query to the backend and returns the model's response (non-streaming).
 * @param query The user's query string.
 * @param ragContext An optional document to provide as RAG context.
 * @param agent The selected agent to use (default: 'Auto' for orchestrator)
 * @param model The AI model to use (optional)
 * @param conversationHistory Full conversation history (user + assistant messages)
 * @param signal An optional AbortSignal to cancel the request.
 */
export const sendQuery = async (
  query: string,
  ragContext: Document | null,
  agent: string = 'Auto',
  model?: string,
  conversationHistory?: Array<{role: string, content: string}>,
  signal?: AbortSignal
): Promise<QueryResponse> => {
  const payload = {
    query,
    document_name: ragContext ? ragContext.name : null,
    agent,
    model,
    history: conversationHistory || [],
    // Sécurité : la clé API est gérée côté serveur uniquement
  };

  const response = await fetch(`${API_BASE_URL}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: 'Erreur serveur (réponse non parseable).' }));
    const httpCode = response.status;
    throw new Error(`[HTTP ${httpCode}] ${errorData.detail || 'Erreur inconnue du backend.'}`);
  }

  const data = await response.json();

  return {
    agent: data.agent || 'CFO',
    content: data.response || 'Aucune réponse reçue de l\'agent.',
    tool_calls: data.tool_calls || [],
  };
};

/**
 * Sends a query to the backend and streams the response token by token.
 * Uses Server-Sent Events (SSE) for real-time streaming.
 *
 * @param query The user's query string.
 * @param ragContext An optional document to provide as RAG context.
 * @param agent The selected agent to use.
 * @param model The AI model to use.
 * @param conversationHistory Full conversation history.
 * @param onToken Callback called for each streamed token.
 * @param onAgent Callback called when the agent name is received.
 * @param onDone Callback called when the stream is complete.
 * @param onError Callback called on error.
 * @param signal An optional AbortSignal to cancel the request.
 */
export const sendQueryStreaming = async (
  query: string,
  ragContext: Document | null,
  agent: string = 'Auto',
  model?: string,
  conversationHistory?: Array<{role: string, content: string}>,
  onToken?: (token: string) => void,
  onAgent?: (agentName: string) => void,
  onDone?: () => void,
  onError?: (error: Error) => void,
  signal?: AbortSignal,
): Promise<void> => {
  const payload = {
    query,
    document_name: ragContext ? ragContext.name : null,
    agent,
    model,
    history: conversationHistory || [],
  };

  try {
    const response = await fetch(`${API_BASE_URL}/stream-query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Erreur serveur.' }));
      throw new Error(`[HTTP ${response.status}] ${errorData.detail || 'Erreur inconnue.'}`);
    }

    if (!response.body) {
      throw new Error('Le serveur ne supporte pas le streaming.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') {
          onDone?.();
          return;
        }
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.agent) {
            onAgent?.(parsed.agent);
          } else if (parsed.content) {
            onToken?.(parsed.content);
          } else if (parsed.error) {
            throw new Error(parsed.error);
          }
        } catch (parseErr) {
          // Ignorer les lignes non parseable
        }
      }
    }

    onDone?.();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    onError?.(err instanceof Error ? err : new Error(String(err)));
  }
};

const generateTagsFromFile = (fileName: string): string[] => {
    const lowerName = fileName.toLowerCase().replace(/[\\._-]/g, ' ');
    const tags = new Set<string>();
    
    // Business/domain keywords mapping
    const domainKeywords = {
        'Comptabilité': ['comptabilité', 'comptable', 'facture', 'invoice', 'grand livre', 'journal', 'balance'],
        'Fiscalité': ['tax', 'fiscal', 'impôt', 'tva', 'taxe', 'déclaration'],
        'Audit': ['audit', 'contrôle', 'conformité', 'compliance', 'vérification'],
        'Finance': ['finance', 'financier', 'financière', 'budget', 'trésorerie', 'cash flow'],
        'Prévisions': ['forecast', 'prévision', 'projection', 'tendance', 'trend'],
        'Investissement': ['investment', 'investissement', 'portefeuille', 'allocation', 'capital'],
        'Rapports': ['report', 'rapport', 'analyse', 'statistics', 'statistiques'],
        'Trimestre': ['q1', 'q2', 'q3', 'q4', 'trimestre', 'quarterly'],
        'Annuel': ['annual', 'annuel', 'yearly', 'year'],
        'Dérivés': ['derivative', 'dérivé', 'option', 'swap', 'futures'],
        'Risques': ['risk', 'risque', 'exposure', 'hedging'],
        'Compétences': ['compétence', 'habilitante', 'skill', 'formation'],
    };
    
    // Check each domain and add tag if keyword found
    Object.entries(domainKeywords).forEach(([tag, keywords]) => {
        if (keywords.some(keyword => lowerName.includes(keyword))) {
            tags.add(tag);
        }
    });

    // If no tags found, return generic tag
    return tags.size > 0 ? Array.from(tags) : ['Document Général'];
};


/**
 * Uploads files to the backend for processing and ingestion.
 * Files are processed in parallel batches for better performance.
 * @param files An array of File objects to upload.
 * @param signal An optional AbortSignal to cancel the request.
 * @returns A promise that resolves to an array of the processed documents.
 */
export const uploadFiles = async (files: File[], signal?: AbortSignal): Promise<Document[]> => {
    const BATCH_SIZE = 10; // Number of files to upload in parallel
    const allDocuments: Document[] = [];

    // Process files in batches
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);

        const formData = new FormData();
        batch.forEach(file => {
            formData.append('files', file);
        });

        // Upload batch to backend
        const response = await fetch(`${API_BASE_URL}/upload`, {
            method: 'POST',
            body: formData,
            signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Upload failed:', response.status, errorText);
            throw new Error(`Failed to upload files: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('Batch upload successful:', result);

        // Transform backend response to Document format
        const batchDocuments: Document[] = result.files.map((fileInfo: any) => ({
            id: `doc-${fileInfo.filename}-${Date.now()}-${i}`,
            name: fileInfo.filename,
            status: 'Traité',
            uploaded: new Date().toISOString().split('T')[0],
            agents: [],
            tags: generateTagsFromFile(fileInfo.filename),
            content: `Fichier stocké : ${fileInfo.path} (${(fileInfo.size / 1024).toFixed(2)} KB)`,
        }));

        allDocuments.push(...batchDocuments);
    }

    return allDocuments;
};
