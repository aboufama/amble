import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Keeps a crash in one panel from blanking the whole editor. The project is autosaved, so reloading is safe. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Amble: the ${this.props.label} crashed`, error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <b>The {this.props.label} hit a problem.</b>
        <p className="muted small">{this.state.error.message}</p>
        <div className="row">
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button className="btn" onClick={() => window.location.reload()}>
            Reload (your project is saved)
          </button>
        </div>
      </div>
    );
  }
}
