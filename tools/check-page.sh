#!/usr/bin/env bash
# The page's own rules: which link keys show the title card, the readiness signal, and what a player
# sees when the game cannot start or stops. Node only; no browser.
# The browser part (a production build and a dev page) is tools/page-state-browser.mjs: see its header.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
node tools/visit-check.mjs --mutations
node tools/page-state-check.mjs --mutations
