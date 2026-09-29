/**
 * The crisis card (§2.16; M5): replaces any AI response when the words suggest distress. Nothing is sent,
 * there is no retry in the same turn, and Footsteps records only "refused: support". A paper dialog with
 * Read to me.
 */
import { t } from '../../i18n';
import { readAloud } from '../../ui/a11y';
import { Button, Dialog } from '../../ui/components';
import './ai.css';

export interface CrisisCardProps {
  open: boolean;
  onClose(): void;
}

export function CrisisCard({ open, onClose }: CrisisCardProps) {
  const lines = [t('ai.crisisTitle'), t('ai.crisisBody'), t('ai.crisisHelp')];
  const canRead = typeof speechSynthesis !== 'undefined';
  return (
    <Dialog
      open={open}
      tone="paper"
      size="sm"
      title={t('ai.crisisTitle')}
      onClose={() => onClose()}
      className="ai-crisis"
      actions={
        <>
          {canRead && (
            <Button variant="ghost" icon="readAloud" onClick={() => readAloud(lines.join(' '))}>
              {t('ai.readToMe')}
            </Button>
          )}
          <Button variant="lantern" onClick={onClose} data-autofocus>
            {t('ai.crisisBack')}
          </Button>
        </>
      }
    >
      <div className="ai-card__lines" data-testid="ai-crisis">
        <p>{t('ai.crisisBody')}</p>
        <p className="ai-crisis__help">{t('ai.crisisHelp')}</p>
      </div>
    </Dialog>
  );
}
