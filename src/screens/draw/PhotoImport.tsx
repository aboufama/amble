/**
 * A photo of a paper drawing (⋯ → Use a photo of my drawing, and the Trace tool; §2.10, §7.2): choose a
 * photo (on a Chromebook the picker also offers the camera). **Use my lines** takes the paper out on this
 * device and puts the lines on a new Lines layer; **Trace over it instead** puts the photo under the
 * drawing as a see-through reference that never goes in the game. Nothing leaves the device.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { DeskController } from '../../draw/deskController';
import { fitPhoto, removePaper } from '../../draw/photo';
import { t } from '../../i18n';
import { Button, Dialog } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { DeskIcon } from './DeskIcons';

type Step = 'choose' | 'chosen' | 'working' | 'failed';

async function paperRemoved(bmp: ImageBitmap, boardW: number, boardH: number): Promise<OffscreenCanvas> {
  const f = fitPhoto(bmp.width, bmp.height, boardW, boardH);
  const c = new OffscreenCanvas(f.w, f.h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas.');
  ctx.drawImage(bmp, 0, 0, f.w, f.h);
  const img = ctx.getImageData(0, 0, f.w, f.h);
  // Let the page paint "Taking out the paper…" before the work starts.
  await new Promise((r) => setTimeout(r, 30));
  img.data.set(removePaper(img.data, f.w, f.h));
  ctx.putImageData(img, 0, 0);
  return c;
}

export function PhotoImport({ open, onClose, ctrl, mode, onDone }: { open: boolean; onClose(): void; ctrl: DeskController; mode: 'lines' | 'trace'; onDone(text: string): void }) {
  const inputId = useId();
  const [step, setStep] = useState<Step>('choose');
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setStep('choose');
      setBitmap(null);
    }
  }, [open]);

  useEffect(() => {
    const c = preview.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !bitmap) return;
    const k = Math.min(c.width / bitmap.width, c.height / bitmap.height);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(bitmap, (c.width - bitmap.width * k) / 2, (c.height - bitmap.height * k) / 2, bitmap.width * k, bitmap.height * k);
  }, [bitmap, step]);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    try {
      setBitmap(await createImageBitmap(file));
      setStep('chosen');
    } catch {
      setStep('failed');
    }
  };

  const use = async (as: 'lines' | 'trace') => {
    if (!bitmap) return;
    setStep('working');
    try {
      const b = ctrl.board;
      const image = as === 'lines' ? await paperRemoved(bitmap, b.w, b.h) : bitmap;
      const id = await ctrl.surface.importTrace(image, as === 'lines' ? { role: 'lines', name: t('draw.layer_photoLines') } : { role: 'trace', name: t('draw.layer_trace') });
      if (!id) {
        setStep('chosen');
        return;
      }
      onDone(as === 'lines' ? t('draw.photoDone') : t('draw.photoTraceDone'));
      onClose();
    } catch {
      setStep('failed');
    }
  };

  const primary = mode === 'lines' ? 'lines' : 'trace';
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('draw.photoTitle')}
      className="photo"
      actions={
        step === 'chosen' || step === 'working' ? (
          <>
            <Button variant="ghost" onClick={() => void use(primary === 'lines' ? 'trace' : 'lines')} disabled={step === 'working'}>
              {primary === 'lines' ? t('draw.photoTraceIt') : t('draw.photoUseLines')}
            </Button>
            <Button variant="lantern" icon="check" onClick={() => void use(primary)} busy={step === 'working'} disabled={step === 'working'}>
              {primary === 'lines' ? t('draw.photoUseLines') : t('draw.tracePhoto')}
            </Button>
          </>
        ) : null
      }
    >
      <p>{t('draw.photoIntro')}</p>
      <p className="photo__privacy">
        <Icon name="lock" size={16} />
        <span>{t('draw.photoPrivacy')}</span>
      </p>
      {step === 'choose' || step === 'failed' ? (
        <>
          <button type="button" className="btn btn--paper btn--h58 photo__choose" onClick={() => fileRef.current?.click()}>
            <DeskIcon name="photo" size={24} />
            <span className="btn__label">{t('draw.photoChoose')}</span>
          </button>
          <input ref={fileRef} id={inputId} className="sr-only" type="file" accept="image/*" tabIndex={-1} aria-hidden="true" onChange={(e) => void choose(e.target.files?.[0])} data-testid="photo-file" />
          {step === 'failed' && (
            <p className="photo__error" role="alert">
              {t('draw.photoFailed')}
            </p>
          )}
        </>
      ) : (
        <div className="photo__preview">
          <canvas ref={preview} width={440} height={260} aria-hidden="true" />
          {step === 'working' && <p className="photo__working">{t('draw.photoWorking')}</p>}
        </div>
      )}
    </Dialog>
  );
}
