// Exercise the real band, including its overflow-only padding, without changing game state.
import assert from 'node:assert/strict';
export async function checkScrollMore(read, scrollerId, bandId) {
  const state=()=>read(`(()=>{const s=document.getElementById('${scrollerId}'),b=document.getElementById('${bandId}');return {room:s.classList.contains('moreRoom'),band:!b.hidden,overflow:s.scrollHeight>s.clientHeight+1};})()`);
  const frame=()=>read(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  const bandFits=async()=>{
    assert.ok(await read(`(()=>{const s=document.getElementById('${scrollerId}'),b=document.getElementById('${bandId}'),r=s.getBoundingClientRect(),q=b.getBoundingClientRect();return !b.hidden&&q.width>0&&q.height>0&&Math.abs(q.bottom-r.bottom)<=1&&q.width<=s.clientWidth+1&&q.left>=r.left-1&&q.right<=r.left+s.clientWidth+1;})()`),'visible band sits on the scroller bottom and fits its client width');
    assert.equal(await read(`getComputedStyle(document.getElementById('${bandId}')).pointerEvents`),'none','visible band lets pointer hits reach the content below');
  };
  await read(`document.getElementById('${scrollerId}').scrollTop=0`);await frame();
  let s=await state();assert.equal(s.band,s.overflow,'band shows at the top exactly when content overflows');
  if(s.band)await bandFits();
  await read(`document.getElementById('${scrollerId}').scrollTop=1e6`);await frame();
  assert.equal((await state()).band,false,'band hides at the end');
  assert.ok(await read(`(()=>{const s=document.getElementById('${scrollerId}'),b=[...s.querySelectorAll('button')].filter(e=>e.getClientRects().length).at(-1);return !b||b.getBoundingClientRect().bottom<=s.getBoundingClientRect().bottom+1;})()`),'last button clears the band at the end');
  const saved=await read(`document.getElementById('${scrollerId}').style.cssText`);
  try {
    await read(`(()=>{const s=document.getElementById('${scrollerId}');s.style.setProperty('height','120px','important');s.style.setProperty('max-height','120px','important');s.style.flex='none';s.scrollTop=0;})()`);await frame();
    s=await state();assert.ok(s.overflow&&s.room&&s.band,'overflow adds padding and a visible band');
    await bandFits();
    await read(`(()=>{const s=document.getElementById('${scrollerId}');s.style.setProperty('height','auto','important');s.style.setProperty('max-height','none','important');s.scrollTop=0;})()`);await frame();
    s=await state();assert.deepEqual(s,{room:false,band:false,overflow:false},'no overflow leaves no padding or band');
  } finally {
    await read(`(()=>{const s=document.getElementById('${scrollerId}');s.style.cssText=${JSON.stringify(saved)};s.scrollTop=0;})()`);await frame();
  }
}
