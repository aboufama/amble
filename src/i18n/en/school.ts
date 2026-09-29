/**
 * Student-facing strings for M7 (FOUNDATION-STUB: only what the stub Join card shows; M7 replaces it).
 * Keys are flat. `staff_` keys are for teachers and IT (exempt from the banned-word check); `page_` keys
 * may be long paragraphs (in-app pages); `legacy_` keys may name the old block editor.
 */
import type { Strings } from '../types';

export const school = {
  joinTitle: 'Join {cls}?',
  joinBody: "Your teacher's AI helper will turn on for Amble on this Chromebook. Your drawings stay yours and stay here.",
  join: 'Join',
  notNow: 'Not now',
  switchTitle: "You're in {current} on this Chromebook. Switch to {next}?",
  switchClass: 'Switch',
  keepClass: 'Keep {current}',
  linkTitle: 'Class link',
  expired: 'This class link has expired. Ask your teacher for a new one. Amble still works without it.',
  unsafe: "This link doesn't look safe, so Amble ignored it.",
  damaged: 'This class link is damaged. Ask your teacher for a new one.',
  goToAmble: 'Go to Amble',
  handinStub: 'Save your world, then turn it in.',
} satisfies Strings;
