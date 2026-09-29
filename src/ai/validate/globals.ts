/**
 * Names: what the game declares, and bare names it uses that nothing declares. A kit method called
 * without `this.` (`spawnHero(...)`) is a sure crash; other unknown names are reported as warnings,
 * because the browser has more globals than any list.
 */
import type { Program } from 'acorn';
import { ancestor, full } from 'acorn-walk';
import { closest } from './manifest';
import type { FileContext } from './context';

const BUILTINS = new Set(
  (
    'Object Function Array Number parseFloat parseInt Infinity NaN undefined Boolean String Symbol Date Promise RegExp Error AggregateError ' +
    'EvalError RangeError ReferenceError SyntaxError TypeError URIError globalThis JSON Math Intl ArrayBuffer SharedArrayBuffer Atomics DataView ' +
    'Uint8Array Int8Array Uint16Array Int16Array Uint32Array Int32Array Float32Array Float64Array Uint8ClampedArray BigUint64Array BigInt64Array ' +
    'BigInt Map Set WeakMap WeakSet WeakRef FinalizationRegistry Proxy Reflect Iterator decodeURI decodeURIComponent encodeURI encodeURIComponent ' +
    'escape unescape isFinite isNaN structuredClone queueMicrotask arguments ' +
    'window self document console navigator performance screen location history crypto devicePixelRatio innerWidth innerHeight ' +
    'setTimeout setInterval clearTimeout clearInterval requestAnimationFrame cancelAnimationFrame alert confirm prompt atob btoa ' +
    'getComputedStyle matchMedia Image Audio AudioContext OfflineAudioContext OffscreenCanvas HTMLCanvasElement HTMLImageElement ' +
    'CanvasRenderingContext2D WebGLRenderingContext WebGL2RenderingContext ImageData ImageBitmap createImageBitmap Path2D DOMRect DOMMatrix ' +
    'Event CustomEvent EventTarget KeyboardEvent MouseEvent PointerEvent TouchEvent WheelEvent FocusEvent GamepadEvent ' +
    'TextEncoder TextDecoder URL URLSearchParams Blob File FileReader AbortController AbortSignal ' +
    'localStorage sessionStorage indexedDB caches fetch XMLHttpRequest WebSocket EventSource Worker SharedWorker importScripts ' +
    'postMessage BroadcastChannel MessageChannel parent top opener frames open eval ' +
    'Phaser Amble'
  ).split(' '),
);

/** Every name declared anywhere in the program: variables, functions, classes, parameters, catch bindings, assignments. */
export function collectDeclared(ast: Program, into: Set<string>): void {
  // acorn-walk reports identifiers in binding and assignment positions with the type `VariablePattern`.
  full(ast, (n, _s, type) => {
    if (type === 'VariablePattern' && n.type === 'Identifier') into.add(n.name);
  });
}

export function checkGlobals(ctx: FileContext): void {
  const api = ctx.api;
  const known = (name: string) => BUILTINS.has(name) || api.globals.has(name) || ctx.facts.declared.has(name);
  const reported = new Set<string>();
  ancestor(ctx.ast, {
    Identifier(n, _s, anc) {
      if (known(n.name) || reported.has(n.name)) return;
      // `typeof x` is how code checks for a name that may not exist.
      const parent = anc[anc.length - 2];
      if (parent?.type === 'UnaryExpression' && parent.operator === 'typeof') return;
      reported.add(n.name);
      const isKit = api.sceneMethods.has(n.name) || api.namespaces.has(n.name);
      const syn = api.synonyms[n.name];
      if (isKit || (syn && api.sceneMethods.has(syn))) {
        const target = isKit ? n.name : syn;
        ctx.add('error', 'unknown-global', n, `\`${n.name}\` is not defined. Kit methods live on the scene: use \`this.${target}\`.`, { name: n.name, suggestion: `this.${target}` });
        return;
      }
      const sug = closest(n.name, [...ctx.facts.declared, ...api.globals], {});
      ctx.add('warning', 'unknown-global', n, `\`${n.name}\` is not defined anywhere in the game${sug ? `; did you mean \`${sug}\`?` : '.'}`, { name: n.name, suggestion: sug ?? undefined });
    },
  });
}
