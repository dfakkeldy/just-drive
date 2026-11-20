// One home for the room cards. The phone keeps the same nodes in Settings.
const CSS = `
#mpCards{position:fixed;right:max(10px,env(safe-area-inset-right,0px));bottom:80px;z-index:6;
  width:min(332px,calc(100vw - 330px));max-height:calc(100dvh - 220px);overflow:auto;overscroll-behavior:contain;
  display:flex;flex-direction:column;gap:8px;scrollbar-gutter:stable}
#mpCards>*{flex:none;width:100%;box-sizing:border-box;margin:0}
#mpCards:empty{display:none}
#mpRoom{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}
#mpRoom>h3{margin:0;font:700 13px system-ui;color:var(--ink-dim,#b9c5cb)}
#mpRoom>*{flex:none;width:100%;box-sizing:border-box;margin:0}
:is(#mpCards,#mpRoom)>details{background:#102531ed;color:#fff;border:1px solid #70939e;border-radius:10px;padding:10px;font:13px/1.4 system-ui}
:is(#mpCards,#mpRoom)>details[hidden]{display:none}
:is(#mpCards,#mpRoom) summary{cursor:pointer}
#mpRoom>details>summary{min-height:56px;box-sizing:border-box;padding:16px 0}
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
      home.append(Object.assign(document.createElement('h3'), { textContent: 'Room' }));
      const header = settings.querySelector('#settingsHeader');
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
  const box = home.getBoundingClientRect();
  let top = 132, bottom = innerHeight - 10;
  const credit = document.getElementById('credit')?.getBoundingClientRect();
  if (credit?.height) bottom = Math.min(bottom, credit.top - 10);
  for (const id of ['hud','shiftHud','miniMap','radio','pauseButton','placesButton','gear','endShift','mpChip','gameResults','droneHints']) {
    const e = document.getElementById(id), b = e?.getBoundingClientRect();
    if (e && !e.hidden && b?.height && b.width && b.left < box.right && b.right > box.left) top = Math.max(top, b.bottom + 10);
  }
  home.style.bottom = `${innerHeight - bottom}px`;
  home.style.maxHeight = `${Math.max(0, bottom - top)}px`;
}
