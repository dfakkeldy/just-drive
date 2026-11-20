#!/usr/bin/env node
import { readBaseline } from './baseline-source.mjs';
import { cdp, cdpFetch } from './cdp.mjs';
// Compare unchanged desktop controls with the baseline; pin the new sheet and credits. The same scene keeps the comparison useful.
// Each size runs on an ordinary screen (pixel ratio 1: no Picture group, so three rows stand in for a taller panel).
// 1280x720 also runs on a Retina screen (ratio 2), where the settings panel holds the real Picture group.
// RUN=desktop-layout-check.mjs VIEWS="desktop|demo=2&relief=0.5" tools/yard-shots.sh 1280 720
import { mpLayoutScript } from './mp-layout-fixture.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const [out, url] = process.argv.slice(2), port = process.env.CDP_PORT ?? '9333';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const original = (path) => (process.env.BASE_REF ? execFileSync('git', ['show', `${process.env.BASE_REF}:${path}`], { encoding:'utf8' }) : readBaseline('desktop-layout',path)).match(/<style>([\s\S]*?)<\/style>/)[1];
for (const [width, height, scale] of [[1280, 720, 1], [1600, 1000, 1], [1280, 720, 2]]) {
  const size = `${width}x${height}${scale > 1 ? `@${scale}` : ''}`;
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method:'PUT'})).json();
  const { ws, send } = await cdp(tab.webSocketDebuggerUrl);
  const read = async (expression) => {
    const result = await send('Runtime.evaluate', {expression, returnByValue:true});
    assert.ok(!result.result?.exceptionDetails, JSON.stringify(result.result?.exceptionDetails));
    return result.result?.result?.value;
  };
  try {
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor:scale, mobile:false});
    const page = new URL(url); page.searchParams.set('hud','1');
    if (process.env.MP_LAYOUT === '1') await send('Page.addScriptToEvaluateOnNewDocument', {source:mpLayoutScript});
    await send('Page.navigate', {url:page.href});
    let settled = false;
    for (let i = 0; i < 160; i++) { await send('Page.bringToFront'); await sleep(500); if (await read(`document.title === 'settled'`)) { settled = true; break; } }
    assert.ok(settled, 'desktop game starts');
    assert.ok(await read(`!document.getElementById('phoneHud') && !document.body.classList.contains('tcOn')`), 'mouse desktop has no phone grid');
    assert.equal(await read(`!!document.getElementById('picture')`), scale > 1, scale > 1 ? 'a Retina desktop has the Picture group' : 'an ordinary screen has no Picture group');
    if (process.env.MP_LAYOUT === '1') {
      assert.ok(await read(`mmm.mp.current?.status === 'Muddy Culvert 88 · 23 other drivers'`), 'long multiplayer call sign fixture started');
      assert.ok(await read(`(() => {
        const chip=document.getElementById('mpChip'), c=chip?.getBoundingClientRect();
        return chip && !chip.hidden && c.top>=0 && c.bottom<=innerHeight && ['hud','gear','shiftHud','stopHint','miniMap','radio','photoTag'].every(id=>{
          const e=document.getElementById(id), r=e?.getBoundingClientRect();
          return !r || !r.width || !r.height || c.right<=r.left || c.left>=r.right || c.bottom<=r.top || c.top>=r.bottom;
        });
      })()`), 'long multiplayer chip is visible and covers no readout');
    }
    const current = await read(`document.querySelector('style').textContent`);
    // Runs in the page. Both sets of rules are measured in one call, so no frame of the game runs between them:
    // the readouts hold the same text (speed, clock, song) for both, and only the rules can make a difference.
    const MEASURE = `() => Object.fromEntries(['c','hud','shiftHud','stopHint','miniMap','relief','radio','gear','settings','photoTag','cameraButton','mailButton','credit'].map(id => {
      const e = document.getElementById(id), b = e.getBoundingClientRect(), s = getComputedStyle(e);
      return [id, {box:[b.x,b.y,b.width,b.height].map(v => Math.round(v*100)/100),
        paint:[s.color,s.backgroundColor,s.fontFamily,s.fontSize,s.lineHeight,s.opacity,s.whiteSpace,s.borderRadius,s.pointerEvents,s.display]}];
    }))`;
    const DRESS = `(css, cls) => { document.querySelector('style').textContent = css; document.documentElement.className = cls; document.body.style.margin = '0'; }`;
    for (const [carrier, path] of [['dev','web/index.html'], ['public','artifact/page.html']]) {
      for (const phase of ['before','after']) {
        if (phase === 'before') {
          // Transitions and animations are off for the two measurements: a colour on its way from one set of
          // rules to the other would read as the old one.
          const both = await read(`(() => { const measure = ${MEASURE}, dress = ${DRESS};
            const still = document.head.appendChild(Object.assign(document.createElement('style'), { textContent: '*,*::before,*::after{transition:none!important;animation:none!important}' }));
            dress(${JSON.stringify(original(path))}, ''); const before = measure();
            dress(${JSON.stringify(current)}, ${JSON.stringify(carrier === 'dev' ? 'devPage' : '')}); const after = measure();
            still.remove();
            return { before, after }; })()`);
          // The sheet, credit, gear and stop hint have new pins below. All other paint stays pinned.
          assert.deepEqual(both.after.gear.paint,['rgb(238, 242, 246)','rgb(12, 20, 28)','ui-monospace, "SF Mono", Menlo, Consolas, monospace','20px','normal','1','normal','6px','auto','block'],'shared gear paint');
          for(const id of ['settings','credit','gear','stopHint']){delete both.before[id];delete both.after[id];}
          assert.deepEqual(both.after, both.before, `${carrier} ${size} unchanged desktop boxes and paint`);
          if(await read(`mmm.gameMode==='mail'`)) assert.deepEqual(await read(`(()=>{
            const card=document.getElementById('mailCard'),hint=document.getElementById('stopHint'),score=document.getElementById('mailScore');
            const saved={text:hint.textContent,style:hint.style.cssText,hidden:hint.hidden,drone:document.body.classList.contains('droneOn')};
            try {
              document.body.classList.remove('droneOn');hint.hidden=false;hint.style.display='';hint.textContent='Next: roadside box.';
              const h=hint.getBoundingClientRect(),m=score.getBoundingClientRect(),hs=getComputedStyle(hint),ms=getComputedStyle(score);
              const result={inside:hint.parentElement===card&&score.parentElement===card&&hint.nextElementSibling===score,
                stacked:h.height>0&&m.height>0&&Math.abs(h.bottom-m.top)<.1,
                aligned:Math.abs(h.left-m.left)<.1&&Math.abs(h.width-m.width)<.1,
                paint:[hs,ms].map(s=>[s.backgroundColor,s.borderLeftWidth,s.borderLeftStyle,s.borderLeftColor]),joinedPadding:ms.paddingTop};
              hint.textContent='';result.emptyPadding=getComputedStyle(score).paddingTop;result.emptyHidden=getComputedStyle(hint).display==='none';
              hint.textContent='Next: roadside box.';document.body.classList.add('droneOn');hint.style.display='none';
              result.flightPadding=getComputedStyle(score).paddingTop;
              return result;
            } finally {hint.textContent=saved.text;hint.style.cssText=saved.style;hint.hidden=saved.hidden;document.body.classList.toggle('droneOn',saved.drone);}
          })()`),{inside:true,stacked:true,aligned:true,paint:Array.from({length:2},()=>['rgba(8, 14, 20, 0.82)','3px','solid','rgb(208, 99, 46)']),joinedPadding:'0px',emptyPadding:'8px',emptyHidden:true,flightPadding:'8px'},'mail hint and tally form one aligned panel; a lone tally keeps top padding');
          assert.deepEqual(await read(`(()=>{const e=document.getElementById('gear'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {w:r.width,h:r.height,right:innerWidth-r.right,top:r.top,fill:s.backgroundColor,rim:s.borderTopWidth,radius:s.borderRadius,font:s.fontSize,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e}})()`),{w:44,h:44,right:10,top:10,fill:'rgb(12, 20, 28)',rim:'1px',radius:'6px',font:'20px',hit:true},'gear uses the shared desktop chip rule');
          assert.deepEqual(await read(`(()=>{const e=document.getElementById('credit'),s=getComputedStyle(e),r=e.getBoundingClientRect();return {size:s.fontSize,opacity:s.opacity,background:s.backgroundColor,radius:s.borderRadius,clear:r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight};})()`),{size:'12px',opacity:'1',background:'rgb(12, 20, 28)',radius:'4px',clear:true},'solid readable credit chip');
        }
        await read(`(${DRESS})(${JSON.stringify(phase === 'before' ? original(path) : current)}, ${JSON.stringify(phase === 'after' && carrier === 'dev' ? 'devPage' : '')})`);
        await sleep(600);
        mkdirSync(`${out}/${phase}`, {recursive:true});
        writeFileSync(`${out}/${phase}/desktop-${carrier}-${size}.png`, Buffer.from((await send('Page.captureScreenshot', {format:'png'})).result.data, 'base64'));
        // Open the panel unless the game already did: the first Picture measurement ends about now, and on a slow
        // result its hint opens the panel (detail.ts). A blind click would then close it. Either way it starts at the top.
        await read(`(() => { const panel = document.getElementById('settings'); if (panel.classList.contains('open')) panel.scrollTop = 0; else document.getElementById('gear').click(); })()`);
        const panelTop = () => read(`(() => {
          const end = document.getElementById('endShift').getBoundingClientRect();
          const at = document.elementFromPoint((end.left+end.right)/2,(end.top+end.bottom)/2);
          const panel = document.getElementById('settings');
          return !!at && panel.contains(at) && getComputedStyle(panel).backgroundColor === 'rgb(12, 20, 28)';
        })()`);
        if (phase === 'after') {
          assert.ok(await panelTop(), `${carrier}: open settings cover END SHIFT`);
          assert.equal(await read(`(()=>{const p=document.getElementById('settings'),r=p.getBoundingClientRect(),c=document.getElementById('credit').getBoundingClientRect(),s=getComputedStyle(p);return document.getElementById('settingsHeading').textContent==='Settings'&&document.getElementById('settingsClose').getBoundingClientRect().height===44&&s.borderRadius==='10px'&&s.overflowY==='auto'&&r.width===320&&r.bottom<=c.top-8;})()`),true,'one sheet width, title, close, scroll and room above credit');
          await read(`document.getElementById('settingsClose').click()`);
          assert.equal(await read(`document.getElementById('settings').classList.contains('open')`),false,'visible Close closes Settings');
          await read(`document.getElementById('gear').click()`);
        }
        writeFileSync(`${out}/${phase}/desktop-${carrier}-${size}-settings.png`, Buffer.from((await send('Page.captureScreenshot', {format:'png'})).result.data, 'base64'));
        const lastReachable = () => read(`(() => {
          const button = [...document.querySelectorAll('#settings button')].at(-1);
          button.scrollIntoView({block:'nearest'});
          const b = button.getBoundingClientRect(), at = document.elementFromPoint((b.left+b.right)/2,(b.top+b.bottom)/2);
          return b.top >= 0 && b.bottom <= innerHeight && (at === button || button.contains(at));
        })()`);
        if (scale > 1) {
          // The real Picture group (web/src/picture.ts): in the panel, before "Start over", each button on top.
          if (phase === 'after') {
            const picture = await read(`(() => {
              const g = document.getElementById('picture'), panel = document.getElementById('settings'), over = document.getElementById('startOver');
              const buttons = [...g.querySelectorAll('button')];
              return { inPanel: g.parentElement === panel, beforeStartOver: !!(g.compareDocumentPosition(over) & Node.DOCUMENT_POSITION_FOLLOWING),
                names: buttons.map((b) => b.textContent.replace(/^✓ /,'')).join(), checks: buttons.filter(b=>b.textContent.startsWith('✓ ')).length, accent: buttons.filter(b=>b.getAttribute('aria-pressed')==='true').every(b=>getComputedStyle(b).borderTopWidth==='2px'&&getComputedStyle(b).borderTopColor==='rgb(208, 99, 46)'), pressed: buttons.filter((b) => b.getAttribute('aria-pressed') === 'true').length,
                onTop: buttons.every((b) => { const r = b.getBoundingClientRect(), at = document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);
                  return r.width >= 40 && r.height >= 30 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && at === b; }) };
            })()`);
            assert.deepEqual(picture, {inPanel:true, beforeStartOver:true, names:'Sharp,Balanced,Fast', checks:1, accent:true, pressed:1, onTop:true}, `${carrier}: the Picture group is in the open settings panel, before Start over, with each button on top`);
            assert.ok(await lastReachable(), `${carrier}: last button remains reachable with the Picture group`);
            writeFileSync(`${out}/${phase}/desktop-${carrier}-${size}-picture.png`, Buffer.from((await send('Page.captureScreenshot', {format:'png'})).result.data, 'base64'));
          }
          await read(`document.getElementById('gear').click()`);
          continue;
        }
        // An ordinary screen has no Picture group. Three full rows stand in for a taller panel.
        await read(`(() => {
          const group = document.createElement('div'); group.id = 'desktopPictureQA';
          group.innerHTML = '<p>Picture (layout test)</p>' + [1,2,3].map(n => '<button style="display:block;width:100%;min-height:56px;margin:4px 0">Picture test ' + n + '</button>').join('');
          document.getElementById('settings').insertBefore(group, document.getElementById('startOver'));
        })()`);
        if (phase === 'after') {
          assert.ok(await panelTop(), `${carrier}: a taller panel stays above END SHIFT`);
          assert.ok(await lastReachable(), `${carrier}: last button remains reachable in a taller panel`);
          writeFileSync(`${out}/${phase}/desktop-${carrier}-${size}-picture-fixture.png`, Buffer.from((await send('Page.captureScreenshot', {format:'png'})).result.data, 'base64'));
        }
        await read(`document.getElementById('desktopPictureQA').remove(); document.getElementById('gear').click()`);
      }
    }
    console.log(`PASS ${size}: unchanged desktop controls match ${process.env.BASE_REF ?? 'the frozen desktop baseline'}; new sheet and credit chip pass their exact pins; settings cover END SHIFT, ${scale > 1 ? 'with the real Picture group' : 'also as a taller panel'}; no touch controls`);
  } finally { await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); ws.close(); }
}
