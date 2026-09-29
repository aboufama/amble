/** A gentler version of a wish (§2.8 Toned down): "A little gentler: the minions bounce off instead of getting hurt." */
import type { SafetyNote as Note } from '../../model/types';
import { gentlerText } from './words';
import './ai.css';

export function SafetyNote({ note }: { note: Note }) {
  if (note.kind === 'ok' || !note.note.trim()) return null;
  return (
    <div className="wish-note">
      <p className="wish-note__text" role="note" data-testid="ai-safety-note">
        {gentlerText(note.note)}
      </p>
    </div>
  );
}
