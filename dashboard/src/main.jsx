import { StrictMode, Component } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/dashboard.css';
import App from './App.jsx';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(err) {
    return { error: err };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: '#c91b1b', background: '#0a0a0a', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h2>Error al cargar Jarvis</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: '#e88' }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: '8px 16px', background: '#c91b1b', color: '#fff', border: 'none', cursor: 'pointer', borderRadius: 4 }}
          >
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
