// Node-only audit. Never import this module from web/src; it must not enter a player bundle.
import {readFileSync} from 'node:fs';
const data=new Map(),files={mabou:'era-density-layout.json',judique:'era-density-judique-layout.json'};
export function getDensityAuditData(area='mabou'){if(!data.has(area))data.set(area,JSON.parse(readFileSync((process.env.MMM_ROOT??process.cwd())+'/tools/'+files[area],'utf8')));return data.get(area);}
