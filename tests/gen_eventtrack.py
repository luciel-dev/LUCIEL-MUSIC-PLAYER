#!/usr/bin/env python3
"""synthetic 34 s track with one of each music event: quiet pad 0-6 s, groove, loud hit @10 s, bass drop @14 s,
build 20-24 s, vowel-formant 'vocals' 24-34 s  ->  argv[1] (wav)"""
import sys, numpy as np, wave
sr=44100; T=34; t=np.arange(sr*T)/sr; y=np.zeros_like(t)
def seg(a,b): return (t>=a)&(t<b)
y+= seg(0,6)*0.01*np.sin(2*np.pi*220*t)
beat=(t*2)%1; kick=np.sin(2*np.pi*55*t)*np.exp(-beat*18)
hat=np.random.default_rng(1).normal(0,1,len(t))*np.exp(-((t*4)%1)*40)
y+= seg(6,10)*(0.25*kick+0.03*hat)
y+= seg(10,10.4)*np.random.default_rng(2).normal(0,0.8,len(t))*np.exp(-(t-10)*6)
y+= seg(10.4,14)*(0.25*kick+0.03*hat)
y+= seg(14,20)*(0.85*kick+0.35*np.sin(2*np.pi*45*t)+0.05*hat)
sw=np.sign(np.sin(2*np.pi*(200+(t-20)*150)*t)); y+= seg(20,24)*((t-20)/4)*0.35*sw
f0=180+20*np.sin(2*np.pi*3*t); ph=np.cumsum(f0)/sr
form=sum(np.exp(-((k*f0-700)/150)**2)*np.sin(2*np.pi*k*ph)+0.6*np.exp(-((k*f0-1200)/200)**2)*np.sin(2*np.pi*k*ph) for k in range(1,25))
y+= seg(24,34)*(0.5*form+0.01*hat)
d=(np.clip(y,-1,1)*30000).astype(np.int16)
w=wave.open(sys.argv[1],'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(d.tobytes()); w.close()
