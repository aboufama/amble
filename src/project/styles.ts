/**
 * Art styles: a few presets for the style knob, and what each one means for the artist that draws
 * the game's pictures (as SVG). A project's style is the words of its `art style:` block on the
 * stage: a preset's `words`, or anything the author types ("pixel art", "like a comic book").
 *
 * `artBrief` turns those words into the artist's brief: one text, the same for every picture of a
 * game, so that pictures drawn in separate requests share a look (palette, outline weight, shading).
 */
export interface StylePreset {
  id: string;
  /** Shown on the knob. */
  label: string;
  /** What goes in the `art style:` block (and so to the compiler). */
  words: string;
  /** How to draw it: instructions for the SVG artist. */
  art: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'cartoon',
    label: 'Cartoon',
    words: 'bright cartoon with thick dark outlines',
    art: 'A Saturday-morning cartoon. Bold simple shapes with thick outlines: every shape is stroked in #2b2540 (never pure black), 4 px wide (3 px on pictures under 48 px across), with round joins and caps. Bright saturated fills, the same hexes for the same hues in every picture: red #e8434f, orange #f58a2e, yellow #ffd23f, green #49b85c, teal #1fb5a8, blue #3a86e0, purple #8a5cd6, pink #f47fb0, brown #9b6a45, cream #fff1d6, white #ffffff. Shading is one darker shape of the same hue on the lower right of each form and one small white highlight on its upper left, neither of them outlined. Faces are big: round white eyes with a dark pupil and a white dot. Backdrops use the same colours a little paler, in big flat shapes with 2 px outlines, so the sprites stand out.',
  },
  {
    id: 'pixel',
    label: 'Pixel art',
    words: 'pixel art: chunky pixels and a small palette, like a 16-bit console game',
    art: 'Real pixel art on a grid of square pixels, as on a 16-bit console. Draw with <rect> elements only, each with x, y, width and height that are whole multiples of the pixel size (4 units for sprites, 2 for sprites under 32 px across, 8 for sprites over 128 px and for backdrops; the exact pixel grid is given with each picture). A run of same-coloured pixels is one wider rect. Curves and diagonals are stair-stepped by hand: no <path>, <circle>, <ellipse> or <polygon>, no strokes, gradients, opacity, transforms or filters, and nothing between grid lines. Put shape-rendering="crispEdges" on the root <svg> so the edges stay crisp. A small palette, at most 12 colours in a picture, taken from these 16: #1a1c2c #5d275d #b13e53 #ef7d57 #ffcd75 #a7f070 #38b764 #257179 #29366f #3b5dc9 #41a6f6 #73eff7 #f4f4f4 #94b0c2 #566c86 #333c57. Every sprite has a 1-pixel outline in #1a1c2c around its silhouette, a lighter colour along its upper left and a darker one along its lower right; no anti-aliasing and no soft edges. Backdrops are big flat bands with a few stepped shapes (hills, clouds, bricks) in the paler and darker palette colours.',
  },
  {
    id: 'paper',
    label: 'Paper cutout',
    words: 'paper cutout collage: flat layered shapes with soft shadows',
    art: 'Cut from coloured paper and glued in layers. Every part is one flat colour with no outline at all (no strokes): simple shapes with slightly uneven, hand-cut edges (polygons and paths with a few soft corners, not perfect circles). Parts overlap, back layer first, and each layer casts a soft shadow on the one below. Define the shadow once, <filter id="paper" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="1" dy="1.5" stdDeviation="1" flood-color="#2b1d12" flood-opacity="0.4"/></filter>, and put filter="url(#paper)" on the <g> of each layer. Muted craft-paper colours, the same hexes in every picture: kraft #c9a27a, cream #f4ead5, brick #c8553d, mustard #e3a72f, sage #8aa77b, teal #3f7d83, navy #2f4a6b, plum #7a4a6a, charcoal #3b3a3a. Eyes and details are small paper dots and snips, never drawn lines. No gradients. Backdrops are wide strips of paper with wavy cut edges, layered from far (pale) to near (dark), each with the same shadow.',
  },
  {
    id: 'neon',
    label: 'Neon',
    words: 'neon glow on dark: bright glowing outlines, synthwave colors',
    art: 'Glowing neon tubes in the dark. Shapes are bright outlines: strokes 3 px wide with round caps and joins, and fill="none" or a dark see-through fill (#0b0b1e at 0.55 opacity) so a sprite reads on any dark backdrop. Colours, the same hexes in every picture: cyan #22e6ff, magenta #ff3df0, yellow #fff04a, lime #7dff5a, violet #9b6bff, orange #ff8a3d; two or three of them per picture, and white only for tiny sparks and hot spots. The glow is a filter, defined once, <filter id="glow" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="2.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>, with filter="url(#glow)" on one <g> around the whole drawing; leave 6 px of margin so the glow is not cut off. Backdrops are dark, a gradient from #0b0b1e down to #1d0b33, with a dim grid, a horizon and far shapes in the same colours at low opacity, so the sprites are the brightest things on screen.',
  },
  {
    id: 'storybook',
    label: 'Storybook',
    words: 'soft storybook watercolor: pastel washes and gentle textures',
    art: 'A gentle picture-book watercolour. Rounded, friendly, slightly lopsided shapes. Soft pastel washes, the same hexes in every picture: peach #f6c9a8, rose #eea5a5, butter #f7e3a1, sage #b7d3a8, sky #a9d0e6, lilac #c9b6e0, sand #e8d9c0. Each form is filled with a gradient (linearGradient or radialGradient) from its colour to a paler tint of it, so the wash looks uneven. Outlines are thin and soft: 1.5 px, round, in a darker shade of the shape\'s own colour or warm brown #7a5a48, never black. For the watercolour texture add two or three blobs of a darker or lighter tint at 0.3 opacity inside each large area, softened with <filter id="wash"><feGaussianBlur stdDeviation="1.2"/></filter>. Faces are small: dot eyes, a tiny smile, rosy cheeks. Backdrops are big pale washes that fade towards the top, with a few soft hills or clouds and no hard edges.',
  },
  {
    id: 'doodle',
    label: 'Doodle',
    words: 'hand-drawn marker doodle, wobbly lines, like a notebook sketch',
    art: 'Drawn by hand with a marker in a school notebook. The lines are wobbly <path> strokes: curves that waver, corners that overshoot, ends that do not quite meet. They are all one ink colour, #2a2a35, and one width, 2.5 px, with round caps and joins and fill="none". The colour is a separate layer under the lines: flat marker fills that stop short of the lines in places and spill past them in others, or a few back-and-forth scribble strokes (5 px wide, 0.8 opacity) in place of a fill. Marker colours, the same hexes in every picture: red #e8505b, orange #f9a03f, yellow #f7d94c, green #5bb974, blue #4a90d9, purple #9b6fc3. Faces are simple: dot eyes and one curved line for a mouth. No gradients, no shadows, no perfect circles or ruler-straight lines. Then make the whole drawing waver like a hand: define once <filter id="wobble" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="3" xChannelSelector="R" yChannelSelector="G"/></filter> and put filter="url(#wobble)" on one <g> around everything. Backdrops are notebook paper, #fbf8ee with pale blue ruled lines (#b9d3ee) and a red margin line, with a few doodles of the scene.',
  },
  {
    id: 'clay',
    label: 'Clay',
    words: 'claymation: chunky rounded shapes with soft shading and shiny highlights',
    art: 'Modelled from clay, like a stop-motion puppet. Fat rounded lumps (ellipses, circles, thick rounded paths) pressed together and overlapping; no outlines. Every lump has volume: fill it with a radialGradient centred up and to the left (cx="35%" cy="30%" r="75%") that goes from a lighter tint at 0% through the clay colour at 55% to a darker shade at 100%. Add a small white highlight (opacity 0.7) on the upper left of each big lump, and a soft dark contact shadow where one lump sits on another: a darker shape at 0.35 opacity, softened with <filter id="soft"><feGaussianBlur stdDeviation="1.5"/></filter>. Plasticine colours, the same hexes in every picture: red #e5484d, orange #f5892e, yellow #f7cf3d, green #46b450, blue #3b82d6, purple #8e5bd0, pink #f28cb1, white #f5f1e8, black #2d2a32. Eyes are white balls with black bead pupils and a highlight of their own. Backdrops are a smooth gradient sky with clay lumps for hills, clouds and ground.',
  },
  {
    id: 'minimal',
    label: 'Minimal',
    words: 'minimal flat shapes: circles, squares and triangles in three colors',
    art: 'Geometric and spare. Each picture is a few whole shapes, at most about ten: circles, rectangles (square, or with fully rounded ends) and triangles, aligned and centred, with clear gaps between them. No outlines, no strokes, no gradients, no shadows, no small details; an eye is one dot. Three colours for the whole game, plus an off-white and a near-black: coral #ff5a5f, amber #ffc145, blue #2e86ab, off-white #f7f4ea, near-black #22223b. A picture uses two or three of them, and a colour the description names becomes the nearest of these. Backdrops are one flat colour (the off-white or the near-black) with two or three large shapes and a lot of empty space.',
  },
];

