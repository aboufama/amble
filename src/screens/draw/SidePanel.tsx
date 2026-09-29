/**
 * The side panel (§2.10, 290 wide): the tool's options (the touch layout keeps them beside the tool),
 * Colour, Brush, Layers and the Flipbook row in a scrolling column, with the preview card pinned under
 * them so the drawing is always in view in its world.
 */
import type { PlayerHost } from '../../app/player/host';
import type { DeskController, DeskState } from '../../draw/deskController';
import type { DeskSetup } from '../../draw/load';
import type { Store } from '../../store/api';
import { BrushPanel } from './BrushPanel';
import { ColorPanel } from './ColorPanel';
import { FlipbookPanel } from './FlipbookPanel';
import { LayersPanel } from './LayersPanel';
import { PreviewCard } from './PreviewCard';
import { hasOptions, ToolOptions } from './ToolOptions';

export interface SidePanelProps {
  ctrl: DeskController;
  s: DeskState;
  setup: DeskSetup;
  player: PlayerHost;
  store: Store;
  /** Tool options live here (not in the touch layout's popover). */
  options: boolean;
  brought(): boolean;
  /** Opened to draw a move as a flipbook: the Flipbook comes into view. */
  flipFocus: boolean;
  /** Bring to life is running: the preview holds still, so the drawing reaches the world sooner. */
  bringing?: boolean;
}

export function SidePanel({ ctrl, s, setup, player, store, options, brought, flipFocus, bringing = false }: SidePanelProps) {
  return (
    <div className="side">
      <div className="side__scroll">
        {options && hasOptions(s.tool) && <ToolOptions ctrl={ctrl} s={s} />}
        <ColorPanel ctrl={ctrl} s={s} worldColors={setup.colors} />
        <BrushPanel ctrl={ctrl} s={s} pixel={setup.board.pixelArt} />
        <LayersPanel ctrl={ctrl} s={s} />
        <FlipbookPanel ctrl={ctrl} s={s} focus={flipFocus} />
      </div>
      <PreviewCard ctrl={ctrl} s={s} setup={setup} player={player} store={store} brought={brought} bringing={bringing} />
    </div>
  );
}
