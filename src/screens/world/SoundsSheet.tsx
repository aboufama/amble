/**
 * The Sounds sheet (⋯ → Sounds, §2.6): one row per sound the game plays, with ▶, where it comes from
 * ("Amble's coin sound", "Your recording", "Picked: Pop"), Pick a sound (each preset in 3 variations),
 * Record (5 s, microphone allowed only; it stays on this Chromebook and in files, never sent), effects,
 * and a caption. Changes apply when the sheet closes (the world reloads) and become one footstep.
 */
import { useEffect, useRef, useState } from 'react';
import { SAMPLE_RATE } from '../../audio/synth';
import type { SoundEffect } from '../../audio/effects';
import { useServices } from '../../app/services';
import { t, type MessageKey } from '../../i18n';
import type { SoundPiece, World } from '../../model/types';
import { showToast } from '../../state/app';
import { loadGame, recordStep, updateWorld } from '../../state/session';
import { Button, Chip, Field, IconButton, Sheet } from '../../ui/components';
import { PRESET_NAMES, renderPiece, soundsUsed } from '../../world/sounds';
import { nameFromKey } from '../../world/cast';

const EFFECTS: Array<{ id: SoundEffect; word: MessageKey }> = [
  { id: 'faster', word: 'world.fxFaster' },
  { id: 'slower', word: 'world.fxSlower' },
  { id: 'louder', word: 'world.fxLouder' },
  { id: 'softer', word: 'world.fxSofter' },
  { id: 'robot', word: 'world.fxRobot' },
  { id: 'reverse', word: 'world.fxBackwards' },
];

const RECORD_MS = 5000;

let audio: AudioContext | null = null;

async function play(piece: SoundPiece | null, name: string, blobOf: (ref: string) => Promise<Blob | null>): Promise<void> {
  audio ??= new AudioContext();
  if (audio.state === 'suspended') await audio.resume();
  let buffer: AudioBuffer | null = null;
  const pcm = renderPiece(piece ?? { name, source: { kind: 'preset', preset: name, variation: 0 }, effects: [], caption: '', madeBy: 'example' });
  if (pcm) {
    buffer = audio.createBuffer(1, pcm.length, SAMPLE_RATE);
    buffer.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
  } else if (piece?.source.kind === 'recording') {
    const blob = await blobOf(piece.source.blob);
    if (blob) buffer = await audio.decodeAudioData(await blob.arrayBuffer());
  }
  if (!buffer) return;
  const src = audio.createBufferSource();
  src.buffer = buffer;
  src.connect(audio.destination);
  src.start();
}

function sourceLine(name: string, piece: SoundPiece | undefined): string {
  if (!piece) return t('world.soundFromAmble', { name });
  if (piece.source.kind === 'recording') return t('world.soundRecording');
  if (piece.source.kind === 'preset') {
    const label = nameFromKey(piece.source.preset);
    return t('world.soundPicked', { name: piece.source.variation ? `${label} ${piece.source.variation + 1}` : label });
  }
  return t('world.soundFromAmble', { name });
}

