/** Run scalar/vec2-constructor GLSL rule bodies as JavaScript in Node fixtures.
 * Texture reads stay explicit injected inputs; the program text is the real export.
 */
export function glslRule(source,name,environment){
 const match=new RegExp('float '+name+'\\(([^)]*)\\)\\s*\\{').exec(source);if(!match)throw Error('Missing GLSL rule '+name);
 let level=1,end=match.index+match[0].length,start=end;
 for(;level&&end<source.length;end++){if(source[end]==='{')level++;if(source[end]==='}')level--;}
 const body=source.slice(start,end-1).replace(/\b(?:float|vec2)\s+(\w+)\s*=/g,'let $1=');
 const args=match[1].split(',').filter(Boolean).map(v=>v.trim().split(/\s+/).at(-1));
 const entries=Object.entries(environment),fn=new Function(...entries.map(([k])=>k),...args,body);
 return (...values)=>fn(...entries.map(([,v])=>v),...values);
}
