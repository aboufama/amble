/**
 * The Desk's few icons that the shared set does not have, drawn the same way (a 24 px grid, a 2 px
 * stroke with round caps, `currentColor`, clean and geometric): the colour picker, pages, the photo and
 * the fold arrow of the request note.
 */
const PATHS = {
  eyedropper: ['M11.5 7.5l5 5', 'M14 10l-7.5 7.5H4.5v-2L12 8', 'M14.5 7.5l3-3a2.12 2.12 0 0 1 3 3l-3 3'],
  pages: ['M8 4h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M4 8v11a1 1 0 0 0 1 1h11'],
  photo: ['M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', 'M12 9.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z'],
  caret: ['M6 9l6 6 6-6'],
} as const;

export type DeskIconName = keyof typeof PATHS;

export function DeskIcon({ name, size = 24 }: { name: DeskIconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