function SoundRow({ name, piece, onChange, micOk }: { name: string; piece: SoundPiece | undefined; onChange(p: SoundPiece | null): void; micOk: boolean }) {
  const { store } = useServices();
  const [recording, setRecording] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const picked = piece?.source.kind === 'preset' ? `${piece.source.preset}:${piece.source.variation}` : '';

  const record = async () => {
    if (recording) {
      stopRef.current?.();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      showToast(t('world.soundNoMic'));
      return;
    }
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const startedAt = performance.now();
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop());
      setRecording(false);
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const ref = await store.blobs.put(blob);
      onChange({
        name,
        source: { kind: 'recording', blob: ref, mime: 'audio/webm', duration: Math.min(RECORD_MS, performance.now() - startedAt) / 1000 },
        effects: piece?.effects ?? [],
        caption: piece?.caption ?? '',
        madeBy: 'student',
      });
    };
    const timer = setTimeout(() => rec.state === 'recording' && rec.stop(), RECORD_MS);
    stopRef.current = () => {
      clearTimeout(timer);
      if (rec.state === 'recording') rec.stop();
    };
    rec.start();
    setRecording(true);
  };

  useEffect(() => () => stopRef.current?.(), []);

  return (
    <li className="sound-row" data-testid={`sound-${name}`}>
      <div className="sound-row__head">
        <IconButton icon="play" label={t('world.soundPlay', { name })} size={38} variant="ghost" onClick={() => void play(piece ?? null, name, (r) => store.blobs.get(r as never))} />
        <div className="sound-row__title">
          <strong>{nameFromKey(name)}</strong>
          <span>{sourceLine(name, piece)}</span>
        </div>
      </div>
      <div className="sound-row__tools">
        <label className="sound-row__pick">
          <span className="sr-only">{t('world.soundPick')}</span>
          <select
            value={picked}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) {
                onChange(null);
                return;
              }
              const [preset, variation] = v.split(':');
              onChange({
                name,
                source: { kind: 'preset', preset, variation: Number(variation) as 0 | 1 | 2 },
                effects: piece?.effects ?? [],
                caption: piece?.caption ?? '',
                madeBy: 'student',
              });
            }}
          >
            <option value="">{piece ? t('world.soundUseAmble') : t('world.soundPick')}</option>
            {PRESET_NAMES.flatMap((p) =>
              [0, 1, 2].map((v) => (
                <option key={`${p}:${v}`} value={`${p}:${v}`}>
                  {v ? `${nameFromKey(p)} ${v + 1}` : nameFromKey(p)}
                </option>
              )),
            )}
          </select>
        </label>
        {micOk && (
          <Button size={38} variant={recording ? 'danger' : 'ghost'} icon={recording ? 'close' : 'mic'} onClick={() => void record()}>
            {recording ? t('world.soundStop') : t('world.soundRecord')}
          </Button>
        )}
      </div>
      {piece && (
        <>
          <div className="sound-row__fx" role="group" aria-label={t('world.soundEffects')}>
            {EFFECTS.map((fx) => {
              const on = piece.effects.includes(fx.id);
              return (
                <Chip key={fx.id} selected={on} onClick={() => onChange({ ...piece, effects: on ? piece.effects.filter((e) => e !== fx.id) : [...piece.effects, fx.id] })}>
                  {t(fx.word)}
                </Chip>
              );
            })}
          </div>
          <Field label={t('world.soundCaption')} hint={t('world.soundCaptionHint')} value={piece.caption} maxLength={40} onChange={(e) => onChange({ ...piece, caption: e.target.value })} />
        </>
      )}
    </li>
  );
}

export function SoundsSheet({ open, world, onClose }: { open: boolean; world: World; onClose(): void }) {
  const [draft, setDraft] = useState<Record<string, SoundPiece>>(world.sounds);
  const [micOk, setMicOk] = useState(false);
  useEffect(() => {
    if (!open) return;
    setDraft(world.sounds);
    setMicOk(typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const names = soundsUsed(world.code, draft);

  const close = () => {
    onClose();
    const before = JSON.stringify(world.sounds);
    if (JSON.stringify(draft) === before) return;
    const changed = names.filter((n) => JSON.stringify(draft[n] ?? null) !== JSON.stringify(world.sounds[n] ?? null));
    const next = updateWorld((w) => {
      w.sounds = draft;
    });
    void recordStep({ kind: 'sound', by: 'student', text: changed.length === 1 ? t('world.stepSound', { name: changed[0] }) : t('world.stepSounds') });
    if (next) void loadGame(next, { autostart: true });
  };

  return (
    <Sheet open={open} onClose={close} title={t('world.soundsTitle')} side="right">
      <p className="dialog__text">{t('world.soundsIntro')}</p>
      {names.length ? (
        <ul className="sound-list">
          {names.map((name) => (
            <SoundRow
              key={name}
              name={name}
              piece={draft[name]}
              micOk={micOk}
              onChange={(p) =>
                setDraft((d) => {
                  const next = { ...d };
                  if (p) next[name] = p;
                  else delete next[name];
                  return next;
                })
              }
            />
          ))}
        </ul>
      ) : (
        <p className="dialog__text">{t('world.soundsNone')}</p>
      )}
    </Sheet>
  );
}
