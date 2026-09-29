/**
 * Test drawings for Bones: one of the rig core's synthetic kid drawings (painted in the page by
 * `src/rig/samples`, the same pixels anywhere), exported as a flat PNG with its lines-only ink mask
 * and stored as a real `ArtRecord` through the app's store, optionally as a cast member of a world.
 */
import type { Page } from '@playwright/test';

export interface SeedOptions {
  /** A sample from `src/rig/samples/kid-art.ts` (default 'hero'). */
  sample?: 'hero' | 'stick' | 'astronaut' | 'closeLegs' | 'slime' | 'dog' | 'bird' | 'fish' | 'car';
  name?: string;
  /** Rig it before opening Bones (else Bones finds the bones itself). */
  rigged?: boolean;
  /** What `rigInfo` says (with `rigged`): Amble's guess shows below 0.6. */
  confidence?: number;
  notes?: string[];
  /** Put it in a world as this cast member. */
  castKey?: string;
}

export interface Seeded {
  artId: string;
  worldId: string | null;
}

export async function seedDrawing(page: Page, o: SeedOptions = {}): Promise<Seeded> {
  return page.evaluate(async (opts) => {
    type Px = { data: Uint8ClampedArray; width: number; height: number };
    interface Amble {
      services: {
        store: {
          blobs: { put(b: Blob): Promise<string> };
          commit(c: Record<string, unknown>): Promise<void>;
          worlds: { get(id: string): Promise<Record<string, unknown> & { cast: Record<string, Record<string, unknown>> }> };
        };
        starters: { open(id: string, o: { withArt: boolean }): Promise<{ world: Record<string, unknown> & { id: string; cast: Record<string, Record<string, unknown>> }; art: unknown[]; blobs: Blob[] }> };
      };
    }
    const amble = (window as unknown as { __amble: Amble }).__amble;
    const kidUrl = '/src/rig/samples/kid-art.ts';
    const rigUrl = '/src/cores/rig.ts';
    const kid = (await import(/* @vite-ignore */ kidUrl)) as Record<string, (seed?: number) => { image: Px; layers: Record<string, Px>; anchor?: { at: [number, number] } }>;
    const names: Record<string, string> = {
      hero: 'drawHero', stick: 'drawStick', astronaut: 'drawAstronaut', closeLegs: 'drawCloseLegs', slime: 'drawSlime',
      dog: 'drawDog', bird: 'drawBird', fish: 'drawFish', car: 'drawCar',
    };
    const kinds: Record<string, string> = {
      hero: 'biped', stick: 'biped', astronaut: 'biped', closeLegs: 'biped', slime: 'blob', dog: 'quadruped', bird: 'flyer', fish: 'swimmer', car: 'object',
    };
    const sample = opts.sample ?? 'hero';
    const s = kid[names[sample]]();
    const png = async (p: Px): Promise<Blob> => {
      const c = new OffscreenCanvas(p.width, p.height);
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
      return c.convertToBlob({ type: 'image/png' });
    };
    const flat = await png(s.image);
    const lines = s.layers.lines ? await png(s.layers.lines) : null;
    const doc = new Blob([JSON.stringify({ test: true })], { type: 'application/json' });
    const store = amble.services.store;
    const flatRef = await store.blobs.put(flat);
    const maskRef = lines ? await store.blobs.put(lines) : null;
    const docRef = await store.blobs.put(doc);
    const kind = kinds[sample];
    let rigData: unknown = null;
    let rigInfo: unknown = null;
    if (opts.rigged) {
      const rig = (await import(/* @vite-ignore */ rigUrl)) as { rigWorker: { autoRig(src: unknown, req: unknown): Promise<{ rig: unknown; confidence: number; notes: string[] }> } };
      const r = await rig.rigWorker.autoRig({ image: flat, layers: lines ? { lines } : undefined }, { kind });
      rigData = r.rig;
      rigInfo = { made: 'auto', confidence: opts.confidence ?? r.confidence, notes: opts.notes ?? r.notes };
    }
    const now = Date.now();
    const artId = `a_${Math.random().toString(36).slice(2, 12).padEnd(10, '0')}`;
    const record = {
      id: artId, name: opts.name ?? 'Pip', kind: 'character', rig: kind, facing: 'viewer', role: opts.castKey ? 'hero' : null, mode: 'free',
      board: { w: 1024, h: 1024, pixelArt: false }, doc: docRef, cels: [], parts: {},
      export: {
        hash: flatRef.slice(7), flat: flatRef, w: s.image.width, h: s.image.height, anchor: s.anchor?.at ?? [s.image.width / 2, s.image.height - 2],
        inkMask: maskRef, parts: {}, sticker: flatRef, thumb: flatRef, frames: null,
      },
      rigData, rigInfo, palette: [], madeBy: 'student', shelf: !opts.castKey, createdAt: now, updatedAt: now, version: 1,
    };
    let worldId: string | null = null;
    const worlds: unknown[] = [];
    if (opts.castKey) {
      const { world } = await amble.services.starters.open('moon-king', { withArt: false });
      const slot = world.cast[opts.castKey] ?? { key: opts.castKey, extra: null, laterUntil: 0 };
      world.cast = { ...world.cast, [opts.castKey]: { ...slot, key: opts.castKey, art: artId, madeBy: 'student' } };
      worldId = world.id;
      worlds.push(world);
    }
    await store.commit({ art: [record], worlds });
    return { artId, worldId };
  }, o);
}

/** The drawing's record as stored now. */
export async function readArt(page: Page, artId: string): Promise<{ rigData: { made: string; bones: unknown[]; kind: string; anims?: Record<string, { amount?: number; speed?: number }> } | null; rigInfo: { made: string } | null; rig: string; facing: string } | null> {
  return page.evaluate(async (id) => {
    const amble = (window as unknown as { __amble: { services: { store: { art: { get(id: string): Promise<unknown> } } } } }).__amble;
    return (await amble.services.store.art.get(id)) as never;
  }, artId);
}

/** The world's footsteps as stored now. */
export async function readSteps(page: Page, worldId: string): Promise<Array<{ kind: string; text: string; by: string; cast?: string }>> {
  return page.evaluate(async (id) => {
    const amble = (window as unknown as { __amble: { services: { store: { worlds: { get(id: string): Promise<{ steps: unknown[] } | null> } } } } }).__amble;
    return ((await amble.services.store.worlds.get(id))?.steps ?? []) as never;
  }, worldId);
}
