/** Practice targets; qualification uses the actual placed approach and landing, including lateral offsets. */
export interface StuntGuidance {car?:readonly [number,number];truck?:readonly [number,number];handoff?:{car:number;truck:number};lines:readonly string[]}
export const STUNT_GUIDANCE:Readonly<Record<string,StuntGuidance>>={
  'slip-small':{car:[90,98],truck:[90,98],lines:['CAR / PICKUP: 90-98 KM/H','BRAKE AFTER LANDING']},
  tabletop:{car:[8,8],truck:[8,8],lines:['ROLL OVER: 8 KM/H','BRAKE AFTER THE DESCENT']},
  'slip-medium':{car:[45,55],truck:[45,55],lines:['CAR / PICKUP: 45-55 KM/H','BRAKE AFTER LANDING']},
  'slip-large':{car:[45,55],truck:[45,55],lines:['CAR / PICKUP: 45-55 KM/H','BRAKE AFTER LANDING']},
  'gap-4':{car:[65,74],truck:[65,68],lines:['CAR: 65-74 KM/H','PICKUP: 65-68 KM/H','BRAKE AFTER LANDING']},
  'gap-tanks':{car:[65,75],truck:[70,78],handoff:{car:65,truck:60},lines:['CAR: 65-75 KM/H','PICKUP: 70-78 KM/H','NEXT DROP: CAR 65 / PICKUP 60']},
  'drop-0.8':{car:[65,75],truck:[70,80],lines:['CAR: 65-75 KM/H','PICKUP: 70-80 KM/H','BRAKE AFTER LANDING']},
  'drop-1.6':{car:[65,75],truck:[55,65],lines:['CAR: 65-75 KM/H','PICKUP: 55-65 KM/H','BRAKE AFTER LANDING']},
  'drop-2.4':{car:[55,60],truck:[50,55],lines:['CAR: 55-60 KM/H','PICKUP: 50-55 KM/H','BRAKE AFTER LANDING']},
  tunnel:{lines:['BOTH ROUTES: 8 KM/H','KEEP STRAIGHT']},
  footbridge:{lines:['CAR / BUGGY: 8 KM/H','NO PICKUPS OR TRAILERS']},
  whoops:{lines:['TRY 45 KM/H','KEEP STRAIGHT']},
  rollers:{lines:['TRY 45 KM/H','KEEP STRAIGHT']},
  tanks:{lines:['KEEP CLEAR','JUMP FROM THE MARKED RAMP']},
};
