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
    <path d="M5 3v18" stroke="#45993d" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M6 4c4-2 7 2 12 0v9c-5 2-8-2-12 0z" fill="#4cbf56" stroke="#45993d" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);
export const StopIcon = (p: P) => (
  <svg {...base(p)} stroke="none">
    <path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z" fill="#ec5959" stroke="#b84848" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);
export const SparkIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="currentColor" stroke="none" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" fill="currentColor" stroke="none" />
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
export const WandIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9h.01M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5" />
  </svg>
);
