#!/usr/bin/env python3
"""Rendered face guard: axis-aligned gradient energy at 3–24 pixel cell periods.

A paired render holds land, shadows, lighting and camera fixed and replaces only
the quarry mineral branch with its even warm base. Subtraction isolates painted
fractures from real bench edges. A fixed wall crop excludes sky, rail and rubble.
Remove a fitted light
plane, Hann-window it, then measure squared-gradient spectral energy within seven
degrees of either pixel axis in the cell-period band, divided by all gradient
energy. Broad shade is below this band; oblique, thin AA fractures do not fill it.
"""
import argparse,json
from pathlib import Path
import numpy as np
from PIL import Image
p=argparse.ArgumentParser();p.add_argument('image');p.add_argument('--limit',type=float,default=.12);p.add_argument('--report');p.add_argument('--control',required=True);a=p.parse_args()
rgb=np.asarray(Image.open(a.image).convert('RGB'),dtype=float)/255
x0,y0,x1,y1=(160,220,620,345)
control=np.asarray(Image.open(a.control).convert('RGB'),dtype=float)/255
g=(rgb[y0:y1,x0:x1]-control[y0:y1,x0:x1])@np.array([.2126,.7152,.0722]);h,w=g.shape
y,x=np.mgrid[:h,:w];X=np.c_[np.ones(h*w),x.ravel(),y.ravel()]
g-=(X@np.linalg.lstsq(X,g.ravel(),rcond=None)[0]).reshape(h,w)
g*=np.hanning(h)[:,None]*np.hanning(w)[None,:]
P=abs(np.fft.fft2(g))**2;fy=np.fft.fftfreq(h)[:,None];fx=np.fft.fftfreq(w)[None,:];r=np.sqrt(fx*fx+fy*fy)
energy=P*r*r
axis=np.minimum(abs(fx),abs(fy))<=np.maximum(abs(fx),abs(fy))*np.tan(np.deg2rad(7))
band=(r>=1/24)&(r<=1/3)
share=float(energy[axis&band].sum()/max(energy.sum(),1e-20))
result={'image':str(a.image),'control':a.control,'crop':[x0,y0,x1,y1],'periodPixels':[3,24],'axisDegrees':7,'axisGradientShare':share,'limit':a.limit,'exit':int(share>a.limit)}
print(json.dumps(result))
if a.report:Path(a.report).write_text(json.dumps(result,indent=2)+'\n')
raise SystemExit(result['exit'])
