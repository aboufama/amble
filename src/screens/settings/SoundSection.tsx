/**
 * Settings → Sound (§2.15): Amble's own sounds (Off / Soft / On; off by default in school builds), the
 * games' volume (muted by default in school builds: "Games are quiet in class. Use headphones!") and
 * captions for game sounds.
 */
import { useServices } from '../../app/services';
import { playerPrefsFrom } from '../../app/player/prefs';
import { t } from '../../i18n';
import type { Prefs } from '../../model/types';
import { setPref } from '../../state/prefs';
import { getState, useStore } from '../../state/store';
import { Slider, Toggle } from '../../ui/components';
import { playUiSound } from '../../ui/sounds';
import { Choice, Group } from './parts';

/** Sends the game-related prefs to the player right away (a world may be loaded behind Settings). */
export function usePlayerPrefs(): <K extends keyof Prefs>(key: K, value: Prefs[K]) => void {
  const { player } = useServices();
  return (key, value) => {
    setPref(key, value);
    player.prefs(playerPrefsFrom(getState().prefs));
  };
}

export function SoundSection() {
  const prefs = useStore((s) => s.prefs);
  const school = useStore((s) => s.config.school);
  const setGamePref = usePlayerPrefs();
  return (
    <div className="set-sound">
      <Group>
        <Choice
          label={t('school.setUiSounds')}
          hint={school ? t('school.setUiSoundsSchool') : t('school.setUiSoundsHint')}
          options={[
            { value: 'off', label: t('school.setOffWord') },
            { value: 'soft', label: t('school.setSoft') },
            { value: 'on', label: t('school.setOnWord') },
          ]}
          value={prefs.uiSounds}
          onChange={(v) => {
            setPref('uiSounds', v);
            if (v !== 'off') playUiSound('tok');
          }}
        />
      </Group>
      <Group title={t('school.setGameSound')}>
        <p className="set-row__hint">{t('school.setGameSoundHint')}</p>
        <Toggle label={t('school.setMuteGames')} checked={prefs.gameMuted} onChange={(v) => setGamePref('gameMuted', v)} />
        <div className={prefs.gameMuted ? 'set-dim' : undefined}>
          <Slider label={t('school.setVolume')} value={Math.round(prefs.gameVolume * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => setGamePref('gameVolume', v / 100)} />
        </div>
        <Toggle label={t('school.setCaptions')} hint={t('school.setCaptionsHint')} checked={prefs.captions} onChange={(v) => setGamePref('captions', v)} />
      </Group>
    </div>
  );
}