/** The preset whose words these are (as the knob wrote them), if any. */
export function presetOf(words: string): StylePreset | null {
  const w = words.trim().toLowerCase();
  if (!w) return null;
  return STYLE_PRESETS.find((p) => p.words.toLowerCase() === w || p.label.toLowerCase() === w || p.id === w) ?? null;
}

/** The look when no style is asked for: Amble's own (as before, with the outline and the colours spelled out so pictures match). */
export const DEFAULT_ART =
  'The friendly flat style of Scratch costumes: bold simple shapes, clean dark outlines, bright cheerful colors, a little shading with one or two darker or lighter shapes. The outlines are one colour everywhere, #2d2a3e, with round joins, and one weight: 3 px (2 px on pictures under 40 px across, 4 px on pictures over 160 px). Use the same hexes for the same hues in every picture: red #e8434f, orange #f58a2e, yellow #ffd23f, green #49b85c, teal #1fb5a8, blue #3a86e0, purple #8a5cd6, pink #f47fb0, brown #9b6a45, cream #fff1d6, white #ffffff (lighter or darker where the description needs it).';

const art = (id: string) => STYLE_PRESETS.find((p) => p.id === id)!.art;

/**
 * Styles an author may name in their own words, and how each is drawn in SVG: the first one that
 * matches is the technique (typing "8-bit" gets the pixel preset's recipe), most particular first.
 */
