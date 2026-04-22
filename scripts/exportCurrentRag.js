// Run this in browser console (F12) to export your current RAG configuration
// Then paste the output back to update defaultRagDocuments.ts

const docs = JSON.parse(localStorage.getItem('ai-cfo-suite-documents') || '[]');
console.log('=== COPY EVERYTHING BELOW THIS LINE ===');
console.log(JSON.stringify(docs, null, 2));
console.log('=== COPY EVERYTHING ABOVE THIS LINE ===');
console.log(`\nTotal documents: ${docs.length}`);
console.log('Paste this JSON back to me and I will update defaultRagDocuments.ts');
