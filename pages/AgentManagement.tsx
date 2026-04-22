import React from 'react';
import { agentDetails } from '../data/agents';

const AgentManagement: React.FC = () => {
  return (
    <div className="page-container">
      <h1 className="page-title">Gestion des Agents</h1>
      <p className="page-subtitle" style={{ marginBottom: '2rem' }}>
        Vue d'ensemble de tous les agents autonomes intégrés dans AI CFO Suite.
      </p>

      <div className="agent-grid">
        {agentDetails.map((agent) => {
          const Icon = agent.icon;
          return (
            <div key={agent.name} className="agent-card" data-agent-color={agent.color}>
              <div className="agent-card-header">
                <div className="agent-card-icon-wrapper">
                  <Icon />
                </div>
                <div className="agent-card-title-group">
                  <h2 className="agent-card-title">{agent.role}</h2>
                  <span className={`status-badge status-badge--${agent.status === 'Active' ? 'processed' : 'failed'}`}>
                    {agent.status}
                  </span>
                </div>
              </div>
              <div className="agent-card-tags">
                <span className="agent-card-name-tag">{agent.name}</span>
                <span className="agent-card-model-tag">{agent.model}</span>
              </div>
              <div className="agent-card-body">
                <p className="agent-card-description">{agent.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AgentManagement;