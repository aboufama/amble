import { useEffect, useState, type ReactElement } from 'react';
import { useStore, findTarget, type Tab } from './store';
import { loadSavedProject, saveProject } from './project/persistence';
import { MenuBar } from './components/MenuBar';
import { BlocksEditor } from './components/BlocksEditor';
import { CostumesPane } from './components/CostumesPane';
import { SoundsPane } from './components/SoundsPane';
import { StagePanel } from './components/StagePanel';
import { ProblemsDialog } from './components/ProblemsDialog';
import { SpritePane } from './components/SpritePane';
import { PromptDialog, SettingsDialog, Toast } from './components/Dialogs';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BlocksTabIcon, BrushTabIcon, SpeakerTabIcon } from './components/icons';

function useAutosave() {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void loadSavedProject().then((p) => {
      if (p) useStore.getState().setProject(p);
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!loaded) return;
    let timer: number | null = null;
    const unsub = useStore.subscribe((state, prev) => {
      if (state.project === prev.project) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void saveProject(useStore.getState().project), 800);
    });
    const flush = () => void saveProject(useStore.getState().project);
    window.addEventListener('beforeunload', flush);
    return () => {
      unsub();
      window.removeEventListener('beforeunload', flush);
    };
  }, [loaded]);
  return loaded;
}

export function App() {
  const loaded = useAutosave();
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const dialog = useStore((s) => s.dialog);
  const stageSize = useStore((s) => s.stageSize);
  const isStage = useStore((s) => findTarget(s.project, s.selectedId)?.kind === 'stage');

  const tabs: Array<{ id: Tab; label: string; icon: ReactElement }> = [
    { id: 'code', label: 'Code', icon: <BlocksTabIcon size={22} /> },
    { id: 'costumes', label: isStage ? 'Backdrops' : 'Costumes', icon: <BrushTabIcon size={22} /> },
    { id: 'sounds', label: 'Sounds', icon: <SpeakerTabIcon size={22} /> },
  ];

  if (!loaded) return <div className="app-loading">Loading…</div>;

  return (
    <div className="app">
      <MenuBar />
      <main className={`gui-body stage-${stageSize}`}>
        <section className="editor-wrapper">
          <div className="gui-tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={`gui-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <div className="tab-body">
            <ErrorBoundary label="block editor">
              <BlocksEditor visible={tab === 'code'} />
            </ErrorBoundary>
            {tab === 'costumes' && (
              <ErrorBoundary label="costume editor">
                <CostumesPane />
              </ErrorBoundary>
            )}
            {tab === 'sounds' && (
              <ErrorBoundary label="sound editor">
                <SoundsPane />
              </ErrorBoundary>
            )}
          </div>
        </section>
        <section className="stage-and-target">
          <ErrorBoundary label="stage">
            <StagePanel />
          </ErrorBoundary>
          <ErrorBoundary label="sprite list">
            <SpritePane />
          </ErrorBoundary>
        </section>
      </main>
      {dialog === 'settings' && <SettingsDialog />}
      <ProblemsDialog />
      <PromptDialog />
      <Toast />
    </div>
  );
}
