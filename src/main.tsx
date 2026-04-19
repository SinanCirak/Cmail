import { Component, type ErrorInfo, type ReactNode, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

type EbProps = { children: ReactNode }
type EbState = { error: Error | null }

/** Surfaces bundle/runtime failures instead of a blank screen. */
class RootErrorBoundary extends Component<EbProps, EbState> {
  state: EbState = { error: null }

  static getDerivedStateFromError(error: Error): EbState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: '2rem',
            maxWidth: '42rem',
            margin: '0 auto',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <h1 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>Something went wrong</h1>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: '0.875rem',
              color: '#444',
              background: '#f8fafc',
              padding: '1rem',
              borderRadius: '8px',
            }}
          >
            {this.state.error.stack ?? this.state.error.message}
          </pre>
          <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '1rem' }}>
            Try a hard refresh (Ctrl+Shift+R). If this persists, open DevTools → Console for details.
          </p>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
)
