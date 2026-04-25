import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ChatMessage, Document } from '../types';
import { SendIcon } from '../components/icons/SendIcon';
import { ContextIcon } from '../components/icons/ContextIcon';
import { CloseIcon } from '../components/icons/CloseIcon';
import { SpinnerIcon } from '../components/icons/SpinnerIcon';
import { sendQuery, sendQueryStreaming, checkBackendHealth, API_BASE_URL } from '../services/apiService';
import { ChatMessageBubble } from '../components/ChatMessageBubble';
import { TypingIndicator } from '../components/TypingIndicator';
import Banner from '../components/Banner';
import { AgentIcon } from '../components/AgentIcon';
import { useLiveAgent, LiveAgentTranscript } from '../hooks/useLiveAgent';
import { MicrophoneIcon } from '../components/icons/MicrophoneIcon';
import { StopIcon } from '../components/icons/StopIcon';
import { MagicWandIcon } from '../components/icons/MagicWandIcon';
import { agentDetails } from '../data/agents';
import { UploadIcon } from '../components/icons/UploadIcon';
import { uploadFiles } from '../services/apiService';
import { useAnalytics } from '../contexts/AnalyticsContext';


interface PlaygroundProps {
    ragContext: Document | null;
    setRagContext: (doc: Document | null) => void;
}

const initialMessage: ChatMessage = {
    id: `init-${Date.now()}`,
    role: 'model',
    agent: 'CFO',
    content: "Bienvenue dans AI CFO Suite ! Je suis votre CFO, Directeur Financier et orchestrateur expert.\n\nJe peux :\n• Analyser vos documents financiers\n• Expliquer des concepts complexes de manière pédagogique\n• Coordonner les agents spécialisés\n• Fournir des recommandations stratégiques\n\nComment puis-je vous aider ?"
};

