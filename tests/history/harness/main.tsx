/**
 * The Footsteps harness (M9): the Footsteps panel in the notebook's place (x 920, 428 wide) beside a
 * stand-in world view, over a world with fifteen seeded steps (drawings with stickers, dials, twists,
 * student code, AI changes with the student's words, an automatic fix). Open it on the dev server:
 *   http://localhost:5209/tests/history/harness/index.html
 *   (?many=1: 75 steps, ?compact=1, ?theme=day, ?motion=reduced, ?nogame=1: no game in the world view)
 * `window.__harness` exposes the world id and the services for e2e tests.
 */
import { StrictMode, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/ui/fonts';
import '../../../src/ui/tokens.css';
import '../../../src/ui/themes.css';
import '../../../src/ui/base.css';
import '../../../src/ui/components/components.css';
import '../../../src/app/frame/frame.css';
import { DialogLayer } from '../../../src/app/frame/DialogLayer';
import { ToastRegion } from '../../../src/app/frame/ToastRegion';
import { TopBar } from '../../../src/app/frame/TopBar';
import { applyHtmlPrefs } from '../../../src/app/htmlPrefs';
import { watchLayout } from '../../../src/app/layout';
import { PlayerLayer } from '../../../src/app/player/PlayerLayer';
import { usePlayerSlot } from '../../../src/app/player/slots';
import { createServices, ServicesProvider, setServices, type Services } from '../../../src/app/services';
import { createHistory } from '../../../src/history/api';
import { playWorld } from '../../../src/history/live';
import { attribute } from '../../../src/history/provenance';
import type { ArtRecord, BlobRef, CodeFile, StepInput, World } from '../../../src/model/types';
import { FootstepsPanel } from '../../../src/screens/footsteps/FootstepsPanel';
import { setPrefs } from '../../../src/state/prefs';
import { getState, setState } from '../../../src/state/store';
import { LiveRegion, Panel } from '../../../src/ui/components';

const params = new URLSearchParams(location.search);
const MIN = 60_000;

/** A child's doodle with a cream die-cut edge, as a sticker PNG. */
async function doodle(kind: 'moon' | 'pip'): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.lineJoin = g.lineCap = 'round';
  const shape = () => {
    g.beginPath();
    if (kind === 'moon') {
      g.ellipse(128, 142, 92, 84, 0, 0, Math.PI * 2);
      g.moveTo(66, 70);
      g.lineTo(84, 26);
      g.lineTo(110, 58);
      g.lineTo(128, 18);
      g.lineTo(148, 58);
      g.lineTo(174, 26);
      g.lineTo(190, 70);
      g.closePath();
    } else {
      g.arc(128, 62, 36, 0, Math.PI * 2);
      g.roundRect(92, 96, 72, 90, 20);
      g.roundRect(96, 180, 24, 60, 10);
      g.roundRect(136, 180, 24, 60, 10);
    }
  };
  g.fillStyle = '#fbf3e2';
  g.strokeStyle = '#fbf3e2';
  g.lineWidth = 18;
  shape();
  g.fill();
  g.stroke();
  g.fillStyle = kind === 'moon' ? '#f6d86b' : '#e8584f';
  g.strokeStyle = '#2b2240';
  g.lineWidth = 5;
  shape();
  g.fill();
  g.stroke();
  g.fillStyle = '#2b2240';
  if (kind === 'moon') {
    for (const [x, y] of [
      [100, 132],
      [156, 132],
    ])
      g.fillRect(x - 6, y - 8, 12, 16);
    g.fillStyle = '#e8584f';
    g.beginPath();
    g.moveTo(66, 70);
    g.lineTo(84, 26);
    g.lineTo(110, 58);
    g.lineTo(128, 18);
    g.lineTo(148, 58);
    g.lineTo(174, 26);
    g.lineTo(190, 70);
    g.closePath();
    g.fill();
    g.stroke();
  } else {
    g.fillRect(114, 54, 7, 9);
    g.fillRect(136, 54, 7, 9);
  }
  return new Promise((resolve) => c.toBlob((b) => resolve(b!), 'image/png'));
}

