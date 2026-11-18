import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {dirname} from 'node:path';
/** Validate what ships after promotion; otherwise use an explicit/rehearsal pack. */
export function farPack(root,override=process.env.FAR_VIEWS_BAKE){
 const baked=root+'/data/baked';
 if(override)return existsSync(override+'/terrain/far-land.json')?override:null;
 if(existsSync(baked+'/terrain/far-land.json')&&JSON.parse(readFileSync(baked+'/terrain/tall.json')).version===2)return baked;
 if(!existsSync(baked))return null;
 const work=dirname(realpathSync(baked))+'/work/bakes/far-views';
 return existsSync(work+'/terrain/far-land.json')?work:null;
}
