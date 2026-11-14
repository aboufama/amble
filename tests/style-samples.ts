/**
 * One small picture per art style preset (and two typed styles), drawn by hand to its brief in
 * src/project/styles.ts: the same chick, 64 x 64, facing right. They show what each brief asks the
 * artist for, and check that sanitizeSvg keeps what each style is made of (tests/art.test.ts).
 */
const svg = (body: string, root = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"${root}>${body.replace(/\n\s*/g, '')}</svg>`;

export const STYLE_SAMPLES: Record<string, string> = {
  // Thick #2b2540 outlines with round joins, bright fills, one darker shape and one highlight, big eye.
  cartoon: svg(`
    <g stroke="#2b2540" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
      <path d="M24 50v9h5M36 50v9h5" fill="none"/>
      <path d="M12 29L3 23l3 14z" fill="#f58a2e"/>
      <circle cx="30" cy="31" r="21" fill="#ffd23f"/>
      <path d="M49 25l12 6-12 6z" fill="#f58a2e"/>
    </g>
    <path d="M48.7 34.3A19 19 0 0 1 26.7 49.7A25 25 0 0 0 48.7 34.3z" fill="#e3a51b"/>
    <ellipse cx="20" cy="19" rx="5" ry="2.6" fill="#ffffff" opacity="0.85" transform="rotate(-35 20 19)"/>
    <path d="M17 34q8-10 17 0q-9 9-17 0z" fill="#f58a2e" stroke="#2b2540" stroke-width="4" stroke-linejoin="round"/>
    <circle cx="39" cy="24" r="6.5" fill="#ffffff" stroke="#2b2540" stroke-width="3"/>
    <circle cx="41" cy="24" r="3" fill="#2b2540"/>
    <circle cx="42.2" cy="22.8" r="1.1" fill="#ffffff"/>
  `),
  // Rects on a 16 x 16 grid of 4-unit pixels, crisp edges, 1-pixel dark outline, six palette colours.
  pixel: svg('<rect x="20" y="4" width="24" height="4" fill="#1a1c2c"/><rect x="12" y="8" width="8" height="4" fill="#1a1c2c"/><rect x="20" y="8" width="24" height="4" fill="#ffcd75"/><rect x="44" y="8" width="8" height="4" fill="#1a1c2c"/><rect x="8" y="12" width="4" height="4" fill="#1a1c2c"/><rect x="12" y="12" width="4" height="4" fill="#ffcd75"/><rect x="16" y="12" width="8" height="4" fill="#f4f4f4"/><rect x="24" y="12" width="28" height="4" fill="#ffcd75"/><rect x="52" y="12" width="4" height="4" fill="#1a1c2c"/><rect x="8" y="16" width="4" height="4" fill="#1a1c2c"/><rect x="12" y="16" width="4" height="4" fill="#ffcd75"/><rect x="16" y="16" width="4" height="4" fill="#f4f4f4"/><rect x="20" y="16" width="20" height="4" fill="#ffcd75"/><rect x="40" y="16" width="8" height="4" fill="#f4f4f4"/><rect x="48" y="16" width="4" height="4" fill="#ffcd75"/><rect x="52" y="16" width="4" height="4" fill="#1a1c2c"/><rect x="4" y="20" width="4" height="4" fill="#1a1c2c"/><rect x="8" y="20" width="32" height="4" fill="#ffcd75"/><rect x="40" y="20" width="4" height="4" fill="#f4f4f4"/><rect x="44" y="20" width="4" height="4" fill="#1a1c2c"/><rect x="48" y="20" width="4" height="4" fill="#ffcd75"/><rect x="52" y="20" width="12" height="4" fill="#1a1c2c"/><rect x="4" y="24" width="4" height="4" fill="#1a1c2c"/><rect x="8" y="24" width="44" height="4" fill="#ffcd75"/><rect x="52" y="24" width="8" height="4" fill="#b13e53"/><rect x="60" y="24" width="4" height="4" fill="#1a1c2c"/><rect x="0" y="28" width="8" height="4" fill="#1a1c2c"/><rect x="8" y="28" width="44" height="4" fill="#ffcd75"/><rect x="52" y="28" width="12" height="4" fill="#1a1c2c"/><rect x="0" y="32" width="4" height="4" fill="#1a1c2c"/><rect x="4" y="32" width="4" height="4" fill="#b13e53"/><rect x="8" y="32" width="8" height="4" fill="#ffcd75"/><rect x="16" y="32" width="16" height="4" fill="#ef7d57"/><rect x="32" y="32" width="20" height="4" fill="#ffcd75"/><rect x="52" y="32" width="4" height="4" fill="#ef7d57"/><rect x="56" y="32" width="4" height="4" fill="#1a1c2c"/><rect x="0" y="36" width="8" height="4" fill="#1a1c2c"/><rect x="8" y="36" width="4" height="4" fill="#b13e53"/><rect x="12" y="36" width="8" height="4" fill="#ffcd75"/><rect x="20" y="36" width="16" height="4" fill="#ef7d57"/><rect x="36" y="36" width="16" height="4" fill="#ffcd75"/><rect x="52" y="36" width="4" height="4" fill="#ef7d57"/><rect x="56" y="36" width="4" height="4" fill="#1a1c2c"/><rect x="8" y="40" width="4" height="4" fill="#1a1c2c"/><rect x="12" y="40" width="36" height="4" fill="#ffcd75"/><rect x="48" y="40" width="8" height="4" fill="#ef7d57"/><rect x="56" y="40" width="4" height="4" fill="#1a1c2c"/><rect x="8" y="44" width="4" height="4" fill="#1a1c2c"/><rect x="12" y="44" width="32" height="4" fill="#ffcd75"/><rect x="44" y="44" width="12" height="4" fill="#ef7d57"/><rect x="56" y="44" width="4" height="4" fill="#1a1c2c"/><rect x="12" y="48" width="8" height="4" fill="#1a1c2c"/><rect x="20" y="48" width="16" height="4" fill="#ffcd75"/><rect x="36" y="48" width="12" height="4" fill="#ef7d57"/><rect x="48" y="48" width="8" height="4" fill="#1a1c2c"/><rect x="20" y="52" width="32" height="4" fill="#1a1c2c"/><rect x="20" y="56" width="4" height="4" fill="#1a1c2c"/><rect x="24" y="56" width="4" height="4" fill="#b13e53"/><rect x="36" y="56" width="4" height="4" fill="#1a1c2c"/><rect x="40" y="56" width="4" height="4" fill="#b13e53"/><rect x="16" y="60" width="8" height="4" fill="#1a1c2c"/><rect x="24" y="60" width="4" height="4" fill="#b13e53"/><rect x="28" y="60" width="4" height="4" fill="#1a1c2c"/><rect x="36" y="60" width="8" height="4" fill="#1a1c2c"/><rect x="44" y="60" width="4" height="4" fill="#b13e53"/><rect x="48" y="60" width="4" height="4" fill="#1a1c2c"/>', ' shape-rendering="crispEdges"'),
  // Flat uneven shapes without outlines, each layer with the same soft drop shadow.
  paper: svg(`
    <defs><filter id="paper" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="1" dy="1.5" stdDeviation="1" flood-color="#2b1d12" flood-opacity="0.4"/></filter></defs>
    <g filter="url(#paper)"><path d="M22 49l-1 10 6 1-1-11zM34 49l-1 10 6 1-1-11z" fill="#c8553d"/></g>
    <g filter="url(#paper)"><path d="M13 27L3 21l2 17 8-4z" fill="#7a4a6a"/></g>
    <g filter="url(#paper)"><path d="M29 10l10 2 8 7 4 10-2 11-7 8-11 4-11-2-8-7-4-11 3-11 8-8z" fill="#e3a72f"/></g>
    <g filter="url(#paper)"><path d="M49 25l12 5-11 7z" fill="#c8553d"/></g>
    <g filter="url(#paper)"><path d="M16 33l6-7 9-1 6 8-7 8-9-1z" fill="#3f7d83"/></g>
    <g filter="url(#paper)"><path d="M34 22l5-3 5 3 0 5-5 3-5-3z" fill="#f4ead5"/></g>
    <circle cx="40" cy="24.5" r="2.2" fill="#3b3a3a"/>
  `),
  // Bright 3 px strokes, dark see-through fill, one blur-and-merge glow around the whole drawing.
  neon: svg(`
    <defs><filter id="glow" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="2.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <g filter="url(#glow)" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M24 49v8h4M35 49v8h4" stroke="#ff3df0"/>
      <path d="M12 27l-5-5 1 14 4-4" stroke="#ff3df0"/>
      <circle cx="30" cy="30" r="19" stroke="#22e6ff" fill="#0b0b1e" fill-opacity="0.55"/>
      <path d="M48 25l9 5-9 5" stroke="#fff04a"/>
      <path d="M19 33q8-9 15 0q-8 8-15 0z" stroke="#ff3df0"/>
      <circle cx="38" cy="24" r="2.5" stroke="#fff04a"/>
    </g>
  `),
  // Pastel gradients, thin coloured outlines (never black), blurred blobs as the wash, rosy cheek.
  storybook: svg(`
    <defs>
      <radialGradient id="body" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fdf6dc"/><stop offset="1" stop-color="#f7e3a1"/></radialGradient>
      <linearGradient id="wing" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6c9a8"/><stop offset="1" stop-color="#fbe6d6"/></linearGradient>
      <linearGradient id="tail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f7cfcf"/><stop offset="1" stop-color="#eea5a5"/></linearGradient>
      <filter id="wash"><feGaussianBlur stdDeviation="1.2"/></filter>
    </defs>
    <path d="M24 50q-1 5 0 9h4M35 50q1 5 0 9h4" fill="none" stroke="#7a5a48" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M13 28q-6-2-9-6q-1 9 3 15q4-1 6-4z" fill="url(#tail)" stroke="#c98686" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M30 10c12-1 21 9 20 21c0 12-9 21-21 20c-12 1-20-9-19-21c0-11 8-20 20-20z" fill="url(#body)" stroke="#cdb062" stroke-width="1.5"/>
    <g filter="url(#wash)" opacity="0.3">
      <ellipse cx="37" cy="42" rx="9" ry="5" fill="#dcbf5e"/>
      <ellipse cx="20" cy="38" rx="5" ry="6" fill="#dcbf5e"/>
      <ellipse cx="24" cy="19" rx="7" ry="4" fill="#ffffff"/>
    </g>
    <path d="M49 26q7 1 11 5q-5 4-11 5q2-5 0-10z" fill="#f6c9a8" stroke="#c9946f" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M17 33q8-9 17 0q-8 9-17 0z" fill="url(#wing)" stroke="#d3a07c" stroke-width="1.5" stroke-linejoin="round"/>
    <ellipse cx="43" cy="31" rx="3.5" ry="2.2" fill="#eea5a5" opacity="0.7"/>
    <circle cx="39" cy="24" r="1.8" fill="#7a5a48"/>
  `),
  // Marker fills that miss the lines, wobbly open outlines of one ink colour and width, and a turbulence wobble over it all.
  doodle: svg(`
    <defs><filter id="wobble" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="3" xChannelSelector="R" yChannelSelector="G"/></filter></defs>
    <g filter="url(#wobble)">
      <path d="M15 31c-2-10 8-18 17-17c11 0 17 9 16 19c0 10-9 17-19 16c-9 0-14-8-14-18z" fill="#f7d94c"/>
      <path d="M51 27l9 5-9 3z" fill="#f9a03f"/>
      <path d="M20 31l11-3-9 5 11-2-9 5 9-1" fill="none" stroke="#f9a03f" stroke-width="4" stroke-opacity="0.8" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M6 24l5 4-4 6z" fill="#e8505b"/>
      <g fill="none" stroke="#2a2a35" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M31 11c7-2 14 2 17 8c4 6 4 13 1 20c-3 7-10 12-18 13c-7 1-14-2-18-8c-4-6-5-13-2-20c3-7 10-12 18-13c2-1 4 0 5 1"/>
        <path d="M49 25c4 1 8 3 12 6c-4 3-8 5-12 6"/>
        <path d="M12 27c-3-1-6-3-8-6c0 5 0 10 2 15c2-1 4-2 5-4"/>
        <path d="M17 33c4-6 13-7 18 0c-5 7-13 7-17 1"/>
        <path d="M24 52c0 3-1 5-1 8l5 0M35 51c1 3 1 5 1 8l5 1"/>
      </g>
      <circle cx="39" cy="24" r="2.1" fill="#2a2a35"/>
    </g>
  `),
  // Lumps with an off-centre radial gradient each, no outlines, white highlights, blurred contact shadows.
  clay: svg(`
    <defs>
      <radialGradient id="yellow" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fdea96"/><stop offset="0.55" stop-color="#f7cf3d"/><stop offset="1" stop-color="#c2940f"/></radialGradient>
      <radialGradient id="orange" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fcc08a"/><stop offset="0.55" stop-color="#f5892e"/><stop offset="1" stop-color="#b5590e"/></radialGradient>
      <radialGradient id="white" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#f5f1e8"/><stop offset="1" stop-color="#bdb6a6"/></radialGradient>
      <filter id="soft"><feGaussianBlur stdDeviation="1.5"/></filter>
    </defs>
    <rect x="20" y="46" width="8" height="15" rx="4" fill="url(#orange)"/>
    <rect x="32" y="46" width="8" height="15" rx="4" fill="url(#orange)"/>
    <ellipse cx="9" cy="29" rx="8" ry="5.5" fill="url(#orange)" transform="rotate(25 9 29)"/>
    <ellipse cx="30" cy="31" rx="21" ry="20" fill="url(#yellow)"/>
    <ellipse cx="27" cy="38" rx="11" ry="6" fill="#7a5200" opacity="0.35" filter="url(#soft)"/>
    <ellipse cx="26" cy="35" rx="10" ry="6.5" fill="url(#orange)"/>
    <ellipse cx="50" cy="33" rx="6" ry="5" fill="#7a5200" opacity="0.35" filter="url(#soft)"/>
    <path d="M47 26q2-2 5-1l8 4q2 2 0 4l-8 4q-3 1-5-1q-3-5 0-10z" fill="url(#orange)"/>
    <circle cx="39" cy="23" r="5.5" fill="url(#white)"/>
    <circle cx="40.5" cy="23.5" r="2.6" fill="#2d2a32"/>
    <circle cx="39.6" cy="22.5" r="0.9" fill="#ffffff"/>
    <ellipse cx="19" cy="19" rx="4.5" ry="2.4" fill="#ffffff" opacity="0.7" transform="rotate(-35 19 19)"/>
    <ellipse cx="23" cy="32.5" rx="2.5" ry="1.3" fill="#ffffff" opacity="0.7" transform="rotate(-20 23 32.5)"/>
  `),
  // Seven whole shapes with gaps between them, three colours and a near-black dot.
  minimal: svg(`
    <polygon points="1,21 10,30 1,39" fill="#ffc145"/>
    <circle cx="30" cy="30" r="18" fill="#ff5a5f"/>
    <polygon points="51,24 63,30 51,36" fill="#ffc145"/>
    <circle cx="37" cy="24" r="2.6" fill="#22223b"/>
    <rect x="22" y="51" width="4" height="11" fill="#2e86ab"/>
    <rect x="34" y="51" width="4" height="11" fill="#2e86ab"/>
  `),
  // Typed "like a comic book": ink outlines of two weights, flat primaries, a halftone shadow.
  comic: svg(`
    <defs><pattern id="dots" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="#1b1b1f"/></pattern></defs>
    <g stroke="#1b1b1f" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
      <path d="M24 50v9h5M36 50v9h5" fill="none"/>
      <path d="M12 29L3 23l3 14z" fill="#e63946"/>
      <circle cx="30" cy="31" r="21" fill="#ffd60a"/>
      <path d="M49 25l12 6-12 6z" fill="#e63946"/>
    </g>
    <path d="M48.7 34.3A19 19 0 0 1 22 48.2A27 27 0 0 0 48.7 34.3z" fill="url(#dots)"/>
    <path d="M17 34q8-10 17 0q-9 9-17 0z" fill="#1d6fb8" stroke="#1b1b1f" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="39" cy="24" r="5.5" fill="#ffffff" stroke="#1b1b1f" stroke-width="2"/>
    <circle cx="41" cy="24" r="2.6" fill="#1b1b1f"/>
    <path d="M17 20q3-6 9-8" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
  `),
  // Typed "chalk on a blackboard": pale rough strokes, scribbled fill, a turbulence filter to roughen them.
  chalk: svg(`
    <defs><filter id="rough" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="2"/></filter></defs>
    <g filter="url(#rough)" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.9">
      <path d="M15 24l28-6M13 30l34-7M13 36l36-7M15 42l33-7M20 47l24-5" stroke="#f7e3a1" stroke-width="3" stroke-opacity="0.6"/>
      <circle cx="30" cy="31" r="20" stroke="#f5f5f0" stroke-width="3"/>
      <path d="M49 25l11 6-11 6M11 28l-7-5 2 14 5-4M24 51v8h5M36 51v8h5" stroke="#f5f5f0" stroke-width="3"/>
      <path d="M18 34q8-9 16 0q-8 8-16 0" stroke="#f6c9a8" stroke-width="3"/>
      <circle cx="39" cy="24" r="1.5" stroke="#f5f5f0" stroke-width="3"/>
    </g>
  `),
};
