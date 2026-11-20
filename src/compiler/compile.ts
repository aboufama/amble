import { AiError, CHATGPT_MODEL_NAME, chatJson, effectiveSettings, resolveTransport, type AiSettings, type Transport } from './openai';
import { fetchCodexStatus } from './chatgpt';
import { classNameFor, classNames, EDITS_GUIDE, freedomSize, piecesSystemPrompt, piecesUserPrompt, type PieceTask } from './prompt';
import { planTarget, type PieceRequest, type TargetPlan } from './codegen';
import { checkPiece } from './pieces';
import { serializeBlocks } from './serialize';
import { EDITS_SCHEMA, PIECES_SCHEMA, type AssetRequest, type CodeEdit, type PiecesReply } from './schema';
import { instrumentTargetCode } from './transform';
import { costumeSets, generateAsset, isPlaceholder, makeSvgSheet, placeholderAsset, referenceOf, type AssetContext, type AssetJob, type Sketch } from './assets';
import { harness } from './harness';
import { lintGame } from './lint';
import { streamedTitle, watchArray, watchReply } from './stream';
import { trialRun } from './trial';
import { writeGameSplit } from './split';
import { writeGameFanout } from './fanout';
import { ASKING_GUIDE } from './ask';
import { CAST_SCHEMA, CAST_WRITER_GUIDE, CAST_WRITER_GUIDE_SLIM, castWriterPart, fromLean, headerAssets, LEAN_GUIDE, LEAN_GUIDE_SPRITES_FIRST, leanSchema, watchLean, type LeanHeader, type LeanReply } from './lean';
import { artBrief, styleWords } from '../project/styles';
import { hashString, uid } from '../project/ids';
import type { CompiledAsset, CompiledCode, CompiledGame, CompiledPiece, CompiledQuestion, CompiledSprite, Project } from '../project/types';

export type CompileStage = 'preparing' | 'thinking' | 'writing' | 'checking' | 'repairing' | 'assets' | 'done';

export interface CompileProgress {
  stage: CompileStage;
  message: string;
  chars?: number;
  assetsDone?: number;
  assetsTotal?: number;
  /** A new game as it is made: its name and how to play once written, and its drawings as they are drawn. */
  preview?: BuildPreview;
}

export interface BuildPreview {
  title?: string;
  howToPlay?: string;
  /** In the order they started; each the latest version of that drawing. */
  drawings: Sketch[];
}

export interface CompileOptions {
  settings: AiSettings;
  signal?: AbortSignal;
  onProgress?(p: CompileProgress): void;
  /** A new game's title and how to play, as soon as the model has written them (while the rest is made). */
  onOutline?(o: { title?: string; howToPlay?: string }): void;
  /** Drawings as they are drawn (compileProject passes them on in its progress, as `preview`). */
  onSketch?(sketch: Sketch): void;
  /** "Fix": problems from the last run. The pieces of the sprites they mention are written again. */
  fixProblems?: string[];
  /** Start over: write every piece again, and remake compiled characters and art. */
  fresh?: boolean;
  /**
   * Compile without a compile request: exact blocks as usual, and words that aren't compiled
   * yet do nothing for now (with a warning). For playing when there's no account.
   */
  offline?: boolean;
  /**
   * The player's picks for a new game's look (src/asking.ts), in words: the art waits for them, and
   * the code leaves the look to them.
   */
  picks?: Promise<string>;
}

/**
 * Progress with a preview of the game being made: every report carries the title, how to play and
 * the drawings so far, and a new drawing (or a new version of one) reports again, a few times a second.
 */
function withPreview(options: CompileOptions): CompileOptions {
  const report = options.onProgress;
  if (!report) return options;
  const preview: BuildPreview = { drawings: [] };
  let last: CompileProgress = { stage: 'preparing', message: '' };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const send = (p: CompileProgress) => {
    last = p;
    report({ ...p, preview: { ...preview, drawings: [...preview.drawings] } });
  };
  const soon = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (last.stage !== 'done') send(last);
    }, 120);
  };
  return {
    ...options,
    onProgress: send,
    onOutline: (o) => {
      if (o.title) preview.title = o.title;
      if (o.howToPlay) preview.howToPlay = o.howToPlay;
      options.onOutline?.(o);
      soon();
    },
    onSketch: (sketch) => {
      const i = preview.drawings.findIndex((d) => d.target === sketch.target && d.name === sketch.name);
      if (i >= 0 && preview.drawings[i].done && !sketch.done) return;
      if (i >= 0) preview.drawings[i] = sketch;
      else preview.drawings.push(sketch);
      options.onSketch?.(sketch);
      soon();
    },
  };
}

/** Thrown when words need compiling and there's no ChatGPT sign-in or API key. */
export const NO_ACCOUNT = 'no_account';

/**
 * The harness's `fullSize`: low reasoning writes terse code, and less of the game the dial asks for
 * than high reasoning did (9-10k characters of code where it wrote 15-16k), and that is what the
 * judge marked down (scope and polish). This spells the rest out.
 */
const FULL_SIZE = ' Write all of it out, not a sketch of it: power-ups with personality, juice on every event (particles, a little shake, text that pops up and fades), the HUD on a styled band, a boss with phases and a tell, things happening on screen from the first seconds, and an ending with its moment. A game this size is usually 350 to 500 lines of readable code.';

/** The compile reply with its asset list first (after the title), so the art can start while the code is written. */
const STREAM_SCHEMA = (() => {
  const { title, howToPlay, assets, ...rest } = PIECES_SCHEMA.properties;
  // Some models write the fields in the order of "required", others in the order of "properties": both say assets first.
  const first = ['title', 'howToPlay', 'assets'];
  return { ...PIECES_SCHEMA, required: [...first, ...PIECES_SCHEMA.required.filter((k) => !first.includes(k))], properties: { title, howToPlay, assets, ...rest } };
})();

/** Everything the compiler reads from a project; changes here mean the game needs compiling again. */
export function inputHash(project: Project): string {
  const t = (x: Project['stage'] | Project['sprites'][number]) => ({
    n: x.name,
    d: x.description,
    // What the compiler sees, so moving scripts around or loose blocks don't call for a compile.
    b: serializeBlocks(x.blocks).text,
    v: x.kind === 'sprite' ? (x.variables ?? []) : [],
    c: x.costumes.map((c) => [c.name, c.kind, c.kind === 'image' ? [c.width, c.height] : 0]),
    s: x.sounds.map((s) => s.name),
    p: x.kind === 'sprite' ? [x.x, x.y, x.z, x.size, x.direction, x.visible, x.rotationStyle] : 0,
  });
  // e: the engine the game was built for (Phaser now): a game built for another one builds again.
  // d: the dial (how much of the game the compiler makes). Projects from before the dial have none, and hash as they did.
  return hashString(JSON.stringify({ e: 'phaser', m: project.mode, t: project.title, n: project.notes, v: project.variables ?? [], s: t(project.stage), sp: project.sprites.map(t), d: project.dial }));
}

function planProject(project: Project): TargetPlan[] {
  const names = classNames(project);
  return [project.stage, ...project.sprites].map((t) => planTarget(project, t, names.get(t.id)!));
}

/** Every piece in use, once each. */
function piecesInUse(plans: TargetPlan[]): PieceRequest[] {
  const seen = new Map<string, PieceRequest>();
  for (const p of plans) for (const r of p.pieces) if (!seen.has(r.key)) seen.set(r.key, r);
  return [...seen.values()];
}

/** The brief (game, made for, art style): everything the words are written to fit. */
function briefOf(plans: TargetPlan[]): string {
  return plans.flatMap((p) => p.brief).join('\n');
}

