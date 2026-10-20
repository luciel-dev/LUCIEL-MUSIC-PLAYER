const fs=require('fs'); global.window=global;
eval(fs.readFileSync('/workspace/aero-player/js/metadata.js','utf8'));
(async()=>{
 for (const f of fs.readdirSync('media')) {
   const b=new Blob([fs.readFileSync('media/'+f)]); b.name=f;
   const m=await AeroMeta.read(b);
   const pic=m.picture?`${m.picture.mime} ${m.picture.data.length}B`:'none';
   delete m.picture; console.log(f.padEnd(28), JSON.stringify(m), 'pic:',pic);
 }
})();
