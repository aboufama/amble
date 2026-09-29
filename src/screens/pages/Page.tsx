/**
 * `#/privacy`, `#/terms`, `#/ai`, `#/it`, `#/parents`, `#/accessibility`, `#/poster`, `#/sent`, `#/whatsnew`:
 * the in-app pages (§2.15). They live at stable addresses inside Amble, with no third-party hosting, so a
 * district can list them and a parent can read them without an account.
 */
import { useEffect } from 'react';
import type { RouteOf } from '../../app/routes';
import { useServices } from '../../app/services';
import { loadTeacherData } from '../../school/teacherData';
import { Accessibility } from './Accessibility';
import { AiInstructions } from './AiInstructions';
import { ItPage } from './ItPage';
import { ParentLetter } from './ParentLetter';
import { Poster } from './Poster';
import { Privacy } from './Privacy';
import { SentLog } from './SentLog';
import { Terms } from './Terms';
import { WhatsNew } from './WhatsNew';

export function Page({ route }: { route: RouteOf<'page'> }) {
  const { store } = useServices();
  // The teacher's pages fill in from the Teacher desk's class link on this Chromebook.
  useEffect(() => {
    void loadTeacherData(store);
  }, [store]);
  switch (route.page) {
    case 'privacy':
      return <Privacy />;
    case 'terms':
      return <Terms />;
    case 'ai':
      return <AiInstructions />;
    case 'it':
      return <ItPage />;
    case 'parents':
      return <ParentLetter />;
    case 'accessibility':
      return <Accessibility />;
    case 'poster':
      return <Poster />;
    case 'sent':
      return <SentLog />;
    case 'whatsnew':
      return <WhatsNew />;
  }
}
