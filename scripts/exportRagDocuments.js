/**
 * Script to export RAG documents from localStorage to defaultRagDocuments.ts
 * 
 * HOW TO USE:
 * 1. Open your app in the browser (http://localhost:5173)
 * 2. Configure all your RAG documents and agent assignments
 * 3. Open browser console (F12)
 * 4. Copy and paste this entire script into the console
 * 5. Press Enter
 * 6. The formatted TypeScript code will be copied to your clipboard
 * 7. Paste it into data/defaultRagDocuments.ts replacing the empty array
 */

(function exportRagDocuments() {
  // Get documents from localStorage
  const documentsJson = localStorage.getItem('ai-cfo-suite-documents');
  
  if (!documentsJson) {
    console.error('❌ No documents found in localStorage!');
    console.log('Make sure you have uploaded and configured documents first.');
    return;
  }
  
  const documents = JSON.parse(documentsJson);
  
  if (documents.length === 0) {
    console.warn('⚠️ Documents array is empty!');
    return;
  }
  
  console.log(`✅ Found ${documents.length} documents`);
  
  // Format as TypeScript
  const tsCode = `import { Document } from '../types';

export const defaultRagDocuments: Document[] = ${JSON.stringify(documents, null, 2)};
`;
  
  // Copy to clipboard
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(tsCode).then(() => {
      console.log('✅ TypeScript code copied to clipboard!');
      console.log('📋 Paste it into: data/defaultRagDocuments.ts');
      console.log('\nPreview:');
      console.log(tsCode);
    }).catch(err => {
      console.error('❌ Failed to copy to clipboard:', err);
      console.log('📄 Here is the code to copy manually:');
      console.log(tsCode);
    });
  } else {
    console.log('📄 Copy this code into data/defaultRagDocuments.ts:');
    console.log(tsCode);
  }
  
  // Show summary
  console.log('\n📊 Documents summary:');
  documents.forEach((doc, index) => {
    console.log(`${index + 1}. ${doc.name}`);
    console.log(`   Status: ${doc.status}`);
    console.log(`   Agents: ${doc.agents?.length > 0 ? doc.agents.join(', ') : 'None'}`);
    console.log(`   Tags: ${doc.tags?.join(', ') || 'None'}`);
  });
})();
