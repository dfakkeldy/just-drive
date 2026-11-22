// Run: web/node_modules/.bin/esbuild tools/shift-check.mjs --bundle --platform=node --format=esm --outfile=/tmp/mmm-shift-check.mjs && node /tmp/mmm-shift-check.mjs
import assert from 'node:assert/strict';
import { makeDay, nextCareer, freshCareer, migrateCareer, MABOU_REMOVED_RURAL_1347, verdict, readCareer, saveCareer, clock, dayType, missedCustomers } from '../web/src/shift-rules.ts';
import { Complaints, dismissed, complaintLine } from '../web/src/complaints.ts';
const lawn = { kind: 'lawnDamage', at: 100, target: 8, x: 3, z: 4, road: 7 };
const cat = { id: 'cat', kind: 'animal', x: 0, z: 0, road: 7, radius: 1, blocking: true };
const photo = (at, fact = cat) => ({ at, facts: [fact], caption: 'Evidence' });
assert.equal(dismissed(lawn, [photo(90)]), true, 'earlier cat photo clears lawn');
assert.equal(dismissed(lawn, [photo(110)]), false, 'later photo cannot clear lawn');
assert.equal(dismissed(lawn, [photo(100)]), false, 'same-time photo is too late');
assert.equal(dismissed(lawn, [photo(90, { ...cat, blocking: false })]), false, 'a pet at home does not explain a detour');
assert.equal(dismissed(lawn, [photo(90, { ...cat, road: 9 })]), false, 'wrong road');
assert.equal(dismissed(lawn, [photo(90, { ...cat, x: 200 })]), false, 'wrong property');
assert.equal(dismissed({ ...lawn, kind: 'late' }, [photo(90)]), false);
assert.equal(dismissed({ ...lawn, kind: 'flag' }, [photo(90)]), false);
assert.equal(dismissed({ ...lawn, kind: 'stuffed' }, [photo(90, { ...cat, kind: 'stuffed', target: 8 })]), true);
assert.equal(dismissed({ ...lawn, kind: 'boxDown', preExisting: true }, [photo(90, { ...cat, kind: 'preExisting', target: 8 })]), true);
assert.equal(dismissed({ ...lawn, kind: 'boxDown' }, [photo(90, { ...cat, kind: 'preExisting', target: 8 })]), false);
assert.equal(verdict([{ kind: 'late' }]), 'clear');
assert.equal(verdict([{ kind: 'late' }, { kind: 'flag' }]), 'clear');
assert.equal(verdict(Array.from({length:6},()=>({kind:'flag'}))), 'clear');
assert.equal(verdict([{ kind: 'missing' }]), 'warning');
assert.equal(verdict([{ kind: 'missing' }, ...Array(6).fill({kind:'flag'}), {kind:'late'}]), 'warning');
assert.equal(verdict([{ kind: 'missing' }, {kind:'stuffed'}, {kind:'late'}, {kind:'flag'}]), 'warning');
assert.equal(verdict([{ kind: 'missing' }, { kind: 'boxDown' }, { kind: 'ditchMail' }]), 'suspension');
assert.equal(verdict([{ kind: 'lawnDamage' }]), 'suspension');
// Property damage (a broken yard or field prop): avoidable; one property is a warning, two in a day a suspension; no photo answers it.
assert.equal(verdict([{ kind: 'propertyDamage' }, { kind: 'late' }, { kind: 'flag' }]), 'warning');
assert.equal(verdict([{ kind: 'propertyDamage' }, { kind: 'propertyDamage' }]), 'suspension');
assert.equal(verdict([{ kind: 'propertyDamage' }, { kind: 'missing' }]), 'warning');
assert.equal(dismissed({ ...lawn, kind: 'propertyDamage' }, [photo(90), photo(90, { ...cat, kind: 'obstacle' })]), false);
const next = nextCareer(freshCareer(), 'suspension');
assert.equal(next.day, 3); assert.equal(next.double, true); assert.equal(next.pay, 345); assert.equal(next.suspended, true);
assert.equal(nextCareer(next, 'clear').pay, 690); assert.equal(nextCareer(next, 'clear').day, 4);
assert.equal(nextCareer(freshCareer(), 'warning').warnings, 1);
const route = {rural:Array.from({length:56},(_,i)=>i),sites:[467],allRural:Array.from({length:363},(_,i)=>i),downCandidates:Array.from({length:56},(_,i)=>i)};
const first = makeDay(1, 473, route), again = makeDay(1, 473, route);
assert.deepEqual(first, again);
assert.deepEqual(first.flags, makeDay(15, 473, route).flags);
const double = makeDay(3, 473, route, true), today = makeDay(3, 473, route), missed = makeDay(2, 473, route);
for (let i = 0; i < double.pieces.length; i++) assert.equal(double.pieces[i], 2 * Math.max(today.pieces[i], missed.pieces[i]));
const carried=Array(473).fill(0);carried[0]=4;carried[300]=10;
assert.equal(makeDay(1,473,route,false,carried).pieces[0],first.pieces[0]+4);
assert.equal(makeDay(1,473,route,false,carried).pieces[300],0,'other runs keep their mail in the depot');
for(let n=0;n<=60;n++){
  const remaining=Array(n).fill(1),calls=missedCustomers(1,remaining);
  assert.equal(calls.length,Math.min(3,Math.floor(n/4)));assert.equal(new Set(calls).size,calls.length);
  assert.deepEqual(calls,missedCustomers(1,remaining));
}
const complaints=new Complaints();
for(let target=0;target<12;target++) for(const kind of ['lawnMail','ditchMail']) complaints.add({...lawn,target,kind});
assert.equal(complaints.all.length,5);assert.equal(complaints.groundOverflow,7);
for (const kind of ['lawnDamage', 'propertyDamage', 'boxDown', 'lawnMail', 'ditchMail', 'missing', 'stuffed', 'flag', 'late']) {
  assert.equal(new Set(Array.from({ length: 4 }, (_, i) => complaintLine(kind, i + 1, 8))).size >= (kind === 'flag' ? 2 : 4), true);
}
assert.equal(clock(0), '10:00'); assert.equal(clock(8 * 3600), '18:00');
// Old careers gain an empty carryover bag; new mail survives storage round trips.
let stored;
Object.defineProperty(globalThis, 'localStorage', { configurable:true, value:{getItem:()=>stored,setItem:(_key,value)=>{stored=value;}} });
stored=JSON.stringify({day:2,pay:345,warnings:0,double:false,suspended:false});
assert.deepEqual(readCareer().carryover,[]);
const saved={...freshCareer(),carryover:[0,4,0,2]};saveCareer(saved);assert.deepEqual(readCareer(),saved);
stored=JSON.stringify({...saved,carryover:[null]});assert.deepEqual(readCareer(),freshCareer());
stored=JSON.stringify({...saved,mailCount:-1});assert.deepEqual(readCareer(),freshCareer());
// Old Mabou 469+6 careers shift indices above removed rural box 217 down by one on 468+7 land, once only.
const oldCarry=Array(475).fill(0);
oldCarry[0]=1;oldCarry[216]=3;oldCarry[MABOU_REMOVED_RURAL_1347]=5;oldCarry[230]=2;oldCarry[468]=4;oldCarry[469]=6;oldCarry[474]=7;
const oldCareer={day:5,pay:1000,warnings:1,double:false,suspended:false,carryover:oldCarry};
assert.equal(migrateCareer(oldCareer,469,6),oldCareer,'before-install land leaves carryover alone');
const migrated=migrateCareer(oldCareer,468,7);
assert.equal(migrated.mailCount,468);assert.equal(migrated.carryover.length,475);
assert.deepEqual([migrated.carryover[0],migrated.carryover[216],migrated.carryover[229],migrated.carryover[230],migrated.carryover[467],migrated.carryover[468],migrated.carryover[473],migrated.carryover[474]],[1,3,2,0,4,6,7,0]);
assert.equal(migrateCareer(migrated,468,7),migrated,'migration is idempotent on reload');
saveCareer(migrated);assert.deepEqual(readCareer(),migrated);
assert.equal(nextCareer(migrated,'clear').mailCount,468,'nextCareer preserves mailCount');
const emptyMig=migrateCareer(freshCareer(),468,7);assert.deepEqual(emptyMig,{...freshCareer(),mailCount:468});
// Simulate an iframe which rejects every storage access.
Object.defineProperty(globalThis, 'localStorage', { get() { throw Error('SecurityError'); } });
assert.deepEqual(readCareer(), freshCareer()); assert.doesNotThrow(() => saveCareer(next));
console.log('PASS: photo timing/location, fixed traps, avoidable verdict thresholds, missed-stop cap, ground-property cap, carryover, suspension/pay, double-day union, deterministic draw, wordings, clock, refused storage.');
console.log(`Day 1: ${dayType(1)}, ${first.pieces.filter(Boolean).length} stops, ${first.pieces.reduce((a,b) => a+b,0)} pieces; stuffed indices: ${first.stuffed.flatMap((v,i) => v ? [i] : []).join(', ')}.`);
