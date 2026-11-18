#!/usr/bin/env python3
"""Run the requested shell checks serially and retain each exit code."""
import json
import os
import subprocess
from pathlib import Path
root = Path(__file__).resolve().parent.parent
out = root / "data/work/west-bay/fleet/round1-checks"
out.mkdir(exist_ok=True)
(out / "fishing").mkdir(exist_ok=True)
(out / "coast").mkdir(exist_ok=True)
environment = {**os.environ, "MMM_CHECK_OUT": str(out / "fishing"), "MMM_COAST_OUT": str(out / "coast")}
commands = [
    ["npx", "tsc", "--noEmit"],
    ["tools/check-phone.sh"], ["tools/check-truck.sh"], ["tools/check-sxs.sh"],
    ["tools/check-bike.sh", "--pure"], ["tools/check-trailer.sh"],
    ["tools/check-explore.sh", "--pure"], ["tools/check-shift.sh"],
    ["tools/check-jump.sh"], ["tools/check-road-scene.sh"], ["tools/check-mine.sh"],
    ["tools/check-fishing.sh"], ["tools/check-area.sh"], ["tools/check-fleet.sh"],
    *[["tools/check-" + name + ".sh"] for name in ["picture", "streams", "water-state", "wings", "sxs-review", "sxs-round2", "page", "church"]],
    ["node", "tools/check-touch-quality.mjs"], ["tools/check-coast.sh"], ["tools/check-fleet-review.sh"],
    ["git", "diff", "--check"],
]
results = []
for index, cmd in enumerate(commands):
    path = out / ("shell-%02d.log" % index)
    with path.open("w") as log:
        result = subprocess.run(cmd, cwd=root / "web" if index == 0 else root, stdout=log, stderr=subprocess.STDOUT, env=environment)
    results.append({"command": " ".join(cmd), "exit": result.returncode, "log": path.name})
    (out / "shell-results.json").write_text(json.dumps(results, indent=2) + "\n")
    print("CHECK", result.returncode, " ".join(cmd), flush=True)
raise SystemExit(any(r["exit"] for r in results))
