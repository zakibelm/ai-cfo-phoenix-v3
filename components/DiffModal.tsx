import React from 'react';

interface DiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApprove: () => void;
}

export const DiffModal: React.FC<DiffModalProps> = ({ isOpen, onClose, onApprove }) => {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      backdropFilter: 'blur(5px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      animation: 'fadeIn 0.3s ease-out'
    }}>
      <div style={{
        background: 'var(--card-background)',
        border: '1px solid var(--accent-gold-dark)',
        borderRadius: '8px',
        width: '90%',
        maxWidth: '1000px',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.5rem 2rem',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--accent-gold)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '0.5rem' }}>
              REVUE DU PLANNER
            </div>
            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.75rem', color: '#fff', margin: 0 }}>
              Fiducie Desjardins — Synthèse Q4
            </h2>
          </div>
          <button 
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', color: 'var(--secondary-text)', cursor: 'pointer', fontSize: '1.5rem'
            }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{
          padding: '2rem',
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          gap: '2rem',
          backgroundColor: '#050507'
        }}>
          {/* Version Initiale */}
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: '0.85rem', color: 'var(--secondary-text)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '1rem' }}>
              Version Initiale
            </h3>
            <div style={{
              fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: 1.6, color: '#8a8a93'
            }}>
              <span style={{ color: '#b35d5d', textDecoration: 'line-through', backgroundColor: 'rgba(179, 93, 93, 0.1)', padding: '0.1rem 0.2rem' }}>
                Le portefeuille a connu une croissance modérée ce trimestre. Les rendements des actions sont stables.
              </span>
              <br/><br/>
              Les obligations gouvernementales représentent 45% des actifs. 
              <br/><br/>
              <span style={{ color: '#b35d5d', textDecoration: 'line-through', backgroundColor: 'rgba(179, 93, 93, 0.1)', padding: '0.1rem 0.2rem' }}>
                Aucune anomalie fiscale détectée.
              </span>
            </div>
          </div>

          <div style={{ width: '1px', backgroundColor: 'var(--border-color)' }}></div>

          {/* Proposition Planner */}
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: '0.85rem', color: 'var(--accent-gold)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '1rem' }}>
              Proposition Planner
            </h3>
            <div style={{
              fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: 1.6, color: '#e5e5e5'
            }}>
              <span style={{ color: '#dfc686', backgroundColor: 'rgba(223, 198, 134, 0.1)', padding: '0.1rem 0.2rem' }}>
                Le portefeuille a enregistré une surperformance de +4.2% ce trimestre, propulsée par le secteur technologique.
              </span>
              <br/><br/>
              Les obligations gouvernementales représentent 45% des actifs.
              <br/><br/>
              <span style={{ color: '#dfc686', backgroundColor: 'rgba(223, 198, 134, 0.1)', padding: '0.1rem 0.2rem' }}>
                Une provision fiscale de 12K$ a été anticipée suite aux nouvelles régulations provinciales.
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '1.5rem 2rem',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '1rem',
          backgroundColor: 'var(--card-background)'
        }}>
          <button 
            onClick={onClose}
            className="btn-phoenix btn-phoenix-outline"
          >
            ANNULER
          </button>
          <button 
            onClick={() => {
              onApprove();
              onClose();
            }}
            className="btn-phoenix btn-phoenix-solid"
          >
            APPROUVER LES MODIFICATIONS
          </button>
        </div>
      </div>
    </div>
  );
};
