/**
 * Jingles: short tunes for moments in a game (win, lose, level up, game over...), written as
 * scale steps and beats, and played on a choice of instruments. Unlike music loops they end.
 */

import type { Fx, Layer, Recipe } from './engine';
import { PATCHES, cymbal, timpani, type PatchName } from './instruments';

export interface Jingle {
  id: string;
  name: string;
  tags: string;
  about: string;
  /** Minor scale (sad, ominous) instead of major. */
  minor?: boolean;
  /** A crash and a drum on the last note. */
  big?: boolean;
  /** Each tune: [beats per minute, "step:beats ..."]. Steps 1..7 of the scale; ' = octave up, , = down; b and # bend; - = rest. */
  tunes: Array<readonly [number, string]>;
}

export interface JingleVoice {
  id: string;
  name: string;
  tags: string;
  about: string;
  lead: PatchName;
  /** Plays the chord under the last note. */
  pad?: PatchName;
  bass?: PatchName;
  drums?: boolean;
  /** Semitones up or down. */
  shift?: number;
  fx?: Fx;
}

export interface JingleKey {
  word: string;
  tags: string;
  semis: number;
  tempo: number;
}

export const JINGLE_VOICES: JingleVoice[] = [
  { id: 'chip', name: 'Chiptune', tags: 'chiptune 8-bit retro arcade pixel square', about: 'square waves like an old console', lead: 'squareLead', pad: 'chipChord', bass: 'triBass', fx: { crush: [8, 1] } },
  { id: 'brass', name: 'Brass', tags: 'brass trumpet horns fanfare band heroic', about: 'trumpets with a tuba and timpani', lead: 'trumpet', pad: 'brass', bass: 'tuba', drums: true, fx: { rev: [0.25, 0.5] } },
  { id: 'bells', name: 'Bell', tags: 'bells chime glockenspiel music box sparkle cute', about: 'bells and a music box', lead: 'glock', pad: 'musicBox', shift: 12, fx: { rev: [0.3, 0.5] } },
  { id: 'orch', name: 'Orchestra', tags: 'orchestra orchestral strings violin epic cinematic', about: 'strings, with timpani and a cymbal', lead: 'violin', pad: 'strings', bass: 'pluckBass', drums: true, fx: { rev: [0.35, 0.6] } },
  { id: 'marimba', name: 'Marimba', tags: 'marimba xylophone wooden mallet playful light', about: 'a marimba', lead: 'marimba', pad: 'kalimba', bass: 'pluckBass', fx: { rev: [0.2, 0.4] } },
  { id: 'synth', name: 'Synth', tags: 'synth synthesizer electronic modern saw', about: 'a bright synthesizer with an echo', lead: 'sawLead', pad: 'pad', bass: 'sawBass', fx: { del: [0.25, 0.16, 0.35], rev: [0.2, 0.45] } },
];

export const JINGLE_KEYS: JingleKey[] = [
  { word: '', tags: 'medium', semis: 0, tempo: 1 },
  { word: 'High', tags: 'high bright quick small light', semis: 5, tempo: 1.12 },
];

