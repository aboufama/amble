import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = ({ size = 18, ...rest }: P) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...rest,
});

export const FlagIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M4.4 2.6v18.6" stroke="#45993d" strokeWidth="2.3" strokeLinecap="round" />
    <path d="M5.5 4.1c2.4-1.7 5-1.6 7.2.2 2.2 1.8 4.9 1.9 7.3.1v9.4c-2.4 1.9-5.1 1.8-7.3 0-2.2-1.8-4.8-1.9-7.2-.1z" fill="#4cbf56" stroke="#45993d" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
);
export const StopIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M8.3 2.5h7.4l5.8 5.8v7.4l-5.8 5.8H8.3l-5.8-5.8V8.3z" fill="#ec5959" stroke="#b84848" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);
/** Compile: a hammer (building the game). */
export const HammerIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M14.5 5.5l4 4M12 8l4 4M3.5 20.5l8.8-8.8" />
    <path d="M10.5 6.5l3-3c1.6-.6 3.7-.2 5 1l.6.6-2.6 2.6 1.9 1.9-2.4 2.4z" fill="currentColor" fillOpacity=".25" />
  </svg>
);
export const GearIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
export const FullscreenIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
  </svg>
);
export const PlusIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const TrashIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </svg>
);
export const BrushIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 15l-3-3z" />
    <path d="M9 12c-3 0-4.5 2-5 5-.2 1.3-1 2-2 2 2 2 6 2 8-1 1-1.5 1-3 0-4" />
  </svg>
);
export const UploadIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
  </svg>
);
export const MicIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" />
  </svg>
);
export const WaveIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M2 12h2l2-6 3 12 3-15 3 18 3-12 2 3h2" />
  </svg>
);
export const PlayIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M7 4v16l13-8z" fill="currentColor" />
  </svg>
);
export const PauseIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" />
    <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" />
  </svg>
);
export const KeepIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
);
export const CodeIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
  </svg>
);
export const CubeIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 16V8l-9-5-9 5v8l9 5z" />
    <path d="M3.3 7.3L12 12l8.7-4.7M12 22V12" />
  </svg>
);
export const XIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);
export const UndoIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
  </svg>
);
export const RedoIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9a5 5 0 0 0 0 10h3" />
  </svg>
);
export const EraserIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 20H9l-6-6a2 2 0 0 1 0-3l9-9a2 2 0 0 1 3 0l6 6a2 2 0 0 1 0 3l-8 8" />
    <path d="M6 11l7 7" />
  </svg>
);
export const LineIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 19L19 5" />
  </svg>
);
export const RectIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="6" width="16" height="12" rx="2" />
  </svg>
);
export const EllipseIcon = (p: P) => (
  <svg {...base(p)}>
    <ellipse cx="12" cy="12" rx="9" ry="7" />
  </svg>
);
export const BucketIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M19 11l-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0z" />
    <path d="M5 2l5 5M2 13h15M22 20a2 2 0 1 1-4 0c0-1.6 2-4 2-4s2 2.4 2 4" />
  </svg>
);
export const PickerIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M2 22l1-1h3l9-9M3 21v-3l9-9M14.5 6.5l3-3a2.1 2.1 0 0 1 3 3l-3 3" />
    <path d="M12 5l7 7" />
  </svg>
);
export const TextIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7V4h16v3M9 20h6M12 4v16" />
  </svg>
);
export const CopyIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
/** Fix: a wrench. */
export const WrenchIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M14.7 6.3a4 4 0 0 0 5 5L21 12.6a6 6 0 0 1-7.8 1.2L6 21l-3-3 7.2-7.2A6 6 0 0 1 11.4 3l1.3 1.3a4 4 0 0 0 2 2z" />
  </svg>
);

// ---- Scratch-style GUI icons (Amble's own drawings)

