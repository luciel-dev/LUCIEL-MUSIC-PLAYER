const fs=require('fs');
const src=fs.readFileSync('/workspace/aero-player/js/bpm.js','utf8');
const w=src.match(/const workerSrc = `([\s\S]*?)`;/)[1];
const analyze=new Function('var DEBUG=1;'+w+'; return analyze;')();
function readWav(p){const b=fs.readFileSync(p);let o=12,data,sr,ch;while(o<b.length){const id=b.toString('latin1',o,o+4),sz=b.readUInt32LE(o+4);if(id==='fmt '){ch=b.readUInt16LE(o+10);sr=b.readUInt32LE(o+12);}if(id==='data'){data=b.subarray(o+8,o+8+sz);}o+=8+sz+(sz&1);}
 const n=data.length/2/ch,D=4,out=new Float32Array(Math.floor(n/D));for(let j=0;j<out.length;j++){let s=0;for(let k=0;k<D;k++)for(let c=0;c<ch;c++)s+=data.readInt16LE(((j*D+k)*ch+c)*2)/32768;out[j]=s/(D*ch);}return {x:out,sr:sr/D};}
for(const f of process.argv.slice(2)){const {x,sr}=readWav(f);const t=Date.now();const r=analyze(x,sr,0);console.log(f.split('/').pop().padEnd(26),JSON.stringify(r),(Date.now()-t)+'ms');}
