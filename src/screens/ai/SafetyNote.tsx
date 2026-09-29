/** "Amble made it a little gentler: {note}" (§2.8 Toned down; M5): a paper note inside the Ask card. */
import type { SafetyNote as Note } from '../../model/types';
import { PaperCard } from '../../ui/components';
import { gentlerText } from './words';
import './ai.css';

export function SafetyNote({ note }: { note: Note }) {
  if (note.kind === 'ok' || !note.note.trim()) return null;
  return (
    <PaperCard className="ai-paper" tilt={-0.6} cut>
      <p className="ai-paper__text" role="note" data-testid="ai-safety-note">
        {gentlerText(note.note)}
      </p>
    </PaperCard>
  );
}
