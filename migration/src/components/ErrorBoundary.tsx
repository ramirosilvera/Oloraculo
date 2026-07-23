import { Component, type ReactNode } from 'react';

// Contiene cualquier excepción de render de una página para que NO tire abajo toda la app
// (pantalla en blanco + congelada). Muestra el error y deja seguir navegando.
interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // Queda en la consola para diagnóstico (incluye el stack del componente).
    console.error('ErrorBoundary capturó un error de render:', error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="max-w-lg mx-auto text-center py-16 px-4">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-neg/10 text-neg grid place-items-center mb-4 text-2xl">!</div>
        <h2 className="text-lg font-bold text-ink-900 font-display">Algo falló al mostrar esta sección</h2>
        <p className="text-sm text-ink-600 mt-1">La app sigue funcionando; podés volver al inicio o reintentar.</p>
        <pre className="mt-4 text-left text-[11px] text-ink-600 bg-canvas border border-line rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-words">
          {error.message || String(error)}
        </pre>
        <div className="flex items-center justify-center gap-2 mt-5">
          <button onClick={this.reset} className="rounded-full border border-line bg-surface text-ink-800 px-5 py-2 text-sm font-semibold hover:border-celeste-300 transition-colors">
            Reintentar
          </button>
          <a href="/" className="rounded-full bg-celeste-500 text-white px-5 py-2 text-sm font-semibold shadow-glow hover:bg-celeste-600 transition-colors">
            Volver al inicio
          </a>
        </div>
      </div>
    );
  }
}
