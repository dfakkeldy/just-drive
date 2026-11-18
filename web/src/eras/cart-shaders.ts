// Replaced with literal programs by the Vite transform in both builds. Node checks use the same pure transform.
import {TERRAIN_FRAG,WATER_MASK_FRAG} from '../shaders';
import {cartProgram} from './cart-programs';
export const CART_TERRAIN_FRAG=cartProgram(TERRAIN_FRAG,'terrain');
export const CART_WATER_MASK_FRAG=cartProgram(WATER_MASK_FRAG,'mask');
