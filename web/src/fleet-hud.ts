import type { Fleet } from './fleet';

/** One fixed action, with an explicit next-action thumb target; E uses it and Q changes the choice. */
export function fleetHud(fleet: Fleet, visible: () => boolean): () => void {
  const group = document.createElement('div'); group.id = 'fleetPrompt'; group.hidden = true;
  const button = document.createElement('button'); button.id = 'fleetAction'; button.type = 'button';
  const next = document.createElement('button'); next.id = 'fleetNext'; next.type = 'button'; next.textContent = '›'; next.setAttribute('aria-label', 'Next vehicle or trailer action');
  group.append(button, next); (document.getElementById('phoneHint') ?? document.body).append(group);
  document.head.append(Object.assign(document.createElement('style'), { textContent: `
    #fleetPrompt{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:6;display:flex;gap:4px;max-width:calc(100% - 16px)}
    #fleetPrompt[hidden],#fleetPrompt button[hidden]{display:none!important}
    #fleetPrompt button{font:700 12px/1.2 ui-monospace,monospace;color:#fff0d3;background:#222d25ed;border:1px solid #f4be79;border-radius:9px;min-height:44px;padding:8px 12px;touch-action:manipulation;pointer-events:auto}
    #fleetAction{min-width:0;overflow-wrap:anywhere}#fleetNext{min-width:44px;flex:none;font-size:24px!important}
    #fleetAction:disabled{color:#ffd9bd;border-color:#db9169;opacity:1}
    body.tcOn #fleetPrompt{position:static;transform:none;width:fit-content;max-width:100%;pointer-events:auto;margin:0}
    body.tcOn #fleetPrompt button{min-height:44px}
    body.tcOn #phoneHint:has(#fleetPrompt:not([hidden])) #placeArrival{display:none}
    body.tcOn.compactPhone:has(#fleetPrompt:not([hidden])) #phoneHint{overflow:visible;width:min(440px,100%)}
    @media(orientation:landscape){
      body.tcOn.compactPhone:has(#fleetPrompt:not([hidden])) #phoneHud{grid-template-rows:56px auto minmax(0,1fr) 72px var(--mail-pedal-height)}
    }
    @media(orientation:landscape) and (max-height:319px){
      body.tcOn.compactPhone:has(#fleetPrompt:not([hidden])) #phoneHud{grid-template-rows:56px auto minmax(0,1fr) 64px 60px}
    }
  ` }));
  button.addEventListener('click', () => { fleet.activate(); button.blur(); });
  next.addEventListener('click', () => { fleet.nextAction(); next.blur(); });
  for (const name of ['pointerdown', 'pointerup', 'pointermove', 'dblclick']) group.addEventListener(name, e => { e.stopPropagation(); if (name === 'dblclick') e.preventDefault(); });
  addEventListener('keydown', e => {
    if (!visible() || e.repeat || fleet.busy || (e.target instanceof Element && e.target.closest('input,select,textarea'))) return;
    if (e.code === 'KeyE') { e.preventDefault(); fleet.activate(); }
    if (e.code === 'KeyQ') { e.preventDefault(); fleet.nextAction(); }
  });
  return () => {
    if (visible() && !fleet.busy) fleet.refreshChoices();
    const a = fleet.action; group.hidden = !visible() || !a || fleet.busy;
    if (!a) return;
    button.disabled = !!a.reason;
    button.textContent = a.reason || (document.body.classList.contains('tcOn') ? a.label : `E · ${a.label}`);
    button.setAttribute('aria-label', a.reason || a.label);
    next.hidden = fleet.actions.length < 2; next.title = 'Q · Next action';
  };
}
