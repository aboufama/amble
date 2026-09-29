/**
 * Teacher desk → Gallery (§2.14; spec-mocks/14-teacher-gallery.png): open the Classroom assignment folder
 * (read-only) or some files; cards stream in; filter them; play one at a time in the detail panel; export
 * the checks and notes as a CSV. Nothing is uploaded.
 */
import { useEffect, useMemo, useState } from 'react';
import { useServices } from '../../app/services';
import { safeBaseName } from '../../files/names';
import { t } from '../../i18n';
import { toCsv } from '../../school/csv';
import { goalsFor, runChecks } from '../../school/checks';
import { codeFacts } from '../../school/codeFacts';
import { tn } from '../../school/count';
import { assignmentName, matchesFilter, openGallery, robotResultOf, selectGalleryItem, setGalleryFilter, useGallery, type GalleryFilter, type GalleryItem } from '../../school/gallery';
import { useTeacherData } from '../../school/teacherData';
import { announce, showToast } from '../../state/app';
import { useStore } from '../../state/store';
import { Button, Chip } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { isTextField } from '../../ui/a11y';
import { cx } from '../../ui/cx';
import { GalleryCard } from './GalleryCard';
import { GalleryDetail } from './GalleryDetail';
import { SchoolIcon } from './SchoolIcon';
import { TButton } from './TButton';

const FILTERS: Array<{ id: GalleryFilter; key: 'staff_filterAll' | 'staff_filterArt' | 'staff_filterBones' | 'staff_filterErrors' | 'staff_filterUnreviewed' }> = [
  { id: 'all', key: 'staff_filterAll' },
  { id: 'art', key: 'staff_filterArt' },
  { id: 'bones', key: 'staff_filterBones' },
  { id: 'errors', key: 'staff_filterErrors' },
  { id: 'unreviewed', key: 'staff_filterUnreviewed' },
];

