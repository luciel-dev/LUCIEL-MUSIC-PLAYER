import numpy as np, wave, subprocess
SR=44100
def click_track(bpm, secs=40, hats=False, path=None):
    n=SR*secs; x=np.zeros(n); t=np.arange(int(0.05*SR))/SR
    beat=60/bpm; i=0
    while i*beat < secs-0.1:
        s=int(i*beat*SR); f=1500 if i%4==0 else 1000
        c=np.sin(2*np.pi*f*t)*np.exp(-t*90)*(0.9 if i%4==0 else 0.6)
        k=0.8*np.sin(2*np.pi*(60+80*np.exp(-t*40))*t)*np.exp(-t*25)
        e=min(n,s+len(t)); x[s:e]+=(c+k)[:e-s]
        if hats:
            h=s+int(beat/2*SR); rng=np.random.default_rng(i)
            if h+len(t)<n: x[h:h+len(t)]+=0.25*rng.standard_normal(len(t))*np.exp(-t*120)
        i+=1
    x/=np.abs(x).max()*1.1
    pcm=(np.stack([x,x],1)*32767).astype('<i2')
    with wave.open(path,'wb') as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
for b in (70,110,140): click_track(b, path=f'bpm/click-{b}.wav')
click_track(70, hats=True, path='bpm/click-70-hats.wav')
click_track(140, hats=True, path='bpm/click-140-hats.wav')
click_track(87, path='/tmp/c87.wav')
subprocess.run(['ffmpeg','-v','error','-y','-i','/tmp/c87.wav','-c:a','libmp3lame','-b:a','128k','-id3v2_version','3','-metadata','title=Tagged 88','-metadata','TBPM=88','bpm/tagged-tbpm-88.mp3'],check=True)
print('ok')
