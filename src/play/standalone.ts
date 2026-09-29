/**
 * "Share as a web page": one self-contained HTML file that plays the game with no editor and no network.
 * It holds the bootstrap (allowed by its hash), the runtime (Phaser + Amble) and the game as JSON blocks
 * (a JSON string cannot end its <script> element early, so no escaping tricks inside JavaScript), the
 * drawings as data URLs with their rigs, and its own CSP of `default-src 'none'` plus the hash and blob:.
 * A ▶ Play card starts the game inside the click, so sound works at once.
 */
import { PLAYER_CSS, STANDALONE_BOOT, scriptHash } from './bootstrap';
import {
  STANDALONE_DATA_ID,
  STANDALONE_RUNTIME_ID,
  type FontAsset,
  type GameFile,
  type ImageSource,
  type SoundAsset,
  type StandaloneGame,
} from './protocol';

export interface StandaloneInput {
  title: string;
  /** The runtime file as text (`loadRuntimeText(runtimeUrl)`). */
  runtime: string;
  files: GameFile[];
  /** The student's drawings (PNG Blobs, ImageBitmaps or data URLs) with their rigs. */
  images?: Array<{ key: string; image: ImageSource; rig?: unknown; layers?: Record<string, ImageSource> }>;
  sounds?: SoundAsset[];
  fonts?: FontAsset[];
  dials?: Record<string, number>;
  twists?: string[];
}

function base64(bytes: ArrayBuffer | ArrayBufferView): string {
  const u8 = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function dataUrl(src: ImageSource): Promise<string> {
  if (typeof src === 'string') return src;
  if (src instanceof Blob) return `data:${src.type || 'image/png'};base64,${base64(await src.arrayBuffer())}`;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')?.drawImage(src, 0, 0);
  return c.toDataURL('image/png');
}

/** JSON for inside a <script> element: `<` escaped, so nothing in it can close the element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

export async function standaloneCsp(): Promise<string> {
  const hash = await scriptHash(STANDALONE_BOOT);
  return [
    "default-src 'none'",
    `script-src ${hash} blob:`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data: blob:',
    "media-src 'none'",
    "connect-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** Builds the page. The result is plain text: save it as `<name>.html`. */
export async function buildStandaloneHtml(input: StandaloneInput): Promise<string> {
  const art: StandaloneGame['art'] = [];
  for (const a of input.images ?? []) {
    const entry: StandaloneGame['art'][number] = { key: a.key, image: await dataUrl(a.image) };
    if (a.rig !== undefined && a.rig !== null) entry.rig = a.rig;
    if (a.layers) {
      const layers: Record<string, string> = {};
      for (const [name, img] of Object.entries(a.layers)) layers[name] = await dataUrl(img);
      entry.layers = layers;
    }
    art.push(entry);
  }
  const sounds: StandaloneGame['sounds'] = (input.sounds ?? []).map((s) =>
    'pcm' in s ? { key: s.key, caption: s.caption, sampleRate: s.sampleRate, pcm: s.pcm.map((c) => base64(c)) } : { key: s.key, caption: s.caption, bytes: base64(s.bytes) },
  );
  const game: StandaloneGame = {
    title: input.title,
    files: input.files.map((f) => ({ name: f.name, source: f.source })),
    art,
    sounds,
    fonts: (input.fonts ?? []).map((f) => ({ family: f.family, weight: f.weight, bytes: base64(f.bytes) })),
    dials: { ...input.dials },
    twists: [...(input.twists ?? [])],
  };
  const csp = await standaloneCsp();
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">' +
    `<title>${escapeHtml(input.title)}</title><style>${PLAYER_CSS}</style></head><body><div id="amble-game"></div>` +
    `<script type="application/json" id="${STANDALONE_RUNTIME_ID}">${scriptJson(input.runtime)}</script>` +
    `<script type="application/json" id="${STANDALONE_DATA_ID}">${scriptJson(game)}</script>` +
    `<script>${STANDALONE_BOOT}</script></body></html>`
  );
}
