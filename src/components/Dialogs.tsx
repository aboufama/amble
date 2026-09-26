import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { CHATGPT_MODEL_NAME, hasServerKey, listModels, resolveTransport, type ReasoningEffort } from '../compiler/openai';
import { cancelChatGptSignIn, refreshChatGpt, signInWithChatGpt, signOutOfChatGpt } from '../actions';
import { XIcon } from './icons';

export function Modal({ title, onClose, children, wide }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <XIcon size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

const SUGGESTED = ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5', 'gpt-5-mini', 'gpt-5.1', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'];

/** Sign in with ChatGPT: works when Amble runs on your computer, through the Codex CLI there. */
function ChatGptSection() {
  const codex = useStore((s) => s.codex);
  const useChatGpt = useStore((s) => s.settings.useChatGpt);

  useEffect(() => {
    void refreshChatGpt();
  }, []);

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
  if (useChatGpt && codex.auth === 'chatgpt') {
    return (
      <div className="account-card">
        <p className="note ok">
          Signed in with ChatGPT. Compiling uses <b>{CHATGPT_MODEL_NAME}</b> (GPT-6 Astra, low reasoning) on your ChatGPT plan, through Codex {codex.version}.
        </p>
        <div className="row center">
          <button className="btn small" onClick={signOutOfChatGpt}>
            Sign out
          </button>
          <small className="muted">Codex itself stays signed in on this computer.</small>
        </div>
      </div>
    );
  }
  if (codex.login.pending) {
    return (
      <div className="account-card">
        <p className="note">
          Finish signing in to ChatGPT in your browser.{' '}
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
      <div className="row">
        <button className="btn primary" onClick={() => void signInWithChatGpt()}>
          Sign in with ChatGPT
        </button>
      </div>
      <small className="muted">
        Compiles then run on your ChatGPT plan with {CHATGPT_MODEL_NAME}, through the Codex app on this computer. No API key needed.
        {codex.auth === 'apikey' && ' (Codex here is signed in with an API key right now; signing in switches it to your ChatGPT account.)'}
      </small>
      {codex.login.error && <p className="note bad">{codex.login.error}</p>}
    </div>
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
  const signedIn = useStore((s) => s.settings.useChatGpt && s.codex?.auth === 'chatgpt');
  const codexVersion = useStore((s) => s.codex?.version);

  useEffect(() => {
    void hasServerKey().then(setServer);
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

  const keySection = (
    <>
      {server && <p className="note ok">The dev server has OPENAI_API_KEY set, so you can leave the key empty.</p>}
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
        <small className="muted">
          Stored only in this browser and sent only to OpenAI. Games run in a sandbox that can't read it. Create one at platform.openai.com → API keys.
        </small>
      </label>
      <div className="row wrap">
        <label className="text-field grow">
          <span>Model (writes the game code)</span>
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
      <details>
        <summary>Advanced</summary>
        <label className="text-field">
          <span>API base URL (any OpenAI-compatible endpoint)</span>
          <input value={settings.baseUrl} onChange={(e) => setSettings({ baseUrl: e.target.value })} />
        </label>
      </details>
    </>
  );

  return (
    <Modal title="Settings" onClose={() => setDialog(null)}>
      <section className="settings">
        <h3>ChatGPT</h3>
        <ChatGptSection />
        {signedIn ? (
          <details>
            <summary>OpenAI API key and models (used when you sign out)</summary>
            <div className="key-fields">{keySection}</div>
          </details>
        ) : (
          <>
            <h3>OpenAI API key</h3>
            {keySection}
          </>
        )}
        <div className="row">
          <button className="btn" onClick={() => void testConnection()}>
            Test connection
          </button>
          {test && <span className={test.ok ? 'ok' : 'bad'}>{test.message}</span>}
        </div>
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
