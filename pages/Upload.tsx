import React, { useState, useCallback, useRef } from 'react';
import { Document } from '../types';
import Banner from '../components/Banner';
import { uploadFiles } from '../services/apiService';
import { CheckIcon } from '../components/icons/CheckIcon';
import { SpinnerIcon } from '../components/icons/SpinnerIcon';
import { UploadIcon } from '../components/icons/UploadIcon';
import { CloseIcon } from '../components/icons/CloseIcon';
import { useAnalytics } from '../contexts/AnalyticsContext';

type FileStatus = 'pending' | 'uploading' | 'processing' | 'verifying' | 'success' | 'error';

interface FileProgress {
    id: string | number;
    name: string;
    status: FileStatus;
    progress: number;
    error?: string;
}

const StatusBadge: React.FC<{ status: Document['status'] }> = ({ status }) => {
    const statusClassMap = {
        'Traité': 'processed',
        'En cours': 'in-progress',
        'En attente': 'queued',
        'Échoué': 'failed'
    };
    const statusClass = statusClassMap[status] || 'default';
    return <span className={`status-badge status-badge--${statusClass}`}>{status}</span>
}

interface UploadProps {
    addDocument: (doc: Document) => void;
    updateDocument: (doc: Document) => void;
}

const Upload: React.FC<UploadProps> = ({ addDocument, updateDocument }) => {
  const { trackRagUpload, trackError } = useAnalytics();
  const [files, setFiles] = useState<File[]>([]);
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestionError, setIngestionError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeRequestController = useRef<AbortController | null>(null);
  const [fileProgresses, setFileProgresses] = useState<FileProgress[]>([]);

  const [processedDocs, setProcessedDocs] = useState<Document[]>([]);
  const [addedToRagIds, setAddedToRagIds] = useState<Set<number | string>>(new Set());

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const selectedFiles = Array.from(event.target.files);
      setFiles(selectedFiles);
      setIngestionError(null);
    }
  };

  const onDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(event.dataTransfer.files);
      setFiles(droppedFiles);
      setIngestionError(null);
    }
  }, []);

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(true);
  };

  const onDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
  };

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleClearSelection = () => {
    setFiles([]);
    setIngestionError(null);
    if (fileInputRef.current) {
        fileInputRef.current.value = "";
    }
  };
  
  const handleResetUploader = () => {
      setProcessedDocs([]);
      setAddedToRagIds(new Set());
      handleClearSelection();
      setFileProgresses([]);
      setIsIngesting(false);
      setIngestionError(null);
  };

  const handleCancelUpload = () => {
    if (activeRequestController.current) {
        activeRequestController.current.abort();
    }
  };

  const handleUpload = async () => {
    console.log('🚀 handleUpload called with files:', files);
    if (files.length === 0 || isIngesting) {
      console.log('❌ Upload aborted: files.length=', files.length, 'isIngesting=', isIngesting);
      return;
    }

    activeRequestController.current?.abort();
    const controller = new AbortController();
    activeRequestController.current = controller;

    setIsIngesting(true);
    setIngestionError(null);
    console.log('📤 Starting upload...');
    
    // Step 1: Immediately add documents to global state with "En cours" status
    const tempDocs: Document[] = files.map(file => {
        const fileExt = file.name.split('.').pop()?.toUpperCase() || 'DOC';
        return {
            id: `temp-${file.name}-${Date.now()}`,
            name: file.name,
            status: 'En cours',
            uploaded: new Date().toISOString().split('T')[0],
            agents: [],  // No agents assigned initially
            tags: [fileExt],
            content: `Ingestion in progress for ${file.name}...`,
        };
    });

    tempDocs.forEach(doc => addDocument(doc));

    setFileProgresses(tempDocs.map(doc => ({
        id: doc.id,
        name: doc.name,
        status: 'uploading',
        progress: 0,
    })));

    const progressInterval = setInterval(() => {
        setFileProgresses(prev => {
            const newProgresses = prev.map(p => {
                if (p.status !== 'uploading') return p;
                const newProgress = Math.min(p.progress + Math.random() * 15, 99);
                return { ...p, progress: newProgress };
            });

            if (newProgresses.every(p => p.progress >= 99)) {
                 return newProgresses.map(p => ({ ...p, status: 'processing' }));
            }
            return newProgresses;
        });
    }, 200);

    try {
        // Step 2: Wait for the backend to actually process the files
        console.log('📡 Calling uploadFiles API...');
        const finalDocs = await uploadFiles(files, controller.signal);
        console.log('✅ Upload successful, received docs:', finalDocs);
        
        clearInterval(progressInterval);
        
        // Step 3: Update the documents in global state with the final "Traité" status
        finalDocs.forEach((finalDoc, index) => {
            // We need to link the final doc back to the temp doc to update it
            const tempDocId = tempDocs[index].id;
            const docToUpdate: Document = { ...finalDoc, id: tempDocId }; // Keep the temp ID
            updateDocument(docToUpdate);
        });

        // Update local UI state
        setFileProgresses(prev => prev.map(p => ({ ...p, status: 'verifying' })));
        await new Promise(resolve => setTimeout(resolve, 500));
        setFileProgresses(prev => prev.map(p => ({ ...p, status: 'success', progress: 100 })));
        
        // Link processed docs with temp IDs for the "Add to RAG" functionality
        const processedWithTempIds = finalDocs.map((doc, index) => ({...doc, id: tempDocs[index].id}));
        setProcessedDocs(processedWithTempIds);
        
        // Track RAG upload
        trackRagUpload(finalDocs.length, finalDocs.map(d => d.name));

        setIsIngesting(false);
        setFiles([]);

    } catch (error) {
        clearInterval(progressInterval);
        
        if (error instanceof DOMException && error.name === 'AbortError') {
            console.log('Upload cancelled by user.');
            setIsIngesting(false);
            setFileProgresses([]);
            // Optionally, update the temp docs to 'Échoué' status
            tempDocs.forEach(doc => updateDocument({ ...doc, status: 'Échoué' }));
            return;
        }

        const errorMessage = error instanceof Error ? error.message : 'Une erreur inconnue est survenue.';
        console.error('❌ Upload failed:', error);
        setIngestionError(`Échec de l'ingestion : ${errorMessage}`);
        trackError(`Upload RAG failed: ${errorMessage}`);
        tempDocs.forEach(doc => updateDocument({ ...doc, status: 'Échoué' }));
        setFileProgresses(prev => prev.map(p => ({
            ...p,
            status: 'error',
            error: "Le traitement du lot a échoué.",
        })));
    } finally {
        activeRequestController.current = null;
    }
  };

  const handleAddToRag = (docToAdd: Document) => {
    // The document is already in the RAG explorer. This button is now for visual confirmation.
    setAddedToRagIds(prev => new Set(prev).add(docToAdd.id));
  };

  const isUploadDisabled = isIngesting || files.length === 0;
  
  const renderContent = () => {
    if (isIngesting) {
        return (
            <div className="ingestion-config-card">
                <div className="config-card-header">
                    <h2 className="config-card-title">{ingestionError ? "Échec du téléversement" : "Ingestion en cours..."}</h2>
                </div>
                <div className="config-section">
                    <p className="config-section-subtitle">
                        L'ingestion inclut le téléversement et le traitement par le serveur.
                        Cette seconde étape peut prendre plusieurs minutes.
                    </p>
                    <ul className="file-progress-list">
                        {fileProgresses.map((fp, index) => {
                            const isIndeterminate = fp.status === 'processing' || fp.status === 'verifying';
                            const showPercentage = fp.status === 'uploading' || fp.status === 'success';

                            return (
                                <li key={index} className="file-progress-item">
                                    <div className="file-progress-icon">
                                        {(fp.status === 'uploading' || fp.status === 'processing' || fp.status === 'verifying') && <SpinnerIcon className="animate-spin" />}
                                        {fp.status === 'success' && <CheckIcon className="icon-success" />}
                                        {fp.status === 'error' && <CloseIcon className="icon-error" />}
                                    </div>
                                    <div className="file-progress-details">
                                        <span className="file-progress-name" title={fp.name}>{fp.name}</span>
                                        
                                        {fp.status === 'uploading' && <span className="file-progress-status">Téléversement...</span>}
                                        {fp.status === 'processing' && <span className="file-progress-status">Traitement par le serveur...</span>}
                                        {fp.status === 'verifying' && <span className="file-progress-status">Vérification et enregistrement RAG...</span>}
                                        {fp.status === 'error' && fp.error && <span className="file-progress-error">{fp.error}</span>}
                                        
                                        {fp.status !== 'error' && fp.status !== 'pending' && (
                                            <div className="progress-bar small">
                                                <div 
                                                    className={`progress-bar-inner ${isIndeterminate ? 'indeterminate' : ''}`} 
                                                    style={{ width: isIndeterminate ? '100%' : `${fp.progress}%` }}
                                                ></div>
                                            </div>
                                        )}
                                    </div>
                                    {showPercentage && (
                                        <span className="file-progress-percentage">{fp.progress.toFixed(0)}%</span>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
                <div className="config-footer">
                    {ingestionError ? (
                         <button onClick={handleResetUploader} className="upload-button secondary">
                            Recommencer
                        </button>
                    ) : (
                        <button onClick={handleCancelUpload} className="upload-button secondary">
                            Annuler
                        </button>
                    )}
                </div>
            </div>
        );
    }

    if (processedDocs.length > 0) {
        return (
            <div className="ingestion-config-card">
                <div className="config-card-header">
                    <h2 className="config-card-title success">Traitement Terminé</h2>
                </div>
                <div className="config-section">
                    <h3 className="config-section-title">{processedDocs.length} document{processedDocs.length > 1 ? 's' : ''} traité{processedDocs.length > 1 ? 's' : ''} avec succès.</h3>
                     <p className="config-section-subtitle">
                        Les documents sont maintenant disponibles dans l'Explorateur RAG.
                    </p>
                    <ul className="file-list processed-list">
                        {processedDocs.map(doc => {
                            const isAdded = addedToRagIds.has(doc.id);
                            return (
                                <li key={doc.id} className="file-list-item">
                                    <div className="processed-doc-info">
                                        <span>{doc.name}</span>
                                        <StatusBadge status={'Traité'} />
                                    </div>
                                    <button 
                                        onClick={() => handleAddToRag(doc)} 
                                        disabled={isAdded}
                                        className={`button-add-rag ${isAdded ? 'added' : ''}`}
                                        title="Confirmé et disponible dans l'Explorateur RAG"
                                    >
                                        <CheckIcon/> Confirmé
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
                <div className="config-footer">
                    <button onClick={handleResetUploader} className="upload-button secondary">
                        Ingérer d'autres fichiers
                    </button>
                </div>
            </div>
        );
    }
    
    if (files.length > 0) {
        return (
            <div className="ingestion-config-card">
                <div className="config-card-header">
                    <h2 className="config-card-title">Configuration de l'Ingestion</h2>
                    <button onClick={handleClearSelection} className="button-link" disabled={isIngesting}>
                        Vider la sélection
                    </button>
                </div>

                <div className="config-section">
                    <h3 className="config-section-title">Fichier(s) sélectionné(s)</h3>
                    <ul className="file-list">
                      {files.map((file, index) => (
                        <li key={index} className="file-list-item">
                          <span>{file.name}</span>
                          <span>{(file.size / 1024).toFixed(2)} KB</span>
                        </li>
                      ))}
                    </ul>
                </div>

                <div className="config-footer">
                    <button 
                      onClick={handleUpload}
                      disabled={isUploadDisabled}
                      className="upload-button primary"
                    >
                      Démarrer l'Ingestion
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            className={`upload-dropzone ${isDragOver ? 'drag-over' : ''}`}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={handleButtonClick}
        >
            <input
              type="file"
              id="file-upload"
              accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.csv,.txt,.json,.xml,.md,.png,.jpg,.jpeg,.bmp,.tiff,.gif,.rtf,.odt,.ods,.odp"
              className="sr-only"
              onChange={handleFileChange}
              disabled={isIngesting}
              ref={fileInputRef}
              multiple
            />
            <div className="upload-dropzone-icon">
              <UploadIcon />
            </div>
            <h2 className="upload-dropzone-title">
              Téléversement de Documents RAG
            </h2>
            <p className="upload-dropzone-subtitle">
                Déposez vos documents (PDF, Word, Excel, CSV, TXT, etc.) pour les ajouter à la base de connaissances.
            </p>
            <button 
              type="button" 
              onClick={(e) => { e.stopPropagation(); handleButtonClick(); }} 
              className="upload-button primary"
            >
              Sélectionner des fichiers
            </button>
        </div>
      );
  }

  return (
    <div className="page-container upload-page-container">
        <h1 className="page-title">Téléversement RAG</h1>
        <p className="page-subtitle" style={{marginBottom: '2rem' }}>
            Téléversez vos documents. Leur contenu sera extrait, traité et rendu disponible aux agents via la base de connaissances RAG.
        </p>
      
      {ingestionError && !isIngesting && files.length === 0 && <div style={{ maxWidth: '800px', width: '100%', margin: '0 auto 1rem auto' }}><Banner type="error" message={ingestionError} /></div>}

      {renderContent()}

    </div>
  );
};

export default Upload;