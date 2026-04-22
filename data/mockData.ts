import { Document } from '../types';
import { defaultRagDocuments } from './defaultRagDocuments';

// Use default RAG documents as baseline
// These will be pre-loaded on first use and after deployment
export const mockDocuments: Document[] = defaultRagDocuments;
