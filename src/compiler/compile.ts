import { AiError, CHATGPT_MODEL_NAME, chatJson, effectiveSettings, resolveTransport, type AiSettings, type Transport } from './openai';
import { fetchCodexStatus } from './chatgpt';
import { classNameFor, classNames, piecesSystemPrompt, piecesUserPrompt, type PieceTask } from './prompt';
import { planTarget, type PieceRequest, type TargetPlan } from './codegen';
import { checkPiece } from './pieces';
import { serializeBlocks } from './serialize';
import { PIECES_SCHEMA, type AssetRequest, type PiecesReply } from './schema';
import { instrumentTargetCode } from './transform';
import { generateAsset, placeholderAsset, type AssetJob } from './assets';
import { hashString, uid } from '../project/ids';
import type { CompiledAsset, CompiledCode, CompiledGame, CompiledPiece, CompiledSprite, Project, WorldMode } from '../project/types';

export type CompileStage = 'preparing' | 'thinking' | 'writing' | 'checking' | 'repairing' | 'assets' | 'done';

export interface CompileProgress {
  stage: CompileStage;
  message: string;
  chars?: number;
  assetsDone?: number;
  assetsTotal?: number;
}

export interface CompileOptions {
  settings: AiSettings;
  signal?: AbortSignal;
  onProgress?(p: CompileProgress): void;
  /** "Fix": problems from the last run. The pieces of the sprites they mention are written again. */
  fixProblems?: string[];
  /** Write every piece again (and drop compiled characters). */
  fresh?: boolean;
  /**
   * Compile without a compile request: exact blocks as usual, and words that aren't compiled
   * yet do nothing for now (with a warning). For playing when there's no account.
   */
  offline?: boolean;
}

/** Thrown when words need compiling and there's no ChatGPT sign-in or API key. */
export const NO_ACCOUNT = 'no_account';

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
  return hashString(JSON.stringify({ m: project.mode, t: project.title, n: project.notes, v: project.variables ?? [], s: t(project.stage), sp: project.sprites.map(t) }));
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

/**
 * Does compiling need a compile request? Only new or changed words do. Otherwise compiling is
 * instant and works offline (no key or sign-in needed).
 */
export function compileNeedsRequest(project: Project): boolean {
  if (project.compiled && !project.compiled.pieces) return piecesInUse(planProject(project)).length > 0;
  const known = new Set((project.compiled?.pieces ?? []).map((p) => p.key));
  return piecesInUse(planProject(project)).some((r) => !known.has(r.key));
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
}

