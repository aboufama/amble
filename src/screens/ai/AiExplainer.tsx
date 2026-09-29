/**
 * "Meet the AI helper." (§2.16; M5): a paper card before the first Ask or idea on a device, with Read to
 * me. **Got it** closes it (`onClose`); **What gets sent?** opens What Amble sends.
 */
import { useStore } from '../../state/store';
import { t } from '../../i18n';
import { readAloud } from '../../ui/a11y';
import { Button, Dialog } from '../../ui/components';
import { useAmbleAi } from './hooks';
import './ai.css';

export interface AiExplainerProps {
  open: boolean;
  onClose(): void;
  onWhatsSent?(): void;
}

export function AiExplainer({ open, onClose, onWhatsSent }: AiExplainerProps) {
  const ai = useAmbleAi();
  const linkDistrict = useStore((s) => s.config.classLink?.district ?? s.config.ai?.district?.name ?? null);
  const district = ai?.district() ?? linkDistrict ?? t('ai.districtFallback');
  const lines = [t('ai.explainerCode'), t('ai.explainerWords', { district }), t('ai.explainerMistakes')];
  const canRead = typeof speechSynthesis !== 'undefined';
  return (
    <Dialog
      open={open}
      tone="paper"
      size="sm"
      title={t('ai.explainerTitle')}
      onClose={() => onClose()}
      className="ai-explainer"
      actions={
        <>
          {onWhatsSent && (
            <Button variant="ghost" onClick={onWhatsSent}>
              {t('ai.explainerWhatsSent')}
            </Button>
          )}
          <Button variant="lantern" onClick={onClose} data-autofocus>
            {t('ai.explainerGotIt')}
          </Button>
        </>
      }
    >
      <div className="ai-card__lines" data-testid="ai-explainer">
        <p className="ai-card__lead">{lines[0]}</p>
        <p>{lines[1]}</p>
        <p>{lines[2]}</p>
        {canRead && (
          <div>
            <Button size={38} variant="ghost" icon="readAloud" onClick={() => readAloud([t('ai.explainerTitle'), ...lines].join(' '))}>
              {t('ai.readToMe')}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
