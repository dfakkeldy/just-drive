import {basename} from 'node:path';
import type {Plugin} from 'vite';

/** The park's modules: web/src/quarry*.ts, except quarry-trip.ts (the trip links every area uses, in app.js). */
export const parkModule=(file:string)=>/^quarry(?:-[^/]+)?\.ts$/.test(basename(file))&&basename(file)!=='quarry-trip.ts';

/**
 * The park's modules are in the published build's quarry-feature chunk (web/area-chunks-build.ts), and only West Bay
 * imports it. With QUARRY_EVAL_PROBE=1 (the quarry-published-browser check) each of them records when it runs, so the
 * check sees that none runs outside West Bay. Without it the plugin changes nothing.
 */
export function quarryEvalProbe():Plugin {
  return {name:'quarry-evaluation-probe',apply:'build',transform(code,id){
    if(process.env.QUARRY_EVAL_PROBE!=='1'||!parkModule(id))return null;
    return {code:`(globalThis.__quarryEvaluations??=[]).push(${JSON.stringify(basename(id))});\n`+code,map:null};
  }};
}
