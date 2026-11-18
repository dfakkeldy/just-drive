"""Before and after, where the driver looks: the seat views and the car's face, in the real game.
Usage: python3 tools/blender/before-after-sheet.py <folder of the pass before> <folder of this pass>
Three columns: today's code car, the Blender car before, the Blender car now. Each folder holds the pictures that
tools/blender-car-drive.mjs wrote (code-<view>.png, blender-<view>.png). The sheet is saved in the second folder.
Requires Pillow. Pictures are working files: they are never committed.
"""
from pathlib import Path
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageStat

before, after = Path(sys.argv[1]), Path(sys.argv[2])
w, h = 640, 444
VIEWS = [('hwy19-noon-seat', 'Highway 19, noon: driver\'s seat'), ('hwy19-dusk-seat', 'Highway 19, dusk: driver\'s seat'),
         ('mines-noon-seat', 'Mabou Mines Road, noon: driver\'s seat'), ('mines-dusk-seat', 'Mabou Mines Road, dusk: driver\'s seat'),
         ('night-seat', 'Night: driver\'s seat'),
         ('phone-seat', 'A phone (LOW quality): driver\'s seat'),
         ('dusk-front', 'Dusk, from the front'), ('night-front', 'Night, from the front')]
name = lambda folder: folder.name.replace('pass', 'PASS ').upper()
columns = [(after, 'code', 'TODAY / code car'), (before, 'blender', f'BEFORE / Blender car, {name(before)}'), (after, 'blender', f'AFTER / Blender car, {name(after)}')]
header, gap = 120, 44
canvas = Image.new('RGB', (w * 3, header + len(VIEWS) * (h + gap)), '#111e29')
d = ImageDraw.Draw(canvas)
try:
    title = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 30)
    label = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 21)
except OSError:
    title = label = ImageFont.load_default()
d.text((24, 18), f'MAIL CAR, SEAT AND FACE: BEFORE AND AFTER / {name(after)}', font=title, fill='#f4efdb')
for col, (_, _, text) in enumerate(columns):
    d.text((col * w + 24, 70), text, font=label, fill='#d0dce4')
for i, (view, caption) in enumerate(VIEWS):
    y = header + i * (h + gap)
    for col, (folder, car, _) in enumerate(columns):
        path = folder / f'{car}-{view}.png'
        if path.exists():
            with Image.open(path) as source:
                canvas.paste(source.convert('RGB').resize((w, h), Image.Resampling.LANCZOS), (col * w, y))
        else:
            d.rectangle((col * w + 2, y + 2, col * w + w - 3, y + h - 3), outline='#30414f')
            d.text((col * w + 24, y + h // 2 - 12), f'this view was not taken in {name(folder).lower()}', font=label, fill='#7d8f9c')
    d.text((24, y + h + 9), caption + ' / same road, hour, camera and drive in all three', font=label, fill='#d0dce4')
# How far apart the two Blender pictures of each view are: the mean difference of a colour value (0 to 255), and the
# share of pixels that differ by more than 8. The world behind the car moves between runs, so this is never zero.
for view, _ in VIEWS:
    a, b = before / f'blender-{view}.png', after / f'blender-{view}.png'
    if a.exists() and b.exists():
        with Image.open(a) as first, Image.open(b) as second:
            if first.size != second.size:
                print(f'DIFFERENCE {view}: sizes differ, {first.size} and {second.size}'); continue
            diff = ImageChops.difference(first.convert('RGB'), second.convert('RGB'))
            far = sum(diff.convert('L').point(lambda v: 255 if v > 8 else 0).histogram()[255:]) / (diff.width * diff.height)
            print(f'DIFFERENCE {view}: mean {sum(ImageStat.Stat(diff).mean) / 3:.2f} of 255, {far:.1%} of pixels differ by more than 8')
canvas.save(after / 'before-after-sheet.png', optimize=True)
print(after / 'before-after-sheet.png')
