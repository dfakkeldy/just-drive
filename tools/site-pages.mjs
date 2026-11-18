// Both brands use the same game template. This runs at build time, before any page script.
import { AREAS } from '../web/src/area.ts';
import { historyArea } from '../web/src/eras/history-areas.ts';
export const justIcon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%230b1620'/%3E%3Cpath d='M12 64L25 0h14l13 64M32 4v12m0 12v12m0 12v12' stroke='%23eef2f6' fill='none' stroke-width='3'/%3E%3C/svg%3E";
const escape = value => value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
export function justPage(source, area, historical = false) {
  const era = historical ? historyArea(area?.id) : null;
  if (historical && !era) throw Error('No 1884 era page for ' + (area?.id ?? 'unknown'));
  const title = era ? era.title : area ? `Just Drive: ${area.name}` : 'Just Drive';
  const description = era ? era.description : area ? `Drive around the real land near ${area.name}, Cape Breton.` : 'Drive around the real land in Cape Breton. Choose a place to drive.';
  const url = `https://justdrive.fakkeldy.ca/${era ? era.address : area?.id ?? ''}`;
  let page = source.replace(/<title>[\s\S]*?<\/title>/g,'').replace(/<meta (?:name="description"|property="og:[^"]+")[^>]*>/g,'').replace(/<link rel="(?:icon|manifest)"[^>]*>/g,'');
  page = page.replace('</head>', `<title>${escape(title)}</title>\n<meta name="description" content="${escape(description)}">\n<link rel="manifest" href="/manifest-just.webmanifest">\n<link rel="icon" href="${justIcon}">\n<meta property="og:title" content="${escape(title)}">\n<meta property="og:description" content="${escape(description)}">\n<meta property="og:type" content="website">\n<meta property="og:url" content="${url}">\n<style>body.justDrive :is(#shiftHud,#stopHint,#cameraButton,#endShift,#mailButton,#mailScore,#shiftReport,#photoTag,#photoFlash,#startOver){display:none!important}</style>\n</head>`);
  page = page.replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]+("[>])/, '$1Just Drive: Mabou$2');
  page = page.replace('<body>', '<body class="justDrive exploreMode">');
  page = page.replace(/(<div id="boot"><div>)[\s\S]*?(<\/div><\/div>)/, `$1<b>${escape(title)}</b>Loading the land…$2`);
  if (!area) {
    const links = AREAS.map(a=>`<a style="color:#edb486;display:block;min-height:44px" href="/${a.id}">Just Drive: ${escape(a.name)}</a>`).join('');
    page = page.replace(/<body[\s\S]*<\/body>/, `<body style="margin:0;background:#0b1620;color:#eef2f6;font:18px/1.5 system-ui"><main style="max-width:600px;margin:10vh auto;padding:24px"><h1>Just Drive</h1><p>This place does not exist yet. Choose a place to drive.</p><nav style="display:grid;gap:16px">${links}</nav></main></body>`);
  }
  return page;
}
