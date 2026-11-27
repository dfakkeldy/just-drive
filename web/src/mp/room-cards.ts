// One home for the room cards. The phone keeps the same nodes in Settings.
const CSS = `
body.tcOn #phoneTop #gear{position:relative}
#gearRoom,#gearUnread{position:absolute;pointer-events:none;box-sizing:border-box;border-radius:50%}
#gearRoom{top:2px;right:2px;width:18px;height:18px;background:#2a3a4a;border:1px solid #8a99a6;color:#eef2f6;font:700 12px/16px var(--mono);font-variant-numeric:tabular-nums;text-align:center}
#gearUnread{top:0;right:0;width:22px;height:22px;background:none;border:2px solid var(--settings-accent,var(--maple))}
#gearRoom[hidden]+#gearUnread{top:6px;right:6px;width:10px;height:10px;border:0;background:var(--settings-accent,var(--maple))}
#gearRoom[hidden],#gearUnread[hidden]{display:none}

#mpCards{position:fixed;right:max(10px,env(safe-area-inset-right,0px));bottom:80px;z-index:6;
  width:max(240px,min(332px,calc(100vw - 330px)));max-height:calc(100dvh - 220px);overflow:auto;overscroll-behavior:contain;
  display:flex;flex-direction:column;gap:8px;scrollbar-width:thin}
#mpCards>*{flex:none;width:100%;box-sizing:border-box;margin:0}
#mpCards:empty{display:none}
#mpRoom{display:flex;flex-direction:column;gap:0}
#mpRoom>*{flex:none;width:100%;box-sizing:border-box;margin:0}
#mpRoom>h3{margin:0 0 4px;font:700 13px system-ui;color:var(--ink-dim,#b9c5cb)}
#mpRoom>.roomCaption{margin:0 0 12px;color:var(--ink-dim);font:13px/1.4 system-ui}
:is(#mpCards,#mpRoom)>details{background:var(--panel-solid);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:10px;font:14px/1.4 system-ui}
:is(#mpCards,#mpRoom) :is(button,select){box-sizing:border-box;font:inherit;max-width:100%;min-height:44px;margin:4px 0;color:inherit;background:transparent;border:1px solid #6b7780;border-radius:6px;padding:6px 10px}
:is(#mpCards,#mpRoom) button{cursor:pointer}
:is(#mpCards,#mpRoom) :is(button,select):disabled{opacity:.45;cursor:not-allowed}
:is(#mpCards,#mpRoom) select{appearance:none;width:100%;padding-right:28px;background:var(--panel-solid) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='12'%3E%3Cpath d='m3 4 5 5 5-5' fill='none' stroke='%23b9c3cc'/%3E%3C/svg%3E") no-repeat right 8px center}
:is(#mpCards,#mpRoom) :is(button,select):focus-visible{outline:3px solid #fff;outline-offset:2px}
#mpSocial h4{font:700 13px system-ui;margin:12px 0 6px;color:var(--ink-dim)}
#mpRoster{list-style:none;padding:0;margin:0 0 12px}
#mpRoster li{display:flex;align-items:center;gap:8px;margin:4px 0}
#mpRoster i{width:8px;height:8px;flex:none;border-radius:50%}
#mpChatLog{font-size:13px;color:var(--ink-dim)}
#mpChatButton{width:100%;text-align:left}
#mpChatButton::after{content:'';float:right;width:12px;height:12px;margin-top:.25em;background:currentColor;clip-path:polygon(25% 8%,85% 50%,25% 92%);transition:transform .15s}
#mpChatButton[aria-expanded="true"]::after{transform:rotate(90deg)}
.roomCountdown{position:fixed;left:50%;top:calc(72px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:7;pointer-events:none;color:#ffca64;text-shadow:2px 0 #0b1620,-2px 0 #0b1620,0 2px #0b1620,0 -2px #0b1620;font:800 96px/1 var(--mono);font-variant-numeric:tabular-nums}
.roomCountdown[hidden]{display:none}
body.tcOn .roomCountdown{font-size:72px}
.roomCountdownSay{position:fixed;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
:is(#mpCards,#mpRoom)>details[hidden]{display:none}
:is(#mpCards,#mpRoom) summary{cursor:pointer}
#mpRoom>details{border:0;border-radius:0;border-top:1px solid var(--line);background:none;padding:0}
#mpRoom>details>summary{padding:0;align-content:center}
#mpCards>details{padding:0 10px}
#mpCards>details[open]{padding-bottom:10px}
#mpCards>details>summary{display:list-item;align-content:center;min-height:44px;box-sizing:border-box;font-weight:700}
:is(#racePanel,#gamePanel)>button+button{margin-left:8px}
#mpRoom :is(button,select){min-height:56px}
#racePanel>ol{padding-left:0;list-style-position:inside}
`;
const order = ['mpSocial', 'racePanel', 'gamePanel'];
export function mountRoomCard(card: HTMLElement, touch: boolean): void {
  const settings = touch ? document.getElementById('settings') : null;
  const id = settings ? 'mpRoom' : 'mpCards';
  let home = document.getElementById(id);
  if (!home) {
    if (!document.getElementById('mpCardsStyle')) document.head.append(Object.assign(document.createElement('style'), { id: 'mpCardsStyle', textContent: CSS }));
    home = Object.assign(document.createElement('section'), { id });
    home.setAttribute('aria-label', 'Room');
    if (settings) {
      home.append(Object.assign(document.createElement('h3'), { textContent: 'Room' }), Object.assign(document.createElement('p'), { className: 'roomCaption', textContent: 'A room keeps going when you pause.' }));
      // Below the header and the phone's END SHIFT, which stay at the top of the sheet.
      const header = settings.querySelector('#endShift.inPanel') ?? settings.querySelector('#settingsHeader');
      if (header) header.after(home); else settings.append(home);
    } else document.body.append(home);
  }
  const next = [...home.children].find(e => order.indexOf(e.id) > order.indexOf(card.id));
  home.insertBefore(card, next ?? null);
}
export function removeRoomCard(card: HTMLElement | null): void {
  const home = card?.parentElement; card?.remove();
  if (home && !home.querySelector('#mpSocial,#racePanel,#gamePanel')) home.remove();
}
/** Reserve real HUD and credit rectangles before the column can scroll under them. */
export function fitRoomCards(): void {
  const result = document.getElementById('gameResults');
  if (result && !result.hidden) {
    result.style.maxWidth = 'min(320px,70vw)'; result.style.top = 'calc(env(safe-area-inset-top,0px) + 58px)';
    const center = innerWidth / 2;
    for (const id of ['pauseButton','placesButton','gear','endShift']) {
      const b = document.getElementById(id)?.getBoundingClientRect(), r = result.getBoundingClientRect();
      if (!b?.width || !b.height || r.bottom <= b.top || r.top >= b.bottom) continue;
      if (b.left > center + 20) result.style.maxWidth = `${Math.min(r.width, (b.left - center - 10) * 2)}px`;
      else if (r.left < b.right && r.right > b.left) result.style.top = `${b.bottom + 10}px`;
    }
  }
  const home = document.getElementById('mpCards'); if (!home) return;
  // Start at the usual corner each time, so a hidden button releases its space.
  home.style.right = ''; home.style.width = '';
  const box = home.getBoundingClientRect();
  const credit = document.getElementById('credit')?.getBoundingClientRect();
  const topBlocks = ['hud','shiftHud','miniMap','radio','pauseButton','placesButton','bigMapButton','gear','endShift','mpChip','gameResults','droneHints','photoTag'];
  const bottomBlocks = ['mailButton','cameraButton','placeArrival','firedHud','mailCard','tripHud'];
  const visible = (id: string) => {
    const e = document.getElementById(id), b = e && !e.hidden && !e.classList.contains('inPanel') ? e.getBoundingClientRect() : null;
    return b?.width && b.height ? b : null;
  };
  const above = topBlocks.map(visible), below = bottomBlocks.map(visible);
  const bounds = (column: { left: number; right: number }) => {
    let top = 132, bottom = credit?.height ? Math.min(innerHeight - 10, credit.top - 10) : innerHeight - 10;
    for (const b of above) if (b && b.left < column.right && b.right > column.left) top = Math.max(top, b.bottom + 10);
    for (const b of below) if (b && b.left < column.right && b.right > column.left) bottom = Math.min(bottom, b.top - 10);
    return { top, bottom };
  };
  let { top, bottom } = bounds(box);
  if (bottom - top < 180) {
    const candidates = [...new Set(below.filter((b): b is DOMRect => !!b && b.left < box.right && b.right > box.left).map(b => b.left - 10))]
      .filter(r => r < box.right).sort((a, b) => b - a);
    for (const right of candidates) {
      // On a short desktop, shifting left of lower overlays (and narrowing if needed) clears both sides.
      for (const width of [box.width, Math.min(240, box.width)]) {
        if (right - width < 10) continue;
        const fit = bounds({ left: right - width, right });
        if (fit.bottom - fit.top <= bottom - top) continue;
        home.style.right = `${innerWidth - right}px`; home.style.width = `${width}px`;
        ({ top, bottom } = fit);
      }
      if (bottom - top >= 180) break;
    }
  }
  home.style.bottom = `${innerHeight - bottom}px`;
  home.style.maxHeight = `${Math.max(0, bottom - top)}px`;
}

