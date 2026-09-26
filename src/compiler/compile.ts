import { AiError, CHATGPT_MODEL_NAME, chatJson, effectiveSettings, resolveTransport, type AiSettings, type Transport } from './openai';
import { fetchCodexStatus } from './chatgpt';
import { buildUserPrompt, classNameFor, classNames, systemPrompt, type FixContext } from './prompt';
import { COMPILE_SCHEMA, type CompileReply } from './schema';
import { instrumentTargetCode } from './transform';
import { generateAsset, placeholderAsset, type AssetJob } from './assets';
import { hashString, uid } from '../project/ids';
import type { CompiledAsset, CompiledCode, CompiledGame, CompiledSprite, Project, WorldMode } from '../project/types';

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
  /** "Fix with AI": problems from the last run to address. */
  fixProblems?: string[];
}

/** Everything the compiler reads from a project; changes here mean the game needs recompiling. */
export function inputHash(project: Project): string {
  const t = (x: Project['stage'] | Project['sprites'][number]) => ({
    n: x.name,
    d: x.description,
    b: x.blocks,
    c: x.costumes.map((c) => [c.name, c.kind, c.kind === 'image' ? [c.width, c.height] : 0]),
    s: x.sounds.map((s) => s.name),
    p: x.kind === 'sprite' ? [x.x, x.y, x.z, x.size, x.direction, x.visible, x.rotationStyle] : 0,
  });
  return hashString(JSON.stringify({ m: project.mode, t: project.title, n: project.notes, s: t(project.stage), sp: project.sprites.map(t) }));
}

interface Checked {
  code: CompiledCode[];
  sprites: CompiledSprite[];
  errors: string[];
  warnings: string[];
}

/** Maps the AI's reply onto the project: resolves targets, validates and instruments code. */
function checkReply(project: Project, reply: CompileReply, names: Map<string, string>): Checked {
  const errors: string[] = [];
  const warnings: string[] = [];
  const userNames = new Set(project.sprites.map((s) => s.name));
  const previous = new Map((project.compiled?.sprites ?? []).map((s) => [s.name, s]));

  // New sprites (ids stay stable across builds when names match).
  const sprites: CompiledSprite[] = [];
  for (const s of reply.sprites ?? []) {
    const name = String(s.name ?? '').trim();
    if (!name) continue;
    if (userNames.has(name)) {
      warnings.push(`Ignored new sprite "${name}" because you already have a sprite with that name.`);
      continue;
    }
    if (name.toLowerCase() === 'stage' || sprites.some((x) => x.name === name)) continue;
    sprites.push({
      id: previous.get(name)?.id ?? uid('s'),
      name,
      description: String(s.description ?? ''),
      x: Number(s.x) || 0,
      y: Number(s.y) || 0,
      z: project.mode === '3d' ? Number(s.z) || 0 : 0,
      size: Number(s.size) > 0 ? Number(s.size) : 100,
      direction: Number(s.direction) || 0,
      visible: s.visible !== false,
      rotationStyle: 'all around',
    });
  }

  const taken = new Set(names.values());
  const code: CompiledCode[] = [];
  for (const entry of reply.code ?? []) {
    const targetName = String(entry.target ?? '').trim();
    let targetId: string | null = null;
    let kind: 'stage' | 'sprite' = 'sprite';
    if (targetName.toLowerCase() === 'stage' || targetName === project.stage.name) {
      targetId = project.stage.id;
      kind = 'stage';
    } else {
      targetId = project.sprites.find((s) => s.name === targetName)?.id ?? sprites.find((s) => s.name === targetName)?.id ?? null;
    }
    if (!targetId) {
      warnings.push(`Ignored code for "${targetName}" (no sprite with that name).`);
      continue;
    }
    if (code.some((c) => c.targetId === targetId)) {
      warnings.push(`Ignored a second code entry for "${targetName}".`);
      continue;
    }
    if (!names.has(targetId)) {
      const name = classNameFor(targetName, taken);
      taken.add(name);
      names.set(targetId, name);
    }
    const source = String(entry.source ?? '');
    const result = instrumentTargetCode(source, kind);
    for (const e of result.errors) errors.push(`${targetName}: ${e}`);
    for (const w of result.warnings) warnings.push(`${targetName}: ${w}`);
    code.push({
      targetId,
      targetName: kind === 'stage' ? project.stage.name : targetName,
      className: result.className ?? names.get(targetId)!,
      source,
      runSource: result.runSource,
    });
  }
  for (const s of sprites) {
    if (!code.some((c) => c.targetId === s.id)) warnings.push(`New sprite "${s.name}" has no code, so it will just sit there.`);
  }
  return { code, sprites, errors, warnings };
}

