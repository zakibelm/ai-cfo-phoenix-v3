import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { agentDetails } from '../data/agents';

interface AgentCheckboxSelectorProps {
  selectedAgents: string[];
  onChange: (agents: string[]) => void;
}

const AgentCheckboxSelector: React.FC<AgentCheckboxSelectorProps> = ({ selectedAgents, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Update dropdown position when opened
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 8,
        left: rect.left + window.scrollX,
        width: rect.width
      });
    }
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (buttonRef.current && buttonRef.current.contains(event.target as Node)) {
        return; // Click on button, let button handler manage it
      }
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleToggleAgent = (agentName: string) => {
    if (selectedAgents.includes(agentName)) {
      onChange(selectedAgents.filter(a => a !== agentName));
    } else {
      onChange([...selectedAgents, agentName]);
    }
  };

  const getDisplayText = () => {
    if (selectedAgents.length === 0) {
      return 'Non assigné';
    }
    if (selectedAgents.length === 1) {
      return agentDetails.find(a => a.name === selectedAgents[0])?.role || selectedAgents[0];
    }
    // Show first 2 agents + count
    const firstTwo = selectedAgents.slice(0, 2).map(name => {
      const agent = agentDetails.find(a => a.name === name);
      return agent ? agent.role.split(' ')[0] : name; // First word only
    }).join(', ');
    const remaining = selectedAgents.length - 2;
    return remaining > 0 ? `${firstTwo} +${remaining}` : firstTwo;
  };

  const displayText = getDisplayText();

  const dropdownContent = isOpen ? (
    <div 
      ref={dropdownRef}
      className="agent-checkbox-dropdown"
      style={{
        position: 'fixed',
        top: `${dropdownPosition.top}px`,
        left: `${dropdownPosition.left}px`,
        width: `${Math.max(dropdownPosition.width, 320)}px`,
      }}
    >
          <div className="agent-checkbox-list">
            {agentDetails.map(agent => (
              <label key={agent.name} className="agent-checkbox-item">
                <input
                  type="checkbox"
                  checked={selectedAgents.includes(agent.name)}
                  onChange={() => handleToggleAgent(agent.name)}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="agent-checkbox-label">{agent.role}</span>
              </label>
            ))}
          </div>
          
          {selectedAgents.length > 0 && (
            <div className="agent-checkbox-footer">
              <button
                className="clear-agents-button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange([]);
                }}
                type="button"
              >
                Tout effacer
              </button>
            </div>
          )}
    </div>
  ) : null;

  return (
    <>
      <div className="agent-checkbox-selector">
        <button
          ref={buttonRef}
          className="agent-selector-button"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
          type="button"
        >
          <span>{displayText}</span>
          <span className="dropdown-arrow">{isOpen ? '▲' : '▼'}</span>
        </button>
      </div>
      {dropdownContent && createPortal(dropdownContent, document.body)}
    </>
  );
};

export default AgentCheckboxSelector;
