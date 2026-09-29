/**
 * The per-file rules, ported from the games probe (games-probe/tools/validate.mjs) and extended:
 * Phaser 2 and removed 3.60 APIs, `this` lost in callbacks, URL loads, display sprites used as
 * bodies, objects made every frame, restarts every frame, kit names overwritten, hallucinated kit
 * calls, infinite loops, and the forbidden APIs (network, eval, storage, the page around the game).
 * The sandbox is the real boundary; these are defense in depth and early, readable feedback.
 */
import type { AnyNode, CallExpression, Expression, FunctionExpression, SpreadElement } from 'acorn';
import { ancestor, simple } from 'acorn-walk';
import { hasExit, memberPath, propertyName, src, thisIsScene, usesArguments, usesThis } from './ast';
import type { FileContext } from './context';
import { closest, PHASER_SCENE_MEMBERS } from './manifest';

const CREATORS = /^(add|physics\.add|matter\.add)\.(sprite|image|text|tileSprite|container|particles|rectangle|circle|graphics|group|staticGroup)$/;

const V2: Array<[RegExp, string]> = [
  [/^(this\.)?game\.(add|physics|time|input|world|state|load|stage|camera)\b/, 'Phaser 2 API (`game.add`, `game.physics` ...). In Phaser 3 use `this.add`, `this.physics`, `this.time` inside the scene.'],
  [/\bPhaser\.Physics\.ARCADE\b|\bphysics\.startSystem\b|\bphysics\.arcade\.(enable|collide|overlap|gravity)\b/, 'Phaser 2 physics. Phaser 3: `this.physics.add.sprite(...)`, `this.physics.add.collider(a, b, cb)`.'],
  [/\btime\.events\b|\bPhaser\.Timer\b/, 'Phaser 2 timers. Use `this.after(ms, fn)` / `this.every(ms, fn)` (or `this.time.delayedCall`).'],
  [/\badd\.tween\b/, 'Phaser 2 tween. Use `this.tweens.add({ targets, ...props, duration })`.'],
  [/\.animations\.add\b|\.anchor\.(setTo|set)\b|\.events\.onInputDown\b|\boutOfBoundsKill\b|\bcheckWorldBounds\b|\bPhaser\.Keyboard\b|\bgame\.state\b/, 'Phaser 2 API. Phaser 3: `setOrigin`, `this.anims.create`, `obj.setInteractive().on("pointerdown")`, `this.input.keyboard`.'],
];

const REMOVED: Array<[RegExp, string]> = [
  [/\btweens\.timeline\b/, '`this.tweens.timeline()` was removed in Phaser 3.60. Use `this.tweens.chain({ targets, tweens: [...] })`.'],
  [/\.createEmitter\b/, '`particles.createEmitter()` was removed in 3.60. Use `this.add.particles(x, y, key, config)` (or `this.fx.burst`).'],
  [/\bsetRenderToTexture\b|\brenderer\.addPipeline\b/, 'Removed rendering API. Use `camera.postFX` / `this.fx.*`.'],
  [/\bPhysics\.Impact\b|\bthis\.impact\b/, 'Impact physics was removed from Phaser 3. Use Arcade or Matter.'],
];

/** Globals that reach the network or run strings as code. */
const NETWORK = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'importScripts', 'Worker', 'SharedWorker', 'eval']);
/** Globals for storage and for the page around the game. */
const STORAGE = new Set(['localStorage', 'sessionStorage', 'indexedDB', 'caches', 'parent', 'top', 'opener', 'frames']);
/** Globals that message or open other pages. */
const ESCAPE = new Set(['postMessage', 'BroadcastChannel']);
const NETWORK_PATHS = ['navigator.sendBeacon', 'navigator.serviceWorker'];
const STORAGE_PATHS = ['document.cookie'];
const ESCAPE_PATHS = ['document.domain', 'document.write', 'document.writeln', 'document.open'];
const ESCAPE_TAGS = new Set(['script', 'iframe', 'frame', 'form', 'link', 'object', 'embed', 'meta', 'base', 'a']);

