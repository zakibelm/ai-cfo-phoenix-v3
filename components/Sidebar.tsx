import React, { useState } from 'react';

import { LogoIcon } from './icons/LogoIcon';
import { DashboardIcon } from './icons/DashboardIcon';
import { UploadIcon } from './icons/UploadIcon';
import { PlaygroundIcon } from './icons/PlaygroundIcon';
import { RagIcon } from './icons/RagIcon';
import { AgentManagementIcon } from './icons/AgentManagementIcon';
import { AdminIcon } from './icons/AdminIcon';
import { MenuIcon } from './icons/MenuIcon';
import { KnowledgeBaseIcon } from './icons/KnowledgeBaseIcon';
import { FactoryIcon } from './icons/FactoryIcon';

import { NavLink, useLocation } from 'react-router-dom';

const navLinks = [
  { path: '/', label: 'Tableau de Bord', icon: DashboardIcon },
  { path: '/kb', label: 'Knowledge Base', icon: KnowledgeBaseIcon },
  { path: '/factory', label: 'Knowledge Factory', icon: FactoryIcon },
  { path: '/rag', label: 'Base RAG (legacy)', icon: RagIcon },
  { path: '/chat', label: 'Chat', icon: PlaygroundIcon },
  { type: 'divider' as const },
  { path: '/agents', label: 'Gestion des Agents', icon: AgentManagementIcon },
  { path: '/settings', label: 'Paramètres', icon: AdminIcon },
];

const Sidebar: React.FC = () => {
    // Par défaut, la barre latérale peut être repliée pour laisser place au design Phoenix
    const [isCollapsed, setIsCollapsed] = useState(true);
    const location = useLocation();

    return (
        <aside className={`app-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
            <div className="sidebar-header" style={{ justifyContent: isCollapsed ? 'center' : 'flex-start', padding: isCollapsed ? '1.5rem 0' : '1.5rem' }}>
                <button 
                    onClick={() => setIsCollapsed(!isCollapsed)} 
                    className="sidebar-toggle-menu" 
                    title={isCollapsed ? "Agrandir" : "Réduire"}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--accent-gold)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: isCollapsed ? '0' : '0.75rem'
                    }}
                >
                    <MenuIcon />
                </button>
                {!isCollapsed && <span className="sidebar-title">AI CFO Phoenix</span>}
            </div>
            <nav className="sidebar-nav">
                {navLinks.map((item, index) => {
                    if ('type' in item && item.type === 'divider') {
                        return <hr key={index} className="sidebar-divider" />;
                    } else if ('path' in item) {
                        const Icon = item.icon!;
                        const isSelected = location.pathname === item.path;
                        return (
                            <NavLink 
                                key={item.path} 
                                to={item.path}
                                className={`sidebar-nav-item ${isSelected ? 'active' : ''}`}
                                title={item.label}
                                style={{ justifyContent: isCollapsed ? 'center' : 'flex-start' }}
                            >
                                <Icon className="sidebar-nav-icon" />
                                {!isCollapsed && <span className="sidebar-nav-label">{item.label}</span>}
                            </NavLink>
                        );
                    }
                    return null;
                })}
            </nav>
        </aside>
    );
};

export default Sidebar;
