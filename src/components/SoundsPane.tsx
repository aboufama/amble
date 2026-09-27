import { useEffect, useMemo, useRef, useState } from 'react';
import { compiledAssetsFor, findCompiledSprite, findTarget, useStore } from '../store';
import { deleteCompiledAsset, keepCompiledAsset, renameSound } from '../actions';
import { importSoundFile, pickFile } from '../project/importers';
import { exportAsset } from '../project/persistence';
import { synthSound } from '../project/defaults';
import { uniqueName, uid } from '../project/ids';
import { SOUND_PRESETS } from '../audio/synth';
import { EDIT_SAMPLE_RATE, SOUND_EFFECTS, applyEffect, chunkLevels, decodeSound, encodeSound, waveformPath, type SoundEffect } from '../audio/effects';
import type { CompiledAsset, SoundAsset } from '../project/types';
import { Modal } from './Dialogs';
import { Library } from './Library';
import { moveItem, useReorder } from './useReorder';
import { ActionMenu, AssetTile, ContextMenu } from './SpritePane';
import {
  AddSoundIcon,
  CopyToNewIcon,
  FadeInIcon,
  FadeOutIcon,
  FasterIcon,
  KeepIcon,
  LouderIcon,
  MicIcon,
  MuteIcon,
  PlayIcon,
  RecordIcon,
  RedoIcon,
  ReverseIcon,
  RobotIcon,
  SearchIcon,
  SlowerIcon,
  SofterIcon,
  SoundIcon,
  SparkIcon,
  StopSquareIcon,
  SurpriseIcon,
  TrashIcon,
  UndoIcon,
  UploadIcon,
} from './icons';

type Sound = SoundAsset | (CompiledAsset & { kind: 'sound' });

const EFFECT_ICONS: Record<SoundEffect, typeof FasterIcon> = {
  faster: FasterIcon,
  slower: SlowerIcon,
  louder: LouderIcon,
  softer: SofterIcon,
  mute: MuteIcon,
  fadeIn: FadeInIcon,
  fadeOut: FadeOutIcon,
  reverse: ReverseIcon,
  robot: RobotIcon,
};

// -----------------------------------------------------------------------------
// Playback: one sound at a time, like Scratch's editor
// -----------------------------------------------------------------------------

let current: { audio: HTMLAudioElement; key: string } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function stopSound() {
  current?.audio.pause();
  current = null;
  notify();
}

function playSound(key: string, url: string) {
  stopSound();
  const audio = new Audio(url);
  current = { audio, key };
  audio.onended = () => {
    if (current?.audio === audio) stopSound();
  };
  void audio.play().catch(() => stopSound());
  notify();
}

/** Which sound is playing (by key), and its <audio> element for the playhead. */
function usePlaying(): { key: string | null; audio: HTMLAudioElement | null } {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  useEffect(() => () => stopSound(), []);
  return { key: current?.key ?? null, audio: current?.audio ?? null };
}

// -----------------------------------------------------------------------------
// Waveform
// -----------------------------------------------------------------------------

const WAVE_W = 600;
const WAVE_H = 160;

