/**
 * M6's dev harness (never imported by the app; the e2e specs and the screenshot script inject it into
 * the running dev app with `page.addScriptTag({ type: 'module', url })`). Until the Trail (M1) and the
 * world screen (M2) embed M6's components, it mounts them over the real app:
 * - a dock with Save to Drive for the open world, Open a file, the storage banner and the old-Amble card;
 * - `window.__m6.scene(name)`: full-screen review sheets of every state, for screenshots.
 */
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { getServices, ServicesProvider, type Services } from '../../../app/services';
import { TopBar } from '../../../app/frame/TopBar';
import type { LegacyImport } from '../../../legacy/reader';
import type { SaveState } from '../../../model/types';
import { showDropOverlay } from '../../../files/drop';
import { setLegacy, setSpace, setStorageState, setUpdated } from '../../../state/library';
import { setState, useStore } from '../../../state/store';
import { Button, IconButton, Wordmark } from '../../../ui/components';
import { BigFileDialog } from '../BigFileDialog';
import { LegacyCard } from '../LegacyCard';
import { OpenFile } from '../OpenFile';
import { ReadOnlyDialog } from '../ReadOnlyDialog';
import { SaveButton, SaveStatus } from '../SaveButton';
import { StorageBanner, WhyDialog } from '../StorageBanner';
import { StorageFullDialog } from '../StorageFullDialog';
import { SpaceChip, UpdatedChip } from '../TrailChips';
import '../files.css';

type Scene = 'none' | 'world-topbar' | 'trail' | 'readonly' | 'bigfile' | 'storagefull' | 'why' | 'drop';

const PNG_DOT =
  'data:image/svg+xml;base64,' +
  btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="22" r="14" fill="#b388ff"/><circle cx="15" cy="18" r="3" fill="#221b2e"/><circle cx="25" cy="18" r="3" fill="#221b2e"/></svg>');

/** An old project for the review sheets (the e2e specs bring a real one through the old store). */
export const SAMPLE_LEGACY: LegacyImport = {
  title: 'Cat Quest',
  notes: '',
  drawings: [0, 1, 2].map((i) => ({ id: `d${i}`, name: `cat ${i}`, owner: 'Cat', backdrop: false, dataUrl: PNG_DOT, mime: 'image/svg+xml', width: 40, height: 40, resolution: 1, centerX: 20, centerY: 20 })),
  sounds: [{ id: 's0', name: 'meow', owner: 'Cat', dataUrl: 'data:audio/wav;base64,UklGRg==', mime: 'audio/wav', duration: 1 }],
};

const STATES: SaveState[] = ['saved', 'saving', 'full', 'files-only', 'error'];

function Label({ children }: { children: ReactNode }) {
  return <p style={{ margin: '14px 20px 6px', font: 'var(--type-caps)', letterSpacing: 'var(--caps-spacing)', textTransform: 'uppercase', color: 'var(--text-2)' }}>{children}</p>;
}

function WorldTopbars() {
  const world = useStore((s) => s.session.world);
  return (
    <div data-testid="m6-scene-world-topbar">
      {STATES.map((state) => (
        <div key={state}>
          <Label>{state}</Label>
          <TopBar
            title={world?.title ?? 'Moon King'}
            actions={
              <>
                <SaveStatus state={state} />
                {world && <SaveButton world={world} />}
                <IconButton icon="more" label="More" />
              </>
            }
          />
        </div>
      ))}
    </div>
  );
}

function TrailSheet() {
  const legacy = useStore((s) => s.library.legacy);
  return (
    <div data-testid="m6-scene-trail">
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, height: 66, padding: '0 28px 0 38px' }}>
        <Wordmark size={40} />
        <span style={{ flex: 1 }} />
        <UpdatedChip />
        <SpaceChip />
        <OpenFile />
        <Button variant="quiet" icon="teacher">
          Teacher
        </Button>
        <Button variant="quiet" icon="settings">
          Settings
        </Button>
      </header>
      <StorageBanner />
      <div style={{ padding: '28px 74px' }}>{legacy && <LegacyCard legacy={legacy} onDone={() => undefined} />}</div>
    </div>
  );
}

function Dock() {
  const world = useStore((s) => s.session.world);
  const legacy = useStore((s) => s.library.legacy);
  return (
    <div data-testid="m6-dock" style={{ position: 'fixed', left: 12, bottom: 12, zIndex: 45, display: 'grid', gap: 8, justifyItems: 'start', maxWidth: 560 }}>
      <StorageBanner />
      {legacy && <LegacyCard legacy={legacy} onDone={() => undefined} />}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 8, borderRadius: 14, background: 'var(--bg-deep)', boxShadow: 'var(--lift-sm)' }}>
        {world && <SaveStatus />}
        {world && <SaveButton world={world} />}
        <OpenFile />
      </div>
    </div>
  );
}

function Harness() {
  const [scene, setScene] = useState<Scene>('none');
  useEffect(() => {
    const api = {
      scene: (s: Scene) => {
        showDropOverlay(s === 'drop');
        setScene(s);
      },
      storage: (s: 'ok' | 'blocked' | 'full') => setStorageState(s),
      space: (low: boolean) => setSpace({ usage: low ? 900 : 100, quota: 1000, persisted: false }),
      updated: (on: boolean) => setUpdated(on),
      legacy: (on: boolean) => setLegacy(on ? SAMPLE_LEGACY : null),
      save: (s: SaveState) =>
        setState((st) => {
          st.session.save = s;
        }),
    };
    (window as unknown as { __m6: typeof api }).__m6 = api;
    document.documentElement.dataset.m6 = 'ready';
  }, []);
  const close = () => setScene('none');
  const sheet = scene === 'world-topbar' || scene === 'trail';
  return (
    <>
      {scene === 'none' && <Dock />}
      {sheet && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 44, overflow: 'auto', background: 'var(--bg)' }}>
          {scene === 'world-topbar' ? <WorldTopbars /> : <TrailSheet />}
        </div>
      )}
      <ReadOnlyDialog open={scene === 'readonly'} onSaveCopy={close} onClose={close} />
      <BigFileDialog open={scene === 'bigfile'} megabytes={42} onClose={close} />
      <StorageFullDialog open={scene === 'storagefull'} onClose={close} />
      <WhyDialog open={scene === 'why'} onClose={close} />
    </>
  );
}

async function mount(): Promise<void> {
  let services: Services | null = null;
  for (let i = 0; i < 400 && !services; i++) {
    try {
      services = getServices();
    } catch {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  if (!services) throw new Error('The app did not start.');
  const host = document.createElement('div');
  host.id = 'm6-harness';
  document.body.append(host);
  createRoot(host).render(
    <StrictMode>
      <ServicesProvider value={services}>
        <Harness />
      </ServicesProvider>
    </StrictMode>,
  );
}

void mount();
