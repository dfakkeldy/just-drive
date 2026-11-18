/** Stall rows the ground shader paints at once: the nearest to the car. */
export const STALL_ROWS = 8;
/** On-only program transform: today's exported shaders remain byte-identical. */
export const PAVED_SAMPLE = /* glsl */ `
uniform highp sampler2D tPaved;
uniform vec4 pavedRect; // world xmin,zmin and width,depth (metres)
uniform vec2 pavedCar;
// Red: asphalt (class 1). Green: an owner-observed gravel lot (class 2). Each 0 or 1 at a 2 m cell centre.
vec2 pavedClasses(vec2 p) {
  vec2 local=p-pavedRect.xy;
  if(any(lessThan(local,vec2(0.0)))||any(greaterThanEqual(local,pavedRect.zw)))return vec2(0.0);
  return texture2D(tPaved,local/pavedRect.zw).rg;
}
// A lot's edge: about a metre wide, wobbled by noise, so it reads as a laid edge rather than a 2 m blur.
float pavedEdge(float v,vec2 p) {
  float edge=smoothstep(0.25,0.75,v+.3*(vnoise(p*.6)-.5)*4.0*v*(1.0-v));
  return edge;
}
float pavedCoverage(vec2 p) {
  return pavedEdge(pavedClasses(p).r,p);
}
vec3 pavedLotAsphalt(vec2 p) {
  float speck=vnoise(p*23.0);
  vec3 road=mix(vec3(.045,.046,.050),vec3(.070,.070,.072),.50)*(.85+.3*speck);
  road*=1.0-.04*smoothstep(.60,.90,vnoise(p*.11));
  return road*1.045;
}
// Packed grey-brown gravel: crushed stone with fines, darker where cars turn and stand, a few dished spots.
vec3 pavedLotGravel(vec2 p) {
  float grit=vnoise(p*3.1),speck=vnoise(p*23.0),worn=vnoise(p*.21);
  vec3 stone=mix(vec3(.190,.170,.142),vec3(.272,.248,.210),grit)*(.82+.36*speck);
  stone*=1.0-.12*smoothstep(.45,.85,worn);
  stone*=1.0-.18*smoothstep(.80,.93,vnoise(p*.37+3.7));
  return stone;
}
float pavedCarFade(vec2 p) {
  float dx=p.x-pavedCar.x, dz=p.y-pavedCar.y;
  return 1.0-smoothstep(380.0,480.0,sqrt(dx*dx+dz*dz));
}
float pavedWeight(vec2 p) {
  return pavedCoverage(p)*pavedCarFade(p);
}
`;
/** Painted stall lines (ground program only: it uses screen derivatives). Row i: front origin and unit direction
 *  (A), length, depth and spacing (B). The stalls lie left of the direction, one line every `spacing`. */
