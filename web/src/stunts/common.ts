import type {RGB} from '../yard-kit';
import type {Deck} from '../stunt-kit';
export const concrete:RGB=[.60,.58,.54],steel:RGB=[.10,.13,.15];
export const rect=(a:number,b:number,width:number,height:(u:number,v:number)=>number,surface:Deck['surface']='concrete',kerbs=true):Deck=>({box:[a,-width/2,b,width/2],height,surface,kerbs,breaks:[a,b]});
export const board=(work:string):readonly string[]=>['SEACOW PD:',work];
