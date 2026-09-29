/**
 * The Desk's few icons that the shared set does not have, drawn the same way (a 24 px grid, round caps,
 * `currentColor`, a slight hand wobble): the colour picker, box select, steady, the pivot pin and pages.
 */
const PATHS = {
  eyedropper: ['M14.6 4.6c1.2-1.2 3.1-1.2 4.3 0 1.2 1.2 1.2 3.1 0 4.3l-2 2-4.3-4.3z', 'M13.6 7.6l2.8 2.8-7.5 7.6c-.7.7-1.6 1.1-2.6 1.1l-1.6 1.5-1.5-1.5 1.5-1.6c0-1 .4-1.9 1.1-2.6z', 'M11.5 5.5c2.4 2.3 4.7 4.6 7 7'],
  boxSelect: ['M4.6 7.9V5.2c0-.4.3-.7.7-.6h2.6', 'M11 4.6h2.2', 'M16.2 4.6h2.6c.4 0 .6.3.6.7v2.6', 'M19.4 11v2.1', 'M19.4 16.2v2.6c0 .4-.3.6-.7.6h-2.6', 'M13 19.4h-2.1', 'M7.8 19.4H5.2c-.4 0-.6-.3-.6-.7v-2.5', 'M4.6 13.1v-2.2'],
  steady: ['M3.8 15.8c1.6-3.2 2.8-3.4 4.1-.9 1.2 2.3 2.4 2.1 3.8-.4', 'M11.7 14.5c1.9-1.7 5.2-1.8 8.5-1.7'],
  pin: ['M12 3.8a4.6 4.6 0 1 0 .1 9.2 4.6 4.6 0 0 0-.1-9.2z', 'M12 13c.1 2.5.1 4.9 0 7.3'],
  pages: ['M8.3 4.4c3.6-.1 7.2-.1 10.8 0 .1 3.8.1 7.5 0 11.3-3.6.1-7.2.1-10.8 0-.1-3.8-.1-7.5 0-11.3z', 'M5.3 7.6v11.7c3.8.1 7.6.1 11.4 0'],
  photo: ['M4.2 7.6c0-.8.6-1.4 1.4-1.4h2.3l1.4-2h5.4l1.4 2h2.3c.8 0 1.4.6 1.4 1.4v10.2c0 .8-.6 1.4-1.4 1.4H5.6c-.8 0-1.4-.6-1.4-1.4-.1-3.4-.1-6.8 0-10.2z', 'M12 9.2a3.4 3.4 0 1 0 .1 6.8 3.4 3.4 0 0 0-.1-6.8z'],
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
