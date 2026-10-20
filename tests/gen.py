import numpy as np, wave, subprocess, base64, struct, os, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter
SR=44100
OUT='media'
font=ImageFont.truetype('/workspace/aero-player/fonts/selawksb.ttf', 44)
fsmall=ImageFont.truetype('/workspace/aero-player/fonts/selawkl.ttf', 26)

def cover(path, c1, c2, title, sub):
    W=500; img=Image.new('RGB',(W,W))
    y,x=np.mgrid[0:W,0:W]/W
    t=(x*0.4+y*0.6)[...,None]
    arr=(np.array(c1)*(1-t)+np.array(c2)*t)
    # soft light blobs
    for cx,cy,r in [(0.25,0.25,0.35),(0.8,0.7,0.3),(0.6,0.15,0.18)]:
        d=np.sqrt((x-cx)**2+(y-cy)**2); arr+= (np.clip(1-d/r,0,1)**2)[...,None]*70
    img=Image.fromarray(np.clip(arr,0,255).astype('uint8'))
    dr=ImageDraw.Draw(img,'RGBA')
    import random; random.seed(title)
    for i in range(14):
        r=random.randint(12,60); cx=random.randint(0,W); cy=random.randint(0,W)
        dr.ellipse([cx-r,cy-r,cx+r,cy+r],outline=(255,255,255,150),width=2,fill=(255,255,255,25))
        dr.ellipse([cx-r*0.55,cy-r*0.6,cx-r*0.2,cy-r*0.25],fill=(255,255,255,160))
    dr.text((34,W-120),title,font=font,fill=(255,255,255,240))
    dr.text((36,W-64),sub,font=fsmall,fill=(255,255,255,200))
    img.save(path, quality=88)

