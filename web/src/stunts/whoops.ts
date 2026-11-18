import type {StuntPiece} from '../stunt-kit';
export function whoops(rollers=false):StuntPiece {
  const count=rollers?2:8,spacing=rollers?10:5,height=rollers?.7:.45,length=count*spacing;
  return{id:rollers?'rollers':'whoops',runup:0,board:['BLACK R.:',rollers?'GRAVEL ROLLERS':'GRAVEL GRADING'],footprint:[0,-3.5,length,3.5],decks:[],solids:[],
    ground(u,v){if(u<0||u>length||Math.abs(v)>3.5)return 0;const phase=(u%spacing)/spacing;return height*Math.sin(Math.PI*phase)**2*Math.min(1,(3.5-Math.abs(v))/1);}};
}
