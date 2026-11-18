"""Pass 3 comparison sheet: today, pass 2, pass 3, and pass 3 LOW (front row). Original screenshots stay untouched.
Usage: python3 tools/blender/contact-sheet.py data/work/threads/blender-car/pass3
Reads pass 2's pictures and numbers from the sibling folder ../pass2. Requires Pillow.
Optional verdicts.json supplies the per-view verdict and note shown in the fourth column.
"""
from pathlib import Path
import sys, json, textwrap
from PIL import Image, ImageDraw, ImageFont
folder = Path(sys.argv[1]); before = folder.parent / 'pass2'; w, h = 640, 407
views = [('front', 'Front three-quarter'), ('rear', 'Rear three-quarter'), ('side', 'Right side'),
         ('driver-side', 'Right-hand driver detail'), ('dirty', 'Lower-door mud / dirt = 1')]
header = 160
canvas = Image.new('RGB', (w * 4, header + len(views) * (h + 42)), '#111e29'); d = ImageDraw.Draw(canvas)
try:
    title = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 28)
    label = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 20)
    note = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 24)
except OSError:
    title = label = note = ImageFont.load_default()
d.text((24, 17), 'MAIL CAR / PASS 3: A SMOOTH BODY WITH THE DETAILS DRAWN ON IT', font=title, fill='#f4efdb')
for col, text in enumerate(['TODAY / TypeScript', 'PASS 2 / Subdivision', 'PASS 3 / This pass', 'PASS 3 LOW / front only']):
    d.text((col * w + 24, 64), text, font=label, fill='#d0dce4')
stats = json.loads((folder / 'comparison.json').read_text())
old = json.loads((before / 'comparison.json').read_text())
pick = lambda rows, model, detail: next(r for r in rows if r['model'] == model and r['detail'] == detail)
measurements = [pick(stats, 'original', 'desktop'), pick(old, 'blender', 'desktop'), pick(stats, 'blender', 'desktop'), pick(stats, 'blender', 'low')]
maximum = max(r['triangles'] for r in measurements)
for col, r in enumerate(measurements):
    x = col * w + 24; d.rectangle((x, 96, x + (w - 48) * r['triangles'] / maximum, 105), fill='#87b7bd')
    d.text((x, 117), f"{round(r['triangles']):,} triangles / {r['drawCalls']} draws", font=label, fill='#b9ced9')
verdicts = json.loads((folder / 'verdicts.json').read_text()) if (folder / 'verdicts.json').exists() else {}
for row, (view, name) in enumerate(views):
    y = header + row * (h + 42)
    sources = [folder / f'original-{view}.png', before / f'blender-{view}.png', folder / f'fable-{view}.png']
    if row == 0: sources.append(folder / 'fable-low-front.png')
    for col, path in enumerate(sources):
        with Image.open(path) as source: canvas.paste(source.convert('RGB').resize((w, h), Image.Resampling.LANCZOS), (col * w, y))
    v = verdicts.get(view, {})
    caption = name + ' / same lights, camera and pose'
    if v: caption += ' / pass 3 vs today: ' + v['verdict'].upper()
    d.text((24, y + h + 9), caption, font=label, fill='#d0dce4')
    if row:
        d.text((3 * w + 30, y + 50), 'Compared with today', font=label, fill='#8ba5b5')
        d.text((3 * w + 30, y + 88), v.get('verdict', 'OWNER COMPARISON').upper(), font=title, fill='#e7c487')
        for i, line in enumerate(textwrap.wrap(v.get('note', 'The owner decides whether the shape is ready.'), 40)):
            d.text((3 * w + 30, y + 145 + i * 34), line, font=note, fill='#d0dce4')
canvas.save(folder / 'contact-sheet.png', optimize=True)
print(folder / 'contact-sheet.png')
