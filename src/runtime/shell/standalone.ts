/**
 * An exported game page ("Share as a web page"): the runtime and the game travel inside the page. The page
 * holds a JSON block (`#amble-standalone`) with the game; a ▶ Play card starts it inside the click, so
 * sound is allowed from the first frame. When whoever shared it had Captions on, the page shows the words
 * for game sounds in a strip at the bottom, as the editor does.
 */
import { CaptionQueue } from '../../play/captions';
import { DEFAULT_PREFS, STANDALONE_DATA_ID, parsePrefs, type DrawnArt, type GameEvent, type InitMessage, type SoundAsset, type StandaloneGame } from '../../play/protocol';

function bytesOf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Reads the embedded game, or null when this is not an exported page. */
export function readStandalone(): { title: string; init: InitMessage; captions: boolean } | null {
  const el = document.getElementById(STANDALONE_DATA_ID);
  if (!el?.textContent) return null;
  let data: unknown;
  try {
    data = JSON.parse(el.textContent);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const d = data as unknown as StandaloneGame;
  const art: DrawnArt[] = (Array.isArray(d.art) ? d.art : []).map((a) => ({ key: a.key, image: a.image, rig: a.rig, layers: a.layers }));
  const sounds: SoundAsset[] = [];
  for (const s of Array.isArray(d.sounds) ? d.sounds : []) {
    if (s.pcm && s.sampleRate) sounds.push({ key: s.key, caption: s.caption, sampleRate: s.sampleRate, pcm: s.pcm.map((c) => new Float32Array(bytesOf(c))) });
    else if (s.bytes) sounds.push({ key: s.key, caption: s.caption, bytes: bytesOf(s.bytes) });
  }
  const init: InitMessage = {
    type: 'init',
    mode: 'play',
    files: Array.isArray(d.files) ? d.files : [],
    art,
    sounds,
    fonts: (Array.isArray(d.fonts) ? d.fonts : []).map((f) => ({ family: f.family, weight: f.weight, bytes: bytesOf(f.bytes) })),
    dials: isRecord(d.dials) ? (d.dials as Record<string, number>) : {},
    twists: Array.isArray(d.twists) ? d.twists : [],
    storage: {},
    prefs: parsePrefs({ captions: d.captions === true }, { ...DEFAULT_PREFS, ghostTaps: false }),
    autostart: false,
  };
  return { title: typeof d.title === 'string' ? d.title : 'Amble game', init, captions: d.captions === true };
}

const CSS = `
.amble-play{position:absolute;inset:0;z-index:40;display:grid;place-items:center;background:rgba(11,12,36,.72)}
.amble-play button{display:flex;flex-direction:column;align-items:center;gap:10px;padding:26px 44px;border-radius:22px;border:0;
  background:#fdf8ec;color:#221b2e;font:700 30px/1.1 system-ui,sans-serif;cursor:pointer;box-shadow:0 14px 40px rgba(0,0,0,.45);
  transform:rotate(-1.5deg)}
.amble-play button span{font:600 16px/1.2 system-ui,sans-serif;color:#4a4058;max-width:26ch;text-align:center}
.amble-play button:focus-visible{outline:4px solid #ffc15e;outline-offset:4px}
`;

/** The ▶ Play card of an exported page; `onPlay` runs inside the click. */
export function showPlayCard(title: string, onPlay: () => void): void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const wrap = document.createElement('div');
  wrap.className = 'amble-play';
  const button = document.createElement('button');
  button.type = 'button';
  const label = document.createElement('span');
  label.textContent = title;
  button.append('▶ Play', label);
  button.addEventListener('click', () => {
    wrap.remove();
    onPlay();
  });
  wrap.append(button);
  document.body.append(wrap);
  button.focus();
}

const CAPTION_CSS = `
.amble-captions{position:absolute;left:50%;bottom:12px;z-index:30;max-width:calc(100% - 32px);padding:4px 12px;border-radius:12px;
  background:rgba(0,0,0,.82);color:#fff;font:600 16px/1.35 system-ui,sans-serif;text-align:center;transform:translateX(-50%);pointer-events:none}
.amble-captions[hidden]{display:none}
.amble-captions p{margin:0;overflow-wrap:anywhere}
`;

/**
 * The page's caption strip (the editor's, without its themes): each caption shows for about 2.5 s, two at
 * most. Returns what to hand the runtime for the game's events.
 */
export function showCaptions(): (event: GameEvent) => void {
  const style = document.createElement('style');
  style.textContent = CAPTION_CSS;
  document.head.append(style);
  const strip = document.createElement('div');
  strip.className = 'amble-captions';
  strip.hidden = true;
  document.body.append(strip);
  const queue = new CaptionQueue();
  let timer = 0;
  const render = () => {
    window.clearTimeout(timer);
    const now = performance.now();
    const lines = queue.lines(now);
    strip.replaceChildren(
      ...lines.map((l) => {
        const p = document.createElement('p');
        p.textContent = l.text;
        return p;
      }),
    );
    strip.hidden = lines.length === 0;
    const next = queue.nextChange();
    if (next !== null) timer = window.setTimeout(render, Math.max(16, next - now));
  };
  return (event) => {
    if (event.kind !== 'caption') return;
    queue.push(event.text, performance.now());
    render();
  };
}
