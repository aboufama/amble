import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { loadImage, trimTransparent } from '../project/images';
import type { ImageAsset } from '../project/types';
import {
  BrushIcon,
  BrushSizeIcon,
  BucketIcon,
  EllipseIcon,
  EraserIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  LineIcon,
  PickerIcon,
  RectIcon,
  RedoIcon,
  TextIcon,
  TrashIcon,
  UndoIcon,
  UploadIcon,
} from './icons';
import { pickFile } from '../project/importers';
import { fileToDataUrl } from '../project/images';

/** Backing canvas: 480 x 360 stage pixels at 2x. */
const W = 960;
const H = 720;

type Tool = 'brush' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill' | 'picker' | 'text';

const SWATCHES = ['#000000', '#ffffff', '#ff4d4d', '#ff9f1a', '#ffd93b', '#5ccb5f', '#2fb4ff', '#4c6fff', '#9b59ff', '#ff6fb5', '#8b5a2b', '#9aa0a6'];

const TOOLS: Array<{ id: Tool; label: string; icon: ReactElement }> = [
  { id: 'brush', label: 'Brush', icon: <BrushIcon size={22} /> },
  { id: 'line', label: 'Line', icon: <LineIcon size={22} /> },
  { id: 'ellipse', label: 'Circle', icon: <EllipseIcon size={22} /> },
  { id: 'rect', label: 'Rectangle', icon: <RectIcon size={22} /> },
  { id: 'text', label: 'Text', icon: <TextIcon size={22} /> },
  { id: 'fill', label: 'Fill', icon: <BucketIcon size={22} /> },
  { id: 'eraser', label: 'Eraser', icon: <EraserIcon size={22} /> },
  { id: 'picker', label: 'Pick color', icon: <PickerIcon size={22} /> },
];

function hexToRgba(hex: string): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

/** Hex color to Scratch's color, saturation and brightness (each 0-100). */
function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgba(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [(h / 360) * 100, max ? (d / max) * 100 : 0, max * 100];
}

