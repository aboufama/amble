/**
 * The Desk's hidden timings (§7.8): with `?perf=1` in the address, a small card over the sheet shows input
 * to pixels written and the engine's work per frame over the last strokes (the drawing surface's own
 * measures), fresh at each pen-up. It is for checking a real Chromebook (and for the performance checks,
 * which read its data attributes); nobody sees it otherwise.
 */
import { useState } from 'react';
import type { PerfStats } from '../../cores/art';
import type { DeskController } from '../../draw/deskController';
import { t } from '../../i18n';
import { useDeskEvent } from './useDesk';

/** Whether the page was opened with `?perf=1`. */
export function perfHudWanted(): boolean {
  try {
    return new URLSearchParams(location.search).get('perf') === '1';
  } catch {
    return false;
  }
}

const NONE = { n: 0, p50: 0, p95: 0, max: 0 };

export function PerfHud({ ctrl }: { ctrl: DeskController }) {
  // Read at pen-ups only: before the drawing has loaded, the surface has nothing to measure.
  const [st, setSt] = useState<Pick<PerfStats, 'latency' | 'work' | 'commit'>>({ latency: NONE, work: NONE, commit: NONE });
  useDeskEvent(ctrl, (e) => {
    if (e.type === 'penup') setSt(ctrl.surface.stats());
  });
  const { latency, work, commit } = st;
  return (
    <div
      className="desk-perf"
      data-testid="perf-hud"
      data-latency-n={latency.n}
      data-latency-p50={latency.p50}
      data-latency-p95={latency.p95}
      data-work-p50={work.p50}
      data-work-p95={work.p95}
      data-commit-p50={commit.p50}
    >
      <strong>{t('draw.staff_perfTitle')}</strong>
      <span>{t('draw.staff_perfInput', { p50: latency.p50, p95: latency.p95, n: latency.n })}</span>
      <span>{t('draw.staff_perfWork', { p50: work.p50, p95: work.p95, commit: commit.p50 })}</span>
    </div>
  );
}
