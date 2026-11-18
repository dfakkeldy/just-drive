import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
export function png(bytes) {
  const chunks=[]; let w,h,channels;
  for(let o=8;o<bytes.length;){const n=bytes.readUInt32BE(o),type=bytes.toString('ascii',o+4,o+8),p=bytes.subarray(o+8,o+8+n);o+=12+n;
    if(type==='IHDR'){w=p.readUInt32BE(0);h=p.readUInt32BE(4);assert.equal(p[8],8);channels=p[9]===2?3:p[9]===6?4:0;assert.ok(channels);assert.equal(p[12],0);}
    if(type==='IDAT')chunks.push(p);
  }
  const raw=inflateSync(Buffer.concat(chunks)),stride=w*channels,decoded=new Uint8Array(stride*h),pixels=new Uint8ClampedArray(w*h*4);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<h;y++)for(let x=0;x<stride;x++){
    const k=y*stride+x,a=x>=channels?decoded[k-channels]:0,b=y?decoded[k-stride]:0,c=y&&x>=channels?decoded[k-stride-channels]:0,f=raw[y*(stride+1)];
    assert.ok(f<=4);decoded[k]=(raw[y*(stride+1)+x+1]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][f])&255;
  }
  for(let i=0;i<w*h;i++){pixels[i*4]=decoded[i*channels];pixels[i*4+1]=decoded[i*channels+1];pixels[i*4+2]=decoded[i*channels+2];pixels[i*4+3]=channels===4?decoded[i*channels+3]:255;}
  return {pixels,width:w,height:h,close(){}};
}
