#!/usr/bin/env python3
"""Open pavement trial. Reads real data, writes work only; never promotes.

python3 pipeline/32_bake_paved.py --paved --fetch --root /absolute/project
Repeat offline without --fetch. Output must be empty. Corrections are optional.
"""
import argparse
from pathlib import Path
from areas import AREAS
from paved import bake
from paved_fetch import fetch

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--paved', action='store_true')
    p.add_argument('--fetch', action='store_true')
    p.add_argument('--root', type=Path, required=True)
    p.add_argument('--source', type=Path)
    p.add_argument('--output', type=Path)
    p.add_argument('--area', choices=list(AREAS), action='append')
    p.add_argument('--corrections', type=Path)
    a = p.parse_args()
    if a.paved:
        areas = [AREAS[k] for k in (a.area or AREAS)]
        source = a.source or a.root/'data/raw/paved-open/ty4r-gcnk'
        output = a.output or a.root/'data/work/bakes/paved-open'
        if a.fetch: fetch(source, areas)
        for area in areas: bake(a.root, source, output/area.id, area, a.corrections or a.root/'data/raw/paved-open/corrections.json')
    else: print('paved layer off; no reads or writes')
