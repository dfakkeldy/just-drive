#!/usr/bin/env python3
"""Build the car radio's files from the song sources.

Input:  tools/radio_stations.json            the stations and their songs (in git)
        data/audio/src/<source>.<ext>        the songs as they were made (not in git)
Output: data/audio/out/<source>.mp3          MP3 at 128 kbit/s, which every browser plays
        data/audio/out/radio.json            what web/src/radio.ts reads: every station and song (the dev server)
                                             and "start": the dial of the station marked "start": true, which a
                                             player hears first (left out of a list that lacks that station)
        data/audio/site/                     the same, with only the songs marked "public": true (the public site);
                                             a station with no public song is left out, and with none at all the folder is absent
        data/audio/page/                     the same, with only the songs marked "page": true (the private page, which
                                             has little room left and so carries a selection)
        web/src/radio-credits.generated.ts   the immediate title credit (always rewritten, including with AUDIO_OUT)
        data/audio/out/calls.json            the Party Line's call-ins for Get Fired (tools/radio_calls.json), with the
                                             pauses of every piece on their station; in site/ only the calls marked
                                             "public": true. No list when there is no call. Never in radio-just.json.

The same folders also get radio-just.json: the same stations and tracks, with the list's "just_start" dial.
Both brands share song files and the same public/page filters; there is only one station catalogue.

Each song is set to the same loudness, and its tags are left out (they hold the lyrics and the maker's ids).
Missing sources stop the build with their file stems; a station with no selected songs is dropped.
Every song names a credits-map key and can override fields (by, licence, source, date, text); the run stops
before it writes anything if one does not.
Needs ffmpeg and ffprobe. Usage: python3 tools/build_radio.py
A data-isolated run: AUDIO_OUT=<an empty folder> python3 tools/build_radio.py
This still rewrites the tracked web/src/radio-credits.generated.ts in this checkout.
"""
import json
import hashlib
import os
import pathlib
import shutil
import subprocess
import sys

# Also works when the regression harness executes this file in a fresh namespace.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from radio_catalogue import parse_catalogue, credits_module, atomic_write, read_calls

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "audio" / "src"
BASE = pathlib.Path(os.environ["AUDIO_OUT"]).resolve() if os.environ.get("AUDIO_OUT") else ROOT / "data" / "audio"
OUT = BASE / "out"
PUBLIC = BASE / "site"
PAGE = BASE / "page"
LOUDNESS = "loudnorm=I=-16:TP=-1.5:LRA=11"   # the level streaming services use, so no song jumps out
# A call is one voice on a telephone: mono at half the rate is the same to the ear, and half the download.
SPEECH = ["-ac", "1", "-b:a", "64k"]
MUSIC = ["-ac", "2", "-b:a", "128k"]
# A pause of a piece on the calls' station: this quiet for this long (seconds). A call can start in it.
PAUSE_DB, PAUSE_SECONDS = -38, 0.3


def loudness(path: pathlib.Path, more: str = "") -> dict:
    """Measures a file with the loudness filter and returns what the filter reports."""
    err = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-map", "0:a:0", "-af",
                          LOUDNESS + more + ":print_format=json", "-f", "null", "-"], check=True, capture_output=True, text=True).stderr
    return json.loads(err[err.rindex("{"):err.rindex("}") + 1])


