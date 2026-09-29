/**
 * The motion and games part of Settings → Reading and motion (§2.15, §3.6, §3.9): Reduce motion (Follow my
 * Chromebook / On / Off; the in-app setting wins), and for games the speed and the touch buttons.
 */
import { t } from '../../i18n';
import type { Prefs } from '../../model/types';
import { setPref } from '../../state/prefs';
import { useStore } from '../../state/store';
import { Choice, Group } from './parts';
import { usePlayerPrefs } from './SoundSection';

export function MotionSection() {
  const prefs = useStore((s) => s.prefs);
  const setGamePref = usePlayerPrefs();
  return (
    <>
      <Group title={t('school.setMotionTitle')}>
        <Choice<Prefs['reduceMotion']>
          label={t('school.setReduceMotion')}
          hint={t('school.setReduceMotionHint')}
          options={[
            { value: 'system', label: t('school.setFollow') },
            { value: 'on', label: t('school.setOnWord') },
            { value: 'off', label: t('school.setOffWord') },
          ]}
          value={prefs.reduceMotion}
          onChange={(v) => setPref('reduceMotion', v)}
        />
      </Group>
      <Group title={t('school.setGamesTitle')}>
        <Choice<'1' | '0.75' | '0.5'>
          label={t('school.setGameSpeed')}
          hint={t('school.setGameSpeedHint')}
          options={[
            { value: '1', label: t('school.setSpeedNormal') },
            { value: '0.75', label: t('school.setSpeedSlower') },
            { value: '0.5', label: t('school.setSpeedSlowest') },
          ]}
          value={String(prefs.gameSpeed) as '1' | '0.75' | '0.5'}
          onChange={(v) => setGamePref('gameSpeed', Number(v) as Prefs['gameSpeed'])}
        />
        <Choice<Prefs['touchControls']>
          label={t('school.setTouch')}
          hint={t('school.setTouchHint')}
          options={[
            { value: 'auto', label: t('school.setAuto') },
            { value: 'on', label: t('school.setOnWord') },
            { value: 'off', label: t('school.setOffWord') },
          ]}
          value={prefs.touchControls}
          onChange={(v) => setGamePref('touchControls', v)}
        />
      </Group>
    </>
  );
}
