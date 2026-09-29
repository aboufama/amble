/**
 * Add someone (§2.6): "Who do you want to add?" with role pictures (A friend, An enemy, A boss, A thing to
 * collect, Something else), a name and, with the AI helper on, "What do they do?". The new member rests on
 * the Cast line and the Desk opens; after Bring to life Amble asks the AI helper to add them ("Add
 * Bubbles, a friend: flies after you"), or, with the AI off, offers the world's spare slots.
 */
import { useEffect, useId, useState } from 'react';
import { t, type MessageKey } from '../../i18n';
import { CAST_KEY_RE } from '../../model/ids';
import type { ArtKind, CastKey, CastMember, RigKind, Role, World } from '../../model/types';
import { flushWorld, getSessionMember, refreshCast, updateWorld } from '../../state/session';
import { useStore } from '../../state/store';
import { Button, Field, PlaceholderGlyph, Sheet, TextArea } from '../../ui/components';
import { cx } from '../../ui/cx';

type Pick = 'friend' | 'enemy' | 'boss' | 'item' | 'other';

interface RoleDef {
  pick: Pick;
  label: MessageKey;
  word: MessageKey;
  role: Role;
  kind: ArtKind;
  rig: RigKind;
}

const ROLES: RoleDef[] = [
  { pick: 'friend', label: 'world.addFriend', word: 'world.addRoleFriend', role: 'npc', kind: 'character', rig: 'biped' },
  { pick: 'enemy', label: 'world.addEnemy', word: 'world.addRoleEnemy', role: 'enemy', kind: 'character', rig: 'blob' },
  { pick: 'boss', label: 'world.addBoss', word: 'world.addRoleBoss', role: 'boss', kind: 'character', rig: 'biped' },
  { pick: 'item', label: 'world.addItem', word: 'world.addRoleItem', role: 'item', kind: 'item', rig: 'object' },
  { pick: 'other', label: 'world.addOther', word: 'world.addRoleOther', role: 'prop', kind: 'prop', rig: 'object' },
];

/** A cast key from a name ("Captain Crunch" → "captainCrunch"), unique in the world. */
export function keyFromName(name: string, taken: Iterable<string>): CastKey {
  const words = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let base = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
  if (!/^[a-z]/.test(base)) base = `friend${base}`;
  base = base.slice(0, 20);
  if (!CAST_KEY_RE.test(base)) base = 'friend';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
  return `${base}${Date.now() % 1000}`;
}

/** Someone added and sent to the Desk: what to ask for once they come alive. */
export interface PendingAdd {
  worldId: string;
  key: CastKey;
  name: string;
  roleWord: string;
  what: string;
}

let pending: PendingAdd | null = null;

/** The pending add for this key (and forgets it). */
export function takePendingAdd(worldId: string, key: CastKey | null): PendingAdd | null {
  if (!pending || !key || pending.worldId !== worldId || pending.key !== key) return null;
  const p = pending;
  pending = null;
  return p;
}

export function AddSomeone({ open, world, onClose, onDraw }: { open: boolean; world: World; onClose(): void; onDraw(member: CastMember): void }) {
  const aiOn = useStore((s) => s.ai.status === 'ready');
  const [pick, setPick] = useState<Pick>('friend');
  const [name, setName] = useState('');
  const [what, setWhat] = useState('');
  const group = useId();
  useEffect(() => {
    if (!open) return;
    setPick('friend');
    setName('');
    setWhat('');
  }, [open]);
  const def = ROLES.find((r) => r.pick === pick) ?? ROLES[0];
  const shownName = name.trim() || t('world.addDefaultName');

  const start = async () => {
    const finalName = shownName.slice(0, 40);
    const key = keyFromName(finalName, Object.keys(world.cast));
    updateWorld((w) => {
      w.cast[key] = { key, art: null, madeBy: null, extra: { name: finalName, role: def.role, kind: def.kind, rig: def.rig, note: what.trim().slice(0, 160) }, laterUntil: 0 };
    });
    await flushWorld();
    refreshCast();
    pending = { worldId: world.id, key, name: finalName, roleWord: t(def.word), what: what.trim() };
    onClose();
    const member = getSessionMember(key);
    if (member) onDraw(member);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('world.addTitle')}
      side="bottom"
      actions={
        <Button variant="lantern" icon="draw" onClick={() => void start()} data-testid="add-draw">
          {name.trim() ? t('world.addDraw', { name: name.trim() }) : t('world.addDrawPlain')}
        </Button>
      }
    >
      <div className="add-someone">
        <div className="add-someone__roles" role="radiogroup" aria-labelledby={`${group}-label`}>
          <span id={`${group}-label`} className="sr-only">
            {t('world.addTitle')}
          </span>
          {ROLES.map((r) => (
            <button
              key={r.pick}
              type="button"
              role="radio"
              aria-checked={pick === r.pick}
              className={cx('add-role', pick === r.pick && 'add-role--on')}
              onClick={() => setPick(r.pick)}
              data-testid={`add-role-${r.pick}`}
            >
              <PlaceholderGlyph rig={r.rig === 'object' ? 'object' : r.rig} role={r.role === 'npc' ? 'friend' : r.role} shape={r.kind === 'item' ? 'coin' : 'capsule'} size={64} />
              <span>{t(r.label)}</span>
            </button>
          ))}
        </div>
        <Field label={t('world.addName')} hint={t('world.addNameHint')} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} data-testid="add-name" />
        {aiOn && <TextArea label={t('world.addWhat')} hint={t('world.addWhatHint')} value={what} maxLength={160} rows={2} onChange={(e) => setWhat(e.target.value)} />}
      </div>
    </Sheet>
  );
}
