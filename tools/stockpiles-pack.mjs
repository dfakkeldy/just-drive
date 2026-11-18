// The Point Tupper stockpile pack, before and after its install into the baked land (tools/stockpiles-delta/README.md).
// Before: the served manifest has no `stockpiles` key, so this tab gets the committed pack through the real manifest
// key and the game's own fetches (only the two responses are replaced; no game code knows about it).
// After: nothing is replaced and the page reads the installed land. Either way `data` says which bytes were drawn.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cdpFetch } from './cdp.mjs';
export const PACK = new URL('./stockpiles-delta/stockpiles.json', import.meta.url);
export const KEY = { file: 'stockpiles.json', count: 2 };
const sha = text => createHash('sha256').update(text).digest('hex');
export async function stockpilePack(origin) {
  const area = `${origin}/areas/pointtupper`;
  const manifest = await (await cdpFetch(`${area}/manifest.json`)).json();
  if (manifest.stockpiles) {
    const pack = await (await cdpFetch(`${area}/${manifest.stockpiles.file}`)).text();
    return { data: `installed land (stockpiles.json sha256 ${sha(pack)})`, onEvent() {}, async enable() {} };
  }
  const pack = readFileSync(PACK, 'utf8');
  const bodies = { 'manifest.json': JSON.stringify({ ...manifest, stockpiles: KEY }), 'stockpiles.json': pack };
  let client, served = 0;
  return {
    data: `committed pack tools/stockpiles-delta/stockpiles.json (sha256 ${sha(pack)}), served through the manifest key; the land on this host has no pack yet`,
    get served() { return served; },
    onEvent(message) {
      if (message.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = message.params, name = new URL(request.url).pathname.split('/').pop();
      served++;
      void client.send('Fetch.fulfillRequest', { requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Cache-Control', value: 'no-store' }],
        body: Buffer.from(bodies[name]).toString('base64') }).catch(() => {});
    },
    async enable(c) {
      client = c;
      await c.send('Fetch.enable', { patterns: Object.keys(bodies).map(name => ({ urlPattern: `*/areas/pointtupper/${name}*`, requestStage: 'Request' })) });
    },
  };
}
