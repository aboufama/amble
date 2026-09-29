/**
 * Dials stay live only where the kit reads a function every frame: the `Num` options of behaviours
 * (`platformer({ jump })`, `shooter({ every })`), shot speeds and damage, and a few positional
 * arguments (`every(ms)`, `patrol(speed)`, `chase(target, speed)`, `orbit(c, r, speed)`, `jump(v)`).
 * A plain read there (`platformer({ jump: this.dials.jump })`) freezes the first value, so it is
 * rewritten to `() => this.dials.jump`.
 *
 * Everywhere else the kit wants a number, and a function would break it (`spawnBoss(..., { hp: () => n })`
 * gives the boss NaN health). So a dial read there is left alone, and a dial thunk there is unwrapped.
 * Reads outside kit calls (in update(), say) run every frame anyway and are left alone.
 *
 * Dial reads: `this.dials.x`, `this.dial.x`, `dials.x`, `this.tune.x`, `this.tune('x', ...)`, and pure
 * arithmetic on them (`this.dials.speed * 1.5`).
 */
import type { AnyNode, ArrowFunctionExpression, CallExpression, Expression, ObjectExpression, SpreadElement } from 'acorn';
import { ancestor } from 'acorn-walk';
import { memberPath, propertyName, src, thisIsScene } from './ast';
import type { FileContext } from './context';
import { isKitCallee } from './rules';

const DIAL_OBJECTS = new Set(['this.dials', 'this.dial', 'dials', 'dial', 'this.tune']);
const MATH = /^Math\.\w+$/;

/** Option keys the kit reads live, by the method that takes the options (behaviours and shots). */
const LIVE_OPTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  platformer: new Set(['speed', 'accel', 'decel', 'jump', 'jumps', 'maxFall', 'maxSpeed', 'speedUp']),
  runner: new Set(['speed', 'accel', 'decel', 'jump', 'jumps', 'maxFall', 'maxSpeed', 'speedUp']),
  topdown: new Set(['speed', 'accel', 'decel']),
  flyer: new Set(['speed', 'lift']),
  shooter: new Set(['speed', 'every', 'damage', 'count']),
  wander: new Set(['speed']),
  shoot: new Set(['speed', 'damage']),
  spawnProjectile: new Set(['speed', 'damage']),
  ring: new Set(['speed', 'damage']),
  spread: new Set(['speed', 'damage']),
  aimed: new Set(['speed', 'damage']),
  spiral: new Set(['speed', 'damage']),
  rain: new Set(['speed', 'damage']),
  wall: new Set(['speed', 'damage']),
};

/** Nested option objects with live keys of their own (`dash: { speed }`). */
const LIVE_NESTED: Readonly<Record<string, ReadonlySet<string>>> = { dash: new Set(['speed']) };

/** Positional arguments the kit reads live: method name -> argument index. */
const LIVE_ARGS: Readonly<Record<string, number>> = { every: 0, patrol: 0, chase: 1, orbit: 2, jump: 0 };

function isDialRead(n: AnyNode): boolean {
  if (n.type === 'MemberExpression') return DIAL_OBJECTS.has(memberPath(n.object)) && propertyName(n) !== '';
  if (n.type === 'CallExpression') return memberPath(n.callee) === 'this.tune' && n.arguments[0]?.type === 'Literal' && typeof n.arguments[0].value === 'string';
  return false;
}

/** A dial read, or side-effect-free arithmetic that contains one. */
function isLiveValue(n: AnyNode): boolean {
  let hasDial = false;
  const pure = (x: AnyNode): boolean => {
    if (isDialRead(x)) {
      hasDial = true;
      return true;
    }
    switch (x.type) {
      case 'Literal':
      case 'Identifier':
      case 'ThisExpression':
        return true;
      case 'MemberExpression':
        return pure(x.object) && (!x.computed || pure(x.property));
      case 'BinaryExpression':
      case 'LogicalExpression':
        return x.left.type !== 'PrivateIdentifier' && pure(x.left) && pure(x.right);
      case 'UnaryExpression':
        return x.operator !== 'delete' && pure(x.argument);
      case 'ConditionalExpression':
        return pure(x.test) && pure(x.consequent) && pure(x.alternate);
      case 'ParenthesizedExpression':
        return pure(x.expression);
      case 'CallExpression':
        return MATH.test(memberPath(x.callee)) && x.arguments.every((a) => a.type !== 'SpreadElement' && pure(a));
      default:
        return false;
    }
  };
  return pure(n) && hasDial;
}