/** The art style, which the compiler's own art is made in. */
function styleOf(plans: TargetPlan[]): string {
  return plans
    .flatMap((p) => p.brief)
    .filter((line) => line.startsWith('art style:'))
    .join('\n');
}

/** The brief changed since the last compile (games compiled before briefs were kept don't know). */
function briefChanged(previous: CompiledGame | null, plans: TargetPlan[]): boolean {
  return previous?.brief !== undefined && previous.brief !== briefOf(plans);
}

/**
 * Does compiling need a compile request? New or changed words do, and so does a new brief (the
 * words already written may need to change to fit it). Otherwise compiling is instant and works
 * offline (no key or sign-in needed).
 */
export function compileNeedsRequest(project: Project): boolean {
  // Compiled art or sounds were deleted: they're made again.
  if (project.compiled?.remake?.length) return true;
  const plans = planProject(project);
  const inUse = piecesInUse(plans);
  if (project.compiled && !project.compiled.pieces) return inUse.length > 0;
  const known = new Set((project.compiled?.pieces ?? []).map((p) => p.key));
  if (inUse.some((r) => !known.has(r.key))) return true;
  return inUse.length > 0 && briefChanged(project.compiled, plans);
}

/**
 * The words a compile request would write now, for showing them being built: new or changed words,
 * or every word when the brief changed, everything is written again (`all`), or older games kept no pieces.
 */
export function piecesToWrite(project: Project, all = false): Array<Pick<PieceRequest, 'targetId' | 'words'>> {
  const plans = planProject(project);
  const inUse = piecesInUse(plans);
  const known = new Set((project.compiled?.pieces ?? []).map((p) => p.key));
  const every = all || (project.compiled && !project.compiled.pieces) || briefChanged(project.compiled, plans);
  return inUse.filter((r) => every || !known.has(r.key)).map((r) => ({ targetId: r.targetId, words: r.words }));
}

/** The targets that problems mention ("Amble (when ⚑ clicked): ..."); all of them when none match. */
function targetsInProblems(plans: TargetPlan[], problems: string[]): Set<string> {
  const names = new Set<string>();
  for (const p of plans) {
    if (problems.some((line) => line.startsWith(`${p.targetName} `) || line.startsWith(`${p.targetName}:`) || line.includes(`"${p.targetName}"`))) names.add(p.targetName);
  }
  return names.size ? names : new Set(plans.map((p) => p.targetName));
}

async function requireTransport(settings: AiSettings): Promise<Transport> {
  const transport = await resolveTransport(settings);
  if (transport) return transport;
  throw new AiError(
    (await fetchCodexStatus())
      ? 'Some blocks use your own words, and compiling them needs an account: sign in with ChatGPT, or add an OpenAI API key in Settings.'
      : 'Some blocks use your own words, and compiling them needs an account: add an OpenAI API key in Settings (or set OPENAI_API_KEY for the dev server).',
    undefined,
    NO_ACCOUNT,
  );
}

interface Written {
  code: Map<string, string>;
  reply: PiecesReply;
  /** Pieces written before that this request rewrote (their blocks, as "Sprite: block"). */
  revised: string[];
}

/** `source` with the first `find` in it replaced (allowing for different spacing), or null when it isn't there. */
export function replaceOnce(source: string, find: string, replace: string): string | null {
  const at = source.indexOf(find);
  if (at >= 0) return source.slice(0, at) + replace + source.slice(at + find.length);
  const words = find.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const m = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')).exec(source);
  return m ? source.slice(0, m.index) + replace + source.slice(m.index + m[0].length) : null;
}

/**
 * Makes a reply's edits, in order: each changes the whole code of a piece already written ("e2") or
 * a character's class, which go into the reply's pieces and sprites as if written out again (later
 * edits change the code as earlier ones left it). An edit whose "in" names nothing goes where its
 * text is. Returns the edits that couldn't be made, to ask for again.
 */
function applyEdits(reply: PiecesReply, edits: CodeEdit[], project: Project, revisable: PieceTask[], written: ReadonlyMap<string, CompiledPiece>): string[] {
  reply.pieces = reply.pieces ?? [];
  reply.sprites = reply.sprites ?? [];
  const compiled = project.compiled;
  const pieceCode = (t: PieceTask) => reply.pieces.find((p) => String(p.id).trim() === t.id)?.code ?? written.get(t.request.key)?.code ?? '';
  const spriteCode = (s: CompiledSprite) => reply.sprites.find((x) => String(x.name).trim() === s.name)?.code ?? compiled?.code.find((c) => c.targetId === s.id)?.source ?? '';
  const setPiece = (t: PieceTask, code: string) => {
    const p = reply.pieces.find((x) => String(x.id).trim() === t.id);
    if (p) p.code = code;
    else reply.pieces.push({ id: t.id, code });
  };
  const setSprite = (s: CompiledSprite, code: string) => {
    const x = reply.sprites.find((y) => String(y.name).trim() === s.name);
    if (x) x.code = code;
    else reply.sprites.push({ name: s.name, description: s.description, x: s.x, y: s.y, size: s.size, direction: s.direction, visible: s.visible, code });
  };
  const missed: string[] = [];
  for (const e of edits) {
    const where = String(e.in ?? '').trim();
    const find = String(e.find ?? '');
    const replace = String(e.replace ?? '');
    if (!find.trim()) continue;
    const task = revisable.find((t) => t.id === where);
    const sprite = task ? undefined : compiled?.sprites.find((s) => s.name === where);
    const places: Array<{ code: string; set: (code: string) => void }> = task
      ? [{ code: pieceCode(task), set: (c) => setPiece(task, c) }]
      : sprite
        ? [{ code: spriteCode(sprite), set: (c) => setSprite(sprite, c) }]
        : [...revisable.map((t) => ({ code: pieceCode(t), set: (c: string) => setPiece(t, c) })), ...(compiled?.sprites ?? []).map((s) => ({ code: spriteCode(s), set: (c: string) => setSprite(s, c) }))];
    let done = false;
    for (const place of places) {
      const next = replaceOnce(place.code, find, replace);
      if (next === null) continue;
      place.set(next);
      done = true;
      break;
    }
    if (!done) missed.push(`in ${where || 'the code'}: "find" ${JSON.stringify(find.length > 160 ? `${find.slice(0, 160)}…` : find)} isn't there`);
  }
  return missed;
}

/**
 * One compile request for the new pieces (and a second one only for pieces that didn't check
 * out). The request shows the whole program and every piece already written: any of those can
 * come back rewritten, when the new words (or a new brief) mean they must change too.
 */
