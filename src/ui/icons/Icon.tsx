/**
 * One icon from the set (paths.ts): clean line art on the 24 px grid in `currentColor`. Decorative by
 * default (`aria-hidden`); pass `title` when the icon is the only content that names something (icon-only
 * buttons put their name on the button instead). A retired name draws nothing.
 */
import { ICONS, type IconDef, type IconName } from './paths';

export interface IconProps {
  name: IconName;
  /** Rendered size in px (default 24). Small sizes get a slightly heavier stroke, so lines stay 1.5 px or more. */
  size?: number;
  title?: string;
  className?: string;
}

function strokeFor(size: number): number {
  if (size <= 14) return 2.6;
  if (size <= 16) return 2.4;
  if (size <= 20) return 2.2;
  return 2;
}

export function Icon({ name, size = 24, title, className }: IconProps) {
  const def: IconDef | undefined = (ICONS as Record<string, IconDef>)[name];
  if (!def) return null;
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeFor(size)}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
    >
      {def.paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
      {def.dots?.map(([cx, cy, r], i) => (
        <circle key={`d${i}`} cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
      ))}
    </svg>
  );
}
