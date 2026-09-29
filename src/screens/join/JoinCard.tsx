/**
 * The Join card (§2.14): a dialog over whatever screen the student lands on after a `#class=` link (the
 * router has already removed the link from the address bar). Join, Switch class, and the expired, unsafe
 * and damaged variants. `JoinCardBody` is also the Teacher desk's live "What students see" preview.
 */
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import type { ClassLinkV1 } from '../../model/types';
import { announce, setJoinIntake, showToast } from '../../state/app';
import { useStore } from '../../state/store';
import { Button, Dialog } from '../../ui/components';
import './join.css';

/**
 * What joining does, in the student's words: the class's wishes work here (the machinery stays out of
 * sight; the Teacher desk and Settings name it plainly). A class without wishes, or with Explain this only,
 * just knows its students.
 */
export function joinBody(link: Pick<ClassLinkV1, 'ai' | 'mode'>): string {
  return link.ai && link.mode === 'on' ? t('home.joinWishes') : t('home.joinClass');
}

/**
 * Where the student's words will go once the class's wishes are on: the host of the link's address. The
 * class and district names come from the link itself, so the card also names the address the words go
 * to, and a link that points somewhere else looks different (§5.14: in the public build a class link is
 * the whole configuration).
 */
export function joinHost(link: Pick<ClassLinkV1, 'ai' | 'mode'>): string | null {
  if (!link.ai || link.mode === 'off') return null;
  try {
    return new URL(link.ai.baseUrl).host || null;
  } catch {
    return null;
  }
}

function JoinHost({ link }: { link: Pick<ClassLinkV1, 'ai' | 'mode'> }) {
  const host = joinHost(link);
  return host ? (
    <p className="join-card__from" data-testid="join-host">
      {t('school.joinHost', { host })}
    </p>
  ) : null;
}

/** The card's words and buttons, for the dialog and the teacher's preview (where the buttons are inert). */
export function JoinCardBody({ link }: { link: Pick<ClassLinkV1, 'cls' | 'ai' | 'mode'> }) {
  return (
    <div className="join-preview" inert>
      <p className="join-preview__title">{t('school.joinTitle', { cls: link.cls || t('school.staff_classNameExample') })}</p>
      <p className="join-preview__text">{joinBody(link)}</p>
      <JoinHost link={link} />
      <div className="join-preview__actions">
        <span className="btn btn--lantern btn--h44">
          <span className="btn__label">{t('school.join')}</span>
        </span>
        <span className="btn btn--ghost btn--h44">
          <span className="btn__label">{t('school.notNow')}</span>
        </span>
      </div>
    </div>
  );
}

export function JoinCard() {
  const intake = useStore((s) => s.app.joinIntake);
  const { school } = useServices();
  if (!intake) return null;
  const close = () => setJoinIntake(null);

  if (!intake.ok) {
    const text = intake.reason === 'expired' ? t('school.expired') : intake.reason === 'unsafe' ? t('school.unsafe') : t('school.damaged');
    return (
      <Dialog
        open
        size="sm"
        title={t('school.linkTitle')}
        onClose={close}
        className="join-card"
        actions={
          <Button variant="lantern" onClick={close} data-autofocus>
            {t('school.goToAmble')}
          </Button>
        }
      >
        <p className="dialog__text">{text}</p>
      </Dialog>
    );
  }

  const { link, switchingFrom } = intake;
  const join = () => {
    close();
    void school.join(link).then(() => {
      const text = t('school.joined', { cls: link.cls });
      showToast(text, { kind: 'success' });
      announce(text);
    });
  };

  if (switchingFrom) {
    return (
      <Dialog
        open
        size="sm"
        title={t('school.switchTitle', { current: switchingFrom, next: link.cls })}
        onClose={close}
        className="join-card"
        actions={
          <>
            <Button variant="ghost" onClick={close}>
              {t('school.keepClass', { current: switchingFrom })}
            </Button>
            <Button variant="lantern" onClick={join} data-autofocus>
              {t('school.switchClass')}
            </Button>
          </>
        }
      >
        <p className="dialog__text">{joinBody(link)}</p>
        <JoinHost link={link} />
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      size="sm"
      title={t('school.joinTitle', { cls: link.cls })}
      onClose={close}
      className="join-card"
      actions={
        <>
          <Button variant="ghost" onClick={close}>
            {t('school.notNow')}
          </Button>
          <Button variant="lantern" onClick={join} data-autofocus>
            {t('school.join')}
          </Button>
        </>
      }
    >
      <p className="dialog__text">{joinBody(link)}</p>
      <JoinHost link={link} />
      {link.district && <p className="join-card__from">{t('school.joinFrom', { district: link.district })}</p>}
    </Dialog>
  );
}
