// Runs tools/gamepad-check.mjs on the real sources, and with --mutations once per mutant below: each mutant breaks one
// controller rule on purpose and must make the check fail. Sources are changed only inside the bundle, never on disk.
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..'), dir = mkdtempSync(`${tmpdir()}/mmm-gamepad-`);
const R = 'gamepad-rules';
const mutants = [
  ['A is X', 'A: 0, B: 1, X: 2', 'A: 2, B: 1, X: 0'],
  ['triggers swapped', 'LT: 6, RT: 7', 'LT: 7, RT: 6'],
  ['no dead zone', 'export const STICK_DEAD = 0.15;', 'export const STICK_DEAD = 0;'],
  ['linear stick', 'export const STICK_POWER = 1.6;', 'export const STICK_POWER = 1;'],
  ['stick not rescaled', 'x = (Math.abs(v) - STICK_DEAD) / (1 - STICK_DEAD)', 'x = Math.abs(v)'],
  ['stick sign lost', 'Math.sign(v) * Math.pow(x, STICK_POWER)', 'Math.pow(x, STICK_POWER)'],
  ['stick unclamped', 'const v = clamp(finite(raw), -1, 1)', 'const v = finite(raw)'],
  ['trigger dead zone', 'export const TRIGGER_DEAD = 0.06;', 'export const TRIGGER_DEAD = 0;'],
  ['digital throttle', 'triggerCurve(triggerValue(pad, BUTTON.RT))', '(buttonDown(pad, BUTTON.RT) ? 1 : 0)'],
  ['pressed trigger is full', 'return v > 0 ? v : b?.pressed ? 1 : 0;', 'return b?.pressed ? 1 : v;'],
  ['digital trigger ignored', 'return v > 0 ? v : b?.pressed ? 1 : 0;', 'return v;'],
  ['brake not reverse', '- triggerCurve(triggerValue(pad, BUTTON.LT)), -1, 1)', '- 0, -1, 1)'],
  ['steer from right stick', 'steer: stickCurve(pad.axes[0] ?? 0)', 'steer: stickCurve(pad.axes[2] ?? 0)'],
  ['handbrake on B', 'handbrake: buttonDown(pad, BUTTON.A)', 'handbrake: buttonDown(pad, BUTTON.B)'],
  ['no RB pull', '|| buttonDown(pad, BUTTON.RB),', ','],
  ['half press', 'export const PRESS = 0.5;', 'export const PRESS = 0.3;'],
  ['any pad usable', "pad.connected && (pad.mapping === 'standard' || (pad.buttons.length >= 16 && pad.axes.length >= 4))", 'pad.connected'],
  ['standard only', "(pad.mapping === 'standard' || (pad.buttons.length >= 16 && pad.axes.length >= 4))", "pad.mapping === 'standard'"],
  ['drift wakes', 'export const WAKE = 0.4;', 'export const WAKE = 0.2;'],
  ['triggers wake at half', 'i === BUTTON.LT || i === BUTTON.RT ? WAKE : PRESS', 'PRESS'],
  ['idle pad picked', 'else if (other === null && padActive(pad)) other = pad.index;', 'else if (other === null) other = pad.index;'],
  ['current loses to other', 'if (pad.index === current) { if (padActive(pad)) return current; kept = current; }', 'if (pad.index === current) { kept = current; }'],
  ['current forgotten', 'return other ?? kept;', 'return other;'],
  ['edges are holds', 'if (now[i] && !before[i]) edges.push(i);', 'if (now[i]) edges.push(i);'],
  ['mouse is touch', "if (event.pointerType === 'mouse') return 'keyboard';", "if (event.pointerType === 'mouse') return 'touch';"],
  ['pen ignored', " || event.pointerType === 'pen'", ''],
  ['key ignored', "if (event.kind === 'key') return 'keyboard';", "if (event.kind === 'key') return current;"],
  ['unplug keeps pad', "current === 'gamepad' && padsLeft === 0 ? homeDevice(touchDevice) : current", 'current'],
  ['phone falls to keys', "touchDevice ? 'touch' : 'keyboard'", "'keyboard'"],
  ['horn on Y', "[BUTTON.X, 'horn'], [BUTTON.Y, 'mail']", "[BUTTON.Y, 'horn'], [BUTTON.X, 'mail']"],
  ['view on A', "[BUTTON.B, 'view']", "[BUTTON.A, 'view']"],
  ['no Start', "[BUTTON.START, 'pause'], [BUTTON.BACK", "[BUTTON.BACK"],
  ['menu choose on B', "[BUTTON.A, 'choose'], [BUTTON.B, 'back']", "[BUTTON.B, 'choose'], [BUTTON.A, 'back']"],
  ['menu left/right ignored', "[BUTTON.UP, 'previous'], [BUTTON.LEFT, 'previous']", "[BUTTON.UP, 'previous']"],
  ['no repeat delay', '(t < REPEAT_DELAY ? -1 :', '(t < 0 ? -1 :'],
  ['focus no wrap', '(index + (move === \'next\' ? 1 : count - 1)) % count', "Math.max(0, Math.min(count - 1, index + (move === 'next' ? 1 : -1)))"],
  ['latch forgets', 'if (down[i] && (menuOpen || latched.has(i))) next.add(i);', 'if (down[i] && menuOpen) next.add(i);'],
  ['latch sticks', 'if (down[i] && (menuOpen || latched.has(i))) next.add(i);', 'if (menuOpen || latched.has(i)) next.add(i);'],
  ['latch ignored', 'handbrake: drive.handbrake && !latched.has(BUTTON.A),', 'handbrake: drive.handbrake,'],
  ['latched RT drives', 'go ? Math.min(0, drive.throttle)', 'go ? drive.throttle'],
  ['unlabelled trigger axis wakes', "pad.mapping === 'standard' ? 4 : 2", '4'],
  ['placement scale', 'return finite(moved) > Math.abs(finite(speedBefore)) * finite(dt) * 3 + 1;', 'return finite(moved) > 50;'],
  ['probe every frame', 'export const PROBE_EVERY = 1000;', 'export const PROBE_EVERY = 0;'],
  ['soft landings rumble', 'export const HARD_LANDING = 6;', 'export const HARD_LANDING = 2;'],
  ['braking rumbles', 'export const HIT_DECEL = 40;', 'export const HIT_DECEL = 5;'],
  ['placement rumbles', 'if (placed(before, step, moved)) return null;', ''],
  ['paused frame rumbles', 'if (step <= 0 || step > 0.25) return null;', ''],
  ['reverse hit lost', 'const before = Math.abs(finite(speedBefore)), after = Math.abs(finite(speedAfter))', 'const before = finite(speedBefore), after = finite(speedAfter)'],
  ['rumble flat', 'const k = clamp((fall - HARD_LANDING) / 10, 0.2, 1);', 'const k = 0.5;'],
  ['rumble spam', 'export const RUMBLE_GAP = 180;', 'export const RUMBLE_GAP = 0;'],
  ['rumble off by default', "return stored !== '0';", "return stored === '1';"],
  ['mail on Just Drive', "if (mail) rows.push(['Y'", "if (true) rows.push(['Y'", 'controls'],
  ['horse radio', "if (radio && !horse) rows.push(['D-pad up'", "if (radio) rows.push(['D-pad up'", 'controls'],
  ['HUD ignores controller', ': s.padHelp ? `   ${s.fps.toFixed(0)} fps` + s.padHelp : s.driveHelp ??', ': s.driveHelp ??', 'hud-text'],
  ['phone HUD gets it', "(s.touchDevice ? `   ${s.fps.toFixed(0)} fps${s.jumpLine}`", "(s.touchDevice && !s.padHelp ? `   ${s.fps.toFixed(0)} fps${s.jumpLine}`", 'hud-text'],
];
try {
  for (const mutant of [null, ...(process.argv.includes('--mutations') ? mutants : [])]) {
    const file = mutant?.[3] ?? R, source = resolve(root, `web/src/${file}.ts`), original = readFileSync(source, 'utf8');
    if (mutant) assert.equal(original.split(mutant[1]).length, 2, mutant[0] + ': anchor must match once');
    await build({ entryPoints: [resolve(root, 'tools/gamepad-check.mjs')], bundle: true, platform: 'node', format: 'esm', outfile: `${dir}/check.mjs`, logLevel: 'silent',
      plugins: mutant ? [{ name: 'mutate', setup(b) { b.onLoad({ filter: new RegExp(`/${file}\\.ts$`) }, () => ({ contents: original.replace(mutant[1], () => mutant[2]), loader: 'ts', resolveDir: dirname(source) })); } }] : [] });
    const r = spawnSync(process.execPath, [`${dir}/check.mjs`], { cwd: resolve(root, 'web'), encoding: 'utf8' });
    if (!mutant) { assert.equal(r.status, 0, r.stdout + r.stderr); console.log(r.stdout.trim()); }
    else { assert.notEqual(r.status, 0, mutant[0] + ' survived'); assert.match(r.stderr, /AssertionError/, mutant[0] + ': failed for another reason\n' + r.stderr); console.log('REJECTED', mutant[0]); }
  }
  if (process.argv.includes('--mutations')) console.log(`PASS ${mutants.length} mutants rejected`);
} finally { rmSync(dir, { recursive: true, force: true }); }
