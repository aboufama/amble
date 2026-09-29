/**
 * "We found a game from the old Amble: {title}. Bring its drawings and sounds here?" (§4.7; M6 owns,
 * shown by M1 at the start of the Trail and at the top of the First page's right column).
 * [Bring them] makes a new world with the drawings and sounds; [Not now] never asks again for this
 * project. The old save is only read, so nothing is lost either way.
 */
import { useId, useState } from 'react';
import { navigate } from '../../app/router';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import type { LegacyImport } from '../../legacy/reader';
import { announce, showToast } from '../../state/app';
import { setLegacy } from '../../state/library';
import { Button, PaperCard } from '../../ui/components';
import './files.css';

/** "3 drawings and 1 sound". */
function countText(l: LegacyImport): string {
  const d = l.drawings.length === 1 ? t('files.legacy_drawing') : t('files.legacy_drawings', { n: l.drawings.length });
  if (!l.sounds.length) return d;
  const s = l.sounds.length === 1 ? t('files.legacy_sound') : t('files.legacy_sounds', { n: l.sounds.length });
  return t('files.legacy_and', { a: d, b: s });
}

export interface LegacyCardProps {
  legacy: LegacyImport;
  onDone(): void;
}

export function LegacyCard({ legacy, onDone }: LegacyCardProps) {
  const { files } = useServices();
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const pictures = legacy.drawings.slice(0, 4);

  const bring = async () => {
    if (busy) return;
    setBusy(true);
    announce(t('files.legacy_bringing'));
    try {
      const id = await files.legacy.bring(legacy);
      setLegacy(null);
      showToast(t('files.legacy_brought', { title: legacy.title }), { kind: 'success', action: { label: t('files.openIt'), run: () => navigate({ name: 'world', id }) } });
      onDone();
    } catch (err) {
      console.warn('The old drawings did not come in:', err);
      showToast(t('files.legacy_failed'), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const later = async () => {
    await files.legacy.dismiss(legacy).catch(() => undefined);
    setLegacy(null);
    onDone();
  };

  return (
    <PaperCard as="section" tape="lemon" tilt={-1} className="legacy-card" labelledBy={titleId}>
      <p className="legacy-card__eyebrow">{t('files.legacy_heading')}</p>
      <h2 id={titleId} className="legacy-card__title">
        {legacy.title}
      </h2>
      <p className="legacy-card__text">{t('files.legacy_found', { title: legacy.title })}</p>
      {pictures.length > 0 && (
        <ul className="legacy-card__pictures" aria-hidden="true">
          {pictures.map((d) => (
            <li key={d.id}>
              <img src={d.dataUrl} alt="" draggable={false} />
            </li>
          ))}
        </ul>
      )}
      <p className="legacy-card__count">{countText(legacy)}</p>
      <div className="legacy-card__actions">
        <Button variant="lantern" icon="sparkle" busy={busy} onClick={() => void bring()} data-testid="legacy-bring">
          {busy ? t('files.legacy_bringing') : t('files.legacy_bring')}
        </Button>
        <Button variant="paper" disabled={busy} onClick={() => void later()}>
          {t('files.notNow')}
        </Button>
      </div>
    </PaperCard>
  );
}
