import crossings from './bridge-crossings.json';
// EPSG:2961. OSM identifiers retain provenance; inferred gaps are authorized game repairs.
// This same data supplies the runtime fallback and the optional road-ground keep boxes.
export interface BridgeCrossing { area:string; road:number; name:string|null; kind:number; halfWidth:number; pts:[number,number][]; sources:string[]; inferred:boolean }
export const BRIDGE_CROSSINGS: readonly BridgeCrossing[] = crossings as BridgeCrossing[];
