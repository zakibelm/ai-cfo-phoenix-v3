import React from 'react';
import { ReporterAgentIcon } from '../components/icons/ReporterAgentIcon';
import { TaxAgentIcon } from '../components/icons/TaxAgentIcon';
import { ForecastAgentIcon } from '../components/icons/ForecastAgentIcon';
import { AuditAgentIcon } from '../components/icons/AuditAgentIcon';
import { SoftUpdaterAgentIcon } from '../components/icons/SoftUpdaterAgentIcon';
import { AccountingAgentIcon } from '../components/icons/AccountingAgentIcon';
import { InvestmentAgentIcon } from '../components/icons/InvestmentAgentIcon';
import { CommsAgentIcon } from '../components/icons/CommsAgentIcon';
import { FinanceAgentIcon } from '../components/icons/FinanceAgentIcon';
import { DerivativePricingAgentIcon } from '../components/icons/DerivativePricingAgentIcon';
import { SupervisorAgentIcon } from '../components/icons/SupervisorAgentIcon';
import { OracleIcon } from '../components/icons/OracleIcon';

type AgentColor = 'green' | 'cyan' | 'blue' | 'purple' | 'yellow' | 'orange' | 'red';

export interface AgentInfo {
  name: string;
  description: string;
  role: string;
  status: 'Active' | 'Inactive';
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  model: string;
  color: AgentColor;
}

export const agentDetails: AgentInfo[] = [
  {
    name: 'CFO',
    description: 'Directeur Financier principal et orchestrateur expert. Analyse globale, coordination des agents spécialisés, explication pédagogique des concepts complexes, et utilisation des examens corrigés comme modèles de référence pour les réponses.',
    role: 'Directeur Financier & Orchestrateur',
    status: 'Active',
    icon: OracleIcon,
    model: 'anthropic/claude-3.5-sonnet',
    color: 'purple',
  },
  {
    name: 'ForecastAgent',
    description: 'Analyse les données financières des documents pour générer des prévisions, identifier les tendances et fournir des projections basées sur les données.',
    role: 'Prévisions Financières',
    status: 'Active',
    icon: ForecastAgentIcon,
    model: 'openai/gpt-4-turbo',
    color: 'green',
  },
  {
    name: 'AccountingAgent',
    description: 'Traite les factures, gère les comptes fournisseurs/clients et maintient le grand livre pour une comptabilité précise.',
    role: 'Grand Livre & Comptabilité',
    status: 'Active',
    icon: AccountingAgentIcon,
    model: 'anthropic/claude-3.5-sonnet',
    color: 'cyan',
  },
  {
    name: 'TaxAgent',
    description: 'Spécialisé dans les documents fiscaux, effectue des vérifications de conformité et extrait les chiffres pertinents pour la planification stratégique.',
    role: 'Stratégie Fiscale & Conformité',
    status: 'Active',
    icon: TaxAgentIcon,
    model: 'meta-llama/llama-3.1-70b-instruct',
    color: 'yellow',
  },
  {
    name: 'AuditAgent',
    description: 'Analyse les documents pour la conformité, les incohérences et les risques financiers potentiels par rapport aux contrôles internes établis.',
    role: 'Contrôles Internes & Audit',
    status: 'Active',
    icon: AuditAgentIcon,
    // FIX: Updated deprecated model 'google/gemini-pro-1.5' to the recommended 'gemini-2.5-pro'.
    model: 'gemini-2.5-pro',
    color: 'orange',
  },
  {
    name: 'InvestmentAgent',
    description: 'Analyse les données de marché et la santé financière des entreprises pour identifier les opportunités d\'investissement et évaluer les risques.',
    role: 'Investissement & Allocation de Capital',
    status: 'Active',
    icon: InvestmentAgentIcon,
    model: 'openai/gpt-4-turbo',
    color: 'purple',
  },
  {
    name: 'CommsAgent',
    description: 'Génère des rapports financiers, des mises à jour pour les investisseurs et des communications internes à partir des documents traités.',
    role: 'Communication & Rapports',
    status: 'Active',
    icon: CommsAgentIcon,
    model: 'anthropic/claude-3.5-sonnet',
    color: 'blue',
  },
  {
    name: 'DerivativePricingAgent',
    description: 'Spécialisé dans la tarification de dérivés financiers complexes, l\'analyse des profils de risque et la simulation de scénarios de marché.',
    role: 'Tarification de Dérivés & Analyse de Risque',
    status: 'Active',
    icon: DerivativePricingAgentIcon,
    model: 'anthropic/claude-3.5-sonnet',
    color: 'cyan',
  },
  {
    name: 'SupervisorAgent',
    description: 'S\'assure que toutes les instructions sont suivies correctement et que la qualité du résultat final répond aux normes requises. Supervise la collaboration entre les autres agents.',
    role: 'Assurance Qualité & Conformité',
    status: 'Active',
    icon: SupervisorAgentIcon,
    model: 'openai/gpt-4-turbo',
    color: 'red',
  },
   {
    name: 'FinanceAgent',
    description: 'Sert de stratège financier principal, analysant la santé financière globale, gérant la structure du capital et fournissant des recommandations de haut niveau.',
    role: 'Planification et Analyse Stratégique',
    status: 'Active',
    icon: FinanceAgentIcon,
    model: 'anthropic/claude-3.5-sonnet',
    color: 'green',
  },
];

const agentNameRoleMap = new Map<string, string>(
    agentDetails.map(agent => [agent.name, agent.role])
);

// Add CFO (Oracle) and System Error manually as they are not in the main agent list
agentNameRoleMap.set('CFO', 'Directeur Financier & Orchestrateur');
agentNameRoleMap.set('Oracle', 'CFO');  // Backward compatibility
agentNameRoleMap.set('System Error', 'Erreur Système');
agentNameRoleMap.set('Système', 'Système');


export const getAgentRoleByName = (agentName: string): string => {
    return agentNameRoleMap.get(agentName) || agentName;
};