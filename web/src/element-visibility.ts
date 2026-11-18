/** Client clipping edges in viewport units, including ancestor zoom or scaling. */
export function clientBounds(element: HTMLElement): { left: number; top: number; right: number; bottom: number } {
  const box = element.getBoundingClientRect();
  const sx = element.offsetWidth ? box.width / element.offsetWidth : 1;
  const sy = element.offsetHeight ? box.height / element.offsetHeight : 1;
  const left = box.left + element.clientLeft * sx, top = box.top + element.clientTop * sy;
  return { left, top, right: left + element.clientWidth * sx, bottom: top + element.clientHeight * sy };
}
