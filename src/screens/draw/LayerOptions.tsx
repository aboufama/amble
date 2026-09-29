/**
 * The selected layer's options (⋯ in Layers, §7.3): see-through (opacity), Plain or Shading (the engine's
 * normal and multiply blends), Lock, Paint inside what is there (alpha lock), and Show or Hide, Move up,
 * Move down, Copy, Join with the layer below, Rename and Delete. All undoable. Up and down are the
 * layers' dragging alternative (WCAG 2.5.7).
 */
import { useRef, useState } from 'react';
import type { LayerInfo } from '../../cores/art';
import type { DeskController } from '../../draw/deskController';
import { t } from '../../i18n';
import { Popover, Segmented, Slider, Toggle } from '../../ui/components';
import { askUser } from '../../ui/dialogs';
import { Icon } from '../../ui/icons';

export function LayerOptions({ ctrl, layer, name, first, last, count }: { ctrl: DeskController; layer: LayerInfo; name: string; first: boolean; last: boolean; count: number }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const label = t('draw.layerMenu', { layer: name });

  const rename = () => {
    setOpen(false);
    void askUser({ title: t('draw.renamePrompt'), label: t('draw.renamePrompt'), value: name, maxLength: 40 }).then((next) => {
      if (next?.trim()) ctrl.renameLayer(layer.id, next);
    });
  };

  return (
    <>
      <button ref={button} type="button" className="btn btn--quiet btn--h38 btn--icon" aria-label={label} title={label} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        <Icon name="more" size={22} />
      </button>
      <Popover open={open} anchor={button.current} onClose={() => setOpen(false)} label={label} placement="left" className="desk-popover layer-opts">
        <p className="layer-opts__title">{name}</p>
        <Slider className="brush__slider" label={t('draw.opacity')} min={0} max={100} value={Math.round(layer.opacity * 100)} format={(v) => t('draw.opacityValue', { n: v })} onChange={(v) => ctrl.setLayerProps(layer.id, { opacity: v / 100 })} />
        <Segmented
          label={t('draw.blend')}
          size={38}
          value={layer.blend === 'multiply' ? 'multiply' : 'normal'}
          onChange={(blend) => ctrl.setLayerProps(layer.id, { blend })}
          options={[
            { value: 'normal', label: t('draw.blend_normal') },
            { value: 'multiply', label: t('draw.blend_multiply') },
          ]}
        />
        <Toggle label={t('draw.lockLayer')} checked={layer.locked} onChange={(locked) => ctrl.setLayerProps(layer.id, { locked })} />
        <Toggle label={t('draw.alphaLock')} hint={t('draw.alphaLockHint')} checked={layer.alphaLock} onChange={(alphaLock) => ctrl.setLayerProps(layer.id, { alphaLock })} />
        <div className="layer-opts__row">
          <button type="button" className="btn btn--ghost btn--h38" onClick={() => ctrl.setLayerVisible(layer.id, !layer.visible)}>
            <Icon name={layer.visible ? 'eyeOff' : 'eye'} size={18} />
            <span className="btn__label">{layer.visible ? t('draw.hide') : t('draw.show')}</span>
          </button>
          <button type="button" className="btn btn--ghost btn--h38" onClick={() => ctrl.moveLayer(layer.id, 1)} disabled={last}>
            <span className="btn__label">{t('draw.moveUp')}</span>
          </button>
          <button type="button" className="btn btn--ghost btn--h38" onClick={() => ctrl.moveLayer(layer.id, -1)} disabled={first}>
            <span className="btn__label">{t('draw.moveDown')}</span>
          </button>
          <button type="button" className="btn btn--ghost btn--h38" onClick={() => ctrl.duplicateLayer(layer.id)}>
            <span className="btn__label">{t('draw.copyLayer')}</span>
          </button>
          <button type="button" className="btn btn--ghost btn--h38" onClick={() => void ctrl.mergeDown(layer.id)} disabled={first}>
            <span className="btn__label">{t('draw.joinDown')}</span>
          </button>
          <button type="button" className="btn btn--ghost btn--h38" onClick={rename}>
            <span className="btn__label">{t('draw.renameLayer')}</span>
          </button>
          <button
            type="button"
            className="btn btn--danger btn--h38"
            disabled={count <= 1}
            onClick={() => {
              setOpen(false);
              ctrl.removeLayer(layer.id);
            }}
          >
            <span className="btn__label">{t('draw.deleteLayer')}</span>
          </button>
        </div>
      </Popover>
    </>
  );
}
