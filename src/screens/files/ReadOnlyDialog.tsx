/** "This copy is read-only (was it turned in?)" (§2.16; M6 owns). FOUNDATION-STUB: renders nothing. */
export interface ReadOnlyDialogProps {
  open: boolean;
  onSaveCopy(): void;
  onClose(): void;
}

export function ReadOnlyDialog(_props: ReadOnlyDialogProps) {
  return null;
}
