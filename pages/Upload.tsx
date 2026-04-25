import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Document } from '../types';
import Banner from '../components/Banner';
import { uploadFiles, listGoogleDriveFiles, connectGoogleDrive, showGooglePicker } from '../services/apiService';
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
  const [uploadSource, setUploadSource] = useState<'local' | 'gdrive'>('local');
  const [sessionOnly, setSessionOnly] = useState(true);

  const [processedDocs, setProcessedDocs] = useState<Document[]>([]);
  const [addedToRagIds, setAddedToRagIds] = useState<Set<number | string>>(new Set());
  const [gdriveFiles, setGdriveFiles] = useState<any[]>([]);
  const [isBrowsingDrive, setIsBrowsingDrive] = useState(false);
  const [isConnected, setIsConnected] = useState(!!localStorage.getItem('google_access_token'));

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const selectedFiles = Array.from(event.target.files);
      setFiles(selectedFiles);
      setIngestionError(null);
    }
  };

  useEffect(() => {
    const handleFocus = () => {
      setIsConnected(!!localStorage.getItem('google_access_token'));
    };
    
    // Check every second while the component is mounted
    const interval = setInterval(handleFocus, 1000);
    
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
    };
  }, []);

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

  const handleBrowseDrive = async (folderId?: string) => {
    console.log(`handleBrowseDrive called for folder: ${folderId || 'root'}`);
    
    // If we have a folderId, we are navigating. If not, we are opening the picker or root.
    if (folderId) {
        setIsBrowsingDrive(true);
        try {
            const children = await listGoogleDriveFiles(folderId);
            setGdriveFiles(children);
        } catch (err) {
            console.error("Failed to list folder content", err);
        } finally {
            setIsBrowsingDrive(false);
        }
        return;
    }

    try {
        await showGooglePicker((selectedFiles) => {
            console.log("Files selected in Picker:", selectedFiles);
            const formattedFiles = selectedFiles.map(f => ({
                id: f.id,
                name: f.name || f.title,
                size: f.sizeBytes || 0,
                mimeType: f.mimeType,
                isFolder: f.mimeType === 'application/vnd.google-apps.folder' || f.mimeType === 'folder' || (f.type === 'folder')
            }));
            
            setGdriveFiles(formattedFiles);
            
            setTimeout(() => {
                const el = document.querySelector('.gdrive-results');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
            }, 100);
        });
    } catch (err) {
        console.error("Failed to show google picker", err);
        alert("Erreur lors de l'ouverture du sélecteur Google Drive.");
    }
  };

  const handleConnectDrive = async () => {
    console.log("Button: Authentifier Google Drive clicked");
    try {
        const result = await connectGoogleDrive();
        if (result.success) {
            console.log("OAuth process started successfully.");
        } else {
            console.warn("Connect process failed or was cancelled.");
        }
    } catch (err) {
        console.error("Critical error during connection:", err);
        alert("Une erreur est survenue lors de la tentative de connexion.");
    }
  };

  const handleDisconnectDrive = () => {
    localStorage.removeItem('google_access_token');
    setIsConnected(false);
    setGdriveFiles([]);
    alert("Compte Google déconnecté.");
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
        <div className="source-selector" style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', justifyContent: 'center' }}>
            <button 
                onClick={() => setUploadSource('local')}
                className={`source-button ${uploadSource === 'local' ? 'active' : ''}`}
                style={{
                    padding: '0.75rem 1.5rem',
                    borderRadius: '12px',
                    border: '1px solid var(--border-color)',
                    background: uploadSource === 'local' ? 'var(--accent-cyan)' : 'transparent',
                    color: uploadSource === 'local' ? 'black' : 'var(--primary-text)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                }}
            >
                📁 Fichiers Locaux
            </button>
            <button 
                onClick={() => setUploadSource('gdrive')}
                className={`source-button ${uploadSource === 'gdrive' ? 'active' : ''}`}
                style={{
                    padding: '0.75rem 1.5rem',
                    borderRadius: '12px',
                    border: '1px solid var(--border-color)',
                    background: uploadSource === 'gdrive' ? '#4285F4' : 'transparent',
                    color: 'white',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                }}
            >
                🤖 Google Drive
            </button>
        </div>

        <div className="confidentiality-options" style={{ maxWidth: '800px', margin: '0 auto 2rem auto', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <h4 style={{ margin: 0 }}>Traitement en Session Uniquement</h4>
                    <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.7 }}>Les fichiers ne seront pas stockés localement après traitement (Loi 25).</p>
                </div>
                <input 
                    type="checkbox" 
                    checked={sessionOnly} 
                    onChange={(e) => setSessionOnly(e.target.checked)}
                    style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                />
            </div>
        </div>
      
      {ingestionError && !isIngesting && files.length === 0 && <div style={{ maxWidth: '800px', width: '100%', margin: '0 auto 1rem auto' }}><Banner type="error" message={ingestionError} /></div>}

      {uploadSource === 'local' ? renderContent() : (
          <div className="gdrive-container" style={{ textAlign: 'center', padding: '4rem', background: 'rgba(66, 133, 244, 0.05)', borderRadius: '24px', border: '2px dashed #4285F4' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>☁️</div>
              <h3>Importer depuis Google Drive</h3>
              <p style={{ maxWidth: '400px', margin: '0 auto 1.5rem auto', opacity: 0.7 }}>
                  Sélectionnez vos dossiers clients directement depuis votre Drive sécurisé.
              </p>

              <div style={{ marginBottom: '2rem' }}>
                  <span style={{ 
                      padding: '0.4rem 1rem', 
                      borderRadius: '20px', 
                      fontSize: '0.8rem', 
                      background: isConnected ? 'rgba(0, 255, 100, 0.1)' : 'rgba(255, 100, 0, 0.1)',
                      color: isConnected ? '#00ff66' : '#ff9900',
                      border: `1px solid ${isConnected ? '#00ff66' : '#ff9900'}`
                  }}>
                      {isConnected ? "✅ Connecté" : "⚠️ Non connecté"}
                  </span>
              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                  {isConnected ? (
                      <button 
                        className="upload-button secondary" 
                        onClick={handleDisconnectDrive}
                      >
                          Déconnecter le compte
                      </button>
                  ) : (
                      <button 
                        className="upload-button secondary" 
                        onClick={handleConnectDrive}
                        style={{ border: '1px solid #4285F4', color: '#4285F4' }}
                      >
                          🔑 Authentifier Google Drive
                      </button>
                  )}
                  <button 
                    className="upload-button primary" 
                    style={{ background: '#4285F4', opacity: isConnected ? 1 : 0.5 }}
                    onClick={handleBrowseDrive}
                    disabled={isBrowsingDrive}
                  >
                      {isBrowsingDrive ? "Ouverture du sélecteur..." : "Parcourir mon Google Drive"}
                  </button>
              </div>
              
              {gdriveFiles.length > 0 && (
                  <div className="gdrive-picker-overlay animate-fade-in" style={{ 
                      position: 'fixed',
                      top: 0, left: 0, right: 0, bottom: 0,
                      background: 'rgba(0,0,0,0.85)',
                      zIndex: 10000,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '20px'
                  }}>
                    <div className="gdrive-picker-modal" style={{
                        width: '100%',
                        maxWidth: '800px',
                        height: '80vh',
                        background: '#1a1a20',
                        borderRadius: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                        border: '1px solid rgba(66, 133, 244, 0.4)',
                        overflow: 'hidden'
                    }}>
                        <div className="picker-header" style={{
                            padding: '1rem 1.5rem',
                            background: '#24242e',
                            borderBottom: '1px solid rgba(255,255,255,0.1)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <img src="https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg" alt="Drive" style={{ width: '24px' }} />
                                <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#fff', fontWeight: 500 }}>Sélecteur Google Drive (Simulé)</h3>
                            </div>
                            <button 
                                onClick={() => setGdriveFiles([])}
                                style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer', opacity: 0.7 }}
                            >
                                ×
                            </button>
                        </div>

                        <div className="picker-body" style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
                           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                               <p style={{ margin: 0, color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem' }}>
                                   Sélectionnez les dossiers ou fichiers clients à importer.
                               </p>
                               {gdriveFiles.some(f => f.id.startsWith('sub') || f.id.startsWith('arc')) && (
                                   <button 
                                     className="upload-button secondary small" 
                                     style={{ padding: '0.4rem 1rem', fontSize: '0.75rem', width: 'auto' }}
                                     onClick={() => handleBrowseDrive()}
                                   >
                                       ⬅ Retour à la racine
                                   </button>
                               )}
                           </div>

                           <div className="file-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                               {gdriveFiles.map(f => (
                                   <div key={f.id} className="gdrive-file-card" style={{ 
                                       background: 'rgba(255,255,255,0.03)', 
                                       padding: '1rem', 
                                       borderRadius: '8px', 
                                       border: '1px solid rgba(255,255,255,0.05)',
                                       display: 'flex',
                                       flexDirection: 'column',
                                       gap: '0.75rem',
                                       transition: 'all 0.2s',
                                       cursor: 'default'
                                   }}>
                                       <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                           <span style={{ fontSize: '1.5rem' }}>{f.isFolder ? '📁' : '📄'}</span>
                                           <span style={{ fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                                       </div>
                                       
                                       {f.isFolder ? (
                                           <button 
                                             className="upload-button primary small" 
                                             style={{ width: '100%', padding: '0.4rem', fontSize: '0.7rem', borderRadius: '4px', background: 'rgba(66, 133, 244, 0.5)' }}
                                             onClick={() => handleBrowseDrive(f.id)}
                                           >
                                               Ouvrir dossier
                                           </button>
                                       ) : (
                                           <button 
                                             className="upload-button secondary small" 
                                             style={{ width: '100%', padding: '0.4rem', fontSize: '0.7rem', borderRadius: '4px' }}
                                             onClick={() => {
                                                 alert(`✅ ${f.name} ajouté à la session.`);
                                                 setFiles(prev => [...prev, new File(["content"], f.name, { type: f.mimeType })]);
                                                 setGdriveFiles([]);
                                             }}
                                           >
                                               Importer
                                           </button>
                                       )}
                                   </div>
                               ))}
                           </div>
                        </div>
                        
                        <div className="picker-footer" style={{ 
                            padding: '1rem 1.5rem', 
                            background: '#24242e', 
                            borderTop: '1px solid rgba(255,255,255,0.1)',
                            display: 'flex',
                            justifyContent: 'flex-end',
                            gap: '1rem'
                        }}>
                            <button className="upload-button secondary small" onClick={() => setGdriveFiles([])}>Annuler</button>
                            <button className="upload-button primary small" style={{ background: '#4285F4' }} onClick={() => setGdriveFiles([])}>Terminer</button>
                        </div>
                    </div>
                  </div>
              )}
          </div>
      )}

    </div>
  );
};

export default Upload;