/**
 * The request note (§2.10): sticky paper with tape at the sheet's top-left. **THE GAME NEEDS**, the name,
 * the `ask` sentence, up to four facts built from the request ("Big and round", "Faces left, at Pip",
 * "3× as tall as Pip", "Moves like a blob") and **Read to me** (an on-device voice only). A free drawing
 * gets a smaller note that says what drawing on the Desk can do.
 */
import { useEffect, useState } from 'react';
import { factText, requestFacts, type DeskRequest } from '../../draw/request';
import { t } from '../../i18n';
import { readAloud } from '../../ui/a11y';
import { StickyNote } from '../../ui/components';
import { Icon } from '../../ui/icons';

export { factText };

const canSpeak = (): boolean => typeof speechSynthesis !== 'undefined';

export function RequestNote({ request, readAloudOn, onToast }: { request: DeskRequest; readAloudOn: boolean; onToast(text: string): void }) {
  const [speaking, setSpeaking] = useState(false);
  // Folded to its name, so it never sits on the drawing (remembered on this Chromebook).
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem('amble.desk.noteFolded') === '1';
    } catch {
      return false;
    }
  });
  const fold = (on: boolean) => {
    setFolded(on);
    try {
      localStorage.setItem('amble.desk.noteFolded', on ? '1' : '0');
    } catch {
      // Private windows keep it for now only.
    }
  };
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

  if (folded)
    return (
      <section className="note note--folded" aria-label={t('draw.requestLabel')}>
        <button type="button" className="note__tab" aria-expanded={false} onClick={() => fold(false)}>
          <span className="note__caps">{free ? request.name : t('draw.needs')}</span>
          {!free && <span className="note__tab-name">{request.name}</span>}
        </button>
      </section>
    );

  return (
    <section className="note" aria-label={t('draw.requestLabel')}>
      <StickyNote tilt={-2.5} className="note__paper">
        <button type="button" className="note__fold" aria-label={t('draw.foldNote')} title={t('draw.foldNote')} aria-expanded={true} onClick={() => fold(true)}>
          <Icon name="close" size={14} />
        </button>
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