function hsvToHex(h: number, s: number, v: number): string {
  const H = ((h / 100) * 360) % 360;
  const S = s / 100;
  const V = v / 100;
  const c = V * S;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = V - c;
  const [r, g, b] = H < 60 ? [c, x, 0] : H < 120 ? [x, c, 0] : H < 180 ? [0, c, x] : H < 240 ? [0, x, c] : H < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((n) => Math.round((n + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Scratch's color popover: Color, Saturation and Brightness sliders, a few swatches, and the eyedropper. */
function ColorPopover({ color, onChange, onPick, onClose }: { color: string; onChange(c: string): void; onPick(): void; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hsv, setHsv] = useState(() => hexToHsv(color));
  useEffect(() => {
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.('.color-button')) onClose();
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [onClose]);
  const set = (i: number, v: number) => {
    const next = [...hsv] as [number, number, number];
    next[i] = v;
    setHsv(next);
    onChange(hsvToHex(...next));
  };
  const [h, sat, v] = hsv;
  const hues = Array.from({ length: 7 }, (_, i) => hsvToHex((i / 6) * 100, Math.max(sat, 30), Math.max(v, 50))).join(', ');
  const sliders: Array<{ label: string; value: number; track: string }> = [
    { label: 'Color', value: h, track: `linear-gradient(to right, ${hues})` },
    { label: 'Saturation', value: sat, track: `linear-gradient(to right, ${hsvToHex(h, 0, v)}, ${hsvToHex(h, 100, v)})` },
    { label: 'Brightness', value: v, track: `linear-gradient(to right, #000, ${hsvToHex(h, sat, 100)})` },
  ];
  return (
    <div className="color-popover" ref={ref} role="dialog" aria-label="Fill color">
      {sliders.map((sl, i) => (
        <label key={sl.label} className="color-slider-row">
          <span className="color-slider-label">
            <span>{sl.label}</span>
            <span className="color-slider-value">{Math.round(sl.value)}</span>
          </span>
          <input type="range" className="color-slider" min={0} max={100} value={Math.round(sl.value)} style={{ background: sl.track }} onChange={(e) => set(i, Number(e.target.value))} />
        </label>
      ))}
      <div className="color-popover-footer">
        <div className="swatches">
          {SWATCHES.map((sw) => (
            <button
              key={sw}
              style={{ background: sw }}
              className={sw === color ? 'on' : ''}
              title={sw}
              aria-label={sw}
              onClick={() => {
                setHsv(hexToHsv(sw));
                onChange(sw);
              }}
            />
          ))}
        </div>
        <button className="eyedropper" title="Pick a color from the costume" aria-label="Pick a color from the costume" onClick={onPick}>
          <PickerIcon size={18} />
        </button>
      </div>
    </div>
  );
}

function floodFill(ctx: CanvasRenderingContext2D, x: number, y: number, color: [number, number, number, number]): void {
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const idx = (px: number, py: number) => (py * W + px) * 4;
  const start = idx(x, y);
  const target = [d[start], d[start + 1], d[start + 2], d[start + 3]];
  if (target.every((v, i) => Math.abs(v - color[i]) < 2)) return;
  const tol = 40;
  const matches = (i: number) =>
    Math.abs(d[i] - target[0]) <= tol && Math.abs(d[i + 1] - target[1]) <= tol && Math.abs(d[i + 2] - target[2]) <= tol && Math.abs(d[i + 3] - target[3]) <= tol;
  const stack: Array<[number, number]> = [[x, y]];
  const seen = new Uint8Array(W * H);
  while (stack.length) {
    const [sx, sy] = stack.pop()!;
    let lx = sx;
    while (lx > 0 && !seen[sy * W + lx - 1] && matches(idx(lx - 1, sy))) lx--;
    let rx = sx;
    while (rx < W - 1 && !seen[sy * W + rx + 1] && matches(idx(rx + 1, sy))) rx++;
    for (let px = lx; px <= rx; px++) {
      const i = idx(px, sy);
      seen[sy * W + px] = 1;
      d[i] = color[0];
      d[i + 1] = color[1];
      d[i + 2] = color[2];
      d[i + 3] = color[3];
      if (sy > 0 && !seen[(sy - 1) * W + px] && matches(idx(px, sy - 1))) stack.push([px, sy - 1]);
      if (sy < H - 1 && !seen[(sy + 1) * W + px] && matches(idx(px, sy + 1))) stack.push([px, sy + 1]);
    }
  }
  ctx.putImageData(img, 0, 0);
}

export interface PaintEditorProps {
  asset: ImageAsset;
  isBackdrop: boolean;
  /** The costume's name field, shown first in the top row like Scratch. */
  nameField?: ReactNode;
  onChange(patch: Pick<ImageAsset, 'dataUrl' | 'mime' | 'width' | 'height' | 'resolution' | 'centerX' | 'centerY'>): void;
}

/** A simple bitmap paint editor (costumes are saved trimmed, at 2x resolution, centered on the canvas center). */
export function PaintEditor({ asset, isBackdrop, nameField, onChange }: PaintEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState('#4c6fff');
  const [size, setSize] = useState(8);
  const [filled, setFilled] = useState(true);
  const [picker, setPicker] = useState(false);
  const undo = useRef<ImageData[]>([]);
  const redo = useRef<ImageData[]>([]);
  const [, force] = useState(0);
  const drag = useRef<{ x: number; y: number; lastX: number; lastY: number } | null>(null);
  const commitTimer = useRef<number | null>(null);

  const ctx = () => canvasRef.current!.getContext('2d', { willReadFrequently: true })!;

  // Load the costume into the canvas when a different costume is selected.
  useEffect(() => {
    undo.current = [];
    redo.current = [];
    const c = ctx();
    c.clearRect(0, 0, W, H);
    let cancelled = false;
    void loadImage(asset.dataUrl).then((img) => {
      if (cancelled) return;
      const scale = 2 / (asset.resolution || 1);
      if (isBackdrop) {
        c.drawImage(img, 0, 0, W, H);
      } else {
        c.drawImage(img, W / 2 - asset.centerX * scale, H / 2 - asset.centerY * scale, asset.width * scale, asset.height * scale);
      }
      force((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.id]);

  const commit = useCallback(() => {
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const full = canvas.toDataURL('image/png');
      if (isBackdrop) {
        onChange({ dataUrl: full, mime: 'image/png', width: W, height: H, resolution: 2, centerX: W / 2, centerY: H / 2 });
        return;
      }
      const t = await trimTransparent(full);
      if (t.width === W && t.height === H && t.offsetX === 0 && t.offsetY === 0 && isEmpty(canvas)) {
        onChange({ dataUrl: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>'), mime: 'image/svg+xml', width: 2, height: 2, resolution: 1, centerX: 1, centerY: 1 });
        return;
      }
      onChange({ dataUrl: t.dataUrl, mime: 'image/png', width: t.width, height: t.height, resolution: 2, centerX: W / 2 - t.offsetX, centerY: H / 2 - t.offsetY });
    }, 250);
  }, [isBackdrop, onChange]);

  const snapshot = () => {
    undo.current.push(ctx().getImageData(0, 0, W, H));
    if (undo.current.length > 25) undo.current.shift();
    redo.current = [];
    force((n) => n + 1);
  };

  const point = (e: React.PointerEvent) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: Math.round(((e.clientX - rect.left) / rect.width) * W), y: Math.round(((e.clientY - rect.top) / rect.height) * H) };
  };

  const stroke = (c: CanvasRenderingContext2D) => {
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = size * 2;
    c.lineCap = 'round';
    c.lineJoin = 'round';
  };

  const drawShape = (c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) => {
    stroke(c);
    c.beginPath();
    if (tool === 'line') {
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
    } else if (tool === 'rect') {
      c.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      if (filled) c.fill();
      else c.stroke();
    } else if (tool === 'ellipse') {
      c.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
      if (filled) c.fill();
      else c.stroke();
    }
  };

  const onDown = (e: React.PointerEvent) => {
    const p = point(e);
    const c = ctx();
    if (tool === 'picker') {
      const d = c.getImageData(p.x, p.y, 1, 1).data;
      if (d[3] > 0) setColor(`#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
      setTool('brush');
      return;
    }
    snapshot();
    if (tool === 'fill') {
      floodFill(c, p.x, p.y, hexToRgba(color));
      commit();
      return;
    }
    if (tool === 'text') {
      const text = window.prompt('Text to draw:');
      if (text) {
        c.fillStyle = color;
        c.font = `bold ${Math.max(12, size * 5)}px "Trebuchet MS", sans-serif`;
        c.textBaseline = 'middle';
        c.fillText(text, p.x, p.y);
        commit();
      } else {
        undo.current.pop();
      }
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: p.x, y: p.y, lastX: p.x, lastY: p.y };
    if (tool === 'brush' || tool === 'eraser') {
      c.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
      stroke(c);
      c.beginPath();
      c.moveTo(p.x, p.y);
      c.lineTo(p.x + 0.01, p.y);
      c.stroke();
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    if (tool === 'brush' || tool === 'eraser') {
      const c = ctx();
      stroke(c);
      c.beginPath();
      c.moveTo(d.lastX, d.lastY);
      c.lineTo(p.x, p.y);
      c.stroke();
      d.lastX = p.x;
      d.lastY = p.y;
    } else {
      const o = overlayRef.current!.getContext('2d')!;
      o.clearRect(0, 0, W, H);
      drawShape(o, d.x, d.y, p.x, p.y);
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const c = ctx();
    if (tool !== 'brush' && tool !== 'eraser') {
      overlayRef.current!.getContext('2d')!.clearRect(0, 0, W, H);
      const p = point(e);
      drawShape(c, d.x, d.y, p.x, p.y);
    }
    c.globalCompositeOperation = 'source-over';
    commit();
  };

  const doUndo = () => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(ctx().getImageData(0, 0, W, H));
    ctx().putImageData(prev, 0, 0);
    commit();
    force((n) => n + 1);
  };
  const doRedo = () => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(ctx().getImageData(0, 0, W, H));
    ctx().putImageData(next, 0, 0);
    commit();
    force((n) => n + 1);
  };
  const clear = () => {
    snapshot();
    ctx().clearRect(0, 0, W, H);
    commit();
  };
  const flip = (horizontal: boolean) => {
    snapshot();
    const c = ctx();
    const copy = document.createElement('canvas');
    copy.width = W;
    copy.height = H;
    copy.getContext('2d')!.drawImage(canvasRef.current!, 0, 0);
    c.save();
    c.clearRect(0, 0, W, H);
    c.translate(horizontal ? W : 0, horizontal ? 0 : H);
    c.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
    c.drawImage(copy, 0, 0);
    c.restore();
    commit();
  };
  const importImage = async () => {
    const files = await pickFile('image/*');
    if (!files.length) return;
    const img = await loadImage(await fileToDataUrl(files[0]));
    snapshot();
    const scale = Math.min(1, (W * 0.9) / img.naturalWidth, (H * 0.9) / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx().drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    commit();
  };

  return (
    <div className="paint-editor">
      <div className="editor-row">
        {nameField}
        <div className="button-group">
          <button className="group-button" title="Undo" aria-label="Undo" onClick={doUndo} disabled={!undo.current.length}>
            <UndoIcon size={18} strokeWidth={2.6} />
          </button>
          <button className="group-button" title="Redo" aria-label="Redo" onClick={doRedo} disabled={!redo.current.length}>
            <RedoIcon size={18} strokeWidth={2.6} />
          </button>
        </div>
        <div className="tool-group">
          <button className="tool-button" title="Import an image into this costume" onClick={() => void importImage()}>
            <UploadIcon size={20} strokeWidth={2.4} />
            <span>Import</span>
          </button>
          <button className="tool-button" onClick={clear}>
            <TrashIcon size={20} strokeWidth={2.4} />
            <span>Clear</span>
          </button>
        </div>
        <div className="tool-group">
          <button className="tool-button" onClick={() => flip(true)}>
            <FlipHorizontalIcon size={22} />
            <span>Flip Horizontal</span>
          </button>
          <button className="tool-button" onClick={() => flip(false)}>
            <FlipVerticalIcon size={22} />
            <span>Flip Vertical</span>
          </button>
        </div>
      </div>
      <div className="editor-row paint-mode-row">
        <div className="info-group color-field">
          <span className="info-label">Fill</span>
          <button className="color-button" aria-label="Fill color" aria-expanded={picker} onClick={() => setPicker((o) => !o)}>
            <span className="color-swatch" style={{ background: color }} />
            <span className="color-caret" aria-hidden="true" />
          </button>
          {picker && (
            <ColorPopover
              color={color}
              onChange={setColor}
              onClose={() => setPicker(false)}
              onPick={() => {
                setTool('picker');
                setPicker(false);
              }}
            />
          )}
        </div>
        <label className="info-group brush-size" title="Brush size">
          <BrushSizeIcon size={22} />
          <input
            className="info-input small"
            type="number"
            min={1}
            max={100}
            value={size}
            aria-label="Brush size"
            onChange={(e) => setSize(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
          />
        </label>
        {(tool === 'rect' || tool === 'ellipse') && (
          <div className="toggle-buttons" role="group" aria-label="Shape">
            <button aria-pressed={filled} onClick={() => setFilled(true)}>
              Filled
            </button>
            <button aria-pressed={!filled} onClick={() => setFilled(false)}>
              Outlined
            </button>
          </div>
        )}
      </div>
      <div className="paint-main">
        <div className="paint-tools" role="toolbar" aria-label="Paint tools">
          {TOOLS.map((t) => (
            <button key={t.id} className={`paint-tool ${tool === t.id ? 'active' : ''}`} title={t.label} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}>
              {t.icon}
            </button>
          ))}
        </div>
        <div className="paint-canvas-area">
          <div className="paint-canvas">
            <canvas ref={canvasRef} width={W} height={H} />
            <canvas
              ref={overlayRef}
              width={W}
              height={H}
              className={`overlay tool-${tool}`}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            />
            {!isBackdrop && <div className="center-mark" title="Rotation center" />}
          </div>
          {asset.mime === 'image/svg+xml' && asset.width > 2 && <p className="paint-note">Vector costume: painting on it turns it into a bitmap.</p>}
        </div>
      </div>
    </div>
  );
}

function isEmpty(canvas: HTMLCanvasElement): boolean {
  const d = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return false;
  return true;
}
