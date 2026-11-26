#!/usr/bin/env python3
"""Read-only promotion screen; output only a JSON receipt on stdout."""
import importlib.util,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent;sys.path.insert(0,str(ROOT/'pipeline'))
spec=importlib.util.spec_from_file_location('far_screen',ROOT/'pipeline/34_bake_far_views.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
rows=json.load(sys.stdin);points={}
for row in rows:
 d=json.loads(Path(row['candidate']).read_text())
 for p in d['turbines']+d['far']:points[(p['e'],p['n'])]=p
out={}
for row in rows:
 base=Path(row['base']);d=json.loads(Path(row['candidate']).read_text());live=json.loads((base/'tall.json').read_text());m=json.loads((base/'manifest.json').read_text())
 _,wind=b.safe_turbines(base,[p for p in points.values() if b.inside(p['e'],p['n'],b.root_box(m))],area=row['area']);_,_,structures=b.safe_structures(base,d)
 lost=b.removals(live,d)
 out[row['area']]={'removed':lost,'removedCounts':{kind:sum(v.startswith(kind+':') for v in lost) for kind in ['wind','mast','line']},'windConflicts':wind,'structureConflicts':structures}
print(json.dumps(out,separators=(',',':')))
