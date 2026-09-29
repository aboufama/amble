/**
 * World info (⋯ → World info, §2.6): title, idea, who made it (initials, if set), when it started and last
 * changed, when it was last saved to Drive, its size, the starter it began from, and the credits line
 * "Art by {madeBy or 'you'} · Code by the AI helper and you · Starter: Moon King".
 */
import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import type { World } from '../../model/types';
import { formatBytes, measureWorld } from '../../store/quota';
import { Dialog } from '../../ui/components';
import { clockTime } from './WorldMenu';

function day(at: number): string {
  return new Date(at).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

export function starterTitle(world: World, info: (id: never) => { title: string }): string | null {
  const o = world.origin;
  const id = o.kind === 'starter' || o.kind === 'plan' ? o.starter : o.kind === 'assignment' ? o.starter : null;
  if (!id) return null;
  try {
    return info(id as never).title;
  } catch {
    return null;
  }
}

export function WorldInfo({ open, world, onClose }: { open: boolean; world: World; onClose(): void }) {
  const { store, files, starters } = useServices();
  const [size, setSize] = useState<string | null>(null);
  const [drive, setDrive] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void measureWorld(store, world)
      .then((s) => live && setSize(formatBytes(s.bytes)))
      .catch(() => undefined);
    void files
      .lastSaved(world.id)
      .then((s) => live && setDrive(s?.at ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, store, files, world]);

  const starter = starterTitle(world, (id) => starters.info(id));
  const artBy = world.credits.madeBy || t('world.infoYou');
  const rows: Array<[string, string]> = [
    [t('world.infoWorldTitle'), world.title],
    ...(world.pitch ? ([[t('world.infoPitch'), world.pitch]] as Array<[string, string]>) : []),
    ...(world.credits.madeBy ? ([[t('world.infoMadeBy'), world.credits.madeBy]] as Array<[string, string]>) : []),
    [t('world.infoCreated'), day(world.createdAt)],
    [t('world.infoEdited'), `${day(world.updatedAt)}, ${clockTime(world.updatedAt)}`],
    [t('world.infoDrive'), drive ? `${day(drive)}, ${clockTime(drive)}` : t('world.infoNever')],
    [t('world.infoSize'), size ?? '…'],
    [t('world.infoStarter'), starter ?? t('world.infoNoStarter')],
  ];
  return (
    <Dialog open={open} onClose={onClose} title={t('world.infoTitle')} size="md">
      <dl className="world-info" data-testid="world-info">
        {rows.map(([k, v]) => (
          <div key={k} className="world-info__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="world-info__credits">{starter ? t('world.infoCredits', { artBy, starter }) : t('world.infoCreditsNoStarter', { artBy })}</p>
    </Dialog>
  );
}