/** Narrow windows show the detail as its own full view (§2.14: below 1100 px). */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 1099px)').matches);
  useEffect(() => {
    const mq = matchMedia('(max-width: 1099px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

function csvFor(items: readonly GalleryItem[], notes: ReturnType<typeof useTeacherData>['notes']): string {
  const ready = items.filter((i) => i.status === 'ready' && i.world);
  const labels: string[] = [];
  for (const item of ready) for (const g of goalsFor(item.world!, item.cast)) if (!labels.includes(g.label)) labels.push(g.label);
  const rows: Array<Array<string | number>> = [[t('school.staff_csvFile'), t('school.staff_csvWorld'), t('school.staff_csvMadeBy'), ...labels, t('school.staff_csvReviewed'), t('school.staff_csvFeedback')]];
  for (const item of items) {
    const note = notes[item.id];
    if (item.status !== 'ready' || !item.world) {
      rows.push([item.file.name, item.problem ?? '', item.madeBy, ...labels.map(() => ''), '', note?.feedback ?? '']);
      continue;
    }
    const world = item.world;
    const run = robotResultOf(item.id);
    const outcomes = runChecks(goalsFor(world, item.cast), { world, cast: item.cast, art: (id) => item.art.get(id) ?? null, facts: codeFacts(world.code), robot: run ?? null });
    const cell = (label: string) => {
      const o = outcomes.find((x) => x.goal.label === label);
      if (!o) return '';
      if (o.pass === null) return note?.checks[o.goal.id] ? t('school.staff_csvYes') : '';
      if (o.evidence.kind === 'untested') return t('school.staff_csvNotTested');
      return o.pass ? t('school.staff_csvYes') : t('school.staff_csvNo');
    };
    rows.push([item.file.name, item.title, item.madeBy, ...labels.map(cell), note?.reviewedAt ? new Date(note.reviewedAt).toISOString().slice(0, 10) : '', note?.feedback ?? '']);
  }
  return toCsv(rows);
}

export function GalleryTab({ showNames = true }: { showNames?: boolean }) {
  const services = useServices();
  const gallery = useGallery();
  const teacher = useTeacherData();
  const cls = useStore((s) => s.config.classLink?.cls ?? null);
  const narrow = useNarrow();
  const [detailOpen, setDetailOpen] = useState(false);
  const notes = teacher.notes;
  const shown = useMemo(() => gallery.items.filter((i) => matchesFilter(i, gallery.filter, notes)), [gallery.items, gallery.filter, notes]);
  const selected = gallery.items.find((i) => i.id === gallery.selected) ?? null;
  const index = selected ? shown.indexOf(selected) : -1;
  const asg = assignmentName(gallery.items);
  const teacherClass = teacher.link?.cls || cls;

  // The first world opens by itself once cards are in.
  useEffect(() => {
    if (!gallery.selected && !narrow) {
      const first = gallery.items.find((i) => i.status === 'ready');
      if (first) selectGalleryItem(first.id);
    }
  }, [gallery.items, gallery.selected, narrow]);

  const move = (delta: -1 | 1) => {
    if (!shown.length) return;
    const at = index < 0 ? 0 : (index + delta + shown.length) % shown.length;
    selectGalleryItem(shown[at].id);
    announce(t('school.staff_nowShowing', { title: shown[at].title, n: at + 1, total: shown.length }));
  };

  // ← → other worlds, when the teacher isn't typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTextField(e.target)) return;
      if (document.querySelector('dialog[open]')) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.target instanceof HTMLElement && e.target.closest('[role="radiogroup"], [role="tablist"], input, select')) return;
      if (!gallery.items.length) return;
      e.preventDefault();
      move(e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const open = async (kind: 'folder' | 'files') => {
    let list: File[];
    try {
      list = kind === 'folder' ? await services.files.openFolder() : await services.files.openPicker({ multiple: true });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      showToast(t('school.staff_galleryCantOpen'), { kind: 'error' });
      return;
    }
    if (!list.length) return;
    const amble = list.filter((f) => /\.amble$/i.test(f.name));
    if (!amble.length) {
      showToast(t('school.staff_galleryNoFiles'), { kind: 'error' });
      return;
    }
    announce(tn('school.staff_galleryOpening', amble.length));
    await openGallery(amble, kind);
  };

  const exportCsv = async () => {
    const csv = csvFor(gallery.items, notes);
    const name = `${t('school.staff_csvName')} - ${safeBaseName(asg ?? teacherClass ?? '', t('school.staff_csvClass'))}.csv`;
    try {
      const saved = await services.files.saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), name, 'csv');
      if (saved) showToast(saved.method === 'download' ? t('school.staff_csvDownloaded', { name: saved.name }) : t('school.staff_csvSaved', { name: saved.name }), { kind: 'success' });
    } catch {
      showToast(t('school.staff_csvFailed'), { kind: 'error' });
    }
  };

  if (!gallery.items.length) {
    return (
      <div className="gallery gallery--empty" data-testid="teacher-gallery">
        <div className="tempty tempty--big">
          <SchoolIcon name="folder" size={44} />
          <p className="tempty__title">{t('school.staff_galleryEmpty')}</p>
          <p className="tempty__text">{t('school.staff_galleryWhere')}</p>
          <div className="tempty__actions">
            <TButton variant="lantern" icon="folder" onClick={() => void open('folder')} testId="open-folder">
              {t('school.staff_openFolder')}
            </TButton>
            <Button variant="ghost" icon="fileOpen" onClick={() => void open('files')}>
              {t('school.staff_openFiles')}
            </Button>
          </div>
          <p className="tsafe">
            <SchoolIcon name="shield" size={18} />
            {t('school.staff_nothingUploaded')}
          </p>
        </div>
      </div>
    );
  }

  const counts: Record<GalleryFilter, number> = {
    all: gallery.items.length,
    art: gallery.items.filter((i) => matchesFilter(i, 'art', notes)).length,
    bones: gallery.items.filter((i) => matchesFilter(i, 'bones', notes)).length,
    errors: gallery.items.filter((i) => matchesFilter(i, 'errors', notes)).length,
    unreviewed: gallery.items.filter((i) => matchesFilter(i, 'unreviewed', notes)).length,
  };
  const showDetail = selected && (!narrow || detailOpen);

  if (narrow && showDetail && selected) {
    return (
      <div className="gallery gallery--solo" data-testid="teacher-gallery">
        <GalleryDetail item={selected} index={Math.max(0, index)} total={shown.length} showNames={showNames} onMove={move} onBack={() => setDetailOpen(false)} />
      </div>
    );
  }

  return (
    <div className="gallery" data-testid="teacher-gallery">
      <div className="gallery__main">
        <div className="gallery__head">
          <h2 className="gallery__title">{asg ?? t('school.staff_galleryTitle')}</h2>
          {teacherClass && <span className="gallery__class">{teacherClass}</span>}
          <p className="gallery__source">
            <SchoolIcon name="folder" size={18} />
            {gallery.source === 'folder' ? tn('school.staff_sourceFolder', gallery.items.length) : tn('school.staff_sourceFiles', gallery.items.length)}
            {gallery.loading && <span className="gallery__loading">{t('school.staff_reading')}</span>}
          </p>
          <div className="gallery__tools">
            <Button variant="quiet" size={38} icon="fileOpen" onClick={() => void open('folder')}>
              {t('school.staff_openAnother')}
            </Button>
            <TButton variant="ghost" icon="download" onClick={() => void exportCsv()} testId="feedback-csv">
              {t('school.staff_feedbackCsv')}
            </TButton>
          </div>
        </div>
        <div className="gallery__filters">
          <div role="group" aria-label={t('school.staff_filters')} className="gallery__chips">
            {FILTERS.map((f) => (
              <Chip key={f.id} onClick={() => setGalleryFilter(f.id)} selected={gallery.filter === f.id} icon={f.id === 'art' ? 'draw' : f.id === 'errors' ? 'warning' : undefined} className={cx('gfilter', f.id === 'errors' && counts.errors > 0 && 'gfilter--warn')}>
                {t(`school.${f.key}`)} <b>{counts[f.id]}</b>
              </Chip>
            ))}
          </div>
          <p className="tsafe">
            <SchoolIcon name="shield" size={18} />
            {t('school.staff_nothingUploaded')}
          </p>
        </div>
        {shown.length === 0 ? (
          <p className="gallery__none">{t('school.staff_filterNone')}</p>
        ) : (
          <ul className="gallery__grid" aria-label={t('school.staff_galleryGrid')}>
            {shown.map((item) => (
              <GalleryCard
                key={item.id}
                item={item}
                selected={item.id === gallery.selected}
                showNames={showNames}
                onOpen={() => {
                  selectGalleryItem(item.id);
                  setDetailOpen(true);
                }}
              />
            ))}
          </ul>
        )}
      </div>
      {showDetail && selected ? (
        <GalleryDetail item={selected} index={Math.max(0, index)} total={shown.length} showNames={showNames} onMove={move} />
      ) : (
        !narrow && (
          <div className="gdetail gdetail--empty tpanel">
            <Icon name="play" size={28} />
            <p>{t('school.staff_pickWorld')}</p>
          </div>
        )
      )}
    </div>
  );
}