async function writePieces(
  project: Project,
  plans: TargetPlan[],
  tasks: PieceTask[],
  revisable: PieceTask[],
  written: ReadonlyMap<string, CompiledPiece>,
  transport: Transport,
  settings: AiSettings,
  opts: CompileOptions,
  warnings: string[],
  briefBefore?: string,
  /** Streaming: called once the reply's asset list is complete (or, building in fan-out, each part of it), while the code is still being written. */
  onAssets?: (assets: AssetRequest[], title: string) => void,
  /** Streaming: the new game's title and how to play, as soon as they are written. */
  onOutline?: (o: { title?: string; howToPlay?: string }) => void,
): Promise<Written> {
  // Writing the game piece (the whole game from the game: line) brings the directing notes with it.
  const freedom = tasks.find((t) => t.request.kind === 'game')?.request.freedom;
  const system = piecesSystemPrompt('2d', { freedom });
  const size = harness().sizeReminder && freedom ? freedomSize(freedom) + (harness().fullSize ? FULL_SIZE : '') : '';
  // A quick change (no new game, and code already written to change): it comes back as edits.
  const editing = harness().edits && !freedom && (revisable.length > 0 || Boolean(project.compiled?.sprites.length));
  const base = piecesUserPrompt({ project, plans, tasks, revisable, written, problems: opts.fixProblems, briefBefore, editing }) + (size ? `\n\n## Before you write\nBuild the whole game the dial asks for, however quickly you work. ${size}` : '') + (editing ? `\n\n${EDITS_GUIDE}` : '');
  // A new game in the lean reply (lean.ts): its cast first, compactly, and the art starts from each entry.
  let lean = Boolean(onAssets && freedom && harness().lean);
  // ...and its characters' classes written by a second request at the same time, from its header.
  const castWriter = lean && harness().castWriter;
  let castCall: Promise<Array<{ name: string; code: string }>> | null = null;
  const startCast = (h: LeanHeader) => {
    if (castCall) return;
    const early = earlyCostumes(project, onAssets!);
    const asked = headerAssets(h);
    const feed = watchReply({
      onItem: (key, item) => {
        const x = item as { name?: string; code?: string } | null;
        if (key === 'sprites' && x && String(x.name ?? '').trim() && x.code) early(String(x.name).trim(), String(x.code), asked, h.title ?? '');
      },
    });
    castCall = chatJson<{ sprites: Array<{ name: string; code: string }> }>(transport, {
      model: settings.model,
      system,
      user: `${base}\n\n${castWriterPart(h)}`,
      schema: CAST_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'amble_cast',
      reasoningEffort: harness().gameEffort ?? settings.reasoningEffort,
      kind: 'code',
      signal: opts.signal,
      onText: feed,
    }).then((r) => (r.sprites ?? []).map((x) => ({ name: String(x.name ?? '').trim(), code: String(x.code ?? '') })));
    // (Awaited with the main reply; a failure before then isn't unhandled.)
    castCall.catch(() => undefined);
  };
  const user = base + (lean && opts.picks ? `\n\n${ASKING_GUIDE}` : '') + (lean ? `\n\n${harness().spritesFirst && !castWriter ? LEAN_GUIDE_SPRITES_FIRST : LEAN_GUIDE}${castWriter ? `\n\n${harness().slimContract ? CAST_WRITER_GUIDE_SLIM : CAST_WRITER_GUIDE}` : ''}` : onAssets ? '\n\nWrite "assets" first: every costume, backdrop and sound the game uses, before any code. The art is made from that list while you write the code, so use exactly those names in the code.' : '');
  let watch = lean ? watchLean(onAssets!, earlyCostumes(project, onAssets!), castWriter ? { headerEnd: harness().balance ? 'balance' : 'contract', call: startCast } : undefined) : onAssets ? watchArray('assets', (items) => onAssets(items as AssetRequest[], streamedTitle(latest))) : null;
  const named: { title?: string; howToPlay?: string } = {};
  let heading = onOutline && freedom
    ? watchReply({
        onField: (key, value) => {
          if (key !== 'title' && key !== 'howToPlay') return;
          named[key] = String(value ?? '').trim();
          onOutline(named);
        },
      })
    : null;
  let latest = '';
  const ask = (prompt: string) =>
    chatJson<PiecesReply>(transport, {
      model: settings.model,
      system,
      user: prompt,
      schema: (lean ? leanSchema(harness().balance, castWriter, harness().spritesFirst, harness().slimContract) : watch ? STREAM_SCHEMA : editing ? EDITS_SCHEMA : PIECES_SCHEMA) as unknown as Record<string, unknown>,
      onText: watch || heading
        ? (text) => {
            latest = text;
            watch?.(text);
            heading?.(text);
          }
        : undefined,
      schemaName: 'amble_pieces',
      reasoningEffort: harness().gameEffort ?? settings.reasoningEffort,
      signal: opts.signal,
      onProgress: (p) =>
        opts.onProgress?.(
          p.phase === 'waiting'
            ? { stage: 'thinking', message: freedom ? 'Thinking up your game' : `Compiling ${tasks.length} block${tasks.length > 1 ? 's' : ''} written in words` }
            : { stage: 'writing', message: 'Compiling', chars: p.chars },
        ),
    });

  const code = new Map<string, string>();
  const byIdOf = (reply: PiecesReply) => new Map((reply.pieces ?? []).map((p) => [String(p.id).trim(), String(p.code ?? '')]));
  const check = (reply: PiecesReply, which: PieceTask[]): Array<{ task: PieceTask; error: string }> => {
    const byId = byIdOf(reply);
    const failed: Array<{ task: PieceTask; error: string }> = [];
    for (const task of which) {
      const raw = byId.get(task.id);
      if (raw === undefined) {
        failed.push({ task, error: 'it was missing from the reply' });
        continue;
      }
      const checked = checkPiece(task.request.kind, raw);
      if ('error' in checked) failed.push({ task, error: checked.error });
      else code.set(task.request.key, checked.code);
    }
    return failed;
  };

  // The split build: a new game whose only words are its game: line is planned, then written in parts at once.
  const gameTask = tasks.length === 1 && tasks[0].request.kind === 'game' && !revisable.length ? tasks[0] : null;
  const reply = harness().fanout && gameTask
    ? await writeGameFanout({
        game: gameTask,
        system,
        user: base,
        transport,
        settings,
        signal: opts.signal,
        onAssets,
        onOutline,
        onProgress: (message) => opts.onProgress?.({ stage: message.startsWith('Planning') ? 'thinking' : 'writing', message }),
      })
    : harness().split && gameTask
    ? await writeGameSplit({
        game: gameTask,
        system,
        castSystem: piecesSystemPrompt('2d'),
        user: base,
        transport,
        settings,
        signal: opts.signal,
        onAssets,
        onProgress: (message) => opts.onProgress?.({ stage: 'thinking', message }),
      })
    : lean
      ? fromLean(await (async () => {
          const raw = (await ask(user)) as unknown as LeanReply & Partial<LeanHeader>;
          if (castWriter) {
            // (The stream may have missed the header's end: the whole reply has it.)
            startCast({ title: raw.title, howToPlay: raw.howToPlay, cast: raw.cast ?? [], backdrops: raw.backdrops, sounds: raw.sounds, contract: raw.contract, balance: raw.balance });
            raw.sprites = await castCall!;
          }
          return raw;
        })())
      : await ask(user);
  // Only the first reply streams its assets (a repair answers with code alone).
  watch = null;
  heading = null;
  lean = false;
  if (editing) {
    // Edits become the whole new code of what they change (as if it had been written out again).
    let missed = applyEdits(reply, reply.edits ?? [], project, revisable, written);
    if (missed.length) {
      opts.onProgress?.({ stage: 'repairing', message: 'Fixing an edit' });
      const again = await ask(`${user}\n\n## Edits that didn't apply\n${missed.map((m) => `- ${m}`).join('\n')}\nThe "find" text must be copied exactly from the code above (as it is now: your other edits are made). Send only those edits again, and leave "pieces" and "sprites" empty.`);
      missed = applyEdits(reply, again.edits ?? [], project, revisable, written);
      for (const m of missed) warnings.push(`A change couldn't be made: ${m}`);
    }
  }
  opts.onProgress?.({ stage: 'checking', message: 'Checking the code' });
  // Rewrites of pieces written before (left out, or empty: they stay as they are).
  const revised: string[] = [];
  const replied = byIdOf(reply);
  for (const r of revisable) {
    const raw = replied.get(r.id);
    if (raw === undefined || !raw.trim()) continue;
    const checked = checkPiece(r.request.kind, raw);
    if ('error' in checked || checked.code === written.get(r.request.key)?.code) continue;
    code.set(r.request.key, checked.code);
    revised.push(`${r.request.targetName}: ${r.request.block}`);
  }
  let failed = check(reply, tasks);
  // Characters that came with the pieces: their classes must parse too (a game's cast is most of the game).
  const brokenSprites = (reply.sprites ?? [])
    .map((sp) => ({ name: String(sp.name ?? '').trim(), errors: instrumentTargetCode(String(sp.code ?? ''), 'sprite').errors }))
    .filter((sp) => sp.name && sp.errors.length);
  if (failed.length || brokenSprites.length) {
    const n = failed.length + brokenSprites.length;
    opts.onProgress?.({ stage: 'repairing', message: `Fixing ${n} ${failed.length ? `block${n > 1 ? 's' : ''}` : `character${n > 1 ? 's' : ''}`}` });
    const problems = [...failed.map((f) => `- ${f.task.id}: ${f.error}`), ...brokenSprites.map((sp) => `- sprite "${sp.name}": ${sp.errors.join('; ')}`)];
    const wanted = [
      failed.length ? `these pieces: ${failed.map((f) => f.task.id).join(', ')}` : '',
      brokenSprites.length ? `these sprites, each with its whole class: ${brokenSprites.map((sp) => `"${sp.name}"`).join(', ')}` : '',
    ].filter(Boolean);
    const again = `${user}\n\n## Your previous code for these pieces didn't work\n${problems.join('\n')}\n\nReply again with only ${wanted.join(', and ')} (${brokenSprites.length ? 'no other sprites; ' : 'sprites and '}assets can be empty).`;
    const second = await ask(again);
    failed = check(second, failed.map((f) => f.task));
    // A character sent again replaces the broken one.
    for (const fixed of second.sprites ?? []) {
      const name = String(fixed.name ?? '').trim();
      const at = (reply.sprites ?? []).findIndex((sp) => String(sp.name ?? '').trim() === name);
      if (at >= 0 && brokenSprites.some((sp) => sp.name === name)) reply.sprites[at] = { ...reply.sprites[at], code: fixed.code };
    }
    reply.assets = [...(reply.assets ?? []), ...(second.assets ?? [])];
    reply.warnings = [...(reply.warnings ?? []), ...(second.warnings ?? [])];
    reply.questions = [...(reply.questions ?? []), ...(second.questions ?? [])];
  }
  for (const f of failed) warnings.push(`${f.task.request.targetName}: couldn't compile "${f.task.request.block}" (${f.error}). It does nothing for now.`);
  return { code, reply, revised };
}

