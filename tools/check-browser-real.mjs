// One real browser, two sequential proofs: own rendered checkout, then screenshot failure pages.
// RUN=check-browser-real.mjs VIEWS='proof|x=1' tools/yard-shots.sh 600 400
await import('./check-ports-probe.mjs');
await import('./check-shot-proof.mjs');
