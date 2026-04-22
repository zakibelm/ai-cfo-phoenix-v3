import React from 'react';
import { OracleIcon } from './icons/OracleIcon';
import { ReporterAgentIcon } from './icons/ReporterAgentIcon';
import { TaxAgentIcon } from './icons/TaxAgentIcon';
import { ForecastAgentIcon } from './icons/ForecastAgentIcon';
import { AdminIcon } from './icons/AdminIcon'; // For System Error
import { AuditAgentIcon } from './icons/AuditAgentIcon';
import { SoftUpdaterAgentIcon } from './icons/SoftUpdaterAgentIcon';
import { AccountingAgentIcon } from './icons/AccountingAgentIcon';
import { InvestmentAgentIcon } from './icons/InvestmentAgentIcon';
import { CommsAgentIcon } from './icons/CommsAgentIcon';
import { FinanceAgentIcon } from './icons/FinanceAgentIcon';
import { DerivativePricingAgentIcon } from './icons/DerivativePricingAgentIcon';
import { SupervisorAgentIcon } from './icons/SupervisorAgentIcon';


interface AgentIconProps {
  agent: string;
  className?: string;
}

const agentIconMap: Record<string, React.FC<React.SVGProps<SVGSVGElement>>> = {
  'CFO': OracleIcon,  // CFO uses Oracle icon
  'Oracle': OracleIcon,  // Backward compatibility
  'ReporterAgent': ReporterAgentIcon,
  'TaxAgent': TaxAgentIcon,
  'ForecastAgent': ForecastAgentIcon,
  'AuditAgent': AuditAgentIcon,
  'SoftUpdaterAgent': SoftUpdaterAgentIcon,
  'AccountingAgent': AccountingAgentIcon,
  'InvestmentAgent': InvestmentAgentIcon,
  'CommsAgent': CommsAgentIcon,
  'FinanceAgent': FinanceAgentIcon,
  'DerivativePricingAgent': DerivativePricingAgentIcon,
  'SupervisorAgent': SupervisorAgentIcon,
  'System Error': AdminIcon,
};

export const AgentIcon: React.FC<AgentIconProps> = ({ agent, className }) => {
  const IconComponent = agentIconMap[agent] || OracleIcon; // Default to Oracle
  return <IconComponent className={className} />;
};