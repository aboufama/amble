/**
 * The controls row under the world (§2.6): ▶ Play | ✋ Change · ↻ Restart · ⛶ Full screen · the game's
 * keys as keycaps (or "Use the buttons on the screen" on touch; "Paused. Tap anything to change it." in
 * Change mode). In the small layout it also opens the notebook drawer (Ask & Footsteps).
 */
import { t, type MessageKey } from '../../i18n';
import type { Action, World } from '../../model/types';
import { Button, Keycap, Segmented } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { useStore } from '../../state/store';
import { useLayout } from './hooks';

interface Hint {
  keys: string;
  word: MessageKey;
}

/** The kit's usual keys (src/runtime/kit/controls.ts DEFAULT_BINDINGS), as students read them. */
const NO_ACTIONS: readonly Action[] = [];

const USUAL: Partial<Record<Action, string>> = { jump: 'Space', fire: 'X', dash: 'Shift', action: 'E' };

/** Short names for keys the student picked (KeyboardEvent.code). */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  const named: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Enter: 'Enter', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', AltLeft: 'Alt' };
  return named[code] ?? code;
}

/** Actions a game's code reads (the manifest only knows what it read so far, often just the title card's). */
export function actionsFromCode(code: readonly { source: string }[]): Action[] {
  const text = code.map((f) => f.source).join('\n');
  const out = new Set<Action>();
  if (/\.platformer\(|\.runner\(/.test(text)) ['left', 'right', 'jump'].forEach((a) => out.add(a as Action));
  if (/\.topdown\(|\.flyer\(/.test(text)) ['left', 'right', 'up', 'down'].forEach((a) => out.add(a as Action));
  if (/\.shooter\(|pressed\(['"]fire|held\(['"]fire/.test(text)) out.add('fire');
  if (/\bdash\s*:\s*true|pressed\(['"]dash|held\(['"]dash/.test(text)) out.add('dash');
  if (/pressed\(['"]action|held\(['"]action/.test(text)) out.add('action');
  for (const a of ['left', 'right', 'up', 'down', 'jump'] as const) if (new RegExp(`(pressed|held)\\(['"]${a}`).test(text)) out.add(a);
  return [...out];
}

/** What to show hints for: the code's actions, plus movement keys the game reported reading. */
export function hintActions(reported: readonly Action[], code: readonly { source: string }[]): Action[] {
  const fromCode = actionsFromCode(code);
  const moves = reported.filter((a) => a === 'left' || a === 'right' || a === 'up' || a === 'down' || a === 'jump' || a === 'fire' || a === 'dash');
  return [...new Set([...fromCode, ...moves])];
}

/** Up to four hints, in the order students need them: move, jump, shoot, dash. */
export function keyHints(actions: readonly Action[], controls: World['controls']): Hint[] {
  const has = (a: Action) => actions.includes(a);
  const keyOf = (a: Action) => (controls[a]?.length ? keyLabel(controls[a]![0]) : USUAL[a] ?? '');
  const out: Hint[] = [];
  if (has('left') || has('right')) out.push({ keys: t('world.keyArrowsLR'), word: 'world.actionMove' });
  if (has('jump')) out.push({ keys: keyOf('jump'), word: 'world.actionJump' });
  else if (has('up') || has('down')) out.push({ keys: t('world.keyArrowsUD'), word: 'world.actionUpDown' });
  if (has('fire')) out.push({ keys: keyOf('fire'), word: 'world.actionFire' });
  if (has('dash')) out.push({ keys: keyOf('dash'), word: 'world.actionDash' });
  if (has('action')) out.push({ keys: keyOf('action'), word: 'world.actionAction' });
  return out.filter((h) => h.keys).slice(0, 4);
}

export interface ControlsRowProps {
  world: World;
  fullscreen: boolean;
  onMode(mode: 'play' | 'change'): void;
  onRestart(): void;
  onFullscreen(): void;
  onDrawer?(): void;
}

export function ControlsRow({ world, fullscreen, onMode, onRestart, onFullscreen, onDrawer }: ControlsRowProps) {
  const mode = useStore((s) => s.session.mode);
  const actions = useStore((s) => s.session.manifest?.controls) ?? NO_ACTIONS;
  const touch = useStore((s) => s.prefs.touchControls);
  const layout = useLayout();
  const coarse = layout === 'touch' || touch === 'on';
  const hints = keyHints(hintActions(actions, world.code), world.controls);
  const small = layout === 'small' || layout === 'portrait';
  return (
    <div className="world-controls" data-testid="world-controls">
      <Segmented
        label={t('world.modeGroup')}
        tone={mode === 'change' ? 'change' : 'lantern'}
        value={mode}
        onChange={(v) => {
          if (v === 'change' && fullscreen) return;
          onMode(v);
        }}
        options={[
          { value: 'play', label: t('world.play'), icon: 'play' },
          { value: 'change', label: t('world.change'), icon: 'change' },
        ]}
        className="world-controls__mode"
      />
      <Button variant="ghost" icon="restart" onClick={onRestart} data-testid="world-restart">
        {t('world.restart')}
      </Button>
      <Button variant="ghost" icon="fullscreen" onClick={onFullscreen} data-testid="world-fullscreen">
        {t('world.fullscreen')}
      </Button>
      <div className="world-controls__end">
        {mode === 'change' ? (
          <p className="world-controls__hint" role="status">
            <Icon name="info" size={18} />
            {t('world.changeHint')}
          </p>
        ) : coarse ? (
          layout === 'touch' ? null : <p className="world-controls__hint">{t('world.touchHint')}</p>
        ) : hints.length ? (
          <ul className="world-controls__keys" aria-label={t('world.keysLabel')}>
            {hints.map((h) => (
              <li key={h.word}>
                <Keycap>{h.keys}</Keycap>
                <span>{t(h.word)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {small && onDrawer && (
          <Button variant="ghost" icon="footprint" onClick={onDrawer} data-testid="world-drawer-open">
            {t('world.askAndFootsteps')}
          </Button>
        )}
      </div>
    </div>
  );
}