/** `window.fetch` -> `fetch`: names reached through the global object. */
function globalPath(path: string): string {
  return path.replace(/^((window|globalThis|self)\.)+/, '');
}

function isNavigation(path: string): boolean {
  const g = globalPath(path);
  return g === 'location' || g.startsWith('location.') || g === 'document.location' || g.startsWith('document.location.');
}

function strLiteral(n: Expression | SpreadElement | undefined): string | null {
  return n?.type === 'Literal' && typeof n.value === 'string' ? n.value : null;
}

function security(ctx: FileContext): void {
  const declared = ctx.facts.declared;
  const allowed = (name: string) => ctx.api.globals.has(name);
  /** Reports a forbidden global: `g` is the name without `window.` (for the lists), `name` as written. */
  const flag = (node: AnyNode, g: string, name = g) => {
    const first = g.split('.')[0];
    const under = (paths: string[]) => paths.some((p) => g === p || g.startsWith(`${p}.`));
    if (NETWORK.has(first) || under(NETWORK_PATHS)) {
      ctx.add('error', 'no-network-or-eval', node, `\`${name}\` is not allowed in games: no network and no running strings as code. Remove it.`, { name });
    } else if ((STORAGE.has(first) && !allowed(first)) || under(STORAGE_PATHS)) {
      ctx.add('error', 'no-storage-or-parent', node, `\`${name}\` is not available to games: they keep to their own sandbox. Remove it.`, { name });
    } else if (ESCAPE.has(first) || first === 'open' || under(ESCAPE_PATHS)) {
      ctx.add('error', 'no-escape', node, `\`${name}\` is not allowed: games can't open pages, navigate, or message the page around them.`, { name });
    }
  };

  ancestor(ctx.ast, {
    Identifier(n, _s, anc) {
      if (declared.has(n.name)) return;
      if (NETWORK.has(n.name) || STORAGE.has(n.name) || ESCAPE.has(n.name)) flag(n, n.name);
      const parent = anc[anc.length - 2];
      if (n.name === 'open' && parent?.type === 'CallExpression' && parent.callee === n) flag(n, 'open');
    },
    MemberExpression(n) {
      const path = memberPath(n);
      if (!path) return;
      const root = path.split('.')[0];
      if (root !== 'this' && !declared.has(root)) {
        const g = globalPath(path);
        // Reached through the global object (`window.fetch`), or a forbidden path (`document.cookie`).
        if (g !== path && !g.includes('.')) flag(n, g, path);
        else if ([...NETWORK_PATHS, ...STORAGE_PATHS, ...ESCAPE_PATHS].includes(g)) flag(n, g, path);
      }
      const prop = propertyName(n);
      if (prop === 'postMessage' || prop === 'contentWindow' || prop === 'contentDocument') {
        ctx.add('error', 'no-escape', n, `\`.${prop}\` is not allowed: games can't message or reach other pages.`, { name: prop });
      }
    },
    CallExpression(n) {
      const callee = memberPath(n.callee);
      const g = globalPath(callee);
      if (g === 'Function' && !declared.has('Function')) ctx.add('error', 'no-network-or-eval', n, '`Function(...)` runs a string as code, which games can\'t do.', { name: 'Function' });
      if ((g === 'setTimeout' || g === 'setInterval') && (strLiteral(n.arguments[0]) !== null || n.arguments[0]?.type === 'TemplateLiteral')) {
        ctx.add('error', 'no-network-or-eval', n, `\`${g}\` with a string runs it as code. Pass a function: \`this.after(ms, () => { ... })\`.`, { name: g });
      }
      if (/(^|\.)document\.createElement$/.test(callee) && ESCAPE_TAGS.has((strLiteral(n.arguments[0]) ?? '').toLowerCase())) {
        ctx.add('error', 'no-escape', n, `Games can't create <${strLiteral(n.arguments[0])}> elements. Draw everything in the game with Phaser.`, { name: `<${strLiteral(n.arguments[0])}>` });
      }
      if (propertyName(n.callee) === 'insertAdjacentHTML') ctx.add('error', 'no-escape', n, 'Games can\'t add HTML to the page. Use `this.ui.*` or `this.add.text`.', { name: 'insertAdjacentHTML' });
      if (isNavigation(callee.replace(/\.(assign|replace|reload)$/, '')) && /\.(assign|replace|reload)$/.test(callee)) {
        ctx.add('error', 'no-escape', n, `\`${callee}\` navigates away from the game, which isn't allowed.`, { name: callee });
      }
    },
    NewExpression(n) {
      if (memberPath(n.callee) === 'Function' && !declared.has('Function')) ctx.add('error', 'no-network-or-eval', n, '`new Function` runs a string as code, which games can\'t do.', { name: 'new Function' });
    },
    ImportExpression(n) {
      ctx.add('error', 'no-network-or-eval', n, 'Dynamic `import()` is not allowed in games: it loads code from the network.', { name: 'import()' });
    },
    AssignmentExpression(n) {
      const left = memberPath(n.left);
      if (left && isNavigation(left) && !declared.has(left.split('.')[0])) {
        ctx.add('error', 'no-escape', n, `Assigning \`${left}\` navigates away from the game, which isn't allowed.`, { name: left });
      }
      const prop = propertyName(n.left);
      if (prop === 'innerHTML' || prop === 'outerHTML') ctx.add('error', 'no-escape', n, `Games can't set \`${prop}\`: draw in the game with Phaser, and use \`this.ui.*\` for text.`, { name: prop });
    },
  });
}

