/**
 * The Controls sheet (⋯ → Controls, §2.6): each action the game reads with its keys; press a key to add
 * it, remove one with its ✕, or go back to the usual keys. Saved in `World.controls`; the world reloads
 * with them when the sheet closes, and the change becomes one footstep.
 */
import { useEffect, useState, type KeyboardEvent } from 'react';
import { t, type MessageKey } from '../../i18n';
import type { Action, World } from '../../model/types';
import { loadGame, recordStep, updateWorld } from '../../state/session';
import { useStore } from '../../state/store';
import { Button, Keycap, Sheet } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { phaserKeyName } from '../../world/init';
import { keyLabel } from '../../world/hints';

const WORDS: Record<Action, MessageKey> = {
  left: 'world.actLeft',
  right: 'world.actRight',
  up: 'world.actUp',
  down: 'world.actDown',
  jump: 'world.actJump',
  fire: 'world.actFire',
  dash: 'world.actDash',
  action: 'world.actAction',
  pause: 'world.actPause',
};

/** The kit's usual keys (DEFAULT_BINDINGS), as KeyboardEvent codes. */
export const USUAL_KEYS: Record<Action, string[]> = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  jump: ['Space', 'KeyZ', 'ArrowUp', 'KeyW'],
  fire: ['KeyX', 'KeyJ', 'Enter'],
  dash: ['ShiftLeft', 'KeyC', 'KeyK'],
  action: ['KeyE', 'KeyL', 'KeyQ'],
  pause: ['KeyP'],
};

const MAX_KEYS = 4;
const NO_ACTIONS: readonly Action[] = [];

function Row({ action, keys, onChange }: { action: Action; keys: string[]; onChange(keys: string[]): void }) {
  const [listening, setListening] = useState(false);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!listening) return;
    if (e.key === 'Escape' || e.key === 'Tab') {
      setListening(false);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (!phaserKeyName(e.code)) return;
    setListening(false);
    if (keys.includes(e.code)) return;
    onChange([...keys, e.code].slice(-MAX_KEYS));
  };
  return (
    <li className="controls-row" data-testid={`controls-${action}`}>
      <span className="controls-row__action">{t(WORDS[action])}</span>
      <span className="controls-row__keys">
        {keys.map((k) => (
          <span key={k} className="controls-row__key">
            <Keycap>{keyLabel(k)}</Keycap>
            <button type="button" className="controls-row__remove" aria-label={t('world.controlsRemove', { key: keyLabel(k) })} onClick={() => onChange(keys.filter((x) => x !== k))} disabled={keys.length <= 1}>
              <Icon name="close" size={14} />
            </button>
          </span>
        ))}
      </span>
      <Button size={38} variant={listening ? 'lantern' : 'ghost'} icon="plus" onClick={() => setListening((v) => !v)} onKeyDown={onKey} onBlur={() => setListening(false)} aria-pressed={listening}>
        {listening ? t('world.controlsPress') : t('world.controlsAdd')}
      </Button>
    </li>
  );
}

export function ControlsSheet({ open, world, onClose }: { open: boolean; world: World; onClose(): void }) {
  const actions = useStore((s) => s.session.manifest?.controls) ?? NO_ACTIONS;
  const [draft, setDraft] = useState<World['controls']>(world.controls);
  useEffect(() => {
    if (open) setDraft(world.controls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    onClose();
    if (JSON.stringify(draft) === JSON.stringify(world.controls)) return;
    const next = updateWorld((w) => {
      w.controls = draft;
    });
    void recordStep({ kind: 'code', by: 'student', text: t('world.stepControls') });
    if (next) void loadGame(next, { autostart: true });
  };

  const shown = actions.filter((a) => a !== 'pause');
  return (
    <Sheet open={open} onClose={close} title={t('world.controlsTitle')} side="right">
      <p className="dialog__text">{t('world.controlsIntro')}</p>
      {shown.length ? (
        <ul className="controls-list">
          {shown.map((a) => (
            <Row
              key={a}
              action={a}
              keys={draft[a]?.length ? draft[a]! : USUAL_KEYS[a]}
              onChange={(keys) => setDraft((d) => ({ ...d, [a]: keys }))}
            />
          ))}
        </ul>
      ) : (
        <p className="dialog__text">{t('world.controlsNone')}</p>
      )}
      <Button variant="quiet" icon="restart" onClick={() => setDraft({})} disabled={!Object.keys(draft).length}>
        {t('world.controlsReset')}
      </Button>
    </Sheet>
  );
}
