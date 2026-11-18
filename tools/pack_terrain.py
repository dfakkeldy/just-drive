#!/usr/bin/env python3
"""Pack the baked terrain tiles into a few large files, for hosts that limit the number of files.

Output: data/pack/terrain/  (p/<n>.png, packs.json, and copies of the small JSON files and cover.png)
  packs.json: {"packs": <count>, "files": {"8/123_456.png": [pack number, offset, length], ...}}
Levels 0-5 go into "low" packs; every level 6 tile and all finer tiles under it go into one pack.
A pack larger than LIMIT is split into parts, keeping whole files together.
A pack is a PNG image used as a byte container (8-bit RGB, 1024 pixels wide, no filtering): the first four
bytes are the payload length (little-endian), then the files end to end. Image hosts serve PNG everywhere.
The game reads packs.json when it exists and falls back to single files when it does not.
"""
import json
import pathlib
import shutil
import struct
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "baked" / "terrain"
OUT = ROOT / "data" / "pack" / "terrain"
LIMIT = 4_000_000
WIDTH = 1024


def png_container(payload: bytes) -> bytes:
    data = struct.pack('<I', len(payload)) + payload
    row = WIDTH * 3
    data += b'\0' * (-len(data) % row)
    rows = len(data) // row
    raw = b''.join(b'\0' + data[r * row:(r + 1) * row] for r in range(rows))

    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body))

    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', WIDTH, rows, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 1)) + chunk(b'IEND', b''))

groups = {}
# Level folders only: other baked folders (such as paved/) are served as single files.
for level_dir in sorted(p for p in SRC.iterdir() if p.is_dir() and p.name.isdigit()):
    level = int(level_dir.name)
    for f in sorted(level_dir.iterdir()):
        i, j = (int(v) for v in f.name.split(".")[0].split("_"))
        key = "low" if level < 6 else f"6_{i >> (level - 6):03d}_{j >> (level - 6):03d}"
        groups.setdefault(key, []).append(f)

shutil.rmtree(OUT, ignore_errors=True)
(OUT / "p").mkdir(parents=True)
packs, files = [], {}
for key in sorted(groups):
    part, size, buf = 0, 0, []

    def flush():
        global part, size, buf
        if not buf:
            return
        offset, idx, blob = 0, len(packs), []
        for f in buf:
            data = f.read_bytes()
            blob.append(data)
            files[f"{f.parent.name}/{f.name}"] = [idx, offset, len(data)]
            offset += len(data)
        (OUT / "p" / f"{idx}.png").write_bytes(png_container(b"".join(blob)))
        packs.append(key)
        part, size, buf = part + 1, 0, []

    for f in groups[key]:
        n = f.stat().st_size
        if size + n > LIMIT:
            flush()
        buf.append(f)
        size += n
    flush()

(OUT / "packs.json").write_text(json.dumps({"packs": len(packs), "files": files}, separators=(",", ":")))
for f in SRC.iterdir():
    if f.is_file():
        shutil.copy2(f, OUT / f.name)
sizes = sorted((p.stat().st_size, p.name) for p in (OUT / "p").iterdir())
total = sum(s for s, _ in sizes) + sum(p.stat().st_size for p in OUT.iterdir() if p.is_file())
print(f"{len(packs)} packs, {len(files)} files inside, total {total / 1e6:.1f} MB, largest {sizes[-1][0] / 1e6:.1f} MB, packs.json {(OUT / 'packs.json').stat().st_size / 1e3:.0f} KB")
