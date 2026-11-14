import { useEffect, useMemo, useState } from 'react';
import { browseSounds, renderLibrarySound, searchSounds, soundCategories, soundLibrary, type LibrarySound, type SoundKind } from '../audio/library';
import { BackIcon, PlayIcon, PlusIcon, SearchIcon, SoundIcon, StopSquareIcon } from './icons';

/** How many tiles are shown at first, and added by "Show more". */
const PAGE = 60;

const KINDS: Array<{ id: SoundKind | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'effect', label: 'Effects' },
  { id: 'music', label: 'Music' },
  { id: 'jingle', label: 'Jingles' },
];

/** Sounds are made when they are first heard; the last few are kept so Add doesn't make them again. */
const made = new Map<string, { dataUrl: string; duration: number }>();
function make(id: string): { dataUrl: string; duration: number } | null {
  let sound = made.get(id) ?? null;
  if (!sound) {
    sound = renderLibrarySound(id);
    if (!sound) return null;
    made.set(id, sound);
    if (made.size > 16) made.delete(made.keys().next().value as string);
  }
  return sound;
}

const label = (id: string): string => id[0].toUpperCase() + id.slice(1);

/**
 * The sound library ("Choose a Sound"): search or browse thousands of sounds, listen, and add
 * one to the sprite. Laid out like Scratch's library (see Library.tsx), with a search box.
 */
export function SoundLibrary({
  playingKey,
  onPlay,
  onStop,
  onChoose,
  onClose,
}: {
  /** The key of the sound playing now (library sounds play as "library:<id>"). */
  playingKey: string | null;
  onPlay(key: string, url: string): void;
  onStop(): void;
  onChoose(sound: { name: string; dataUrl: string; duration: number }): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SoundKind | 'all'>('all');
  const [category, setCategory] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const total = useMemo(() => soundLibrary().length, []);
  const categories = useMemo(() => soundCategories().filter((c) => c.id !== 'music' && c.id !== 'jingles'), []);
  const searching = query.trim().length > 0;
  const results: LibrarySound[] = useMemo(() => {
    const k = kind === 'all' ? undefined : kind;
    if (searching) return searchSounds(query, { kind: k, limit: 300 });
    return browseSounds({ kind: k, category: kind === 'effect' || kind === 'all' ? (category ?? undefined) : undefined });
  }, [query, searching, kind, category]);
  useEffect(() => setShown(PAGE), [query, kind, category]);

  const listen = (s: LibrarySound) => {
    const key = `library:${s.id}`;
    if (playingKey === key) return onStop();
    onStop();
    setBusy(s.id);
    // Music takes a moment to compose: let the tile show that it is working first.
    window.setTimeout(() => {
      const sound = make(s.id);
      setBusy(null);
      if (sound) onPlay(key, sound.dataUrl);
    }, 20);
  };
  const add = (s: LibrarySound) => {
    setBusy(s.id);
    window.setTimeout(() => {
      const sound = make(s.id);
      setBusy(null);
      if (sound) onChoose({ name: s.name, ...sound });
    }, 20);
  };

  return (
    <div className="library-overlay sound-library" role="dialog" aria-modal="true" aria-label="Choose a Sound">
      <div className="library-header">
        <button className="library-back" onClick={onClose}>
          <BackIcon size={20} /> Back
        </button>
        <div className="library-title">Choose a Sound</div>
      </div>
      <div className="sound-library-tools">
        <label className="sound-library-search">
          <SearchIcon size={18} />
          <input
            type="search"
            aria-label="Search sounds"
            placeholder={`Search ${total.toLocaleString('en-US')} sounds: try boing, pew, rain, spooky music`}
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="sound-library-chips" role="group" aria-label="Kind of sound">
          {KINDS.map((k) => (
            <button key={k.id} className={`sound-chip ${kind === k.id ? 'on' : ''}`} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
      </div>
      {!searching && (kind === 'all' || kind === 'effect') && (
        <div className="sound-library-chips categories" role="group" aria-label="Category">
          <button className={`sound-chip ${category === null ? 'on' : ''}`} aria-pressed={category === null} onClick={() => setCategory(null)}>
            Everything
          </button>
          {categories.map((c) => (
            <button key={c.id} className={`sound-chip ${category === c.id ? 'on' : ''}`} aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
              {label(c.id)}
            </button>
          ))}
        </div>
      )}
      <div className="library-grid sound-library-grid">
        {results.slice(0, shown).map((s) => {
          const playing = playingKey === `library:${s.id}`;
          return (
            <div key={s.id} className={`sound-card ${playing ? 'playing' : ''} ${busy === s.id ? 'busy' : ''}`}>
              <button className="sound-card-listen" onClick={() => listen(s)} aria-label={`${playing ? 'Stop' : 'Play'} ${s.name}`} title={s.description}>
                <span className="sound-card-icon">{playing ? <StopSquareIcon size={22} /> : busy === s.id ? <SoundIcon size={26} /> : <PlayIcon size={22} />}</span>
                <span className="sound-card-name">{s.name}</span>
                <span className="sound-card-tags">{s.kind === 'effect' ? s.tags.slice(0, 3).join(' · ') : s.kind === 'music' ? `music · ${s.tags.slice(1, 3).join(' · ')}` : 'jingle'}</span>
              </button>
              <button className="sound-card-add" onClick={() => add(s)} aria-label={`Add ${s.name}`}>
                <PlusIcon size={14} /> Add
              </button>
            </div>
          );
        })}
        {results.length > shown && (
          <button className="btn sound-library-more" onClick={() => setShown((n) => n + PAGE * 2)}>
            Show more ({(results.length - shown).toLocaleString('en-US')} more)
          </button>
        )}
        {!results.length && <p className="sound-library-empty">No sounds match “{query.trim()}”. Try a simpler word, like jump, bell or music.</p>}
      </div>
    </div>
  );
}