function assetGroup(kind: string): 'image' | 'sound' {
  return kind === 'sound' ? 'sound' : 'image';
}

/** The size a compiled asset was asked for (in pixels). */
function assetSize(a: CompiledAsset): { width: number; height: number } {
  if (a.kind === 'image') return { width: Math.round(a.width / (a.resolution || 1)), height: Math.round(a.height / (a.resolution || 1)) };
  return { width: 0, height: 0 };
}

/**
 * Earlier compiled assets stay (cached pieces may use them), unless the art style changed: then
 * the compiler's own art is made again in the new style. New requests become jobs.
 */
function planAssets(
  project: Project,
  requests: AssetRequest[],
  sprites: CompiledSprite[],
  previous: CompiledAsset[],
  warnings: string[],
  restyle: boolean,
  remake: CompiledGame['remake'] = [],
): { kept: CompiledAsset[]; jobs: AssetJob[] } {
  const owners = new Map<string, { id: string; name: string; user: Project['stage'] | Project['sprites'][number] | null }>();
  owners.set(project.stage.id, { id: project.stage.id, name: project.stage.name, user: project.stage });
  for (const s of project.sprites) owners.set(s.id, { id: s.id, name: s.name, user: s });
  for (const s of sprites) owners.set(s.id, { id: s.id, name: s.name, user: null });
  const byName = (name: string) => {
    if (name.toLowerCase() === 'stage') return owners.get(project.stage.id)!;
    return [...owners.values()].find((o) => o.name === name) ?? null;
  };

  const jobs: AssetJob[] = [];
  const replaced = new Set<string>();
  for (const a of requests) {
    const name = String(a.name ?? '').trim();
    if (!name || !['costume', 'backdrop', 'sound'].includes(a.kind)) continue;
    const owner = byName(String(a.target ?? '').trim());
    if (!owner) {
      warnings.push(`Skipped asset "${name}" for "${a.target}", which doesn't exist.`);
      continue;
    }
    const group = assetGroup(a.kind);
    const key = `${owner.id}|${group}|${name}`;
    if (replaced.has(key)) continue;
    // The author's own asset with this name wins.
    if (owner.user && (group === 'sound' ? owner.user.sounds : owner.user.costumes).some((x) => x.name === name)) continue;
    const description = String(a.description ?? '').trim() || name;
    const old = previous.find((p) => p.targetId === owner.id && assetGroup(p.kind === 'image' ? 'costume' : p.kind) === group && p.name === name);
    if (old && (a.reuse || old.request === description)) continue;
    replaced.add(key);
    jobs.push({ targetId: owner.id, targetName: owner.name, kind: a.kind, name, description, width: Number(a.width) || 0, height: Number(a.height) || 0 });
  }
  // Deleted ones the code may still use (unless the author has their own by that name now).
  for (const r of remake ?? []) {
    const owner = owners.get(r.targetId);
    const group = assetGroup(r.kind);
    const key = `${r.targetId}|${group}|${r.name}`;
    if (!owner || replaced.has(key)) continue;
    if (owner.user && (group === 'sound' ? owner.user.sounds : owner.user.costumes).some((x) => x.name === r.name)) continue;
    replaced.add(key);
    jobs.push({ targetId: owner.id, targetName: owner.name, kind: r.kind, name: r.name, description: r.description || r.name, width: r.width, height: r.height });
  }
  if (restyle) {
    for (const p of previous) {
      const owner = owners.get(p.targetId);
      if (p.kind === 'sound' || !owner) continue;
      const group = assetGroup('costume');
      const key = `${p.targetId}|${group}|${p.name}`;
      if (replaced.has(key)) continue;
      replaced.add(key);
      const kind = p.targetId === project.stage.id ? 'backdrop' : 'costume';
      jobs.push({ targetId: owner.id, targetName: owner.name, kind, name: p.name, description: p.request, ...assetSize(p) });
    }
  }

  const kept = previous
    .filter((p) => owners.has(p.targetId) && !replaced.has(`${p.targetId}|${assetGroup(p.kind === 'image' ? 'costume' : p.kind)}|${p.name}`))
    .map((p) => ({ ...p, targetName: owners.get(p.targetId)!.name }));

  // Every added character needs something to look like.
  for (const s of sprites) {
    const has = [...kept, ...jobs].some((x) => x.targetId === s.id && x.kind !== 'sound');
    if (!has) {
      jobs.push({
        targetId: s.id,
        targetName: s.name,
        kind: 'costume',
        name: s.name.toLowerCase(),
        description: s.description || s.name,
        width: 64,
        height: 64,
      });
    }
  }
  return { kept, jobs };
}

/**
 * Makes the art and sounds, up to six at a time. Every picture is drawn to the same brief (the
 * game's art style), so they share a look. A sprite's costumes are frames of one character: its
 * first costume is drawn, and its other costumes are drawn from that drawing, changing only what
 * they say. Sprites don't wait for each other; only a sprite's later costumes wait for its first.
 */