async function art(services: Services, id: string, name: string, kind: 'moon' | 'pip', at: number): Promise<ArtRecord> {
  const ref: BlobRef = await services.store.blobs.put(await doodle(kind));
  return {
    id,
    name,
    kind: 'character',
    rig: kind === 'moon' ? 'blob' : 'biped',
    facing: kind === 'moon' ? 'left' : 'right',
    role: kind === 'moon' ? 'boss' : 'hero',
    mode: 'bones',
    board: { w: 1024, h: 1024, pixelArt: false },
    doc: ref,
    cels: [ref],
    parts: {},
    export: { hash: ref.slice(7), flat: ref, w: 256, h: 256, anchor: [128, 250], inkMask: null, parts: {}, sticker: ref, thumb: ref, frames: null },
    rigData: null,
    rigInfo: { made: 'parts', confidence: 0.9, notes: [] },
    palette: [],
    madeBy: 'student',
    shelf: false,
    createdAt: at,
    updatedAt: at,
    version: 1,
  };
}

function edit(world: World, by: 'student' | 'ai', change: (source: string) => string): CodeFile[] {
  const next = world.code.map((f) => (f.path === 'game.js' ? { ...f, source: change(f.source) } : f));
  return attribute(world.code, next, by);
}

async function seed(services: Services): Promise<World> {
  const many = params.has('many');
  const total = many ? 75 : 15;
  const now = Date.now();
  let clock = now - (many ? 2 * 24 * 60 : 40) * MIN;
  const history = createHistory({ store: () => services.store, now: () => clock });
  const opened = await services.starters.open('moon-king', { withArt: false });
  let world: World = { ...opened.world, createdAt: clock, steps: opened.world.steps.map((s) => ({ ...s, at: clock })) };
  await services.store.commit({ worlds: [world] });
  await history.ensureHead(world);

  const step = async (minutesAgo: number, input: StepInput, change: (w: World) => World | Promise<World> = (w) => w) => {
    clock = now - minutesAgo * MIN;
    world = await history.record(await change(world), input);
  };

  if (many) {
    // Sixty-odd dial steps over two days, so the oldest fold into "Earlier".
    for (let i = 0; i < total - 15; i++) {
      const minutesAgo = 2 * 24 * 60 - i * 40;
      clock = now - minutesAgo * MIN;
      const value = 700 + (i % 20) * 10;
      world = await history.record({ ...world, twists: i % 2 ? ['moonGravity'] : [] }, { kind: 'twists', by: 'student', text: i % 2 ? 'You switched on Moon gravity.' : 'You switched off Moon gravity.' });
      void value;
    }
  }

  await step(38, { kind: 'draw', by: 'student', text: 'You drew Pip.', cast: 'hero' }, async (w) => {
    const pip = await art(services, 'a_pipdrawing1', 'Pip', 'pip', clock);
    await services.store.commit({ art: [pip] });
    return { ...w, cast: { ...w.cast, hero: { ...w.cast.hero, art: pip.id, madeBy: 'student' } } };
  });
  await step(35, { kind: 'dials', by: 'student', text: 'You turned Jump height up to 800.' }, (w) => ({ ...w, dials: { ...w.dials, jump: 800 } }));
  await step(31, { kind: 'twists', by: 'student', text: 'You switched on Moon gravity.' }, (w) => ({ ...w, twists: ['moonGravity'] }));
  await step(28, { kind: 'code', by: 'student', text: 'You changed game.js', files: ['game.js'] }, (w) => ({ ...w, code: edit(w, 'student', (s) => s.replace('gravity: 1500', 'gravity: 1300')) }));
  await step(25, { kind: 'ask', by: 'ai', text: 'Amble gave Pip a triple jump.', request: 'let me jump three times', files: ['game.js'], tested: true }, (w) => ({
    ...w,
    code: edit(w, 'ai', (s) => s.replace('jumps: 2, dash: true', 'jumps: 3, dash: true')),
  }));
  await step(21, { kind: 'dials', by: 'student', text: 'You turned Orb speed down to 200.' }, (w) => ({ ...w, dials: { ...w.dials, orbSpeed: 200 } }));
  await step(18, { kind: 'twists', by: 'student', text: 'You switched off Moon gravity.' }, (w) => ({ ...w, twists: [] }));
  await step(15, { kind: 'bones', by: 'student', text: "You fixed Pip's bones.", cast: 'hero' });
  await step(12, { kind: 'sound', by: 'student', text: 'You picked a new coin sound.' });
  await step(10, { kind: 'ask', by: 'ai', text: 'Amble made the Grumbles chase you faster.', request: 'make the grumbles faster', files: ['game.js'], tested: true }, (w) => ({
    ...w,
    code: edit(w, 'ai', (s) => s.replace('m.chase(this.player, 150);', 'm.chase(this.player, 210);')),
  }));
  await step(9, { kind: 'fix', by: 'auto', text: 'Amble fixed a small bug by itself (line 42).', files: ['game.js'] }, (w) => ({
    ...w,
    code: edit(w, 'ai', (s) => s.replace("this.boss.lookAt(this.player);", "if (this.player) this.boss.lookAt(this.player);")),
  }));
  await step(9, { kind: 'dials', by: 'student', text: 'You turned Jump height up to 820.' }, (w) => ({ ...w, dials: { ...w.dials, jump: 820 } }));
  await step(6, { kind: 'ask', by: 'ai', text: 'Amble made the Moon King throw orbs in rings, then in fans.', request: 'make him attack in circles', files: ['game.js'], tested: true }, (w) => ({
    ...w,
    code: edit(w, 'ai', (s) =>
      s
        .replace("fan: { time: 2100, next: 'ring'", "fan: { time: 1800, next: 'spiral'")
        .replace("ring: { time: 2000, next: 'bombs'", "ring: { time: 2400, next: 'fan'")
        .replace('}, \'fan\');', "}, 'ring');"),
    ),
  }));
  await step(2, { kind: 'draw', by: 'student', text: 'You drew the Moon King', cast: 'boss' }, async (w) => {
    const moon = await art(services, 'a_moondrawing', 'The Moon King', 'moon', clock);
    await services.store.commit({ art: [moon] });
    return { ...w, cast: { ...w.cast, boss: { ...w.cast.boss, art: moon.id, madeBy: 'student' } } };
  });
  return world;
}

