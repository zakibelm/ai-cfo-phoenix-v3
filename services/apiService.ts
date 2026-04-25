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

    let done = false;
    while (!done) {
      const { done: streamDone, value } = await reader.read();
      done = streamDone;
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

/**
 * Initiates the Google Drive connection process.
 */
export const connectGoogleDrive = async (clientId?: string | null): Promise<{ success: boolean; url?: string }> => {
    const effectiveClientId = clientId || localStorage.getItem('google_client_id') || 'demo';
    
    // Handle Demo Mode
    if (effectiveClientId === 'demo') {
        console.log("Mode Démonstration activé. Simulation d'une connexion réussie...");
        localStorage.setItem('google_access_token', 'mock_access_token_' + Date.now());
        localStorage.setItem('oauth_redirect_path', window.location.pathname);
        // Simulate a slight delay then redirect to self to trigger the focus logic
        setTimeout(() => {
            window.location.reload();
        }, 1000);
        return { success: true };
    }

    const scope = 'https://www.googleapis.com/auth/drive.readonly';
    const redirectUri = window.location.origin + '/'; // Trailing slash often required
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${effectiveClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(scope)}`;
    
    // Ouvrir la fenêtre d'authentification Google
    const width = 500;
    const height = 600;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    
    const popup = window.open(
        authUrl, 
        'google-auth', 
        `width=${width},height=${height},left=${left},top=${top}`
    );

    if (!popup) {
        alert("⚠️ Le popup d'authentification a été bloqué par votre navigateur ou l'interaction a été perdue.");
        return { success: false };
    }

    console.log("Authentification Google Drive lancée...");
    return { success: true, url: authUrl };
};

/**
 * Shows the Google Picker to select real files, or a simulated picker in demo mode.
 */
export const showGooglePicker = async (onSelect: (files: any[]) => void) => {
    const token = localStorage.getItem('google_access_token');
    const apiKey = localStorage.getItem('google_api_key');
    const clientId = localStorage.getItem('google_client_id') || 'demo';

    // If demo mode or no token, use simulated selection
    if (!token || token.startsWith('mock_') || clientId === 'demo') {
        console.log("Utilisation du sélecteur simulé (Mode Démo)...");
        // We will handle this in the UI by showing a more detailed mock list
        // or just returning the mock files for now.
        const mockFiles = [
            { id: 'm1', name: '📁 Archives_Clients_2024', mimeType: 'folder' },
            { id: 'm2', name: '📄 Rapport_Audit_Final.pdf', mimeType: 'pdf' },
            { id: 'm3', name: '📊 Budget_Previsionnel.xlsx', mimeType: 'xlsx' },
            { id: 'm4', name: '📄 Strategie_Fiscale.docx', mimeType: 'docx' },
            { id: 'm5', name: '📁 Dossier_Zaki_Perso', mimeType: 'folder' }
        ];
        onSelect(mockFiles);
        return;
    }

    if (!apiKey) {
        alert("⚠️ Clé API Google manquante dans les Paramètres. Impossible d'ouvrir le sélecteur réel.");
        return;
    }

    // Load GAPI and Picker
    const gapi = (window as any).gapi;
    if (!gapi) {
        alert("⚠️ Chargement des API Google en cours... Veuillez réessayer dans un instant.");
        return;
    }

    try {
        gapi.load('picker', {
            callback: () => {
                const picker = new (window as any).google.picker.PickerBuilder()
                    .addView((window as any).google.picker.ViewId.DOCS)
                    .setOAuthToken(token)
                    .setDeveloperKey(apiKey)
                    .setCallback((data: any) => {
                        if (data.action === (window as any).google.picker.Action.PICKED) {
                            onSelect(data.docs);
                        }
                    })
                    .build();
                picker.setVisible(true);
            }
        });
    } catch (error) {
        console.error("Erreur lors de l'ouverture du Picker:", error);
        alert("Erreur lors de l'ouverture du sélecteur Google.");
    }
};

/**
 * Fetches the list of files from Google Drive.
 */
export const listGoogleDriveFiles = async (folderId?: string): Promise<any[]> => {
    const token = localStorage.getItem('google_access_token');
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 600));

    if (folderId === 'g1' || folderId === 'm5') {
        return [
            { id: 'sub1', name: '📄 Releve_Bancaire_Mars.pdf', size: 1024 * 150, mimeType: 'application/pdf', isFolder: false },
            { id: 'sub2', name: '📄 Justificatif_Domicile.jpg', size: 1024 * 300, mimeType: 'image/jpeg', isFolder: false },
            { id: 'sub3', name: '📁 Sous_Dossier_Fiscal', size: 0, mimeType: 'application/vnd.google-apps.folder', isFolder: true },
        ];
    }

    if (folderId === 'm1') {
        return [
            { id: 'arc1', name: '📄 Archive_T1_2024.zip', size: 1024 * 5000, mimeType: 'application/zip', isFolder: false },
            { id: 'arc2', name: '📄 Historique_Transactions.csv', size: 1024 * 50, mimeType: 'text/csv', isFolder: false },
        ];
    }

    // Default root mock files
    return [
        { id: 'g1', name: '📁 Dossier_Client_Zaki_2025', size: 0, mimeType: 'application/vnd.google-apps.folder', isFolder: true },
        { id: 'm1', name: '📁 Archives_Clients_2024', size: 0, mimeType: 'application/vnd.google-apps.folder', isFolder: true },
        { id: '1', name: '📄 Bilan_Annuel_Confidentiel.pdf', size: 1024 * 500, mimeType: 'application/pdf', isFolder: false },
        { id: '2', name: '📊 Previsions_Financieres_Q3.xlsx', size: 1024 * 200, mimeType: 'application/vnd.ms-excel', isFolder: false },
        { id: '3', name: '📄 Contrat_Pret_Bancaire.pdf', size: 1024 * 800, mimeType: 'application/pdf', isFolder: false },
    ];
};
