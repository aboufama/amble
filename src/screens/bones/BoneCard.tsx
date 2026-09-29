/**
 * A bone's card (§2.11's fix-it table): tap a bone for **Remove** (a sword read as an arm, a wrong
 * wiggly bit) or **Something I'm holding** (it moves as one stiff piece). Opened from the sky or the
 * bone list; Esc or a click outside closes it and focus goes back.
 */
import type { RigData } from '../../cores/rig';
import { boneName } from '../../bones/words';
import { t } from '../../i18n';
import { Button, Popover } from '../../ui/components';

export interface BoneCardProps {
  rig: RigData;
  index: number;
  anchor: DOMRect;
  onClose(): void;
  onRemove(): void;
  onHold(held: boolean): void;
}

export function BoneCard({ rig, index, anchor, onClose, onRemove, onHold }: BoneCardProps) {
  const bone = rig.bones[index];
  const name = boneName(rig, index);
  const title = t('bones.boneCard', { bone: name });
  const held = !!bone.rigid;
  return (
    <Popover open anchor={anchor} onClose={onClose} label={title} placement="right" className="bone-card">
      <h2 className="bone-card__title">{title}</h2>
      <div className="bone-card__actions">
        <Button variant="ghost" size={44} icon="lock" aria-pressed={held} onClick={() => onHold(!held)}>
          {t('bones.boneHolding')}
        </Button>
        <p className="bone-card__hint">{t('bones.boneHoldingHint')}</p>
        <Button variant="danger" size={44} icon="close" onClick={onRemove}>
          {t('bones.boneRemove')}
        </Button>
      </div>
    </Popover>
  );
}
