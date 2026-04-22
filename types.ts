// FIX: Removed a circular dependency where `types.ts` was importing from itself.



export interface ToolCall {
  toolName: string;
  input: Record<string, any>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  agent?: string;
  isError?: boolean;
  toolCalls?: ToolCall[];
}

export interface Document {
  id: number | string;
  name: string;
  status: 'Traité' | 'En cours' | 'En attente' | 'Échoué';
  uploaded: string;
  agents: string[];  // Multiple agents can be assigned to one document
  tags: string[];
  content: string;
}
