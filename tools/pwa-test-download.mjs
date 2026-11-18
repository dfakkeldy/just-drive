// Functional full-transfer budget scales with ready packs; startup deadlines are unchanged.
import assert from 'node:assert/strict';
export const downloadBudget = index => Math.max(180000,index.files.length*20,Math.ceil(index.totalBytes/1048576*400));
export const downloadState = `(()=>{const s=document.getElementById('offlineStatus')?.textContent||'';return /not enough room|download (?:stopped|failed)|saving is (?:not|turned off)|new version of the game|already running/i.test(s)?{error:s}:/Done:/.test(s)})()`;
export function downloaded(value){assert.equal(value?.error,undefined,'download failed: '+value?.error);assert.ok(value,'full transfer reaches Done');}
