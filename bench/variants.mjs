/** The harness variants the benchmark compares (see src/compiler/harness.ts for what each switch does). */
export const VARIANTS = {
  // What Amble ships: high reasoning for the game, chained costumes, model-picked sounds, 6 at a time.
  // Always against the first snapshot (port 5200): the code Amble ships, before any of these changes.
  v0: { label: 'Baseline (Amble today)', harness: {}, url: 'http://localhost:5200' },
  // The asset phase rebuilt: every request at once, a sprite's costumes in one request, library sounds, and the code checked.
  v1: { label: 'Fast assets + check', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true } },
  v2: { label: 'v1 + medium game reasoning', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, gameEffort: 'medium' } },
  v3: { label: 'v1 + low game reasoning', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, gameEffort: 'low' } },
  // The art and sounds are made while the model writes the code (its asset list comes first).
  v4: { label: 'v1 + streamed assets', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true } },
  v5: { label: 'v4 + medium game reasoning', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'medium' } },
  v6: { label: 'v4 + low game reasoning', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'low' } },
  // With a 6-second trial run: runtime errors are found and fixed before the build is done.
  v7: { label: 'v5 + trial run', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'medium', trialRun: 6 } },
  v8: { label: 'v6 + trial run', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'low', trialRun: 6 } },
  // Planned in one short request, then written by four requests at once (src/compiler/split.ts).
  v9: { label: 'Split: plan, then 4 writers at once', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, split: true, splitWriters: 4, gameEffort: 'medium', writerEffort: 'low' } },
  v10: { label: 'Split, low reasoning plan', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, split: true, splitWriters: 4, gameEffort: 'low', writerEffort: 'low' } },
  v11: { label: 'v10 + trial run', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, split: true, splitWriters: 4, gameEffort: 'low', writerEffort: 'low', trialRun: 6 } },
  // Round 3 (snapshot 4): the size reminder, a tighter plan and slimmer writers, and the trial run in all of them.
  v12: { label: 'Streamed, low reasoning, size reminder, trial run', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'low', sizeReminder: true, trialRun: 6 } },
  v13: { label: 'Split, medium plan, trial run', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, split: true, splitWriters: 4, gameEffort: 'medium', writerEffort: 'low', sizeReminder: true, trialRun: 6 } },
  v14: { label: 'Split, low plan, size reminder, trial run', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, split: true, splitWriters: 4, gameEffort: 'low', writerEffort: 'low', sizeReminder: true, trialRun: 6 } },
  // The candidate final harness (snapshot 5, port 5204): v12, plus the engine's stage tween fix and the stage-helper check.
  v15: { label: 'Final: streamed, low reasoning, size reminder, checked, trial run', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'low', sizeReminder: true, trialRun: 6 }, url: 'http://localhost:5204' },
  // v15 + a review of the whole game (snapshot 6, port 5205).
  v17: { label: 'v15 + review pass', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'low', sizeReminder: true, trialRun: 6, review: true }, url: 'http://localhost:5205' },
  // Snapshot 7 (port 5206): v15's stage-helper check flagged the engine's own this._script() in every build
  // (a needless fix request each time); it now flags only helpers that are sprites' alone.
  v18: { label: 'Final: streamed, low reasoning, size reminder, checked, trial run', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'low', sizeReminder: true, trialRun: 6 }, url: 'http://localhost:5206' },
  v19: { label: 'Final + review pass', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'low', sizeReminder: true, trialRun: 6, review: true }, url: 'http://localhost:5206' },
  // Round 5 (snapshot 8, port 5207): Sol is Amble's default. Sprites' classes can extend each other
  // (class Sprinter extends Hen), the trial run goes while the last art is made, and the screen shows
  // the drawings as they are drawn. v20 is v18 on that code; v21/v22 build in fan-out (src/compiler/fanout.ts).
  v20: { label: 'v18 + class inheritance, trial during art', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'low', sizeReminder: true, trialRun: 6 }, url: 'http://localhost:5207' },
  v21: { label: 'Fan-out: outline, then art, stage and cast at once', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'low', sizeReminder: true, trialRun: 6, fanout: true, fanoutGame: 'backdrops', writerEffort: 'low' }, url: 'http://localhost:5207' },
  v22: { label: 'Fan-out, stage waits for the cast', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'low', sizeReminder: true, trialRun: 6, fanout: true, fanoutGame: 'cast', writerEffort: 'low' }, url: 'http://localhost:5207' },
  v23: { label: 'v20 + lean reply: cast first, art from each entry', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'low', sizeReminder: true, trialRun: 6, lean: true }, url: 'http://localhost:5207' },
  // Round 6 (snapshot 9, port 5208): the lean reply on Azure (Sol there writes 2.5 times as fast as on
  // OpenAI's own endpoint, at the same price), no trial run (it found nothing in 34 builds: the check
  // does that work), the check's `this` fix, and three design rules from the judge's notes (a boss that
  // plays differently, the HUD on the edges, nothing painted over the backdrop).
  // (v24 asked OpenRouter for Azure with "order", which turned out not to move requests off OpenAI:
  // it measures the lean reply without the trial run on the usual mix of providers.)
  v24: { label: 'Lean reply, no trial run', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'low', sizeReminder: true, trialRun: 0, lean: true, providerOrder: ['azure'] }, url: 'http://localhost:5208' },
  // Snapshot 10 (port 5209): Sol on Azure for real ("only" and "order"), and costumes a class uses
  // that the cast left out drawn as soon as that class is written. v26 is v24 with those; v25 also
  // checks its numbers (a few lines on each act's length, counts and speeds, and why a good player wins)
  // between the cast and the code.
  v26: { label: 'Lean reply on Azure, no trial run', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'low', sizeReminder: true, trialRun: 0, lean: true, providerOrder: { openai: ['azure', 'openai'] } }, url: 'http://localhost:5209' },
  // Snapshot 10 (port 5209): v24, checking its numbers (a few lines on each act's length, counts and
  // speeds, and why a good player wins) between the cast and the code.
  v25: { label: 'v26 + a balance check before the code', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'low', sizeReminder: true, trialRun: 0, lean: true, balance: true, providerOrder: { openai: ['azure', 'openai'] } }, url: 'http://localhost:5209' },
  // Snapshot 11 (port 5211): a class may use one that loads after it (Hen's code naming Queen, which
  // extends Hen: v23-r1 failed on that), and the code requests get providers of their own. v27 is the
  // speed-first candidate: Sol writes the code on Azure (the same price; when it's busy, OpenAI's
  // ultrafast endpoint at three times the price, then the usual one), and Terra (half Sol's price)
  // draws on Azure first. v28 is v27 with medium reasoning for the game, for quality.
  v27: { label: 'Final candidate: lean, Sol code on Azure or ultrafast, Terra art', assetModel: 'openai/gpt-6.1-terra', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'low', sizeReminder: true, trialRun: 0, lean: true, balance: true, providerOrder: { openai: ['azure', 'openai'] }, codeProvider: { openai: ['azure', 'openai/ultrafast', 'openai'] } }, url: 'http://localhost:5211' },
  v28: { label: 'v27 + medium reasoning for the game', assetModel: 'openai/gpt-6.1-terra', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'medium', sizeReminder: true, trialRun: 0, lean: true, balance: true, providerOrder: { openai: ['azure', 'openai'] }, codeProvider: { openai: ['azure', 'openai/ultrafast', 'openai'] } }, url: 'http://localhost:5211' },
  // v27 with the code on OpenAI's ultrafast endpoint first (about 300 tokens a second at three times
  // the price): the build is now as long as that one request.
  v29: { label: 'v27 with the code on the ultrafast endpoint first', assetModel: 'openai/gpt-6.1-terra', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'low', sizeReminder: true, trialRun: 0, lean: true, balance: true, providerOrder: { openai: ['azure', 'openai'] }, codeProvider: { openai: ['openai/ultrafast', 'azure', 'openai'] } }, url: 'http://localhost:5211' },
  // Snapshot 12 (port 5212): v29 with Sol drawing again (Terra's art was plainer: polish 6 to 7) and
  // the full-size reminder, for quality: low reasoning writes less game than the judge wants.
  v30: { label: 'v29 + Sol art + full-size reminder', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'low', sizeReminder: true, fullSize: true, trialRun: 0, lean: true, balance: true, providerOrder: { openai: ['azure', 'openai'] }, codeProvider: { openai: ['openai/ultrafast', 'azure', 'openai'] } }, url: 'http://localhost:5212' },
  // Snapshot 13 (port 5213): the full-size game (judged 8 in v30) written by two writers at once: the
  // main reply writes the header (cast, sounds, backdrops, a contract, the balance) and the game piece,
  // and a second request writes every character's class from that header meanwhile. Code on Azure
  // (the same price as OpenAI's own endpoint), Sol drawing.
  v31: { label: 'Full size, two writers at once, on Azure', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'low', sizeReminder: true, fullSize: true, trialRun: 0, lean: true, balance: true, castWriter: true, providerOrder: { openai: ['azure', 'openai'] }, codeProvider: { openai: ['azure', 'openai'] } }, url: 'http://localhost:5213' },
  v16: { label: 'v15 + minimal art reasoning', harness: { concurrency: 24, costumes: 'sheet', sounds: 'library', lint: true, streamAssets: true, gameEffort: 'low', sizeReminder: true, trialRun: 6, artEffort: 'minimal' }, url: 'http://localhost:5204' },
};
