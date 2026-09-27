import { useEffect, useRef, useState } from 'react';
import { compiledAssetsFor, findCompiledSprite, findTarget, useStore } from '../store';
import { deleteCompiledAsset, keepCompiledAsset, renameSound } from '../actions';
import { importSoundFile, pickFile } from '../project/importers';
import { synthSound } from '../project/defaults';
import { uniqueName, uid } from '../project/ids';
import { SOUND_PRESETS } from '../audio/synth';
import type { CompiledAsset, SoundAsset } from '../project/types';
import { KeepIcon, MicIcon, PauseIcon, PlayIcon, SparkIcon, TrashIcon, UploadIcon, WaveIcon } from './icons';

let playing: HTMLAudioElement | null = null;

function usePlayer() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const play = (s: SoundAsset | CompiledAsset) => {
    if (s.kind !== 'sound') return;
    playing?.pause();
    if (playingId === s.id) {
      setPlayingId(null);
      return;
    }
    const audio = new Audio(s.dataUrl);
    playing = audio;
    setPlayingId(s.id);
    audio.onended = () => setPlayingId((id) => (id === s.id ? null : id));
    void audio.play().catch(() => setPlayingId(null));
  };
  useEffect(() => () => playing?.pause(), []);
  return { playingId, play };
}

function Waveform({ url }: { url: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    const ctx = new OfflineAudioContext(1, 1, 22050);
    void fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((buffer) => {
        if (cancelled || !ref.current) return;
        const c = ref.current.getContext('2d')!;
        const { width, height } = ref.current;
        const data = buffer.getChannelData(0);
        c.clearRect(0, 0, width, height);
        c.fillStyle = '#cf63cf';
        const step = Math.max(1, Math.floor(data.length / width));
        for (let x = 0; x < width; x++) {
          let peak = 0;
          for (let i = x * step; i < (x + 1) * step && i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
          const h = Math.max(1, peak * height * 0.95);
          c.fillRect(x, (height - h) / 2, 1, h);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url]);
  return <canvas ref={ref} width={420} height={120} className="waveform" />;
}

/** Sounds of the selected sprite: yours (upload, record, or make with the synth), then compiled ones. */
export function SoundsPane() {
  const project = useStore((s) => s.project);
  const selectedId = useStore((s) => s.selectedId);
  const soundSel = useStore((s) => s.soundSel[selectedId]);
  const selectSound = useStore((s) => s.selectSound);
  const update = useStore((s) => s.update);
  const notify = useStore((s) => s.notify);
  const { playingId, play } = usePlayer();
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [synthMenu, setSynthMenu] = useState(false);
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  const target = findTarget(project, selectedId);
  const compiledView = target ? null : findCompiledSprite(project, selectedId);
  const own = target?.sounds ?? [];
  const compiled = (target ? compiledAssetsFor(project, selectedId) : compiledView?.sounds ?? []).filter((a) => a.kind === 'sound');
  const all: Array<SoundAsset | CompiledAsset> = [...own, ...compiled];
  const current = all.find((s) => s.id === soundSel) ?? all[0] ?? null;
  const currentIsCompiled = Boolean(current && 'targetId' in current);

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

  const upload = async () => {
    for (const f of await pickFile('audio/*', true)) {
      try {
        add(await importSoundFile(f));
      } catch (err) {
        notify((err as Error).message, 'error');
      }
    }
  };
  const record = async () => {
    if (recording) {
      recording.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(null);
        try {
          add(await importSoundFile(new Blob(chunks, { type: rec.mimeType }), 'recording'));
        } catch (err) {
          notify((err as Error).message, 'error');
        }
      };
      rec.start();
      setRecording(rec);
    } catch {
      notify('Microphone not available.', 'error');
    }
  };

  if (!target && !compiledView) return <div className="pane-empty">Select a sprite.</div>;

  return (
    <div className="assets-pane">
      <div className="asset-list">
        {own.map((s, i) => (
          <div key={s.id} className={`asset-tile sound ${current?.id === s.id ? 'selected' : ''}`} onClick={() => selectSound(selectedId, s.id)}>
            <span className="index">{i + 1}</span>
            <button className="play" onClick={(e) => (e.stopPropagation(), play(s))} title="Play">
              {playingId === s.id ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
            </button>
            <span className="name">{s.name}</span>
            <span className="meta">{s.duration.toFixed(2)} s</span>
          </div>
        ))}
        {compiled.length > 0 && (
          <div className="compiled-heading">
            <SparkIcon size={13} /> Compiled
          </div>
        )}
        {compiled.map((s) => (
          <div key={s.id} className={`asset-tile sound compiled ${current?.id === s.id ? 'selected' : ''}`} onClick={() => selectSound(selectedId, s.id)}>
            <button className="play" onClick={(e) => (e.stopPropagation(), play(s))} title="Play">
              {playingId === s.id ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
            </button>
            <span className="name">{s.name}</span>
            <span className="meta">{s.kind === 'sound' ? `${s.duration.toFixed(2)} s` : ''}</span>
            <span className="ai-badge">
              <SparkIcon size={11} />
            </span>
          </div>
        ))}
        {target && (
          <div className="asset-add">
            <div className="synth-wrap">
              <button title="Make a sound" onClick={() => setSynthMenu((m) => !m)}>
                <WaveIcon size={16} />
              </button>
              {synthMenu && (
                <div className="menu up" onMouseLeave={() => setSynthMenu(false)}>
                  {Object.keys(SOUND_PRESETS).map((name) => (
                    <button
                      key={name}
                      onClick={() => {
                        add({ ...synthSound(name, name as keyof typeof SOUND_PRESETS), id: uid('a') });
                        setSynthMenu(false);
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button title="Upload a sound" onClick={() => void upload()}>
              <UploadIcon size={16} />
            </button>
            <button title={recording ? 'Stop recording' : 'Record'} className={recording ? 'recording' : ''} onClick={() => void record()}>
              <MicIcon size={16} />
            </button>
          </div>
        )}
      </div>
      <div className="asset-detail">
        {!current && <div className="pane-empty">No sounds yet. Make one with the synth, upload, or record.</div>}
        {current && current.kind === 'sound' && (
          <>
            <div className="asset-header">
              {currentIsCompiled ? (
                <span className="compiled-title">
                  <SparkIcon size={14} /> {current.name}
                </span>
              ) : (
                <input
                  className="name-input"
                  value={nameDraft ?? current.name}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => {
                    const v = (nameDraft ?? '').trim();
                    if (v && v !== current.name) renameSound(selectedId, current.id, v);
                    setNameDraft(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              )}
              <button className="btn small" onClick={() => play(current)}>
                {playingId === current.id ? <PauseIcon size={14} /> : <PlayIcon size={14} />} Play
              </button>
              {currentIsCompiled && target ? (
                <>
                  <button className="btn primary small" onClick={() => keepCompiledAsset(current.id)}>
                    <KeepIcon size={14} /> Keep
                  </button>
                  <button className="btn small" onClick={() => deleteCompiledAsset(current.id)}>
                    <TrashIcon size={14} />
                  </button>
                </>
              ) : !currentIsCompiled ? (
                <button className="btn small" onClick={() => setOwn((list) => list.splice(list.findIndex((x) => x.id === current.id), 1))}>
                  <TrashIcon size={14} />
                </button>
              ) : null}
            </div>
            <Waveform url={current.dataUrl} />
            {currentIsCompiled && (
              <p>
                <b>Made by the compiler:</b> {(current as CompiledAsset).request}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
