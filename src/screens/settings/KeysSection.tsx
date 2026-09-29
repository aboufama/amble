/**
 * Settings → Keys (§2.15, §2.2): single-key shortcuts on or off (WCAG 2.1.4: they never fire while typing,
 * and can be switched off for switch access or dictation), and the list of keys.
 */
import { t, type MessageKey } from '../../i18n';
import { setPref } from '../../state/prefs';
import { useStore } from '../../state/store';
import { Keycap, Toggle } from '../../ui/components';
import { Group } from './parts';

const ALWAYS: Array<[string[], MessageKey]> = [
  [['Ctrl', 'S'], 'school.keySave'],
  [['Ctrl', 'Z'], 'school.keyUndo'],
  [['Ctrl', 'Shift', 'Z'], 'school.keyRedo'],
  [['Ctrl', 'Enter'], 'school.keySubmit'],
  [['Esc'], 'school.keyEscape'],
  [['F6'], 'school.keyRegions'],
];

const SINGLE: Array<[string, MessageKey]> = [
  ['C', 'school.keyPlayChange'],
  ['R', 'school.keyRestart'],
  ['F', 'school.keyFull'],
  ['D', 'school.keyDraw'],
];

export function KeysSection() {
  const single = useStore((s) => s.prefs.singleKeys);
  return (
    <div className="set-keys">
      <Group>
        <Toggle label={t('school.setSingleKeys')} hint={t('school.setSingleKeysHint')} checked={single} onChange={(v) => setPref('singleKeys', v)} />
      </Group>
      <Group title={t('school.setKeysAlways')}>
        <dl className="set-keylist">
          {ALWAYS.map(([keys, what]) => (
            <div key={what} className="set-keylist__row">
              <dt>
                {keys.map((k, i) => (
                  <span key={k}>
                    {i > 0 && <span className="set-keylist__plus">+</span>}
                    <Keycap>{k}</Keycap>
                  </span>
                ))}
              </dt>
              <dd>{t(what)}</dd>
            </div>
          ))}
        </dl>
      </Group>
      <Group title={t('school.setKeysWorld')}>
        <dl className={single ? 'set-keylist' : 'set-keylist set-dim'}>
          {SINGLE.map(([k, what]) => (
            <div key={what} className="set-keylist__row">
              <dt>
                <Keycap>{k}</Keycap>
              </dt>
              <dd>{t(what)}</dd>
            </div>
          ))}
        </dl>
        {!single && <p className="set-row__hint">{t('school.setSingleOff')}</p>}
      </Group>
    </div>
  );
}
