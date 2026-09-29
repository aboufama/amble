/**
 * The request note (§2.10): sticky paper with tape at the sheet's top-left. **THE GAME NEEDS**, the name,
 * the `ask` sentence, up to four facts built from the request ("Big and round", "Faces left, at Pip",
 * "3× as tall as Pip", "Moves like a blob") and **Read to me** (an on-device voice only). A free drawing
 * gets a smaller note that says what drawing on the Desk can do.
 */
import { useEffect, useState } from 'react';
import { requestFacts, type DeskRequest, type Fact } from '../../draw/request';
import { t, type MessageKey } from '../../i18n';
import { readAloud } from '../../ui/a11y';
import { StickyNote } from '../../ui/components';
import { Icon } from '../../ui/icons';

export function factText(f: Fact): string {
  const v = f.vars;
  switch (f.key) {
    case 'faces':
      return t(`draw.fact_faces_${v.side === 'left' ? 'left' : 'right'}`);
    case 'facesAt':
      return t(`draw.fact_facesAt_${v.side === 'left' ? 'left' : 'right'}`, { hero: v.hero });
    case 'times':
      if (v.n === 'half') return t('draw.fact_timesHalf', { hero: v.hero });
      if (v.n === 'small') return t('draw.fact_timesSmall', { hero: v.hero });
      return t('draw.fact_times', v);
    case 'moves':
      return t(`draw.fact_moves_${String(v.rig)}` as MessageKey);
    default:
      return t(`draw.fact_${f.key}` as MessageKey, v);
  }
}

const canSpeak = (): boolean => typeof speechSynthesis !== 'undefined';

export function RequestNote({ request, readAloudOn, onToast }: { request: DeskRequest; readAloudOn: boolean; onToast(text: string): void }) {
  const [speaking, setSpeaking] = useState(false);
  const free = request.key === null;
  const facts = free ? [] : requestFacts(request).map(factText);
  const ask = free ? t('draw.freeNote') : request.ask || request.about;

  useEffect(() => () => {
    if (canSpeak()) speechSynthesis.cancel();
  }, []);

  const read = () => {
    if (speaking) {
      speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const text = [t('draw.needs'), request.name, ask, ...facts].filter(Boolean).join('. ');
    if (!readAloud(text)) {
      onToast(t('draw.noVoice'));
      return;
    }
    setSpeaking(true);
    const poll = window.setInterval(() => {
      if (!speechSynthesis.speaking) {
        clearInterval(poll);
        setSpeaking(false);
      }
    }, 400);
  };

  return (
    <section className="note" aria-label={t('draw.requestLabel')}>
      <StickyNote tilt={-2.5} className="note__paper">
        {!free && <p className="note__caps">{t('draw.needs')}</p>}
        <h2 className="note__name">{request.name}</h2>
        {ask && <p className="note__ask">{ask}</p>}
        {facts.length > 0 && (
          <ul className="note__facts">
            {facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
        {readAloudOn && canSpeak() && (
          <button type="button" className="note__read" onClick={read} aria-pressed={speaking}>
            <Icon name="sound" size={16} />
            <span>{speaking ? t('draw.stopReading') : t('draw.readToMe')}</span>
          </button>
        )}
      </StickyNote>
    </section>
  );
}
