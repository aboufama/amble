/**
 * The Teacher desk's few extra icons (link, clipboard, folder, letter, projector, copy, download, shield,
 * clock, print, code, QR, next, trash, server, wish), drawn to the set's rules (§3.5): a 24 px grid, clean
 * geometric shapes with a 2 px stroke and round caps and joins, in `currentColor`. Decorative: the words
 * beside them name things.
 */
const PATHS = {
  link: ['M10 13.5a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1', 'M14 10.5a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1'],
  clipboard: ['M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2', 'M9 3.5h6v3H9z', 'M9 11h6', 'M9 14.5h6', 'M9 18h3.5'],
  folder: ['M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z'],
  letter: ['M4 6.5h16v11H4z', 'M4.5 7l7.5 6 7.5-6'],
  present: ['M3.5 5h17v11.5h-17z', 'M12 16.5V20', 'M8 20h8'],
  copy: ['M9 9h11v11H9z', 'M15.5 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h3'],
  download: ['M12 4v11', 'M7.5 10.5 12 15l4.5-4.5', 'M5 19.5h14'],
  shield: ['M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6z', 'm9 12 2.2 2.2L15.5 10'],
  clock: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M12 7.5V12l3 2'],
  print: ['M7 9V4h10v5', 'M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2', 'M7 14h10v6H7z'],
  code: ['M9 7l-5 5 5 5', 'M15 7l5 5-5 5'],
  qr: ['M4.5 4.5h5.5v5.5H4.5z', 'M14 4.5h5.5v5.5H14z', 'M4.5 14h5.5v5.5H4.5z', 'M14 14h2.5v2.5H14z', 'M17 17h2.5v2.5H17z'],
  next: ['M9.5 5.5 16 12l-6.5 6.5'],
  trash: ['M5 7h14', 'M9.5 7V4.5h5V7', 'M7 7l.8 12.5h8.4L17 7'],
  /** The school's AI helper: a service on a server (the Teacher desk and Help name it in words). */
  server: ['M4.5 4.5h15v6h-15z', 'M4.5 13.5h15v6h-15z', 'M8 7.5h.01', 'M8 16.5h.01', 'M12 7.5h4', 'M12 16.5h4'],
  /** A wish: a student's own words (a speech bubble). */
  wish: ['M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 16h-8l-4.5 3.5V16H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 5z'],
} as const;

export type SchoolIconName = keyof typeof PATHS;

export function SchoolIcon({ name, size = 20 }: { name: SchoolIconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" focusable="false" aria-hidden="true">
      {PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
