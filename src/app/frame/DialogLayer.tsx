/** Renders the promise dialogs of src/ui/dialogs.ts (alert, confirm, ask) as native modal dialogs. */
import { useRef, useState } from 'react';
import type { DialogEntry } from '../../state/app';
import { useStore } from '../../state/store';
import { Button, Dialog, Field } from '../../ui/components';

function Entry({ entry }: { entry: DialogEntry }) {
  const [value, setValue] = useState(entry.kind === 'ask' ? entry.value : '');
  const okRef = useRef<HTMLButtonElement>(null);
  const cancel = () => {
    if (entry.kind === 'alert') entry.resolve();
    else if (entry.kind === 'confirm') entry.resolve(false);
    else entry.resolve(null);
  };
  const ok = () => {
    if (entry.kind === 'alert') entry.resolve();
    else if (entry.kind === 'confirm') entry.resolve(true);
    else entry.resolve(value);
  };
  return (
    <Dialog
      open
      size="sm"
      title={entry.title}
      onClose={cancel}
      closeButton={false}
      initialFocus={entry.kind === 'ask' ? undefined : okRef}
      actions={
        <>
          {entry.kind !== 'alert' && (
            <Button variant="ghost" onClick={cancel}>
              {entry.cancel}
            </Button>
          )}
          <Button ref={okRef} variant={entry.kind === 'confirm' && entry.danger ? 'danger' : 'lantern'} onClick={ok}>
            {entry.ok}
          </Button>
        </>
      }
    >
      {entry.body && <p className="dialog__text">{entry.body}</p>}
      {entry.kind === 'ask' && (
        <Field
          label={entry.label}
          value={value}
          placeholder={entry.placeholder}
          maxLength={entry.maxLength}
          counter
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              ok();
            }
          }}
        />
      )}
    </Dialog>
  );
}

export function DialogLayer() {
  const dialogs = useStore((s) => s.app.dialogs);
  return (
    <>
      {dialogs.map((d) => (
        <Entry key={d.id} entry={d} />
      ))}
    </>
  );
}
