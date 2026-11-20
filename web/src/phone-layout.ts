import { installPhoneControls } from './phone-controls-layout';
// One HUD frame owns the phone's edges; controls use the available-space planner.
// Built here so the dev page and the published page use the same layout.
const CSS = `
#phoneHud{position:fixed;z-index:5;inset:0;box-sizing:border-box;pointer-events:none;display:none;
  --safe-top:var(--test-safe-top,env(safe-area-inset-top,0px));--safe-right:var(--test-safe-right,env(safe-area-inset-right,0px));
  --safe-bottom:var(--test-safe-bottom,env(safe-area-inset-bottom,0px));--safe-left:var(--test-safe-left,env(safe-area-inset-left,0px));
  padding:calc(var(--phone-top-gap,6px) + var(--safe-top)) calc(8px + var(--safe-right)) calc(8px + var(--safe-bottom)) calc(8px + var(--safe-left));
  grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto minmax(0,1fr) auto auto;gap:6px}
body.tcOn{--phone-top-gap:6px;color:var(--ink);font:13px/1.4 var(--mono)}
body.tcOn #phoneHud{display:grid}
#phoneHud .phoneFlow{pointer-events:none;min-width:0;min-height:0}
#phoneTop{grid-area:1/1/2/3;display:flex;align-items:start;gap:6px}
#phoneStatus{flex:1;max-width:440px;display:flex;flex-direction:column;gap:3px}
#phoneTop #gear{margin-left:auto}
#phoneHint{grid-area:2/1/3/3}
#phoneMiddle{grid-area:3/1/4/3;display:flex;justify-content:space-between;gap:6px}
#phoneReadouts{display:grid;grid-template-columns:minmax(58px,.85fr) minmax(0,1fr);grid-template-rows:auto auto auto;
  align-content:start;align-items:start;gap:4px;flex:1;max-width:360px;container-type:size;overflow:hidden}
/* The fixed fly readouts need the viewport when the driving grid is hidden. */
body:not(.tcOn) #phoneReadouts{container-type:normal}
#phoneActions{display:flex;flex-direction:column;gap:6px;align-items:center}
#phoneAux{grid-area:4/1/5/3;display:flex;gap:6px;align-items:end}
#phoneDrive{grid-area:5/1/6/3;display:grid;grid-template-columns:minmax(56px,1fr) auto auto;align-items:end;gap:8px}
/* Shared layout owns placement; the portrait writer overrides these defaults with measured rectangles. */
body.tcOn :is(#hud,#shiftHud,#stopHint,#miniMap,#relief,#radio,#photoTag,#gear,#cameraButton,#mailButton,.tc){
  position:static;inset:auto;box-sizing:border-box;transform:none;max-width:100%;margin:0}
#phoneHud :is(#gear,#cameraButton,#mailButton,.tcSmall,#tcSteer,.tcPedal,#miniMap,#relief,#radio){pointer-events:auto}
body.tcOn :is(#hud,#shiftHud,#stopHint,#photoTag){pointer-events:none}
body.tcOn #hud{font-size:10px;line-height:14px;padding:3px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body.tcOn #shiftHud{font-size:10px;line-height:15px;padding:3px 6px;white-space:pre;overflow:hidden;text-overflow:ellipsis}
body.tcOn #gear{flex:none;width:56px;height:56px}
body.tcOn #stopHint{font-size:11px;line-height:15px;padding:3px 6px;white-space:pre-line;overflow-wrap:anywhere;width:fit-content}
body.tcOn #stopHint:empty{display:none}
/* Full credits stay in the title/settings card; the bottom edge belongs to thumbs. */
body.tcOn #mailScore,body.tcOn #credit{display:none}
body.tcOn #miniMap{grid-area:1/1/4/2;justify-self:start;width:min(124px,100%,max(58px,calc(100cqh - 58px)))}
body.tcOn #miniMapHead{min-height:56px;padding:0 5px;gap:3px;flex-wrap:wrap;text-align:left}
body.tcOn #miniMapHead span{font-size:9px;letter-spacing:0}
body.tcOn #miniMapCanvas{width:100%!important;height:auto!important;aspect-ratio:1;max-height:max(0px,calc(100cqh - 58px));object-fit:contain}
body.tcOn #miniMap.folded{width:58px}
body.tcOn #relief{grid-area:1/2;min-width:0;min-height:56px;gap:4px;padding:0 5px;flex-wrap:wrap;align-content:center;letter-spacing:0}
body.tcOn #relief i{width:40px;flex:0 1 40px}
body.tcOn #relief.ready span{font-size:0}
body.tcOn #relief.ready span::after{content:'STEP OUT';font-size:10.5px}
body.tcOn #radio{grid-area:2/2;min-width:0;min-height:56px;width:100%;max-width:100%;padding:4px 5px;gap:3px;flex-wrap:wrap;align-content:center;letter-spacing:0}
body.tcOn #radio b,body.tcOn #radio span{max-width:100%;min-width:0}
/* The readouts are cut at their container's edge, so the focus ring is drawn inside, as the map's is. */
body.tcOn #radio:focus-visible{outline-offset:-2px}
body.tcOn #photoTag{grid-area:3/2;padding:4px;width:100%;min-width:0}
body.tcOn #photoThumb{display:none}
body.tcOn #photoCaption{min-height:0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;font-size:10px;line-height:13px}
body.tcOn #cameraButton{width:64px;height:56px}
body.tcOn #mailButton{width:68px;height:68px}
body.tcOn .tcSmall{width:56px;height:56px;min-height:56px}
body.tcOn #tcSteer{width:100%;max-width:280px;height:84px;touch-action:none}
body.tcOn #tcTrack{position:relative;inset:auto;width:100%;height:100%;box-sizing:border-box;pointer-events:none}
body.tcOn #tcKnob{width:52px;height:52px;margin:-26px 0 0 -26px}
body.tcOn #tcGo,body.tcOn #tcBrake{width:76px;height:84px}
body.tcOn #tcGo{height:100px}
#settings{z-index:8;box-sizing:border-box;
  overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y}
body.tcOn #settings{top:calc(62px + var(--phone-top-gap,6px) + var(--test-safe-top,env(safe-area-inset-top,0px)));
  right:calc(8px + var(--test-safe-right,env(safe-area-inset-right,0px)));min-width:0;width:min(300px,calc(100% - 16px - var(--test-safe-left,env(safe-area-inset-left,0px)) - var(--test-safe-right,env(safe-area-inset-right,0px))));
}
/* The credits button has an inline desktop height. The phone keeps a full touch target. */
#settings button{min-height:56px!important}
#endShift.inPanel{position:static;width:100%;margin:0 0 12px}
/* Sideways, one top row holds the four utility buttons. The map gives height back to the road. */
@media(orientation:landscape){
  #phoneHud{grid-template-rows:auto auto minmax(0,1fr) auto}
  #phoneTop{grid-area:1/1/2/2}#phoneAux{grid-area:1/2/2/3;align-items:start}
  #phoneDrive{grid-area:4/1/5/3}
  #phoneReadouts{max-width:500px;grid-template-columns:minmax(58px,.7fr) minmax(0,1fr) minmax(0,1fr);grid-template-rows:auto auto}
  #phoneActions{flex-direction:row;align-items:start}
  body.tcOn #miniMap{grid-area:1/1/3/2;width:min(96px,100%,max(58px,calc(100cqh - 58px)))}
  body.tcOn #miniMap.folded{width:58px}
  body.tcOn #relief{grid-area:1/2}body.tcOn #radio{grid-area:1/3}
  body.tcOn #radio:not(.lost):not(.weak):not(.call) span{display:none!important}
  body.tcOn #radio b{white-space:normal;overflow-wrap:anywhere}
  body.tcOn #photoTag{grid-area:2/2/3/4}
  body.tcOn #photoCaption{-webkit-line-clamp:2}
  body.tcOn #tcGo,body.tcOn #tcBrake,body.tcOn #tcSteer{height:72px}
}
/* The middle row takes what the other rows leave (minmax(0,1fr)), so on a very short screen its readouts would
   run over the row below: a grid does not stop that by itself. Under the shortest size that fits in full, the
   rows get thinner: one line of hint and of photo note, lower pedals. The floor is about 568x265 sideways and
   320x460 upright (a 4-inch phone in a browser with its bars). Under the floor the readouts are cut at their own
   edge (overflow:hidden above), never drawn over the driving controls. */
@media(orientation:landscape) and (max-height:319px){
  #phoneHud{row-gap:4px}
  body.tcOn #stopHint{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:auto}
  body.tcOn #photoCaption{-webkit-line-clamp:1}
  body.tcOn #tcGo,body.tcOn #tcBrake,body.tcOn #tcSteer{height:60px}
  body.tcOn #mailButton{width:64px;height:64px}
}
@media(orientation:portrait) and (max-height:520px){
  body.tcOn #photoCaption{-webkit-line-clamp:1}
  body.tcOn #tcGo{height:84px}
}
/* Both brands keep readouts at the edge and share one compact utility/action row. */
#phoneLine{display:none}
#raceReadout,#gameReadout{display:none;pointer-events:none;order:1;flex:none;min-width:0;max-width:100%;
  box-sizing:border-box;font-size:10px;line-height:18px;padding:2px 5px;
  background:var(--panel);border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body.tcOn :is(#raceReadout,#gameReadout):not([hidden]){display:block}
body.tcOn.compactPhone #phoneLine{display:block;font-size:10px;line-height:18px;padding:2px 5px;
  background:var(--panel);border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body.tcOn.mailPhone :is(#hud,#shiftHud){display:none}
body.tcOn.mailPhone.introDone #stopHint.intro{display:none}
body.tcOn.compactPhone #phoneHud{grid-template-rows:auto auto minmax(0,1fr) auto auto}
body.tcOn.compactPhone #phoneActions{grid-area:4/1/5/3;flex-direction:row;justify-self:end;align-items:end}
body.tcOn.compactPhone #phoneDrive{grid-area:5/1/6/3}
body.tcOn.compactPhone #phoneAux{width:fit-content;align-self:end}
body.tcOn.compactPhone #phoneStatus{max-height:56px;overflow:hidden}
body.tcOn.compactPhone #placeArrival{overflow-wrap:anywhere}
body.tcOn.compactPhone #phoneHint{width:min(22vw,calc(25vw - 12px - var(--safe-left)))}
body.tcOn.compactPhone #phoneReadouts{flex:none;width:min(22vw,calc(25vw - 12px - var(--safe-left)));max-width:190px;
  grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto auto auto;overflow:auto;touch-action:pan-y;pointer-events:auto}
body.tcOn.compactPhone #miniMap{grid-area:1/1;width:min(78px,100%)}
body.tcOn.compactPhone #miniMap.folded{width:58px}
body.tcOn.compactPhone #miniMapCanvas{max-height:none}
body.tcOn.compactPhone #relief{grid-area:2/1}
body.tcOn.compactPhone #radio{grid-area:3/1}
body.tcOn.compactPhone #photoTag{grid-area:4/1}
@media(orientation:portrait) and (max-width:343px){
  body.tcOn.compactPhone #phoneHud{grid-template-rows:auto auto minmax(0,1fr) auto auto auto}
  body.tcOn.compactPhone #phoneActions{grid-area:5/1/6/3}
  body.tcOn.compactPhone #phoneDrive{grid-area:6/1/7/3}
}
body.tcOn.compactPhone #relief,body.tcOn.compactPhone #radio{font-size:10px}
body.tcOn.compactPhone #radio:not(.expanded) span{display:none}
body.tcOn.compactPhone #radio{height:56px;overflow:hidden;flex-direction:column;align-items:flex-start;justify-content:center;flex-wrap:nowrap;gap:2px}
body.tcOn.compactPhone #radio b{display:block;-webkit-line-clamp:unset}
body.tcOn.compactPhone #radio b,body.tcOn.compactPhone #radio span{flex:none;width:100%;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:14px}
/* A call: the readout gives its two lines (four, smaller) to the call line, so the player's name is never cut short,
   down to a 360px-wide phone: "Caller about:" takes at most two lines, a name of up to 14 letters at most two. */
body.tcOn.compactPhone #radio.call b{display:none}
body.tcOn.compactPhone #radio.call span{display:block;white-space:normal;overflow-wrap:anywhere;text-overflow:clip;font-size:8px;line-height:11px;max-height:44px}
body.tcOn.compactPhone #mailButton{width:72px;height:72px}
body.tcOn.compactPhone #cameraButton{width:64px;height:64px}
@media(orientation:landscape){
  body.tcOn.compactPhone #phoneHud{--mail-pedal-height:min(72px,max(56px,calc(22vh - 8px - var(--safe-bottom))));
    grid-template-rows:56px 14px minmax(0,1fr) 72px var(--mail-pedal-height)}
  body.tcOn.compactPhone #phoneTop{grid-area:1/1/2/2;align-items:start}
  body.tcOn.compactPhone #phoneStatus{max-width:none;max-height:56px;overflow:hidden}
  body.tcOn.compactPhone #phoneAux{width:180px;height:56px}
  body.tcOn.compactPhone #phoneHint{grid-area:2/1/3/3;overflow:hidden;width:min(22vw,calc(25vw - 12px - var(--safe-left)))}
  body.tcOn.compactPhone #stopHint{font-size:10px;line-height:14px;padding:0 4px;white-space:nowrap;width:fit-content;max-width:100%;overflow:hidden;text-overflow:ellipsis}
  body.tcOn.compactPhone #phoneMiddle{grid-area:3/1/5/3;align-items:start}
  body.tcOn.compactPhone #phoneReadouts{flex:none;width:min(22vw,calc(25vw - 12px - var(--safe-left)));max-width:190px;height:100%;
    grid-template-columns:minmax(58px,.8fr) minmax(0,1fr);grid-template-rows:minmax(56px,auto) minmax(56px,auto) auto}
  body.tcOn.compactPhone #miniMap{width:min(78px,100%);grid-area:1/1/3/2}
  body.tcOn.compactPhone #miniMap.folded{width:58px}
  body.tcOn.compactPhone #miniMapCanvas{max-height:none}
  body.tcOn.compactPhone #relief{grid-area:1/2}
  body.tcOn.compactPhone #radio{grid-area:2/2}
  body.tcOn.compactPhone #photoTag{grid-area:3/1/4/3}
  body.tcOn.compactPhone #phoneActions{grid-area:4/2/5/3}
  body.tcOn.compactPhone #phoneDrive{grid-area:5/1/6/3}
  body.tcOn.compactPhone #tcSteer{max-width:22vw}
  body.tcOn.compactPhone #tcGo,body.tcOn.compactPhone #tcBrake,body.tcOn.compactPhone #tcSteer,body.tcOn.compactPhone.bikeMode #tcPull{height:var(--mail-pedal-height)}
}
@media(orientation:landscape) and (max-height:319px){
  body.tcOn.compactPhone #phoneHud{grid-template-rows:56px 14px minmax(0,1fr) 64px 60px}
  body.tcOn.compactPhone #mailButton{width:64px;height:64px}
  body.tcOn.compactPhone #tcGo,body.tcOn.compactPhone #tcBrake,body.tcOn.compactPhone #tcSteer,body.tcOn.compactPhone.bikeMode #tcPull{height:60px}
}

@media(orientation:portrait) and (max-height:700px){
  body.tcOn.compactPhone #photoCaption{-webkit-line-clamp:1}
}
/* iOS Home Screen content gets extra clearance below the status-bar blur band. */
@media(display-mode:standalone){body.tcOn{--phone-top-gap:16px}}
body.tcOn.homeScreen{--phone-top-gap:16px}
/* Very short landscape headers stay above the protected band. */
@media(orientation:landscape){body.tcOn{--phone-top-gap:min(6px,max(0px,calc(22vh - 56px)))}}
@media(orientation:landscape) and (display-mode:standalone){body.tcOn{--phone-top-gap:min(16px,max(0px,calc(22vh - 56px)))}}
@media(orientation:landscape){body.tcOn.homeScreen{--phone-top-gap:min(16px,max(0px,calc(22vh - 56px)))}}
body.tcOn #settings #phoneReadouts{container-type:normal;display:flex;flex-direction:column;width:100%;max-width:none;height:auto;max-height:none;overflow:visible;gap:8px;padding:8px 0}
body.tcOn #settings #miniMap{width:min(225px,100%)}
body.tcOn #settings #miniMapCanvas{touch-action:pan-y}
body.tcOn #settings #stopHint{width:100%;max-width:none;white-space:pre-line;font-size:11px;line-height:15px;padding:3px 6px}
body.tcOn #settings #photoCaption{-webkit-line-clamp:unset}
body.tcOn #settings #placeArrival{height:auto;max-height:none;white-space:normal;font-size:11px;line-height:15px;padding:6px 8px}
@media(orientation:landscape){body.tcOn.compactPhone #placeArrival{height:14px;max-height:14px;min-height:0;padding:0 4px;border:0;overflow:hidden;white-space:nowrap;font-size:10px;line-height:14px}}
body.tcOn #settings :is(#radio,#relief,#photoTag){width:100%;max-width:none}
@media(orientation:landscape){body.tcOn #radio:not(.lost):not(.weak):not(.call) span{display:none!important}body.tcOn #radio b,body.tcOn.compactPhone #radio b{display:block!important;white-space:normal;overflow-wrap:anywhere}}
#phoneReadoutsPanel[hidden]{display:none}
`;

