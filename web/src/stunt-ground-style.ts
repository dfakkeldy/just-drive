import {TERRAIN_FRAG} from './shaders';
/** Park-only colour layer. It cannot change heights, driving metadata or the ordinary terrain shader. */
export function withSiteStyle(fragment:string):string {
 const grass='  // Shingle and mud at the shore.',light='  // ---- brooks: painted from a field, read by hand as the road field is ----';
 if(!fragment.includes(grass)||!fragment.includes(light))throw Error('Site colour shader anchors changed');
 return 'uniform sampler2D tSiteStyle;\n'+fragment.replace(grass,'  vec3 siteNativeGrass=albedo;\n'+grass).replace(light,`
  vec4 siteStyle=texture2D(tSiteStyle,(vUv*256.0+0.5)/257.0);
  if(siteStyle.a>0.001){
    float siteGrain=vnoise(p*7.0),siteSpeck=vnoise(p*29.0);
    vec3 siteEarth=mix(vec3(0.235,0.165,0.095),vec3(0.125,0.100,0.062),siteStyle.r);
    siteEarth*=0.90+0.16*siteGrain+0.04*siteSpeck;
    vec3 siteGravel=vec3(0.270,0.255,0.205)*(0.84+0.22*siteGrain+0.06*siteSpeck);
    vec3 siteWorked=mix(siteEarth,siteGravel,siteStyle.g);
    siteWorked=mix(siteWorked,siteNativeGrass,siteStyle.b);
    albedo=mix(albedo,siteWorked,siteStyle.a);
  }
`+light);
}

/** Named park-only program; ordinary terrain continues to use the original constant. */
export const STUNT_TERRAIN_FRAG=withSiteStyle(TERRAIN_FRAG);