/** The running game in the world view's place (the real player, in the `world` slot). */
function WorldView() {
  const ref = useRef<HTMLDivElement>(null);
  usePlayerSlot('world', ref);
  return (
    <div className="harness__world" ref={ref}>
      <span>World view (M2)</span>
    </div>
  );
}

function Harness({ worldId }: { worldId: string }) {
  const compact = params.has('compact');
  return (
    <div className="screen" data-testid="screen-harness">
      <TopBar title="The Moon King" />
      <main id="main" className="harness">
        <WorldView />
        <div className="harness__notebook">
          <Panel title="Change your world" className="harness__ask">
            <p className="harness__muted">The Ask card (M2 and M5) sits here.</p>
          </Panel>
          <div className="harness__steps">
            <FootstepsPanel worldId={worldId} compact={compact} />
          </div>
        </div>
      </main>
    </div>
  );
}

const css = `
.harness { position: relative; height: calc(100vh - 60px); }
.harness__world { position: absolute; left: 20px; top: 6px; width: 880px; height: 495px; border-radius: var(--r-world);
  display: grid; place-items: center; color: var(--text-2); font: var(--type-label);
  background: radial-gradient(ellipse at 60% 40%, var(--bg-lift), var(--bg-deep)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 55%, transparent); }
.harness__notebook { position: absolute; left: 920px; top: 6px; width: 428px; bottom: 18px; display: flex; flex-direction: column; gap: 14px; }
.harness__ask { height: 274px; flex: none; }
.harness__steps { flex: 1; min-height: 0; }
.harness__muted { color: var(--text-2); font: var(--type-body); }
:root[data-layout='touch'] .harness__world { left: 16px; width: 792px; height: 446px; }
:root[data-layout='touch'] .harness__notebook { left: auto; right: 16px; width: 440px; }
:root[data-layout='tab'] .harness__world { width: min(880px, calc(100vw - 488px)); }
:root[data-layout='tab'] .harness__notebook { left: auto; right: 20px; }
`;

async function boot(): Promise<void> {
  const services = await createServices();
  setServices(services);
  if (params.get('theme') === 'day') setPrefs({ theme: 'day' });
  if (params.get('motion') === 'reduced') setPrefs({ reduceMotion: 'on' });
  applyHtmlPrefs(getState().prefs);
  watchLayout();
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  const world = await seed(services);
  setState((s) => {
    s.session.world = world;
  });
  if (!params.has('nogame')) void playWorld(world).catch(() => undefined);
  (window as unknown as { __harness: unknown }).__harness = { worldId: world.id, services, getState, setState };
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ServicesProvider value={services}>
        <Harness worldId={world.id} />
        <PlayerLayer />
        <ToastRegion />
        <DialogLayer />
        <LiveRegion />
      </ServicesProvider>
    </StrictMode>,
  );
}

void boot();
