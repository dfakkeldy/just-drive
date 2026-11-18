// RUN=sxs-pictures.mjs VIEWS='sxs|vehicle=sxs' tools/yard-shots.sh 1400 950
import { open } from './truck-cdp.mjs';
const [out,first]=process.argv.slice(2),origin=new URL(first).origin;
const p=await open(`${origin}/sxs.html?view=front`);
try{for(const [name,view,extra]of [['sxs-front34','front',''],['sxs-rear34','rear',''],['sxs-side','side',''],['sxs-top','top',''],['sxs-suspension','suspension',''],['sxs-with-car-and-truck','front','&pair=1']]){
 if(process.env.SXS_PAIR_ONLY==='1'&&name!=='sxs-with-car-and-truck')continue;
 await p.navigate(`${origin}/sxs.html?view=${view}${extra}`);await p.read(`window.requestAnimationFrame=()=>0;if(document.body.dataset.view==='suspension'){document.querySelector('header').style.display='none';document.querySelector('footer').style.display='none';}for(const w of Object.values(sxsPreview.car.wheels))w.rotation.x=0;sxsPreview.renderer.render(sxsPreview.scene,sxsPreview.camera)`);await p.shot(`${out}/${name}.png`);
}}finally{await p.close();}
