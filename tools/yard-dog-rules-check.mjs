// Pure motion rules, with no land, models or browser.
import assert from 'node:assert/strict';
import { YardDogRules } from '../web/src/yard-dog-rules.ts';
for (const [along, across, expected] of [[41, 0, 'run'], [43, 0, 'home'], [0, 11, 'home']]) {
  const dog = new YardDogRules(5);
  dog.update(1 / 60, along, across, 6);
  assert.equal(dog.state, expected, '42 m trigger and 10 m road corridor');
}
for (const direction of [-1, 1]) for (const fps of [20, 60, 144]) {
  const dog = new YardDogRules(5), states = new Set();
  let barks = 0, farthest = 0;
  for (let frame = 0; frame < fps * 25; frame++) {
    const along = direction * (-38 + frame / fps * 6);
    dog.update(1 / fps, along, 0, direction * 6);
    states.add(dog.state);
    barks += Number(dog.bark);
    farthest = Math.max(farthest, Math.abs(dog.along));
    assert.ok(Math.abs(dog.along) <= 18, 'property edge at 18 m');
    assert.ok(dog.across >= 5 && dog.across <= 14, 'stay between road edge and home');
    const paused = JSON.stringify(dog);
    dog.update(0, 0, 0, 6);
    assert.equal(JSON.stringify(dog), paused, 'pause preserves every rule field');
  }
  assert.deepEqual([...states], ['run', 'bark', 'follow', 'guard', 'return', 'home']);
  assert.ok(barks >= 2, 'encounter emits repeated bark events');
  assert.ok(farthest > 17.8, 'follow reaches the property edge');
  dog.reset();
  assert.deepEqual(dog, new YardDogRules(5), 'reset restores a new encounter');
}
console.log('PASS yard-dog rules: trigger, corridor, pause, both directions, three rates, bark, property edge and reset');
