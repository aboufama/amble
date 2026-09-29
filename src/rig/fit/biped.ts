/**
 * Biped template: hips, spine, head, two 2-bone arms, two 2-bone legs, extras.
 * - Head: the upper end that is highest, bulkiest and most central (or the hinted one).
 * - Legs: low ends far from the head along the skeleton (an arm hanging low is closer to the head).
 * - Arms: ends that join the spine between the pelvis and the head, on each side, however they are
 *   posed (a raised arm holding a wand is still an arm); a thin held object becomes a rigid extra.
 * - Legs merged into one (boots touching, trousers without a gap) are split at the gap or by colour.
 */
import type { Analysis, End } from '../analyze';
import type { BoneRole } from '../types';
import {
  castToEdge, headJoint, limbGeometry, newFit, pushLimb, splitAtGap, splitByColour, straightLimb,
  type Fit, type LimbResult,
} from './common';
import { lca, pathDown, pathToRoot, px, skelTree, topSkeletonPixel, type P2 } from './graph';
import { nextName } from './extras';
import { SLOTS, slotPoints, type Guide } from './guide';
import { snapMid, uncrossStarts } from './snap';

function pickHead(a: Analysis, taken: Set<End>): End | undefined {
  const { bbox, cx, cy } = a;
  const H = bbox.y1 - bbox.y0 + 1, W = bbox.x1 - bbox.x0 + 1;
  const maxBulk = Math.max(1, ...a.ends.map((e) => e.bulk));
  let head: End | undefined;
  let bestS = -Infinity;
  for (const e of a.ends) {
    if (taken.has(e) || e.tipY >= cy) continue;
    const s = (cy - e.tipY) / H + 1.2 * (e.bulk / maxBulk) - 1.0 * (Math.abs(e.tipX - cx) / W);
    if (s > bestS) {
      bestS = s;
      head = e;
    }
  }
  return head;
}

function fakeTopEnd(a: Analysis): End {
  const p = topSkeletonPixel(a);
  const q = p >= 0 ? p : Math.round(a.cy) * a.w + Math.round(a.cx);
  const x = q % a.w, y = Math.floor(q / a.w);
  return { p: q, x, y, tipX: x, tipY: a.bbox.y0, len: 0, junction: -1, thick: a.dt[q], bulk: a.dt[q] };
}

