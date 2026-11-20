// Approved UI-climb presentation changes. Legacy checks still compare every other byte.
import assert from 'node:assert/strict';
export const UI_START_CSS = "#title{--title-accent:var(--maple,#d0632e);box-sizing:border-box;align-items:safe center}\nbody.exploreMode #title,#title.justDrive{--title-accent:#a7d9bc}\n#title #titleCard{display:block!important;box-sizing:border-box;width:min(680px,100%);max-height:calc(100dvh - 32px);overflow-y:auto;overscroll-behavior:contain}\n#title #titleCard h1{font-family:\"Iowan Old Style\",\"Palatino Linotype\",Palatino,Georgia,serif}\n#title .tag{font:600 15px/1.4 system-ui,sans-serif;letter-spacing:0;text-transform:none;color:var(--ink)}\nbody.exploreMode #title #titleStart,#title.justDrive #titleStart{background:#a7d9bc;color:#0b1620}\n#title :is(#modeChoice,#dailyChoice,#vehicleChoice) button[aria-pressed=\"true\"]{border:2px solid var(--title-accent)!important}\n#title :is(#modeChoice,#dailyChoice,#vehicleChoice) button[aria-pressed=\"true\"]::before{content:'\u2713 ';font-weight:800}\n#titleControls summary{min-height:44px;display:flex;align-items:center;cursor:pointer;text-decoration:underline;text-underline-offset:3px}\n#titleControls kbd{display:inline-block;background:#20303b;border:1px solid #71818e;border-radius:4px;padding:1px 4px;font:inherit;white-space:normal}\n#titleControls dl{grid-template-columns:minmax(90px,auto) minmax(0,1fr)}\n#title .titleFooter{margin-top:16px;font-size:12px}\n@media(max-width:759px){#title #titleStart{position:sticky;bottom:-8px;z-index:2;padding:12px;box-shadow:0 -10px 14px var(--panel-solid,#0c141c)}#title #titleCard{scroll-padding-bottom:120px}}\n\n";
const tagNow = '#title .tag{font:600 15px/1.4 system-ui,sans-serif;letter-spacing:0;color:var(--ink);margin:0 0 10px}';
const tagBefore = '#title .tag{font:700 11px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-dim,#b9c3cc);margin:0 0 10px}';
export function priorTitleStyle(css) {
 if (!css.includes(UI_START_CSS)) return css;
 assert.equal(css.split(UI_START_CSS).length,2,'approved start styles occur once');
 assert.ok(css.includes(tagNow),'plain promise style');
 return css.replace(UI_START_CSS,'').replace(tagNow,tagBefore);
}
export function priorTitleMarkup(html) {
 if (html.includes('id="titleControls"')) {
  const controls=/<div id="titleControls"><dl>([\s\S]*?)<\/dl><details><summary>All controls<\/summary><dl>([\s\S]*?)<\/dl><\/details><\/div>/;
  const found=html.match(controls);assert.ok(found,'four essential rows and a closed full list');
  assert.equal((found[1].match(/<dt>/g)??[]).length,4,'four essential rows');
  html=html.replace(controls,'<dl>$1$2</dl>').replace(/<dt><kbd>([\s\S]*?)<\/kbd><\/dt>/g,(_,key)=>'<dt>'+key.replace('WASD','W A S D')+'</dt>');
  const footer='<p class="titleFooter">Preview build · Cape Breton, Nova Scotia</p>';
  assert.ok(html.includes(footer),'preview in the small footer');html=html.replace(footer,'');
  html=html.replace('<p class="tag">The land at your own pace</p>','<p class="tag">Preview build · the land at your own pace</p>')
   .replace('<p class="tag">Real land and roads</p>','<p class="tag">Preview build · real land and roads</p>')
   .replace('<p class="tag">A route you cannot win</p>','<p class="tag">Preview build · a route you cannot win</p>');
  const caution=html.match(/<p id="exploreCaution">[\s\S]*?<\/p>/)?.[0];
  if(caution){html=html.replace(caution,'').replace('<p id="waysOut" hidden>',caution+'<p id="waysOut" hidden>');}
  const modes=html.match(/<div id="modeChoice"[\s\S]*?<\/div>(?:<div id="dailyChoice">[\s\S]*?<\/div>)?/)?.[0];
  if(modes)html=html.replace(modes,'').replace('<div id="titleCard">','<div id="titleCard">'+modes);
 }
 return html.replace(/>\s+</g,'><').trim();
}
