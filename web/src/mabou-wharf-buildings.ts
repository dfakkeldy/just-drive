import type { Building, BuildingStyle } from './buildings';

const shed: Building = {
  id: 900019, x: 618650, y: 5104781, ground: 1.48,
  length: 4.4, width: 3.6, eave: 1.8, ridge: 3.15, axisDeg: 79,
  footprint: [[618647.5, 5104779.65], [618648.19, 5104783.18], [618652.5, 5104782.35], [618651.81, 5104778.82]],
  roof: 'gable', kind: 'shed', confidence: 0.4,
};

const plain = {
  entrance: 'none', chimney: false, dormer: false, shutters: false,
  satelliteDish: false, skirting: false, silo: false,
} as const;

export const wharfBuildingStyles: Record<string, BuildingStyle> = {
  8: { ...plain, wall: '#ae655b', roof: '#ac584a', trim: '#c4c1b4', door: '#e0dcd2',
    roofMaterial: 'metal', boardAndBatten: true, bareEnd: { side: -1, wall: '#83786b' },
    front: { end: false, side: 1 }, barnDoors: 5 },
  73: { ...plain, wall: '#2998d4', roof: '#3779a8', trim: '#f2f1e8', door: '#eeeae0',
    roofMaterial: 'metal', metalCladding: true, front: { end: true, side: 1 }, barnDoors: 3 },
  [shed.id]: { ...plain, wall: '#777872', roof: '#363b42', trim: '#8b8b81', door: '#777970',
    roofMaterial: 'shingle', roofShape: 'gambrel', boardAndBatten: true, front: { end: true, side: 1 } },
};

/** Use the survey footprints for both large buildings. The small shed is scenery. */
export const isWharfBuilding = ({id}: Building): boolean => id === 8 || id === 73;

export function wharfBuildings(list: Building[]): Building[] {
  return [...list.filter(isWharfBuilding).map(building => building.id === 73 ? { ...building, ridge: 4.55 } : building), shed];
}