export const JINGLES: Jingle[] = [
  { id: 'win', name: 'Win Jingle', tags: 'win victory won success triumph you win winner celebrate hooray yay cheer', about: 'a bright rising victory tune', big: true, tunes: [[150, "1:0.5 3:0.5 5:0.5 1':1 5:0.5 1':2"], [160, "5,:0.25 1:0.25 3:0.25 5:0.75 6:0.5 7:0.5 1':2"], [144, "3:0.5 3:0.25 4:0.25 5:0.5 1':0.5 7:0.5 2':0.5 1':2"]] },
  { id: 'lose', name: 'Lose Jingle', tags: 'lose lost defeat fail failed failure you lose sad loser try again', about: 'a short falling sad tune', minor: true, tunes: [[110, '5:0.5 4:0.5 3:0.5 1:2'], [120, "1':0.5 7:0.5 6:0.5 5:0.5 3:1 1:2"], [100, '5:0.4 b5:0.4 4:0.4 3:0.4 1:2']] },
  { id: 'levelup', name: 'Level Up Jingle', tags: 'level up levelup level-up next stage rank advance promotion upgrade progress', about: 'a quick climbing tune for reaching the next level', big: true, tunes: [[170, "1:0.25 3:0.25 5:0.25 1':0.25 3':0.25 5':1.5"], [160, "5:0.25 6:0.25 7:0.25 1':0.5 3':0.25 1':0.25 5':1.5"], [150, "1:0.33 2:0.33 3:0.34 5:0.5 1':1.5"]] },
  { id: 'gameover', name: 'Game Over Jingle', tags: 'game over gameover end dead died finished the end lose final', about: 'a slow, falling game-over tune', minor: true, tunes: [[84, "1':1 5:1 3:1 1:2.5"], [96, '5:0.75 5:0.25 4:0.5 3:0.5 2:0.5 1:2.5'], [80, '3:0.5 2:0.5 1:1 #7,:1 1:2.5']] },
  { id: 'fanfare', name: 'Fanfare', tags: 'fanfare flourish announce royal trumpet herald grand ceremony champion trophy', about: 'a proud flourish, like trumpets announcing a champion', big: true, tunes: [[132, "5,:0.25 5,:0.25 5,:0.25 1:0.75 5,:0.25 1:0.25 3:0.25 5:0.75 3:0.25 5:0.25 1':2.5"], [126, "1:0.5 1:0.25 1:0.25 3:0.5 5:0.5 3:0.5 5:0.5 1':2.5"], [138, "5:0.33 5:0.33 5:0.34 1':1 7:0.5 6:0.5 5:0.5 1':2"]] },
  { id: 'start', name: 'Start Jingle', tags: 'start begin ready go intro opening get ready set here we go round new game', about: 'a short get-ready tune', tunes: [[132, "1:0.5 -:0.5 1:0.5 -:0.5 1:0.5 -:0.5 1':1.5"], [140, "5,:0.5 1:0.5 3:0.5 5:0.5 1':1.5"], [150, "1:0.25 1:0.25 5:0.5 1:0.25 1:0.25 5:0.5 1':1.5"]] },
  { id: 'bonus', name: 'Bonus Jingle', tags: 'bonus extra reward prize points combo perfect great nice well done', about: 'a tiny sparkling reward tune', tunes: [[160, "3:0.25 5:0.25 1':0.25 3':1"], [170, "1':0.25 5:0.25 1':0.25 5':1"], [180, "5:0.2 6:0.2 7:0.2 1':0.2 2':0.2 3':1.2"]] },
  { id: 'secret', name: 'Secret Jingle', tags: 'secret discovery discover found hidden mystery reveal surprise treasure room puzzle', about: 'a curious, mysterious tune for finding a secret', tunes: [[150, "1:0.33 #4:0.33 5:0.34 1':0.33 #4':0.33 5':1.6"], [140, "1:0.25 3:0.25 #4:0.25 6:0.25 7:0.25 2':0.25 3':1.75"], [132, "5:0.5 #4:0.5 5:0.5 2':0.5 1':2"]] },
  { id: 'itemget', name: 'Item Jingle', tags: 'item get got found obtain new treasure chest open reward collect acquire', about: 'a proud little tune for getting something new', big: true, tunes: [[120, '1:0.5 2:0.5 3:0.5 5:2'], [126, '5,:0.5 1:0.5 2:0.5 3:0.5 5:2'], [132, "3:0.33 4:0.33 5:0.34 1':2"]] },
  { id: 'checkpoint', name: 'Checkpoint Jingle', tags: 'checkpoint save flag progress saved waypoint halfway continue', about: 'two or three quick bright notes', tunes: [[150, "5:0.25 1':1"], [150, "1:0.25 5:0.25 1':1"], [160, "3:0.25 5:0.25 3':1"]] },
  { id: 'death', name: 'Oops Jingle', tags: 'death die dead lost life oops fall fail hurt ko knocked out funny whoops uh-oh', about: 'a quick comic tumble down the scale', minor: true, tunes: [[150, "1':0.2 7:0.2 b7:0.2 6:0.2 b6:0.2 5:0.2 1:1.4"], [140, '5:0.3 3:0.3 1:0.3 5,:0.3 1,:1.4'], [170, "1':0.15 5:0.15 3:0.15 1:0.15 5,:0.15 3,:0.15 1,:1.4"]] },
  { id: 'complete', name: 'Stage Clear Jingle', tags: 'stage clear complete completed finish finished level done goal reached course mission success', about: 'a longer cheerful tune for finishing a stage', big: true, tunes: [[150, "1:0.5 3:0.5 5:0.5 6:0.5 5:0.5 6:0.5 7:0.5 1':0.5 -:0.25 5:0.25 1':2"], [144, "5:0.5 5:0.25 6:0.25 5:0.5 3:0.5 4:0.5 5:0.5 6:0.5 7:0.5 1':2.5"], [160, "1:0.25 2:0.25 3:0.25 4:0.25 5:0.5 3:0.5 6:0.5 4:0.5 7:0.5 5:0.5 1':2.5"]] },
  { id: 'tada', name: 'Ta-da', tags: 'ta-da tada reveal present magic trick surprise show finished look voila', about: 'ta-da: a quick pickup and a big held chord', big: true, tunes: [[120, "5:0.2 1':2"], [132, "1:0.15 3:0.15 5:0.15 1':2"], [120, '5,:0.2 5:2']] },
  { id: 'wahwah', name: 'Sad Trombone', tags: 'sad trombone wah wah womp fail joke funny disappointment loser aww', about: 'wah, wah, wah, waaah: four sinking notes', minor: true, tunes: [[96, '5:0.6 b5:0.6 4:0.6 3:2.2'], [100, '3:0.5 b3:0.5 2:0.5 b2:0.5 1:2'], [90, '1:0.7 7,:0.7 b7,:0.7 6,:2.4']] },
  { id: 'boss', name: 'Danger Stinger', tags: 'boss danger warning ominous villain appears threat dramatic dun dun suspense enemy alert doom', about: 'a low, ominous stinger: something bad has arrived', minor: true, big: true, tunes: [[80, '1,:1 b2,:1 1,:2.5'], [96, '1:0.5 b6:0.5 5:0.5 b2:0.5 1:2.5'], [108, '5,:0.33 5,:0.33 5,:0.34 b6,:2.8']] },
  { id: 'sleep', name: 'Rest Jingle', tags: 'rest sleep inn night goodnight heal bed nap lullaby dream save calm', about: 'a slow, soothing cadence, like resting at an inn', tunes: [[84, '3:0.75 2:0.75 1:0.75 5,:0.75 1:2.5'], [76, '5:1 3:1 4:1 2:1 1:3'], [88, "1':0.75 6:0.75 5:0.75 3:0.75 1:2.5"]] },
  { id: 'unlock', name: 'Achievement Jingle', tags: 'achievement unlock unlocked trophy medal badge new record reward earned star congratulations', about: 'a bright sparkling tune for earning something', big: true, tunes: [[170, "1:0.25 5:0.25 1':0.25 5:0.25 1':0.25 3':1.5"], [160, "3:0.25 5:0.25 7:0.25 2':0.25 3':1.75"], [176, "5:0.25 1':0.25 5:0.25 2':0.25 5:0.25 3':1.5"]] },
  { id: 'hurry', name: 'Hurry Jingle', tags: 'hurry time up timeup running out warning quick countdown urgent last lap alarm faster', about: 'an urgent little tune: time is running out', minor: true, tunes: [[168, "1':0.25 1':0.25 -:0.25 1':0.25 1':0.25 -:0.25 b6:1.5"], [176, "5:0.25 #5:0.25 6:0.25 #6:0.25 7:0.25 1':1.5"], [184, "1':0.25 5:0.25 1':0.25 5:0.25 1':0.25 5:0.25 b2':1.5"]] },
  { id: 'highscore', name: 'High Score Jingle', tags: 'high score highscore record best champion top first place winner number one leaderboard', about: 'a sparkling run up to a held high note', big: true, tunes: [[168, "1:0.25 3:0.25 5:0.25 1':0.25 5:0.25 1':0.25 3':0.25 5':1.75"], [150, "5:0.5 1':0.5 7:0.25 1':0.25 2':0.5 5:0.5 3':2"], [176, "1':0.33 5:0.33 3:0.34 5:0.33 1':0.33 3':0.34 5':2"]] },
  { id: 'solved', name: 'Solved Jingle', tags: 'solved puzzle correct right answer yes got it complete match clever riddle', about: 'a gentle, satisfied resolve for a solved puzzle', tunes: [[120, "5:0.5 6:0.5 7:0.5 1':2"], [132, "3:0.33 5:0.33 6:0.34 3':2"], [120, "2:0.5 5:0.5 1':2"]] },
  { id: 'wrong', name: 'Wrong Jingle', tags: 'wrong incorrect no mistake error oops miss bad answer nope try again', about: 'two or three sinking notes: not quite', minor: true, tunes: [[140, '3:0.25 1:1'], [130, '5:0.2 b5:0.2 4:1'], [150, "1':0.2 b7:0.2 5:1"]] },
  { id: 'shop', name: 'Shop Jingle', tags: 'shop buy bought purchase store sold trade thank you market deal cute', about: 'a cute little thank-you tune', tunes: [[150, "5:0.25 3:0.25 1':1"], [160, "1:0.25 3:0.25 5:0.25 3:0.25 1':1"], [144, "3:0.5 5:0.25 6:0.25 5:1"]] },
];

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

