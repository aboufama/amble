/**
 * The notebook's Dials | Twists card in Change mode (§2.7): the world's own dials (those not given to one
 * member) as dials with LIVE or RESTARTS, or the twist tiles. Each dial change is live and becomes one
 * footstep after 1.5 s of rest.
 */
import { useMemo, useState } from 'react';
import { t } from '../../i18n';
import { useStore } from '../../state/store';
import { Segmented } from '../../ui/components';
import { DialSlider } from './DialSlider';
import { TwistsCard } from './TwistsCard';

export function WorldDials() {
  const all = useStore((s) => s.session.manifest?.dials);
  const dials = useMemo(() => (all ?? []).filter((d) => !d.for), [all]);
  if (!dials.length) return <p className="tune__empty">{t('world.noWorldDials')}</p>;
  return (
    <div className="tune__dials" data-testid="world-dials">
      {dials.map((d) => (
        <DialSlider key={d.key} dial={d} className="tune__dial" />
      ))}
    </div>
  );
}

export function DialsCard() {
  const [tab, setTab] = useState<'dials' | 'twists'>('dials');
  return (
    <section className="panel tune" aria-label={t('world.tuneGroup')} data-testid="tune-card">
      <div className="tune__head">
        <Segmented<'dials' | 'twists'>
          label={t('world.tuneGroup')}
          size={38}
          tone="change"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'dials', label: t('world.segDials'), icon: 'dial' },
            { value: 'twists', label: t('world.segTwists'), icon: 'twist' },
          ]}
        />
        {tab === 'dials' && <span className="tune__meta">{t('world.worldDialsNote')}</span>}
      </div>
      {tab === 'dials' ? <WorldDials /> : <TwistsCard />}
    </section>
  );
}
