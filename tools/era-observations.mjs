import assert from 'node:assert/strict';
export function assertCartRoad(report){assert.equal(report.surfaceKind,3,'road is the decoded cart-road kind');assert(['gravel','washboard'].includes(report.surface),'road uses a loose driving surface');}
export function assertWheelProgress(before,after){assert(after-before>.01,'wheel advances through real updates');}

export const LOOSE_BRIDGE_SURFACES=['gravel','washboard','dirt track'];
export function assertLooseBridge(surface){assert(LOOSE_BRIDGE_SURFACES.includes(surface),'bridge uses a loose surface, got '+surface);}

/** The floor plane may be sunk into a slope. All other corner endpoints must meet drawn land. */
export function assertFoundationCorner(vertices,base,ground,label='foundation'){
 assert(vertices.length&&vertices.every(Number.isFinite)&&Number.isFinite(base)&&Number.isFinite(ground),label+' has finite vertices and land');
 assert(vertices.some(y=>Math.abs(y-base)<.001),label+' retains its floor plane');
 const contacts=vertices.filter(y=>Math.abs(y-base)>=.001);
 if(!contacts.length)contacts.push(base);
 for(const y of contacts)assert(Math.abs(y-ground+.12)<.03,label+' ground contact '+JSON.stringify({contact:y,ground,gap:y-ground,base}));
}