function assetGroup(kind: string): 'image' | 'model' | 'sound' {
  return kind === 'sound' ? 'sound' : kind === 'model' ? 'model' : 'image';
}

/** Turns asset requests into jobs, reusing previous compiled assets where possible. */
function planAssets(
  project: Project,
  reply: CompileReply,
  sprites: CompiledSprite[],
  warnings: string[],
): { reused: CompiledAsset[]; jobs: AssetJob[] } {
  const previous = project.compiled?.assets ?? [];
  const reused: CompiledAsset[] = [];
  const jobs: AssetJob[] = [];
  const seen = new Set<string>();
  const mode: WorldMode = project.mode;

  const resolveTarget = (name: string): { id: string; name: string; user: Project['stage'] | Project['sprites'][number] | null } | null => {
    if (name.toLowerCase() === 'stage' || name === project.stage.name) return { id: project.stage.id, name: project.stage.name, user: project.stage };
    const user = project.sprites.find((s) => s.name === name);
    if (user) return { id: user.id, name: user.name, user };
    const added = sprites.find((s) => s.name === name);
    if (added) return { id: added.id, name: added.name, user: null };
    return null;
  };

  for (const a of reply.assets ?? []) {
    const name = String(a.name ?? '').trim();
    const kind = a.kind;
    if (!name || !['costume', 'backdrop', 'model', 'sound'].includes(kind)) continue;
    if (kind === 'model' && mode !== '3d') {
      warnings.push(`Skipped 3D model "${name}" (this is a 2D project).`);
      continue;
    }
    const target = resolveTarget(String(a.target ?? '').trim());
    if (!target) {
      warnings.push(`Skipped asset "${name}" for unknown sprite "${a.target}".`);
      continue;
    }
    const group = assetGroup(kind);
    const key = `${target.id}|${group}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // The author's own asset with this name wins.
    if (target.user) {
      const list = group === 'sound' ? target.user.sounds : target.user.costumes;
      if (list.some((x) => x.name === name)) continue;
    }
    const old = previous.find(
      (p) => (p.targetId === target.id || p.targetName === target.name) && assetGroup(p.kind === 'image' ? 'costume' : p.kind) === group && p.name === name,
    );
    const description = String(a.description ?? '').trim() || name;
    if (old && (a.reuse || old.request === description)) {
      reused.push({ ...old, targetId: target.id, targetName: target.name });
      continue;
    }
    jobs.push({
      targetId: target.id,
      targetName: target.name,
      kind,
      name,
      description,
      width: Number(a.width) || 0,
      height: Number(a.height) || 0,
    });
  }

  // Every added sprite needs something to look like.
  for (const s of sprites) {
    const has = [...reused, ...jobs].some((x) => x.targetId === s.id && ('kind' in x ? x.kind !== 'sound' : true));
    if (!has) {
      warnings.push(`Added a costume for "${s.name}" (the build forgot one).`);
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
  return { reused, jobs };
}

async function runJobs(
  jobs: AssetJob[],
  project: Project,
  transport: Transport,
  opts: CompileOptions,
  warnings: string[],
): Promise<CompiledAsset[]> {
  const results: CompiledAsset[] = [];
  let done = 0;
  const report = (current?: string) =>
    opts.onProgress?.({
      stage: 'assets',
      message: current ? `Making ${current}` : 'Making assets',
      assetsDone: done,
      assetsTotal: jobs.length,
    });
  report();
  const queue = [...jobs];
  const styleHint = project.notes.slice(0, 300);
  const worker = async () => {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      report(`${job.kind} "${job.name}"`);
      try {
        results.push(
          await generateAsset(job, {
            transport,
            settings: opts.settings,
            mode: project.mode,
            gameTitle: project.title,
            styleHint,
            signal: opts.signal,
          }),
        );
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
  // Keep a stable order: same order as requested.
  return jobs.map((j) => results.find((r) => r.targetId === j.targetId && r.name === j.name)!).filter(Boolean);
}

/** Compiles the project's blocks into a game with the configured model (GPT-6 Astra Light when signed in with ChatGPT). */
export async function compileProject(project: Project, options: CompileOptions): Promise<CompiledGame> {
  const transport = await resolveTransport(options.settings);
  if (!transport) {
    throw new AiError(
      (await fetchCodexStatus())
        ? 'Sign in with ChatGPT, or add an OpenAI API key in Settings, to compile.'
        : 'Add your OpenAI API key in Settings (or set OPENAI_API_KEY for the dev server) to compile.',
    );
  }
  const opts = { ...options, settings: effectiveSettings(options.settings, transport) };
  const { settings } = opts;

  opts.onProgress?.({ stage: 'preparing', message: 'Reading your blocks' });
  const names = classNames(project);
  let fix: FixContext | undefined;
  if (opts.fixProblems?.length && project.compiled) {
    fix = { problems: opts.fixProblems, previous: project.compiled.code.map((c) => ({ target: c.targetName, source: c.source })) };
  }
  const system = systemPrompt(project.mode);
  const user = buildUserPrompt(project, names, fix);

  const ask = (prompt: string) =>
    chatJson<CompileReply>(transport, {
      model: settings.model,
      system,
      user: prompt,
      schema: COMPILE_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'amble_game',
      reasoningEffort: settings.reasoningEffort,
      signal: opts.signal,
      onProgress: (p) =>
        opts.onProgress?.(
          p.phase === 'waiting'
            ? { stage: 'thinking', message: 'Thinking about your game' }
            : { stage: 'writing', message: 'Writing the game code', chars: p.chars },
        ),
    });

  let reply = await ask(user);
  opts.onProgress?.({ stage: 'checking', message: 'Checking the code' });
  let checked = checkReply(project, reply, new Map(names));

  if (checked.errors.length) {
    opts.onProgress?.({ stage: 'repairing', message: `Fixing ${checked.errors.length} problem${checked.errors.length > 1 ? 's' : ''}` });
    const repair = `${user}\n\n## Your previous reply had problems\n${checked.errors.map((e) => `- ${e}`).join('\n')}\n\n## Your previous code\n${checked.code
      .map((c) => `### ${c.targetName}\n\`\`\`js\n${c.source}\n\`\`\``)
      .join('\n')}\n\nReply again with the complete, corrected result.`;
    reply = await ask(repair);
    checked = checkReply(project, reply, new Map(names));
  }

  const warnings = [...checked.warnings, ...(reply.warnings ?? []).map(String)];
  for (const e of checked.errors) warnings.unshift(`Not fixed: ${e}`);
  const { reused, jobs } = planAssets(project, reply, checked.sprites, warnings);
  const made = jobs.length ? await runJobs(jobs, project, transport, opts, warnings) : [];

  opts.onProgress?.({ stage: 'done', message: 'Done' });
  return {
    createdAt: Date.now(),
    model: transport.via === 'chatgpt' ? `${CHATGPT_MODEL_NAME} (ChatGPT)` : settings.model,
    mode: project.mode,
    inputHash: inputHash(project),
    summary: String(reply.summary ?? ''),
    howToPlay: String(reply.howToPlay ?? ''),
    warnings,
    code: checked.code.filter((c) => !checked.errors.some((e) => e.startsWith(`${c.targetName}:`))),
    sprites: checked.sprites,
    assets: [...reused, ...made],
  };
}
