/** "Amble made it a little gentler: {note}" (§2.8; M5 owns). FOUNDATION-STUB: the note. */
import type { SafetyNote as Note } from '../../model/types';

export function SafetyNote({ note }: { note: Note }) {
  if (note.kind === 'ok') return null;
  return <p className="paper on-paper stub-ai">{note.note}</p>;
}
