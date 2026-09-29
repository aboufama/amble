/**
 * The AI helper's status for Home's idea box: the `ai` slice (M5) when it says anything but off, else
 * the service's own report (`AiService.status` / `onStatus`), so either wiring lights the box up. Also
 * the district's name and the AI host for the copy.
 */
import { useEffect, useState } from 'react';
import { useServices } from '../app/services';
import type { AiStatus } from '../model/types';
import { useStore } from '../state/store';

export interface AiView {
  status: AiStatus;
  /** The AI helper can take an idea right now. */
  on: boolean;
  district: string | null;
  host: string | null;
  school: boolean;
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function useAiView(): AiView {
  const { ai } = useServices();
  const slice = useStore((s) => s.ai.status);
  const district = useStore((s) => s.config.ai?.district?.name ?? s.config.classLink?.district ?? null);
  const baseUrl = useStore((s) => s.config.ai?.baseUrl ?? s.config.classLink?.ai?.baseUrl ?? null);
  const school = useStore((s) => s.config.school || s.config.classLink !== null);
  const [service, setService] = useState<AiStatus>(() => ai.status());
  useEffect(() => {
    setService(ai.status());
    return ai.onStatus(setService);
  }, [ai]);
  const status = slice !== 'off' ? slice : service;
  return { status, on: status === 'ready' || status === 'busy', district, host: hostOf(baseUrl), school };
}
