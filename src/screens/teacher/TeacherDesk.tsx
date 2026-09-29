/** `#/teacher/<tab>` the Teacher desk (§2.14; M7 owns). FOUNDATION-STUB. */
import { ScreenStub } from '../../app/frame/ScreenStub';
import type { RouteOf } from '../../app/routes';

export function TeacherDesk({ route }: { route: RouteOf<'teacher'> }) {
  return <ScreenStub route={route} name="teacher" />;
}
