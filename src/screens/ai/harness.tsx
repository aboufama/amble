/**
 * The AI cards' e2e harness (dev server only: the app never imports this file, so it is never built).
 * It mounts the cards over whatever screen is open, wired to the app's real store and services, the way
 * M2's Ask card and M3's Desk embed them: the Ask card (title, badge, `AskStates`) where the notebook sits,
 * the steer toast over the world view, and the build pill. e2e/ai specs load it with
 * `import('/src/screens/ai/harness.tsx')` and call `mountAiHarness()`; `view: 'sent'` shows What Amble
 * sends instead. `planWorld(plan)` makes a world from a plan the way M1's plan card does.
 */
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getServices } from '../../app/services';
import { t } from '../../i18n';
import type { PlanReply, World } from '../../model/types';
import { startBuild } from '../../state/ai';
import { setState, useStore } from '../../state/store';
import { Panel, Tag } from '../../ui/components';
import { AskStates } from './AskStates';
import { BuildPill } from './BuildPill';
import { SteerToastHost } from './SteerToast';
import { WhatsSent } from './WhatsSent';
import './ai.css';

let root: Root | null = null;
let host: HTMLElement | null = null;

function AskHarness() {
  const world = useStore((s) => s.session.world);
  const manifest = useStore((s) => s.session.manifest);
  const scope = useStore((s) => s.session.selected);
  if (!world) return null;
  return (
    <>
      <div className="ai-harness__world" data-testid="ai-harness-world">
        <SteerToastHost worldId={world.id} />
      </div>
      <div className="ai-harness__pill">
        <BuildPill worldId={world.id} />
      </div>
      <Panel
        className="ai-harness__notebook"
        title={t('ai.askTitle')}
        actions={
          <Tag variant="dark" icon="sparkle">
            {t('ai.askBadge')}
          </Tag>
        }
      >
        <AskStates
          world={world}
          manifest={manifest}
          scope={scope}
          onClearScope={() =>
            setState((s) => {
              s.session.selected = null;
            })
          }
        />
      </Panel>
    </>
  );
}

function SentHarness() {
  return (
    <div className="ai-harness__page">
      <WhatsSent />
    </div>
  );
}

const HARNESS_CSS = `
.ai-harness { position: fixed; inset: 0; z-index: var(--z-sheet); pointer-events: none; }
.ai-harness > * { pointer-events: auto; }
.ai-harness__world { position: absolute; left: 20px; top: 66px; width: 880px; height: 495px; pointer-events: none; }
.ai-harness__world > * { pointer-events: auto; }
.ai-harness__pill { position: absolute; left: 50%; top: 8px; translate: -50% 0; }
.ai-harness__notebook { position: absolute; right: 18px; top: 66px; width: 428px; max-height: calc(100vh - 80px); overflow: auto; }
.ai-harness__page { position: absolute; inset: 0; padding: 32px; overflow: auto; background: var(--bg); }
:root[data-layout='touch'] .ai-harness__world { left: 16px; width: 792px; height: 446px; }
:root[data-layout='touch'] .ai-harness__notebook { width: 440px; }
`;

/** Mounts (or re-mounts) the harness over the page. */
export function mountAiHarness(o: { view?: 'ask' | 'sent' } = {}): void {
  unmountAiHarness();
  host = document.createElement('div');
  host.className = 'ai-harness';
  host.dataset.testid = 'ai-harness';
  const style = document.createElement('style');
  style.textContent = HARNESS_CSS;
  host.append(style);
  const mount = document.createElement('div');
  host.append(mount);
  document.body.append(host);
  root = createRoot(mount);
  root.render(<StrictMode>{o.view === 'sent' ? <SentHarness /> : <AskHarness />}</StrictMode>);
}

export function unmountAiHarness(): void {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
}

/**
 * A world made from a plan (§2.5 step 1, as M1 does it): the plan's starter as a new world with the plan
 * stored, its title, and its cast as slots. Returns the stored world.
 */
export async function planWorld(plan: PlanReply): Promise<World> {
  const { starters, store } = getServices();
  const opened = await starters.open(plan.starter, { withArt: false });
  const cast = Object.fromEntries(plan.cast.map((c) => [c.key, { key: c.key, art: null, madeBy: null, extra: null, laterUntil: 0 }]));
  const world: World = { ...opened.world, title: plan.title, pitch: plan.pitch, plan, origin: { kind: 'plan', starter: plan.starter, planTitle: plan.title }, cast: { ...opened.world.cast, ...cast } };
  await store.commit({ worlds: [world] });
  return world;
}

/** Starts a plan's build for a stored world (Draw while it builds). */
export function buildPlanWorld(world: World, plan: PlanReply): Promise<unknown> {
  return startBuild(world, plan);
}
