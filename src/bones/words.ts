/**
 * The rig core's English labels, notes and issue codes in the app's own words (`src/i18n/en/bones.ts`):
 * joint names ("Left elbow"), bone names ("left upper arm"), why Amble guessed, the moves and the kinds.
 */
import { t, type MessageKey } from '../i18n';
import type { CharacterKind, FitIssue, Joint, RigData, Side } from '../cores/rig';
import { sideOf } from '../cores/rig';

const JOINT_PARTS: Record<string, MessageKey> = {
  hips: 'bones.jpHips',
  neck: 'bones.jpNeck',
  head: 'bones.jpHead',
  'head top': 'bones.jpHeadTop',
  shoulder: 'bones.jpShoulder',
  elbow: 'bones.jpElbow',
  hand: 'bones.jpHand',
  hip: 'bones.jpHip',
  knee: 'bones.jpKnee',
  foot: 'bones.jpFoot',
  back: 'bones.jpBack',
  shoulders: 'bones.jpShoulders',
  nose: 'bones.jpNose',
  'front shoulder': 'bones.jpFrontShoulder',
  'front knee': 'bones.jpFrontKnee',
  'front paw': 'bones.jpFrontPaw',
  'back hip': 'bones.jpBackHip',
  'back knee': 'bones.jpBackKnee',
  'back paw': 'bones.jpBackPaw',
  'tail base': 'bones.jpTailBase',
  'tail bend': 'bones.jpTailBend',
  'tail tip': 'bones.jpTailTip',
  'wing root': 'bones.jpWingRoot',
  'wing bend': 'bones.jpWingBend',
  'wing tip': 'bones.jpWingTip',
  body: 'bones.jpBody',
  chest: 'bones.jpChest',
  bottom: 'bones.jpBottom',
  middle: 'bones.jpMiddle',
  top: 'bones.jpTop',
  wheel: 'bones.jpWheel',
  'wheel rim': 'bones.jpWheelRim',
  wiggly: 'bones.jpWiggly',
  'wiggly tip': 'bones.jpWigglyTip',
};

/** Every joint key the rig core uses (tests check each has words). */
export const JOINT_KEYS = Object.keys(JOINT_PARTS);

const capitalize = (s: string) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);

function numberOf(name: string): string {
  return /(\d+)$/.exec(name)?.[1] ?? '';
}

/** "Left elbow", "Neck", "Wiggly bit 2 tip": a joint in words, by its key and side. */
export function jointName(rig: RigData, j: Joint): string {
  const key = JOINT_PARTS[j.key];
  const bone = rig.bones[j.ends[0]?.bone ?? 0];
  const n = bone ? numberOf(bone.name) : '';
  const part = key ? t(key, { n }).replace(/\s+/g, ' ').trim() : t('bones.jpStar');
  // wheels and wiggly bits carry their number instead of a side
  const own = j.key === 'wheel' || j.key === 'wheel rim' || j.key === 'wiggly' || j.key === 'wiggly tip';
  const side: Side = own ? 'C' : j.side;
  const text = side === 'L' ? t('bones.sideLeft', { part }) : side === 'R' ? t('bones.sideRight', { part }) : t('bones.sideNone', { part });
  return capitalize(text);
}

/** "left upper arm", "wiggly bit 2": a bone in words (lower case, for sentences). */
export function boneName(rig: RigData, i: number): string {
  const b = rig.bones[i];
  if (!b) return '';
  const role = b.role;
  const n = numberOf(b.name);
  let key: MessageKey;
  let sided = true;
  if (role === 'extra') {
    sided = false;
    key = /^wheel/.test(b.name) ? 'bones.bnWheel' : b.rigid ? 'bones.bnHeld' : b.dynamic ? 'bones.bnWiggly' : 'bones.bnExtra';
  } else if (/^arm[LR]1$/.test(role)) key = 'bones.bnArm1';
  else if (/^arm[LR]2$/.test(role)) key = 'bones.bnArm2';
  else if (/^leg[LR]1$/.test(role)) key = 'bones.bnLeg1';
  else if (/^leg[LR]2$/.test(role)) key = 'bones.bnLeg2';
  else if (/^legF[LR]1$/.test(role)) key = 'bones.bnLegF1';
  else if (/^legF[LR]2$/.test(role)) key = 'bones.bnLegF2';
  else if (/^legB[LR]1$/.test(role)) key = 'bones.bnLegB1';
  else if (/^legB[LR]2$/.test(role)) key = 'bones.bnLegB2';
  else if (/^wing[LR]1$/.test(role)) key = 'bones.bnWing1';
  else if (/^wing[LR]2$/.test(role)) key = 'bones.bnWing2';
  else {
    sided = false;
    const plain: Record<string, MessageKey> = {
      hips: 'bones.bnHips', spine: 'bones.bnSpine', neck: 'bones.bnNeck', head: 'bones.bnHead',
      body: 'bones.bnBody', top: 'bones.bnTop', tail1: 'bones.bnTail', tail2: 'bones.bnTail', tail3: 'bones.bnTail',
    };
    key = plain[role] ?? 'bones.bnExtra';
  }
  const word = t(key, { n: role.startsWith('tail') ? role.slice(4) : n }).replace(/\s+/g, ' ').trim();
  if (!sided) return word;
  const side = sideOf(rig, i);
  if (side === 'C') return word;
  return (side === 'L' ? t('bones.sideLeft', { part: word }) : t('bones.sideRight', { part: word })).toLocaleLowerCase();
}

