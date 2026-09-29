/**
 * Small pieces of the Desk: the pivot pin on the sheet (where it stands in the game), and the Desk's toast
 * above the view bar ("Perfect circle!", "Closed a small gap and filled it.").
 */
import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { DeskController } from '../../draw/deskController';
import { midSentence, t } from '../../i18n';
import { Icon } from '../../ui/icons';

/**
 * The pivot pin (mint): where the drawing stands in the game. Drag it, or focus it and use the arrow keys
 * (Shift for 10 board px); Delete lets it follow the drawing again. Kept in place by the view's events,
 * without re-rendering the Desk.
 */
export function PivotPin({ ctrl, pin, name, stage }: { ctrl: DeskController; pin: [number, number] | null; name: string; stage: HTMLElement | null }) {
  const el = useRef<HTMLButtonElement>(null);
  const at = useRef(pin);
  at.current = pin;
  const drag = useRef<[number, number] | null>(null);
  const hintId = useId();

  useEffect(() => {
    const place = () => {
      const b = el.current;
      const p = drag.current ?? at.current;
      if (!b || !p || !stage) return;
      const c = ctrl.surface.docToClient(p[0], p[1]);
      const r = stage.getBoundingClientRect();
      b.style.transform = `translate(${Math.round(c.x - r.left)}px, ${Math.round(c.y - r.top)}px)`;
    };
    place();
    const off = ctrl.surface.on('view', place);
    const ro = new ResizeObserver(place);
    if (stage) ro.observe(stage);
    return () => {
      off();
      ro.disconnect();
    };
  }, [ctrl, pin, stage]);

  if (!pin) return null;

  const move = (e: PointerEvent<HTMLButtonElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const d = ctrl.surface.clientToDoc(e.clientX, e.clientY);
    drag.current = [d.x, d.y];
    const c = ctrl.surface.docToClient(d.x, d.y);
    const r = stage?.getBoundingClientRect();
    if (r && el.current) el.current.style.transform = `translate(${Math.round(c.x - r.left)}px, ${Math.round(c.y - r.top)}px)`;
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 10 : 2;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      ctrl.setPin(null);
      return;
    }
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    ctrl.setPin([pin[0] + m[0], pin[1] + m[1]]);
  };

  return (
    <button
      ref={el}
      type="button"
      className="pin"
      aria-label={t('draw.pivot', { name: midSentence(name) })}
      aria-describedby={hintId}
      title={t('draw.pivotHint')}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        e.stopPropagation();
      }}
      onPointerMove={move}
      onPointerUp={(e) => {
        if (drag.current) ctrl.setPin(drag.current);
        drag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <span className="pin__dot" aria-hidden="true" />
      <span id={hintId} hidden>
        {t('draw.pivotHint')}
      </span>
    </button>
  );
}

/** The Desk's own toast, above the view bar (the paper's quick words). */
export function DeskToast({ text, onDone }: { text: string | null; onDone(): void }) {
  useEffect(() => {
    if (!text) return;
    const id = window.setTimeout(onDone, 2800);
    return () => clearTimeout(id);
  }, [text, onDone]);
  return (
    <div className="desk-toast-slot" role="status" aria-live="polite">
      {text && (
        <p className="desk-toast" key={text}>
          <Icon name="check" size={18} />
          <span>{text}</span>
        </p>
      )}
    </div>
  );
}
