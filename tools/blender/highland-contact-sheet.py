"""One sheet of the Highland bull pictures that tools/highland-shots.sh wrote. Needs Pillow.

  python3 tools/blender/highland-contact-sheet.py data/work/threads/highland

Reads comparison.json for the costs. An optional verdicts.json ({"side": "text", ...}) adds a note under a picture.
The sheet is a picture: it stays in data/, which is not in git.
"""
from pathlib import Path
import json, sys, textwrap
from PIL import Image, ImageDraw, ImageFont

folder = Path(sys.argv[1])
cells = [('old-vs-new-side', "Today's code-built Highland (left), Blender bull (right): side"),
         ('old-vs-new-front', 'The same two: three-quarter front'),
         ('side', 'Blender bull: side'), ('front34', 'Three-quarter front'),
         ('head', 'Head: horns and forelock'), ('rear34', 'Rear three-quarter (the shadow side)'),
         ('head-turned', 'Head node turned 60 degrees toward the camera'), ('far', 'Desktop model at 14 m, the game lens'),
         ('low-far', 'LOW model at 14 m, the game lens'), ('low-front34', 'LOW model close'),
         ('rail', 'Mock-up: behind the rail, seen from across the road (overcast)'),
         ('rail-close', 'Mock-up: at the rail, with the cliff and the headland (overcast)')]
w, h, pad, text_h, head_h = 716, 458, 14, 96, 120
sheet = Image.new('RGB', (2 * w + 3 * pad, head_h + 6 * (h + text_h) + pad), '#14201c')
draw = ImageDraw.Draw(sheet)
try:
    title = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 30)
    label = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 19)
    note = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 16)
except OSError:
    title = label = note = ImageFont.load_default()
draw.text((pad, 18), 'HIGHLAND BULL / BLENDER MODEL IN THE GAME RENDERER', font=title, fill='#f1ead6')
stats = json.loads((folder / 'comparison.json').read_text())
line = '   |   '.join(f"{name}: {stats[key]['triangles']:,} triangles, {stats[key]['draws']} draws"
                     for name, key in (("today's code-built", 'code'), ('Blender desktop', 'desktop'), ('Blender LOW', 'low')))
draw.text((pad, 68), line, font=label, fill='#b9cfc6')
verdicts = json.loads((folder / 'verdicts.json').read_text()) if (folder / 'verdicts.json').exists() else {}
for i, (name, caption) in enumerate(cells):
    x, y = pad + (i % 2) * (w + pad), head_h + (i // 2) * (h + text_h)
    with Image.open(folder / f'{name}.png') as picture:
        sheet.paste(picture.convert('RGB').resize((w, h), Image.Resampling.LANCZOS), (x, y))
    draw.text((x, y + h + 8), caption, font=label, fill='#e6dfca')
    for j, row in enumerate(textwrap.wrap(verdicts.get(name, ''), 96)[:3]):
        draw.text((x, y + h + 34 + j * 19), row, font=note, fill='#9fb5ac')
sheet.save(folder / 'contact-sheet.png', optimize=True)
print(folder / 'contact-sheet.png')
