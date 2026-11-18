// A shared pause and dialog frame. Endings keep their own text and camera choreography.
const KEY = 'mmm.endings';
export function foundEndings(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(saved) ? [...new Set(saved.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length < 80))].slice(0, 32) : [];
  } catch { return []; }
}
export interface EndingSpec { key: string; title: string; lines: readonly string[]; camera?: (seconds: number) => void }
interface Choice { label: string; action: () => void }
const CSS = `
#endingFrame{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;box-sizing:border-box;
 padding:max(12px,env(safe-area-inset-top,0px),var(--test-safe-top,0px)) max(12px,env(safe-area-inset-right,0px),var(--test-safe-right,0px)) max(12px,env(safe-area-inset-bottom,0px),var(--test-safe-bottom,0px)) max(12px,env(safe-area-inset-left,0px),var(--test-safe-left,0px));
 background:linear-gradient(transparent,rgba(8,14,20,.72));color:#eef2f6;font:16px/1.5 system-ui,sans-serif;touch-action:none;overscroll-behavior:contain}
body.hasEnding> :not(canvas):not(#endingFrame):not(style):not(script){visibility:hidden}
#endingFrame[data-ending="true"]{place-items:end end}
@media(min-width:800px){#endingFrame[data-ending="true"] #endingCard{margin:0 24px 24px 0}}
#endingFrame[hidden]{display:none}#endingCard{box-sizing:border-box;width:min(100%,480px);max-height:100%;overflow:auto;touch-action:pan-y;
 background:rgba(12,20,28,.96);border:1px solid #69747c;border-top:4px solid #d0632e;border-radius:10px;padding:24px;box-shadow:0 12px 80px #0008}
#endingCard h1{font-size:28px;line-height:1.12;margin:0 0 18px}#endingCard p{margin:8px 0;color:#cbd2d8}
#endingCard .endingTag{text-transform:uppercase;letter-spacing:.15em;font:700 11px monospace;color:#e5a16c;margin:0 0 12px}
#endingChoices{display:grid;gap:10px;margin-top:22px}#endingChoices button{min-height:56px;width:100%;border:1px solid #9ba6ae;border-radius:7px;
 background:#253440;color:#fff;font:700 16px system-ui,sans-serif;padding:12px;cursor:pointer}#endingChoices button:first-child{background:#ad4d23}
#endingChoices button:focus-visible{outline:3px solid #fff;outline-offset:2px}
@media(max-height:440px){#endingCard{padding:12px 16px}#endingCard h1{font-size:22px;margin-bottom:8px}#endingCard p{margin:3px 0;font-size:14px}#endingCard .endingTag{margin-bottom:5px}#endingChoices{margin-top:10px;grid-template-columns:repeat(2,minmax(0,1fr))}#endingChoices button:only-child{grid-column:1/-1}}
`;

export class Endings {
  readonly root = document.createElement('div');
  private move: EndingSpec['camera'];
  private seconds = 0;
  private restore: HTMLElement | null = null;
  private inert: { node: HTMLElement; was: boolean }[] = [];
  private ended = false;
  /** Optional control under the choices of every card (the replay button); outside #endingChoices on purpose. */
  extra: (() => HTMLElement | null) | null = null;
  constructor(private clearInput: () => void, private restart: () => void) {
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
    this.root.id = 'endingFrame'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'true'); this.root.setAttribute('aria-labelledby', 'endingTitle');
    document.body.appendChild(this.root);
    this.root.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.code !== 'Tab') return;
      const buttons = [...this.root.querySelectorAll('button')];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      ev.preventDefault(); buttons[(i + (ev.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
    });
    // The card owns new pointer input. The caller clears held pedals when it pauses.
    for (const event of ['pointerdown', 'pointerup', 'pointermove', 'click', 'wheel']) this.root.addEventListener(event, ev => ev.stopPropagation());
    document.addEventListener('focusin', ev => {
      if (this.busy && ev.target instanceof Node && !this.root.contains(ev.target)) this.root.querySelector('button')?.focus();
    });
  }
  get busy(): boolean { return !this.root.hidden; }
  get finished(): boolean { return this.ended; }
  offer(tag: string, title: string, lines: readonly string[], choices: readonly Choice[]): void {
    this.show(tag, title, lines, choices);
  }
  begin(spec: EndingSpec): void {
    const found = foundEndings();
    if (!found.includes(spec.key)) found.push(spec.key);
    try { localStorage.setItem(KEY, JSON.stringify(found.slice(0, 32))); } catch { /* The ending still works without storage. */ }
    this.ended = true; document.body.classList.add('hasEnding'); this.root.dataset.ending = 'true'; this.seconds = 0; this.move = spec.camera;
    this.show('A way out', spec.title, spec.lines, [{ label: 'Start over from day 1', action: () => {
      this.close(); this.ended = false; document.body.classList.remove('hasEnding'); delete this.root.dataset.ending; this.move = undefined; this.restart();
    } }]);
  }
  update(dt: number): void { if (this.finished) { this.seconds += dt; this.move?.(this.seconds); } }
  private show(tag: string, title: string, lines: readonly string[], choices: readonly Choice[]): void {
    if (!this.busy) {
      this.restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.inert = [...document.body.children].filter((n): n is HTMLElement => n instanceof HTMLElement && n !== this.root).map(node => ({ node, was: node.inert }));
      for (const { node } of this.inert) node.inert = true;
    }
    this.clearInput(); this.root.replaceChildren(); this.root.hidden = false;
    const card = document.createElement('div'); card.id = 'endingCard';
    const label = Object.assign(document.createElement('p'), { className: 'endingTag', textContent: tag });
    const heading = Object.assign(document.createElement('h1'), { id: 'endingTitle', textContent: title });
    card.append(label, heading);
    for (const line of lines) card.appendChild(Object.assign(document.createElement('p'), { textContent: line }));
    const buttons = document.createElement('div'); buttons.id = 'endingChoices';
    for (const choice of choices) {
      const button = Object.assign(document.createElement('button'), { textContent: choice.label, type: 'button' });
      button.addEventListener('click', () => choice.action()); buttons.appendChild(button);
    }
    card.appendChild(buttons);
    const extra = this.extra?.();
    if (extra) card.appendChild(extra);
    this.root.appendChild(card); buttons.querySelector('button')?.focus();
  }
  close(): void {
    this.root.hidden = true;
    // A hidden focused button can still receive the next key before layout runs. Release it explicitly.
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.root.contains(active)) active.blur();
    this.clearInput();
    for (const { node, was } of this.inert) node.inert = was;
    this.inert = [];
    if (this.restore?.isConnected && !this.root.contains(this.restore)) this.restore.focus();
    this.restore = null;
  }
}
