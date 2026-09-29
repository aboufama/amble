/**
 * The Join card (§2.14; M7 owns): a dialog over whatever screen the student lands on after a `#class=`
 * link. FOUNDATION-STUB with the four variants' basic copy: join, switch class, expired, unsafe/damaged.
 */
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import { setJoinIntake } from '../../state/app';
import { useStore } from '../../state/store';
import { Button, Dialog } from '../../ui/components';

export function JoinCard() {
  const intake = useStore((s) => s.app.joinIntake);
  const { school } = useServices();
  if (!intake) return null;
  const close = () => setJoinIntake(null);
  if (!intake.ok) {
    const text = intake.reason === 'expired' ? t('school.expired') : intake.reason === 'unsafe' ? t('school.unsafe') : t('school.damaged');
    return (
      <Dialog open size="sm" title={t('school.linkTitle')} onClose={close} actions={<Button variant="lantern" onClick={close}>{t('school.goToAmble')}</Button>}>
        <p className="dialog__text">{text}</p>
      </Dialog>
    );
  }
  const { link, switchingFrom } = intake;
  const join = () => {
    close();
    void school.join(link);
  };
  if (switchingFrom) {
    return (
      <Dialog
        open
        size="sm"
        title={t('school.switchTitle', { current: switchingFrom, next: link.cls })}
        onClose={close}
        actions={
          <>
            <Button variant="ghost" onClick={close}>
              {t('school.keepClass', { current: switchingFrom })}
            </Button>
            <Button variant="lantern" onClick={join}>
              {t('school.switchClass')}
            </Button>
          </>
        }
      />
    );
  }
  return (
    <Dialog
      open
      size="sm"
      title={t('school.joinTitle', { cls: link.cls })}
      onClose={close}
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
      <p className="dialog__text">{t('school.joinBody')}</p>
    </Dialog>
  );
}
