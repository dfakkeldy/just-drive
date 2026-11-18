import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {Plugin} from 'vite';
import {cartProgram,rawProgram} from './src/eras/cart-programs';
/** Transform only the era module; today's shader module stays byte-for-byte upstream. */
export function eraShaderBuild():Plugin {
  return {name:'era-shader-literals',enforce:'pre',transform(_code,id){
    if(!id.replace(/\\/g,'/').endsWith('/src/eras/cart-shaders.ts'))return;
    const source=readFileSync(fileURLToPath(new URL('./src/shaders.ts',import.meta.url)),'utf8');
    return {code:`export const CART_TERRAIN_FRAG=${JSON.stringify(cartProgram(rawProgram(source,'TERRAIN_FRAG'),'terrain'))};\nexport const CART_WATER_MASK_FRAG=${JSON.stringify(cartProgram(rawProgram(source,'WATER_MASK_FRAG'),'mask'))};`,map:null};
  }};
}
