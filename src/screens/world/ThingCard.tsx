/**
 * Change mode's thing card (§2.7): a night panel with a lantern border and an arrow pointing at the thing:
 * its sticker, name and role line, ✎ Redraw (✎ Draw it for "just bones") and Bones, then the dials the
 * game gave this member, and "Dials change the game right away. No AI needed."
 */
import { useEffect, useMemo, useRef } from 'react';
import { midSentence, t } from '../../i18n';
import type { CastMember } from '../../model/types';
import { closeThing } from '../../state/session';
import { useStore } from '../../state/store';
import { Button, IconButton, PlaceholderGlyph, Popover, roleWord, Sticker } from '../../ui/components';
import { DialSlider } from './DialSlider';
import { useSticker } from './hooks';

export interface ThingCardProps {
  member: CastMember;
  /** The thing's box on the page. */
  anchor: DOMRect;
  onDraw(member: CastMember): void;
  onBones(member: CastMember): void;
}

export function roleLine(m: CastMember): string {
  const role = roleWord(m.role);
  if (m.status !== 'drawn') return t('world.thingRoleBones', { role });
  if (m.count > 1) return t('world.thingRoleCount', { role, n: m.count });
  return t('world.thingRole', { role });
}

export function ThingCard({ member, anchor, onDraw, onBones }: ThingCardProps) {
  const all = useStore((s) => s.session.manifest?.dials);
  const dials = useMemo(() => (all ?? []).filter((d) => d.for === member.key), [all, member.key]);
  const sticker = useSticker(member.art);
  const drawn = !!member.art;
  const rigged = member.kind === 'character' && member.rig !== 'none';
  const placement = anchor.left + anchor.width / 2 > window.innerWidth / 2 - 180 ? 'left' : 'right';
  const head = useRef<HTMLDivElement>(null);
  // The card opens hidden while it measures itself; focus its main button once it shows.
  useEffect(() => {
    const id = requestAnimationFrame(() => head.current?.parentElement?.querySelector<HTMLElement>('[data-testid="thing-draw"]')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [member.key]);
  return (
    <Popover open anchor={anchor} onClose={closeThing} label={member.name} placement={placement} tone="lantern" className="thing-card">
      <div ref={head} className="thing-card__head" data-testid="thing-card" data-key={member.key}>
        <span className="thing-card__pic" aria-hidden="true">
          {drawn ? <Sticker src={sticker} alt="" size={54} /> : <PlaceholderGlyph rig={member.rig} role={member.role} shape={member.shape} size={54} />}
        </span>
        <div className="thing-card__title">
          <h3>{member.name}</h3>
          <p>{roleLine(member)}</p>
        </div>
        <IconButton icon="close" label={t('world.closeCard')} size={38} variant="quiet" tooltip={false} onClick={closeThing} className="thing-card__close" />
      </div>
      <div className="thing-card__actions">
        <Button variant="paper" icon="draw" size={38} onClick={() => onDraw(member)} data-testid="thing-draw">
          {drawn ? t('world.redraw') : t('world.drawIt')}
        </Button>
        {rigged && drawn && (
          <Button variant="paper" icon="bones" size={38} onClick={() => onBones(member)} data-testid="thing-bones">
            {t('world.bones')}
          </Button>
        )}
      </div>
      <h4 className="thing-card__label">{t('world.dialsTitle')}</h4>
      {dials.length ? (
        <div className="thing-card__dials">
          {dials.map((d) => (
            <DialSlider key={d.key} dial={d} className="thing-card__dial" />
          ))}
        </div>
      ) : (
        <p className="thing-card__none">{t('world.noThingDials', { name: midSentence(member.name) })}</p>
      )}
      <p className="thing-card__note">{t('world.dialsNote')}</p>
    </Popover>
  );
}
