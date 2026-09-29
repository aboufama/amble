/**
 * Pictures for the twist tiles (§2.7), drawn on the icon set's 24 px grid with its 2 px round strokes, so
 * they sit beside the hand-inked icons. Unknown twists get the set's `twist` icon.
 */
import { Icon } from '../../ui/icons';

const GLYPHS: Record<string, string[]> = {
  moonGravity: ['M15.5 3.6a8.4 8.4 0 1 0 4.9 13.6 6.8 6.8 0 1 1-4.9-13.6z', 'M6 19.5l.1.1', 'M4.5 14l.1.1'],
  gravityFlips: ['M8 4.2v14.6', 'M4.4 7.7 8 4.1l3.6 3.6', 'M16 19.8V5.2', 'M12.4 16.3 16 19.9l3.6-3.6'],
  giantHero: ['M12 2.8a2.6 2.6 0 1 1-.1 0z', 'M12 8.2v7', 'M6.4 10.6h11.2', 'M12 15.2l-4 6', 'M12 15.2l4 6', 'M2.8 6.2V2.8h3.4', 'M21.2 6.2V2.8h-3.4'],
  tinyHero: ['M12 9.4a1.5 1.5 0 1 1-.1 0z', 'M12 12.4v3.4', 'M9.6 13.6h4.8', 'M12 15.8l-1.8 2.6', 'M12 15.8l1.8 2.6', 'M4 4l3.2 3.2', 'M20 4l-3.2 3.2', 'M4 20l3.2-3.2', 'M20 20l-3.2-3.2'],
  slowmoHits: ['M12 3.4a8.6 8.6 0 1 1-.1 0z', 'M12 7.4V12l3.2 2.2'],
  slowTime: ['M6.6 3.2h10.8', 'M6.6 20.8h10.8', 'M8 3.2c0 5.2 8 5.2 8 8.8s-8 3.6-8 8.8', 'M16 3.2c0 5.2-8 5.2-8 8.8s8 3.6 8 8.8'],
  bouncyWorld: ['M12 11.2a4.4 4.4 0 1 1-.1 0z', 'M3.4 20.6h17.2', 'M3.6 8.6c1.6-3 3.8-3 5.4 0', 'M15 5.6c1.6-3 3.8-3 5.4 0'],
  starRain: ['M12 3.2l1.7 3.5 3.8.5-2.8 2.6.7 3.8-3.4-1.8-3.4 1.8.7-3.8-2.8-2.6 3.8-.5z', 'M5 15.6v2.2', 'M12 16.4v4', 'M19 15.6v2.2'],
  enemyParty: ['M7 5.4a2.6 2.6 0 1 1-.1 0z', 'M17 5.4a2.6 2.6 0 1 1-.1 0z', 'M12 9.6a2.6 2.6 0 1 1-.1 0z', 'M3 15.6c0-2.6 1.8-4 4-4s4 1.4 4 4', 'M13 15.6c0-2.6 1.8-4 4-4s4 1.4 4 4', 'M7.6 20.6c0-2.6 2-4 4.4-4s4.4 1.4 4.4 4'],
  speedUp: ['M13.4 2.8 4.8 13.6h6.6l-1.2 7.6 9-11h-6.8z'],
  surpriseBoss: ['M3.4 18.4h17.2', 'M3.8 7.6l3.6 7.2h9.2l3.6-7.2-4.8 3.4L12 4.6l-3.4 6.4z'],
  earthquake: ['M2.6 13h3.8l2-5.2 3 10.4 3-8.2 1.8 3h5.2', 'M4 19.6h16'],
  doubleJump: ['M6.2 12.6 12 6.8l5.8 5.8', 'M6.2 18.6 12 12.8l5.8 5.8'],
};

export function TwistIcon({ id, size = 22 }: { id: string; size?: number }) {
  const paths = GLYPHS[id];
  if (!paths) return <Icon name="twist" size={size} />;
  return (
    <svg className="icon twist-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