interface TuneNote {
  /** Semitones above the key note, or null for a rest. */
  semis: number | null;
  /** Scale step 0..6. */
  step: number;
  beats: number;
}

export function parseTune(tune: string, minor: boolean): TuneNote[] {
  const scale = minor ? MINOR : MAJOR;
  const out: TuneNote[] = [];
  for (const token of tune.trim().split(/\s+/)) {
    const m = /^(-|([b#]?)([1-7])([',]*)):([\d.]+)$/.exec(token);
    if (!m) continue;
    const beats = Number(m[5]);
    if (m[1] === '-') {
      out.push({ semis: null, step: 0, beats });
      continue;
    }
    const step = Number(m[3]) - 1;
    let semis = scale[step] + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0);
    for (const ch of m[4]) semis += ch === "'" ? 12 : -12;
    out.push({ semis, step, beats });
  }
  return out;
}

/** The recipe for one jingle: a tune, on an instrument, in a key. */
export function jingleRecipe(j: Jingle, take: number, voice: JingleVoice, key: JingleKey): Recipe {
  const [bpm, tune] = j.tunes[take % j.tunes.length];
  const beat = 60 / (bpm * key.tempo);
  const notes = parseTune(tune, Boolean(j.minor));
  const base = 523.25 * Math.pow(2, (key.semis + (voice.shift ?? 0)) / 12);
  const hz = (semis: number): number => base * Math.pow(2, semis / 12);
  const at = (layers: Layer[], t: number, vol = 1): Layer[] => layers.map((L) => ({ ...L, t: (L.t ?? 0) + t, v: (L.v ?? 0.7) * vol }));
  const layers: Layer[] = [];
  let t = 0;
  const sounding = notes.filter((n) => n.semis !== null);
  const last = sounding[sounding.length - 1];
  notes.forEach((n) => {
    if (n.semis !== null) {
      const isLast = n === last;
      layers.push(...at(PATCHES[voice.lead](hz(n.semis), n.beats * beat * (isLast ? 0.95 : 0.85), isLast ? 1 : 0.85), t));
      if (isLast) {
        // The chord under the last note: the home chord if the note belongs to it, else the chord built on the note.
        const scale = j.minor ? MINOR : MAJOR;
        const home = n.step === 0 || n.step === 2 || n.step === 4;
        const root = home ? 0 : scale[n.step];
        const third = home ? scale[2] : scale[(n.step + 2) % 7] + (n.step + 2 >= 7 ? 12 : 0);
        const fifth = home ? 7 : scale[(n.step + 4) % 7] + (n.step + 4 >= 7 ? 12 : 0);
        const dur = n.beats * beat * 0.95;
        if (voice.pad) for (const s of [root, third, fifth]) layers.push(...at(PATCHES[voice.pad](hz(s - 12), dur, 0.7), t, 0.28));
        if (voice.bass) layers.push(...at(PATCHES[voice.bass](hz(root - 36), dur, 0.9), t, 0.5));
        if (voice.drums && j.big) layers.push(...at(timpani(hz(root - 36), 1.1), t, 0.5), ...at(cymbal(1.6, 0.5), t, 0.4));
      }
    }
    t += n.beats * beat;
  });
  // A bass note under the first beat grounds the longer tunes.
  if (voice.bass && sounding.length >= 5 && sounding[0].semis !== null) layers.push(...at(PATCHES[voice.bass](hz(-24), beat * 0.9, 0.8), 0, 0.6));
  return { layers, fx: voice.fx, seed: take + 1, sr: 22050 };
}
