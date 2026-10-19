import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportClientError } from '../lib/errorReport'

interface State {
  failed: boolean
}

/** Evita a tela branca: mostra uma mensagem amigável com opção de recarregar. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[interface] erro não tratado', error, info.componentStack)
    reportClientError(error, 'tela')
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#fbfaf9', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', margin: '0 0 8px', color: '#13232b' }}>Algo não saiu como esperado</h1>
          <p style={{ color: '#5f6b70', margin: '0 0 20px' }}>
            Ocorreu um erro ao exibir esta tela. Seus dados estão salvos. Recarregue a página para continuar.
          </p>
          <button
            type="button"
            onClick={() => window.location.assign('/')}
            style={{ background: '#1389a8', color: '#fff', border: 0, borderRadius: 10, padding: '12px 22px', fontWeight: 600, cursor: 'pointer' }}
          >
            Recarregar
          </button>
        </div>
      </div>
    )
  }
}
