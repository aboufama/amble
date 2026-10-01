import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { CHATGPT_MODEL_NAME, hasServerKey, listModels, resolveTransport, type ReasoningEffort } from '../compiler/openai';
import { cancelChatGptSignIn, refreshChatGpt, signInWithChatGpt, signOutOfChatGpt } from '../actions';
import { answerPrompt } from '../prompt';
import { XIcon } from './icons';

export function Modal({ title, onClose, children, wide, className = '' }: { title: string; onClose(): void; children: ReactNode; wide?: boolean; className?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <XIcon size={14} strokeWidth={3} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

const SUGGESTED = ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5', 'gpt-5-mini', 'gpt-5.1', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'];

/** Signing in, in plain words. It works when Amble runs on your computer and Codex is installed there. */
function SignInCard() {
  const codex = useStore((s) => s.codex);
  const signedIn = useStore((s) => s.settings.useChatGpt && s.codex?.auth === 'chatgpt');

  if (!codex) return null;
  if (signedIn) {
    return (
      <div className="account-card">
        <p className="note ok">You're signed in, so Amble can build blocks written in your own words.</p>
        <div className="row">
          <button className="btn small" onClick={signOutOfChatGpt}>
            Sign out
          </button>
        </div>
      </div>
    );
  }
  if (codex.login.pending) {
    return (
      <div className="account-card">
        <p className="note">
          Continue in your browser to finish signing in.{' '}
          {codex.login.url && (
            <a href={codex.login.url} target="_blank" rel="noreferrer">
              Open the sign-in page
            </a>
          )}
        </p>
        <div className="row">
          <button className="btn small" onClick={() => void cancelChatGptSignIn()}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="account-card">
      <div className="row center">
        <button className="btn primary" onClick={() => void signInWithChatGpt()}>
          Sign in
        </button>
        <small className="muted">Signing in lets Amble build blocks written in your own words.</small>
      </div>
      {codex.login.error && <p className="note bad">Signing in didn't finish. Try again.</p>}
    </div>
  );
}

/** How signing in works, under Advanced: with ChatGPT, through the Codex CLI, when Amble runs on your computer. */
function CodexNote() {
  const codex = useStore((s) => s.codex);
  const signedIn = useStore((s) => s.settings.useChatGpt && s.codex?.auth === 'chatgpt');

  if (!codex) {
    return (
      <p className="note">
        <b>Sign in with ChatGPT</b> works when Amble runs on your computer (<code>npm run dev</code>), through OpenAI's Codex app. Here, use an OpenAI API key.
      </p>
    );
  }
  if (!codex.installed) {
    return (
      <p className="note">
        To sign in with ChatGPT, install Codex (<code>npm install -g @openai/codex</code>), then{' '}
        <button className="link-btn" onClick={() => void refreshChatGpt()}>
          check again
        </button>
        .
      </p>
    );
  }
  if (signedIn) {
    return (
      <p className="note">
        Signed in with ChatGPT. Building uses <b>{CHATGPT_MODEL_NAME}</b> (GPT-6 Astra, low reasoning) on your ChatGPT plan, through Codex {codex.version}.
        The key and models below are used when you sign out; Codex itself stays signed in on this computer.
      </p>
    );
  }
  return (
    <>
      <p className="note">
        <b>Sign in</b> uses your ChatGPT plan with {CHATGPT_MODEL_NAME}, through the Codex app on this computer. No API key needed.
        {codex.auth === 'apikey' && ' (Codex here is signed in with an API key right now; signing in switches it to your ChatGPT account.)'}
      </p>
      {codex.login.error && <p className="note bad">{codex.login.error}</p>}
    </>
  );
}

export function SettingsDialog() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const setDialog = useStore((s) => s.setDialog);
  const [server, setServer] = useState<boolean | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [showKey, setShowKey] = useState(false);
  // Signing in needs Codex on this computer; without it, the account is an API key.
  const canSignIn = useStore((s) => Boolean(s.codex?.installed));
  const codexVersion = useStore((s) => s.codex?.version);

  useEffect(() => {
    void hasServerKey().then(setServer);
    void refreshChatGpt();
  }, []);

  const testConnection = async () => {
    setTest(null);
    try {
      const t = await resolveTransport(useStore.getState().settings);
      if (!t) throw new Error('No API key yet.');
      if (t.via === 'chatgpt') {
        setTest({ ok: true, message: `Connected to ChatGPT through Codex ${codexVersion ?? ''}.` });
        return;
      }
      const list = await listModels(t);
      const chat = list.filter((m) => /^(gpt|o\d|chatgpt)/i.test(m) && !/(audio|realtime|tts|transcribe|search|image|embedding|moderation)/i.test(m));
      setModels(chat);
      setTest({ ok: true, message: `Connected${t.via === 'server' ? ' through the dev server' : ''}. ${chat.length} chat models available.` });
    } catch (err) {
      setTest({ ok: false, message: (err as Error).message });
    }
  };

  const modelOptions = [...new Set([...models, ...SUGGESTED])];

  const keyField = (
    <label className="text-field">
      <span>API key</span>
      <div className="row">
        <input
          type={showKey ? 'text' : 'password'}
          value={settings.apiKey}
          placeholder={server ? '(using the server key)' : 'sk-...'}
          onChange={(e) => setSettings({ apiKey: e.target.value })}
          autoComplete="off"
          spellCheck={false}
        />
        <button className="btn small" onClick={() => setShowKey((v) => !v)}>
          {showKey ? 'Hide' : 'Show'}
        </button>
      </div>
      <small className="muted">A key lets Amble build blocks written in your own words. It stays in this browser.</small>
    </label>
  );

  return (
    <Modal title="Settings" onClose={() => setDialog(null)}>
      <section className="settings">
        <h3>Account</h3>
        {canSignIn ? <SignInCard /> : keyField}
        {/* Models, endpoints and how signing in works stay folded away. */}
        <details className="advanced">
          <summary>Advanced</summary>
          <div className="advanced-fields">
            <CodexNote />
            {canSignIn && keyField}
            {server && <p className="note ok">The dev server has OPENAI_API_KEY set, so you can leave the key empty.</p>}
            <small className="muted">Your API key is sent only to OpenAI, and games run in a sandbox that can't read it. Create one at platform.openai.com → API keys.</small>
            <div className="row wrap">
              <label className="text-field grow">
                <span>Model (builds the blocks in your own words)</span>
                <input list="amble-models" value={settings.model} onChange={(e) => setSettings({ model: e.target.value })} />
              </label>
              <label className="text-field">
                <span>Reasoning</span>
                <select value={settings.reasoningEffort} onChange={(e) => setSettings({ reasoningEffort: e.target.value as ReasoningEffort })}>
                  <option value="default">default</option>
                  <option value="minimal">minimal (fastest)</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="xhigh">extra high</option>
                  <option value="max">max (slowest)</option>
                </select>
              </label>
            </div>
            <label className="text-field">
              <span>Asset model (compiled art, 3D models and sounds)</span>
              <input list="amble-models" value={settings.assetModel} placeholder="same as above" onChange={(e) => setSettings({ assetModel: e.target.value })} />
            </label>
            <datalist id="amble-models">
              {modelOptions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <h3>Compiled art</h3>
            <div className="radio-row">
              <label>
                <input type="radio" checked={settings.artMode === 'svg'} onChange={() => setSettings({ artMode: 'svg' })} /> Vector drawings (fast, cheap, Scratch-like)
              </label>
              <label>
                <input type="radio" checked={settings.artMode === 'image'} onChange={() => setSettings({ artMode: 'image' })} /> Image model (richer, slower; may need a verified OpenAI org)
              </label>
            </div>
            {settings.artMode === 'image' && (
              <label className="text-field">
                <span>Image model</span>
                <input value={settings.imageModel} onChange={(e) => setSettings({ imageModel: e.target.value })} />
              </label>
            )}
            <label className="text-field">
              <span>API base URL (any OpenAI-compatible endpoint)</span>
              <input value={settings.baseUrl} onChange={(e) => setSettings({ baseUrl: e.target.value })} />
            </label>
            <div className="row">
              <button className="btn" onClick={() => void testConnection()}>
                Test connection
              </button>
              {test && <span className={test.ok ? 'ok' : 'bad'}>{test.message}</span>}
            </div>
          </div>
        </details>
      </section>
    </Modal>
  );
}

export function Toast() {
  const toast = useStore((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), toast.tone === 'error' ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || !visible) return null;
  return (
    <div className={`toast ${toast.tone}`} role="status" onClick={() => setVisible(false)}>
      {toast.message}
    </div>
  );
}

/**
 * Amble's one dialog for questions (Scratch's style): New Variable, Rename Variable, New
 * Message, Make a Block, and every confirmation (delete, replace the project...). Enter
 * confirms and Esc cancels.
 */
export function PromptDialog() {
  const prompt = useStore((s) => s.prompt);
  const [value, setValue] = useState('');
  const [scope, setScope] = useState<'global' | 'local'>('global');
  useEffect(() => {
    if (!prompt) return;
    setValue(prompt.defaultValue ?? '');
    setScope('global');
  }, [prompt]);
  const kind = prompt?.kind ?? 'prompt';
  useEffect(() => {
    if (!prompt || kind === 'prompt') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      answerPrompt({ value: '', scope: 'global' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompt, kind]);
  if (!prompt) return null;
  const ok = () => answerPrompt({ value, scope });
  const main = (
    <button className={`ok ${prompt.danger ? 'danger' : ''}`} onClick={ok} autoFocus={kind !== 'prompt'}>
      {prompt.confirmLabel ?? 'OK'}
    </button>
  );
  if (kind !== 'prompt') {
    return (
      <Modal title={prompt.title} onClose={() => answerPrompt(null)} className={`prompt ${kind}`}>
        <p className="prompt-message">{prompt.label}</p>
        <div className="prompt-buttons">
          {kind === 'confirm' && <button onClick={() => answerPrompt(null)}>Cancel</button>}
          {main}
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={prompt.title} onClose={() => answerPrompt(null)} className="prompt">
      <div className="prompt-label">{prompt.label}</div>
      <input
        className="prompt-input"
        value={value}
        autoFocus
        aria-label={prompt.label}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && ok()}
      />
      {prompt.scope && (
        <div className="prompt-options" role="radiogroup">
          <label>
            <input type="radio" name="variable-scope" checked={scope === 'global'} onChange={() => setScope('global')} />
            <span>For all sprites</span>
          </label>
          <label>
            <input type="radio" name="variable-scope" checked={scope === 'local'} onChange={() => setScope('local')} />
            <span>For this sprite only</span>
          </label>
        </div>
      )}
      <div className="prompt-buttons">
        <button onClick={() => answerPrompt(null)}>Cancel</button>
        {main}
      </div>
    </Modal>
  );
}
