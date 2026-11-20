import type { Building, BuildingStyle } from './buildings';

// The level-7 ground at the shed centre is 1.475 m before Hill scaling.
const shed: Building = {
  id: 900403, x: 618650, y: 5104781, ground: 1.48,
  length: 4.4, width: 3.6, eave: 1.8, ridge: 3.15, axisDeg: 79,
  footprint: [[618647.5, 5104779.65], [618648.19, 5104783.18], [618652.5, 5104782.35], [618651.81, 5104778.82]],
  roof: 'gable', kind: 'shed', confidence: 0.4,
};

const plain = {
  entrance: 'none', chimney: false, dormer: false, shutters: false,
  satelliteDish: false, skirting: false, silo: false,
} as const;

const fishShedStyle: BuildingStyle = {
  ...plain, wall: '#b66e63', roof: '#b66a5a', trim: '#c4c1b4', door: '#e0dcd2',
  roofMaterial: 'metal', boardAndBatten: true, bareEnd: { side: -1, wall: '#83786b' },
  front: { end: false, side: 1 }, barnDoors: 5,
};
const workBuildingStyle: BuildingStyle = {
  ...plain, wall: '#2998d4', roof: '#4689b7', trim: '#f2f1e8', door: '#eeeae0',
  roofMaterial: 'metal', metalCladding: true, front: { end: true, side: 1 }, barnDoors: 3,
};
const shedStyle: BuildingStyle = {
  ...plain, wall: '#96958d', roof: '#363b42', trim: '#8b8b81', door: '#777970',
  roofMaterial: 'shingle', roofShape: 'gambrel', boardAndBatten: true, front: { end: true, side: 1 },
};

function atBarn(list: Building[], e: number, n: number): Building | undefined {
  return list.find(b => b.kind === 'barn' && Math.hypot(b.x - e, b.y - n) <= 4);
}

/** Match the two survey footprints by place so a rebake can assign new IDs. */
export function wharfBuildingArt(list: Building[]): { buildings: Building[]; styles: Record<string, BuildingStyle> } {
  const fishShed = atBarn(list, 618685.9, 5104819.5);
  const workBuilding = atBarn(list, 618653.2, 5104764.4);
  const styles: Record<string, BuildingStyle> = { [shed.id]: shedStyle };
  if (fishShed) styles[fishShed.id] = fishShedStyle;
  if (workBuilding) styles[workBuilding.id] = workBuildingStyle;
  const buildings = list.map(b => b === workBuilding ? { ...b, ridge: 4.55 } : b);
  return { buildings: [...buildings, shed], styles };
}
