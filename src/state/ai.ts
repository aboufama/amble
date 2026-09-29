/**
 * The `ai` slice (M5 owns; FOUNDATION-STUB): the running job, the last outcome and the helper's status.
 */
import type { AiJobView, AiOutcome, AiStatus } from '../model/types';
import { setState } from './store';

export interface AiSlice {
  job: AiJobView | null;
  lastOutcome: AiOutcome | null;
  status: AiStatus;
}

export function initialAi(): AiSlice {
  return { job: null, lastOutcome: null, status: 'off' };
}

export function setAiStatus(status: AiStatus): void {
  setState((s) => {
    s.ai.status = status;
  });
}
