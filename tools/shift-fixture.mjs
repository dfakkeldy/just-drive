// Shared baked data for the rule and controller checks. No browser or renderer.
import { readFileSync } from 'node:fs';
import { Roads } from '../web/src/roads.ts';
const load = (name) => JSON.parse(readFileSync(`../data/baked/terrain/${name}.json`));
export const village = load('manifest').village;
export const terrain = { heightAt() { return 0; }, surfaceAt() { return { ground: 0, canopy: 0, roadDist: 10, halfWidth: 3, kind: 2, level: 7 }; } };
export const roads = new Roads(load('roads'), village, terrain);
export const propsData = load('props');