/** Stacked blocks (Code tab). */
export const BlocksTabIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M3 5.5a1.5 1.5 0 0 1 1.5-1.5H7l1 1.2h3L12 4h7.5A1.5 1.5 0 0 1 21 5.5v3A1.5 1.5 0 0 1 19.5 10H12l-1 1.2H8L7 10H4.5A1.5 1.5 0 0 1 3 8.5z" fill="#9966ff" />
    <path d="M3 14.5a1.5 1.5 0 0 1 1.5-1.5H7l1 1.2h3L12 13h4.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5H12l-1 1.2H8L7 19H4.5A1.5 1.5 0 0 1 3 17.5z" fill="#855cd6" />
  </svg>
);
/** Paintbrush (Costumes tab). */
export const BrushTabIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M20.6 3.4a1.6 1.6 0 0 0-2.3 0l-8.1 8.4 2 2 8.4-8.1a1.6 1.6 0 0 0 0-2.3z" fill="#855cd6" />
    <path d="M9.3 12.9c-1.9-.4-3.7.7-4.3 2.6-.4 1.3-.8 2.6-2.4 3.2 2.6 1.9 7 1.6 8.3-1.2.6-1.2.3-2.4-.3-3.2z" fill="#855cd6" />
  </svg>
);
/** Speaker (Sounds tab). */
export const SpeakerTabIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M3.5 9.3h3.3L11.4 5c.6-.5 1.6-.1 1.6.7v12.6c0 .8-1 1.2-1.6.7l-4.6-4.3H3.5a1 1 0 0 1-1-1V10.3a1 1 0 0 1 1-1z" fill="#855cd6" />
    <path d="M15.6 9c1.6 1.6 1.6 4.4 0 6M18.4 6.6c2.9 2.9 2.9 7.9 0 10.8" fill="none" stroke="#855cd6" strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);
/** Small stage layout. */
export const SmallStageIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <rect x="3" y="5" width="18" height="14" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <rect x="14.5" y="5" width="6.5" height="6" rx="1" fill="currentColor" />
    <path d="M14.5 5v14" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);
/** Normal stage layout. */
export const LargeStageIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <rect x="3" y="5" width="18" height="14" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <rect x="12" y="5" width="9" height="7.5" rx="1" fill="currentColor" />
    <path d="M12 5v14" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);
/** Four outward arrows. */
export const ExpandIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2.2}>
    <path d="M4 9V4h5M4 4l5.5 5.5M20 9V4h-5M20 4l-5.5 5.5M4 15v5h5M4 20l5.5-5.5M20 15v5h-5M20 20l-5.5-5.5" />
  </svg>
);
/** Four inward arrows. */
export const ShrinkIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2.2}>
    <path d="M9.5 4.5v5h-5M9.5 9.5L4 4M14.5 4.5v5h5M14.5 9.5L20 4M9.5 19.5v-5h-5M9.5 14.5L4 20M14.5 19.5v-5h5M14.5 14.5L20 20" />
  </svg>
);
export const HorizontalArrowsIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2.4}>
    <path d="M3.5 12h17M7.5 8l-4 4 4 4M16.5 8l4 4-4 4" />
  </svg>
);
export const VerticalArrowsIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2.4}>
    <path d="M12 3.5v17M8 7.5l4-4 4 4M8 16.5l4 4 4-4" />
  </svg>
);
export const EyeIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M12 5.5c4.4 0 7.7 3.2 9.2 5.5.4.6.4 1.4 0 2-1.5 2.3-4.8 5.5-9.2 5.5S4.3 15.3 2.8 13c-.4-.6-.4-1.4 0-2C4.3 8.7 7.6 5.5 12 5.5z" fill="currentColor" />
    <circle cx="12" cy="12" r="3.6" fill="#fff" />
    <circle cx="12" cy="12" r="1.9" fill="currentColor" />
  </svg>
);
export const EyeOffIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2}>
    <path d="M4.5 9.3C6 7.4 8.6 5.9 12 5.9c4.1 0 7.1 2.9 8.5 5.1.4.6.4 1.4 0 2-1.4 2.2-4.4 5.1-8.5 5.1-4.1 0-7.1-2.9-8.5-5.1a1.9 1.9 0 0 1 0-2" />
    <circle cx="12" cy="12" r="3" />
    <path d="M4 20L20 4" />
  </svg>
);
export const CaretDownIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M6.6 9h10.8c.9 0 1.3 1 .7 1.6l-5.4 5.1a1 1 0 0 1-1.4 0l-5.4-5.1C5.3 10 5.7 9 6.6 9z" fill="currentColor" />
  </svg>
);
export const FileIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M6.5 2.5h7.6c.5 0 1 .2 1.4.6l3.4 3.4c.4.4.6.9.6 1.4v11.6a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2z" fill="currentColor" />
    <path d="M8 11h8M8 14.5h8M8 18h5" stroke="#855cd6" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
