import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { createCode, SEATS } from '../js/common.js';

const PROJECT = 'demo-apex-circuit';
const SERVER_TIME = { '.sv': 'timestamp' };

async function signIn() {
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true })
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function db(path, user, method = 'GET', value) {
  const url = new URL('http://127.0.0.1:9000/' + path + '.json');
  url.searchParams.set('ns', PROJECT + '-default-rtdb');
  if (user) url.searchParams.set('auth', user.idToken);
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value)
  });
  return { status: response.status, value: await response.json() };
}

function allowed(response) {
  assert.equal(response.status, 200, JSON.stringify(response));
  return response.value;
}

function denied(response) {
  assert.ok([401, 403].includes(response.status), JSON.stringify(response));
}

test('aturan RTDB membatasi lobby, slot, input, fase, dan hasil', { timeout: 30000 }, async t => {
  const [host, ...drivers] = await Promise.all(Array.from({ length: 6 }, signIn));
  const code = createCode();
  const path = 'races/' + code;
  const seed = {
    host: host.localId, createdAt: SERVER_TIME, status: 'lobby', round: 0, startsAt: 0, endsAt: 0
  };
  const memberPath = seat => path + '/seats/' + seat + '/member';
  const member = (user, index) => ({ uid: user.localId, name: 'Pembalap ' + index });
  let lobby;

  await t.test('pembuatan lobby, penolakan akses anonim dan daftar lobby', async () => {
    denied(await db(path, null, 'PUT', { meta: seed }));
    denied(await db(path, drivers[0], 'PUT', { meta: seed }));
    denied(await db('races/BAD', host, 'PUT', { meta: seed }));
    allowed(await db(path, host, 'PUT', { meta: seed }));
    lobby = allowed(await db(path + '/meta', host));
    denied(await db(path, drivers[0]));
    denied(await db(path, null));
    denied(await db('races', host));
    denied(await db(path, drivers[0], 'DELETE'));
  });

  await t.test('klaim serentak, batas empat kursi, dan satu kursi per UID', async () => {
    denied(await db(memberPath('s4'), drivers[0], 'PUT', member(drivers[0], 1)));
    denied(await db(memberPath('s0'), drivers[0], 'PUT', { ...member(drivers[0], 1), extra: true }));
    denied(await db(memberPath('s0'), drivers[0], 'PUT', member(drivers[1], 1)));
    denied(await db(path + '/seats', drivers[0], 'PATCH', {
      's0/member': member(drivers[0], 1), 's1/member': member(drivers[0], 2)
    }));
    const claim = await Promise.all(drivers.map(async (driver, index) => {
      for (const seat of SEATS) {
        const response = await db(memberPath(seat), driver, 'PUT', member(driver, index + 1));
        if (response.status === 200) return { driver, seat };
        denied(response);
      }
      return null;
    }));
    const members = claim.filter(Boolean);
    assert.equal(members.length, 4);
    assert.equal(new Set(members.map(entry => entry.seat)).size, 4);
    const { driver, seat } = members[0];
    denied(await db(memberPath(seat), claim.includes(null) ? drivers[claim.indexOf(null)] : host, 'PUT', member(driver, 9)));
    const other = members[1];
    denied(await db(path + '/seats/' + seat, other.driver, 'DELETE'));
    allowed(await db(path + '/seats/' + seat, driver, 'DELETE'));
    denied(await db(path, driver));
    denied(await db(memberPath(seat), other.driver, 'PUT', member(other.driver, 9)));
    allowed(await db(memberPath(seat), driver, 'PUT', member(driver, 1)));
    allowed(await db(path, driver));
  });

  const seats = allowed(await db(path + '/seats', host));
  const first = drivers.find(driver => driver.localId === seats.s0.member.uid);
  const second = drivers.find(driver => driver.localId === seats.s1.member.uid);
  const inputPath = path + '/seats/s0/input';
  const input = { steer: 0.55, gas: 1, brake: 0, at: Date.now() - 600, round: 0 };

  await t.test('setir hanya milik UID sendiri, rentang dan usia input divalidasi', async () => {
    denied(await db(inputPath, second, 'PUT', input));
    denied(await db(inputPath, host, 'PUT', input));
    denied(await db(inputPath, first, 'PUT', { ...input, steer: 1.1 }));
    denied(await db(inputPath, first, 'PUT', { ...input, gas: -1 }));
    denied(await db(inputPath, first, 'PUT', { ...input, at: Date.now() - 3000 }));
    denied(await db(inputPath, first, 'PUT', { ...input, extra: 1 }));
    allowed(await db(inputPath, first, 'PUT', input));
    denied(await db(inputPath, first, 'PUT', input));
    denied(await db(inputPath + '/gas', first, 'DELETE'));
    assert.equal(allowed(await db(inputPath, host)).steer, .55);
  });

  await t.test('host mengunci grid, menerbitkan hasil, dan membuka ronde ulang', async () => {
    const start = Date.now() + 900;
    const racing = { ...lobby, status: 'racing', round: 1, startsAt: start, endsAt: start + 90000 };
    denied(await db(path + '/meta', first, 'PUT', racing));
    denied(await db(path + '/meta', host, 'PUT', { ...racing, host: first.localId }));
    denied(await db(path + '/meta', host, 'PUT', { ...racing, round: 3 }));
    allowed(await db(path + '/meta', host, 'PUT', racing));
    denied(await db(path + '/seats/s0', first, 'DELETE'));
    denied(await db(path + '/seats/s1', host, 'DELETE'));
    denied(await db(inputPath, first, 'PUT', { ...input, at: SERVER_TIME }));
    allowed(await db(inputPath, first, 'PUT', { ...input, at: SERVER_TIME, round: 1 }));
    const finished = { ...racing, status: 'finished', winner: 0, times: { s0: 31000, s1: 33000, s2: 36000, s3: 37000 } };
    denied(await db(path + '/meta', host, 'PUT', finished));
    await setTimeout(Math.max(0, start - Date.now() + 60));
    denied(await db(path + '/meta', host, 'PUT', { ...finished, winner: 3, times: { ...finished.times, s3: 0 } }));
    denied(await db(path + '/meta', host, 'PUT', { ...finished, times: { s0: 31000 } }));
    allowed(await db(path + '/meta', host, 'PUT', finished));
    denied(await db(inputPath, first, 'PUT', { ...input, at: SERVER_TIME, round: 1 }));
    allowed(await db(path + '/meta', host, 'PUT', { ...lobby, round: 1 }));
    allowed(await db(path + '/seats/s0', host, 'DELETE'));
    denied(await db(path, first));
    allowed(await db(path, host, 'DELETE'));
    denied(await db(path, second));
  });
});
