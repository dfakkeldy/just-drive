/** Derived row runs for the CPU. No source pixels, canvas readback or GPU resource.
 * Zero means today's ordinary policy; only confirmed mineral (6) and open wetland
 * (8) need CPU clearing. The full ground tint stays in cover.png's existing B byte.
 */
export interface GroundMeta {file:string;version:1;width:number;height:number}
export class GroundCover {
  private readonly starts:Uint32Array;
  private readonly lengths:Uint16Array;
  private readonly classes:Uint8Array;
  private readonly rows:Uint32Array;
  constructor(buffer:ArrayBuffer,readonly width:number,readonly height:number) {
    const d=new DataView(buffer);
    if(d.byteLength<16||d.getUint32(0,true)!==0x31304347||d.getUint32(4,true)!==width||d.getUint32(8,true)!==height||
       !Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>65535||height>65535)throw Error('Invalid ground class header');
    const count=d.getUint32(12,true);
    if(16+count*8!==d.byteLength)throw Error('Invalid ground class length');
    this.starts=new Uint32Array(count);this.lengths=new Uint16Array(count);this.classes=new Uint8Array(count);this.rows=new Uint32Array(height+1);
    let end=0,row=0;
    for(let i=0;i<count;i++){
      const at=16+i*8,start=d.getUint32(at,true),length=d.getUint16(at+4,true),cls=d.getUint8(at+6),r=Math.floor(start/width);
      if(start<end||!length||start+length>width*height||Math.floor((start+length-1)/width)!==r||
         (cls!==6&&cls!==8)||d.getUint8(at+7)!==0)throw Error('Invalid ground class run');
      while(row<=r)this.rows[row++]=i;
      this.starts[i]=start;this.lengths[i]=length;this.classes[i]=cls;end=start+length;
    }
    while(row<=height)this.rows[row++]=count;
  }
  /** Same nearest cell as coverRect/tCover; binary search only this row's short run list. */
  at(u:number,v:number):number {
    if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||v<0||u>=1||v>=1)return 0;
    const row=Math.floor(v*this.height),key=row*this.width+Math.floor(u*this.width);
    let lo=this.rows[row],hi=this.rows[row+1];
    while(lo<hi){const mid=(lo+hi)>>>1;if(this.starts[mid]<=key)lo=mid+1;else hi=mid;}
    const i=lo-1;
    return i>=this.rows[row]&&key<this.starts[i]+this.lengths[i]?this.classes[i]:0;
  }
  get byteLength():number{return this.starts.byteLength+this.lengths.byteLength+this.classes.byteLength+this.rows.byteLength;}
}
export function clearsGroundTrees(cls:number):boolean{return cls===6||cls===8;}
export function growsGroundGrass(cls:number):boolean{return cls!==4&&cls!==6&&cls!==7&&cls!==10&&cls!==12;}
