/** Icons drawn on blocks and on the workspace (Amble's own drawings, sized like Scratch's). */

const svgUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** The green flag in "when [flag] clicked". */
export const FLAG_ICON = svgUri(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<path d="M4.4 2.6v18.6" fill="none" stroke="#45993d" stroke-width="2.3" stroke-linecap="round"/>' +
    '<path d="M5.5 4.1c2.4-1.7 5-1.6 7.2.2 2.2 1.8 4.9 1.9 7.3.1v9.4c-2.4 1.9-5.1 1.8-7.3 0-2.2-1.8-4.8-1.9-7.2-.1z" fill="#4cbf56" stroke="#45993d" stroke-width="1.3" stroke-linejoin="round"/>' +
    '</svg>',
);

/** The loop arrow at the bottom right of "repeat", "forever" and "repeat until". */
export const REPEAT_ICON = svgUri(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<g fill="none" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M5.6 15.4c2.9 3.1 8.2 2.6 10.1-1.4.5-1 .7-2.2.6-3.3" stroke="#cf8b17" stroke-width="4.4"/>' +
    '<path d="M12.6 11.3l3.8-4.4 3.8 4.4z" fill="#cf8b17" stroke="#cf8b17" stroke-width="2.6"/>' +
    '<path d="M5.6 15.4c2.9 3.1 8.2 2.6 10.1-1.4.5-1 .7-2.2.6-3.3" stroke="#fff" stroke-width="2"/>' +
    '<path d="M12.6 11.3l3.8-4.4 3.8 4.4z" fill="#fff" stroke="#fff" stroke-width=".4"/>' +
    '</g></svg>',
);

const zoomButton = (glyph: string) =>
  svgUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">' +
      '<circle cx="18" cy="18" r="18" fill="#000" fill-opacity=".15"/>' +
      '<circle cx="18" cy="18" r="16.5" fill="#fff"/>' +
      `<g fill="none" stroke="#575e75" stroke-opacity=".8" stroke-width="1.5" stroke-linecap="round">${glyph}</g>` +
      '</svg>',
  );

const lens = '<circle cx="17.5" cy="17.5" r="6.5"/><path d="M22.3 22.3l3.4 3.4"/>';

export const ZOOM_IN_ICON = zoomButton(`${lens}<path d="M15 17.5h5M17.5 15v5"/>`);
export const ZOOM_OUT_ICON = zoomButton(`${lens}<path d="M15 17.5h5"/>`);
export const ZOOM_RESET_ICON = zoomButton('<path d="M13.5 15h9M13.5 21h9" stroke-width="2"/>');

/** Little pictures for the special characters (white, drawn on the teal character blocks). */
const specialIcon = (body: string) =>
  svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`);

export const SPECIAL_ICONS: Record<string, string> = {
  // A face: the sprite running the script.
  me: specialIcon('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5q3.5 3 7 0"/><circle cx="9" cy="10" r=".6" fill="#fff"/><circle cx="15" cy="10" r=".6" fill="#fff"/>'),
  // A mouse pointer.
  mouse: specialIcon('<path d="M6 3l12 9-5.2.9 3 6-2.6 1.2-3-6L6 17z" fill="#fff" fill-opacity=".25"/>'),
  // A die.
  random: specialIcon('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r=".8" fill="#fff"/><circle cx="15.5" cy="15.5" r=".8" fill="#fff"/><circle cx="12" cy="12" r=".8" fill="#fff"/>'),
  // Crosshairs.
  center: specialIcon('<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'),
  // The screen's frame.
  edge: specialIcon('<rect x="3" y="5" width="18" height="14" rx="2" stroke-dasharray="3 2.4"/>'),
  // Two people.
  anyone: specialIcon('<circle cx="8.5" cy="8" r="3"/><circle cx="16" cy="9" r="2.5"/><path d="M3 19c.5-3.5 2.6-5.5 5.5-5.5s5 2 5.5 5.5M14.5 14c2.6-.4 5.3 1.2 6 4.5"/>'),
};

/** A sprite without a picture (or one that no longer exists). */
export const UNKNOWN_CHARACTER_ICON = specialIcon('<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-4.2 3.6-6.5 7.5-6.5s6.7 2.3 7.5 6.5"/>');
