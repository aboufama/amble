/**
 * The controls row under the world (§2.6): ▶ Play | ✋ Change · ↻ Restart · ⛶ Full screen · the game's
 * keys as keycaps (or "Use the buttons on the screen" on touch; "Paused. Tap anything to change it." in
 * Change mode). In the small layout it also opens the notebook drawer (Ask & Footsteps).
 */
import type { MouseEvent } from 'react';
import { t } from '../../i18n';
import type { Action, World } from '../../model/types';
import { Button, Keycap, Segmented } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { getState, useStore } from '../../state/store';
import { hintActions, keyHints } from '../../world/hints';
import { useLayout } from './hooks';

const NO_ACTIONS: readonly Action[] = [];

/**
 * After a click or tap on Play, Restart or Full screen, the keys go back to the game (§2.6): a control
 * that kept focus would keep Space and the arrows for itself, so jumping would press Restart again and
 * → would flip the world back into Change. A key press on a control is a click with `detail` 0: focus
 * stays where the student put it.
 */
function keysBackToGame(e: MouseEvent<HTMLDivElement>): void {
  if (e.detail === 0) return;
  const button = e.target instanceof Element ? e.target.closest('button') : null;
  const radio = button?.getAttribute('role') === 'radio';
  if (!button || (!radio && !button.hasAttribute('data-keys-to-game'))) return;
  requestAnimationFrame(() => {
    if (radio && getState().session.mode !== 'play') return;
    document.getElementById('game')?.focus({ preventScroll: true });
  });
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
  const small = layout === 'small';
  const narrow = small || layout === 'portrait';
  return (
    <div className="world-controls" data-testid="world-controls" onClick={keysBackToGame}>
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
      <Button variant="ghost" icon="restart" onClick={onRestart} data-testid="world-restart" data-keys-to-game="">
        {t('world.restart')}
      </Button>
      <Button variant="ghost" icon="fullscreen" onClick={onFullscreen} data-testid="world-fullscreen" data-keys-to-game="">
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
        ) : hints.length && !narrow ? (
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
