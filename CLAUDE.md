# CLAUDE.md

Notes for coding agents in this repository. This repository is **public**.
[README.md](README.md) is the main manual; this file only adds what an agent
needs to know first. Do not copy the README here.

## The repository

- The game is Mabou Mail Madness; the drive-around mode is Just Drive.
- GitHub: `dfakkeldy/just-drive` (public) is the `origin` remote. Local
  checkouts can still be in a folder named `mabou-mail-madness`.
- A remote named `archive` can point to the old private repository. Never
  push or open PRs there.
- Base work on current `origin/main` and target `main`. There is no `nightly`
  branch.

| Folder | What it holds |
|---|---|
| `web/` | The game: TypeScript, three.js, Vite (`npm ci`, then `npm run dev`) |
| `server/` | The multiplayer room server, for local tests only (`tools/check-mp.sh`). Never `wrangler deploy` from it |
| `deploy/` | The live site's deploy config |
| `pipeline/` | Python bake steps that turn public survey data into land |
| `tools/` | Checks, picture scripts, bakes, radio and site build |
| `data/` | Survey data, baked land, audio. Not in git (`.gitignore`) |

## Land data in a worktree

`data/` is not in git, so a new worktree has none. A symlinked `data` that
points to the main checkout's `data/` is fine for reading. Bakes write into
`data/baked`; do not bake through a link into the live land. To check a bake
that is not live yet, follow "Checks on a land that is not live yet" in
[tools/checks-README.md](tools/checks-README.md).

## Checks

- Before a PR, after `git fetch origin`: `tools/check-all.sh --changed` (add `--quick` on a busy
  machine), then the touched feature's browser rows with `--only <rows>`.
  `--list` shows what will run.
- A check's exit code is its verdict. Do not count PASS lines.
- CI (`.github/workflows/ci.yml`) runs `tools/check-all.sh --ci --full --jobs 4` in a
  clean Ubuntu clone with no `data/`. Rows that need the land or a Mac SKIP
  there, so a green CI does not prove those rows.
- `tools/checks-hosts.tsv` says which rows need a Mac. `tools/remote-check.sh`
  sends rows to another check host (see the README).
- Type check only: `cd web && npx tsc --noEmit`.

## Pull requests

- Open every PR as a **draft** (`gh pr create --draft`). An automated steward
  lands any ready PR that has a `Reviewed-by:` line, so a ready PR with open
  gates can merge too early.
- CI runs on draft PRs too. When every gate has passed, run `gh pr ready <N>`
  and start the landing script at once.
- The PR body has Testing, Risk, How to revert and a `Reviewed-by:` line.

## Privacy and licences

- Real road names are fine. Civic numbers, real residents' names and real mail
  route data are not: customers and addresses in the game are invented.
- Do not commit anything from `data/`, `reference/` or `/docs/` (all ignored).
  Do not commit private local paths, account names or secrets.
- Music, 3D models, screenshots and the names and icon are not under the MIT
  licence. See the licence table in the README before you reuse or move them.
- `python3 tools/changelog.py` rebuilds `CHANGELOG.md` and refuses lines with an
  email, a civic address or a private path. Rewrite or hide the note in
  `tools/changelog-notes.json`; never weaken the filter.

## Publishing

Building and deploying the public site (`tools/build_site.sh`, the wrangler
deploy) and promoting land into `data/baked` are separate steps. Do them only
when the task says so.

## Writing style

Docs, comments and PR text use short, plain sentences: one idea per sentence,
active voice, simple words. Match the README.
