/** "Amble can't make that one. How about one of these?" (§2.8; M5 owns). FOUNDATION-STUB. */
import { Chip } from '../../ui/components';

export interface RefusalCardProps {
  note: string;
  alternatives: string[];
  onPick(alternative: string): void;
}

export function RefusalCard({ note, alternatives, onPick }: RefusalCardProps) {
  return (
    <div className="stub-ai">
      <p>{note}</p>
      {alternatives.map((a) => (
        <Chip key={a} onClick={() => onPick(a)}>
          {a}
        </Chip>
      ))}
    </div>
  );
}
