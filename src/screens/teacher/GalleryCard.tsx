/**
 * One student's world in the gallery grid (§2.14): the snapshot, the title, "by J.R.", and chips for
 * drawings done / needed (✎), AI changes (✦), own code edits (‹›) and problems (⚠) or ✓.
 */
import { t } from '../../i18n';
import type { GalleryItem } from '../../school/gallery';
import { PlaceholderGlyph } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { SchoolIcon } from './SchoolIcon';

export function GalleryCard({ item, selected, showNames, onOpen }: { item: GalleryItem; selected: boolean; showNames: boolean; onOpen(): void }) {
  const done = item.needed > 0 && item.drawn >= item.needed;
  const by = showNames && item.madeBy ? t('school.staff_by', { name: item.madeBy }) : null;
  const label =
    item.status === 'problem'
      ? `${item.file.name}: ${item.problem ?? ''}`
      : t('school.staff_cardLabel', {
          title: item.title,
          by: by ?? '',
          drawn: item.drawn,
          needed: item.needed,
          ai: item.story?.aiChanges ?? 0,
          code: item.story?.codeEdits ?? 0,
          problems: item.errors,
        });
  return (
    <li className="gcard-wrap">
      <button type="button" className={cx('gcard', selected && 'gcard--on', item.status !== 'ready' && `gcard--${item.status}`)} aria-pressed={selected} aria-label={label} onClick={onOpen} data-testid="gallery-card">
        <span className="gcard__thumb" aria-hidden="true">
          {item.thumb ? <img src={item.thumb} alt="" /> : <PlaceholderGlyph rig="biped" role="hero" size={56} />}
          {item.status === 'loading' && <span className="gcard__shimmer" />}
        </span>
        <span className="gcard__body" aria-hidden="true">
          <span className="gcard__title">{item.status === 'problem' ? item.file.name : item.title}</span>
          {item.status === 'problem' ? (
            <span className="gcard__problem">
              <Icon name="warning" size={14} />
              {item.problem}
            </span>
          ) : (
            by && <span className="gcard__by">{by}</span>
          )}
          {item.status === 'ready' && (
            <span className="gcard__chips">
              <span className={cx('gchip', done ? 'gchip--done' : 'gchip--open')}>
                <Icon name="draw" size={14} />
                {item.drawn}/{item.needed}
              </span>
              <span className="gchip gchip--ai">
                <Icon name="sparkle" size={14} />
                {item.story?.aiChanges ?? 0}
              </span>
              <span className="gchip">
                <SchoolIcon name="code" size={14} />
                {item.story?.codeEdits ?? 0}
              </span>
              {item.errors > 0 ? (
                <span className="gchip gchip--warn">
                  <Icon name="warning" size={14} />
                  {item.errors}
                </span>
              ) : (
                <span className="gchip gchip--ok">
                  <Icon name="check" size={14} />
                </span>
              )}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
