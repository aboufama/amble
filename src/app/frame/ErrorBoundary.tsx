/** Catches a screen that crashed while rendering: the rest of Amble keeps working and nothing is lost. */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../../i18n';
import { Button, Panel } from '../../ui/components';
import { navigate } from '../router';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children?: ReactNode; resetKey?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('A screen crashed:', error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <main id="main" tabIndex={-1} className="screen screen--error" data-testid="screen-error">
        <Panel title={t('common.screenBroke')} className="error-card">
          <p>{t('common.screenBrokeHint')}</p>
          <div className="row">
            <Button variant="lantern" icon="trail" onClick={() => navigate({ name: 'trail', view: 'trail' })}>
              {t('common.backToTrail')}
            </Button>
            <Button variant="ghost" icon="restart" onClick={() => location.reload()}>
              {t('common.reload')}
            </Button>
          </div>
        </Panel>
      </main>
    );
  }
}
