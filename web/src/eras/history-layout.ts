import {MABOU_1884_LAYOUT_JSON} from './mabou-1884-layout';
import {JUDIQUE_1884_LAYOUT_JSON} from './judique-1884-layout';
/** One generated layout per 1884 area, and the number of printed trades it must carry. */
const LAYOUTS:Readonly<Record<string,{json:string;trades:number}>>={mabou:{json:MABOU_1884_LAYOUT_JSON,trades:48},judique:{json:JUDIQUE_1884_LAYOUT_JSON,trades:37}};
import type {PeriodSite,Zone} from './history-sites';
export interface StoredSite {
 readonly id:string;readonly e:number;readonly n:number;readonly yaw:number;readonly kind:PeriodSite['kind'];
 readonly width:number;readonly length:number;readonly barn:{readonly x:number;readonly z:number}|null;
 readonly word?:string;readonly source?:string;readonly method?:PeriodSite['method'];readonly moved?:number;readonly zone?:Zone;
 readonly water?:{readonly e:number;readonly n:number;readonly half:number;readonly yaw:number};
}
interface StoredBoard {id:string;e:number;n:number;yaw:number;width:number;height:number;roadE:number;roadN:number}
export interface HistoryLayout {trades:PeriodSite[];farms:PeriodSite[];boards?:import('./history-board-sites').BoardPlan[]}
export interface StoredLayout {version:1;farms:readonly StoredSite[];trades:readonly StoredSite[];boards:readonly StoredBoard[]}
const decodedLayouts=new Map<string,StoredLayout>();
let decodes=0;
export function historyLayoutState(area='mabou'):{decodes:number;hasLayout:boolean}{return {decodes,hasLayout:decodedLayouts.has(area)};}
/** Reject an incompatible or incomplete payload before publishing the cached layout. */
export function decodeHistoryLayout(encoded:string,tradeCount=48):StoredLayout {
 const fail=(why:string):never=>{throw Error('Invalid 1884 layout: '+why);};
 let value:unknown;try{value=JSON.parse(encoded);}catch{fail('invalid JSON');}
 const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 const numbers=(r:Record<string,unknown>,keys:readonly string[]):boolean=>keys.every(k=>typeof r[k]==='number'&&Number.isFinite(r[k]));
 if(!object(value))return fail('expected an object');
 if(value.version!==1)return fail('unsupported version '+String(value.version)+' (expected 1)');
 if(Object.keys(value).some(k=>!['version','farms','trades','boards'].includes(k)))return fail('unexpected runtime fields');
 if(!Array.isArray(value.farms)||!value.farms.length||!Array.isArray(value.trades)||value.trades.length!==tradeCount||!Array.isArray(value.boards)||value.boards.length!==tradeCount)return fail(`required farms, ${tradeCount} trades and ${tradeCount} boards`);
 const ids=new Set<string>();
 for(const [farm,rows]of [[true,value.farms],[false,value.trades]] as const)for(const r of rows){
  if(!object(r)||typeof r.id!=='string'||!r.id||ids.has(r.id)||!numbers(r,['e','n','yaw','width','length'])||Number(r.width)<=0||Number(r.length)<=0)return fail('invalid or duplicate site');
  ids.add(r.id);
  if(farm?r.kind!=='farm'||!['village','roadside','remote'].includes(String(r.zone)):!['mill','forge','school','church','shop','post-office','factory','tannery','stables','quarry'].includes(String(r.kind)))return fail(r.id+': invalid kind/zone');
  if(r.barn!==null&&(!object(r.barn)||!numbers(r.barn,['x','z'])))return fail(r.id+': invalid barn');
  if(!farm&&(typeof r.word!=='string'||!r.word||typeof r.source!=='string'||!['label','road','water'].includes(String(r.method))||!numbers(r,['moved'])))return fail(r.id+': incomplete trade');
  if(r.water!==undefined&&(!object(r.water)||!numbers(r.water,['e','n','half','yaw'])||Number(r.water.half)<=0))return fail(r.id+': invalid water attachment');
  if((r.method==='water')!==(r.water!==undefined))return fail(r.id+': water method/attachment mismatch');
 }
 const boardIds=new Set<string>(),tradeIds=new Set(value.trades.map(r=>(r as Record<string,unknown>).id));
 for(const b of value.boards){if(!object(b)||typeof b.id!=='string'||!tradeIds.has(b.id)||boardIds.has(b.id)||!numbers(b,['e','n','yaw','width','height','roadE','roadN'])||Number(b.width)<=0||Number(b.height)<=0)return fail('invalid or missing trade board');boardIds.add(b.id);}
 return value as unknown as StoredLayout;
}
export function getHistoryLayoutData(area='mabou'):StoredLayout {
 let decoded=decodedLayouts.get(area);
 if(decoded===undefined){const source=LAYOUTS[area];if(!source)throw Error('No 1884 layout for '+area);decoded=decodeHistoryLayout(source.json,source.trades);decodedLayouts.set(area,decoded);decodes++;}
 return decoded;
}
/** No terrain or placement reads in this path. Today's game never invokes it. */
export function historyLayout(origin:readonly [number,number],area='mabou'):HistoryLayout {
 const data=getHistoryLayoutData(area);
 const decode=(r:StoredSite):PeriodSite=>({id:r.id,x:r.e-origin[0],z:origin[1]-r.n,yaw:r.yaw,kind:r.kind,width:r.width,length:r.length,
  word:r.word??'',source:r.source??'',method:r.method??'farm',moved:r.moved??0,...(r.zone?{zone:r.zone}:{}),...(r.barn?{barn:{...r.barn}}:{}),
  ...(r.water?{water:{x:r.water.e-origin[0],z:origin[1]-r.water.n,half:r.water.half,yaw:r.water.yaw}}:{})});
 return {farms:data.farms.map(decode),trades:data.trades.map(decode),boards:data.boards.map(b=>({...b,x:b.e-origin[0],z:origin[1]-b.n,roadX:b.roadE-origin[0],roadZ:origin[1]-b.roadN}))};
}
