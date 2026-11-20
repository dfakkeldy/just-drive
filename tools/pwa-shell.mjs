import { createHash } from 'node:crypto';
// Accept either shell as input when rebuilding an isolated or previously published folder.
export function normalizedPage(page,appUrl) {
 return page.replace(/\s+integrity="[^"]*"/g,'')
  .replace(/src="(?:(?:\/|\.\/)?app\.js|\/offline\/app\.[a-f0-9]+\.js)"/,`src="${appUrl}"`)
  .replace(/<(?:meta name="(?:mmm-build|mmm-page|mmm-offline-bytes|apple-mobile-web-app-[^"]+)"|link rel="(?:manifest|apple-touch-icon|modulepreload)")[^>]*>\n?/g,'');
}
// The chunks app.js imports at its top (web/area-chunks-build.ts), with the integrity of their bytes.
export function chunkPreloads(app,read) {
 const names=[...new Set([...app.matchAll(/(?:\bfrom|\bimport)\s*"\.\/chunks\/([\w-]+\.js)"/g)].map(m=>m[1]))];
 return names.map(name=>({name,integrity:'sha256-'+createHash('sha256').update(read(name)).digest('base64')}));
}
