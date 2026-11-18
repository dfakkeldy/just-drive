// Fast visual iteration; final acceptance remains quarry-browser.mjs.
import {open} from './cdp.mjs';
const[out,url]=process.argv.slice(2),origin=new URL(url).origin,p=await open(url);
try{
 for(const [name,cam] of Object.entries({
  'west-wall-close-v2':'631825,5064430,12,295,-12,65',
  'lake-shore-v2':'631810,5064460,2.8,70,-8,60',
  'gate-v2':'632004,5061889,2.2,350,4,65',
  'gate-approach':'632050.47,5061797.58,2.2,333.24,4,60',
  'wall-from-water':'631870,5064500,2.8,270,12,60',
  'sc-air-north-v2':'631900,5063300,450,350,-32,60',
 })){
  await p.navigate(`${origin}/?area=westbay&mode=explore&cam=${cam}&camground=1&exag=1.5&hud=0&radio=0&res=1&shadows=1`);
  await p.shot(`${out}/${name}.png`);console.log('PICTURE',name);
 }
}finally{await p.close();}
