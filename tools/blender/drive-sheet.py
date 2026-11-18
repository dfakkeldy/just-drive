"""Real-game comparison sheet: today's code car beside the Blender car, one row per view.
Usage: python3 tools/blender/drive-sheet.py data/work/threads/blender-car/pass5
Reads <folder>/code-<view>.png and blender-<view>.png (tools/blender-car-drive.mjs writes them) and drive.json.
Requires Pillow. Pictures are working files: they are never committed.
"""
from pathlib import Path
import json
import sys
from PIL import Image, ImageDraw, ImageFont

folder = Path(sys.argv[1])
w, h = 720, 500
VIEWS = [('hwy19-noon-chase', 'Highway 19, Mabou village, noon: chase'), ('hwy19-noon-seat', 'Highway 19, noon: driver\'s seat'),
         ('hwy19-dusk-chase', 'Highway 19, dusk: chase'), ('hwy19-dusk-seat', 'Highway 19, dusk: driver\'s seat'),
         ('mines-noon-chase', 'Mabou Mines Road washboard, noon: chase'), ('mines-noon-seat', 'Mabou Mines Road, noon: driver\'s seat'),
         ('mines-dusk-chase', 'Mabou Mines Road, dusk: chase'), ('mines-dusk-seat', 'Mabou Mines Road, dusk: driver\'s seat'),
         ('mines-muddy', 'A muddy run: full dirt, from the roadside'),
         ('dusk-front', 'Dusk, from the front: head lamp units and sign'),
         ('night-rear', 'Night: tail, brake, high brake, amber lamp, sign (brake and amber held on by the script)'),
         ('night-front', 'Night, from the front: head lamp units and sign'),
         ('night-seat', 'Night: driver\'s seat'),
         ('phone-seat', 'A phone (LOW quality, the camera draws nothing nearer than 0.45 m): driver\'s seat')]
rows = [v for v in VIEWS if (folder / f'blender-{v[0]}.png').exists()]
header, gap = 120, 44
canvas = Image.new('RGB', (w * 2, header + len(rows) * (h + gap)), '#111e29')
d = ImageDraw.Draw(canvas)
try:
    title = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 30)
    label = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 21)
except OSError:
    title = label = ImageFont.load_default()
name = folder.name.replace('pass', 'PASS ').upper()
d.text((24, 18), f'MAIL CAR IN THE REAL GAME / {name}', font=title, fill='#f4efdb')
facts = json.loads((folder / 'drive.json').read_text()) if (folder / 'drive.json').exists() else []
for col, (car, text) in enumerate((('code', 'TODAY / code car  (?car=code)'), ('blender', f'{name} / Blender car  (?car=blender)'))):
    row = next((r for r in facts if r.get('car') == car and not r.get('low')), None)
    extra = f"   {row['triangles']:,} triangles in {row['meshes']} meshes" if row else ''
    d.text((col * w + 24, 70), text + extra, font=label, fill='#d0dce4')
for i, (view, caption) in enumerate(rows):
    y = header + i * (h + gap)
    for col, car in enumerate(('code', 'blender')):
        path = folder / f'{car}-{view}.png'
        if path.exists():
            with Image.open(path) as source:
                canvas.paste(source.convert('RGB').resize((w, h), Image.Resampling.LANCZOS), (col * w, y))
    d.text((24, y + h + 9), caption + ' / same road, hour, camera and drive', font=label, fill='#d0dce4')
canvas.save(folder / 'drive-sheet.png', optimize=True)
print(folder / 'drive-sheet.png')