/** One visual count and three spoken cues for either room start. */
export class RoomCountdown {
  private readonly node: HTMLElement | null;
  private readonly spoken: HTMLElement | null;
  constructor(id: string, bare: boolean) {
    this.node = bare ? null : Object.assign(document.createElement('div'), { id, className: 'roomCountdown', hidden: true });
    this.spoken = bare ? null : Object.assign(document.createElement('div'), { className: 'roomCountdownSay' });
    if (this.spoken) { this.spoken.setAttribute('role', 'status'); document.body.append(this.spoken); }
    if (this.node) { this.node.setAttribute('aria-hidden', 'true'); document.body.append(this.node); }
  }
  update(untilStart: number | null): string {
    const visible = untilStart !== null && untilStart > -1000;
    if (this.node) {
      if (this.node.hidden !== !visible) this.node.hidden = !visible;
      if (visible) {
        const count = untilStart! > 0 ? String(Math.min(5, Math.ceil(untilStart! / 1000))) : 'GO';
        if (this.node.textContent !== count) {
          this.node.textContent = count;
          const pill = document.getElementById('mpChip');
          const box = pill && !pill.hidden ? pill.getBoundingClientRect() : null;
          if (box?.height) { const top = `${box.bottom + 10}px`; if (this.node.style.top !== top) this.node.style.top = top; }
        }
      }
    }
    const cue = untilStart === null ? '' : untilStart > 3000 ? '5' : untilStart > 0 ? '3' : untilStart > -1000 ? 'GO' : '';
    const say = cue && cue !== 'GO' ? `Start in ${cue}` : cue;
    if (this.spoken && this.spoken.textContent !== say) this.spoken.textContent = say;
    return cue;
  }
  dispose(): void { this.node?.remove(); this.spoken?.remove(); }
}
