/**
 * Help beside the code: the validator's **Problems** (kid words, where, and **Fix**), **What's this?** for
 * the cursor (the kit call's docs, the drawing an art key names, who wrote the line, a teacher's lock),
 * and the key to the provenance colours. Keyboard users get here what hovering gives mouse users.
 */
import { t } from '../../i18n';
import type { Author } from '../../model/types';
import { Button } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import type { CodeIssue } from './cm/lint';
import { kitCall } from './cm/kitCall';
import type { CursorInfo } from './session';

export interface HelpPanelProps {
  issues: CodeIssue[];
  multiFile: boolean;
  cursor: CursorInfo | null;
  onJump(issue: CodeIssue): void;
  onFix(issue: CodeIssue): void;
  onDraw(key: string): void;
}

const AUTHOR_TEXT: Record<Author, Parameters<typeof t>[0]> = {
  ai: 'history.authorAi',
  student: 'history.authorStudent',
  teacher: 'history.authorTeacher',
  starter: 'history.authorStarter',
};

/** The validator's words, with "quoted names" set as code. */
function KidMessage({ text }: { text: string }) {
  return (
    <>
      {text.split(/("[^"\n]{1,60}")/).map((part, i) => (/^"[^"]+"$/.test(part) ? <code key={i}>{part.slice(1, -1)}</code> : part))}
    </>
  );
}

function Problems({ issues, multiFile, onJump, onFix }: Pick<HelpPanelProps, 'issues' | 'multiFile' | 'onJump' | 'onFix'>) {
  if (!issues.length) {
    return (
      <p className="code-help__none">
        <Icon name="check" size={16} />
        {t('history.problemsNone')}
      </p>
    );
  }
  return (
    <ul className="code-help__problems">
      {issues.map((issue, i) => (
        <li key={`${issue.file}:${issue.line}:${issue.rule}:${i}`} className={cx('problem', `problem--${issue.severity}`)}>
          <button type="button" className="problem__jump" onClick={() => onJump(issue)}>
            <Icon name="warning" size={16} className="problem__icon" />
            <span className="problem__where">{multiFile ? t('history.problemAtIn', { file: issue.file, line: issue.line }) : t('history.problemAt', { line: issue.line })}</span>
            <span className="problem__text">
              <KidMessage text={issue.message} />
            </span>
          </button>
          {issue.fixed && (
            <Button variant="paper" size={38} className="problem__fix" onClick={() => onFix(issue)}>
              {t('history.fix')}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Cursor({ cursor, onDraw }: Pick<HelpPanelProps, 'cursor' | 'onDraw'>) {
  if (!cursor) return <p className="code-help__hint">{t('history.whatsThisHint')}</p>;
  return (
    <div className="code-help__cursor">
      {cursor.kit && (
        <div className="code-help__doc">
          <code>{kitCall(cursor.kit)}</code>
          <p>{cursor.kit.member.doc}</p>
        </div>
      )}
      {cursor.art && (
        <div className="code-help__art">
          <span className={cx('code-help__art-chip', !cursor.art.drawn && 'code-help__art-chip--bones', `tint-${cursor.art.role}`)} aria-hidden="true">
            {cursor.art.thumb && <img src={cursor.art.thumb} alt="" />}
          </span>
          <span>{cursor.art.label}</span>
          {!cursor.art.drawn && (
            <Button variant="paper" size={38} icon="draw" onClick={() => onDraw(cursor.art!.key)}>
              {t('history.drawIt')}
            </Button>
          )}
        </div>
      )}
      {!cursor.kit && !cursor.art && <p className="code-help__hint">{t('history.whatsThisHint')}</p>}
      <p className="code-help__line">
        <span className={cx('code-help__swatch', `code-help__swatch--${cursor.author}`)} aria-hidden="true" />
        <span>
          <b>{t('history.cursorAt', { line: cursor.line, file: cursor.file })}</b> {t(AUTHOR_TEXT[cursor.author])}
        </span>
      </p>
      {cursor.locked && (
        <p className="code-help__line code-help__line--locked">
          <Icon name="lock" size={16} />
          <span>{t('history.lockedLines')}</span>
        </p>
      )}
    </div>
  );
}

export function HelpPanel({ issues, multiFile, cursor, onJump, onFix, onDraw }: HelpPanelProps) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  return (
    <section className="panel code-help" aria-label={t('history.helpLabel')}>
      <div className="code-help__scroll">
        <h2 className="code-help__title">
          {t('history.problems')}
          {issues.length > 0 && <span className={cx('code-help__count', errors > 0 && 'code-help__count--error')}>{issues.length}</span>}
        </h2>
        <Problems issues={issues} multiFile={multiFile} onJump={onJump} onFix={onFix} />
        <h2 className="code-help__title">{t('history.whatsThis')}</h2>
        <Cursor cursor={cursor} onDraw={onDraw} />
      </div>
      <p className="code-help__legend" aria-label={t('history.legendLabel')}>
        <span>
          <i className="code-help__swatch code-help__swatch--ai" aria-hidden="true" />
          {t('history.legendAi')}
        </span>
        <span>
          <i className="code-help__swatch code-help__swatch--student" aria-hidden="true" />
          {t('history.legendYou')}
        </span>
        <span>
          <i className="code-help__swatch code-help__swatch--teacher" aria-hidden="true" />
          {t('history.legendTeacher')}
        </span>
        <span>
          <Icon name="lock" size={14} />
          {t('history.legendLocked')}
        </span>
      </p>
    </section>
  );
}
