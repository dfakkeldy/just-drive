#!/usr/bin/env python3
"""Draw the fictional, unbadged wagon. Pillow is a build-tool dependency, not shipped code."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
S=1024
im=Image.new('RGB',(S,S),'#0b1620');d=ImageDraw.Draw(im)
d.ellipse((440,105,870,535),fill='#d0632e')
d.polygon([(0,590),(190,410),(370,460),(590,345),(790,445),(1024,365),(1024,1024),(0,1024)],fill='#4b5946')
d.polygon([(0,720),(220,490),(400,530),(630,450),(1024,650),(1024,1024),(0,1024)],fill='#75543b')
d.polygon([(455,505),(563,505),(865,1024),(105,1024)],fill='#182630')
d.polygon([(502,535),(516,535),(529,610),(493,610)],fill='#e9b65c')
d.polygon([(490,653),(531,653),(550,761),(471,761)],fill='#e9b65c')
# All essential art is inside the central maskable circle.
d.ellipse((277,734,752,826),fill='#081017')
d.rounded_rectangle((330,650,396,807),radius=20,fill='#081017');d.rounded_rectangle((628,650,694,807),radius=20,fill='#081017')
d.polygon([(335,611),(363,458),(403,421),(623,421),(663,458),(690,611)],fill='#aab3b9')
d.polygon([(384,463),(640,463),(658,583),(366,583)],fill='#213845')
d.polygon([(400,480),(430,480),(383,567),(370,567)],fill='#526674')
d.rounded_rectangle((321,581,704,759),radius=28,fill='#8e999f')
d.rectangle((333,602,365,686),fill='#d0632e');d.rectangle((660,602,692,686),fill='#d0632e')
d.rectangle((333,650,365,666),fill='#e9b65c');d.rectangle((660,650,692,666),fill='#e9b65c')
d.line((380,614,647,614),fill='#c6cdd0',width=8)
d.rounded_rectangle((314,713,710,751),radius=12,fill='#29363f')
d.rectangle((491,539,624,548),fill='#7e909b')
# Beacon: bright amber core and short rays, no letters or service marks.
d.rounded_rectangle((452,390,573,421),radius=7,fill='#29363f')
d.rounded_rectangle((467,333,559,397),radius=18,fill='#eea138')
d.rounded_rectangle((482,342,512,384),radius=9,fill='#ffe4a0')
for a,b in [((432,354),(403,344)),((594,354),(623,344)),((513,311),(513,281))]:d.line((a,b),fill='#e9b65c',width=12)
for size in (48,180,192,512): im.resize((size,size),Image.Resampling.LANCZOS).save(out/f'icon-{size}.png', optimize=True)
im.resize((512,512),Image.Resampling.LANCZOS).save(out/'maskable-512.png',optimize=True)
