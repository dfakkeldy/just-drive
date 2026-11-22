import assert from 'node:assert/strict';
import {FAR_FOREST_REVIEWED} from './far-forest-review.mjs';
// PR #144 (reviewed): mirror reflections keep crown cells as far as the main view. Guards that pin programs to
// origin/main or to an older base read this one line as its old text on both sides; programs.json pins the new text.
const MIRROR_CROWN_NEW='  // Keep crown cells as long as the main view. Early averaging reads as bare land across water.\n  float far = clamp(smoothstep(200.0, 1400.0, dist) + step(6.0, texel), 0.0, 1.0);';
const MIRROR_CROWN_OLD='  float far = clamp(smoothstep(280.0, 420.0, dist) + step(3.0, texel), 0.0, 1.0);';
export function reviewedMirrorCrown(source){
 const n=source.split(MIRROR_CROWN_NEW).length-1;assert.ok(n<=1,'the reviewed mirror crown line stands once at most');
 // The far forest blocks: all of them or none (an older source), never a part.
 const found=FAR_FOREST_REVIEWED.filter(([now])=>source.includes(now)).length;
 assert.ok(found===0||found===FAR_FOREST_REVIEWED.length,'the reviewed far forest blocks stand all together or not at all');
 for(const [now,old] of FAR_FOREST_REVIEWED){assert.ok(source.split(now).length-1<=1,'a reviewed far forest block stands once at most');source=source.replace(now,old);}
 return source.replace(MIRROR_CROWN_NEW,MIRROR_CROWN_OLD);
}
