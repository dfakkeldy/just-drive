import { HALIFAX } from './light-study';

interface PictureOptions {
  canvas: HTMLCanvasElement;
  /** Draw to the canvas synchronously, including any final effects. */
  render: () => void;
  hide?: readonly ({ visible: boolean } | null | undefined)[];
  /** A public place label, such as the area's name. */
  place: string;
  touch: boolean;
  /** An optional transparent image, scaled to the rendered picture. */
  overlay?: CanvasImageSource;
}

function pictureName(place: string, now: Date): string {
  const slug = place.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: HALIFAX, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)!.value;
  return `just-drive-${slug || 'explore'}-${part('year')}-${part('month')}-${part('day')}-${part('hour')}${part('minute')}.png`;
}

/** Render and read one frame. Returns false when the player cancels sharing. */
export async function savePicture({ canvas, render, hide = [], place, touch, overlay }: PictureOptions): Promise<boolean> {
  const name = pictureName(place, new Date());
  const blob = await new Promise<Blob>((resolve, reject) => {
    // Leave objects that are already hidden alone. Restore before PNG encoding finishes.
    const shown = new Set(hide.filter((object): object is { visible: boolean } => !!object?.visible));
    for (const object of shown) object.visible = false;
    try {
      render();
      let picture = canvas;
      if (overlay) {
        picture = document.createElement('canvas');
        picture.width = canvas.width; picture.height = canvas.height;
        const context = picture.getContext('2d');
        if (!context) throw new Error('Picture canvas unavailable');
        context.drawImage(canvas, 0, 0);
        context.drawImage(overlay, 0, 0, picture.width, picture.height);
      }
      // Read the WebGL buffer now, before the browser can clear it for the next frame.
      picture.toBlob(image => image?.size ? resolve(image) : reject(new Error('No picture to save')), 'image/png');
    } finally {
      for (const object of shown) object.visible = true;
    }
  });
  if (touch && navigator.share && navigator.canShare) {
    const files = [new File([blob], name, { type: 'image/png' })];
    try {
      if (navigator.canShare({ files })) { await navigator.share({ files }); return true; }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return false;
      // Sharing can be denied if user activation expires while the PNG encodes.
    }
  }
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: name, hidden: true });
  try { document.body.append(link); link.click(); }
  finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return true;
}
