import React, { useState, useEffect } from 'react';
import { CrewAiIcon } from '../components/icons/CrewAiIcon';
import { LlamaIndexIcon } from '../components/icons/LlamaIndexIcon';
import { QdrantIcon } from '../components/icons/QdrantIcon';
import { AdminIcon } from '../components/icons/AdminIcon';
import { CheckIcon } from '../components/icons/CheckIcon';
import { agentDetails } from '../data/agents';
import { AgentIcon } from '../components/AgentIcon';

const Toggle: React.FC<{ label: string; enabled: boolean; setEnabled: (e: boolean) => void;}> = ({ label, enabled, setEnabled }) => (
    <div className="toggle">
        <span className="toggle-label">{label}</span>
        <button
            onClick={() => setEnabled(!enabled)}
            className={`toggle-switch ${enabled ? 'enabled' : ''}`}
        >
            <span className="toggle-dot" />
        </button>
    </div>
);

const ServiceStatusItem: React.FC<{ icon: React.FC<any>, name: string, endpoint: string }> = ({ icon: Icon, name, endpoint }) => (
  <div className="service-item">
    <div className="service-item-icon"><Icon /></div>
    <div className="service-item-details">
      <span className="service-item-name">{name}</span>
      <span className="service-item-endpoint">{endpoint}</span>
    </div>
    <div className="service-item-status">
      <span className="status-dot-connected"></span>
      Connecté
    </div>
  </div>
);