/** A friendly character with a plus: add a sprite or costume. */
export const AddCharacterIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M10.5 6.5c4.4 0 7.5 3.3 7.5 7.4 0 4-3.1 6.6-7.5 6.6S3 17.9 3 13.9c0-4.1 3.1-7.4 7.5-7.4z" fill="currentColor" />
    <circle cx="8" cy="13" r="1.3" fill="#855cd6" />
    <circle cx="13" cy="13" r="1.3" fill="#855cd6" />
    <path d="M8.5 16.4c1.2.9 2.8.9 4 0" fill="none" stroke="#855cd6" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M19 2.5v6M16 5.5h6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);
/** A picture with a plus: add a backdrop. */
export const AddPictureIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <rect x="2.5" y="6" width="16" height="14" rx="2.5" fill="currentColor" />
    <path d="M4.5 17.5l4-4.4c.4-.4 1-.4 1.4 0l2 2.1 1.6-1.6c.4-.4 1-.4 1.4 0l1.6 1.8v2.1z" fill="#855cd6" />
    <circle cx="13.5" cy="10" r="1.4" fill="#855cd6" />
    <path d="M19.5 2.5v6M16.5 5.5h6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);
/** A speaker with a plus: add a sound. */
export const AddSoundIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M3.5 10h3l4.3-3.9c.6-.5 1.5-.1 1.5.7v11.4c0 .8-.9 1.2-1.5.7L6.5 15h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z" fill="currentColor" />
    <path d="M14.8 10c1.3 1.3 1.3 3.7 0 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M19.5 2.5v6M16.5 5.5h6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);
export const SearchIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2.4}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="M15 15l5 5" />
  </svg>
);
export const SurpriseIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M9 3l1.6 4.6L15 9l-4.4 1.5L9 15l-1.6-4.5L3 9l4.4-1.4z" fill="currentColor" />
    <path d="M17 12l1 2.8 2.8 1-2.8 1-1 2.8-1-2.8-2.8-1 2.8-1z" fill="currentColor" />
  </svg>
);
/** A speaker with sound waves: sound tiles and the sound library. */
export const SoundIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M3.5 9.3h3.3L11.4 5c.6-.5 1.6-.1 1.6.7v12.6c0 .8-1 1.2-1.6.7l-4.6-4.3H3.5a1 1 0 0 1-1-1V10.3a1 1 0 0 1 1-1z" fill="currentColor" />
    <path d="M15.6 9c1.6 1.6 1.6 4.4 0 6M18.4 6.6c2.9 2.9 2.9 7.9 0 10.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const speaker = 'M2.5 9.8h2.8L9.2 6.3c.6-.5 1.5-.1 1.5.7v10c0 .8-.9 1.2-1.5.7l-3.9-3.5H2.5a1 1 0 0 1-1-1v-2.4a1 1 0 0 1 1-1z';