export const PAVED_STALLS = /* glsl */ `
uniform vec4 pavedStallA[${STALL_ROWS}];
uniform vec4 pavedStallB[${STALL_ROWS}];
uniform float pavedStallCount;
// aa: metres a pixel, taken by the caller outside any branch (derivatives need uniform control flow).
float pavedStallPaint(vec2 p,float aa) {
  float paint=0.0;
  for(int i=0;i<${STALL_ROWS};i++){
    if(float(i)>=pavedStallCount)break;
    vec4 a=pavedStallA[i],b=pavedStallB[i];
    vec2 d=p-a.xy;
    float u=dot(d,a.zw), w=dot(d,vec2(a.w,-a.z));
    if(u<-0.2||u>b.x+0.2||w<0.15||w>b.y)continue;
    float k=floor(u/b.z+0.5);
    if(k*b.z>b.x+0.01)continue;
    paint=max(paint,1.0-smoothstep(0.06,0.06+aa,abs(u-k*b.z)));
  }
  // Village lot paint is old: worn through in places.
  return paint*(0.55+0.45*step(0.3,vnoise(p*1.3)));
}
`;
function replace(source:string,anchor:string,value:string):string {
  if(!source.includes(anchor))throw Error('Paved shader anchor changed: '+anchor);
  return source.replace(anchor,value);
}
export function pavedGroundShader(source:string):string {
  let out=replace(source,'void main() {',PAVED_SAMPLE+PAVED_STALLS+'\nvoid main() {');
  out=replace(out,'  // ---- roads: painted',`  float hardPaved=cls==4.0?0.0:pavedWeight(p);
  float lotGravel=0.0, lotRim=0.0, stallAA=max(fwidth(p.x)+fwidth(p.y),0.01);
  vec2 lotClass=cls==4.0?vec2(0.0):pavedClasses(p);
  if(lotClass.r+lotClass.g>0.0){
    float lotFade=pavedCarFade(p);
    // Gravel is what the whole lot edge covers beyond the asphalt, so an asphalt/gravel seam has no grass in it.
    lotGravel=max(pavedEdge(lotClass.r+lotClass.g,p)*lotFade-hardPaved,0.0);
    // LOT_RIM: a narrow crumbled edge of packed stone round asphalt, where the grass stops.
    lotRim=smoothstep(0.03,0.2,lotClass.r)*(1.0-hardPaved)*(1.0-lotGravel)*lotFade;
    // Stone first, weighted against what the asphalt leaves, then asphalt over it: the weights add up to the lot edge.
    float stone=min((lotGravel+lotRim*.85)/max(1.0-hardPaved,0.001),1.0);
    if(stone>0.0)albedo=mix(albedo,pavedLotGravel(p)*(1.0-.1*lotRim),stone);
    if(hardPaved>0.0){
      albedo=mix(albedo,pavedLotAsphalt(p),hardPaved);
      albedo=mix(albedo,vec3(.47,.47,.44),pavedStallPaint(p,stallAA)*hardPaved*(1.0-smoothstep(60.0,220.0,dist)*0.6));
    }
  }
  canopy *= 1.0-hardPaved;
  canopy *= 1.0-max(lotGravel,lotRim);
  // ---- roads: painted`);
  out=replace(out,'    albedo = mix(albedo, surface, onRoad);',`    // LOT_GRAVEL: an owner gravel lot covers a track or gravel lane that crosses it (before any asphalt over it).
    if(lotGravel>0.0&&rkind>2.5&&rkind<4.5)surface=mix(surface,pavedLotGravel(p),min(lotGravel/max(1.0-hardPaved,0.001),1.0));
    // PAVED_APRON: only selected short gravel/driveway mouths; native paved lanes retain their paint.
    if(hardPaved>0.0&&rkind>2.5&&rkind<4.5)surface=mix(surface,pavedLotAsphalt(p),hardPaved);
    albedo = mix(albedo, surface, onRoad);`);
  out=replace(out,'    albedo = mix(albedo, gravel, shoulder * 0.85',`    shoulder *= 1.0-hardPaved;
    albedo = mix(albedo, gravel, shoulder * 0.85`);
  // Small survey slopes are lit strongly at this low sun angle. Give the asphalt finish
  // a level shading normal; the real mesh/contact slope and native paved-road normals stay unchanged.
  out=replace(out,'  float tree = smoothstep',`  float pavementFinish=hardPaved*(1.0-onRoad*step(rkind,2.5));
  if(pavementFinish>0.0){
    n=normalize(mix(n,vec3(0.0,1.0,0.0),pavementFinish));
    float finishGloss=pow(1.0-clamp(abs(dot(normalize(cameraPosition-vWorld),n)),0.0,1.0),4.0);
    albedo*=1.0+.012*finishGloss*pavementFinish;
  }
  float tree = smoothstep`);
  return replace(out,'    albedo *= 1.0 - ring *',`    ring *= 1.0-hardPaved;
    ring *= 1.0-lotGravel;
    albedo *= 1.0 - ring *`);
}
export function pavedGrassShader(source:string):string {
  let out=replace(source,'void main() {',PAVED_SAMPLE+'\nvoid main() {');
  return replace(out,'  vec2 toCar =',`  vec2 lotHere=pavedClasses(base.xz);
  fade *= 1.0-step(0.01,max(lotHere.r,lotHere.g));
  if(fade>0.0){
    // MOWN_VERGE: tufts within about 3 m of a lot are cut short, so a lot shows from the road over its verge.
    vec2 lotNear=max(max(pavedClasses(base.xz+vec2(3.0,0.0)),pavedClasses(base.xz-vec2(3.0,0.0))),
                     max(pavedClasses(base.xz+vec2(0.0,3.0)),pavedClasses(base.xz-vec2(0.0,3.0))));
    fade *= 1.0-0.7*smoothstep(0.0,0.5,max(lotNear.r,lotNear.g))*pavedCarFade(base.xz);
  }
  vec2 toCar =`);
}
