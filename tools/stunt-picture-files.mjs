// Requested review pictures survive the check runner's successful-scratch cleanup.
import {copyFileSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {basename,join} from 'node:path';
import {fileURLToPath} from 'node:url';
export function keepStuntPicture(file,details){
  const root=fileURLToPath(new URL('../',import.meta.url));
  const source=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const parent=join(root,'data/work/stunt-1102-pictures',source.slice(0,12));mkdirSync(parent,{recursive:true});
  const folder=mkdtempSync(join(parent,'capture-')),target=join(folder,basename(file));
  copyFileSync(file,target);
  writeFileSync(target+'.json',JSON.stringify({source,file:basename(file),...details},null,2)+'\n');
  console.log('Review picture retained at '+target);
}
