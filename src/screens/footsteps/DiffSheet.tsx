/**
 * See the change (§2.9): a sheet over the notebook with the step's words, the student's request, the
 * drawings that changed (before and after stickers), dial moves, twists, and a unified diff per changed
 * file (JetBrains Mono 13 px; added lines in `--alive`, removed ones in `--warn` and struck through, ±3
 * lines of context), plus Go back to before this.
 */
import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { countHunkChanges, pairChangedLines, parseUnified, twistDiff, wordDiff, type DiffLine, type Hunk, type Segment } from '../../history/diff';
import { parentOf } from '../../history/record';
import { fullTime, lookOf, timeAgo, whoOf } from '../../history/summary';
import { t } from '../../i18n';
import { extractManifest, sourceFilesOf } from '../../cores/ai';
import type { ArtShape, BlobRef, CodeFile, RigKind, Role, StepDiff, StepSummary, World } from '../../model/types';
import { useStore } from '../../state/store';
import { Button, Dialog, Footprints, PlaceholderGlyph, Sticker } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';

export interface DiffSheetProps {
  world: World;
  step: StepSummary | null;
  canGoBackBefore: boolean;
  busy: boolean;
  onClose(): void;
  onGoBackBefore(step: StepSummary): void;
}

interface Loaded {
  stepId: string;
  diff: StepDiff;
  twists: { on: string[]; off: string[] };
  names: Record<string, string>;
  compare: boolean;
}

/** The `name` of each entry in the code's `static art`. */
function staticArtNames(code: CodeFile[]): Record<string, string> {
  try {
    const art = extractManifest(sourceFilesOf(code)).statics.art;
    const out: Record<string, string> = {};
    if (art && typeof art === 'object') {
      for (const [key, spec] of Object.entries(art as Record<string, { name?: unknown }>)) if (typeof spec?.name === 'string') out[key] = spec.name;
    }
    return out;
  } catch {
    return {};
  }
}

function useStepChange(world: World, step: StepSummary | null): Loaded | 'error' | null {
  const { history, store } = useServices();
  const [loaded, setLoaded] = useState<Loaded | 'error' | null>(null);
  const stepId = step?.id ?? null;
  useEffect(() => {
    if (!stepId) return;
    let live = true;
    setLoaded(null);
    void (async () => {
      try {
        const parent = parentOf(world, stepId);
        const [diff, after, before] = await Promise.all([history.diff(world, stepId), store.steps.get(stepId), parent ? store.steps.get(parent.id) : Promise.resolve(null)]);
        // A member's name: its drawing's, else the one the code declares, else the key.
        const declared = after ? staticArtNames(after.code) : {};
        const names: Record<string, string> = {};
        for (const snap of [after, before]) {
          for (const slot of Object.values(snap?.cast ?? {})) {
            if (names[slot.key]) continue;
            const record = slot.art ? await store.art.get(slot.art) : null;
            if (record?.name) names[slot.key] = record.name;
          }
        }
        for (const snap of [after, before]) {
          for (const slot of Object.values(snap?.cast ?? {})) names[slot.key] ??= declared[slot.key] ?? slot.extra?.name ?? slot.key;
        }
        if (!live) return;
        setLoaded({ stepId, diff, twists: before && after ? twistDiff(before.twists, after.twists) : { on: [], off: [] }, names, compare: !!before && !!after });
      } catch {
        if (live) setLoaded('error');
      }
    })();
    return () => {
      live = false;
    };
  }, [stepId, world, history, store]);
  return loaded && loaded !== 'error' && loaded.stepId !== stepId ? null : loaded;
}

function useBlobUrl(ref: BlobRef | null): string | null {
  const { store } = useServices();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!ref) return;
    let live = true;
    void store.blobs
      .url(ref)
      .then((u) => live && setUrl(u))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ref, store]);
  return ref ? url : null;
}

interface GlyphLook {
  rig: RigKind;
  role: Role;
  shape: ArtShape;
}

