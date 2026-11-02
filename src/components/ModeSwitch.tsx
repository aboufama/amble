import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { MODES, modeOf, modeSettings, type ModeId } from '../compiler/models';
import { CHATGPT_MODEL_NAME } from '../compiler/openai';
import { formatUsd, resetSpend, SPEND_DEBUG, totalCalls, totalUsd, useSpend, type ModelSpend } from '../compiler/spend';

/** Best / Efficient: which models build the blocks written in words. */
export function ModeSwitch() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const signedIn = useStore((s) => s.settings.useChatGpt && s.codex?.auth === 'chatgpt');
  const mode = modeOf(settings);

  return (
    <div
      className={`mode-switch ${signedIn ? 'disabled' : ''}`}
      role="radiogroup"
      aria-label="Build mode"
      title={signedIn ? `Signed in with ChatGPT: building uses ${CHATGPT_MODEL_NAME}` : mode ? undefined : `Custom models: ${settings.model} (${settings.reasoningEffort})`}
    >
      {(Object.keys(MODES) as ModeId[]).map((id) => (
        <button
          key={id}
          role="radio"
          aria-checked={mode === id}
          className={mode === id ? 'on' : ''}
          disabled={signedIn}
          title={`${MODES[id].label}: ${MODES[id].name}. ${MODES[id].description}`}
          onClick={() => setSettings(modeSettings(id))}
        >
          {MODES[id].label}
        </button>
      ))}
      {!mode && !signedIn && <span className="mode-custom">Custom</span>}
    </div>
  );
}

const tokens = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v));

/** Debug: what the compile requests from this browser have cost so far (an estimate from token usage). */
export function SpendMeter() {
  const spend = useSpend();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const total = totalUsd(spend);
  const calls = totalCalls(spend);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  if (!SPEND_DEBUG) return null;
  const rows = Object.entries(spend.byModel).sort((a, b) => b[1].usd - a[1].usd) as Array<[string, ModelSpend]>;
  const missing = rows.reduce((n, [, m]) => n + m.incomplete, 0);

  return (
    <div className="spend" ref={ref}>
      <button className="spend-chip" aria-expanded={open} aria-haspopup="dialog" title="Debug: estimated OpenAI spend from this browser" onClick={() => setOpen((o) => !o)}>
        <span className="spend-tag">debug</span>
        <span className="spend-total">{formatUsd(total)}</span>
      </button>
      {open && (
        <div className="spend-panel" role="dialog" aria-label="Spend">
          <div className="spend-head">
            <b>{formatUsd(total)}</b> in {calls} request{calls === 1 ? '' : 's'}
            <small>since {new Date(spend.since).toLocaleString()}</small>
          </div>
          {rows.length ? (
            <table className="spend-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Calls</th>
                  <th title="Prompt tokens (cached in brackets)">In</th>
                  <th title="Generated tokens (reasoning in brackets)">Out</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([model, m]) => (
                  <tr key={model}>
                    <td className="spend-model">{model}</td>
                    <td>{m.calls}</td>
                    <td>
                      {tokens(m.input)}
                      {m.cached > 0 && <small> ({tokens(m.cached)})</small>}
                    </td>
                    <td>
                      {tokens(m.output)}
                      {m.reasoning > 0 && <small> ({tokens(m.reasoning)})</small>}
                    </td>
                    <td>{m.unpriced && !m.usd ? '—' : formatUsd(m.usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="spend-empty">No requests yet. Blocks in your own words make one when they build.</p>
          )}
          {spend.last && (
            <p className="spend-note">
              Last: {spend.last.kind} with {spend.last.model}, {spend.last.usd === null ? 'cost unknown' : formatUsd(spend.last.usd)}
            </p>
          )}
          {missing > 0 && <p className="spend-note">{missing} request{missing === 1 ? ' was' : 's were'} stopped before OpenAI reported usage, so their cost is missing.</p>}
          <p className="spend-note">Estimated from token usage at OpenAI's standard prices. Debug only: it counts this browser, not the whole account.</p>
          <div className="spend-actions">
            <button className="btn small" onClick={resetSpend}>
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
