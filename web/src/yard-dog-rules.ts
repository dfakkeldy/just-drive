const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
export class YardDogRules {
  state:'home'|'run'|'bark'|'follow'|'guard'|'return'='home';
  along=0; across=14; bark=false; moving=false;
  private timer=0; private barkIn=0; private armed=true; private direction=1;
  constructor(readonly edge:number) {}
  reset():void {this.state='home';this.along=0;this.across=14;this.bark=false;this.moving=false;this.timer=0;this.barkIn=0;this.armed=true;this.direction=1;}
  update(dt:number,carAlong:number,carAcross:number,velocity:number):void {
    if(dt<=0)return;
    this.bark=false;this.moving=false;this.timer+=dt;this.barkIn-=dt;
    const near=Math.hypot(carAlong,carAcross)<42;
    if(!near&&Math.abs(carAlong)>65)this.armed=true;
    if(this.state==='home'&&this.armed&&near&&Math.abs(carAcross)<10) {
      this.state='run';this.timer=0;this.armed=false;this.direction=Math.sign(velocity)||Math.sign(-carAlong)||1;
    }
    let along=this.along,across=this.across;
    switch(this.state) {
      case 'home':break;
      case 'run':across=this.edge;if(Math.abs(this.across-this.edge)<.1){this.state='bark';this.timer=0;this.barkIn=0;}break;
      case 'bark':if(this.timer>.8){this.state='follow';this.timer=0;}break;
      case 'follow':
        along=clamp(carAlong-this.direction*4,-18,18);
        if((this.direction*carAlong>24&&Math.abs(this.along-along)<.15)||this.timer>10){this.state='guard';this.timer=0;}
        break;
      case 'guard':if(this.timer>2){this.state='return';this.timer=0;}break;
      case 'return':along=0;across=14;if(Math.hypot(this.along,this.across-14)<.1){this.state='home';this.timer=0;}break;
    }
    if((this.state==='bark'||this.state==='follow'||this.state==='guard')&&this.barkIn<=0){this.bark=true;this.barkIn=.85;}
    const dx=along-this.along,dz=across-this.across,d=Math.hypot(dx,dz),step=Math.min(d,(this.state==='return'?2.5:6)*dt);
    if(d>0){this.along=clamp(this.along+dx/d*step,-18,18);this.across=clamp(this.across+dz/d*step,this.edge,14);this.moving=step>.001;}
  }
}
