# Amble

Make real 2D and 3D games with blocks. Amble has its own block language: lots of **exact blocks** for the basics (move, walk, jump, touching, repeat, score...), and **blocks in your own words** for everything else (`do [spin around and shrink away]`, `always: [twinkle as I fall]`). Games run on [Babylon.js](https://www.babylonjs.com/).

**Try it:** https://aboufama.github.io/amble/ (exact blocks work right away; to compile blocks in your own words, open **Settings** and add an OpenAI API key, which stays in your browser). Running Amble on your own computer? You can **sign in with ChatGPT** instead.

![The Amble editor in 2D mode](docs/editor-2d.png)

- **Blocks that teach how to direct anything.** The categories follow how you'd brief a capable helper. **Brief**: say what you're making, who it's for, how it looks, and what winning means. **Characters**: name exactly who you mean, by dragging their block (with their picture) into a slot. **Rules**: say what must always or never happen, and add **checks** that tell you when something isn't true. **Skills**: break big jobs into named steps.
- **Exact where it can be, open where it should be.** Exact blocks compile instantly, offline, the same way every time. Words reach the whole game: a sentence on one sprite can change how another one plays, so when you add or change words (or the brief), the compile sees the whole program and may rewrite words elsewhere to fit, and tells you when it does. Words it didn't need to touch keep their code, and moving scripts around never recompiles anything. **Edit → Compile everything again** starts over and writes everything again, so it can come out different.
- **You make the assets.** Paint costumes, upload images or `.glb` 3D models, record or synthesize sounds.
- **The compiler fills the gaps.** If your words need something you didn't make (the stars in "catch the falling stars", a laser sound, a 3D crate), the compiler makes it. It shows up as a **compiled asset** with a dashed outline. Keep it to make it yours, or delete it and the next compile makes a new one. Compiled assets are reused between compiles, so your game doesn't change looks every build, until you change the **art style**: then the compiler makes its art again in the new style.
- **2D and 3D in the same engine.** Pick a world with the 2D / 3D switch.

![The 3D example](docs/editor-3d.png)

## Quick start

```bash
npm install
npm run dev            # http://localhost:5173
```

Then either:

- press **Sign in with ChatGPT** (top right). This needs the [Codex CLI](https://github.com/openai/codex) (`npm install -g @openai/codex`). Compiles then run on your ChatGPT plan with GPT-6 Astra Light, and no API key is needed ([details](#signing-in-with-chatgpt)), or
- open **Settings** and paste an OpenAI API key (stored only in your browser), or
- put `OPENAI_API_KEY=sk-...` in a `.env` file (see `.env.example`). The dev server then proxies OpenAI calls, and the key never reaches the browser.

Press the green flag: the starter project uses only exact blocks, so it compiles instantly and needs no account. Try **File → Examples → Star Catcher** or **Coin Hills (3D)**: they have a couple of blocks in your own words: with an account, the green flag builds them first and then plays.

Defaults: `gpt-5` with low reasoning compiles blocks in your own words; `gpt-5-mini` makes compiled art, models and sounds. Any model your key can use can be picked in Settings, and any OpenAI-compatible endpoint works via the base URL. Signed in with ChatGPT, everything uses GPT-6 Astra Light (`gpt-6-astra` with low reasoning).

### Signing in with ChatGPT

OpenAI only lets its own Codex app sign in with ChatGPT, not other websites. So when Amble runs on your computer, the dev server (`server/codexBridge.ts`) hands compile requests to your Codex CLI:

- **Sign in with ChatGPT** reuses the ChatGPT sign-in Codex already has, or runs `codex login`, which opens the ChatGPT sign-in page.
- Each request runs `codex exec` with GPT-6 Astra at low reasoning, the preset ChatGPT calls "Astra Light". It counts toward your ChatGPT plan's Codex usage.
- Codex runs in a read-only sandbox in an empty temporary folder, without your Codex config (`--ignore-user-config`) and without saving a session (`--ephemeral`).
- **Sign out** only stops Amble from using it; Codex stays signed in. Set `CODEX_PATH` if `codex` isn't on your PATH.

The GitHub Pages demo has no server, so there it's API keys only.

## How it works

```
 Blocks  ──►  Amble's compiler  ──────────────────────────────►  Amble engine (Babylon.js + Havok)
              exact blocks: engine calls, instantly               runs in a sandboxed iframe
              your words: small pieces of code, in one request
              (new words, plus any written before that must change)
```

1. **The block language** (`src/blocks/spec.ts`) defines every block once: its shape (hat, stack, C, reporter, condition, or a standalone rule), its inputs (typed numbers and words, menus, character slots, condition slots) and its help text. The editor (`src/blocks/blockly.ts`) and the compiler both read it.
2. **Exact blocks compile locally** (`src/compiler/codegen.ts`). Like Scratch, each script becomes a coroutine that its trigger starts (with Scratch's rules for restarting), loops yield once per frame, and every exact block becomes a direct engine call. The same blocks always give the same code.
3. **Words become pieces.** A block in your own words becomes a small method. Its key is a hash of what it says and where it is (the words, the block, the sprite, whether it repeats, 2D or 3D). Pieces whose key is new go out, all in one request with the whole program and the code of every piece already written (`src/compiler/prompt.ts`, strict JSON from `src/compiler/schema.ts`). Words reach the whole game, so the reply can also rewrite pieces written before, on any sprite, when the new words need them to change; a changed brief sends them to be looked at again too. The art style is a piece of its own: a rule that sets up the game's look when it starts. Pieces that don't parse get one repair round. Pieces nothing rewrote come from the last compile, and undoing an edit compiles instantly again. **Edit → Compile everything again** starts over: every piece is written again and the compiled art is made again.
4. **Check and harden.** Every class is parsed with acorn (`src/compiler/transform.ts`). Loops get guards so a runaway `while (true)` pauses or stops instead of freezing the page. A missing `yield*` before `wait()` is added, and hooks that wait become coroutines.
5. **Make assets.** Compiled costumes are drawn as SVG (or by an image model, if you choose that in Settings). 3D models are assembled from primitive shapes. Sounds come from a small synthesizer (`src/audio/synth.ts`). If generation fails, a placeholder keeps the game running.
6. **Run.** The green flag builds what changed and then plays the game in an iframe with an opaque origin and a Content-Security-Policy that blocks all network access. A moment after you finish typing words, they're built quietly in the background, so the flag usually plays at once; while a block is being built it goes pale and fills back in with bricks of its own colour. With no account, blocks in your own words do nothing until they're compiled, and everything else still plays. Problems show where they happen, as a note pinned beside the block: an error or a failed **check** from the last run (with **Fix it**, which builds the words of the sprites that had problems again, with the problems attached), a block that doesn't work where it is, words that didn't build (**Try again**), and words waiting for a key or a sign-in. When words could mean quite different games, the compiler picks one and asks about it in a note on their block; the answer joins the words, and they build again. The **Problems** dialog lists everything at once.

Old projects made with earlier versions of Amble are converted to the new blocks when they're opened (`src/project/migrate.ts`), keeping every word.

### The engine

The Amble engine (`src/engine/`) is a thin, consistent game layer over Babylon.js:

- **Consistent timing.** Logic and physics run on Babylon's deterministic lockstep: exactly 60 ticks per second on every machine, independent of the monitor's refresh rate. `wait()`, timers and tweens use game time, not wall-clock time.
- **Unity-style sprites.** `class Player extends Sprite { start() {} update(dt) {} onKeyDown(key) {} onClick() {} onMessage(name, data) {} onCollide(other) {} onSpawn() {} }`, plus coroutines (`*start() { yield* this.wait(1) }`).
- **2D:** orthographic 480×360 stage in pixels (Scratch coordinates), costumes as textured sprites, scrolling camera, layers.
- **3D:** meters, sky, sun with shadows, ground, follow / first-person / orbit cameras. Image costumes are billboard cutouts; `.glb` and compiled models are real meshes.
- **Physics:** Havok (dynamic/static/kinematic bodies, collisions, sensors). In 2D, bodies are constrained to the plane.
- **Ready-made behaviors** for the exact Game blocks: walk with the arrow keys, jump, fall with gravity (the bottom of the screen is solid in 2D), be solid ground.
- **Also:** input (keys, mouse, touch, pointer lock), Web Audio sounds, HUD text/values/buttons, speech bubbles, questions, particles.
- **Full Babylon access:** compiled code can use the `BABYLON` namespace for anything the helpers don't cover.

Why Babylon.js? It's a full game engine (rendering, physics, particles, glTF, cameras, input) where 2D and 3D share one scene graph and API. It has a built-in fixed-timestep mode, and it's famously backward compatible, so compiled code rarely breaks on version drift.

## Project layout

```
src/
  blocks/      the block language (spec.ts), menus, and the Blockly editor (renderer, fields, palette)
  compiler/    code generation for exact blocks, pieces for words, prompts, schemas, OpenAI client,
               code instrumentation, compiled assets
  engine/      the game runtime that runs inside the player iframe (Babylon.js + Havok)
  player/      editor <-> player protocol, iframe host, run-package builder
  project/     data model, defaults and examples, migration of old projects, persistence, HTML export
  components/  React UI (blocks editor, paint editor, sounds, stage, problems, sprite pane)
server/        dev-server bridge for "Sign in with ChatGPT" (runs the Codex CLI)
dev/engine-test.html   a page for poking the engine directly (npm run dev → /dev/engine-test.html)
```

## Saving and sharing

- Projects autosave in your browser (IndexedDB).
- **File → Save to your computer** writes a `.amble` file; **Open** reads it back.
- **File → Export playable web page** produces a single `.html` file with the engine, physics and your game inside. It runs anywhere, with no server.

## Deploying

`.github/workflows/pages.yml` builds the app on every push and publishes `dist/` to the `gh-pages` branch, which GitHub Pages serves (Settings → Pages → Deploy from a branch → `gh-pages`, `/ (root)`). The build uses relative paths, so it works from any sub-path. On a static host there's no server key and no ChatGPT sign-in: exact blocks work for everyone, and each visitor uses their own OpenAI key from Settings to compile blocks in their own words.

## Security notes

- The API key lives in `localStorage` (or on the dev server with `OPENAI_API_KEY`). Compiled games can't read it: the player iframe is sandboxed without `allow-same-origin`, and its CSP has no network access (`connect-src data: blob:`).
- Compiled SVG art is sanitized (no scripts, event handlers, or external references) before use.
- The dev server's compile endpoints (`/api/openai`, `/api/codex`) only answer Amble's own page: they reject requests from other origins and require JSON, so other sites open in your browser can't use your key or your ChatGPT sign-in.

## Development

```bash
npm run typecheck
npm test                 # unit tests (vitest)
npm run test:e2e         # Playwright: the editor, instant compiles, and word compiles against a mocked API
npm run build            # production build in dist/ (includes amble-player.js and amble-havok.wasm)
```

To point Playwright at an already-installed Chromium, set `PW_CHROMIUM_PATH`, e.g. `PW_CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.

## Ideas for next steps

- Live previews of compiled 3D models in the costume list.
- More providers (Anthropic, Gemini, local models). Everything goes through `src/compiler/openai.ts`.
- Show the compiler a picture of your costumes so compiled art matches your style even more closely.