/** A radio can arrive after the rest of the HUD, once its song list has loaded. */
export function placePhoneReadout(el: HTMLElement): void {
  (document.getElementById('phoneReadouts') ?? document.body).appendChild(el);
}

export function createPhoneLayout(): void {
  document.body.classList.add('compactPhone');
  const standalone = matchMedia('(display-mode: standalone)');
  const syncHomeScreen = () => document.body.classList.toggle('homeScreen', standalone.matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);
  syncHomeScreen();
  standalone.addEventListener('change', syncHomeScreen);
  addEventListener('pageshow', syncHomeScreen);
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
  const root = document.createElement('div');
  root.id = 'phoneHud';
  root.innerHTML = `<div id="phoneTop" class="phoneFlow"><div id="phoneStatus" class="phoneFlow"></div></div>
    <div id="phoneHint" class="phoneFlow"></div>
    <div id="phoneMiddle" class="phoneFlow"><div id="phoneReadouts" class="phoneFlow"></div></div>
    <div id="phoneActions" class="phoneFlow"></div>
    <div id="phoneAux" class="phoneFlow"></div><div id="phoneDrive" class="phoneFlow"></div>`;
  document.body.appendChild(root);
  const groups: Record<string, string[]> = {
    phoneStatus: ['hud', 'shiftHud'], phoneTop: ['gear'], phoneHint: ['stopHint'],
    phoneReadouts: ['miniMap', 'relief', 'radio', 'photoTag'], phoneActions: ['cameraButton', 'mailButton'],
    phoneAux: ['tcReset', 'tcView', 'tcHorn'], phoneDrive: ['tcSteer', 'tcBrake', 'tcGo'],
  };
  for (const [parent, ids] of Object.entries(groups)) for (const id of ids) {
    const el = document.getElementById(id);
    if (el) document.getElementById(parent)!.appendChild(el);
  }
  installPhoneControls(root);
}
