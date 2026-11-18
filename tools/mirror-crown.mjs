import assert from 'node:assert/strict';
// PR #144 (reviewed): mirror reflections keep crown cells as far as the main view. Guards that pin programs to
// origin/main or to an older base read this one line as its old text on both sides; programs.json pins the new text.
const MIRROR_CROWN_NEW='  // Keep crown cells as long as the main view. Early averaging reads as bare land across water.\n  float far = clamp(smoothstep(200.0, 1400.0, dist) + step(6.0, texel), 0.0, 1.0);';
const MIRROR_CROWN_OLD='  float far = clamp(smoothstep(280.0, 420.0, dist) + step(3.0, texel), 0.0, 1.0);';
export function reviewedMirrorCrown(source){
 const n=source.split(MIRROR_CROWN_NEW).length-1;assert.ok(n<=1,'the reviewed mirror crown line stands once at most');
 return source.replace(MIRROR_CROWN_NEW,MIRROR_CROWN_OLD);
}
