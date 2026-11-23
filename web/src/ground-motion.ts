/** A contact correction may supply at most the energy of a three-metre hop.
 * Position correction stays independent; existing airborne velocity still follows gravity.
 * This bounds height-field lips and horizontal collision push-outs without removing crest jumps.
 */
export const MAX_GROUND_RISE_SPEED = Math.sqrt(2 * 9.81 * 3);
