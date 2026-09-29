/**
 * How a footstep reads (§2.9): who made it, its words (with the lead in bold), when, and which actions it
 * offers. Also the texts Footsteps writes itself ("You went back to …", "You changed boss.js").
 */
import { t } from '../i18n';
import type { StepSummary } from '../model/types';

export type StepLook = 'you' | 'ai' | 'fix' | 'teacher';

/** The footprint a step gets: the student's cream, the AI's dusk blue, a small dot for fixes and refusals. */
export function lookOf(step: StepSummary): StepLook {
  if (step.by === 'auto' || step.kind === 'refused') return 'fix';
  if (step.by === 'ai') return 'ai';
  if (step.by === 'teacher') return 'teacher';
  return 'you';
}

/**
 * Splits a step's words for display: `lead` is bold. "You turned Jump height up to 820." bolds the part
 * before "to 820."; an AI step that starts with "Amble" bolds that word (shown in `--ai`).
 */
export function splitText(step: StepSummary): { lead: string; rest: string } {
  const text = step.text;
  if (lookOf(step) === 'ai') {
    const m = /^(Amble)(\b.*)$/s.exec(text);
    return m ? { lead: m[1], rest: m[2] } : { lead: '', rest: text };
  }
  if (lookOf(step) === 'fix') return { lead: '', rest: text };
  if (step.kind === 'goback') {
    const back = /^(.+?)( '.*')$/s.exec(text);
    return back ? { lead: back[1], rest: back[2] } : { lead: text, rest: '' };
  }
  const m = step.kind === 'dials' ? /^(.+?)( to -?[\d.,]+\.?)$/.exec(text) : null;
  return m ? { lead: m[1], rest: m[2] } : { lead: text, rest: '' };
}

/** "now", "6 min", "2 h", "Yesterday", or a short date. */
export function timeAgo(at: number, now: number = Date.now()): string {
  const ms = Math.max(0, now - at);
  const min = Math.floor(ms / 60_000);
  if (min < 1) return t('history.timeNow');
  if (min < 60) return t('history.timeMin', { n: min });
  const then = new Date(at);
  const today = new Date(now);
  const sameDay = then.toDateString() === today.toDateString();
  if (sameDay || ms < 6 * 3_600_000) return t('history.timeHour', { n: Math.floor(min / 60) });
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) return t('history.timeYesterday');
  return then.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

/** The full time, for a tooltip and screen readers ("Sep 29, 10:42 AM"). */
export function fullTime(at: number): string {
  return new Date(at).toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "You went back to 'You turned Jump height up to 820'". */
export function wentBackText(target: StepSummary): string {
  return t('history.wentBack', { step: target.text.replace(/[.!]+$/, '') });
}

/** The footstep for Run it: "You changed boss.js", "You changed game.js and boss.js", "You changed 3 files". */
export function codeStepText(files: readonly string[]): string {
  if (files.length === 1) return t('history.changedOne', { file: files[0] });
  if (files.length === 2) return t('history.changedTwo', { a: files[0], b: files[1] });
  return t('history.changedMany', { n: files.length });
}

/** Steps whose change is worth opening: code, drawings, AI work, going back, imports. */
export function canSeeChange(step: StepSummary): boolean {
  if (step.kind === 'start' || step.kind === 'refused' || step.kind === 'handin') return false;
  if (step.by === 'ai' || step.by === 'auto') return true;
  return ['code', 'ask', 'fix', 'goback', 'draw', 'redraw', 'cast', 'import', 'sound'].includes(step.kind);
}

/** Who made a step, for the See the change sheet ("AI helper · 6 min"). */
export function whoOf(step: StepSummary): string {
  switch (step.by) {
    case 'ai':
      return t('history.byAi');
    case 'auto':
      return t('history.byAuto');
    case 'teacher':
      return t('history.byTeacher');
    default:
      return t('history.byYou');
  }
}