/** A `function () {}` callback that uses `this` becomes an arrow function (unless it needs `arguments`). */
function arrowFix(ctx: FileContext, fn: FunctionExpression): void {
  ctx.add('warning', 'this-in-callback', fn, 'A `function () {}` callback loses `this` (the scene). Use an arrow function `() => {}`.', { fixed: ctx.fix });
  const params = fn.params.map((p) => src(ctx.code, p)).join(', ');
  ctx.applyFix('this-in-callback', fn, `function -> arrow at line ${fn.loc?.start.line ?? 0}`, () => ctx.ms.overwrite(fn.start, fn.body.start, `${fn.async ? 'async ' : ''}(${params}) => `));
}

function isSceneCall(n: CallExpression, anc: readonly AnyNode[], ctx: FileContext): boolean {
  return memberPath(n.callee).startsWith('this.') && thisIsScene(anc, ctx.sceneClasses);
}

/** Art keys a call uses, by the kit's and Phaser's argument positions. */
function artKeys(ctx: FileContext, n: CallExpression, callee: string): void {
  const used = ctx.facts.artUsed;
  const add = (arg: Expression | SpreadElement | undefined) => {
    const key = strLiteral(arg);
    if (key) used.add(key);
  };
  if (/^this\.(add|physics\.add)\.(sprite|image)$/.test(callee)) add(n.arguments[2]);
  if (callee === 'this.add.tileSprite') add(n.arguments[4]);
  if (callee === 'this.art') add(n.arguments[0]);
  if (callee === 'this.platform') add(n.arguments[4]);
  if (/^this\.(spawn|spawnHero|spawnEnemy|ragdoll)$/.test(callee) && strLiteral(n.arguments[0]) === null) add(n.arguments[2]);
  if (callee === 'this.level') {
    const opts = n.arguments[1];
    const legend = opts?.type === 'ObjectExpression' ? opts.properties.find((p) => p.type === 'Property' && !p.computed && p.key.type === 'Identifier' && p.key.name === 'legend') : undefined;
    if (legend?.type === 'Property' && legend.value.type === 'ObjectExpression') {
      for (const p of legend.value.properties) {
        if (p.type !== 'Property') continue;
        if (strLiteral(p.value)) used.add(strLiteral(p.value) as string);
        if (p.value.type === 'ObjectExpression') for (const q of p.value.properties) if (q.type === 'Property' && !q.computed && q.key.type === 'Identifier' && q.key.name === 'key') add(q.value);
      }
    }
  }
}

