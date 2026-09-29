import { describe, expect, it } from 'vitest';
import { PLAYER_BOOT, STANDALONE_BOOT, playerCsp, playerSrcdoc, scriptHash, sha256Base64 } from '../../src/play/bootstrap';
import { isScrollKey, keyCodeFor, shouldForwardKey } from '../../src/play/keys';
import { PLAYER_LIMITS, RateLimiter } from '../../src/play/limits';
import { judgeRobot, ROBOT_THRESHOLDS } from '../../src/play/robotJudge';
import { buildStandaloneHtml } from '../../src/play/standalone';
import { STANDALONE_DATA_ID, STANDALONE_RUNTIME_ID, type RobotRaw, type RuntimeStats } from '../../src/play/protocol';

describe('the player document', () => {
  it("gives the editor page's CSP the bootstrap's hash (srcdoc frames inherit that policy)", async () => {
    // The config-side module imports with .ts extensions (for Node's loader), so it stays out of tsc's app
    // program: a computed specifier is not followed by the type checker.
    const pluginPath = '../../vite/ambleRuntime.ts';
    const { playerBootHashes } = (await import(/* @vite-ignore */ pluginPath)) as { playerBootHashes: () => string[] };
    const { editorCsp } = await import('../../vite/csp');
    expect(playerBootHashes()).toEqual([`sha256-${await sha256Base64(PLAYER_BOOT)}`]);
    const policy = editorCsp({ connect: ['https:'], bootHashes: playerBootHashes });
    expect(policy).toContain(`script-src 'self' ${await scriptHash(PLAYER_BOOT)} blob:`);
  });

  it('allows only the bootstrap by hash, blob scripts and no network', async () => {
    const hash = await scriptHash(PLAYER_BOOT);
    expect(hash).toBe(`'sha256-${await sha256Base64(PLAYER_BOOT)}'`);
    const csp = playerCsp(hash);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src ${hash} blob:`);
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain('img-src data: blob:');
    expect(csp).not.toContain('unsafe-eval');
    const doc = await playerSrcdoc('Moon <King>');
    expect(doc).toContain(`<script>${PLAYER_BOOT}</script>`);
    expect(doc).toContain('<title>Moon &lt;King&gt;</title>');
    expect(doc.match(/<script/g)?.length).toBe(1);
  });
});

describe('forwarded keys', () => {
  it('maps keys to the keyCodes Phaser reads', () => {
    expect(keyCodeFor(' ', 'Space')).toBe(32);
    expect(keyCodeFor('a', 'KeyA')).toBe(65);
    expect(keyCodeFor('ArrowLeft', 'ArrowLeft')).toBe(37);
    expect(keyCodeFor('7', 'Digit7')).toBe(55);
    expect(keyCodeFor('Dead', 'IntlRo')).toBe(0);
  });

  it('never forwards Escape, Tab or shortcuts (no keyboard trap)', () => {
    expect(shouldForwardKey({ key: 'Escape', code: 'Escape' })).toBe(false);
    expect(shouldForwardKey({ key: 'Tab', code: 'Tab' })).toBe(false);
    expect(shouldForwardKey({ key: 's', code: 'KeyS', ctrlKey: true })).toBe(false);
    expect(shouldForwardKey({ key: 'F5', code: 'F5' })).toBe(false);
    expect(shouldForwardKey({ key: 'x', code: 'KeyX' })).toBe(true);
    expect(isScrollKey({ key: ' ', code: 'Space' })).toBe(true);
    expect(isScrollKey({ key: 'x', code: 'KeyX' })).toBe(false);
  });
});

describe('message limits', () => {
  it('caps messages per second and per run', () => {
    const r = new RateLimiter<'log' | 'error'>({ log: { perSecond: 2 }, error: { perRun: 3 } });
    expect([r.allow('log', 0), r.allow('log', 10), r.allow('log', 20), r.allow('log', 1001)]).toEqual([true, true, false, true]);
    expect([1, 2, 3, 4].map((t) => r.allow('error', t * 5000))).toEqual([true, true, true, false]);
    expect(PLAYER_LIMITS.error?.perRun).toBe(50);
  });
});

const stats = (objects: number): RuntimeStats => ({
  fps: 0, frameMs: 1, frames: 1, objects, particles: 0, arcadeBodies: 0, matterBodies: 0, shots: 0, tweens: 0, drawCalls: 1,
  textureMB: 1, heapMB: null, quality: 1, timeScale: 1, state: 'running', audio: 'none', errors: 0,
});

function raw(over: Partial<RobotRaw> = {}): RobotRaw {
  return {
    gameMs: 6000, frames: 360, wallMs: 1200, speed: 5, errors: [], warnings: [], events: [], artMissing: [], state: 'running',
    hero: { found: true, controlled: true, moved: 300, alive: true }, movers: 3, frameDiff: 0.05, lumaVariance: 900,
    start: stats(50), end: stats(60), peakObjects: 70, peakMatterBodies: 0, ...over,
  };
}

describe('the robot judge', () => {
  it('passes a healthy run', () => {
    const r = judgeRobot(raw(), 360);
    expect(r.pass).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(Object.keys(r)).not.toContain('fps');
  });

  it('fails errors, blank screens, stuck heroes and runaway objects, with reasons', () => {
    expect(judgeRobot(raw({ errors: [{ phase: 'update', message: 'boom', file: 'game.js', line: 12, count: 3, fatal: true }] }), 360).reasons[0]).toBe('The game broke (line 12 of game.js): boom');
    expect(judgeRobot(raw({ lumaVariance: 0.5 }), 360).reasons).toContain('The screen stayed blank.');
    expect(judgeRobot(raw({ hero: { found: true, controlled: true, moved: 2, alive: true } }), 360).reasons).toContain("The hero didn't move when the robot pressed the controls.");
    expect(judgeRobot(raw({ end: stats(900) }), 360).reasons[0]).toMatch(/piling up/);
    expect(judgeRobot(raw({ frames: 100 }), 360).reasons[0]).toMatch(/100 of 360/);
    expect(judgeRobot(raw({ artMissing: ['boss'] }), 360).notes[0]).toMatch(/boss/);
    // The options form defaults to 60 frames per second of game time.
    expect(judgeRobot(raw({ frames: 100 }), { thresholds: ROBOT_THRESHOLDS }).reasons[0]).toMatch(/100 of 360/);
    expect(judgeRobot(raw()).pass).toBe(true);
  });
});

describe('the exported page', () => {
  it('embeds the runtime and the game as data that cannot close its script element', async () => {
    const runtime = 'console.log("</script><script>alert(1)</script>"); /* <!-- */';
    const html = await buildStandaloneHtml({
      title: 'Moon & King',
      runtime,
      files: [{ name: 'game.js', source: 'class Game extends Amble.Scene {} // </script>' }],
      images: [{ key: 'hero', image: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), rig: { v: 1 } }],
      sounds: [{ key: 'yay', pcm: [new Float32Array([0, 0.5, -0.5])], sampleRate: 22050 }],
    });
    // Exactly the three script elements: runtime JSON, game JSON, bootstrap.
    expect(html.match(/<script/g)?.length).toBe(3);
    expect(html.match(/<\/script>/g)?.length).toBe(3);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain(`script-src ${await scriptHash(STANDALONE_BOOT)} blob:`);
    expect(html).toContain('<title>Moon &amp; King</title>');
    const block = (id: string) => {
      const m = new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`).exec(html);
      return JSON.parse(m?.[1] ?? 'null') as unknown;
    };
    expect(block(STANDALONE_RUNTIME_ID)).toBe(runtime);
    const game = block(STANDALONE_DATA_ID) as { files: Array<{ source: string }>; art: Array<{ image: string; rig: unknown }>; sounds: Array<{ pcm: string[] }> };
    expect(game.files[0].source).toContain('</script>');
    expect(game.art[0].image).toBe('data:image/png;base64,iVBORw==');
    expect(game.art[0].rig).toEqual({ v: 1 });
    expect(new Float32Array(Uint8Array.from(atob(game.sounds[0].pcm[0]), (c) => c.charCodeAt(0)).buffer)[1]).toBe(0.5);
  });
});