function DrawingSide({ refOf, name, label, glyph }: { refOf: BlobRef | null; name: string; label: string; glyph: GlyphLook }) {
  const url = useBlobUrl(refOf);
  return (
    <figure className="diff-art__side">
      {refOf ? <Sticker src={url} alt={t('history.drawingOf', { name })} size={72} /> : <PlaceholderGlyph rig={glyph.rig} role={glyph.role} shape={glyph.shape} size={72} name={name} />}
      <figcaption className="diff-art__caption">{refOf ? label : t('history.justBones')}</figcaption>
    </figure>
  );
}

function hunkLabel(h: Hunk): string {
  const from = h.bLen ? h.bStart : h.aStart;
  const len = h.bLen || h.aLen;
  return len <= 1 ? t('history.lineOne', { n: from }) : t('history.linesRange', { from, to: from + len - 1 });
}

function LineText({ line, partner }: { line: DiffLine; partner: DiffLine | null }) {
  const Tag = line.kind === '-' ? 'del' : line.kind === '+' ? 'ins' : 'span';
  let segments: Segment[] | null = null;
  if (partner && line.kind !== ' ') {
    const words = line.kind === '-' ? wordDiff(line.text, partner.text) : wordDiff(partner.text, line.text);
    segments = words ? (line.kind === '-' ? words.a : words.b) : null;
  }
  return (
    <Tag className="diff-line__text">
      {segments
        ? segments.map((seg, i) =>
            seg.changed ? (
              <mark key={i} className="diff-line__mark">
                {seg.text}
              </mark>
            ) : (
              seg.text
            ),
          )
        : line.text || ' '}
    </Tag>
  );
}

