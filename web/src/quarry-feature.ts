/** This module graph is loaded only for West Bay; the flat build also defers all its initializers. */
import {QuarrySite} from './quarry-site';
import {Quarry} from './quarry';
import {QuarryJourney,quarryCard} from './quarry-journey';
import {loadQuarryRoute} from './quarry-route-ground';
export function load(){return {QuarrySite,Quarry,QuarryJourney,quarryCard,loadQuarryRoute};}
