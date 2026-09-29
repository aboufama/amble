/**
 * Student-facing strings for M6: saving and opening files, storage states, the old-Amble rescue and the
 * app's offline life. Grade 4-5 reading level, sentences of 15 words or fewer, none of the banned words.
 * Keys are flat. `legacy_` keys may name the old block editor (exempt from the banned-word check).
 */
import type { Strings } from '../types';

export const files = {
  saveToDrive: 'Save to Drive',
  saveFile: 'Save file',
  saving: 'Saving…',
  openFile: 'Open a file',
  openIt: 'Open it',
  notNow: 'Not now',
  why: 'Why?',

  stateSaved: 'Saved on this Chromebook',
  stateSaving: 'Saving…',
  stateFull: 'Not saved here: space is full.',
  stateFilesOnly: 'Only saved in files',
  stateError: 'Not saved here yet. Amble keeps trying.',
  lastSavedToDrive: 'Last saved to Drive {time}',
  lastSavedToFile: 'Last saved to a file {time}',

  savedToDrive: 'Saved to Drive {time}',
  savedToFile: 'Saved {name}',
  savedDownload: 'It went to your Downloads (or Drive, if your school set it up).',
  saveFailed: "Amble couldn't save the file. Try again, or pick another place.",
  saveCancelled: 'Nothing was saved.',

  readOnlyTitle: 'A read-only copy',
  readOnly: 'This copy is read-only (was it turned in?). Save your own copy to keep working.',
  saveOwnCopy: 'Save my own copy',
  assignmentTitle: 'From your teacher',
  assignmentCopy: "This is a starter from your teacher. It's yours now: save your own copy.",

  bigFileTitle: 'A big world',
  bigFile: 'This world is {mb} MB, which is big for a Chromebook. Amble will still open it.',
  tooBigTitle: 'Too big to open',
  tooBig: 'This world is {mb} MB, which is too big to open here.',
  notAmble: "This file isn't an Amble world, or it's damaged.",
  partlyDamaged: 'This file is damaged. Amble opened what it could: {n} of {total} drawings.',
  damagedSome: 'This file is damaged. Amble opened what it could.',
  newer: 'This world was made with a newer Amble. Reload Amble to get the update.',
  blocked: "Amble can't open files here. Your school may have turned that off.",
  worldTooBig: 'This world is very big. Save it to Drive and start a new one.',
  sharePageName: '{title} (web page)',
  opening: 'Opening {name}…',
  opened: 'Opened {title}.',
  openedMany: 'Opened {n} worlds.',
  drawingOpened: '{name} is on your Trail now.',
  dropHere: 'Drop your .amble file to open it',
  dropHint: 'Amble opens worlds and drawings saved as .amble files.',

  storageBlocked: "This browser isn't letting Amble save here. Your work will only be kept in files you save.",
  whyTitle: "Why Amble can't save here",
  whyBody: "Some browsers and guest sessions don't let websites keep anything. Amble still works.",
  whyBody2: 'Save your world to Drive before you go. Next time, open it with Open a file.',
  sharedDevice: 'This Chromebook is shared. Save your worlds to Drive before you go.',
  nudge: 'Save to Drive before the bell?',
  spaceLow: 'Space is getting low · Tidy up',
  storageFullTitle: 'Out of space',
  storageFull: "There's no more space for Amble here. Save your worlds to Drive, then tidy up.",
  saveAllWorlds: 'Save all my worlds',
  tidyUp: 'Tidy up',
  autosaveQuota: "Amble can't save on this Chromebook right now. It's out of space. Save to Drive now, then delete old worlds in Settings.",
  autosaveBack: 'Amble can save on this Chromebook again.',
  allWorldsName: 'My Amble worlds {date}',
  savedAll: 'Saved {n} worlds in one file.',
  nothingToSave: 'There are no worlds to save yet.',

  welcomeBack: 'Welcome back. Everything was saved.',
  drawingSafe: 'Welcome back. Your drawing is safe.',

  stepImported: 'You opened {file}.',
  stepBrought: 'You brought in drawings from the old Amble.',
  copyTitle: '{title} (copy)',

  updated: "Amble was updated · What's new",
  updatedToast: "Amble was updated. See what's new.",

  legacy_heading: 'From the old Amble',
  legacy_found: 'We found a game from the old Amble: {title}. Bring its drawings and sounds here?',
  legacy_bring: 'Bring them',
  legacy_bringing: 'Bringing them in…',
  legacy_brought: "We brought in your drawings and sounds. The blocks don't come along; your drawings are in a new world called {title} (old).",
  legacy_title: '{title} (old)',
  legacy_failed: "Amble couldn't bring them in. Your old game is still safe, so try again later.",
  legacy_drawings: '{n} drawings',
  legacy_drawing: '1 drawing',
  legacy_sounds: '{n} sounds',
  legacy_sound: '1 sound',
  legacy_and: '{a} and {b}',
} satisfies Strings;
