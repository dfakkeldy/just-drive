// Stalls this node process the way a busy shared machine does: the event loop runs nothing for a while.
// Loaded with `node --import tools/mp-stalls.mjs` by `tools/check-mp.sh --mutations`; never by the plain check.
//   MP_STALLS=6500:700,15000:700   block for 700 ms at 6.5 s and at 15 s after start
//   MP_STALLS=every:600:250        block for 250 ms in every 600 ms, from the start
const spec = process.env.MP_STALLS ?? '';
const block = (ms) => { const end = performance.now() + ms; while (performance.now() < end); };
if (spec.startsWith('every:')) {
  const [, period, ms] = spec.split(':').map(Number);
  setInterval(() => block(ms), period).unref();
} else if (spec) {
  for (const item of spec.split(',')) {
    const [at, ms] = item.split(':').map(Number);
    setTimeout(() => block(ms), at).unref();
  }
}
