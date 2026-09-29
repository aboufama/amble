/**
 * "How wishes work" (MAGIC-BRIEF.md): the short, honest sheet behind the ⓘ link beside the wish box. It
 * is the only student-facing place that names the AI, and it opens only when the student asks (never by
 * itself, never before a first wish). It says who turns the words into code, that it never draws, to keep
 * private things out, that it can make mistakes, and it links to What Amble sends. Read to me reads it.
 */
import { Link } from '../../app/Link';
import { t } from '../../i18n';
import { useStore } from '../../state/store';
import { readAloud } from '../../ui/a11y';
import { Button, Dialog } from '../../ui/components';
import { useAmbleAi } from './hooks';
import { wordsGoTo } from './words';
import './ai.css';

export interface HowWishesWorkProps {
  open: boolean;
  onClose(): void;
  /** Opens What Amble sends itself (the caller keeps what the student typed first); by default the link does. */
  onWhatsSent?(): void;
}

export function HowWishesWork({ open, onClose, onWhatsSent }: HowWishesWorkProps) {
  const ai = useAmbleAi();
  const linkDistrict = useStore((s) => s.config.classLink?.district ?? s.config.ai?.district?.name ?? null);
  const school = useStore((s) => (s.config.school || s.config.classLink !== null) && wordsGoTo(s.config.ai) !== 'home');
  const district = ai?.district() ?? linkDistrict;
  const service = !school ? t('ai.howServiceHome') : district ? t('ai.howServiceNamed', { district }) : t('ai.howService');
  const lines = [service, t('ai.howPrivate'), t('ai.howMistakes')];
  const canRead = typeof speechSynthesis !== 'undefined';
  return (
    <Dialog
      open={open}
      tone="paper"
      size="sm"
      title={t('ai.howTitle')}
      onClose={() => onClose()}
      className="wish-how-sheet"
      actions={
        <>
          {canRead && (
            <Button variant="ghost" icon="readAloud" onClick={() => readAloud([t('ai.howTitle'), ...lines].join(' '))}>
              {t('ai.readToMe')}
            </Button>
          )}
          <Button variant="lantern" onClick={onClose} data-autofocus>
            {t('ai.howGotIt')}
          </Button>
        </>
      }
    >
      <div className="wish-how-sheet__lines" data-testid="ai-explainer">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p>
          <Link
            className="wish-link"
            to={{ name: 'page', page: 'sent' }}
            onClick={(e) => {
              if (!onWhatsSent) {
                onClose();
                return;
              }
              e.preventDefault();
              onWhatsSent();
            }}
          >
            {t('ai.howSent')}
          </Link>
        </p>
      </div>
    </Dialog>
  );
}
