/** This module graph is loaded only for West Bay: the published build puts it in a chunk of its own (quarry-feature), and it runs when West Bay imports it. */
import {QuarrySite} from './quarry-site';
import {Quarry} from './quarry';
import {QuarryJourney,quarryCard} from './quarry-journey';
import {loadQuarryRoute} from './quarry-route-ground';
import {createQuarryStuntPark,quarryCoursePlaces} from './quarry-stunt-park';
export function load(){return {QuarrySite,Quarry,QuarryJourney,quarryCard,loadQuarryRoute,createQuarryStuntPark,quarryCoursePlaces};}
