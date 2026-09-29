/** "Meet the AI helper." (§2.16; M5 owns): shown before the first Ask or idea on a device. FOUNDATION-STUB: renders nothing. */
export interface AiExplainerProps {
  open: boolean;
  onClose(): void;
  onWhatsSent?(): void;
}

export function AiExplainer(_props: AiExplainerProps) {
  return null;
}