function Waveform({ samples, audio }: { samples: Float32Array | null; audio: HTMLAudioElement | null }) {
  const path = useMemo(() => {
    if (!samples) return null;
    const chunk = Math.max(128, Math.ceil(samples.length / 150));
    return waveformPath(chunkLevels(samples, chunk), WAVE_W, WAVE_H);
  }, [samples]);
  const [playhead, setPlayhead] = useState<number | null>(null);
  useEffect(() => {
    if (!audio) {
      setPlayhead(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      setPlayhead(audio.duration ? audio.currentTime / audio.duration : 0);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [audio]);
  return (
    <div className="waveform-container">
      <svg className="waveform" viewBox={`-1 ${-WAVE_H / 2} ${WAVE_W + 2} ${WAVE_H}`}>
        <line className="waveform-baseline" x1={-1} y1={0} x2={WAVE_W} y2={0} />
        {path && <path className="waveform-path" d={path} strokeLinejoin="round" />}
      </svg>
      {playhead !== null && <div className="waveform-playhead" style={{ left: `${playhead * 100}%` }} />}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Record Sound (Scratch's recording dialog)
// -----------------------------------------------------------------------------

function RecordModal({ onSave, onClose }: { onSave(blob: Blob): void; onClose(): void }) {
  const [phase, setPhase] = useState<'idle' | 'recording' | 'done'>('idle');
  const [level, setLevel] = useState(0);
  const [result, setResult] = useState<{ blob: Blob; url: string; samples: Float32Array | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef<{ recorder: MediaRecorder; stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);
  const playing = usePlaying();

  const cleanup = () => {
    const l = live.current;
    live.current = null;
    if (!l) return;
    cancelAnimationFrame(l.raf);
    if (l.recorder.state !== 'inactive') l.recorder.stop();
    l.stream.getTracks().forEach((t) => t.stop());
    void l.ctx.close();
  };
  useEffect(() => cleanup, []);
  const resultUrl = result?.url;
  useEffect(
    () => () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    },
    [resultUrl],
  );

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType });
        const url = URL.createObjectURL(blob);
        setResult({ blob, url, samples: null });
        setPhase('done');
        void decodeSound(url)
          .then((samples) => setResult((r) => (r && r.url === url ? { ...r, samples } : r)))
          .catch(() => undefined);
      };
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      const meter = () => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += v * v;
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
        if (live.current) live.current.raf = requestAnimationFrame(meter);
      };
      live.current = { recorder, stream, ctx, raf: 0 };
      recorder.start();
      setPhase('recording');
      meter();
    } catch {
      setError('Could not use the microphone. Check that this site may use it.');
    }
  };
  const stop = () => {
    const l = live.current;
    if (!l) return;
    l.recorder.stop();
    cancelAnimationFrame(l.raf);
    l.stream.getTracks().forEach((t) => t.stop());
    void l.ctx.close();
    live.current = null;
    setLevel(0);
  };

  return (
    <Modal title="Record Sound" onClose={onClose} className="record-modal">
      {phase !== 'done' ? (
        <div className="record-body">
          <div className="record-meter" aria-hidden="true">
            <div className="record-meter-fill" style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          {phase === 'idle' ? (
            <button className="record-button" onClick={() => void start()}>
              <span className="record-button-circle">
                <RecordIcon size={34} />
              </span>
              Record
            </button>
          ) : (
            <button className="record-button recording" onClick={stop}>
              <span className="record-button-circle">
                <StopSquareIcon size={30} />
              </span>
              Stop recording
            </button>
          )}
          {error && <p className="record-error">{error}</p>}
        </div>
      ) : (
        <div className="record-body">
          <Waveform samples={result?.samples ?? null} audio={playing.key === 'recording' ? playing.audio : null} />
          <div className="record-actions">
            <button
              className="round-play"
              aria-label={playing.key === 'recording' ? 'Stop' : 'Play'}
              onClick={() => (playing.key === 'recording' ? stopSound() : result && playSound('recording', result.url))}
            >
              {playing.key === 'recording' ? <StopSquareIcon size={20} /> : <PlayIcon size={20} />}
            </button>
            <button
              className="prompt-button"
              onClick={() => {
                stopSound();
                setResult(null);
                setPhase('idle');
              }}
            >
              Re-record
            </button>
            <button
              className="prompt-button ok"
              onClick={() => {
                stopSound();
                if (result) onSave(result.blob);
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// The Sounds tab
// -----------------------------------------------------------------------------

interface Snapshot {
  dataUrl: string;
  mime: string;
  duration: number;
}

/** Sounds of the selected sprite (yours, then compiled ones) and Scratch's sound editor. */
export function SoundsPane() {
  const project = useStore((s) => s.project);
  const selectedId = useStore((s) => s.selectedId);
  const soundSel = useStore((s) => s.soundSel[selectedId]);
  const selectSound = useStore((s) => s.selectSound);
  const update = useStore((s) => s.update);
  const toast = useStore((s) => s.notify);
  const playing = usePlaying();
  const [library, setLibrary] = useState(false);
  const recording = useStore((s) => s.recording);
  const setRecording = useStore((s) => s.setRecording);
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [samples, setSamples] = useState<{ url: string; data: Float32Array } | null>(null);
  const reorder = useReorder((from, to) => setOwn((list) => moveItem(list, from, to)));
  const history = useRef<Record<string, { undo: Snapshot[]; redo: Snapshot[] }>>({});
  const [, forceHistory] = useState(0);

  const target = findTarget(project, selectedId);
  const compiledView = target ? null : findCompiledSprite(project, selectedId);
  const own = target?.sounds ?? [];
  const compiled = (target ? compiledAssetsFor(project, selectedId) : compiledView?.sounds ?? []).filter((a): a is CompiledAsset & SoundAsset => a.kind === 'sound');
  const all: Sound[] = [...own, ...compiled];
  const sound = all.find((s) => s.id === soundSel) ?? all[0] ?? null;
  const isCompiled = Boolean(sound && 'targetId' in sound);
  const soundUrl = sound?.dataUrl;

  useEffect(() => {
    if (!soundUrl) return;
    let cancelled = false;
    void decodeSound(soundUrl)
      .then((data) => !cancelled && setSamples({ url: soundUrl, data }))
      .catch(() => !cancelled && setSamples(null));
    return () => {
      cancelled = true;
    };
  }, [soundUrl]);

  const setOwn = (fn: (list: SoundAsset[]) => void) =>
    update((p) => {
      const t = findTarget(p, selectedId);
      if (t) fn(t.sounds);
    });
  const add = (s: SoundAsset) => {
    setOwn((list) => {
      s.name = uniqueName(s.name, list.map((x) => x.name));
      list.push(s);
    });
    selectSound(selectedId, s.id);
  };
  const addPreset = (name: string) => add({ ...synthSound(name, name as keyof typeof SOUND_PRESETS), id: uid('a') });
  const upload = async () => {
    for (const f of await pickFile('audio/*', true)) {
      try {
        add(await importSoundFile(f));
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    }
  };
  const remove = (id: string) => {
    const index = own.findIndex((x) => x.id === id);
    const removed = own[index];
    if (!removed) return;
    stopSound();
    setOwn((list) => void list.splice(index, 1));
    const targetId = selectedId;
    useStore.getState().setRestore({
      what: 'Sound',
      run: () => {
        update((p) => {
          const t = findTarget(p, targetId);
          if (!t) return;
          t.sounds.splice(Math.min(index, t.sounds.length), 0, { ...removed, name: uniqueName(removed.name, t.sounds.map((x) => x.name)) });
        });
        useStore.getState().select(targetId);
        selectSound(targetId, removed.id);
      },
    });
  };
  const duplicate = (id: string) => {
    const copy = own.find((x) => x.id === id);
    if (!copy) return;
    const next = { ...copy, id: uid('a'), name: uniqueName(copy.name, own.map((x) => x.name)) };
    setOwn((list) => void list.splice(list.findIndex((x) => x.id === id) + 1, 0, next));
    selectSound(selectedId, next.id);
  };

  const replace = (id: string, snap: Snapshot) =>
    setOwn((list) => {
      const s = list.find((x) => x.id === id);
      if (s) Object.assign(s, snap);
    });
  const historyOf = (id: string) => (history.current[id] ??= { undo: [], redo: [] });
  const applySoundEffect = (effect: SoundEffect) => {
    if (!sound || isCompiled || !samples || samples.url !== sound.dataUrl) return;
    stopSound();
    const h = historyOf(sound.id);
    h.undo.push({ dataUrl: sound.dataUrl, mime: sound.mime, duration: sound.duration });
    h.redo = [];
    replace(sound.id, encodeSound(applyEffect(samples.data, EDIT_SAMPLE_RATE, effect)));
    forceHistory((n) => n + 1);
  };
  const undoRedo = (dir: 'undo' | 'redo') => {
    if (!sound || isCompiled) return;
    const h = historyOf(sound.id);
    const snap = h[dir].pop();
    if (!snap) return;
    h[dir === 'undo' ? 'redo' : 'undo'].push({ dataUrl: sound.dataUrl, mime: sound.mime, duration: sound.duration });
    stopSound();
    replace(sound.id, snap);
    forceHistory((n) => n + 1);
  };

  if (!target && !compiledView) return <div className="pane-empty">Select a sprite.</div>;

  const h = sound ? history.current[sound.id] : undefined;
  const isPlaying = (s: Sound) => playing.key === s.id;
  const togglePlay = (s: Sound) => (isPlaying(s) ? stopSound() : playSound(s.id, s.dataUrl));
  const tile = (s: Sound, i: number | undefined, isOwn: boolean, shown?: number) => (
    <AssetTile
      key={s.id}
      className="asset-tile sound-tile"
      number={shown === undefined ? undefined : shown + 1}
      name={s.name}
      details={s.duration.toFixed(2)}
      image={<SoundIcon size={32} className="sound-tile-icon" />}
      selected={sound?.id === s.id}
      compiled={!isOwn}
      onSelect={() => selectSound(selectedId, s.id)}
      onDelete={isOwn ? () => remove(s.id) : undefined}
      confirmWhat={isOwn ? 'sound' : undefined}
      onContextMenu={isOwn ? (at) => setMenu({ id: s.id, at }) : undefined}
      reorder={isOwn && i !== undefined ? { onPointerDown: reorder.onPointerDown(i), placeholder: reorder.drag?.from === i } : undefined}
    >
      <button
        className={`tile-play ${isPlaying(s) ? 'playing' : ''}`}
        aria-label={isPlaying(s) ? 'Stop' : 'Play'}
        title={isPlaying(s) ? 'Stop' : 'Play'}
        onClick={(e) => {
          e.stopPropagation();
          togglePlay(s);
        }}
      >
        {isPlaying(s) ? <StopSquareIcon size={14} /> : <PlayIcon size={14} />}
      </button>
    </AssetTile>
  );
  const presetNames = Object.keys(SOUND_PRESETS);

  return (
    <div className="asset-panel">
      <div className="asset-selector">
        <div className="asset-list" ref={reorder.containerRef}>
          {reorder.order(own.length).map((i, shown) => tile(own[i], i, true, shown))}
          {compiled.length > 0 && (
            <div className="compiled-heading">
              <SparkIcon size={13} /> Compiled
            </div>
          )}
          {compiled.map((s) => tile(s, undefined, false))}
        </div>
        {target && (
          <ActionMenu
            className="add-asset"
            title="Choose a Sound"
            icon={<AddSoundIcon size={28} />}
            onClick={() => setLibrary(true)}
            items={[
              { label: 'Upload Sound', icon: <UploadIcon size={20} strokeWidth={2.4} />, onClick: () => void upload() },
              { label: 'Surprise', icon: <SurpriseIcon size={20} />, onClick: () => addPreset(presetNames[Math.floor(Math.random() * presetNames.length)]) },
              { label: 'Record', icon: <MicIcon size={20} strokeWidth={2.4} />, onClick: () => setRecording(true) },
              { label: 'Choose a Sound', icon: <SearchIcon size={20} />, onClick: () => setLibrary(true) },
            ]}
          />
        )}
        {menu && (
          <ContextMenu
            at={menu.at}
            onClose={() => setMenu(null)}
            items={[
              { label: 'duplicate', onClick: () => duplicate(menu.id) },
              {
                label: 'export',
                onClick: () => {
                  const s = own.find((x) => x.id === menu.id);
                  if (s) void exportAsset(s).catch((err: Error) => toast(err.message, 'error'));
                },
              },
              { label: 'delete', danger: true, onClick: () => remove(menu.id) },
            ]}
          />
        )}
      </div>
      <div className="asset-detail sound-editor">
        {!sound && <div className="pane-empty">No sounds yet. Choose one, record one, or upload one.</div>}
        {sound && (
          <>
            <div className="editor-row">
              {isCompiled ? (
                <span className="compiled-title">
                  <SparkIcon size={14} /> {sound.name}
                </span>
              ) : (
                <label className="info-group">
                  <span className="info-label">Sound</span>
                  <input
                    className="info-input name-input"
                    aria-label="Sound name"
                    value={nameDraft ?? sound.name}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={() => {
                      const v = (nameDraft ?? '').trim();
                      if (v && v !== sound.name) renameSound(selectedId, sound.id, v);
                      setNameDraft(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                </label>
              )}
              {!isCompiled && (
                <div className="button-group">
                  <button className="group-button" title="Undo" aria-label="Undo" disabled={!h?.undo.length} onClick={() => undoRedo('undo')}>
                    <UndoIcon size={18} strokeWidth={2.6} />
                  </button>
                  <button className="group-button" title="Redo" aria-label="Redo" disabled={!h?.redo.length} onClick={() => undoRedo('redo')}>
                    <RedoIcon size={18} strokeWidth={2.6} />
                  </button>
                </div>
              )}
              {!isCompiled && (
                <div className="tool-group">
                  <button className="tool-button" onClick={() => duplicate(sound.id)}>
                    <CopyToNewIcon size={22} />
                    <span>Copy to New</span>
                  </button>
                </div>
              )}
              {isCompiled && target && (
                <>
                  <button className="btn primary small" onClick={() => keepCompiledAsset(sound.id)} title="Move it into your own sounds">
                    <KeepIcon size={14} /> Keep
                  </button>
                  <button className="btn small" onClick={() => deleteCompiledAsset(sound.id)} title="Delete (the next compile may make a new one)">
                    <TrashIcon size={14} />
                  </button>
                </>
              )}
            </div>
            <Waveform samples={samples?.url === sound.dataUrl ? samples.data : null} audio={isPlaying(sound) ? playing.audio : null} />
            <div className="editor-row">
              <button className="round-play" aria-label={isPlaying(sound) ? 'Stop' : 'Play'} title={isPlaying(sound) ? 'Stop' : 'Play'} onClick={() => togglePlay(sound)}>
                {isPlaying(sound) ? <StopSquareIcon size={20} /> : <PlayIcon size={20} />}
              </button>
              <div className="effect-buttons">
                {SOUND_EFFECTS.map(({ id, label }) => {
                  const Icon = EFFECT_ICONS[id];
                  return (
                    <button key={id} className="effect-button" disabled={isCompiled} onClick={() => applySoundEffect(id)}>
                      <Icon size={20} />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {isCompiled && (
              <p className="compiled-request">
                <b>Made by the compiler:</b> {(sound as CompiledAsset).request}
              </p>
            )}
          </>
        )}
      </div>
      {library && (
        <Library
          title="Choose a Sound"
          onClose={() => {
            stopSound();
            setLibrary(false);
          }}
          onChoose={(name) => {
            stopSound();
            setLibrary(false);
            addPreset(name);
          }}
          items={presetNames.map((name) => ({
            id: name,
            name,
            image: <SoundIcon size={56} className="library-sound-icon" />,
            onHover: () => playSound(`library:${name}`, synthSound(name, name as keyof typeof SOUND_PRESETS).dataUrl),
            onLeave: stopSound,
          }))}
        />
      )}
      {recording && (
        <RecordModal
          onClose={() => setRecording(false)}
          onSave={(blob) => {
            setRecording(false);
            void importSoundFile(blob, 'recording1')
              .then(add)
              .catch((err: Error) => toast(err.message, 'error'));
          }}
        />
      )}
    </div>
  );
}
