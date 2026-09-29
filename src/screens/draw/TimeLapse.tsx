/**
 * Watch it drawn (⋯ menu, §2.10): the drawing's strokes replayed at 8× on a copy of the sheet, from the
 * stroke log kept on this Chromebook. Under reduced motion it waits for Play.
 */
import { useEffect, useRef, useState } from 'react';
import { playStrokeLog, type StrokeLogPlayback } from '../../cores/art';
import type { DeskController } from '../../draw/deskController';
import { t } from '../../i18n';
import { useStore } from '../../state/store';
import { useReducedMotion } from '../../ui/a11y';
import { Button, Dialog } from '../../ui/components';
import { PAPER, THEMES } from '../../ui/tokens';

export function TimeLapse({ open, onClose, ctrl, name }: { open: boolean; onClose(): void; ctrl: DeskController; name: string }) {
  const host = useRef<HTMLDivElement>(null);
  const playback = useRef<StrokeLogPlayback | null>(null);
  const reduced = useReducedMotion();
  const [state, setState] = useState<'playing' | 'done' | 'empty' | 'ready'>('ready');
  const [run, setRun] = useState(0);
  const theme = useStore((st) => st.prefs.theme);

  useEffect(() => {
    if (!open) return;
    const ops = ctrl.surface.log();
    if (!ops.length) {
      setState('empty');
      return;
    }
    let live = true;
    setState((st) => (st === 'empty' ? 'ready' : st));
    const start = () => {
      const el = host.current;
      if (!el || !live) return;
      const p = playStrokeLog(el, ops, { speed: 8, paper: PAPER.paper, workspace: THEMES[theme].well, autoplay: !reduced || run > 0 });
      playback.current = p;
      setState(!reduced || run > 0 ? 'playing' : 'ready');
      void p.done.then(() => {
        if (live) setState('done');
      });
    };
    // The dialog's body lays out first.
    const raf = requestAnimationFrame(start);
    return () => {
      live = false;
      cancelAnimationFrame(raf);
      playback.current?.stop();
      playback.current = null;
    };
  }, [open, ctrl, reduced, run, theme]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('draw.watchTitle', { name })}
      size="lg"
      className="watch"
      actions={
        state === 'empty' ? null : (
          <Button variant="lantern" icon={state === 'ready' ? 'play' : 'restart'} onClick={() => setRun((n) => n + 1)} disabled={state === 'playing'}>
            {state === 'ready' ? t('draw.playPages') : t('draw.watchAgain')}
          </Button>
        )
      }
    >
      {state === 'empty' ? <p>{t('draw.watchEmpty')}</p> : <div ref={host} className="watch__sheet" aria-label={t('draw.watchTitle', { name })} role="img" />}
    </Dialog>
  );
}