def level(path: pathlib.Path) -> str:
    """
    The filter for one song. The song is measured first, so that one fixed gain can bring it to the level; without the
    measurement the filter rides the volume up and down, which is heard in quiet music. A song that cannot be measured
    (silence) gets the plain filter.
    """
    try:
        m = loudness(path)
        if not all(abs(float(m[k])) < 99 for k in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")):
            return LOUDNESS
        return (f"{LOUDNESS}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
                f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    except (subprocess.CalledProcessError, ValueError, KeyError):
        return LOUDNESS


def listing(stations: list, start, catalogue_hash: str) -> str:
    """A list as the game reads it. The starting dial is named only when its station is in this list."""
    data = {"stations": stations, "catalogueHash": catalogue_hash}
    if start and any(s["dial"] == start for s in stations):
        data["start"] = start
    # Keep the playable schema unchanged; the title credit lives in the generated module.
    data["stations"] = [
        {"dial": s["dial"], "name": s["name"],
         "tracks": [{k: t[k] for k in ("file", "title", "seconds")} for t in s["tracks"]]}
        for s in stations
    ]
    return json.dumps(data, indent=1) + "\n"


def pauses(path: pathlib.Path) -> list:
    """The pauses of one finished piece: [start, end] seconds. A pause still open at the end is the end, not a pause."""
    err = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af",
                          f"silencedetect=noise={PAUSE_DB}dB:d={PAUSE_SECONDS}", "-f", "null", "/dev/null"],
                         check=True, capture_output=True, text=True).stderr or ""
    out, start = [], None
    for line in err.splitlines():
        if "silence_start:" in line:
            start = float(line.split("silence_start:")[1].split()[0])
        elif "silence_end:" in line and start is not None:
            out.append([round(max(0.0, start), 2), round(float(line.split("silence_end:")[1].split()[0].rstrip("|")), 2)])
            start = None
    return out


def calls_listing(calls: dict, chosen: list, seconds: dict, gaps: dict, calls_hash: str) -> str:
    """audio/calls.json as the game reads it (party-line-rules.ts): the chosen calls and nicknames, and the pauses.
    `calls_hash` is the hash of tools/radio_calls.json, as radio.json carries the station catalogue's."""
    data = {"dial": calls["dial"], "catalogueHash": calls_hash,
            "calls": [{"file": c["source"] + ".mp3", "seconds": seconds[c["source"] + ".mp3"], "about": c["about"],
                       "caller": c["caller"], "name": c["name"]} for c in chosen if "about" in c],
            "nicknames": [{"file": n["source"] + ".mp3", "seconds": seconds[n["source"] + ".mp3"], "kind": n["kind"],
                           "caller": n["caller"], "name": n["name"]} for n in chosen if "kind" in n],
            "gaps": gaps}
    return json.dumps(data, indent=1) + "\n"


def folder(where: pathlib.Path, lists: dict, catalogue_hash: str, calls: tuple = None) -> None:
    """
    One page's folder: its lists (file name to stations and starting dial), and links to their songs. With no station
    there is no folder. `calls`: (the calls catalogue, the chosen calls and nicknames, their seconds by file, the pauses
    by file, the hash of radio_calls.json), written as calls.json with links to the calls' files (only the pauses of
    pieces in this folder's lists); None or none chosen leaves calls.json out.
    """
    lists = {name: got for name, got in lists.items() if got[0]}
    if not lists:
        return
    where.mkdir(parents=True)
    chosen = calls[1] if calls else []
    for name in sorted({t["file"] for stations, _ in lists.values() for s in stations for t in s["tracks"]}
                       | {c["source"] + ".mp3" for c in chosen}):
        try:
            os.link(OUT / name, where / name)
        except OSError:
            shutil.copy2(OUT / name, where / name)
    for name, (stations, start) in lists.items():
        atomic_write(where / name, listing(stations, start, catalogue_hash))
    if chosen:
        catalogue, _, seconds_by_file, gaps, calls_hash = calls
        on = {t["file"] for stations, _ in lists.values() for s in stations if s["dial"] == catalogue["dial"] for t in s["tracks"]}
        atomic_write(where / "calls.json", calls_listing(catalogue, chosen, seconds_by_file, {f: g for f, g in gaps.items() if f in on}, calls_hash))


def starting(stations: list, what: str):
    """The dial of the one station marked "start", or None. More than one is an error (raised as ValueError)."""
    first = [s["dial"] for s in stations if s.get("start") is True]
    if len(first) > 1:
        raise ValueError(f"more than one {what} is marked \"start\": {', '.join(first)}")
    return first[0] if first else None