// ---- Sound editor effects (Amble's own drawings of Scratch's effect buttons)
export const FasterIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M3 6.8c0-.8.9-1.2 1.5-.8l7 5.2c.5.4.5 1.2 0 1.6l-7 5.2c-.6.4-1.5 0-1.5-.8zM12 6.8c0-.8.9-1.2 1.5-.8l7 5.2c.5.4.5 1.2 0 1.6l-7 5.2c-.6.4-1.5 0-1.5-.8z" fill="currentColor" />
  </svg>
);
export const SlowerIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M21 6.8c0-.8-.9-1.2-1.5-.8l-7 5.2c-.5.4-.5 1.2 0 1.6l7 5.2c.6.4 1.5 0 1.5-.8zM12 6.8c0-.8-.9-1.2-1.5-.8l-7 5.2c-.5.4-.5 1.2 0 1.6l7 5.2c.6.4 1.5 0 1.5-.8z" fill="currentColor" />
  </svg>
);
export const LouderIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d={speaker} fill="currentColor" />
    <path d="M14 9.5c1.3 1.4 1.3 3.6 0 5M17 7c2.7 2.8 2.7 7.2 0 10M20 4.8c3.9 3.9 3.9 10.5 0 14.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
export const SofterIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d={speaker} fill="currentColor" transform="translate(3 0)" />
    <path d="M17 9.5c1.3 1.4 1.3 3.6 0 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
export const MuteIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d={speaker} fill="currentColor" transform="translate(2 0)" />
    <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
export const FadeInIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M2.5 11.6L20.2 4.4c.6-.3 1.3.2 1.3.9v13.4c0 .7-.7 1.2-1.3.9L2.5 12.4a.45.45 0 0 1 0-.8z" fill="currentColor" />
  </svg>
);
export const FadeOutIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M21.5 11.6L3.8 4.4c-.6-.3-1.3.2-1.3.9v13.4c0 .7.7 1.2 1.3.9l17.7-7.2a.45.45 0 0 0 0-.8z" fill="currentColor" />
  </svg>
);
export const ReverseIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2.6}>
    <path d="M8.5 5.5L4.5 9.5l4 4" />
    <path d="M4.8 9.5H14a5.5 5.5 0 0 1 0 11h-3" />
  </svg>
);
export const RobotIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M12 2.2a1.3 1.3 0 0 1 .8 2.3V6h4.7A2.5 2.5 0 0 1 20 8.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 15.5v-7A2.5 2.5 0 0 1 6.5 6h4.7V4.5A1.3 1.3 0 0 1 12 2.2z" fill="currentColor" />
    <circle cx="9" cy="11" r="1.6" fill="#fff" />
    <circle cx="15" cy="11" r="1.6" fill="#fff" />
    <path d="M9 14.8h6" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M7 19h10l1 2.8H6z" fill="currentColor" />
  </svg>
);
export const CopyToNewIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <rect x="3" y="3" width="13" height="13" rx="2.5" fill="currentColor" opacity="0.45" />
    <rect x="8" y="8" width="13" height="13" rx="2.5" fill="currentColor" />
    <path d="M14.5 11.5v6M11.5 14.5h6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