def song(path, root, bpm, secs=24, stereo=True, seed=0):
    rng=np.random.default_rng(seed)
    n=int(SR*secs); t=np.arange(n)/SR
    beat=60/bpm
    prog=[0,5,7,3] ; scale=[0,2,4,7,9,12]
    L=np.zeros(n); R=np.zeros(n)
    # pads
    for bar in range(int(secs/(beat*4))+1):
        s=int(bar*beat*4*SR); e=min(n,int((bar+1)*beat*4*SR))
        if s>=n: break
        tt=t[s:e]-t[s]
        deg=prog[bar%4]
        for k,iv in enumerate([0,4,7,11]):
            f=root*2**((deg+iv)/12)
            env=np.minimum(1,tt/0.4)*np.exp(-tt*0.25)
            v=0.06*env*(np.sin(2*np.pi*f*tt)+0.3*np.sin(2*np.pi*2*f*tt+0.3))
            L[s:e]+=v*(1-k*0.15); R[s:e]+=v*(0.55+k*0.15)
        # bass
        fb=root/2*2**(deg/12)
        for q in range(4):
            bs=s+int(q*beat*SR); be=min(e,bs+int(beat*SR))
            if bs>=e: break
            tb=t[bs:be]-t[bs]
            b=0.22*np.exp(-tb*4)*np.tanh(2*np.sin(2*np.pi*fb*tb))
            L[bs:be]+=b; R[bs:be]+=b
    # arpeggio
    step=beat/2
    for i in range(int(secs/step)):
        s=int(i*step*SR); e=min(n,s+int(step*SR))
        tt=t[s:e]-t[s]
        bar=int(i*step/(beat*4)); deg=prog[bar%4]
        f=root*2*2**((deg+scale[rng.integers(0,len(scale))])/12)
        v=0.09*np.exp(-tt*6)*(np.sign(np.sin(2*np.pi*f*tt))*0.3+np.sin(2*np.pi*f*tt))
        pan=0.5+0.4*math.sin(i*0.7)
        L[s:e]+=v*(1-pan)*1.4; R[s:e]+=v*pan*1.4
    # drums
    for i in range(int(secs/beat)):
        s=int(i*beat*SR); e=min(n,s+int(0.3*SR)); tt=t[s:e]-t[s]
        kick=0.5*np.exp(-tt*14)*np.sin(2*np.pi*(50+90*np.exp(-tt*30))*tt)
        L[s:e]+=kick; R[s:e]+=kick
        hs=int((i+0.5)*beat*SR); he=min(n,hs+int(0.06*SR))
        if hs<n:
            th=t[hs:he]-t[hs]; hat=0.08*np.exp(-th*60)*rng.standard_normal(he-hs)
            hat=np.diff(np.concatenate([[0],hat]))
            L[hs:he]+=hat; R[hs:he]+=hat*0.8
        if i%2==1:
            sn=0.18*np.exp(-tt*18)*rng.standard_normal(e-s); L[s:e]+=sn; R[s:e]+=sn
    fade=np.minimum(1,np.minimum(t/0.5,(secs-t)/1.5))
    L*=fade; R*=fade
    m=max(np.abs(L).max(),np.abs(R).max()); L/=m*1.12; R/=m*1.12
    data=np.stack([L,R],1) if stereo else ((L+R)/2)[:,None]
    pcm=(data*32767).astype('<i2')
    with wave.open(path,'wb') as w:
        w.setnchannels(2 if stereo else 1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

def run(*a):
    subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error',*a],check=True)

def flac_pic_b64(jpg):
    data=open(jpg,'rb').read(); mime=b'image/jpeg'
    blk=struct.pack('>I',3)+struct.pack('>I',len(mime))+mime+struct.pack('>I',0)+struct.pack('>IIII',500,500,24,0)+struct.pack('>I',len(data))+data
    return base64.b64encode(blk).decode()

tracks=[
 dict(fn='01 - Skyline Bubbles.mp3', title='Skyline Bubbles', artist='Aqua Vista', album='Frutiger Dreams', year='2007', genre='Electronic', track='1', root=220, bpm=112, c=((40,140,230),(200,240,255))),
 dict(fn='02 - Glass Lagoon.flac', title='Glass Lagoon', artist='Aqua Vista', album='Frutiger Dreams', year='2007', genre='Ambient', track='2', root=196, bpm=96, c=((20,90,180),(150,255,220))),
 dict(fn='03 - Neon Ooze.ogg', title='Neon Ooze', artist='Slimewave', album='Toxic Tides', year='2009', genre='Techno', track='3', root=165, bpm=128, c=((10,40,5),(125,255,26))),
 dict(fn='04 - Midnight Transit.opus', title='Midnight Transit', artist='Deep Navy', album='Night Lines', year='2011', genre='Synthwave', track='4', root=185, bpm=104, c=((5,15,50),(60,140,255))),
 dict(fn='05 - Ember Signal.m4a', title='Ember Signal', artist='Crimson Arc', album='Heat Map', year='2013', genre='Rock', track='5', root=147, bpm=120, c=((40,0,8),(255,60,70))),
 dict(fn='06 - Silver Morning.wav', title='Silver Morning', artist='Aqua Vista', album='Frutiger Dreams', year='2007', genre='Pop', track='6', root=262, bpm=100, c=((160,175,190),(235,245,255))),
 dict(fn='07 - Pulse Garden.webm', title='Pulse Garden', artist='Slimewave', album='Toxic Tides', year='2009', genre='Dance', track='7', root=175, bpm=124, c=((0,30,10),(180,255,80))),
 dict(fn='08 - Legacy Codec.wma', title='Legacy Codec', artist='Old Format', album='Compat Test', year='2004', genre='Other', track='8', root=200, bpm=110, c=((80,80,80),(160,160,160))),
]
os.makedirs(OUT,exist_ok=True)
for i,t in enumerate(tracks):
    wav=f'/tmp/src{i}.wav'; jpg=f'/tmp/cover{i}.jpg'
    song(wav,t['root'],t['bpm'],secs=22+i*2,seed=i, stereo=(i!=5))
    cover(jpg,*t['c'],t['title'],t['artist'])
    meta=[]
    for k in ['title','artist','album','genre','track']: meta+=['-metadata',f"{k}={t[k]}"]
    meta+=['-metadata',f"date={t['year']}"]
    out=os.path.join(OUT,t['fn']); ext=t['fn'].rsplit('.',1)[1]
    if ext=='mp3':
        run('-i',wav,'-i',jpg,'-map','0:a','-map','1:v','-c:a','libmp3lame','-b:a','192k','-c:v','copy','-id3v2_version','3','-disposition:v','attached_pic','-metadata:s:v','title=Album cover','-metadata:s:v','comment=Cover (front)',*meta,out)
    elif ext=='flac':
        run('-i',wav,'-i',jpg,'-map','0:a','-map','1:v','-c:a','flac','-c:v','copy','-disposition:v','attached_pic',*meta,out)
    elif ext in ('ogg','opus'):
        codec='libvorbis' if ext=='ogg' else 'libopus'
        run('-i',wav,'-c:a',codec,'-b:a','128k',*meta,'-metadata',f'METADATA_BLOCK_PICTURE={flac_pic_b64(jpg)}',out)
    elif ext=='m4a':
        run('-i',wav,'-i',jpg,'-map','0:a','-map','1:v','-c:a','aac','-b:a','192k','-c:v','copy','-disposition:v','attached_pic',*meta,out)
    elif ext=='wav':
        run('-i',wav,'-c:a','pcm_s16le',*meta,out)
    elif ext=='webm':
        run('-i',wav,'-c:a','libopus','-b:a','128k',*meta,out)
    elif ext=='wma':
        run('-i',wav,'-c:a','wmav2','-b:a','128k',*meta,out)
    print('made',out,os.path.getsize(out))
