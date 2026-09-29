/**
 * Settings → Reading and motion (§2.15, §3.2): Theme (Night / Day / High contrast), Text size (100 / 115 /
 * 130 %), Extra spacing, Easy-read letters and the Read aloud buttons (on-device voices only); then motion
 * and games. Every change applies at once (`<html data-theme data-text …>`).
 */
import { t } from '../../i18n';
import type { Prefs } from '../../model/types';
import { setPref } from '../../state/prefs';
import { useStore } from '../../state/store';
import { Toggle } from '../../ui/components';
import { MotionSection } from './MotionSection';
import { Choice, Group } from './parts';

export function ReadingSection() {
  const prefs = useStore((s) => s.prefs);
  const forced = typeof matchMedia !== 'undefined' && matchMedia('(forced-colors: active)').matches;
  return (
    <div className="set-reading">
      <Group title={t('school.setReadingTitle')}>
        <Choice<Prefs['theme']>
          label={t('school.setTheme')}
          hint={t('school.setThemeHint')}
          options={[
            { value: 'night', label: t('school.setNight') },
            { value: 'day', label: t('school.setDay') },
            { value: 'contrast', label: t('school.setContrast') },
          ]}
          value={prefs.theme}
          onChange={(v) => setPref('theme', v)}
          locked={forced ? t('school.setForced') : null}
        />
        <Choice<'1' | '1.15' | '1.3'>
          label={t('school.setTextSize')}
          options={[
            { value: '1', label: '100%' },
            { value: '1.15', label: '115%' },
            { value: '1.3', label: '130%' },
          ]}
          value={String(prefs.textScale) as '1' | '1.15' | '1.3'}
          onChange={(v) => setPref('textScale', Number(v) as Prefs['textScale'])}
        />
        <Toggle label={t('school.setSpacing')} hint={t('school.setSpacingHint')} checked={prefs.extraSpacing} onChange={(v) => setPref('extraSpacing', v)} />
        <Toggle label={t('school.setEasyRead')} hint={t('school.setEasyReadHint')} checked={prefs.easyRead} onChange={(v) => setPref('easyRead', v)} />
        <Toggle label={t('school.setReadAloud')} hint={t('school.setReadAloudHint')} checked={prefs.readAloud} onChange={(v) => setPref('readAloud', v)} />
      </Group>
      <MotionSection />
    </div>
  );
}
