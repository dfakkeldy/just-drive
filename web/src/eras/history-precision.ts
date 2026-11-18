/** Canonical cold-path generation inputs. A tie band absorbs sub-quantum libm noise. */
const quant=(value:number,step:number,tieBand=1e-5):number=>Math.floor(value/step+.5+tieBand)*step;
export const qMetres=(value:number):number=>quant(value,.001);
export const qHeight=(value:number):number=>quant(value,.0001);
export const qAngle=(value:number):number=>quant(value,1e-8);
export const qUnit=(value:number):number=>quant(value,1e-12,.01);
export const codeUnitCompare=(a:string,b:string):number=>a<b?-1:a>b?1:0;
export const metricDistance=(x:number,z:number):number=>qMetres(Math.hypot(x,z));