/** `() => <dial read>`: a thunk the model wrote where the kit wants a plain number. */
function dialThunkBody(n: AnyNode): Expression | null {
  if (n.type !== 'ArrowFunctionExpression') return null;
  const fn = n as ArrowFunctionExpression;
  if (fn.params.length || !fn.expression || fn.body.type === 'BlockStatement') return null;
  return isLiveValue(fn.body) ? (fn.body as Expression) : null;
}

function isKitCall(n: CallExpression, anc: readonly AnyNode[], ctx: FileContext): boolean {
  if (!isKitCallee(ctx, n)) return false;
  return !memberPath(n.callee).startsWith('this.') || ctx.api.actorMethods.has(propertyName(n.callee)) || thisIsScene(anc, ctx.sceneClasses);
}

function keyOf(ctx: FileContext, p: { key: AnyNode; computed: boolean }): string {
  if (!p.computed && p.key.type === 'Identifier') return p.key.name;
  if (p.key.type === 'Literal' && typeof p.key.value === 'string') return p.key.value;
  return src(ctx.code, p.key);
}

function wrap(ctx: FileContext, key: string, value: Expression): void {
  const text = src(ctx.code, value);
  ctx.add('warning', 'dial-thunk', value, `\`${key}: ${text}\` reads the dial once; write \`${key}: () => ${text}\` so it stays live.`, { name: key, fixed: ctx.fix });
  ctx.applyFix('dial-thunk', value, `${key}: ${text} -> () => ${text}`, () => ctx.ms.appendLeft(value.start, '() => '));
}

function wrapArgument(ctx: FileContext, method: string, value: Expression): void {
  const text = src(ctx.code, value);
  ctx.add('warning', 'dial-thunk', value, `\`${method}(${text}, ...)\` reads the dial once; write \`${method}(() => ${text}, ...)\` so it stays live.`, { name: method, fixed: ctx.fix });
  ctx.applyFix('dial-thunk', value, `${method}(${text}) -> ${method}(() => ${text})`, () => ctx.ms.appendLeft(value.start, '() => '));
}

function unwrap(ctx: FileContext, key: string, fn: AnyNode, body: Expression): void {
  const text = src(ctx.code, body);
  ctx.add('warning', 'dial-thunk', fn, `\`${key}\` needs a number, not a function: write \`${key}: ${text}\`.`, { name: key, fixed: ctx.fix });
  ctx.applyFix('dial-thunk', fn, `${key}: () => ${text} -> ${text}`, () => ctx.ms.overwrite(fn.start, fn.end, text));
}

function visitOptions(ctx: FileContext, obj: ObjectExpression, live: ReadonlySet<string>): void {
  for (const p of obj.properties) {
    if (p.type !== 'Property' || p.kind !== 'init' || p.method || p.shorthand) continue;
    const key = keyOf(ctx, p);
    const value: Expression = p.value;
    if (value.type === 'ObjectExpression') {
      visitOptions(ctx, value, LIVE_NESTED[key] ?? new Set());
      continue;
    }
    const thunkBody = dialThunkBody(value);
    if (live.has(key)) {
      if (!thunkBody && isLiveValue(value)) wrap(ctx, key, value);
    } else if (thunkBody) unwrap(ctx, key, value, thunkBody);
  }
}

export function checkDials(ctx: FileContext): void {
  ancestor(ctx.ast, {
    CallExpression(n, _s, anc) {
      if (!isKitCall(n, anc, ctx)) return;
      const method = propertyName(n.callee);
      const live = LIVE_OPTIONS[method] ?? new Set<string>();
      n.arguments.forEach((arg: Expression | SpreadElement, i) => {
        if (arg.type === 'ObjectExpression') visitOptions(ctx, arg, live);
        else if (arg.type !== 'SpreadElement' && LIVE_ARGS[method] === i && isLiveValue(arg)) wrapArgument(ctx, method, arg);
      });
    },
  });
}
