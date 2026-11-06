import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAP_COUNT, SEATS, NEUTRAL, createCode, displayCode, normalizeCode, validCode,
  cleanName, freshInput, racePhase
} from '../js/common.js';
import { createRace, stepRace, raceResult, TRACK, trackAt, nearestTrack } from '../js/physics.js';
import { joinRoom } from '../js/firebase.js';

test('kode undangan bisa disalin dari layar dan spasi nama dirapikan', () => {
  for (let i = 0; i < 200; i++) {
    const code = createCode();
    assert.ok(validCode(code));
    assert.equal(normalizeCode(displayCode(code.toLowerCase())), code);
  }
  assert.equal(cleanName('  Gema   Merah  '), 'Gema Merah');
  assert.equal(cleanName('a'.repeat(50)).length, 20);
});

test('hanya input segar dari ronde aktif yang diterima simulasi', () => {
  assert.ok(freshInput({ round: 1, at: 9800 }, 1, 10000));
  assert.equal(freshInput({ round: 1, at: 7500 }, 1, 10000), false);
  assert.equal(freshInput({ round: 0, at: 10000 }, 1, 10000), false);
  assert.equal(freshInput({ round: 1, at: 12000 }, 1, 10000), false);
  assert.equal(racePhase({ status: 'racing', startsAt: 10000 }, 9999), 'countdown');
  assert.equal(racePhase({ status: 'racing', startsAt: 10000 }, 10000), 'racing');
});

test('peserta baru bisa mengklaim slot tanpa akses baca awal', async () => {
  const calls = [];
  const api = {
    uid: 'driver',
    async get() { throw new Error('Error: Permission denied'); },
    async set(path, member) {
      calls.push([path, member]);
      if (path.includes('/s0/')) throw Object.assign(new Error('Slot terisi'), { code: 'PERMISSION_DENIED' });
    }
  };
  assert.equal(await joinRoom(api, 'ABCDE23456', 'Gema'), 's1');
  assert.deepEqual(calls.map(([path]) => path), [
    'races/ABCDE23456/seats/s0/member', 'races/ABCDE23456/seats/s1/member'
  ]);
  assert.deepEqual(calls[1][1], { uid: 'driver', name: 'Gema' });
});

test('lintasan menyambung pada garis start dan grid tidak tumpang tindih', () => {
  assert.deepEqual(trackAt(0), trackAt(TRACK.length));
  const entries = SEATS.map(seat => ({ seat, name: seat }));
  const race = createRace(entries);
  for (const [i, a] of race.cars.entries()) {
    assert.equal(a.lap, 0);
    assert.ok(a.progress < 0);
    for (const b of race.cars.slice(i + 1)) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 30);
  }
});

test('gas, setir, rem, dan netral memengaruhi mobil', () => {
  const race = createRace([{ seat: 's0', name: 'Uji' }]);
  const car = race.cars[0];
  const initialHeading = car.heading;
  for (let i = 0; i < 30; i++) stepRace(race, { s0: { steer: .2, gas: 1, brake: 0 } }, 1 / 60, i * 17);
  assert.ok(car.speed > 100);
  assert.notEqual(car.heading, initialHeading);
  const speed = car.speed;
  stepRace(race, { s0: NEUTRAL }, 1 / 60, 525);
  assert.ok(car.speed < speed);
  for (let i = 0; i < 35 && car.speed > 0; i++) {
    stepRace(race, { s0: { steer: 0, gas: 0, brake: 1 } }, 1 / 60, 550 + i * 17);
  }
  assert.equal(car.speed, 0);
  assert.ok(nearestTrack(car.x, car.y).gap <= 68.01);
  assert.deepEqual(raceResult(race), { winner: -1, times: { s0: 0 } });
});

test('pedal rem membuat mobil berhenti sebelum mundur, dan gas membalik arah lewat nol', () => {
  const race = createRace([{ seat: 's0', name: 'Uji' }]);
  const car = race.cars[0];
  let elapsed = 0;
  const advance = input => stepRace(race, { s0: input }, 1 / 60, elapsed += 1000 / 60);
  const gas = { steer: 0, gas: 1, brake: 0 };
  const brake = { steer: 0, gas: 0, brake: 1 };
  for (let i = 0; i < 26; i++) advance(gas);
  const forwardProgress = car.progress;
  assert.ok(car.speed > 0);
  for (let i = 0; i < 50 && car.speed > 0; i++) advance(brake);
  assert.equal(car.speed, 0);
  assert.ok(car.progress > forwardProgress);
  const stoppedProgress = car.progress;
  for (let i = 0; i < 18; i++) advance(brake);
  assert.ok(car.speed < 0);
  assert.ok(car.progress < stoppedProgress);
  assert.equal(car.lap, 0);
  const reverseSpeed = car.speed;
  advance(NEUTRAL);
  assert.ok(car.speed > reverseSpeed && car.speed < 0);
  for (let i = 0; i < 50 && car.speed < 0; i++) advance(gas);
  assert.equal(car.speed, 0);
  advance(gas);
  assert.ok(car.speed > 0);
});

test('memotong lintasan dan berputar mundur tidak menambah putaran', () => {
  const race = createRace([{ seat: 's0', name: 'Uji' }]);
  const car = race.cars[0];
  for (const distance of [-15, 15, -15, 15, -15, TRACK.length / 2, 0]) {
    Object.assign(car, trackAt(distance));
    stepRace(race, {}, 1 / 60, 1000);
  }
  assert.equal(car.checkpoint, 0);
  assert.equal(car.lap, 0);
  assert.equal(car.finishedAt, 0);
});

test('empat bot menuntaskan tiga putaran dan pemenang punya waktu tercepat', () => {
  const race = createRace(SEATS.map(seat => ({ seat, name: seat, bot: true })));
  for (let i = 1; i <= 5400 && race.cars.some(car => !car.finishedAt); i++) {
    stepRace(race, {}, 1 / 60, i * 1000 / 60);
  }
  for (const car of race.cars) {
    assert.equal(car.lap, LAP_COUNT);
    assert.equal(car.checkpoint, LAP_COUNT * 4);
    assert.ok(car.finishedAt > 0 && car.finishedAt < 90000);
  }
  const { winner, times } = raceResult(race);
  assert.equal(times['s' + winner], Math.min(...Object.values(times)));
});
