/**
 * Watch {name} move (§2.11): the rig preview on a lit ground strip under a lantern glow, with a pill
 * saying what it is doing ("Walking"). It is also a tiny toy: while it has focus, ← → walk and ↑ jumps;
 * a click sends it walking there. Under reduced motion it waits, still, until Play is pressed.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createRigPreview, hashRig, type AnimTweak, type BoundRig, type RigPreview } from '../../cores/rig';
import { nowWord } from '../../bones/words';
import { t } from '../../i18n';
import { IconButton, Keycap } from '../../ui/components';

export interface MovePreviewProps {
  bound: BoundRig | null;
  clip: string;
  tweak: AnimTweak;
  name: string;
  reduced: boolean;
}

const GROUND = 0.84;

export function MovePreview({ bound, clip, tweak, name, reduced }: MovePreviewProps) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<RigPreview | null>(null);
  const [now, setNow] = useState(clip);
  const [playing, setPlaying] = useState(!reduced);
  const [shown, setShown] = useState(0);
  const keys = useRef({ left: false, right: false });
  const amount = tweak.amount ?? 1;
  const speed = tweak.speed ?? 1;

  // the canvas follows the stage's size, in device pixels
  useLayoutEffect(() => {
    const el = stage.current;
    const c = canvas.current;
    if (!el || !c) return;
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(el.clientWidth * dpr));
      const h = Math.max(1, Math.round(el.clientHeight * dpr));
      if (c.width === w && c.height === h) return;
      c.width = w;
      c.height = h;
      preview.current?.setOptions({ height: h * 0.6 });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const p = createRigPreview(c, { height: c.height * 0.6, ground: GROUND, autoplay: false, onClip: (name) => setNow(name) });
    preview.current = p;
    return () => {
      p.destroy();
      preview.current = null;
    };
  }, []);

  // new bones: show them, and keep the move going
  useEffect(() => {
    const p = preview.current;
    if (!p || !bound) return;
    p.show(bound);
    setShown((n) => n + 1);
    if (playing) p.play(clip, { amount, speed });
    else p.pose(clip, 0.35);
    // only new bones re-show; a picked move or a Feel change has its own effect below
  }, [bound]);

  // a move picked, or its Feel changed: play it (or show a still of it while paused)
  useEffect(() => {
    const p = preview.current;
    if (!p || !bound) return;
    if (playing) p.play(clip, { amount, speed });
    else p.pose(clip, 0.35);
    setNow(clip);
  }, [clip, amount, speed, playing]);

  useEffect(() => {
    if (reduced) setPlaying(false);
  }, [reduced]);

  const toggle = () => {
    const p = preview.current;
    if (!p) return;
    if (playing) p.pause();
    setPlaying(!playing);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>, down: boolean) => {
    const p = preview.current;
    if (!p) return;
    const k = e.key;
    if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'ArrowUp' && k !== ' ') return;
    e.preventDefault();
    if (down && !playing) setPlaying(true);
    if (k === 'ArrowLeft') keys.current.left = down;
    if (k === 'ArrowRight') keys.current.right = down;
    p.input({ ...keys.current, jump: down && (k === 'ArrowUp' || k === ' ') });
  };

  const release = () => {
    keys.current = { left: false, right: false };
    preview.current?.input({});
  };

  const walkThere = (clientX: number) => {
    const p = preview.current;
    const c = canvas.current;
    if (!p || !c) return;
    const r = c.getBoundingClientRect();
    if (!playing) setPlaying(true);
    p.walkTo(((clientX - r.left) / Math.max(1, r.width)) * c.width);
  };

  const pill = playing ? nowWord(now) : t('bones.nowPaused');

  return (
    <div className="move-stage-wrap">
      <div
        ref={stage}
        className="move-stage"
        tabIndex={0}
        role="application"
        aria-label={t('bones.toyLabel', { name })}
        data-testid="bones-preview"
        data-clip={clip}
        data-amount={amount.toFixed(2)}
        data-speed={speed.toFixed(2)}
        data-shown={shown}
        data-bones={bound ? hashRig(bound.rig) : ''}
        data-playing={playing ? 'yes' : 'no'}
        onKeyDown={(e) => onKey(e, true)}
        onKeyUp={(e) => onKey(e, false)}
        onBlur={release}
        onPointerDown={(e) => walkThere(e.clientX)}
      >
        <div className="move-stage__glow" aria-hidden="true" />
        <canvas ref={canvas} className="move-stage__canvas" aria-hidden="true" />
        <div className="move-stage__ground" aria-hidden="true">
          <span className="move-stage__toy">
            <Keycap>←</Keycap>
            <Keycap>→</Keycap> {t('bones.toyWalk')} · <Keycap>↑</Keycap> {t('bones.toyJump')}
          </span>
        </div>
        <span className="move-stage__pill">
          <span className={playing ? 'move-stage__dot' : 'move-stage__dot move-stage__dot--off'} aria-hidden="true" />
          {pill}
        </span>
      </div>
      <IconButton className="move-stage__play" icon={playing ? 'pause' : 'play'} label={playing ? t('bones.pause') : t('bones.play')} variant="ghost" size={38} onClick={toggle} />
    </div>
  );
}