async function runJobs(jobs: AssetJob[], project: Project, style: string, transport: Transport, settings: AiSettings, opts: CompileOptions, warnings: string[], late = false): Promise<CompiledAsset[]> {
  // By job, not by name: a costume and a sound may share a name.
  const results: Array<CompiledAsset | undefined> = new Array(jobs.length);
  let done = 0;
  const report = (current?: string) =>
    opts.onProgress?.({ stage: 'assets', message: current ? `Making ${current}` : 'Making art and sounds', assetsDone: done, assetsTotal: jobs.length });
  report();
  // The art style blocks, wherever they are (the same ones that decide when the art is made again), as one brief for every picture.
  // A new game's art waits for the player's picks (a few seconds at most), and follows them.
  const picks = opts.picks ? await opts.picks : '';
  const ctx: AssetContext = { transport, settings, gameTitle: project.title, style: artBrief(styleWords(style)), signal: opts.signal, onSketch: opts.onSketch, picks, late };

  // A whole game asks for a dozen pictures and sounds: several at a time, in the order they can start.
  let free = Math.max(1, harness().concurrency);
  const costumeMode = harness().costumes;
  const queue: Array<() => void> = [];
  const failed = new Set<number>();
  const make = async (index: number, reference?: AssetJob['reference']): Promise<CompiledAsset | null> => {
    if (free > 0) free--;
    else await new Promise<void>((start) => queue.push(start));
    const job = jobs[index];
    try {
      report(`${job.kind} "${job.name}"`);
      const asset = await generateAsset(reference ? { ...job, reference } : job, ctx);
      results[index] = asset;
      return asset;
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      warnings.push(`Couldn't make ${job.kind} "${job.name}" (${(err as Error).message}); used a placeholder.`);
      results[index] = placeholderAsset(job);
      failed.add(index);
      return null;
    } finally {
      done++;
      if (!opts.signal?.aborted) report();
      // The place goes to the next one waiting.
      const next = queue.shift();
      if (next) next();
      else free++;
    }
  };

  /** One request for several costumes (a place in the queue, like one asset). */
  const makeSheet = async (indexes: number[]): Promise<Array<CompiledAsset | null>> => {
    if (free > 0) free--;
    else await new Promise<void>((start) => queue.push(start));
    try {
      report(`costumes of "${jobs[indexes[0]].targetName}"`);
      const made = await makeSvgSheet(indexes.map((i) => jobs[i]), ctx);
      made.forEach((asset, k) => {
        if (asset) {
          results[indexes[k]] = asset;
          done++;
        }
      });
      return made;
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      return indexes.map(() => null);
    } finally {
      if (!opts.signal?.aborted) report();
      const next = queue.shift();
      if (next) next();
      else free++;
    }
  };

  // Costumes made before that are staying (a fresh start keeps none): a sprite's new costumes are drawn from them.
  const remade = (a: CompiledAsset) => jobs.some((j) => j.kind !== 'sound' && j.targetId === a.targetId && j.name === a.name);
  const staying = opts.fresh || !project.compiled?.pieces ? [] : project.compiled.assets.filter((a) => a.kind === 'image' && !remade(a) && !isPlaceholder(a));
  const earlier = (job: AssetJob) => (job.kind === 'costume' ? staying.find((a) => a.targetId === job.targetId) : undefined);
  await Promise.all(
    costumeSets(jobs).map(async ({ first, rest }) => {
      const old = earlier(jobs[first]);
      const before = (old && referenceOf(old)) ?? undefined;
      if (settings.artMode === 'image') {
        // An image model can't be shown a drawing: the other costumes are told what the first one shows, and none of them waits.
        const { name, description, width, height } = jobs[first];
        await Promise.all([make(first, before), ...rest.map((index) => make(index, before ?? { name, description, width, height }))]);
        return;
      }
      if (costumeMode === 'parallel' || (costumeMode === 'sheet' && before)) {
        // Nothing waits: every costume on its own at once (drawn from an earlier costume when there is one).
        await Promise.all([first, ...rest].map((index) => make(index, before)));
        return;
      }
      if (costumeMode === 'sheet' && rest.length) {
        // All of the sprite's costumes in one request; any it left out are drawn on their own.
        const all = [first, ...rest];
        const sheet = await makeSheet(all);
        const lead = sheet.find(Boolean) ?? null;
        await Promise.all(all.filter((_, i) => !sheet[i]).map((index) => make(index, (lead && referenceOf(lead)) ?? undefined)));
        return;
      }
      const lead = await make(first, before);
      // The first costume failed: the others are drawn on their own (or from an earlier costume).
      const reference = (lead && referenceOf(lead)) ?? before;
      await Promise.all(rest.map((index) => make(index, reference)));
    }),
  );
  // A costume that couldn't be made looks like another costume of its sprite for now, when it has one.
  for (const index of failed) {
    const job = jobs[index];
    const like = job.kind === 'costume' ? (results.find((r, i) => r && !failed.has(i) && jobs[i].kind === 'costume' && jobs[i].targetId === job.targetId) ?? earlier(job)) : undefined;
    if (like) results[index] = placeholderAsset(job, like);
  }
  return results.filter((r): r is CompiledAsset => Boolean(r));
}

/** Streamed art belongs to a character that doesn't have an id yet: "pending:<its name>". */
const PENDING = 'pending:';

