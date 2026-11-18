// On a phone the page must not zoom: a zoomed game cannot be played, and with every finger on a control there is no
// way to pinch back out. The viewport tag says so already, but Safari on a phone ignores that part of the tag, and
// two quick taps on the map's header, the gauge, the radio or the gear zoomed the page (seen on an iPhone and
// reproduced in the iOS Simulator; with this file the same taps do not zoom there).
//
//   1. touch-action on the root: the browser may scroll with a touch, and nothing else. No double-tap zoom, no pinch.
//      (Controls that take over a touch altogether have touch-action: none of their own; panels that scroll still do.)
//   2. Safari's own pinch events are refused, and a double click is refused.
export function noZoom(doc: Document = document): void {
  doc.documentElement.style.touchAction = 'pan-x pan-y';
  const refuse = (e: Event) => e.preventDefault();
  for (const type of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) doc.addEventListener(type, refuse, { passive: false });
}
