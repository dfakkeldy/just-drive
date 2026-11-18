/** Fixed lights with a published tower height and a dry baked source position.
 * Unresolved candidates remain in harbour-light-sources.json. No height is invented.
 */
export interface HarbourLight {
 readonly number: string; readonly areas: readonly string[];
 readonly e: number; readonly n: number; readonly ground: number; readonly height: number;
 readonly kind: 'wood' | 'octagon' | 'round' | 'skeleton' | 'triangle';
 readonly colour: string; readonly character: string; readonly period: number; readonly on: number;
}
export const LIGHTS: readonly HarbourLight[] = [
  {
    "number": "694.4",
    "areas": [
      "pointtupper"
    ],
    "e": 628368.8,
    "n": 5047625.56,
    "ground": 0.58,
    "height": 12.7,
    "kind": "triangle",
    "colour": "G",
    "character": "F",
    "period": 0,
    "on": 1
  },
  {
    "number": "694.5",
    "areas": [
      "pointtupper"
    ],
    "e": 628221.49,
    "n": 5047724.43,
    "ground": 16.77,
    "height": 12.3,
    "kind": "triangle",
    "colour": "G",
    "character": "Oc",
    "period": 11.0,
    "on": 10
  },
  {
    "number": "698",
    "areas": [
      "cansocauseway",
      "pointtupper"
    ],
    "e": 624215.33,
    "n": 5054552.97,
    "ground": 9.04,
    "height": 13.8,
    "kind": "triangle",
    "colour": "G",
    "character": "F",
    "period": 0,
    "on": 1
  },
  {
    "number": "701",
    "areas": [
      "cansocauseway",
      "pointtupper"
    ],
    "e": 623385.75,
    "n": 5056308.63,
    "ground": 2.9,
    "height": 3.5,
    "kind": "skeleton",
    "colour": "R",
    "character": "Oc",
    "period": 11.0,
    "on": 10
  },
  {
    "number": "702",
    "areas": [
      "cansocauseway",
      "pointtupper"
    ],
    "e": 623553.11,
    "n": 5056166.83,
    "ground": 6.96,
    "height": 7.5,
    "kind": "wood",
    "colour": "R",
    "character": "Oc",
    "period": 11.0,
    "on": 10
  },
  {
    "number": "838",
    "areas": [
      "westbay"
    ],
    "e": 654835.22,
    "n": 5075330.82,
    "ground": 9.12,
    "height": 8.4,
    "kind": "wood",
    "colour": "G",
    "character": "Fl",
    "period": 4.0,
    "on": 1
  },
  {
    "number": "876",
    "areas": [
      "mabou"
    ],
    "e": 618648.09,
    "n": 5104734.16,
    "ground": 1.68,
    "height": 13.7,
    "kind": "wood",
    "colour": "G",
    "character": "F",
    "period": 0,
    "on": 1
  },
  {
    "number": "876.8",
    "areas": [
      "porthood"
    ],
    "e": 612660.25,
    "n": 5097955.97,
    "ground": 3.7,
    "height": 3.3,
    "kind": "round",
    "colour": "G",
    "character": "Fl",
    "period": 4.0,
    "on": 1
  },
  {
    "number": "881",
    "areas": [
      "porthood"
    ],
    "e": 608462.3,
    "n": 5092456.37,
    "ground": 47.12,
    "height": 11.6,
    "kind": "octagon",
    "colour": "W",
    "character": "Fl",
    "period": 4.0,
    "on": 1
  },
  {
    "number": "881.1",
    "areas": [
      "porthood"
    ],
    "e": 614032.05,
    "n": 5090522.24,
    "ground": -0.05,
    "height": 3.8,
    "kind": "round",
    "colour": "G",
    "character": "Fl",
    "period": 4.0,
    "on": 1
  }
];
