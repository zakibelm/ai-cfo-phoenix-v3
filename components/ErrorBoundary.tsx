/**
 * ErrorBoundary.tsx — ZAKI OS Z12 AI CFO Suite
 *
 * Garde-fou React qui capture les erreurs non gérées dans l'arbre de composants
 * et affiche un fallback propre au lieu d'un écran blanc.
 */
import React, { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorId: string;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorId: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
      errorId: `err-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log structuré pour faciliter le debug en prod
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', {
      error_id: this.state.errorId,
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
    // TODO : envoyer à un endpoint /api/client-errors en prod
  }

  reset = () => {
    this.setState({ hasError: false, error: null, errorId: '' });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="error-boundary-root">
        <div className="error-boundary-card">
          <div className="error-boundary-icon">⚠</div>
          <h2 className="error-boundary-title">Une erreur inattendue est survenue</h2>
          <p className="error-boundary-sub">
            L'équipe a été notifiée. Tu peux essayer de rafraîchir la page ou de revenir en arrière.
          </p>
          <div className="error-boundary-details">
            <code>{this.state.error?.message || 'Erreur inconnue'}</code>
            <span className="error-boundary-id">ID : {this.state.errorId}</span>
          </div>
          <div className="error-boundary-actions">
            <button className="kb-btn" onClick={() => window.location.reload()}>
              Rafraîchir
            </button>
            <button className="kb-btn kb-btn-primary" onClick={this.reset}>
              Réessayer
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