/** A call into the kit: a scene method, a kit namespace member, or a behaviour on a kit object. */
export function isKitCallee(ctx: FileContext, n: CallExpression): boolean {
  const callee = memberPath(n.callee);
  const m1 = /^this\.(\w+)$/.exec(callee);
  const m2 = /^this\.(\w+)\.(\w+)$/.exec(callee);
  return Boolean((m1 && ctx.api.sceneMethods.has(m1[1])) || (m2 && ctx.api.namespaces.has(m2[1])) || ctx.api.actorMethods.has(propertyName(n.callee)));
}

/** `{ key: 'shot' }` in the options of kit calls names art too. */
function optionKeys(ctx: FileContext, n: CallExpression): void {
  if (!isKitCallee(ctx, n)) return;
  for (const arg of n.arguments) {
    if (arg.type !== 'ObjectExpression') continue;
    for (const p of arg.properties) if (p.type === 'Property' && !p.computed && p.key.type === 'Identifier' && p.key.name === 'key' && strLiteral(p.value)) ctx.facts.artUsed.add(strLiteral(p.value) as string);
  }
}

function kitCalls(ctx: FileContext, n: CallExpression, anc: readonly AnyNode[], callee: string): void {
  const api = ctx.api;
  const own = ctx.facts.own;
  if (!isSceneCall(n, anc, ctx)) return;
  const m1 = /^this\.(\w+)$/.exec(callee);
  if (m1 && api.sceneMethods.size > 0 && !api.sceneMethods.has(m1[1]) && !PHASER_SCENE_MEMBERS.includes(m1[1]) && !own.has(m1[1])) {
    const sug = closest(m1[1], [...api.sceneMethods, ...own], api.synonyms);
    const confident = sug !== null && api.synonyms[m1[1]] === sug;
    ctx.add('error', 'unknown-api', n, `\`this.${m1[1]}()\` does not exist${sug ? `; did you mean \`this.${sug}()\`?` : '.'}`, { name: `this.${m1[1]}()`, suggestion: sug ? `this.${sug}()` : undefined, fixed: confident && ctx.fix });
    const prop = n.callee.type === 'MemberExpression' ? n.callee.property : null;
    if (confident && prop) ctx.applyFix('unknown-api', n, `this.${m1[1]} -> this.${sug}`, () => ctx.ms.overwrite(prop.start, prop.end, sug as string));
  }
  const m2 = /^this\.(\w+)\.(\w+)$/.exec(callee);
  const members = m2 ? api.namespaces.get(m2[1]) : undefined;
  if (m2 && members && !members.has(m2[2]) && !own.has(m2[1])) {
    const sug = closest(m2[2], members, api.synonyms);
    ctx.add('error', 'unknown-api', n, `\`this.${m2[1]}.${m2[2]}()\` does not exist${sug ? `; did you mean \`this.${m2[1]}.${sug}()\`?` : '.'}`, { name: `this.${m2[1]}.${m2[2]}()`, suggestion: sug ? `this.${m2[1]}.${sug}()` : undefined, fixed: Boolean(sug) && ctx.fix });
    const prop = n.callee.type === 'MemberExpression' ? n.callee.property : null;
    if (sug && prop) ctx.applyFix('unknown-api', n, `this.${m2[1]}.${m2[2]} -> ${sug}`, () => ctx.ms.overwrite(prop.start, prop.end, sug));
  }
}

function probeRules(ctx: FileContext): void {
  const updates = ctx.updateMethods();
  const displayVars = new Map<string, CallExpression>();

  ancestor(ctx.ast, {
    CallExpression(n, _s, anc) {
      const callee = memberPath(n.callee);
      const bare = n.callee.type === 'Identifier' ? n.callee.name : '';
      kitCalls(ctx, n, anc, callee);
      artKeys(ctx, n, callee);
      optionKeys(ctx, n);
      if ((bare === 'setTimeout' || bare === 'setInterval' || bare === 'requestAnimationFrame') && !ctx.facts.declared.has(bare)) {
        ctx.add('warning', 'raw-timers', n, `Use \`this.after(ms, fn)\` / \`this.every(ms, fn)\` instead of ${bare}: they pause with the game, respect slow-mo and stop on restart.`, { name: bare });
      }
      for (const [re, msg] of V2) {
        if (re.test(callee)) {
          ctx.add('error', 'phaser2-api', n, msg);
          break;
        }
      }
      for (const [re, msg] of REMOVED) {
        if (re.test(callee)) {
          ctx.add('error', 'removed-api', n, msg);
          break;
        }
      }
      if (/^(this\.)?load\.(image|spritesheet|atlas|audio|svg|json|tilemapTiledJSON|bitmapFont|multiatlas)$/.test(callee)) {
        const key = strLiteral(n.arguments[0]);
        if (key && !/audio/.test(callee)) ctx.facts.artUsed.add(key);
        const stmt = anc[anc.length - 2];
        const fixable = stmt?.type === 'ExpressionStatement';
        ctx.add('warning', 'load-url', n, `Games cannot load files from URLs.${key ? ` \`${key}\` becomes art the student draws (a stand-in until then).` : ''}`, { name: key ?? undefined, fixed: fixable && ctx.fix });
        if (fixable) ctx.applyFix('load-url', n, `removed load of ${key ?? 'a file'}`, () => ctx.ms.overwrite(stmt.start, stmt.end, `/* ${src(ctx.code, stmt).replace(/\*\//g, '')} (removed: no network) */`));
      }
      if (/^this\.(spawn|spawnHero|spawnEnemy)$/.test(callee)) {
        const key = strLiteral(n.arguments[0]);
        if (key) {
          ctx.facts.artUsed.add(key);
          ctx.add('warning', 'spawn-arg-order', n, `Arguments are (x, y, key): \`${callee}(x, y, '${key}')\`.`, { suggestion: `${callee}(x, y, '${key}')` });
        }
      }
      if (callee === 'this.shoot' && n.arguments[0]?.type === 'Literal' && typeof n.arguments[0].value === 'number') {
        ctx.add('warning', 'shoot-args', n, '`this.shoot(from, angleOrTarget, opts)`: `from` is an object with x/y (e.g. the hero), not a number.');
      }
      const inUpdate = updates.find((u) => anc.includes(u));
      const guarded = (a: AnyNode) => a.type === 'IfStatement' || a.type === 'ConditionalExpression' || a.type === 'LogicalExpression';
      if (callee.endsWith('.scene.restart') && inUpdate && !anc.some(guarded)) {
        ctx.add('error', 'restart-every-frame', n, '`this.scene.restart()` runs every frame here; put it behind a condition.');
      }
      if (inUpdate && (CREATORS.test(callee.replace(/^this\./, '')) || /^this\.(spawn|spawnHero|spawnEnemy|add\.text)$/.test(callee))) {
        const behind = anc.some(
          (a) => (a !== n && ['IfStatement', 'ConditionalExpression', 'LogicalExpression', 'ForStatement', 'ForOfStatement', 'WhileStatement'].includes(a.type)) || (a.type === 'CallExpression' && a !== n && /\.(every|after|forEach)$/.test(memberPath(a.callee))),
        );
        if (!behind || /add\.text$/.test(callee)) {
          ctx.add('warning', 'create-in-update', n, `\`${callee}\` inside update() creates a new object every frame (60 per second). Create it once in create(), or behind a condition/timer.`, { name: callee });
        }
      }
      // function () {} callbacks that use `this`: direct arguments, and callback/onComplete... in config objects.
      const callbacks: FunctionExpression[] = [];
      for (const arg of n.arguments) {
        if (arg.type !== 'ObjectExpression') continue;
        if (arg.properties.some((p) => p.type === 'Property' && p.key.type === 'Identifier' && (p.key.name === 'callbackScope' || p.key.name === 'callbackContext'))) continue;
        for (const p of arg.properties) {
          if (p.type === 'Property' && p.key.type === 'Identifier' && /^(callback|onComplete|onUpdate|onStart|onYoyo|onRepeat|onLoop|processCallback)$/.test(p.key.name) && p.value.type === 'FunctionExpression') callbacks.push(p.value);
        }
      }
      for (const fn of callbacks) if (!fn.generator && usesThis(fn) && !usesArguments(fn)) arrowFix(ctx, fn);
      n.arguments.forEach((arg, i) => {
        if (arg.type !== 'FunctionExpression' || arg.generator || !usesThis(arg) || usesArguments(arg)) return;
        const scopeArg = i < n.arguments.length - 1 && n.arguments[n.arguments.length - 1].type === 'ThisExpression';
        if (!scopeArg) arrowFix(ctx, arg);
      });
    },
    NewExpression(n) {
      if (memberPath(n.callee) === 'Phaser.Game') ctx.add('error', 'new-game', n, 'Do not create `new Phaser.Game(...)`: Amble starts the game for you from `class Game`.');
    },
    AssignmentExpression(n, _s, anc) {
      const left = memberPath(n.left);
      const m = /^this\.(\w+)$/.exec(left);
      if (m && ctx.api.reserved.has(m[1]) && thisIsScene(anc, ctx.sceneClasses)) {
        const alt = `my${m[1][0].toUpperCase()}${m[1].slice(1)}`;
        ctx.add('error', 'kit-overwrite', n, `\`this.${m[1]}\` is part of the Amble kit; pick another name (e.g. this.${alt}).`, { name: m[1] });
      }
      if (/physics\.world\.timeScale$/.test(left)) ctx.add('warning', 'arcade-timescale', n, 'Arcade `world.timeScale` is inverted (2 = half speed). Use `this.timeScale = 0.5` or `this.fx.slowmo()`.');
    },
    VariableDeclarator(n) {
      if (n.init?.type === 'CallExpression' && /^this\.add\.(sprite|image)$/.test(memberPath(n.init.callee)) && n.id.type === 'Identifier') displayVars.set(n.id.name, n.init);
    },
    WhileStatement(n) {
      if (n.test.type === 'Literal' && n.test.value === true && !hasExit(n.body)) ctx.add('error', 'infinite-loop', n, '`while (true)` without break/return freezes the game.');
    },
    DoWhileStatement(n) {
      if (n.test.type === 'Literal' && n.test.value === true && !hasExit(n.body)) ctx.add('error', 'infinite-loop', n, '`do { } while (true)` without break/return freezes the game.');
    },
    ForStatement(n) {
      if (!n.test && !hasExit(n.body)) ctx.add('error', 'infinite-loop', n, '`for (;;)` without break/return freezes the game.');
    },
  });

  // A display-only sprite that is later used as a physics body.
  if (displayVars.size) {
    simple(ctx.ast, {
      MemberExpression(n) {
        if (n.object.type !== 'Identifier' || n.computed || n.property.type !== 'Identifier') return;
        const init = displayVars.get(n.object.name);
        if (!init || !['body', 'setVelocity', 'setVelocityX', 'setVelocityY', 'setBounce', 'setCollideWorldBounds', 'setGravityY'].includes(n.property.name)) return;
        displayVars.delete(n.object.name);
        ctx.add('warning', 'no-physics-body', n, `\`${n.object.name}\` was made with this.add.* so it has no physics body; make it with this.physics.add.* instead.`, { name: n.object.name, fixed: ctx.fix });
        ctx.applyFix('no-physics-body', n, `this.add -> this.physics.add for ${n.object.name}`, () => ctx.ms.overwrite(init.callee.start, init.callee.end, src(ctx.code, init.callee).replace('this.add.', 'this.physics.add.')));
      },
    });
  }
}

export function runRules(ctx: FileContext): void {
  security(ctx);
  probeRules(ctx);
}