const formatDuration = (ms: number): string => {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours} h ${minutes} min ${seconds} s`;
}

// New component for isolated re-rendering of the timer
const OfflineTimer: React.FC<{ since: Date }> = ({ since }) => {
    const [duration, setDuration] = useState(() => formatDuration(new Date().getTime() - since.getTime()));

    useEffect(() => {
        const timer = setInterval(() => {
            setDuration(formatDuration(new Date().getTime() - since.getTime()));
        }, 1000);

        return () => clearInterval(timer);
    }, [since]);

    return (
        <span className="status-indicator-time">
            · {duration}
        </span>
    );
}

const SuggestedPrompts: React.FC<{ onPromptClick: (prompt: string) => void }> = ({ onPromptClick }) => {
  const prompts = [
    "Résume le rapport financier du T4.",
    "Quelles sont les anomalies détectées par l'agent d'audit ?",
    "Génère une prévision de revenus pour le prochain trimestre.",
  ];

  return (
    <div className="suggested-prompts-container">
        <div className="suggested-prompts-header">
            <MagicWandIcon />
            <h3>Essayez de demander :</h3>
        </div>
      <div className="suggested-prompts-grid">
        {prompts.map((prompt, index) => (
          <button key={index} onClick={() => onPromptClick(prompt)} className="suggested-prompt-button">
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
};

// Available AI models
const availableModels = [
  { id: 'google/gemini-flash-1.5-8b', name: 'Gemini Flash 1.5 8B' },
  { id: 'qwen/qwen-2-7b-instruct:free', name: 'Qwen 2 7B (Gratuit)' },
  { id: 'openai/gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
  { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku' },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
  { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5' },
  { id: 'mistralai/mistral-large', name: 'Mistral Large' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3' },
];

const Playground: React.FC<PlaygroundProps> = ({ ragContext, setRagContext }) => {
  const { trackQuery, trackAgentResponse, trackError, trackChatUpload } = useAnalytics();
  
  useEffect(() => {
    document.body.classList.add('phoenix-active');
    return () => {
      document.body.classList.remove('phoenix-active');
    };
  }, []);

  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isBackendOnline, setIsBackendOnline] = useState(true);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [lastHealthCheck, setLastHealthCheck] = useState<Date | null>(null);
  const [offlineSince, setOfflineSince] = useState<Date | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string>('Auto');
  const [selectedModel, setSelectedModel] = useState<string>('anthropic/claude-3.5-sonnet');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const activeRequestController = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const liveUserMessageId = useRef<string | null>(null);
  const liveModelMessageId = useRef<string | null>(null);

  const handleTranscriptUpdate = useCallback((transcript: LiveAgentTranscript) => {
    setMessages(prevMessages => {
      let newMessages = [...prevMessages];
      let userMsgExists = false;
      let modelMsgExists = false;

      // Update or create user message
      if (transcript.userInput) {
        if (liveUserMessageId.current) {
          const userMsgIndex = newMessages.findIndex(m => m.id === liveUserMessageId.current);
          if (userMsgIndex !== -1) {
            newMessages[userMsgIndex] = { ...newMessages[userMsgIndex], content: transcript.userInput };
            userMsgExists = true;
          }
        }
        if (!userMsgExists) {
          liveUserMessageId.current = `user-live-${Date.now()}`;
          newMessages.push({ id: liveUserMessageId.current, role: 'user', content: transcript.userInput });
        }
      }

      // Update or create model message
      if (transcript.modelOutput) {
        if (liveModelMessageId.current) {
          const modelMsgIndex = newMessages.findIndex(m => m.id === liveModelMessageId.current);
          if (modelMsgIndex !== -1) {
            newMessages[modelMsgIndex] = { ...newMessages[modelMsgIndex], content: transcript.modelOutput };
            modelMsgExists = true;
          }
        }
        if (!modelMsgExists && (liveUserMessageId.current || transcript.userInput)) {
          liveModelMessageId.current = `model-live-${Date.now()}`;
          newMessages.push({ id: liveModelMessageId.current, role: 'model', agent: 'CFO', content: transcript.modelOutput });
        }
      }

      // When turn is complete, finalize messages and reset ids
      if (transcript.isTurnComplete) {
        liveUserMessageId.current = null;
        liveModelMessageId.current = null;
      }

      return newMessages;
    });
  }, []);

  const { startSession, closeSession, isLive, isConnecting } = useLiveAgent(handleTranscriptUpdate);

  useEffect(() => {
    let isMounted = true;

    const refreshHealth = async () => {
      try {
        const isNowOnline = await checkBackendHealth();
        if (!isMounted) return;
        
        setIsBackendOnline(prevIsOnline => {
            if (prevIsOnline && !isNowOnline) { // Transition: online -> offline
                setOfflineSince(new Date());
                setBackendError('Le backend ne répond pas. Veuillez vérifier qu\'il est démarré.');
            } else if (!prevIsOnline && isNowOnline) { // Transition: offline -> online
                setOfflineSince(null);
                setBackendError(null);
            }
            return isNowOnline;
        });
        setLastHealthCheck(new Date());

      } catch (error) {
        if (!isMounted) return;
        console.error('Unable to check backend health:', error);
        
        setIsBackendOnline(prevIsOnline => {
            if (prevIsOnline) { // Only set error if it was previously online
                setOfflineSince(new Date());
                setBackendError('Impossible de contacter le backend. Veuillez vérifier qu\'il est démarré.');
            }
            return false;
        });
      }
    };

    refreshHealth();
    const intervalId = window.setInterval(refreshHealth, 10000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      activeRequestController.current?.abort();
      closeSession();
    };
  }, [closeSession]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages, isLoading]);
  
  const backendStatusLabel = useMemo(() => {
    if (isBackendOnline) return 'Backend en ligne';
    return 'Backend hors ligne';
  }, [isBackendOnline]);

  const backendStatusClass = useMemo(() => {
    if (isBackendOnline) return 'online';
    return 'offline';
  }, [isBackendOnline]);
  
    const submitQuery = useCallback(async (queryText: string) => {
        const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: queryText };
        setMessages(prev => [...prev, userMessage]);
        setIsLoading(true);
        setBackendError(null);

        // Track query
        trackQuery(selectedAgent === 'Auto' ? 'CFO' : selectedAgent, queryText);

        activeRequestController.current?.abort();
        const controller = new AbortController();
        activeRequestController.current = controller;

        try {
            // Build conversation history (exclude initial welcome message)
            const history = messages
                .filter(msg => msg.id !== initialMessage.id)
                .map(msg => ({
                    role: msg.role === 'model' ? 'assistant' : 'user',
                    content: msg.content
                }));
            
            // Add current user message to history
            history.push({ role: 'user', content: queryText });
            
            const response = await sendQuery(queryText, ragContext, selectedAgent, selectedModel, history, controller.signal);

            const modelMessage: ChatMessage = {
                id: `model-${Date.now()}`,
                role: 'model',
                agent: response.agent,
                content: response.content,
                toolCalls: response.tool_calls
            };
            setMessages(prev => [...prev, modelMessage]);
            
            // Track successful response
            trackAgentResponse(response.agent, true);

        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
              console.log('Request aborted');
              return;
            }

            console.error('Query failed:', error);
            const message = error instanceof Error ? error.message : String(error);

            if (message.toLowerCase().includes('fetch') || message.toLowerCase().includes('network')) {
              setIsBackendOnline(false);
              setBackendError('La requête a échoué. Vérifiez la connexion réseau ou démarrez le backend.');
            } else {
              setBackendError('Le backend a répondu avec une erreur. Consultez les logs pour plus de détails.');
            }

            const errorMessage: ChatMessage = {
              id: `error-${Date.now()}`,
              role: 'model',
              content: `Désolé, une erreur est survenue : ${message}`,
              agent: 'System Error',
              isError: true,
            };
            setMessages(prev => [...prev, errorMessage]);
            
            // Track error
            trackError(message);
            trackAgentResponse(selectedAgent === 'Auto' ? 'CFO' : selectedAgent, false);
        } finally {
            setIsLoading(false);
        }
    }, [ragContext, selectedAgent, selectedModel, setMessages, setIsLoading, setBackendError, setIsBackendOnline, trackQuery, trackAgentResponse, trackError]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !isBackendOnline || isLive) return;
    submitQuery(input);
    setInput('');
  };
  
  const handleSuggestedPrompt = (prompt: string) => {
    if (isLoading || !isBackendOnline || isLive) return;
    submitQuery(prompt);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setAttachedFiles(Array.from(e.target.files));
    }
  };

  const handleRemoveFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUploadAndAnalyze = async () => {
    if (attachedFiles.length === 0) return;
    
    setIsUploading(true);
    try {
      // Send files to backend for extraction
      const formData = new FormData();
      attachedFiles.forEach(file => {
        formData.append('files', file);
      });
      
      const response = await fetch(`${API_BASE_URL}/extract-text`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error('Backend extraction failed');
      }
      
      const result = await response.json();
      const fileContents = result.files;
      
      // Create prompt with extracted contents
      const fileNames = fileContents.map((f: any) => f.filename).join(', ');
      const filesText = fileContents.map((f: any) => 
        `=== FICHIER: ${f.filename} ===\n${f.content}\n`
      ).join('\n');
      
      const analysisPrompt = `Analyse les documents suivants :\n\n${filesText}\n\nRésume les points clés et identifie les éléments importants.`;
      
      // Add user message showing files
      const userMsg: ChatMessage = {
        id: `user-upload-${Date.now()}`,
        role: 'user',
        content: `📄 Documents à analyser : ${fileNames}`
      };
      setMessages(prev => [...prev, userMsg]);
      
      // Track chat upload
      trackChatUpload(attachedFiles.length, attachedFiles.map(f => f.name));
      
      // Clear files and input
      setAttachedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      
      // Send to agent for analysis
      setInput('');
      submitQuery(analysisPrompt);
      
    } catch (error) {
      console.error('File extraction failed:', error);
      alert('❌ Erreur lors de l\'extraction des fichiers. Vérifiez que le backend est démarré.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRefreshHealth = async () => {
      const isNowOnline = await checkBackendHealth().catch(() => false);
      setLastHealthCheck(new Date());

      setIsBackendOnline(prevIsOnline => {
        if (!isNowOnline && prevIsOnline) {
            setOfflineSince(new Date());
        } else if (isNowOnline && !prevIsOnline) {
            setOfflineSince(null);
        }
        return isNowOnline;
      });

      if (isNowOnline) {
        setBackendError(null);
      } else {
        setBackendError('Le backend ne répond toujours pas.');
      }
  }

  return (
    <div className="phoenix-layout">
      <div className="page-container playground-container">
      <div className="playground-header">
        <div>
          <h1 className="page-title">Chat</h1>
          <p className="page-subtitle">Posez vos questions aux agents financiers. Utilisez l'Explorateur RAG pour enrichir leurs connaissances avec vos documents.</p>
        </div>
        <div className="header-controls">
          <div className="agent-selector-compact">
            <AgentIcon agent={selectedAgent === 'Auto' ? 'CFO' : selectedAgent} />
            <select 
              id="agent-select"
              value={selectedAgent} 
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="agent-selector-dropdown"
              disabled={isLoading || !isBackendOnline}
            >
              <option value="Auto">Auto (Orchestrateur)</option>
              <option disabled>──────────────</option>
              {agentDetails.map((agent) => (
                <option key={agent.name} value={agent.name}>
                  {agent.role}
                </option>
              ))}
            </select>
          </div>
          <div className="agent-selector-compact">
            <span style={{fontSize: '1.2rem'}}>🤖</span>
            <select 
              id="model-select"
              value={selectedModel} 
              onChange={(e) => setSelectedModel(e.target.value)}
              className="agent-selector-dropdown"
              disabled={isLoading || !isBackendOnline}
              title="Modèle IA"
            >
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>
          <div className="status-info">
            <div className={`status-indicator ${backendStatusClass}`}>
              <span className="status-indicator-dot" />
              {backendStatusLabel}
              {!isBackendOnline && offlineSince && <OfflineTimer since={offlineSince} />}
            </div>
            <button
              type="button"
              onClick={handleRefreshHealth}
              className="button-link"
            >
              Relancer le check
            </button>
          </div>
        </div>
        {backendError && !isLoading && <Banner type="error" message={backendError} />}
      </div>

      {ragContext && (
          <div className="context-banner">
            <div className="context-banner-info">
                <ContextIcon />
                <p>Source de connaissances active : <span>{ragContext.name}</span></p>
            </div>
            <button onClick={() => setRagContext(null)} aria-label="Retirer la source">
                <CloseIcon />
            </button>
          </div>
      )}

      <div className="chat-area">
        {messages.length === 1 && <SuggestedPrompts onPromptClick={handleSuggestedPrompt} />}
        {messages.map((msg) => (
          <ChatMessageBubble key={msg.id} message={msg} />
        ))}
        {isLoading && !isLive && (
            <div className="chat-bubble-container">
                <div className="chat-avatar model">
                    <AgentIcon agent="CFO" />
                </div>
                <div className="chat-bubble model">
                    <div className="p-4"><TypingIndicator /></div>
                </div>
            </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        {isLive ? (
            <div className="live-session-bar">
                <div className="live-status-indicator">
                    <span className="live-pulse"></span>
                    <span>Session vocale active</span>
                </div>
                <button
                    onClick={closeSession}
                    className="stop-button"
                    aria-label="Arrêter la session vocale"
                >
                    <StopIcon />
                    <span>Arrêter</span>
                </button>
            </div>
        ) : (
            <>
            {attachedFiles.length > 0 && (
              <div className="attached-files-preview">
                {attachedFiles.map((file, index) => (
                  <div key={index} className="attached-file-chip">
                    <span>📄 {file.name}</span>
                    <button onClick={() => handleRemoveFile(index)} className="remove-file-btn">
                      <CloseIcon />
                    </button>
                  </div>
                ))}
                <button onClick={handleUploadAndAnalyze} className="upload-files-btn" disabled={isUploading}>
                  {isUploading ? 'Analyse...' : '🔍 Analyser'}
                </button>
              </div>
            )}
            <form onSubmit={handleSendMessage}>
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                multiple
                accept=".pdf,.txt,.doc,.docx,.xls,.xlsx,.csv,.json"
                style={{ display: 'none' }}
            />
            <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mic-button"
                disabled={isLoading || !isBackendOnline}
                aria-label="Attacher des fichiers"
                title="Attacher des documents"
            >
                <UploadIcon />
            </button>
            <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={isBackendOnline ? "Écrivez un message..." : "Le backend est hors ligne..."}
                className="chat-input"
                disabled={isLoading || !isBackendOnline || isConnecting}
            />
            <button
                type="button"
                onClick={startSession}
                disabled={isLoading || !isBackendOnline || isConnecting}
                className="mic-button"
                aria-label="Démarrer la session vocale"
            >
                {isConnecting ? <SpinnerIcon className="animate-spin" /> : <MicrophoneIcon />}
            </button>
            <button
                type="submit"
                disabled={isLoading || !input.trim() || !isBackendOnline}
                className="send-button"
                aria-label="Envoyer le message"
            >
                {isLoading ? <SpinnerIcon className="animate-spin" /> : <SendIcon />}
            </button>
            </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Playground;