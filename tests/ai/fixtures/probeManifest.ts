/** The games probe's kit API (games-probe/kit), as a manifest. The real one comes from src/runtime. */
import type { KitManifest } from '../../../src/ai/validate/types';

export const PROBE_MANIFEST: KitManifest = {
  globals: ['Amble', 'Phaser'],
  sceneMethods: (
    'art spawn spawnHero spawnEnemy all shoot group collide overlap every after wait cooldown brain phases waves follow worldSize ' +
    'parallax weather level platform chunks flipGravity win lose restart addScore sfx rand pick chance dist angleTo blast box ball stack pyramid ' +
    'wreckingBall ragdoll grab impacts stats init preload create update'
  ).split(' '),
  namespaces: {
    fx: 'shake hitstop slowmo flash punch chroma burst explode shockwave dust squash trail ghost hurtFlash halo lightning confetti motion'.split(' '),
    ui: 'text big pop hint score setScore bossBar hearts panel'.split(' '),
    pattern: 'ring spread aimed spiral rain wall laser'.split(' '),
    music: 'play intensity stop'.split(' '),
    combo: 'hit reset count best mult window'.split(' '),
    controls: 'held pressed released left right up down jump fire dash action x y pointer bind virtual'.split(' '),
  },
};
