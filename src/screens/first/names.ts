/**
 * 200 friendly names for a first creature (§2.3): short, fun to say, not real people's names and not
 * the starter worlds' characters. The student can rename it at once with the Name chip.
 */
export const FRIENDLY_NAMES: readonly string[] = [
  'Blorp', 'Mochi', 'Zib', 'Nubbin', 'Wump', 'Fizz', 'Bobo', 'Gloop', 'Tuft', 'Puddle',
  'Bean', 'Noodle', 'Wiggles', 'Dot', 'Pickle', 'Muffin', 'Zuzu', 'Boop', 'Sprocket', 'Blip',
  'Tater', 'Kip', 'Moss', 'Pebble', 'Nib', 'Squish', 'Plum', 'Mango', 'Waffle', 'Pretzel',
  'Nugget', 'Sprout', 'Twig', 'Acorn', 'Button', 'Bramble', 'Clover', 'Doodle', 'Fennel', 'Gizmo',
  'Hopper', 'Jellybean', 'Kazoo', 'Marble', 'Nimbus', 'Oodle', 'Peanut', 'Quill', 'Rumble', 'Scooter',
  'Tofu', 'Velvet', 'Whisk', 'Yoyo', 'Zigzag', 'Bumble', 'Crumpet', 'Dumpling', 'Figgy', 'Gumdrop',
  'Hiccup', 'Inky', 'Jiggles', 'Kiwi', 'Lolly', 'Meep', 'Nacho', 'Olive', 'Pudding', 'Quibble',
  'Scrunch', 'Tumble', 'Vroom', 'Yam', 'Zoop', 'Bonk', 'Cheddar', 'Dizzy', 'Echo', 'Flop',
  'Shimmer', 'Hush', 'Itty', 'Jinx', 'Lint', 'Mumble', 'Nook', 'Pom', 'Quark', 'Rascal',
  'Tiddly', 'Umpa', 'Vex', 'Yip', 'Zork', 'Chomp', 'Dribble', 'Eggy', 'Fudge', 'Grizzle',
  'Honk', 'Jumbo', 'Kettle', 'Lopsy', 'Munch', 'Nuzzle', 'Oopsie', 'Pogo', 'Quokka', 'Ruffles',
  'Sniffles', 'Tickle', 'Wisp', 'Yeti', 'Zest', 'Bingo', 'Cosmo', 'Dabble', 'Ember', 'Fuzz',
  'Hubble', 'Icicle', 'Jolly', 'Kernel', 'Mittens', 'Nutmeg', 'Orbit', 'Paddle', 'Quiver', 'Toast',
  'Upsy', 'Vesper', 'Wizzle', 'Yodel', 'Zappy', 'Blobby', 'Chirp', 'Dewdrop', 'Flapjack', 'Gobble',
  'Huckle', 'Igloo', 'Jam', 'Kooky', 'Lark', 'Maple', 'Nimble', 'Oatmeal', 'Pinecone', 'Quackers',
  'Riddle', 'Salsa', 'Tadpole', 'Vanilla', 'Wonky', 'Yonder', 'Zinger', 'Cobble', 'Flurry', 'Gumbo',
  'Hoot', 'Inchy', 'Jingle', 'Kibble', 'Lemon', 'Mookie', 'Nibbles', 'Pesto', 'Rubble', 'Soot',
  'Truffle', 'Vole', 'Wafer', 'Zuzubee', 'Bopsy', 'Crinkle', 'Dumble', 'Fidget', 'Gloopsy', 'Humbug',
  'Jitter', 'Kerplunk', 'Lollop', 'Mudpie', 'Noggin', 'Ooze', 'Popcorn', 'Razzle', 'Snooze', 'Tinsel',
  'Wibble', 'Yawn', 'Zonk', 'Burble', 'Custard', 'Doozy', 'Fluff', 'Gubbins', 'Hobnob', 'Squeak',
];

/**
 * A name for a new creature, avoiding the student's other characters' names. `rand` is `Math.random`
 * outside tests. When every name is taken, it counts up ("Blorp 2").
 */
export function pickName(taken: Iterable<string>, rand: () => number = Math.random): string {
  const used = new Set([...taken].map((n) => n.trim().toLowerCase()));
  const free = FRIENDLY_NAMES.filter((n) => !used.has(n.toLowerCase()));
  if (free.length) return free[Math.min(free.length - 1, Math.floor(rand() * free.length))];
  const base = FRIENDLY_NAMES[Math.min(FRIENDLY_NAMES.length - 1, Math.floor(rand() * FRIENDLY_NAMES.length))];
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/** The name a student typed, tidied: trimmed, single spaces, at most 24 characters. */
export function cleanName(typed: string, fallback: string): string {
  const name = typed.replace(/\s+/g, ' ').trim().slice(0, 24).trim();
  return name || fallback;
}
