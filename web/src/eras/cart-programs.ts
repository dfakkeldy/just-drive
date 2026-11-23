/** Pure build transform. Original programs are never edited or passed era macros. */
export function rawProgram(source:string,name:string):string {
  const m=source.match(new RegExp('(?:const|export const) '+name+' = /\\* glsl \\*/ `([\\s\\S]*?)`;'));
  if(!m)throw Error('Missing shader '+name);
  return m[1].replace(/\$\{(\w+)\}/g,(_,key:string)=>rawProgram(source,key));
}
export function cartProgram(original:string,kind:'terrain'|'mask'):string {
  original=original.replace(/\/\* MODERN_ROAD_CUT_BEGIN \*\/[\s\S]*?\/\* MODERN_ROAD_CUT_END \*\//g,'');
  original=original.replace(/\/\* MODERN_ROAD_PAINT_BEGIN \*\/[\s\S]*?\/\* MODERN_ROAD_PAINT_END \*\//g,'');
  original=original.replaceAll(' * roadPaint','');
  let out=original.replace('  float rkind = mod(rflags, 16.0);',`  float rkind = mod(rflags, 16.0);
  if (rkind > 4.5 && rkind < 5.5) { rkind = 0.0; rhalf = 0.0; }
  if (rkind > 0.5 && rkind < 3.5) { rkind = 3.0; rhalf = min(rhalf, 2.1); }`);
  if(out===original)throw Error('Cart road code anchor changed');
  if(kind==='mask')return out;
  out=out.replace('    if (wash > 0.5) {',`    if (rkind > 2.5 && rkind < 3.5) {
      float cartRut = 1.0 - smoothstep(0.22, 0.48 + aa, abs(rdist - 0.85));
      float cartCrown = 1.0 - smoothstep(0.26, 0.65 + aa, rdist);
      vec3 cartEarth = mix(vec3(0.21, 0.15, 0.085), vec3(0.31, 0.24, 0.14), grit);
      surface = mix(mix(cartEarth, gravel * 0.75, cartRut), vec3(0.16, 0.17, 0.055) * (0.8 + 0.3 * grit), cartCrown * 0.8);
    }
    if (wash > 0.5) {`);
  const anchor='    surface = mix(surface, mix(vec3(0.060, 0.052, 0.045), vec3(0.105, 0.092, 0.078), speck), smoothstep(0.0, 0.03, hole) * (1.0 - smoothstep(120.0, 400.0, dist)));';
  if(!out.includes(anchor))throw Error('Cart hollow anchor changed');
  // Physics retains its measured potholes and washboard. The picture uses fewer, soft wet hollows in the ruts.
  return out.replace(anchor,`    if (rkind > 0.5 && rkind < 4.5) {
      vec2 cartCell=floor(p/vec2(2.1,5.7)), cartLocal=fract(p/vec2(2.1,5.7))-.5;
      float cartSeed=hash(cartCell+19.0);
      float cartWobble=(vnoise(p*3.3)-.5)*.28;
      float cartShape=length(cartLocal*vec2(2.0,1.15))+cartWobble;
      float cartRutMask=1.0-smoothstep(.3,.66,abs(rdist-.85));
      float cartMud=(1.0-smoothstep(.2,.52,cartShape))*smoothstep(.72,.9,cartSeed)*cartRutMask;
      vec3 cartWet=mix(vec3(.065,.045,.022),vec3(.14,.09,.045),grit);
      float cartWetEdge=(smoothstep(.19,.30,cartShape)-smoothstep(.35,.48,cartShape))*cartMud;
      surface=mix(surface,cartWet,cartMud*.94);
      surface=mix(surface,vec3(.055,.04,.021),cartWetEdge*.8);
      float cartPuddle=(1.0-smoothstep(.10,.27,cartShape+cartWobble*.3))*cartMud;
      surface=mix(surface,vec3(.16,.14,.095)+skyColor*.04,cartPuddle*.65);
    }`);
}