/** Jobs for the asset list a reply streamed (before its characters exist: see PENDING). */
function streamedJobs(project: Project, list: AssetRequest[]): AssetJob[] {
  const jobs: AssetJob[] = [];
  const seen = new Set<string>();
  for (const a of list) {
    const name = String(a?.name ?? '').trim();
    const target = String(a?.target ?? '').trim();
    if (!name || !target || !['costume', 'backdrop', 'sound'].includes(a.kind)) continue;
    const user = target.toLowerCase() === 'stage' ? project.stage : project.sprites.find((x) => x.name === target);
    const group = a.kind === 'sound' ? 'sound' : 'image';
    // The author's own asset with this name wins (as in planAssets).
    if (user && (group === 'sound' ? user.sounds : user.costumes).some((x) => x.name === name)) continue;
    const key = `${user?.id ?? target}|${group}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push({ targetId: user?.id ?? `${PENDING}${target}`, targetName: user?.name ?? target, kind: a.kind, name, description: String(a.description ?? '').trim() || name, width: Number(a.width) || 0, height: Number(a.height) || 0 });
  }
  return jobs;
}

/** Everything the code can name: the classes, costumes, sounds and sprites of the game as compiled so far. */
function lintCompiled(
  project: Project,
  plans: TargetPlan[],
  code: ReadonlyMap<string, string>,
  sprites: CompiledSprite[],
  spriteSource: ReadonlyMap<string, string>,
  reply: PiecesReply,
  assets: CompiledAsset[],
) {
  const stage = project.stage.name;
  const targetOf = (name: string) => (name.trim().toLowerCase() === 'stage' ? stage : name.trim());
  const costumes = new Map<string, Set<string>>();
  const sounds = new Set<string>();
  const add = (target: string, name: string, kind: string) => {
    if (kind === 'sound') sounds.add(name);
    else {
      if (!costumes.has(target)) costumes.set(target, new Set());
      costumes.get(target)!.add(name);
    }
  };
  for (const t of [project.stage, ...project.sprites]) {
    for (const c of t.costumes) add(t.name, c.name, 'costume');
    for (const x of t.sounds) add(t.name, x.name, 'sound');
  }
  for (const a of reply.assets ?? []) add(targetOf(String(a.target ?? '')), String(a.name ?? '').trim(), a.kind);
  for (const a of assets) add(a.targetName, a.name, a.kind === 'sound' ? 'sound' : 'costume');
  const classes = [
    ...plans.map((p) => ({ target: p.targetName, kind: p.kind as 'sprite' | 'stage', source: p.render(code) })),
    ...sprites.map((sp) => ({ target: sp.name, kind: 'sprite' as const, source: spriteSource.get(sp.id) ?? '' })),
  ];
  return lintGame({ classes, costumes, sounds, sprites: new Set([...project.sprites.map((x) => x.name), ...sprites.map((x) => x.name)]), stage });
}

/** Missing art and sounds the code uses become asset requests, described from their names. */
const nameWords = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').trim();

/** The request for a costume (or backdrop) the code uses that wasn't asked for: described from its name, and from the sprite's other costumes. */
function missingCostume(stage: string, assets: AssetRequest[], m: { target: string; name: string }, about = ''): AssetRequest {
  const isStage = m.target === stage;
  const sibling = assets.find((a) => a.kind === 'costume' && a.target === m.target);
  return {
    target: isStage ? 'Stage' : m.target,
    kind: isStage ? 'backdrop' : 'costume',
    name: m.name,
    description: isStage ? `A backdrop: ${nameWords(m.name)}` : `${sibling ? `${sibling.description}. This frame: ` : about ? `${about}. ` : ''}${nameWords(m.name)}`,
    width: isStage ? 480 : Number(sibling?.width) || 64,
    height: isStage ? 360 : Number(sibling?.height) || 64,
    reuse: false,
  };
}

function addMissingAssets(project: Project, reply: PiecesReply, sprites: CompiledSprite[], found: ReturnType<typeof lintGame>): void {
  reply.assets = reply.assets ?? [];
  for (const m of found.missingCostumes) {
    const about = sprites.find((x) => x.name === m.target)?.description || project.sprites.find((x) => x.name === m.target)?.description || '';
    reply.assets.push(missingCostume(project.stage.name, reply.assets, m, about));
  }
  for (const name of found.missingSounds) reply.assets.push({ target: 'Stage', kind: 'sound', name, description: nameWords(name), width: 0, height: 0, reuse: false });
}

/**
 * Lean replies: each character's class is checked as soon as it is written, and costumes it uses that
 * the cast left out are drawn now, while the rest of the code is written (described just as the
 * check after the reply would ask for them, so that check finds them already on their way).
 */
function earlyCostumes(project: Project, onAssets: (assets: AssetRequest[], title: string) => void) {
  const classes: Array<{ target: string; kind: 'sprite'; source: string }> = [];
  const sent = new Set<string>();
  return (name: string, code: string, asked: AssetRequest[], title: string) => {
    classes.push({ target: name, kind: 'sprite', source: code });
    const costumes = new Map<string, Set<string>>();
    for (const t of project.sprites) costumes.set(t.name, new Set(t.costumes.map((c) => c.name)));
    for (const a of asked) if (a.kind === 'costume') costumes.set(a.target, new Set([...(costumes.get(a.target) ?? []), a.name]));
    const found = lintGame({ classes, costumes, sounds: new Set(), sprites: new Set(), stage: project.stage.name, available: () => true });
    const more = found.missingCostumes.filter((m) => m.target !== project.stage.name && !sent.has(`${m.target}|${m.name}`) && asked.some((a) => a.kind === 'costume' && a.target === m.target));
    for (const m of more) sent.add(`${m.target}|${m.name}`);
    if (more.length) onAssets(more.map((m) => missingCostume(project.stage.name, asked, m)), title);
  };
}

/**
 * One request that fixes code using names that point at nothing: it sees the game as it was asked
 * for, the code of the targets with problems, and the problems; it answers with only what changes.
 */
async function fixCode(
  problems: string[],
  project: Project,
  tasks: PieceTask[],
  code: Map<string, string>,
  sprites: CompiledSprite[],
  spriteSource: Map<string, string>,
  transport: Transport,
  settings: AiSettings,
  opts: CompileOptions,
  warnings: string[],
  /** Review the whole game as well (the harness's `review`): all of its code is shown, problems or not. */
  review = false,
): Promise<void> {
  const names = (p: string, target: string) => p.startsWith(`${target} (`) || p.startsWith(`${target}:`);
  const named = (target: string) => problems.some((p) => names(p, target));
  // Problems that name no target ('music("groove"): no sound...'): the code that mentions what they quote.
  const targets = [...sprites.map((x) => x.name), ...tasks.map((t) => t.request.targetName)];
  const quoted = problems.filter((p) => !targets.some((t) => names(p, t))).flatMap((p) => [...p.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  const mentions = (source: string) => quoted.some((q) => source.includes(`"${q}"`) || source.includes(`'${q}'`));
  const shownSprites = sprites.filter((sp) => review || named(sp.name) || mentions(spriteSource.get(sp.id) ?? ''));
  const shownTasks = tasks.filter((t) => code.has(t.request.key) && (review || named(t.request.targetName) || mentions(code.get(t.request.key) ?? '')));
  const freedom = tasks.find((t) => t.request.kind === 'game')?.request.freedom;
  const user = [
    `Game title: ${project.title || 'Untitled'}`,
    `Characters in the game: ${[...project.sprites.map((x) => x.name), ...sprites.map((x) => x.name)].join(', ')}`,
    '## The code you wrote',
    ...shownTasks.map((t) => `### Piece ${t.id} (${t.request.kind}, in "${t.request.targetName}"): ${t.request.block}\n\`\`\`js\n${code.get(t.request.key)}\n\`\`\``),
    ...shownSprites.map((sp) => `### Sprite "${sp.name}"\n\`\`\`js\n${spriteSource.get(sp.id) ?? ''}\n\`\`\``),
    ...(problems.length ? ['## Problems found before the game ran', ...problems.map((p) => `- ${p}`)] : []),
    ...(review
      ? [
          '## Review it before anyone plays',
          'You wrote this game quickly. Now test it in your head like a careful tester: walk through a whole play, from the first frame to the win and to the loss, pressing what a player would press. Look for what would break or stall it: a wait or loop that never ends, a wave or act that can never finish (something that must be cleared but never leaves), a state that gets stuck, something the player must reach that they can\'t, copies that pile up and are never removed, a name used that doesn\'t exist, a method called that isn\'t a generator under yield*, sprite-only helpers called on the stage. Fix what you find (and every problem listed above), with the smallest change that keeps the game the same. If nothing is wrong, change nothing.',
        ]
      : []),
    'Reply with only what changes: in "pieces", the pieces you fix (id and whole new body); in "sprites", the sprites you fix (same name, description, position and size, with the whole fixed class). Everything else empty: assets, warnings and questions [], title and howToPlay "".',
  ].join('\n\n');
  opts.onProgress?.({ stage: 'repairing', message: review ? 'Checking the game' : `Fixing ${problems.length} problem${problems.length > 1 ? 's' : ''}` });
  const fixed = await chatJson<PiecesReply>(transport, {
    model: settings.model,
    system: piecesSystemPrompt('2d', { freedom }),
    user,
    schema: PIECES_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'amble_pieces',
    reasoningEffort: harness().repairEffort,
    kind: 'code',
    signal: opts.signal,
  });
  for (const p of fixed.pieces ?? []) {
    const task = shownTasks.find((t) => t.id === String(p.id).trim());
    if (!task) continue;
    const checked = checkPiece(task.request.kind, String(p.code ?? ''));
    if ('code' in checked) code.set(task.request.key, checked.code);
  }
  for (const s of fixed.sprites ?? []) {
    const sp = shownSprites.find((x) => x.name === String(s.name ?? '').trim());
    const source = String(s.code ?? '');
    if (sp && source.trim() && !instrumentTargetCode(source, 'sprite').errors.length) spriteSource.set(sp.id, source);
  }
  if (problems.length) warnings.push(`Fixed before the first run: ${problems.join(' | ')}`);
  const changed = [...(fixed.pieces ?? []).map((p) => String(p.id)), ...(fixed.sprites ?? []).map((x) => String(x.name))].filter(Boolean);
  if (review && changed.length) warnings.push(`Reviewed and fixed: ${changed.join(', ')}`);
}

/**
 * Compiles the project. Amble compiles every block itself; words that are new (or, with Fix, the
 * words of the sprites that had problems) go out in one compile request, which sees the whole
 * program and may also rewrite words written before, anywhere in the game, when the change calls
 * for it (so does a new brief). With nothing new, the last compile's code is reused as it is;
 * `fresh` starts over and writes everything again.
 */
export async function compileProject(project: Project, options: CompileOptions): Promise<CompiledGame> {
  let opts = withPreview(options);
  opts.onProgress?.({ stage: 'preparing', message: 'Reading your blocks' });
  const previous = project.compiled;
  // Games compiled before pieces existed start over.
  const fresh = Boolean(opts.fresh || (previous && !previous.pieces));
  const plans = planProject(project);
  const warnings: string[] = plans.flatMap((p) => p.warnings);
  const cache = new Map<string, CompiledPiece>(fresh ? [] : (previous?.pieces ?? []).map((p) => [p.key, p]));
  const inUse = piecesInUse(plans);
  const brief = briefOf(plans);
  const style = styleOf(plans);
  const newBrief = !fresh && briefChanged(previous, plans);

  const redo = opts.fixProblems?.length ? targetsInProblems(plans, opts.fixProblems) : null;
  const tasks: PieceTask[] = [];
  for (const r of inUse) {
    if (!cache.has(r.key) || redo?.has(r.targetName)) tasks.push({ id: `p${tasks.length + 1}`, request: r });
  }
  // Every other piece is shown with its code, and may come back rewritten: words anywhere can
  // change how the whole game works, not just their own sprite.
  const asked = new Set(tasks.map((t) => t.request.key));
  const revisable: PieceTask[] = inUse.filter((r) => !asked.has(r.key)).map((r, i) => ({ id: `e${i + 1}`, request: r }));
  const request = tasks.length > 0 || (newBrief && revisable.length > 0);

  let transport: Transport | null = null;
  let settings = opts.settings;
  let reply: PiecesReply | null = null;
  let revised: string[] = [];
  const early: Array<Promise<CompiledAsset[]>> = [];
  /** The jobs of that art. */
  const planned: AssetJob[] = [];
  const code = new Map<string, string>([...cache].map(([k, p]) => [k, p.code]));
  if (request && opts.offline) {
    const words = tasks.filter((t) => !cache.has(t.request.key)).length;
    if (words) warnings.push(`${words} block${words > 1 ? 's' : ''} in your own words ${words > 1 ? "aren't" : "isn't"} built yet, so ${words > 1 ? 'they do' : 'it does'} nothing for now. ${words > 1 ? 'They build' : 'It builds'} once you add a key in Settings, or sign in.`);
  } else if (request) {
    transport = await requireTransport(opts.settings);
    settings = effectiveSettings(opts.settings, transport);
    opts = { ...opts, settings };
    // Streaming (a new game): its art and sounds are made while the model writes the code.
    const streaming = harness().streamAssets && tasks.some((t) => t.request.kind === 'game') && (fresh || !previous?.assets.length);
    const t = transport;
    const st = settings;
    const onAssets = streaming
      ? (list: AssetRequest[], title: string) => {
          const jobs = streamedJobs(project, list);
          if (!jobs.length) return;
          const titled = title ? { ...project, title } : project;
          planned.push(...jobs);
          early.push(
            runJobs(jobs, titled, style, t, st, opts, warnings).catch((err) => {
              if (opts.signal?.aborted) throw err;
              return [];
            }),
          );
        }
      : undefined;
    const result = await writePieces(project, plans, tasks, revisable, cache, transport, settings, opts, warnings, newBrief ? previous!.brief : undefined, onAssets, opts.onOutline);
    reply = result.reply;
    revised = result.revised;
    for (const [k, c] of result.code) code.set(k, c);
    for (const w of reply.warnings ?? []) warnings.push(String(w));
  }

  // Questions about words: new ones for the pieces just written, and the earlier ones for pieces kept as they were.
  const questions: CompiledQuestion[] = [];
  const byTask = new Map([...tasks, ...revisable].map((t) => [t.id, t.request]));
  for (const q of reply?.questions ?? []) {
    const r = byTask.get(String(q.piece ?? '').trim());
    const text = String(q.question ?? '').trim();
    if (r && text && !questions.some((x) => x.pieceKey === r.key)) questions.push({ targetId: r.targetId, pieceKey: r.key, text });
  }
  if (!fresh) {
    const keep = new Set(inUse.map((r) => r.key));
    const rewritten = new Set([...tasks.filter((t) => code.has(t.request.key)).map((t) => t.request.key), ...(reply ? revisable.filter((r) => reply!.pieces?.some((p) => String(p.id).trim() === r.id && String(p.code ?? '').trim())).map((r) => r.request.key) : [])]);
    for (const q of previous?.questions ?? []) {
      if (keep.has(q.pieceKey) && !rewritten.has(q.pieceKey) && !questions.some((x) => x.pieceKey === q.pieceKey)) questions.push(q);
    }
  }

  // Characters added by the compiler: earlier ones stay with their code; new ones join.
  const userNames = new Set(project.sprites.map((s) => s.name));
  const sprites: CompiledSprite[] = [];
  const spriteSource = new Map<string, string>();
  // A new game piece (the whole game) comes with its whole cast: characters of the game before, which it left out, go.
  const newGame = tasks.some((t) => t.request.kind === 'game' && code.has(t.request.key)) && Boolean(reply);
  const hasGame = inUse.some((r) => r.kind === 'game');
  const recast = new Set(newGame ? (reply?.sprites ?? []).map((sp) => String(sp.name ?? '').trim()) : []);
  if (!fresh) {
    for (const s of previous?.sprites ?? []) {
      if (userNames.has(s.name)) continue;
      if (newGame && !recast.has(s.name)) continue;
      const src = previous!.code.find((c) => c.targetId === s.id)?.source;
      sprites.push(s);
      if (src) spriteSource.set(s.id, src);
    }
  }
  for (const s of reply?.sprites ?? []) {
    const name = String(s.name ?? '').trim();
    if (!name || name.toLowerCase() === 'stage') continue;
    if (userNames.has(name)) {
      warnings.push(`Ignored a new character "${name}": you already have a sprite with that name.`);
      continue;
    }
    const existing = sprites.findIndex((x) => x.name === name);
    const sprite: CompiledSprite = {
      id: existing >= 0 ? sprites[existing].id : (previous?.sprites.find((x) => x.name === name)?.id ?? uid('s')),
      name,
      description: String(s.description ?? ''),
      x: Number(s.x) || 0,
      y: Number(s.y) || 0,
      size: Number(s.size) > 0 ? Number(s.size) : 100,
      direction: Number(s.direction) || 0,
      visible: s.visible !== false,
      rotationStyle: 'all around',
    };
    if (existing >= 0) sprites[existing] = sprite;
    else sprites.push(sprite);
    spriteSource.set(sprite.id, String(s.code ?? ''));
  }

  // The harness's check: art and sounds the code uses but didn't ask for join the asset requests, and
  // code that uses names that point at nothing is fixed in one more request, while the art is made.
  let fixing: Promise<void> | null = null;
  if (harness().lint && reply && transport && !opts.offline) {
    // (It starts before the streamed art is done: the reply's asset list already names all of that art.)
    const found = lintCompiled(project, plans, code, sprites, spriteSource, reply, fresh ? [] : (previous?.assets ?? []));
    addMissingAssets(project, reply, sprites, found);
    const review = harness().review && tasks.some((t) => t.request.kind === 'game');
    if (found.problems.length || review) {
      const t = transport;
      fixing = fixCode(found.problems, project, tasks, code, sprites, spriteSource, t, settings, opts, warnings, review).catch((err) => {
        if (opts.signal?.aborted) throw err;
        warnings.push(`Couldn't fix ${found.problems.length} problem${found.problems.length > 1 ? 's' : ''} in the code (${(err as Error).message}).`);
      });
    }
  }

  // Art and sounds being made while the code was written: those of new characters get their ids now
  // (ones for characters the reply dropped go). Until they are done they stand in as placeholders,
  // so the asset plan below makes only the rest, and the trial run can start without them.
  const idOf = new Map(sprites.map((x) => [x.name, x.id]));
  const ownId = (a: { targetId: string; targetName: string }) => (a.targetId.startsWith(PENDING) ? (idOf.get(a.targetName) ?? null) : a.targetId);
  const slot = (a: { targetId: string; name: string; kind: string }) => `${a.targetId}|${a.kind === 'sound' ? 'sound' : 'image'}|${a.name}`;
  const standIns = planned.flatMap((j) => {
    const id = ownId(j);
    return id ? [placeholderAsset({ ...j, targetId: id })] : [];
  });
  const streamedArt = Promise.all(early).then((lists) =>
    lists.flat().flatMap((a) => {
      const id = ownId(a);
      return id ? [{ ...a, targetId: id }] : [];
    }),
  );

  // A new art style remakes the compiler's own art (not without an account: the old art stays until then).
  const restyle = !fresh && !opts.offline && previous?.style !== undefined && previous.style !== style;
  // Deleted compiled art waits for an account, like the words do.
  const remake = fresh ? [] : (previous?.remake ?? []);
  const { kept, jobs } = planAssets(project, reply?.assets ?? [], sprites, [...(fresh ? [] : (previous?.assets ?? [])), ...standIns], warnings, restyle, opts.offline ? [] : remake);
  let made: Promise<CompiledAsset[]> = Promise.resolve([]);
  if (jobs.length && opts.offline && !transport) {
    made = Promise.resolve(jobs.map((j) => placeholderAsset(j)));
  } else if (jobs.length) {
    if (!transport) {
      transport = await requireTransport(opts.settings);
      settings = effectiveSettings(opts.settings, transport);
    }
    // Art asked for once the code is written: the game waits for it alone.
    made = runJobs(jobs, project, style, transport, settings, opts, warnings, true);
  }
  let more: Promise<CompiledAsset[]> = Promise.resolve([]);
  const moreJobs: AssetJob[] = [];
  if (fixing) {
    await fixing;
    // The fixed code may use art or sounds that don't exist yet: they're made now (usually none).
    const again = lintCompiled(project, plans, code, sprites, spriteSource, reply!, [...kept, ...jobs.map((j) => placeholderAsset(j))]);
    const extra: PiecesReply = { pieces: [], sprites: [], assets: [], warnings: [] };
    addMissingAssets(project, extra, sprites, again);
    if (extra.assets.length && transport) {
      moreJobs.push(...planAssets(project, extra.assets, sprites, [...kept, ...jobs.map((j) => placeholderAsset(j))], warnings, false, []).jobs);
      more = runJobs(moreJobs, project, style, transport, settings, opts, warnings, true);
    }
  }
  /** All the art, once it is made (a stand-in whose drawing never came stays a placeholder). */
  const allArt = async (): Promise<CompiledAsset[]> => {
    const [streamed, rest, extra] = await Promise.all([streamedArt, made, more]);
    const bySlot = new Map(streamed.map((a) => [slot(a), a]));
    return [...kept.map((a) => bySlot.get(slot(a)) ?? a), ...rest, ...extra];
  };

  // Put the classes together and make them safe to run (again after a fix).
  opts.onProgress?.({ stage: 'checking', message: 'Putting the game together' });
  const assemble = (): CompiledCode[] => {
    const entries: CompiledCode[] = [];
    const taken = new Set(plans.map((p) => p.className));
    for (const plan of plans) {
      const source = plan.render(code);
      const result = instrumentTargetCode(source, plan.kind);
      for (const e of result.errors) warnings.unshift(`${plan.targetName}: ${e}`);
      if (result.errors.length) continue;
      entries.push({ targetId: plan.targetId, targetName: plan.targetName, className: result.className ?? plan.className, source, runSource: result.runSource });
    }
    for (const s of sprites) {
      const source = spriteSource.get(s.id);
      if (!source) {
        warnings.push(`The new character "${s.name}" has no code, so it just sits there.`);
        continue;
      }
      const result = instrumentTargetCode(source, 'sprite');
      for (const e of result.errors) warnings.unshift(`${s.name}: ${e}`);
      if (result.errors.length) continue;
      const className = result.className ?? classNameFor(s.name, taken);
      taken.add(className);
      entries.push({ targetId: s.id, targetName: s.name, className, source, runSource: result.runSource });
    }
    return entries;
  };

  // Keep the pieces in use, then earlier ones (so undoing an edit compiles instantly again).
  const keepPieces = (): CompiledPiece[] => {
    const pieces: CompiledPiece[] = [];
    for (const r of inUse) {
      const c = code.get(r.key);
      if (c !== undefined) pieces.push({ key: r.key, kind: r.kind, target: r.targetName, block: r.block, code: c });
    }
    const used = new Set(pieces.map((p) => p.key));
    for (const p of cache.values()) if (!used.has(p.key) && pieces.length < used.size + 100) pieces.push(p);
    return pieces;
  };

  const game: CompiledGame = {
    createdAt: Date.now(),
    model: transport ? (transport.via === 'chatgpt' ? CHATGPT_MODEL_NAME : settings.model) : (previous?.model ?? ''),
    mode: '2d',
    inputHash: inputHash(project),
    summary: '',
    // A game made from the game: line says how it's played and what it's called (kept while that game stays).
    howToPlay: newGame ? String(reply?.howToPlay ?? '').trim().slice(0, 200) : hasGame ? (previous?.howToPlay ?? '') : '',
    ...(newGame && String(reply?.title ?? '').trim() ? { title: String(reply?.title).trim().slice(0, 60) } : hasGame && previous?.title ? { title: previous.title } : {}),
    warnings: [],
    code: assemble(),
    sprites,
    // (Placeholders, for the trial run, while the art is being made.)
    assets: [...kept, ...jobs.map((j) => placeholderAsset(j)), ...moreJobs.map((j) => placeholderAsset(j))],
    pieces: keepPieces(),
    // What the words and the art were last made to fit (kept as it was when that had to wait).
    brief: request && opts.offline && previous?.brief !== undefined ? previous.brief : brief,
    style: opts.offline && previous?.style !== undefined ? previous.style : style,
    revised,
    questions,
    issues: plans.flatMap((p) => p.issues.map((i) => ({ targetId: p.targetId, ...i }))),
    ...(opts.offline && remake.length ? { remake } : {}),
  };

  // The harness's trial run: the game plays for a few seconds, hidden, and what goes wrong is fixed now.
  // It runs while the last of the art is made (with placeholders by the same names: it tries the code).
  // (A quick change gets its own, usually none: it should take seconds.)
  const trial = tasks.some((t) => t.request.kind === 'game') ? harness().trialRun : harness().tweakTrial;
  const tried = (async () => {
    if (!(trial > 0 && reply && transport && !opts.offline)) return;
    opts.onProgress?.({ stage: 'checking', message: 'Trying the game' });
    const found = await trialRun({ ...project, compiled: { ...game, code: [...game.code] } }, trial, opts.signal);
    if (!found.length) return;
    try {
      await fixCode(found, project, tasks, code, sprites, spriteSource, transport, settings, opts, warnings);
      game.code = assemble();
      game.pieces = keepPieces();
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      warnings.push(`Couldn't fix what the trial run found (${(err as Error).message}).`);
    }
  })();
  const [art] = await Promise.all([allArt(), tried]);
  game.assets = art;
  game.warnings = [...new Set(warnings)];

  opts.onProgress?.({ stage: 'done', message: 'Done' });
  return game;
}