/** The bone in words with its state, for the bone list ("left upper arm", "tail, part 1, springy"). */
export function boneListName(rig: RigData, i: number): string {
  const b = rig.bones[i];
  const name = capitalize(boneName(rig, i));
  if (b?.rigid) return t('bones.treeHeld', { bone: name });
  if (b?.dynamic) return t('bones.treeSpringy', { bone: name });
  return name;
}

const ISSUES: Record<FitIssue, MessageKey> = {
  'no-head': 'bones.issueNoHead',
  'no-legs': 'bones.issueNoLegs',
  'one-leg': 'bones.issueOneLeg',
  'legs-merged': 'bones.issueLegsMerged',
  'missing-arm': 'bones.issueMissingArm',
  'no-arms': 'bones.issueNoArms',
  'few-legs': 'bones.issueFewLegs',
  'missing-wing': 'bones.issueMissingWing',
  'no-tail': 'bones.issueNoTail',
  'short-body': 'bones.issueShortBody',
  'hint-dropped': 'bones.issueHintDropped',
  'thin-strokes': 'bones.issueThinStrokes',
};

/** Every issue code the rig core reports (tests check each has words). */
export const ISSUE_CODES = Object.keys(ISSUES) as FitIssue[];

/** Why Amble guessed, in words. */
export function issueText(issue: FitIssue): string {
  const key = ISSUES[issue];
  return key ? t(key) : t('bones.issueUnknown');
}

/**
 * Issue codes behind the rig core's English notes. Drawings rigged elsewhere (Bring to life) keep only
 * the notes in `rigInfo`; these say which sentence of ours each one is.
 */
const NOTE_ISSUES: Array<[RegExp, FitIssue]> = [
  [/looked stuck together/i, 'legs-merged'],
  [/found one leg/i, 'one-leg'],
  [/couldn't find legs/i, 'no-legs'],
  [/found one arm/i, 'missing-arm'],
  [/couldn't find the arms/i, 'no-arms'],
  [/couldn't find both wings/i, 'missing-wing'],
  [/found \d+ legs/i, 'few-legs'],
  [/helper's joints didn't match/i, 'hint-dropped'],
];

export function issuesFromNotes(notes: readonly string[]): FitIssue[] {
  const out: FitIssue[] = [];
  for (const note of notes) {
    const hit = NOTE_ISSUES.find(([re]) => re.test(note));
    if (hit && !out.includes(hit[1])) out.push(hit[1]);
  }
  return out;
}

/** The reasons for the guess note: our words for known issues, else nothing (the note says a default). */
export function guessReasons(issues: readonly FitIssue[], notes: readonly string[]): string[] {
  const codes = issues.length ? [...issues] : issuesFromNotes(notes);
  // one reason per sentence, the ones a student can act on first, at most two
  const order: FitIssue[] = ['legs-merged', 'one-leg', 'missing-arm', 'no-arms', 'no-head', 'few-legs', 'missing-wing', 'no-legs', 'hint-dropped', 'short-body', 'thin-strokes', 'no-tail'];
  const sorted = [...new Set(codes)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return sorted.slice(0, 2).map(issueText);
}

// ---------------------------------------------------------------- moves

/** The move buttons: the eight every character gets, plus one of the kind's own (§2.11). */
export function movesFor(kind: CharacterKind): string[] {
  const base = ['idle', 'walk', 'run', 'jump', 'fall', 'hurt', 'attack', 'wave'];
  const extra: Partial<Record<CharacterKind, string>> = { flyer: 'fly', swimmer: 'swim', blob: 'wiggle', object: 'wiggle' };
  const own = extra[kind];
  return own ? [own, ...base] : base;
}

/** The move the preview plays first: how the kind gets around. */
export function firstMove(kind: CharacterKind): string {
  return kind === 'flyer' ? 'fly' : kind === 'swimmer' ? 'swim' : 'walk';
}

const MOVE_WORDS: Record<string, MessageKey> = {
  idle: 'bones.moveIdle',
  walk: 'bones.moveWalk',
  run: 'bones.moveRun',
  jump: 'bones.moveJump',
  fall: 'bones.moveFall',
  hurt: 'bones.moveHurt',
  attack: 'bones.moveAttack',
  wave: 'bones.moveWave',
  fly: 'bones.moveFly',
  swim: 'bones.moveSwim',
  wiggle: 'bones.moveWiggle',
  spin: 'bones.moveSpin',
};

export function moveWord(clip: string): string {
  const key = MOVE_WORDS[clip];
  return key ? t(key) : clip;
}

const NOW_WORDS: Record<string, MessageKey> = {
  idle: 'bones.nowIdle',
  walk: 'bones.nowWalk',
  run: 'bones.nowRun',
  jump: 'bones.nowJump',
  rise: 'bones.nowRise',
  fall: 'bones.nowFall',
  land: 'bones.nowLand',
  hurt: 'bones.nowHurt',
  attack: 'bones.nowAttack',
  shoot: 'bones.nowShoot',
  wave: 'bones.nowWave',
  win: 'bones.nowWin',
  die: 'bones.nowDie',
  dash: 'bones.nowDash',
  fly: 'bones.nowFly',
  glide: 'bones.nowGlide',
  swim: 'bones.nowSwim',
  wiggle: 'bones.nowWiggle',
  spin: 'bones.nowSpin',
  rage: 'bones.nowRage',
};

/** What the preview's pill says while a move plays ("Walking"). */
export function nowWord(clip: string): string {
  const key = NOW_WORDS[clip];
  return key ? t(key) : moveWord(clip);
}

// ---------------------------------------------------------------- kinds and facing

export { facingPhrase, facingWord, kindPhrase, rigFacing } from './kindWords';
