/**
 * Change mode over the paused world (§2.7): a light veil with a clear window around the selected thing,
 * edged in Scratch's purple; a white tag above everything in it (the chosen one with the purple edge and
 * halo; scenery's words are quieter; they fade and rise 6 px, 20 ms apart), taps on the things themselves,
 * and the thing card. Keys: Tab moves between the tags, Enter opens one, Esc closes the card, Esc again
 * goes back to Play.
 */
import { useId, useMemo, type MouseEvent } from 'react';
import { useEscape } from '../../app/keys';
import { t } from '../../i18n';
import type { CastMember } from '../../model/types';
import { selectThing, setMode } from '../../state/session';
import { useStore } from '../../state/store';
import { roleWord } from '../../ui/components';
import { cx } from '../../ui/cx';
import { hitTest, placeTag, tagsOf, type ThingTag } from '../../world/objects';
import { ThingCard } from './ThingCard';

const TAG_H = 30;

/** "Grumble ×2" · "just bones" / "hero" / "made by the game" / "draw it?" */
export function tagWords(tag: ThingTag, member: CastMember | null): { name: string; what: string } {
  const name = tag.count > 1 ? `${tag.label} ${t('world.countTimes', { n: tag.count })}` : tag.label;
  if (tag.tone === 'scenery') {
    if (tag.drawn) return { name, what: '' };
    return { name, what: tag.role === 'background' ? t('world.tagDrawIt') : t('world.tagMadeByGame') };
  }
  if (!tag.drawn) return { name, what: t('world.tagJustBones') };
  return { name, what: (member ? roleWord(member.role) : roleWord(tag.role === 'scenery' ? 'decor' : tag.role)).toLowerCase() };
}

/** A rough width for a tag, so tags stay inside the world view (Atkinson at 14 px). */
function tagWidth(name: string, what: string): number {
  return Math.round(24 + name.length * 8.2 + (what ? 8 + what.length * 6.9 : 0));
}

export interface ChangeLayerProps {
  /** The world view's rect on the page. */
  frame: DOMRect;
  onDraw(member: CastMember): void;
  onBones(member: CastMember): void;
}

export function ChangeLayer({ frame, onDraw, onBones }: ChangeLayerProps) {
  const objects = useStore((s) => s.session.objects);
  const cast = useStore((s) => s.session.cast);
  const selectedId = useStore((s) => s.session.selectedId);
  const selectedKey = useStore((s) => s.session.selected);
  const helpId = useId();
  const tags = useMemo(() => tagsOf(objects), [objects]);
  const selected = objects.find((o) => o.id === selectedId) ?? (selectedKey ? objects.find((o) => o.key === selectedKey) : undefined);
  const member = selectedKey ? cast.find((m) => m.key === selectedKey) ?? null : null;

  // Esc closes the card first (the card's own layer), then leaves Change mode.
  useEscape(() => {
    setMode('play');
    return true;
  });

  const onVeil = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const hit = hitTest(objects, e.clientX - frame.left, e.clientY - frame.top);
    selectThing(hit?.key ? { id: hit.id, key: hit.key } : null);
  };

  const hole = selected ? { x: selected.x - 14, y: selected.y - 14, w: selected.w + 28, h: selected.h + 28 } : null;
  // A new rect only when the thing really moved: the card keeps focus while reports stream in.
  const [ax, ay, aw, ah] = selected ? [frame.left + selected.x, frame.top + selected.y, selected.w, selected.h] : [0, 0, 0, 0];
  const anchor = useMemo(() => (aw || ah ? new DOMRect(ax, ay, aw, ah) : null), [ax, ay, aw, ah]);
  const maskId = `veil-${helpId.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <div className="change-layer" role="application" aria-label={t('world.changeRegion')} aria-describedby={helpId} data-testid="change-layer" onClick={onVeil}>
      <svg className="change-layer__veil" width={frame.width} height={frame.height} aria-hidden="true">
        <defs>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            {hole && <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="8" fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" className="change-layer__night" mask={`url(#${maskId})`} />
        {hole && <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="8" className="change-layer__hole" />}
      </svg>
      <p id={helpId} className="sr-only">
        {t('world.changeHelp')}
      </p>
      {tags.map((tag, i) => {
        const m = cast.find((c) => c.key === tag.key) ?? null;
        const words = tagWords(tag, m);
        const pos = placeTag(tag.box, tagWidth(words.name, words.what), TAG_H, frame);
        const on = selectedKey === tag.key;
        return (
          <button
            key={tag.key}
            type="button"
            className={cx('thing-tag', `thing-tag--${tag.tone}`, on && 'thing-tag--on')}
            style={{ left: pos.x, top: pos.y, ['--i' as string]: i }}
            aria-pressed={on}
            aria-label={words.what ? t('world.tagLabel', { name: words.name, what: words.what }) : words.name}
            data-tag-key={tag.key}
            data-testid={`tag-${tag.key}`}
            onClick={(e) => {
              e.stopPropagation();
              selectThing(on ? null : { id: tag.id, key: tag.key });
            }}
          >
            <span className="thing-tag__name">{words.name}</span>
            {words.what && <em className="thing-tag__what">{words.what}</em>}
          </button>
        );
      })}
      {member && anchor && <ThingCard key={member.key} member={member} anchor={anchor} onDraw={onDraw} onBones={onBones} />}
    </div>
  );
}
