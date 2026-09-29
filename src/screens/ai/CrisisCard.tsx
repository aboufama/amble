/**
 * The crisis card (§2.16; M5 owns): replaces any AI response when the words suggest distress; nothing is
 * sent. FOUNDATION-STUB: the core's card text in a dialog.
 */
import { CRISIS_CARD } from '../../cores/ai';
import { Button, Dialog } from '../../ui/components';

export interface CrisisCardProps {
  open: boolean;
  onClose(): void;
}

export function CrisisCard({ open, onClose }: CrisisCardProps) {
  return (
    <Dialog open={open} tone="paper" size="sm" title={CRISIS_CARD.title} onClose={onClose} actions={<Button variant="lantern" onClick={onClose}>{CRISIS_CARD.button}</Button>}>
      <p className="dialog__text">{CRISIS_CARD.body}</p>
      <p className="dialog__text">{CRISIS_CARD.help}</p>
    </Dialog>
  );
}
