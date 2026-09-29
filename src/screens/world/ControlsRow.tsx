/**
 * The controls row under the world (§2.6): ▶ Play | ✋ Change · ↻ Restart · ⛶ Full screen · the game's
 * keys as keycaps (or "Use the buttons on the screen" on touch; "Paused. Tap anything to change it." in
 * Change mode). In the small layout it also opens the notebook drawer (Ask & Footsteps).
 */
import { t } from '../../i18n';
import type { Action, World } from '../../model/types';
import { Button, Keycap, Segmented } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { useStore } from '../../state/store';
import { actionWords, hintActions, keyHints } from '../../world/hints';
import { useLayout } from './hooks';

const NO_ACTIONS: readonly Action[] = [];

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
  const hints = keyHints(hintActions(actions, world.code), world.controls, actionWords(world.code));
  const small = layout === 'small';
  const narrow = small || layout === 'portrait';
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
        ) : hints.length && !narrow ? (
          <ul className="world-controls__keys" aria-label={t('world.keysLabel')}>
            {hints.map((h) => (
              <li key={h.word}>
                <Keycap>{h.keys}</Keycap>
                <span>{h.label ?? t(h.word)}</span>
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
