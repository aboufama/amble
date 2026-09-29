/**
 * The components gallery (dev only): every shared component (src/ui/components) in every state, on the
 * page and on the top bar, to review the look against LOOK-BRIEF.md and to run axe over. Open it on the
 * dev server: http://localhost:5240/tests/ui/gallery/index.html (?theme=contrast for High contrast,
 * ?motion=reduced). e2e/foundation/gallery.spec.ts screenshots it and checks it with axe in both themes.
 * Buttons marked `data-open` open the dialog, the sheet, the menu and the popover.
 */
import { StrictMode, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/ui/fonts';
import '../../../src/ui/tokens.css';
import '../../../src/ui/themes.css';
import '../../../src/ui/base.css';
import '../../../src/ui/components/components.css';
import '../../../src/app/frame/frame.css';
import { TopBar } from '../../../src/app/frame/TopBar';
import { installGlobalKeys } from '../../../src/app/keys';
import type { CharacterKind, RigKind } from '../../../src/model/types';
import type { Toast } from '../../../src/state/app';
import {
  Button,
  Chip,
  Dialog,
  Field,
  Footprints,
  IconButton,
  Keycap,
  KindIcon,
  Menu,
  Meter,
  Panel,
  PaperCard,
  PlaceholderGlyph,
  Popover,
  Segmented,
  Sheet,
  Slider,
  Sticker,
  StickyNote,
  TabPanel,
  Tabs,
  Tag,
  TextArea,
  ToastView,
  Toggle,
  Tooltip,
  Wordmark,
  type ButtonVariant,
  type GlyphRole,
} from '../../../src/ui/components';
import { ICONS, Icon, type IconName } from '../../../src/ui/icons';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') === 'contrast' ? 'contrast' : 'original';
document.documentElement.dataset.motion = params.get('motion') === 'reduced' ? 'reduced' : 'full';
document.documentElement.dataset.layout = 'full';
// Esc closes menus and popovers through the app's own key handler.
installGlobalKeys();

const css = `
html, body { overflow: auto; height: auto; }
.gallery { display: grid; gap: var(--s6); padding: var(--s6); max-width: 1320px; }
.gallery__section { display: grid; gap: var(--s3); }
.gallery__section > h2 { font: var(--type-title); }
.gallery__row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s3); }
.gallery__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--s4); align-items: start; }
.gallery__label { font: var(--type-meta); color: var(--text-2); }
.gallery__cell { display: grid; gap: var(--s2); justify-items: start; }
.gallery__icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: var(--s2); }
.gallery__icon { display: grid; justify-items: center; gap: 6px; padding: var(--s2); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface); font: var(--type-meta); }
.gallery__icon span { display: flex; gap: 10px; align-items: center; }
.gallery__bar { position: relative; }
.gallery__stack { display: grid; gap: var(--s2); justify-items: center; }
.gallery__toasts { display: grid; gap: var(--s2); justify-items: start; }
`;

/** A child's doodle, as a sticker would show it (the art is the student's, so it stays hand-drawn). */
const DOODLE = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 12c20 0 34 16 33 36-1 22-15 38-34 38S15 70 16 48 30 12 50 12z" fill="#ffd166" stroke="#fff" stroke-width="8"/><path d="M50 12c20 0 34 16 33 36-1 22-15 38-34 38S15 70 16 48 30 12 50 12z" fill="#ffd166" stroke="#3a3a3a" stroke-width="3"/><circle cx="38" cy="44" r="5" fill="#3a3a3a"/><circle cx="62" cy="44" r="5" fill="#3a3a3a"/><path d="M36 62q14 12 28 0" fill="none" stroke="#3a3a3a" stroke-width="4" stroke-linecap="round"/></svg>',
)}`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="gallery__section" aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="gallery__cell">
      <span className="gallery__label">{label}</span>
      {children}
    </div>
  );
}

const VARIANTS: ButtonVariant[] = ['lantern', 'ghost', 'quiet', 'danger', 'paper', 'ai'];
const VARIANT_WORDS: Record<ButtonVariant, string> = {
  lantern: 'Primary',
  ghost: 'Secondary',
  quiet: 'Quiet',
  danger: 'Delete',
  paper: 'Paper (secondary)',
  ai: 'Retired ai (secondary)',
};

function Buttons() {
  return (
    <Section title="Buttons">
      {VARIANTS.map((v) => (
        <div className="gallery__row" key={v}>
          <Button variant={v} size={58} icon="play">
            {VARIANT_WORDS[v]}
          </Button>
          <Button variant={v} icon="plus" data-gallery={`btn-${v}`}>
            {VARIANT_WORDS[v]}
          </Button>
          <Button variant={v} size={38}>
            {VARIANT_WORDS[v]}
          </Button>
          <Button variant={v} disabled>
            Disabled
          </Button>
          <IconButton variant={v} icon="undo" label={`Undo (${v})`} />
          <IconButton variant={v} icon="redo" label={`Redo (${v})`} size={38} />
        </div>
      ))}
      <div className="gallery__row">
        <Button variant="ghost" icon="mirror" aria-pressed>
          Toggled on
        </Button>
        <IconButton icon="mirror" label="Mirror" pressed />
        <IconButton icon="trace" label="Trace" pressed={false} />
        <Button variant="lantern" busy>
          Working…
        </Button>
      </div>
    </Section>
  );
}

function Bars() {
  const [mode, setMode] = useState<'play' | 'change'>('play');
  return (
    <Section title="Top bar (Scratch's menu bar)">
      <div className="gallery__bar">
        <TopBar
          title="Moon King"
          center={
            <Segmented<'play' | 'change'>
              label="Mode"
              options={[
                { value: 'play', label: 'Play', icon: 'play' },
                { value: 'change', label: 'Change', icon: 'change' },
              ]}
              value={mode}
              onChange={setMode}
              size={38}
            />
          }
          actions={
            <>
              <Chip dot="alive">Saved</Chip>
              <Button variant="ghost" icon="fileSave" data-gallery="bar-ghost">
                Save file
              </Button>
              <Button variant="lantern" icon="bones">
                Bring to life
              </Button>
              <IconButton icon="mirror" label="Mirror on the bar" pressed />
              <Menu label="More for this world" icon="more" items={[{ id: 'a', label: 'World info', icon: 'info', onSelect: () => undefined }]} />
            </>
          }
        />
      </div>
      <div className="gallery__bar">
        <TopBar back={null} lead={<Wordmark size={34} />} actions={<Button variant="quiet" icon="settings">Settings</Button>} />
      </div>
    </Section>
  );
}

function Chips() {
  const [picked, setPicked] = useState('Boss');
  return (
    <Section title="Chips, tags and keycaps">
      <div className="gallery__row">
        <Chip>Plain chip</Chip>
        <Chip dot="alive">Saved</Chip>
        <Chip dot="warn">Needs a look</Chip>
        <Chip dot="change">Changed</Chip>
        <Chip dot="off">Off</Chip>
        <Chip icon="lock">Locked</Chip>
        {['Hero', 'Boss', 'Items'].map((w) => (
          <Chip key={w} onClick={() => setPicked(w)} selected={picked === w}>
            {w}
          </Chip>
        ))}
        <Chip onClick={() => undefined} icon="plus">
          Button chip
        </Chip>
      </div>
      <div className="gallery__row">
        <Tag>New</Tag>
        <Tag variant="dark">Live</Tag>
        <Tag variant="dark" icon="lock">
          ×3
        </Tag>
        {(['hero', 'boss', 'enemy', 'item', 'hazard', 'npc'] as const).map((r) => (
          <Tag key={r} role={r} />
        ))}
        <Keycap>Space</Keycap>
        <Keycap label="Left and right arrows">← →</Keycap>
        <Keycap>X</Keycap>
      </div>
    </Section>
  );
}

function Controls() {
  const [seg2, setSeg2] = useState<'dials' | 'twists'>('dials');
  const [seg3, setSeg3] = useState<'a' | 'b' | 'c'>('b');
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);
  const [dial, setDial] = useState(7);
  const [speed, setSpeed] = useState(40);
  return (
    <Section title="Segmented, toggles and dials">
      <div className="gallery__row">
        <Segmented<'dials' | 'twists'>
          label="Dials or Twists"
          options={[
            { value: 'dials', label: 'Dials', icon: 'dial' },
            { value: 'twists', label: 'Twists', icon: 'twist' },
          ]}
          value={seg2}
          onChange={setSeg2}
        />
        <Segmented<'a' | 'b' | 'c'>
          label="Text size"
          options={[
            { value: 'a', label: '100%' },
            { value: 'b', label: '115%' },
            { value: 'c', label: '130%' },
          ]}
          value={seg3}
          onChange={setSeg3}
          size={38}
        />
      </div>
      <div className="gallery__grid">
        <Toggle label="Read aloud buttons" hint="Uses voices on this Chromebook only." checked={on} onChange={setOn} />
        <Toggle label="Extra spacing" checked={off} onChange={setOff} />
        <Toggle label="Locked by your teacher" checked disabled onChange={() => undefined} />
        <Slider label="Jump height" value={dial} min={0} max={10} onChange={setDial} badge="live" onReset={() => setDial(5)} />
        <Slider label="Enemy speed" value={speed} min={0} max={100} onChange={setSpeed} badge="restarts" unit="%" />
        <Slider label="Gravity" value={3} min={0} max={10} onChange={() => undefined} />
      </div>
    </Section>
  );
}

function Fields() {
  const [name, setName] = useState('Moon King');
  const [wish, setWish] = useState('');
  return (
    <Section title="Fields">
      <div className="gallery__grid">
        <Field label="World name" value={name} maxLength={40} counter onChange={(e) => setName(e.target.value)} data-gallery="field" />
        <Field label="Class code" hint="Your teacher has it." placeholder="ABCD-1234" />
        <Field label="Base URL" value="not a web address" error="That doesn't look like a web address." readOnly />
        <Field label="Disabled" value="Can't change this" disabled />
        <TextArea label="Your wish" placeholder="Make the Moon King throw fireballs" value={wish} onChange={(e) => setWish(e.target.value)} />
      </div>
    </Section>
  );
}

function Surfaces() {
  return (
    <Section title="Panels, paper and the sticky note">
      <div className="gallery__grid">
        <Panel
          title="Footsteps"
          actions={
            <Button variant="quiet" size={38}>
              Go back
            </Button>
          }
        >
          <p>A flat white panel with a 1 px line and 8 px corners.</p>
        </Panel>
        <PaperCard>
          <p>Paper that is yours: a white card, square to the page.</p>
        </PaperCard>
        <StickyNote>
          <p>
            <b>Draw the Moon King</b>
          </p>
          <p>A Scratch comment note: yellow, square and untaped.</p>
        </StickyNote>
      </div>
    </Section>
  );
}

function Layers() {
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState<'bottom' | 'right' | null>(null);
  const [pop, setPop] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <Section title="Dialogs, sheets, menus, popovers and tooltips">
      <div className="gallery__row">
        <Button variant="ghost" onClick={() => setDialog(true)} data-open="dialog">
          Open a dialog
        </Button>
        <Button variant="ghost" onClick={() => setSheet('bottom')} data-open="sheet">
          Open a sheet
        </Button>
        <Button variant="ghost" onClick={() => setSheet('right')} data-open="sheet-right">
          Open a side sheet
        </Button>
        <Button ref={anchor} variant="ghost" onClick={() => setPop(true)} data-open="popover">
          Open a popover
        </Button>
        <Menu
          label="More"
          showLabel
          icon="more"
          variant="ghost"
          items={[
            { id: 'info', label: 'World info', icon: 'info', onSelect: () => undefined },
            { id: 'sounds', label: 'Sounds', icon: 'sound', onSelect: () => undefined, badge: '3' },
            { id: 'copy', label: 'Make a copy', icon: 'layer', onSelect: () => undefined },
            { id: 'off', label: 'Not now', onSelect: () => undefined, disabled: true },
            { id: 'away', label: 'Put away', icon: 'close', danger: true, onSelect: () => undefined },
          ]}
        />
        <Tooltip label="Undo your last change">
          <Button variant="quiet" icon="undo" data-open="tooltip">
            Hover me
          </Button>
        </Tooltip>
      </div>
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Put away the Moon King?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setDialog(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => setDialog(false)}>
              Put away
            </Button>
            <Button variant="lantern" onClick={() => setDialog(false)}>
              Keep it
            </Button>
          </>
        }
      >
        <p className="dialog__text">It goes to Lost and found. You can bring it back for 30 days.</p>
        <Field label="Why? (optional)" />
      </Dialog>
      <Sheet open={sheet !== null} side={sheet ?? 'bottom'} onClose={() => setSheet(null)} title="Sounds">
        <p className="dialog__text">A sheet slides from the {sheet === 'right' ? 'right' : 'bottom'} on the same blue scrim.</p>
        <div className="gallery__row">
          <Button variant="lantern" icon="mic">
            Record
          </Button>
          <Button variant="ghost" icon="sound">
            Play
          </Button>
        </div>
      </Sheet>
      <Popover open={pop} anchor={anchor.current} onClose={() => setPop(false)} label="The Moon King" placement="bottom">
        <div className="gallery__stack">
          <b>The Moon King</b>
          <span>Boss · 3 hits to win</span>
          <Button variant="lantern" size={38} icon="draw">
            Draw it
          </Button>
        </div>
      </Popover>
    </Section>
  );
}

const TOASTS: Toast[] = [
  { id: 'g1', text: 'Saved on this Chromebook.', kind: 'info', action: null, sticky: false, at: 0, screen: null },
  { id: 'g2', text: 'Done! The Moon King throws fireballs now.', kind: 'ai', action: { label: 'See what changed', run: () => undefined }, sticky: false, at: 0, screen: null },
  { id: 'g3', text: 'Filled the crown.', kind: 'success', action: { label: 'Undo', run: () => undefined }, sticky: false, at: 0, screen: null },
  { id: 'g4', text: "That didn't save. Try Save file.", kind: 'error', action: null, sticky: false, at: 0, screen: null },
];

function Feedback() {
  const [tab, setTab] = useState<'link' | 'gallery' | 'help'>('link');
  const [side, setSide] = useState<'reading' | 'sound' | 'keys'>('reading');
  return (
    <Section title="Toasts, meters, progress and tabs">
      <div className="gallery__toasts">
        {TOASTS.map((toast) => (
          <ToastView key={toast.id} toast={toast} onDismiss={() => undefined} />
        ))}
      </div>
      <div className="gallery__grid">
        <Cell label="Meter 64%">
          <div style={{ width: 220 }}>
            <Meter label="Space used" value={0.64} />
          </div>
        </Cell>
        <Cell label="Meter alive / warn">
          <div style={{ width: 220, display: 'grid', gap: 12 }}>
            <Meter label="Saved" value={0.3} tone="alive" />
            <Meter label="Almost full" value={0.92} tone="warn" />
          </div>
        </Cell>
        <Cell label="Working on it (busy)">
          <div style={{ width: 220 }}>
            <Meter label="Working on it" busy />
          </div>
        </Cell>
        <Cell label="Footprints">
          <div className="gallery__row">
            <Footprints />
            <Footprints progress={0.34} label="A third done" />
            <Footprints progress={1} label="Done" />
          </div>
        </Cell>
      </div>
      <Tabs<'link' | 'gallery' | 'help'>
        label="Teacher desk"
        idPrefix="gt"
        tabs={[
          { id: 'link', label: 'Class link', icon: 'teacher' },
          { id: 'gallery', label: 'Gallery', icon: 'frame' },
          { id: 'help', label: 'Help', icon: 'info' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <TabPanel idPrefix="gt" id={tab}>
        <p>The {tab} tab.</p>
      </TabPanel>
      <div className="gallery__row" style={{ alignItems: 'flex-start' }}>
        <Tabs<'reading' | 'sound' | 'keys'>
          label="Settings"
          idPrefix="gs"
          orientation="vertical"
          tabs={[
            { id: 'reading', label: 'Reading and motion', icon: 'eye' },
            { id: 'sound', label: 'Sound', icon: 'sound' },
            { id: 'keys', label: 'Keys', icon: 'list' },
          ]}
          value={side}
          onChange={setSide}
        />
        <TabPanel idPrefix="gs" id={side}>
          <p>The {side} section.</p>
        </TabPanel>
      </div>
    </Section>
  );
}

const KINDS: CharacterKind[] = ['biped', 'quadruped', 'flyer', 'swimmer', 'blob', 'object'];
const RIGS: Array<{ rig: RigKind; role: GlyphRole; name: string }> = [
  { rig: 'biped', role: 'hero', name: 'Pip' },
  { rig: 'blob', role: 'boss', name: 'The Moon King' },
  { rig: 'quadruped', role: 'enemy', name: 'Grumble' },
  { rig: 'flyer', role: 'npc', name: 'Bubbles' },
  { rig: 'swimmer', role: 'friend', name: 'Finn' },
  { rig: 'object', role: 'item', name: 'Star shard' },
];

function Pictures() {
  return (
    <Section title="Kinds, just bones, stickers and the wordmark">
      <div className="gallery__row">
        {KINDS.map((k) => (
          <KindIcon key={k} kind={k} showLabel />
        ))}
      </div>
      <div className="gallery__row">
        {RIGS.map((r) => (
          <PlaceholderGlyph key={r.name} rig={r.rig} role={r.role} name={r.name} size={72} />
        ))}
        <PlaceholderGlyph rig="none" role="prop" shape="star" size={72} name="A star" />
      </div>
      <div className="gallery__row">
        <Sticker src={DOODLE} alt="Pip, drawn" size={72} />
        <Sticker src={DOODLE} alt="Pip, small" size={38} />
        <Sticker src={null} alt="A drawing that is loading" size={72} />
        <Wordmark size={40} />
        <Wordmark size={24} />
      </div>
    </Section>
  );
}

function Icons() {
  const names = Object.keys(ICONS) as IconName[];
  return (
    <Section title={`Icons (${names.length})`}>
      <div className="gallery__icons">
        {names.map((n) => (
          <div key={n} className="gallery__icon">
            <span>
              <Icon name={n} size={24} />
              <Icon name={n} size={16} />
            </span>
            {n}
          </div>
        ))}
      </div>
    </Section>
  );
}

function Gallery() {
  return (
    <>
      <style>{css}</style>
      <main className="gallery" id="main">
        <h1 className="display-m">Components</h1>
        <Buttons />
        <Bars />
        <Chips />
        <Controls />
        <Fields />
        <Surfaces />
        <Layers />
        <Feedback />
        <Pictures />
        <Icons />
      </main>
    </>
  );
}

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <StrictMode>
      <Gallery />
    </StrictMode>,
  );