/** One compile request for the new pieces (and a second one only for pieces that didn't check out). */
async function writePieces(
  project: Project,
  plans: TargetPlan[],
  tasks: PieceTask[],
  written: ReadonlyMap<string, CompiledPiece>,
  transport: Transport,
  settings: AiSettings,
  opts: CompileOptions,
  warnings: string[],
): Promise<Written> {
  const system = piecesSystemPrompt(project.mode);
  const user = piecesUserPrompt({ project, plans, tasks, written, problems: opts.fixProblems });
  const ask = (prompt: string) =>
    chatJson<PiecesReply>(transport, {
      model: settings.model,
      system,
      user: prompt,
      schema: PIECES_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'amble_pieces',
      reasoningEffort: settings.reasoningEffort,
      signal: opts.signal,
      onProgress: (p) =>
        opts.onProgress?.(
          p.phase === 'waiting'
            ? { stage: 'thinking', message: `Compiling ${tasks.length} block${tasks.length > 1 ? 's' : ''} written in words` }
            : { stage: 'writing', message: 'Compiling', chars: p.chars },
        ),
    });

  const code = new Map<string, string>();
  const check = (reply: PiecesReply, which: PieceTask[]): Array<{ task: PieceTask; error: string }> => {
    const byId = new Map((reply.pieces ?? []).map((p) => [String(p.id).trim(), String(p.code ?? '')]));
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

  const reply = await ask(user);
  opts.onProgress?.({ stage: 'checking', message: 'Checking the code' });
  let failed = check(reply, tasks);
  if (failed.length) {
    opts.onProgress?.({ stage: 'repairing', message: `Fixing ${failed.length} block${failed.length > 1 ? 's' : ''}` });
    const again = `${user}\n\n## Your previous code for these pieces didn't work\n${failed.map((f) => `- ${f.task.id}: ${f.error}`).join('\n')}\n\nReply again with only these pieces: ${failed.map((f) => f.task.id).join(', ')} (sprites and assets can be empty).`;
    const second = await ask(again);
    failed = check(second, failed.map((f) => f.task));
    reply.warnings = [...(reply.warnings ?? []), ...(second.warnings ?? [])];
  }
  for (const f of failed) warnings.push(`${f.task.request.targetName}: couldn't compile "${f.task.request.block}" (${f.error}). It does nothing for now.`);
  return { code, reply };
}

function assetGroup(kind: string): 'image' | 'model' | 'sound' {
  return kind === 'sound' ? 'sound' : kind === 'model' ? 'model' : 'image';
}

/** Earlier compiled assets stay (cached pieces may use them). New requests become jobs. */
function planAssets(
  project: Project,
  requests: AssetRequest[],
  sprites: CompiledSprite[],
  previous: CompiledAsset[],
  warnings: string[],
): { kept: CompiledAsset[]; jobs: AssetJob[] } {
  const mode: WorldMode = project.mode;
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
    if (!name || !['costume', 'backdrop', 'model', 'sound'].includes(a.kind)) continue;
    if (a.kind === 'model' && mode !== '3d') {
      warnings.push(`Skipped 3D model "${name}" (this is a 2D project).`);
      continue;
    }
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
        kind: mode === '3d' ? 'model' : 'costume',
        name: s.name.toLowerCase(),
        description: s.description || s.name,
        width: mode === '3d' ? 1 : 64,
        height: mode === '3d' ? 1 : 64,
      });
    }
  }
  return { kept, jobs };
}

