/** Prints per-frame vertex jumps around a clip switch. Usage: node dev/rig/node/run.mjs fade [fade] */
import { autoRig } from '../../../src/rig/autorig';
import { bindRig } from '../../../src/rig/bind';
import { RigPuppet } from '../../../src/rig/runtime/puppet';
import { SAMPLES } from '../../../src/rig/samples/kid-art';

export function runFade(args: string[]): void {
  const s = SAMPLES[0].draw();
  const r = autoRig(s, s.kind);
  const b = bindRig(s, r.rig, { analysis: r.analysis });
  const p = new RigPuppet(b);
  p.play('run', { fade: 0 });
  for (let i = 0; i < 8; i++) p.update(1 / 60);
  p.play('attack', { fade: 0 });
  for (let i = 0; i < 12; i++) p.update(1 / 60);
  const fade = args[0] === undefined ? undefined : Number(args[0]);
  let prev = Float32Array.from(p.vertices!);
  p.play('idle', fade === undefined ? {} : { fade });
  for (let f = 0; f < 8; f++) {
    p.update(1 / 60);
    let worst = 0, at = -1;
    p.vertices!.forEach((v, k) => {
      const d = Math.abs(v - prev[k]);
      if (d > worst) {
        worst = d;
        at = k >> 1;
      }
    });
    const bone = b.boneIdx[at * 4];
    console.log(`frame ${f} clip ${p.clip} base ${p.animator.baseClip} jump ${worst.toFixed(1)} at vertex ${at} bone ${b.rig.bones[bone].name} gy ${p.pose.gy.toFixed(1)} grot ${p.pose.grot.toFixed(3)} gsy ${p.pose.gsy.toFixed(3)}`);
    prev = Float32Array.from(p.vertices!);
  }
}
