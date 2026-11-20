/**
 * While a game is made from an idea, the player gets a few quick questions about what their idea
 * leaves open (src/compiler/ask.ts), on the stage, as the game is written. Their picks go to the
 * art, which waits for them a few seconds at most: the code takes longer than that anyway, so the
 * game isn't later for it.
 */
import { useStore } from './store';
import { askAboutIdea, picksText, type Pick } from './compiler/ask';
import { resolveTransport, type AiSettings } from './compiler/openai';

/** How long the art waits for the picks, from the moment the build starts. */
export const PICKS_WAIT_MS = 10000;

let finish: ((picks: string) => void) | null = null;

/** Starts asking about the idea; resolves with the picks, in words, for the art ("" for none). */
export function askPlayer(idea: string, settings: AiSettings, signal: AbortSignal): Promise<string> {
  const store = useStore.getState();
  store.setAsk({ questions: null, answers: [], done: false });
  return new Promise<string>((resolve) => {
    let settled = false;
    const end = () => {
      if (settled) return;
      settled = true;
      finish = null;
      window.clearTimeout(timer);
      const ask = useStore.getState().ask;
      const picks: Pick[] = (ask?.questions ?? []).map((q, i) => ({ ask: q.ask, answer: ask?.answers[i] ?? null }));
      if (ask) useStore.getState().setAsk({ ...ask, done: true });
      // Benchmarks read what was picked.
      (globalThis as { __amblePicks?: Pick[] }).__amblePicks = picks;
      resolve(picksText(picks));
    };
    finish = end;
    const timer = window.setTimeout(end, PICKS_WAIT_MS);
    signal.addEventListener('abort', () => {
      end();
      useStore.getState().setAsk(null);
    });
    void (async () => {
      try {
        const t = await resolveTransport(settings);
        const questions = t ? await askAboutIdea(idea, t, settings, signal) : [];
        if (settled) return;
        if (!questions.length) {
          useStore.getState().setAsk(null);
          return end();
        }
        useStore.getState().setAsk({ questions, answers: [], done: false });
        autoAnswer();
      } catch {
        // No questions: the game is made as before.
        if (!settled) {
          useStore.getState().setAsk(null);
          end();
        }
      }
    })();
  });
}

/** The player answers the question showing now (null: "you choose"). The last answer sends the picks. */
export function answer(choice: string | null): void {
  const s = useStore.getState();
  const ask = s.ask;
  if (!ask?.questions || ask.done) return;
  const answers = [...ask.answers, choice];
  s.setAsk({ ...ask, answers });
  if (answers.length >= ask.questions.length) finish?.(choice ?? '');
}

/** "Just make it": the rest is Amble's choice. */
export function skipQuestions(): void {
  finish?.('');
}

/** Benchmarks play a quick player: `__ambleAutoAnswer` ms per question, picking the first choice. */
function autoAnswer(): void {
  const ms = (globalThis as { __ambleAutoAnswer?: number }).__ambleAutoAnswer;
  if (typeof ms !== 'number') return;
  const step = () =>
    window.setTimeout(() => {
      const ask = useStore.getState().ask;
      if (!ask?.questions || ask.done) return;
      answer(ask.questions[ask.answers.length]?.choices[0] ?? null);
      step();
    }, ms);
  step();
}