export const BackIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2.6}>
    <path d="M19 12H5M11 5l-7 7 7 7" />
  </svg>
);
/** A round record button. */
export const RecordIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <circle cx="12" cy="12" r="8" fill="currentColor" />
  </svg>
);
export const StopSquareIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
  </svg>
);
// ---- Paint editor
export const FlipHorizontalIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M10.5 6.2v11.6c0 .9-1.1 1.3-1.7.6L3.2 12.6a.9.9 0 0 1 0-1.2l5.6-5.8c.6-.7 1.7-.3 1.7.6z" fill="currentColor" />
    <path d="M13.5 6.2v11.6c0 .9 1.1 1.3 1.7.6l5.6-5.8a.9.9 0 0 0 0-1.2l-5.6-5.8c-.6-.7-1.7-.3-1.7.6z" fill="currentColor" opacity="0.5" />
    <path d="M12 3v18" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 2" />
  </svg>
);
export const FlipVerticalIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M6.2 10.5h11.6c.9 0 1.3-1.1.6-1.7l-5.8-5.6a.9.9 0 0 0-1.2 0L5.6 8.8c-.7.6-.3 1.7.6 1.7z" fill="currentColor" />
    <path d="M6.2 13.5h11.6c.9 0 1.3 1.1.6 1.7l-5.8 5.6a.9.9 0 0 1-1.2 0l-5.8-5.6c-.7-.6-.3-1.7.6-1.7z" fill="currentColor" opacity="0.5" />
    <path d="M3 12h18" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 2" />
  </svg>
);
export const BrushSizeIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <circle cx="6" cy="16" r="2" fill="currentColor" />
    <circle cx="12.5" cy="13" r="3" fill="currentColor" />
    <circle cx="19" cy="9" r="4" fill="currentColor" />
  </svg>
);
/** Amble's mark for the menu bar: the Amble character's head. */
export const AmbleMark = ({ size = 26, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" {...rest}>
    <path d="M13 6.2c6.2 0 9.8 4.6 9.8 10.3 0 5.3-3.8 8.3-9.8 8.3s-9.8-3-9.8-8.3C3.2 10.8 6.8 6.2 13 6.2z" fill="#ffb347" stroke="#fff" strokeWidth="1.6" />
    <path d="M13 6.4c-.6-2.6-2.6-4-5.1-3.7.9 2 2.6 3.4 5.1 3.7zM13.3 6.4c.9-2.3 2.8-3.1 4.8-2.6-.9 1.7-2.6 2.6-4.8 2.6z" fill="#86d35f" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
    <ellipse cx="11" cy="13.4" rx="2" ry="2.5" fill="#fff" />
    <ellipse cx="16.6" cy="13.4" rx="2" ry="2.5" fill="#fff" />
    <circle cx="11.7" cy="13.9" r="1.1" fill="#2b1a10" />
    <circle cx="17.3" cy="13.9" r="1.1" fill="#2b1a10" />
    <path d="M12.2 17.8q2.1 1.8 4.2 0" fill="none" stroke="#6b3412" strokeWidth="1.1" strokeLinecap="round" />
  </svg>
);
/** A solid gear (Settings in the menu bar). */
export const SettingsIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path
      d="M19.16 9.45L19.44 10.46L22.09 10.51L22.09 13.49L19.44 13.54L18.87 15.26L18.35 16.17L20.19 18.08L18.08 20.19L16.17 18.35L14.55 19.16L13.54 19.44L13.49 22.09L10.51 22.09L10.46 19.44L8.74 18.87L7.83 18.35L5.92 20.19L3.81 18.08L5.65 16.17L4.84 14.55L4.56 13.54L1.91 13.49L1.91 10.51L4.56 10.46L5.13 8.74L5.65 7.83L3.81 5.92L5.92 3.81L7.83 5.65L9.45 4.84L10.46 4.56L10.51 1.91L13.49 1.91L13.54 4.56L15.26 5.13L16.17 5.65L18.08 3.81L20.19 5.92L18.35 7.83ZM12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z"
      fill="currentColor"
      fillRule="evenodd"
      strokeLinejoin="round"
    />
  </svg>
);
// ---- Rotation styles (direction popover)
export const AllAroundIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2.4}>
    <path d="M19 12a7 7 0 1 1-2.1-5" />
    <path d="M17.5 2.8v4.6h-4.6" />
  </svg>
);
export const DontRotateIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2.4}>
    <circle cx="12" cy="12" r="8" />
    <path d="M6.4 17.6L17.6 6.4" />
  </svg>
);
/** A pencil (the Edit menu). */
export const PencilIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2.2}>
    <path d="M15.2 4.3l4.5 4.5L9 19.5l-5.2.7.7-5.2z" />
    <path d="M13 6.5l4.5 4.5" />
  </svg>
);
/** A warning triangle (the problems button next to Compile). */
export const WarningIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M10.3 3.9c.8-1.3 2.6-1.3 3.4 0l7.9 13.6c.8 1.3-.2 3-1.7 3H4.1c-1.5 0-2.5-1.7-1.7-3z" fill="currentColor" />
    <path d="M12 9v4.6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    <circle cx="12" cy="16.9" r="1.3" fill="#fff" />
  </svg>
);
