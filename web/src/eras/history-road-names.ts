/** Period wording from the 1884 survey sheets, per area. Baked road names remain untouched. No imports: tools load this file alone. */
export const HISTORY_ROAD_TABLES:Readonly<Record<string,Readonly<Record<string,string>>>>=Object.freeze({
 mabou:Object.freeze({'Highway 19':'Post Road','Highway 252':'Road to Whycocomagh'}),
 // Matched by geometry to the road-name lines printed on sheet 19 (F19-JUD-027 and F19-JUD-104).
 judique:Object.freeze({'Highway 19':'Post Road','Campbell Road':'Old Judique Road','Glendale Mountain Road':'River Inhabitants Road'}),
});
export const HISTORY_ROAD_NAMES:Readonly<Record<string,string>>=HISTORY_ROAD_TABLES.mabou;
const modernRoad=/\b(?:(?:highway|hwy|route|trunk)\s*\d+|trans[ -]?canada(?:\s+(?:highway|trail))?|rail(?:way)?[ -]trail|(?:mabou rivers|celtic shores coastal|judique flyer|ceilidh coastal) trail)\b/gi;
const names=(area:string)=>Object.hasOwn(HISTORY_ROAD_TABLES,area)?HISTORY_ROAD_TABLES[area]:HISTORY_ROAD_TABLES.mabou;
/** Shared by the readout and the cold-built places used by the list, arrivals and minimap. */
export function historyRoadText(text:string,area='mabou'):string {
 for(const [today,period]of Object.entries(names(area)))text=text.replace(new RegExp('\\b'+today+'\\b','gi'),period);
 return text.replace(modernRoad,'cart road');
}
const roadNames=new Map<string,string>();
export function historyRoadName(name:string,area='mabou'):string {
 const table=names(area),cacheKey=area+'\0'+name;
 let value=roadNames.get(cacheKey);if(value===undefined){const key=Object.keys(table).find(k=>k.toLowerCase()===name.toLowerCase());modernRoad.lastIndex=0;value=key?table[key]:modernRoad.test(name)?'cart road':name;modernRoad.lastIndex=0;roadNames.set(cacheKey,value);}return value;
}
