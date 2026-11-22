/** A scroll cue stays outside the content and leaves every control reachable. */
export function scrollMore(scroller: HTMLElement, isShown: () => boolean, id: string, host: HTMLElement): void {
  if (typeof getComputedStyle !== 'function' || typeof ResizeObserver !== 'function' || typeof MutationObserver !== 'function' || typeof requestAnimationFrame !== 'function') return;
  const band = Object.assign(document.createElement('div'), { id, className: 'scrollMore', textContent: 'More below ▾', hidden: true });
  band.setAttribute('aria-hidden', 'true'); host.append(band);
  const extra = Math.max(0, 36 - parseFloat(getComputedStyle(scroller).paddingBottom || '0'));
  let pending = false;
  const refresh = () => {
    pending = false;
    if (!isShown()) { band.hidden = true; return; }
    const room = scroller.scrollHeight - (scroller.classList.contains('moreRoom') ? extra : 0) > scroller.clientHeight + 1;
    scroller.classList.toggle('moreRoom', room);
    band.hidden = !room || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    if (!band.hidden) {
      const r = scroller.getBoundingClientRect();
      band.style.left = `${r.left}px`; band.style.top = `${r.bottom - 24}px`; band.style.width = `${scroller.clientWidth}px`;
    }
  };
  const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(refresh); } };
  scroller.addEventListener('scroll', schedule, { passive: true });
  scroller.addEventListener('toggle', schedule, true); addEventListener('resize', schedule);
  new ResizeObserver(schedule).observe(scroller);
  const observer = new MutationObserver(schedule);
  observer.observe(scroller, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'class'] });
  const panel = scroller.closest('#placesPanel');
  if (panel) observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  schedule();
}
