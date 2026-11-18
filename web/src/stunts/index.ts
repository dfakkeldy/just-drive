import {slipKicker} from './slip';
import {tableTop} from './tabletop';
import {gapPair} from './gap';
import {tankRow} from './tanks';
import {stepDown} from './drop';
import {footbridge} from './footbridge';
import {archTunnel} from './tunnel';
import {whoops} from './whoops';
import type {StuntPiece} from '../stunt-kit';
export {slipKicker,tableTop,gapPair,tankRow,stepDown,footbridge,archTunnel,whoops};
export function allStuntPieces():StuntPiece[]{return[slipKicker('small'),slipKicker('medium'),slipKicker('large'),tableTop(),gapPair(8),archTunnel(),footbridge(),tankRow(),stepDown(.8),stepDown(1.6),stepDown(2.4),whoops(),whoops(true)];}
