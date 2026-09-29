/**
 * Playing one gallery world (§2.14): read the whole file (only now), start it in the visible player at the
 * `gallery` slot (muted until the teacher turns sound on), then robot-test it in the spare for "Runs without
 * errors". One game at a time: the next world replaces this one in the same player.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { usePlayerSlot } from '../../app/player/slots';
import { playerPrefsFrom } from '../../app/player/prefs';
import { useServices } from '../../app/services';
import type { AmbleFile } from '../../model/types';
import type { RobotRun } from '../../school/checks';
import { robotResultOf, setRobotResult, type GalleryItem } from '../../school/gallery';
import { initFromFile } from '../../school/galleryInit';
import { getState } from '../../state/store';

export type PlayState = 'idle' | 'loading' | 'playing' | 'stopped' | 'failed';

export interface GalleryPlayer {
  state: PlayState;
  file: AmbleFile | null;
  /** undefined while testing; null when the test couldn't run. */
  robot: RobotRun | undefined;
  muted: boolean;
  toggleSound(): void;
  restart(): void;
  stop(): void;
  start(): void;
  fullscreen(): void;
}

const ROBOT_SECONDS = 6;

export function useGalleryPlayer(item: GalleryItem | null, slot: RefObject<HTMLElement | null>): GalleryPlayer {
  const { files, player } = useServices();
  const [state, setState] = useState<PlayState>('idle');
  const [file, setFile] = useState<AmbleFile | null>(null);
  const [robot, setRobot] = useState<RobotRun | undefined>(undefined);
  const [muted, setMuted] = useState(true);
  const [run, setRun] = useState(0);
  const current = useRef<string | null>(null);
  usePlayerSlot('gallery', slot, state === 'playing' || state === 'loading');

  const id = item?.id ?? null;
  const ready = item?.status === 'ready';
  useEffect(() => {
    current.current = id;
    setFile(null);
    setMuted(true);
    if (!id || !item || !ready) {
      setState('idle');
      return;
    }
    const known = robotResultOf(id);
    setRobot(known === undefined ? undefined : known);
    setState('loading');
    let live = true;
    void (async () => {
      let full: AmbleFile;
      try {
        full = await files.read(item.file);
      } catch {
        if (live) setState('failed');
        return;
      }
      if (!live) return;
      setFile(full);
      const prefs = { ...playerPrefsFrom(getState().prefs), muted: true };
      try {
        player.setTitle(full.world?.title ?? item.title);
        await player.load(await initFromFile(full, { mode: 'play', prefs }));
        if (live) setState('playing');
      } catch {
        if (live) setState('failed');
      }
      if (!live || known !== undefined) return;
      let result: RobotRun = null;
      try {
        const verdict = await player.robot(await initFromFile(full, { mode: 'robot', prefs, seconds: ROBOT_SECONDS }));
        result = { errors: verdict.raw.errors.length || (verdict.raw.state === 'crashed' ? 1 : 0), seconds: ROBOT_SECONDS };
      } catch {
        result = null;
      }
      setRobotResult(id, result);
      if (live && current.current === id) setRobot(result);
    })();
    return () => {
      live = false;
    };
    // `run` restarts it (Play after Stop).
  }, [id, ready, run, files, player]); // item is read through id and ready

  const toggleSound = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      player.prefs({ muted: next });
      return next;
    });
  }, [player]);

  return {
    state,
    file,
    robot,
    muted,
    toggleSound,
    restart: () => state === 'playing' && player.restartLevel(),
    stop: () => {
      if (state !== 'playing') return;
      player.pause();
      setState('stopped');
    },
    start: () => setRun((n) => n + 1),
    fullscreen: () => {
      const el = slot.current;
      if (el && state === 'playing') void player.fullscreen(el);
    },
  };
}
