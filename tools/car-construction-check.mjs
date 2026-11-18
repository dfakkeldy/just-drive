#!/usr/bin/env node
// Construction work and mounting-contour contracts, using the real production rig.
import assert from 'node:assert/strict';
process.on('uncaughtException',error=>{console.error(error.name+': '+error.message);process.exit(1);});
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { canvasStub } from './mp-models-build.mjs';
import { lampSideStandouts, lampSurfaceChecks } from './car-lamp-fit.mjs';
export const carMutants = [
  {name:'lamp-push-1cm',kind:'fit',from:'const outside = (low + high) / 2 - .0020',to:'const outside = (low + high) / 2 - .0020 + .010',gate:/rear lamp side standout/},
  {name:'lamp-push-3cm',kind:'fit',from:'const outside = (low + high) / 2 - .0020',to:'const outside = (low + high) / 2 - .0020 + .030',gate:/rear lamp side standout/},
  {name:'no-recess-cut',kind:'overlap',from:'function cutTailSockets(tailBodyParts: THREE.Mesh[], bands: TailBand[], minFront: number, tailWork: TailWork): void {',to:'function cutTailSockets(tailBodyParts: THREE.Mesh[], bands: TailBand[], minFront: number, tailWork: TailWork): void { return;',gate:/body skin over rear lamp lens/},
  {name:'notch-mask-removed',kind:'overlap',from:'const jointActive = mid >= joint0 && mid <= joint1;',to:'const jointActive = false;',gate:/body skin over rear lamp lens/},
  {name:'dividers-proud-1cm',kind:'divider',from:'const dividerOffset = .001;',to:'const dividerOffset = .011;',gate:/rear lamp dividers are present and seated/},
  {name:'dividers-removed',kind:'divider',from:'for (const split of [.25, .60]) mesh(surface',to:'for (const split of [] as number[]) mesh(surface',gate:/rear lamp dividers are present and seated/},
  {name:'socket-walls-removed',kind:'socket',from:'mesh(walls, rubber);',to:'walls.dispose();',gate:/rear lamp socket closed/},
  {name:'all-bands-rescanned',kind:'work',from:'while (lo < hi) { const mid = (lo + hi) >>> 1; if (bands[mid].y1 <= y0 + 1e-9) lo = mid + 1; else hi = mid; }',to:'// Regression: start every fragment at the first remaining band.',gate:/lamp recess work stays within local-band budget/},
  {name:'panel-beltline-moved',kind:'gasket',from:'[1.90, .862, 1.160]',to:'[1.90, .862, 1.180]',gate:/gasket follows panel transitions/},
];
export function assertLampFit(fit) {
  assert.ok(fit.length===2&&fit.every(l=>l.samples>=12&&l.misses===0&&l.maxStandout<=.006),'rear lamp side standout stays within 0.6 cm: '+JSON.stringify(fit));
}
export function assertLampSurfaces(surface) {
  assert.ok(surface.sides.length===2&&surface.sides.every(s=>s.samples>1000&&s.paintHits===0&&s.rubberHits===0),'body skin over rear lamp lens: '+JSON.stringify(surface.sides));
}
export function assertLampDividers(surface) {
  assert.ok(surface.dividers.length===4&&surface.dividers.every(d=>d.samples>=16&&d.hits===d.samples&&d.maxOffset<=.003),'rear lamp dividers are present and seated within 3 mm: '+JSON.stringify(surface.dividers));
}
export function assertLampSockets(surface) {
  assert.ok(surface.sockets.length===2&&surface.sockets.every(s=>s.edges>=60&&s.samples>=800&&s.misses===0&&s.maxRecess<=.04),'rear lamp socket closed within 40 mm of the edge: '+JSON.stringify(surface.sockets));
}
async function inspect(mutation) {
  const root=new URL('../',import.meta.url).pathname;let source=readFileSync(root+'web/src/car.ts','utf8');
  if(mutation){assert.equal(source.split(mutation.from).length,2,'unique car mutant '+mutation.name);source=source.replace(mutation.from,mutation.to);}
  const contour=!mutation||mutation.kind==='gasket';let gasket;
  globalThis.__carConstruction=contour?({gasketEdge,gasketPoint})=>{
    let error=0,worst=0,segment=0;
    // Compare the drawn gasket's piecewise line with the actual panel query at
    // 0.056 mm height steps, including the short beltline transitions.
    for(let i=1;i<16000;i++){
      const t=i/16000,y=.70+t*.89;while(segment<gasketEdge.length-2&&gasketEdge[segment+1][1]<y)segment++;
      const a=gasketEdge[segment],b=gasketEdge[segment+1],f=(y-a[1])/(b[1]-a[1]);
      const delta=Math.abs(a[0]+(b[0]-a[0])*f-gasketPoint(1,t)[0]);if(delta>error){error=delta;worst=t;}
    }
    gasket={samples:15999,error,worst};
  }:undefined;
  assert.equal(source.split('  // Release the construction-only skin and fitting caches.').length,2,'construction probe anchor');
  source=source.replace('  // Release the construction-only skin and fitting caches.','  (globalThis as any).__carConstruction?.({gasketEdge,gasketPoint});\n  // Release the construction-only skin and fitting caches.');
  const bundled=await build({stdin:{contents:source,resolveDir:root+'web/src',loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
  const {createCar}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
  canvasStub();let car;
  try {
    car=createCar();const fit=lampSideStandouts(car),surface=lampSurfaceChecks(car),work=car.root.userData.tailLampFit;let triangles=0;
    car.root.traverse(n=>{if(n.isMesh)triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3*(n.isInstancedMesh?n.count:1);});
    if(mutation)console.log('MUTANT '+mutation.name+' '+JSON.stringify({triangles,fit,work,gasket,surface}));
    if(!mutation||mutation.kind==='fit')assertLampFit(fit);
    if(!mutation||mutation.kind==='overlap')assertLampSurfaces(surface);
    if(!mutation||mutation.kind==='divider')assertLampDividers(surface);
    if(!mutation||mutation.kind==='socket')assertLampSockets(surface);
    if(!mutation||mutation.kind==='work')assert.ok(work.visits<4000&&work.planeTests<110000&&work.candidates<1500,'lamp recess work stays within local-band budget: '+JSON.stringify(work));
    if(contour)assert.ok(gasket.error<=.00065,'gasket follows panel transitions within 0.65 mm: '+JSON.stringify(gasket));
    assert.ok(triangles<40000,'car construction triangle budget');
    return {triangles,fit,work,gasket,surface};
  } finally {globalThis.__carConstruction=undefined;car?.root.traverse(n=>{if(n.isMesh)n.geometry.dispose();});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  console.log('PASS car construction '+JSON.stringify(await inspect()));
  if(process.argv.includes('--mutations'))for(const mutation of carMutants){
    let error;try{await inspect(mutation);}catch(e){error=e;}
    assert.ok(error?.name==='AssertionError'&&mutation.gate.test(error.message),mutation.name+' must fail its intended gate; got '+error?.name+': '+error?.message);
    console.log('KILLED '+mutation.name+' by '+mutation.gate.source);
  }
}
