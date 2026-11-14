/**
 * Art styles: a few presets for the style knob, and what each one means for the artist that draws
 * the game's pictures (as SVG). A project's style is the words of its `art style:` block on the
 * stage: a preset's `words`, or anything the author types ("pixel art", "like a comic book").
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
    art: 'Bold simple shapes, clean dark outlines (stroke 2-4 px, round joins), bright cheerful colors, a little shading with one or two darker or lighter shapes.',
  },
  {
    id: 'pixel',
    label: 'Pixel art',
    words: 'pixel art: chunky pixels and a small palette, like a 16-bit console game',
    art: 'Real pixel art: draw only with <rect> elements snapped to a grid of square pixels (each pixel 3 to 6 units wide), no curves, no strokes, no gradients; a palette of at most 12 colors with one dark outline color; set shape-rendering="crispEdges" on the root <svg>.',
  },
  {
    id: 'paper',
    label: 'Paper cutout',
    words: 'paper cutout collage: flat layered shapes with soft shadows',
    art: 'Looks cut from colored paper: flat shapes with slightly uneven edges, no outlines, layered with a darker offset copy under each piece as its shadow, muted craft-paper colors.',
  },
  {
    id: 'neon',
    label: 'Neon',
    words: 'neon glow on dark: bright glowing outlines, synthwave colors',
    art: 'Glowing line art for dark backgrounds: shapes drawn mostly as bright strokes (cyan, magenta, yellow, lime) with a wider, more transparent stroke of the same color underneath as the glow; fills are dark or see-through.',
  },
  {
    id: 'storybook',
    label: 'Storybook',
    words: 'soft storybook watercolor: pastel washes and gentle textures',
    art: 'Gentle picture-book look: soft pastel fills with gradients, thin colored outlines (never black), rounded friendly shapes, a few lighter blobs as watercolor texture.',
  },
  {
    id: 'doodle',
    label: 'Doodle',
    words: 'hand-drawn marker doodle, wobbly lines, like a notebook sketch',
    art: 'Drawn with a marker: wobbly, slightly open outlines of even width in one dark ink color, fills that do not quite reach the lines, simple faces, no gradients.',
  },
  {
    id: 'clay',
    label: 'Clay',
    words: 'claymation: chunky rounded shapes with soft shading and shiny highlights',
    art: 'Looks modelled from clay: fat rounded forms, radial gradients for volume, a soft darker rim instead of outlines, small white highlights, saturated colors.',
  },
  {
    id: 'minimal',
    label: 'Minimal',
    words: 'minimal flat shapes: circles, squares and triangles in three colors',
    art: 'Geometric and spare: built from a few circles, rectangles and triangles, no outlines, no gradients, three or four colors in all, lots of empty space.',
  },
];

/** The preset whose words these are (as the knob wrote them), if any. */
export function presetOf(words: string): StylePreset | null {
  const w = words.trim().toLowerCase();
  if (!w) return null;
  return STYLE_PRESETS.find((p) => p.words.toLowerCase() === w || p.label.toLowerCase() === w || p.id === w) ?? null;
}