function FileDiff({ path, hunks }: { path: string; hunks: string }) {
  const parsed = parseUnified(hunks);
  const { added, removed } = countHunkChanges(parsed);
  return (
    <section className="diff-file" aria-label={path}>
      <header className="diff-file__head">
        <span className="diff-file__name">{path}</span>
        <span className="diff-file__counts" aria-label={t('history.fileChanges', { added, removed })}>
          <span className="diff-file__added">+{added}</span> <span className="diff-file__removed">−{removed}</span>
        </span>
      </header>
      {parsed.map((h, i) => {
        const pairs = pairChangedLines(h.lines);
        return (
          <div key={i} className="diff-hunk">
            <p className="diff-hunk__head">{hunkLabel(h)}</p>
            <div className="diff-hunk__lines" role="list">
              {h.lines.map((l, j) => {
                const partner = pairs.get(j);
                return (
                  <div key={j} role="listitem" className={cx('diff-line', l.kind === '+' && 'diff-line--add', l.kind === '-' && 'diff-line--del')}>
                    <span className="diff-line__no" aria-hidden="true">
                      {l.kind === '-' ? l.a : l.b}
                    </span>
                    <span className="diff-line__sign" aria-hidden="true">
                      {l.kind === ' ' ? '' : l.kind === '+' ? '+' : '−'}
                    </span>
                    <LineText line={l} partner={partner === undefined ? null : h.lines[partner]} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function DiffSheet({ world, step, canGoBackBefore, busy, onClose, onGoBackBefore }: DiffSheetProps) {
  const loaded = useStepChange(world, step);
  const manifest = useStore((s) => (s.session.world?.id === world.id ? s.session.manifest : null));
  const open = step !== null;
  const dialLabel = (key: string) => manifest?.dials.find((d) => d.key === key)?.label ?? key;
  const twistName = (id: string) => manifest?.twists.find((tw) => tw.id === id)?.name ?? id;
  const glyphOf = (key: string): GlyphLook => {
    const need = manifest?.art.find((a) => a.key === key);
    const extra = world.cast[key]?.extra;
    return { rig: need?.rig ?? extra?.rig ?? 'blob', role: need?.role ?? extra?.role ?? 'npc', shape: need?.shape ?? 'capsule' };
  };
  const data = loaded && loaded !== 'error' ? loaded : null;
  const empty = data && !data.diff.files.length && !data.diff.drawings.length && !data.diff.dials.length && !data.twists.on.length && !data.twists.off.length;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('history.sheetTitle')}
      variant="sheet-right"
      className="diff-sheet"
      dismissOnBackdrop
      actions={
        step && canGoBackBefore ? (
          <Button variant="ghost" icon="restart" disabled={busy} onClick={() => onGoBackBefore(step)}>
            {t('history.goBackBefore')}
          </Button>
        ) : undefined
      }
    >
      {step && (
        <div className="diff-sheet__body" data-testid="diff-sheet">
          <p className={cx('diff-sheet__who', lookOf(step) === 'ai' && 'diff-sheet__who--ai')}>
            {lookOf(step) === 'ai' ? <Icon name="sparkle" size={14} /> : <Icon name="footprint" size={14} />}
            <span title={fullTime(step.at)}>{t('history.whenBy', { who: whoOf(step), when: timeAgo(step.at) })}</span>
          </p>
          <p className="diff-sheet__summary">{step.text}</p>
          {step.request !== undefined && <p className="diff-sheet__request">{t('history.youAsked', { request: step.request })}</p>}
          {step.handEdits && (
            <p className="diff-sheet__note">
              <Icon name="info" size={16} />
              {t('history.handEdits')}
            </p>
          )}

          {loaded === null && <Footprints label={t('history.loadingChange')} />}
          {loaded === 'error' && <p className="diff-sheet__empty">{t('history.changeFailed')}</p>}
          {data && !data.compare && <p className="diff-sheet__empty">{t('history.noCompare')}</p>}
          {data && data.compare && empty && <p className="diff-sheet__empty">{t('history.noChanges')}</p>}

          {data && data.diff.drawings.length > 0 && (
            <section className="diff-section">
              <h3 className="diff-section__title">{t('history.drawings')}</h3>
              {data.diff.drawings.map((d) => (
                <div key={d.key} className="diff-art">
                  <p className="diff-art__name">{data.names[d.key] ?? d.key}</p>
                  <div className="diff-art__pair">
                    <DrawingSide refOf={d.before} name={data.names[d.key] ?? d.key} label={t('history.before')} glyph={glyphOf(d.key)} />
                    <Icon name="back" size={20} className="diff-art__arrow" />
                    <DrawingSide refOf={d.after} name={data.names[d.key] ?? d.key} label={t('history.after')} glyph={glyphOf(d.key)} />
                  </div>
                </div>
              ))}
            </section>
          )}

          {data && data.diff.dials.length > 0 && (
            <section className="diff-section">
              <h3 className="diff-section__title">{t('history.dials')}</h3>
              <ul className="diff-list">
                {data.diff.dials.map((d) => (
                  <li key={d.key}>
                    <Icon name="dial" size={16} />
                    {t('history.dialMoved', { label: dialLabel(d.key), from: d.before, to: d.after })}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data && (data.twists.on.length > 0 || data.twists.off.length > 0) && (
            <section className="diff-section">
              <h3 className="diff-section__title">{t('history.twists')}</h3>
              <ul className="diff-list">
                {data.twists.on.map((id) => (
                  <li key={`on-${id}`}>
                    <Icon name="twist" size={16} />
                    {t('history.twistOn', { name: twistName(id) })}
                  </li>
                ))}
                {data.twists.off.map((id) => (
                  <li key={`off-${id}`}>
                    <Icon name="twist" size={16} />
                    {t('history.twistOff', { name: twistName(id) })}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data && data.diff.files.length > 0 && (
            <section className="diff-section">
              <h3 className="diff-section__title">{t('history.code')}</h3>
              {data.diff.files.map((f) => (
                <FileDiff key={f.path} path={f.path} hunks={f.hunks} />
              ))}
            </section>
          )}
        </div>
      )}
    </Dialog>
  );
}