const RECIPES: Array<{ match: RegExp; art: string; pixel?: boolean; extra?: boolean }> = [
  { match: /pixel|\b(8|16|32)[- ]?bit|retro game|arcade|game ?boy|\bnes\b|console game|minecraft|voxel|blocky/, art: art('pixel'), pixel: true },
  { match: /neon|synthwave|vaporwave|cyberpunk|\btron\b/, art: art('neon') },
  { match: /\bpaper|cut[- ]?out|collage|\bfelt\b|\bcraft/, art: art('paper') },
  {
    match: /comic|manga|pop[- ]?art|superhero|graphic novel/,
    art: 'A comic book: black ink outlines of varying weight (4 px around the silhouette, 2 px inside), flat primary colours (red #e63946, yellow #ffd60a, blue #1d6fb8) with skin and white, shadows as solid black shapes or halftone dots (define a <pattern id="dots" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="#1b1b1f"/></pattern> and fill the shadow shapes with url(#dots)), white highlights, and speed or impact lines where there is action.',
  },
  {
    match: /low[- ]?poly|polygon|origami|facet/,
    art: 'Low-poly: every form is built from flat triangles and quads (<polygon>), no curves and no outlines; neighbouring facets of one form differ a little in lightness, as if lit from the upper left; give each facet a 0.5 px stroke of its own fill colour to hide the seams.',
  },
  {
    match: /silhouette|shadow puppet|limbo/,
    art: 'Silhouettes: each sprite is one solid dark shape (#14141c) with no inside detail except cut-out eyes or one small accent colour; backdrops are flat layers of hills and trees in lighter and lighter tints of one hue, fading with distance.',
  },
  {
    match: /stained glass|mosaic/,
    art: 'Stained glass: flat pieces of jewel colours (ruby #c1272d, amber #f2a900, emerald #1f8a4c, sapphire #1f5fbf, violet #6a3fa0) separated by thick dark lead lines (stroke #1b1b1f, 3 px), each piece with a radialGradient that is lighter at its centre.',
  },
  {
    match: /chalk|blackboard|crayon|pencil|charcoal/,
    art: 'Chalk, crayon or pencil: rough strokes, not clean fills. Outlines are 3 px strokes with round caps at 0.9 opacity; areas are filled with rows of back-and-forth strokes in the colour, with gaps showing through. Roughen everything with <filter id="rough" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="2"/></filter> on one <g> around the drawing. Chalk is pale (#f5f5f0 and pastels) and its backdrops are a dark board (#2f4a3c); crayon and pencil are on off-white paper.',
  },
  { match: /clay|plasticine|play[- ]?doh|stop[- ]?motion/, art: art('clay') },
  {
    match: /\b3[- ]?d\b|realistic|render|plastic toy/,
    art: 'As three-dimensional as SVG gets: no outlines; every form has volume from a gradient (lighter on the upper left, darker on the lower right), a small highlight, and a soft blurred shadow where forms meet (a darker shape at 0.35 opacity under <filter id="soft"><feGaussianBlur stdDeviation="1.5"/></filter>).',
  },
  { match: /water[- ]?colou?r|storybook|picture[- ]?book|gouache/, art: art('storybook') },
  { match: /doodle|hand[- ]?drawn|marker|notebook|scribbl|wobbly|sketch/, art: art('doodle') },
  { match: /minimal|flat shapes|bauhaus|geometric/, art: art('minimal') },
  { match: /cartoon|scratch|thick (dark )?outline/, art: art('cartoon') },
  // These two say who is drawn or in which colours, and go with any technique above.
  {
    match: /kawaii|chibi|anime/,
    extra: true,
    art: 'Kawaii: a big head (half the height) on a tiny body, large eyes set wide apart and low on the face with two white highlights each, a tiny mouth, pink cheek ovals, and soft pastel colours.',
  },
  {
    match: /black and white|black & white|monochrome|noir|gr[ae]yscale/,
    extra: true,
    art: 'Black and white: only #111111, #ffffff and at most two greys (#555555, #aaaaaa); form comes from solid black shadow shapes and line weight, not colour.',
  },
];