async function runJobs(jobs: AssetJob[], project: Project, transport: Transport, settings: AiSettings, opts: CompileOptions, warnings: string[]): Promise<CompiledAsset[]> {
  const results: CompiledAsset[] = [];
  let done = 0;
  const report = (current?: string) =>
    opts.onProgress?.({ stage: 'assets', message: current ? `Making ${current}` : 'Making art and sounds', assetsDone: done, assetsTotal: jobs.length });
  report();
  const queue = [...jobs];
  const style = [project.notes, ...serializeBlocks(project.stage.blocks).text.split('\n').filter((l) => l.startsWith('art style:'))].join(' ').slice(0, 300);
  const worker = async () => {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      report(`${job.kind} "${job.name}"`);
      try {
        results.push(await generateAsset(job, { transport, settings, mode: project.mode, gameTitle: project.title, styleHint: style, signal: opts.signal }));
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        warnings.push(`Couldn't make ${job.kind} "${job.name}" (${(err as Error).message}); used a placeholder.`);
        results.push(placeholderAsset(job, project.mode));
      }
      done++;
      report();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return jobs.map((j) => results.find((r) => r.targetId === j.targetId && r.name === j.name)!).filter(Boolean);
}

/**
 * Compiles the project. Amble compiles every block itself; only words that are new (or, with
 * Fix, the words of the sprites that had problems) go out in one compile request. Everything
 * else is reused from the last compile, so unchanged blocks give exactly the same game.
 */
export async function compileProject(project: Project, options: CompileOptions): Promise<CompiledGame> {
  let opts = options;
  opts.onProgress?.({ stage: 'preparing', message: 'Reading your blocks' });
  const previous = project.compiled;
  // Games compiled before pieces existed start over.
  const fresh = Boolean(opts.fresh || (previous && !previous.pieces));
  const plans = planProject(project);
  const warnings: string[] = plans.flatMap((p) => p.warnings);
  const cache = new Map<string, CompiledPiece>(fresh ? [] : (previous?.pieces ?? []).map((p) => [p.key, p]));
  const inUse = piecesInUse(plans);

  const redo = opts.fixProblems?.length ? targetsInProblems(plans, opts.fixProblems) : null;
  const tasks: PieceTask[] = [];
  for (const r of inUse) {
    if (!cache.has(r.key) || redo?.has(r.targetName)) tasks.push({ id: `p${tasks.length + 1}`, request: r });
  }

  let transport: Transport | null = null;
  let settings = opts.settings;
  let reply: PiecesReply | null = null;
  const code = new Map<string, string>([...cache].map(([k, p]) => [k, p.code]));
  if (tasks.length && opts.offline) {
    const words = tasks.filter((t) => !cache.has(t.request.key)).length;
    if (words) warnings.push(`${words} block${words > 1 ? 's' : ''} in your own words ${words > 1 ? "aren't" : "isn't"} compiled yet, so ${words > 1 ? 'they do' : 'it does'} nothing for now. Sign in with ChatGPT or add an OpenAI API key in Settings, then press Compile.`);
  } else if (tasks.length) {
    transport = await requireTransport(opts.settings);
    settings = effectiveSettings(opts.settings, transport);
    opts = { ...opts, settings };
    const result = await writePieces(project, plans, tasks, cache, transport, settings, opts, warnings);
    reply = result.reply;
    for (const [k, c] of result.code) code.set(k, c);
    for (const w of reply.warnings ?? []) warnings.push(String(w));
  }

  // Characters added by the compiler: earlier ones stay with their code; new ones join.
  const userNames = new Set(project.sprites.map((s) => s.name));
  const sprites: CompiledSprite[] = [];
  const spriteSource = new Map<string, string>();
  if (!fresh) {
    for (const s of previous?.sprites ?? []) {
      if (userNames.has(s.name)) continue;
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
      z: project.mode === '3d' ? Number(s.z) || 0 : 0,
      size: Number(s.size) > 0 ? Number(s.size) : 100,
      direction: Number(s.direction) || 0,
      visible: s.visible !== false,
      rotationStyle: 'all around',
    };
    if (existing >= 0) sprites[existing] = sprite;
    else sprites.push(sprite);
    spriteSource.set(sprite.id, String(s.code ?? ''));
  }

  const { kept, jobs } = planAssets(project, reply?.assets ?? [], sprites, fresh ? [] : (previous?.assets ?? []), warnings);
  let made: CompiledAsset[] = [];
  if (jobs.length && opts.offline && !transport) {
    made = jobs.map((j) => placeholderAsset(j, project.mode));
  } else if (jobs.length) {
    transport ??= await requireTransport(opts.settings);
    made = await runJobs(jobs, project, transport, settings, opts, warnings);
  }

  // Put the classes together and make them safe to run.
  opts.onProgress?.({ stage: 'checking', message: 'Putting the game together' });
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

  // Keep the pieces in use, then earlier ones (so undoing an edit compiles instantly again).
  const pieces: CompiledPiece[] = [];
  for (const r of inUse) {
    const c = code.get(r.key);
    if (c !== undefined) pieces.push({ key: r.key, kind: r.kind, target: r.targetName, block: r.block, code: c });
  }
  const used = new Set(pieces.map((p) => p.key));
  for (const p of cache.values()) if (!used.has(p.key) && pieces.length < used.size + 100) pieces.push(p);

  opts.onProgress?.({ stage: 'done', message: 'Done' });
  return {
    createdAt: Date.now(),
    model: transport ? (transport.via === 'chatgpt' ? CHATGPT_MODEL_NAME : settings.model) : (previous?.model ?? ''),
    mode: project.mode,
    inputHash: inputHash(project),
    summary: '',
    howToPlay: '',
    warnings: [...new Set(warnings)],
    code: entries,
    sprites,
    assets: [...kept, ...made],
    pieces,
  };
}