// Available AI models from OpenRouter
const availableModels = [
  { id: 'google/gemini-flash-1.5-8b', name: 'Gemini Flash 1.5 8B ⭐ (Rapide)' },
  { id: 'qwen/qwen-2-7b-instruct:free', name: 'Qwen 2 7B (Gratuit)' },
  { id: 'openai/gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini (Rapide & Pas cher)' },
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
  { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku (Rapide)' },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
  { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5' },
  { id: 'mistralai/mistral-large', name: 'Mistral Large' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 (Pas cher)' },
];

interface AgentConfig {
  model: string;
  systemPrompt: string;
}

const Admin: React.FC = () => {
    const [darkMode, setDarkMode] = useState(true);
    const [apiKey, setApiKey] = useState('');
    const [apiKeySaved, setApiKeySaved] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<{success: boolean; message: string} | null>(null);
    const [agentConfigs, setAgentConfigs] = useState<Record<string, AgentConfig>>({});

    // Load saved settings from localStorage
    useEffect(() => {
      const savedApiKey = localStorage.getItem('openrouter_api_key') || '';
      const savedConfigs = localStorage.getItem('agent_configs');
      
      setApiKey(savedApiKey);
      if (savedConfigs) {
        setAgentConfigs(JSON.parse(savedConfigs));
      } else {
        // Initialize with default values
        const defaultConfigs: Record<string, AgentConfig> = {};
        agentDetails.forEach(agent => {
          defaultConfigs[agent.name] = {
            model: 'google/gemini-flash-1.5-8b',  // Use working model
            systemPrompt: agent.description
          };
        });
        setAgentConfigs(defaultConfigs);
      }
    }, []);

    const handleSaveApiKey = () => {
      if (!apiKey || apiKey.length < 10) {
        alert('⚠️ Veuillez entrer une clé API valide');
        return;
      }
      localStorage.setItem('openrouter_api_key', apiKey);
      setApiKeySaved(true);
      setTimeout(() => setApiKeySaved(false), 2000);
    };

    const handleTestApiKey = async () => {
      if (!apiKey || apiKey.length < 10) {
        setTestResult({ success: false, message: 'Veuillez entrer une clé API valide' });
        return;
      }

      setIsTesting(true);
      setTestResult(null);

      try {
        const response = await fetch('/api/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: 'Test',
            agent: 'Auto',
            api_key: apiKey,
          }),
        });

        const data = await response.json();

        if (response.ok && data.response && !data.response.includes('Erreur')) {
          setTestResult({ 
            success: true, 
            message: '✅ Clé API valide ! Connexion réussie à OpenRouter.' 
          });
        } else {
          setTestResult({ 
            success: false, 
            message: `❌ ${data.response || 'Erreur de connexion'}` 
          });
        }
      } catch (error) {
        setTestResult({ 
          success: false, 
          message: `❌ Erreur: ${error instanceof Error ? error.message : 'Connexion impossible'}` 
        });
      } finally {
        setIsTesting(false);
      }
    };

    const handleAgentConfigChange = (agentName: string, field: 'model' | 'systemPrompt', value: string) => {
      setAgentConfigs(prev => ({
        ...prev,
        [agentName]: {
          ...prev[agentName],
          [field]: value
        }
      }));
    };

    const handleSaveAgentConfigs = () => {
      localStorage.setItem('agent_configs', JSON.stringify(agentConfigs));
      alert('✅ Configuration des agents sauvegardée !');
    };

  return (
    <div className="page-container">
      <h1 className="page-title">Paramètres & Configuration</h1>
      
      <div className="admin-page-layout">
        
        {/* API Key Configuration */}
        <div className="admin-card">
          <h2 className="admin-card-title">Clé API OpenRouter</h2>
          <div className="admin-card-content">
            <p>Configurez votre clé API OpenRouter pour accéder à de multiples modèles IA (GPT-4, Claude, Gemini, Llama, etc.)</p>
            <div className="api-key-input-group">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-v1-...."
                className="api-key-input"
              />
              <button onClick={handleTestApiKey} className="upload-button secondary" disabled={isTesting}>
                {isTesting ? 'Test...' : 'Tester'}
              </button>
              <button onClick={handleSaveApiKey} className="upload-button">
                {apiKeySaved ? (
                  <>
                    <CheckIcon /> Sauvegardée
                  </>
                ) : (
                  'Sauvegarder'
                )}
              </button>
            </div>
            {testResult && (
              <div className={`api-test-result ${testResult.success ? 'success' : 'error'}`}>
                {testResult.message}
              </div>
            )}
            <p className="api-key-hint">
              🔑 Obtenez votre clé sur <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" style={{color: 'var(--accent-cyan)'}}>openrouter.ai/keys</a>
            </p>
          </div>
        </div>

        {/* Agent Configuration */}
        <div className="admin-card full-width">
          <h2 className="admin-card-title">Configuration des Agents IA</h2>
          <div className="admin-card-content">
            <p>Personnalisez le modèle IA et le prompt système pour chaque agent spécialisé.</p>
            
            <div className="agent-config-grid">
              {agentDetails.map((agent) => {
                const config = agentConfigs[agent.name] || { model: agent.model, systemPrompt: agent.description };
                return (
                  <div key={agent.name} className="agent-config-card">
                    <div className="agent-config-header">
                      <AgentIcon agent={agent.name} />
                      <div>
                        <h3>{agent.role}</h3>
                        <p className="agent-config-name">{agent.name}</p>
                      </div>
                    </div>
                    
                    <div className="agent-config-field">
                      <label>Modèle IA</label>
                      <select
                        value={config.model}
                        onChange={(e) => handleAgentConfigChange(agent.name, 'model', e.target.value)}
                        className="agent-model-select"
                      >
                        {availableModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    
                    <div className="agent-config-field">
                      <label>Prompt Système</label>
                      <textarea
                        value={config.systemPrompt}
                        onChange={(e) => handleAgentConfigChange(agent.name, 'systemPrompt', e.target.value)}
                        className="agent-prompt-textarea"
                        rows={4}
                        placeholder="Instructions système pour cet agent..."
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            
            <button onClick={handleSaveAgentConfigs} className="upload-button" style={{marginTop: '1.5rem'}}>
              Sauvegarder toutes les configurations
            </button>
          </div>
        </div>
        
        <div className="admin-card">
            <h2 className="admin-card-title">Services Coeur & Intégrations</h2>
            <div className="admin-card-content">
              <p>Configuration et statut des composants open-source intégrés.</p>
              <div className="service-list">
                <ServiceStatusItem icon={CrewAiIcon} name="Orchestrateur CrewAI" endpoint="http://localhost:8001" />
                <ServiceStatusItem icon={LlamaIndexIcon} name="Moteur LlamaIndex" endpoint="http://localhost:8002" />
                <ServiceStatusItem icon={AdminIcon} name="API Backend Phoenix" endpoint="http://localhost:8000" />
              </div>
            </div>
        </div>
        
        <div className="admin-card">
            <h2 className="admin-card-title">Gestion du Vector Store</h2>
            <div className="admin-card-content">
              <p>Gérez l'index des documents et la connexion à la base de données vectorielle.</p>
               <div className="service-list">
                <ServiceStatusItem icon={QdrantIcon} name="Vector DB Qdrant" endpoint="http://localhost:6333" />
              </div>
              <div className="system-operations">
                <button className="upload-button secondary">
                    Ré-indexer tous les documents
                </button>
                <button className="upload-button secondary">
                    Voir les statistiques de l'index
                </button>
              </div>
            </div>
        </div>

        <div className="admin-card">
            <h2 className="admin-card-title">Apparence</h2>
            <div className="admin-card-content">
                <Toggle label="Mode Sombre" enabled={darkMode} setEnabled={setDarkMode} />
                <p>Le mode sombre est actuellement activé par défaut.</p>
            </div>
        </div>

      </div>
    </div>
  );
};

export default Admin;