/**
 * The artist's brief for one game: the same text goes with every picture, so that pictures drawn
 * in separate requests share a look.
 */
export interface ArtBrief {
  /** The style in the author's words ("" when none is asked for). */
  words: string;
  /** The preset, when the words are one's. */
  preset: StylePreset | null;
  /** What the style is called. */
  name: string;
  /** How to draw it, for the SVG artist. */
  svg: string;
  /** How to ask an image model for it ("" for Amble's own look). */
  image: string;
  /** Pixel art: pictures are built on a pixel grid (see `pixelGrid`), with crisp edges. */
  pixel: boolean;
}

const quote = (words: string) => words.replace(/["“”]/g, "'");

/** The brief for a style: a preset's drawing guidance, one made from the author's own words, or Amble's own look. */
export function artBrief(words: string): ArtBrief {
  const w = words.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!w) return { words: '', preset: null, name: 'bright flat cartoon', svg: DEFAULT_ART, image: '', pixel: false };
  const preset = presetOf(w);
  if (preset) return { words: w, preset, name: preset.label, svg: preset.art, image: preset.words, pixel: preset.id === 'pixel' };
  const lower = w.toLowerCase();
  const technique = RECIPES.find((r) => !r.extra && r.match.test(lower));
  const recipes = [...(technique ? [technique] : []), ...RECIPES.filter((r) => r.extra && r.match.test(lower))];
  const svg = [
    `The author asked for this style, in their own words: "${quote(w)}".`,
    'Honour it for real. A named style is a set of drawing rules, so work out what it means for each of these, and draw every picture that way: what a picture is built from (pixels, cut shapes, brush strokes, lines), its edges (outlined or not, and the line colour and weight), its palette (which colours, how many, how bright), its shading (flat, hard shadows, gradients, glow) and its texture. Use the SVG features that make the style, instead of a flat cartoon in other colours: pixel art means <rect>s on a pixel grid with crisp edges (shape-rendering="crispEdges"), not smooth curves; watercolour means gradients and soft see-through washes, not hard flat fills; neon means bright strokes with a blurred glow, on dark; a comic means inked outlines and halftone dots; paper means flat layers with drop shadows.',
    ...(recipes.length ? [`For this style in particular (where the author's words say otherwise, their words win):\n${recipes.map((r) => `- ${r.art}`).join('\n')}`] : []),
    'If the words give a mood or a theme more than a technique (spooky, candy, underwater), keep to bold simple shapes with clean 3 px outlines and a little shading, and let the mood choose the palette and the shapes.',
    "Take the plainest, most typical version of the style, so that pictures drawn separately come out alike: settle the palette (six to ten hexes), the outline colour and weight and the shading from the style's own words, and never vary them from picture to picture.",
  ].join('\n');
  return { words: w, preset: null, name: w.length > 60 ? `${w.slice(0, 57)}...` : w, svg, image: w, pixel: technique?.pixel === true };
}

/**
 * The words of a game's `art style:` blocks, from the brief lines the compiler keeps
 * ("art style: [pixel art]" becomes "pixel art"; several blocks are joined).
 */
export function styleWords(lines: string): string {
  const words = lines
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^art style:\s*/i, '')
        .replace(/^\[([\s\S]*)\]$/, '$1')
        .trim(),
    )
    .filter((w) => w && w !== '…');
  return [...new Set(words)].join('; ').slice(0, 300);
}

/**
 * The pixel grid of a pixel-art picture: every game uses the same pixel size, so its sprites look
 * like they belong on one screen (smaller pixels only where a picture would be too coarse to read,
 * bigger ones where it would be too many to draw).
 */
export function pixelGrid(width: number, height: number, backdrop = false): { size: number; columns: number; rows: number } {
  const size = backdrop || Math.max(width, height) > 128 ? 8 : Math.min(width, height) < 32 ? 2 : 4;
  return { size, columns: Math.floor(width / size), rows: Math.floor(height / size) };
}
