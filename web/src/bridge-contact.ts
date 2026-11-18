/** A surface belongs only to a caller with a finite previous wheel/body height. */
export const DECK_CONTACT_BAND = .5;
export function deckWithinReach(deck:number|null, referenceY?:number):deck is number {
  return deck!==null && referenceY!==undefined && Number.isFinite(referenceY) && deck<=referenceY+DECK_CONTACT_BAND;
}

/** 1884 (cart roads) has no road over another road, so an era timber deck always counts, as before the reach rule;
 *  the reach rule is for modern overpasses, where a deck overhead must not lift a car off the road beneath it. */
export function deckCounts(deck:number|null, referenceY:number|undefined, cartRoads:boolean|undefined):deck is number {
  return cartRoads ? deck!==null : deckWithinReach(deck,referenceY);
}

/** Runtime-only paint mask. Bit 16 remains the source bridge flag; bit 32 is washboard. */
export const BRIDGE_PAINT_MASK = 64;
