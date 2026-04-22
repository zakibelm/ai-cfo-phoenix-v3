import { Document } from '../types';

/**
 * Default RAG documents that come pre-configured with the application.
 * These documents and their agent assignments will be available on first load
 * and after deployment, providing a baseline knowledge base.
 * 
 * To update this list:
 * 1. Configure your documents and agent assignments in the app
 * 2. Export from localStorage: JSON.parse(localStorage.getItem('ai-cfo-suite-documents'))
 * 3. Copy the JSON here
 */
export const defaultRagDocuments: Document[] = [
  // Example structure - replace with your actual documents
  // {
  //   id: 'doc-example-1',
  //   name: 'Guide Comptabilité.pdf',
  //   status: 'Traité',
  //   uploaded: '2025-01-06',
  //   agents: ['AccountingAgent', 'TaxAgent'],
  //   tags: ['Comptabilité', 'Fiscalité'],
  //   content: 'Fichier stocké : uploads/Guide Comptabilité.pdf (150.5 KB)'
  // },
  
  // Add your documents here by copying from localStorage
  // localStorage.getItem('ai-cfo-suite-documents')
];

/**
 * Instructions to populate this file:
 * 
 * 1. Open the application in development mode
 * 2. Upload and configure all your RAG documents with agent assignments
 * 3. Open browser console (F12)
 * 4. Run: copy(JSON.stringify(JSON.parse(localStorage.getItem('ai-cfo-suite-documents')), null, 2))
 * 5. Paste the result into the array above
 * 6. Format as TypeScript
 * 
 * Note: The actual file contents are stored in backend/uploads/
 * This only stores metadata and agent assignments.
 */
