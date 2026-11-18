// Same bilinear arithmetic as Terrain.landHeightAt, with a cached finest-tile lookup for the probe only.
// Special contact/deck sites fall back to Terrain.heightAt. Every new tile is checked for exact equality.
export function physicsHeight(x,z){
 const f=window.qf,t=f.terrain;
 for(const s of t.sites)if((s.contactMesh||s.deckHeight)&&x>=s.box[0]&&x<=s.box[2]&&z>=s.box[1]&&z<=s.box[3])return t.heightAt(x,z);
 let tile=f.lastPhysicsTile;if(!tile?.ready||!tile.ground||tile.level!==t.maxLevel||x<tile.x0||x>=tile.x0+tile.size||z<tile.z0||z>=tile.z0+tile.size){tile=t.find(x,z);f.lastPhysicsTile=tile;}
 if(!tile)return null;
 const fa=((x-tile.x0)/tile.size)*256,fb=((z-tile.z0)/tile.size)*256,a=Math.min(Math.floor(fa),255),b=Math.min(Math.floor(fb),255),u=fa-a,v=fb-b,g=tile.ground,n=257;
 const h=(g[b*n+a]*(1-u)+g[b*n+a+1]*u)*(1-v)+(g[(b+1)*n+a]*(1-u)+g[(b+1)*n+a+1]*u)*v;
 if(!(f.checkedPhysicsTiles??=new WeakSet()).has(g)){const expected=t.heightAt(x,z);if(h!==expected)throw Error('Physics probe arithmetic differs '+JSON.stringify({h,expected,x,z}));f.checkedPhysicsTiles.add(g);}
 return h;
}