def seconds(path: pathlib.Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         check=True, capture_output=True, text=True).stdout
    return round(float(out), 2)


def main() -> int:
    try:
        catalogue = (ROOT / "tools" / "radio_stations.json").read_bytes()
        plan = parse_catalogue(catalogue)
        module_text = credits_module(catalogue)
        wanted = plan["stations"]
        start, just_start = starting(wanted, "station"), plan.get("just_start")
        missing = sorted({t["source"] for s in wanted for t in s["tracks"]
                          if not any(p.is_file() for p in SRC.glob(t["source"] + ".*"))})
        if missing:
            raise ValueError("missing song source(s) in " + str(SRC) + ": " + ", ".join(missing)
                             + "; add the files or remove these tracks from tools/radio_stations.json")
        calls = read_calls(plan, ROOT / "tools" / "radio_calls.json")
        every_call = (calls["calls"] + calls["nicknames"]) if calls else []
        missing = sorted(c["source"] for c in every_call if not any(p.is_file() for p in SRC.glob(c["source"] + ".*")))
        if missing:
            raise ValueError("missing call source(s) in " + str(SRC) + ": " + ", ".join(missing)
                             + "; record them or remove them from tools/radio_calls.json")
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    catalogue_hash = hashlib.sha256(catalogue).hexdigest()
    calls_hash = hashlib.sha256((ROOT / "tools" / "radio_calls.json").read_bytes()).hexdigest() if calls else ""
    OUT.mkdir(parents=True, exist_ok=True)
    # The public site's folder is taken away first and made new at the end. If this run stops half way, no older
    # folder is left that could still hold a song which is no longer marked public. The private page's folder likewise.
    shutil.rmtree(PUBLIC, ignore_errors=True)
    shutil.rmtree(PAGE, ignore_errors=True)
    keep, made = {"radio.json", "radio-just.json", "calls.json", "pauses.json"}, {}

    def song(track: dict):
        """Makes one song's playable file if needed."""
        if track["source"] not in made:
            made[track["source"]] = build(track)
        got = made[track["source"]]
        return {"file": got[0], "title": track["title"], "seconds": got[1]} if got else None

    def build(track: dict, speech: bool = False):
        found = sorted(p for p in SRC.glob(track["source"] + ".*") if p.is_file())
        if not found:
            print(f"warning: no source for {track['source']}; skipped", file=sys.stderr)
            return None
        target = OUT / (track["source"] + ".mp3")
        if not target.exists() or target.stat().st_mtime < found[0].stat().st_mtime:
            # Encode beside the target and rename at the end: a run that is cut short leaves no half song behind.
            part = OUT / (track["source"] + ".part")
            try:
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(found[0]), "-map", "0:a:0", "-map_metadata", "-1",
                                "-af", level(found[0]), "-ar", "44100", *(SPEECH if speech else MUSIC), "-c:a", "libmp3lame",
                                "-write_xing", "0", "-f", "mp3", str(part)], check=True)
                os.replace(part, target)
                got = loudness(target)
                print(f"made {target.name}: {got['input_i']} LUFS, true peak {got['input_tp']} dB")
            finally:
                part.unlink(missing_ok=True)   # nothing half-made stays in the folder that the site build copies
        keep.add(target.name)
        return target.name, seconds(target)

    def lists(chosen: list):
        """A station list three times: every song (the dev server), the public ones, and the private page's."""
        every, public, page = [], [], []
        for station in chosen:
            tracks = station["tracks"]
            for out, wants in ((every, lambda t: True), (public, lambda t: t.get("public") is True), (page, lambda t: t.get("page") is True)):
                got = [e for e in (song(t) for t in tracks if wants(t)) if e]
                if got:
                    out.append({"dial": station["dial"], "name": station["name"], "tracks": got})
        return every, public, page

    stations, public, page = lists(wanted)
    just_all, just_public, just_page = stations, public, page
    # The calls: their files, and the pauses of every piece on their station (kept in pauses.json by file, size and time).
    call_files, call_seconds, gaps = [], {}, {}
    if every_call:
        for c in every_call:
            got = build(c, speech=True)
            call_files.append(c)
            call_seconds[got[0]] = got[1]
        try:
            known = json.loads((OUT / "pauses.json").read_text())
        except (OSError, ValueError):
            known = {}
        fresh = {}
        for name in sorted({t["file"] for s in stations if s["dial"] == calls["dial"] for t in s["tracks"]}):
            stat = (OUT / name).stat()
            mark = f"{stat.st_size}:{stat.st_mtime_ns}"
            fresh[name] = known[name] if known.get(name, {}).get("mark") == mark else {"mark": mark, "gaps": pauses(OUT / name)}
            if fresh[name]["gaps"]:
                gaps[name] = fresh[name]["gaps"]
        atomic_write(OUT / "pauses.json", json.dumps(fresh, indent=1) + "\n")
    calls_for = lambda flag: (calls, [c for c in call_files if flag is None or c.get(flag) is True], call_seconds, gaps, calls_hash) if calls else None
    for stale in OUT.iterdir():
        if stale.name not in keep:
            stale.unlink()
    atomic_write(OUT / "radio.json", listing(stations, start, catalogue_hash))
    if call_files:
        atomic_write(OUT / "calls.json", calls_listing(calls, call_files, call_seconds, gaps, calls_hash))
    else:
        (OUT / "calls.json").unlink(missing_ok=True)
        (OUT / "pauses.json").unlink(missing_ok=True)
    if just_all:
        atomic_write(OUT / "radio-just.json", listing(just_all, just_start, catalogue_hash))
    else:
        (OUT / "radio-just.json").unlink(missing_ok=True)
    folder(PUBLIC, {"radio.json": (public, start), "radio-just.json": (just_public, just_start)}, catalogue_hash, calls_for("public"))
    folder(PAGE, {"radio.json": (page, start), "radio-just.json": (just_page, just_start)}, catalogue_hash)
    module = ROOT / "web/src/radio-credits.generated.ts"
    module.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(module, module_text)
    size = sum(p.stat().st_size for p in OUT.iterdir())
    print(f"radio: {len(stations)} stations, {sum(len(s['tracks']) for s in stations)} songs, {size / 1e6:.1f} MB in {OUT}")
    def held(*lists_) -> str:
        files = {t["file"] for stations_ in lists_ for s in stations_ for t in s["tracks"]}
        return f"{len(files)} files, {sum((OUT / n).stat().st_size for n in files) / 1e6:.1f} MB"

    count = lambda stations_: f"{len(stations_)} stations, {sum(len(s['tracks']) for s in stations_)} songs"
    print(f"public site: mail game {count(public)}; drive-around game {count(just_public)}; "
          + (f"{held(public, just_public)} in {PUBLIC}" if public or just_public else "no folder"))
    print(f"private page: mail game {count(page)}; drive-around game {count(just_page)}; "
          + (f"{held(page, just_page)} in {PAGE}" if page or just_page else "no folder"))
    print(f"dev server: drive-around game {count(just_all)} (radio-just.json)")
    if call_files:
        public_calls = [c for c in call_files if c.get("public") is True]
        print(f"calls: {len(call_files)} files, {sum((OUT / (c['source'] + '.mp3')).stat().st_size for c in call_files) / 1e6:.1f} MB; "
              f"public site {len(public_calls)} files, {sum((OUT / (c['source'] + '.mp3')).stat().st_size for c in public_calls) / 1e6:.1f} MB; "
              f"pauses on {len(gaps)} pieces of {calls['dial']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
