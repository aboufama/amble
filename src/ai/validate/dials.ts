/**
 * Dials stay live only when kit options get a function the kit reads every frame. A plain read in
 * an options object (`platformer({ jump: this.dials.jump })`) freezes the first value, so it is
 * rewritten to `() => this.dials.jump`. Reads outside option objects (in update(), say) are left
 * alone: they run every frame anyway.
 *
 * Dial reads: `this.dials.x`, `this.dial.x`, `dials.x`, `this.tune.x`, `this.tune('x', ...)`, and
 * pure arithmetic on them (`this.dials.speed * 1.5`).
 */
import type { AnyNode, CallExpression, Expression, ObjectExpression } from 'acorn';
import { ancestor } from 'acorn-walk';
import { memberPath, propertyName, src, thisIsScene } from './ast';
import type { FileContext } from './context';
import { isKitCallee } from './rules';

const DIAL_OBJECTS = new Set(['this.dials', 'this.dial', 'dials', 'dial', 'this.tune']);
const MATH = /^Math\.\w+$/;

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

function isKitCall(n: CallExpression, anc: readonly AnyNode[], ctx: FileContext): boolean {
  if (!isKitCallee(ctx, n)) return false;
  return !memberPath(n.callee).startsWith('this.') || ctx.api.actorMethods.has(propertyName(n.callee)) || thisIsScene(anc, ctx.sceneClasses);
}

function rewrite(ctx: FileContext, obj: ObjectExpression): void {
  for (const p of obj.properties) {
    if (p.type !== 'Property' || p.kind !== 'init' || p.method || p.shorthand) continue;
    const value: Expression = p.value;
    if (value.type === 'ObjectExpression') {
      rewrite(ctx, value);
      continue;
    }
    if (!isLiveValue(value)) continue;
    const text = src(ctx.code, value);
    const key = p.key.type === 'Identifier' ? p.key.name : src(ctx.code, p.key);
    ctx.add('warning', 'dial-thunk', value, `\`${key}: ${text}\` reads the dial once; write \`${key}: () => ${text}\` so it stays live.`, { name: key, fixed: ctx.fix });
    ctx.applyFix('dial-thunk', value, `${key}: ${text} -> () => ${text}`, () => ctx.ms.appendLeft(value.start, '() => '));
  }
}

export function checkDials(ctx: FileContext): void {
  ancestor(ctx.ast, {
    CallExpression(n, _s, anc) {
      if (!isKitCall(n, anc, ctx)) return;
      for (const arg of n.arguments) if (arg.type === 'ObjectExpression') rewrite(ctx, arg);
    },
  });
}