export function fitBiped(a: Analysis, guide: Guide | null): Fit {
  const fit = newFit('biped', 0);
  const { bbox, cx, cy } = a;
  const H = bbox.y1 - bbox.y0 + 1, W = bbox.x1 - bbox.x0 + 1;
  const taken = new Set<End>();
  const hinted = (slot: string) => guide?.ends.get(slot);

  let head = hinted('head') ?? pickHead(a, taken);
  if (!head) {
    head = fakeTopEnd(a);
    fit.issues.push('no-head');
  }
  taken.add(head);
  const { parent, dist } = skelTree(a, head.p);

  // --- legs
  let legs: End[] = [hinted('legL'), hinted('legR')].filter((e): e is End => !!e);
  legs.forEach((e) => taken.add(e));
  if (legs.length < 2) {
    // feet are near the ground: a hand hanging at the hip is not a leg
    const cands = a.ends.filter((e) => !taken.has(e) && e.tipY > cy + 0.05 * H && e.tipY >= bbox.y1 - 0.25 * H && Number.isFinite(dist[e.p]));
    const maxD = Math.max(1, ...cands.map((e) => dist[e.p]));
    const score = (e: End) => (e.tipY - cy) / H + 0.5 * (dist[e.p] / maxD);
    cands.sort((p, q) => score(q) - score(p));
    for (const e of cands) {
      if (legs.length >= 2) break;
      if (legs.length === 1) {
        const o = legs[0];
        if (Math.abs(e.tipX - o.tipX) <= 0.08 * W || e.tipY <= o.tipY - 0.3 * H) continue;
        // the pelvis (where the two paths meet) must be far from the head: an arm meets at the shoulder
        if (dist[lca(parent, o.p, e.p)] < 0.45 * Math.min(dist[o.p], dist[e.p])) continue;
      }
      legs.push(e);
      taken.add(e);
    }
  }
  legs.sort((p, q) => p.tipX - q.tipX);

  // --- pelvis, and legs split when they were drawn touching
  let pelvis: number;
  let splitLegs: { top: P2; bottom: P2 }[] | null = null;
  if (legs.length === 2) pelvis = lca(parent, legs[0].p, legs[1].p);
  else if (legs.length === 1) {
    const leg = legs[0];
    // walking down from the head: past the torso's widest point, the first place it narrows is the crotch
    const down = pathDown(parent, head.p, leg.p);
    let widest = 0, wi = 0;
    for (let i = Math.floor(down.length * 0.45); i < down.length; i++) if (a.dt[down[i]] > widest) {
      widest = a.dt[down[i]];
      wi = i;
    }
    let ci = down.length - 1;
    for (let i = wi; i < down.length; i++) if (a.dt[down[i]] <= 0.6 * widest) {
      ci = i;
      break;
    }
    pelvis = down[Math.max(0, ci - 1)];
    const other = a.ends.filter((e) => e !== leg && e !== head && e.tipY > cy);
    const typical = other.length ? Math.min(...other.map((e) => e.thick)) : leg.thick;
    if (leg.thick >= 1.25 * typical || a.holes.some((v) => v === 1)) {
      splitLegs = splitAtGap(a, Math.floor(cy)) ?? splitByColour(a, leg.junction >= 0 ? leg.junction : pelvis, leg);
    }
    if (splitLegs) {
      fit.issues.push('legs-merged');
      fit.notes.push('The legs almost touch, so they looked stuck together. I split them. If a knee is in the wrong place, drag it.');
    } else {
      fit.issues.push('one-leg');
      fit.notes.push('I found one leg. Press Mirror sides to copy it, or drag the joints.');
    }
  } else {
    let lowest = -1;
    for (let i = 0; i < a.w * a.h; i++) if (a.skel[i] && Number.isFinite(dist[i]) && (lowest < 0 || i > lowest)) lowest = i;
    pelvis = lowest >= 0 ? lowest : head.p;
    fit.issues.push('no-legs');
    fit.notes.push('I couldn\'t find legs, so this character will slide instead of walk. You can add bones yourself.');
  }
  const spinePath = pathDown(parent, head.p, pelvis).reverse(); // pelvis ... head end
  if (spinePath.length < 2) spinePath.push(head.p);
  const spineIdx = new Map(spinePath.map((p, i) => [p, i] as [number, number]));

  // head circle: the widest point in the upper half of the spine path
  let hcI = spinePath.length - 1, hcD = -1;
  for (let i = Math.floor(spinePath.length / 2); i < spinePath.length; i++) if (a.dt[spinePath[i]] > hcD) {
    hcD = a.dt[spinePath[i]];
    hcI = i;
  }
  const headC = px(a, spinePath[hcI]);

  // --- arms: branches joining the spine below the head, one per side
  const arms: { e: End; attach: number; side: 'L' | 'R' }[] = [];
  const raised = new Set<End>();
  const hugging = new Set<End>();
  for (const side of ['L', 'R'] as const) {
    const e = hinted(`arm${side}`);
    if (!e || taken.has(e)) continue;
    const attach = pathToRoot(parent, e.p).find((p) => spineIdx.has(p)) ?? pelvis;
    arms.push({ e, attach, side });
    taken.add(e);
  }
  for (const side of ['L', 'R'] as const) {
    if (arms.some((m) => m.side === side)) continue;
    let best: { e: End; attach: number; side: 'L' | 'R' } | null = null;
    let bestLen = 0;
    for (const e of a.ends) {
      if (taken.has(e) || !Number.isFinite(dist[e.p])) continue;
      const attach = pathToRoot(parent, e.p).find((p) => spineIdx.has(p));
      if (attach === undefined) continue;
      const ai = spineIdx.get(attach)!;
      const [axp, ayp] = px(a, attach);
      if (ai < 0.06 * spinePath.length) {
        // joins at the pelvis: a leg or a tail, unless it reaches far out to the side above the feet
        // (an arm drawn hanging along the body)
        if (Math.abs(e.tipX - cx) < 0.3 * W || e.tipY > bbox.y1 - 0.2 * H) continue;
        hugging.add(e);
      }
      if (Math.hypot(axp - headC[0], ayp - headC[1]) < 1.1 * hcD) {
        // joins inside the head: hair, ears and antennas leave it upward or sideways, but an arm raised
        // past the face joins it from below and reaches far out
        const branch = pathDown(parent, attach, e.p);
        const out = branch.find((p) => Math.hypot((p % a.w) - headC[0], Math.floor(p / a.w) - headC[1]) > hcD);
        if (out === undefined || Math.floor(out / a.w) <= headC[1] + 0.3 * hcD) continue;
        if (Math.hypot(e.tipX - headC[0], e.tipY - headC[1]) < 1.8 * hcD) continue;
        raised.add(e);
      }
      if ((e.tipX < axp ? 'L' : 'R') !== side) continue;
      const len = dist[e.p] - dist[attach];
      if (len < 0.12 * Math.max(W, H)) continue;
      if (len > bestLen) {
        bestLen = len;
        best = { e, attach, side };
      }
    }
    if (best) {
      arms.push(best);
      taken.add(best.e);
    }
  }
  if (arms.length === 1) {
    fit.issues.push('missing-arm');
    fit.notes.push('I found one arm. Press Mirror sides to copy it to the other side.');
  } else if (!arms.length) {
    fit.issues.push('no-arms');
    fit.notes.push('I couldn\'t find the arms, so they won\'t swing. If they are drawn close to the body, try Magic bones, or add them as wiggly bits.');
  }

  // --- neck above the highest shoulder, then the head bone through the head's centre to its top
  let shoulderIdx = Math.floor(spinePath.length * 0.45);
  const lowArms = arms.filter((m) => !raised.has(m.e) && !hugging.has(m.e));
  if (lowArms.length) shoulderIdx = Math.max(...lowArms.map((m) => spineIdx.get(m.attach) ?? 0));
  shoulderIdx = Math.min(shoulderIdx, spinePath.length - 2);
  const headSection = spinePath.slice(shoulderIdx);
  let nIdx = Math.min(shoulderIdx + headJoint(a, headSection), spinePath.length - 1);
  const neckHint = guide?.joints.head;
  if (neckHint) {
    let bi = -1, bd = guide!.tolJoint;
    for (let i = 0; i < spinePath.length; i++) {
      const [qx, qy] = px(a, spinePath[i]);
      const d = Math.hypot(qx - neckHint[0], qy - neckHint[1]);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (bi >= 0) nIdx = bi;
  }
  const neck = px(a, spinePath[nIdx]);
  let hI = nIdx, hD = -1;
  for (let i = nIdx; i < spinePath.length; i++) if (a.dt[spinePath[i]] > hD) {
    hD = a.dt[spinePath[i]];
    hI = i;
  }
  const hc = px(a, spinePath[hI]);
  let ux = hc[0] - neck[0], uy = hc[1] - neck[1];
  const ul = Math.hypot(ux, uy);
  if (ul < 1) {
    ux = 0;
    uy = -1;
  } else {
    ux /= ul;
    uy /= ul;
  }
  const headTip: P2 = ul < 1 ? [head.tipX, head.tipY] : castToEdge(a, hc, ux, uy);
  const pel = px(a, pelvis);

  // --- legs geometry (needed for the hips bone)
  const legGeo: { g: LimbResult; side: 'L' | 'R' }[] = [];
  if (splitLegs) {
    const [l, r] = splitLegs[0].bottom[0] <= splitLegs[1].bottom[0] ? splitLegs : [splitLegs[1], splitLegs[0]];
    legGeo.push({ g: straightLimb(l.top, l.bottom), side: 'L' }, { g: straightLimb(r.top, r.bottom), side: 'R' });
  } else {
    legs.forEach((e) => {
      const side: 'L' | 'R' = legs.length === 2 ? (e === legs[0] ? 'L' : 'R') : e.tipX < cx ? 'L' : 'R';
      const g = limbGeometry(a, parent, pelvis, e);
      snapMid(a, g, guide?.joints[`leg${side}2` as BoneRole], guide);
      legGeo.push({ g, side });
    });
    const gl = legGeo.find((l) => l.side === 'L')?.g;
    const gr = legGeo.find((l) => l.side === 'R')?.g;
    if (gl && gr) uncrossStarts(gl, gr, guide?.joints['legL1' as BoneRole], guide?.joints['legR1' as BoneRole], guide);
  }
  const hipPts = legGeo.map((l) => l.g.start);
  let hipMid: P2 = hipPts.length
    ? [hipPts.reduce((s, p) => s + p[0], 0) / hipPts.length, hipPts.reduce((s, p) => s + p[1], 0) / hipPts.length]
    : [pel[0], pel[1] + 2];
  if (Math.hypot(hipMid[0] - pel[0], hipMid[1] - pel[1]) < 2) hipMid = [pel[0], pel[1] + Math.max(2, a.limbR)];
  fit.bones.push({ name: 'hips', role: 'hips', parent: null, a: pel, b: hipMid });
  fit.bones.push({ name: 'spine', role: 'spine', parent: null, a: pel, b: neck });
  fit.bones.push({ name: 'head', role: 'head', parent: 'spine', a: neck, b: headTip });
  for (const m of arms.sort((p, q) => (p.side < q.side ? -1 : 1))) {
    const g = limbGeometry(a, parent, m.attach, m.e, { held: true, farPin: raised.has(m.e) || hugging.has(m.e) });
    snapMid(a, g, guide?.joints[`arm${m.side}2` as BoneRole], guide);
    pushLimb(fit, g, [`arm${m.side}1`, `arm${m.side}2`], [`arm${m.side}1` as BoneRole, `arm${m.side}2` as BoneRole], 'spine');
    if (g.held) {
      const held = fit.bones[fit.bones.length - 1];
      held.name = held.name.replace(/^held/, 'wand');
      fit.notes.push('The thin thing in a hand looks like something being held, so it stays stiff.');
    }
  }
  for (const l of legGeo) {
    pushLimb(fit, l.g, [`leg${l.side}1`, `leg${l.side}2`], [`leg${l.side}1` as BoneRole, `leg${l.side}2` as BoneRole], 'hips');
  }
  // limbs the guide placed that the drawing doesn't show where expected
  if (guide?.keepUnsnapped) {
    for (const s of SLOTS.biped) {
      if (s.slot === 'head' || !guide.unsnapped.has(s.slot)) continue;
      if (fit.bones.some((b) => b.role === s.roles[0])) continue;
      const pts = slotPoints(guide, s);
      if (!pts) continue;
      const parentName = s.slot.startsWith('arm') ? 'spine' : 'hips';
      pushLimb(fit, { start: pts[0], mid: pts[1], tip: pts[2] }, [s.roles[0], s.roles[1]], [s.roles[0], s.roles[1]], parentName);
    }
  }
  // the head end may run on through something thin on top of the head (an antenna, a feather, a
  // ponytail): that part is a wiggly bit of its own
  const onTop = spinePath.slice(hI);
  const bi = onTop.findIndex((p) => a.dt[p] < 0.45 * hcD && Math.hypot((p % a.w) - hc[0], Math.floor(p / a.w) - hc[1]) > 0.9 * hcD);
  const beyond = bi >= 0 ? onTop[bi] : undefined;
  const stalk = bi >= 0 ? onTop.slice(bi).map((p) => a.dt[p]).sort((x, y) => x - y) : [];
  if (beyond !== undefined && stalk.length >= 0.1 * a.maxDim && stalk[Math.floor(stalk.length / 2)] < 0.3 * hcD &&
    Math.hypot(head.tipX - headTip[0], head.tipY - headTip[1]) > 0.08 * a.maxDim) {
    const base = castToEdge(a, hc, (px(a, beyond)[0] - hc[0]) / Math.max(1e-6, Math.hypot(px(a, beyond)[0] - hc[0], px(a, beyond)[1] - hc[1])),
      (px(a, beyond)[1] - hc[1]) / Math.max(1e-6, Math.hypot(px(a, beyond)[0] - hc[0], px(a, beyond)[1] - hc[1])));
    fit.bones.push({ name: nextName(fit, 'extra'), role: 'extra', parent: 'head', a: base, b: [head.tipX, head.tipY], dynamic: true });
  }
  [...arms.map((m) => m.e), ...legs, head].forEach((e) => fit.used.add(e));
  const feet = fit.bones.filter((b) => b.role === 'legL2' || b.role === 'legR2').map((b) => b.b[0]);
  fit.anchor = [feet.length ? feet.reduce((s, x) => s + x, 0) / feet.length : cx, bbox.y1 + 0.5];
  return fit;
}
