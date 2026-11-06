import {
  SEATS, COLORS, LAP_COUNT, COUNTDOWN_MS, RACE_MS, ROOM_MS, PRESENCE_MS, NEUTRAL,
  DRIVE_KEYS, holdKeys, keyboardDrive, controllerURL, displayCode, readSession,
  writeSession, showError, freshInput, racePhase, resultLabel, timeLabel
} from './common.js?v=3';
import { createRace, raceResult, standings, stepRace } from './physics.js?v=3';
import { makeRenderer } from './renderer.js';
import { createRoom, firebaseClient, roomPath } from './firebase.js';
import qrcode from '../vendor/qrcode.js';

const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map(node => [node.id, node]));
const sessionKey = 'apex-host' + location.search;
const renderer = makeRenderer(ui.track);
const bots = ['Kamu', 'Vega', 'Komet', 'Orbit'].map((name, index) => ({
  name, seat: SEATS[index], bot: index > 0
}));
const state = {
  mode: 'home', code: '', meta: null, seats: {}, api: null, race: null, busy: '', stop: [],
  keyboard: NEUTRAL, lastTime: 0, accumulator: 0, nextFinishAttempt: 0
};
let lastRoster = '';
let lastPodium = '';
let lastTrack = null;
let copied = false;
const step = 1 / 60;

function text(node, value) {
  if (node.textContent !== String(value)) node.textContent = value;
}

function lobbyMeta(meta) {
  return {
    host: meta.host, createdAt: meta.createdAt, round: meta.round,
    status: 'lobby', startsAt: 0, endsAt: 0
  };
}

function serverNow() {
  return state.mode === 'online' ? state.api.now() : Date.now();
}

function setBusy(value) {
  state.busy = value;
  ui.create.disabled = !!value;
  ui.practice.disabled = !!value;
  text(ui.create.firstChild, value === 'create' ? 'Membuka lobby ' : 'Buat lobby ');
}

function showHome(error) {
  for (const stop of state.stop.splice(0)) stop();
  Object.assign(state, { mode: 'home', code: '', meta: null, seats: {}, race: null });
  writeSession(sessionKey, null);
  setBusy('');
  if (error) showError(ui['home-error'], error);
}

function observeRoomError(error) {
  if (state.mode !== 'online' || state.busy === 'close') return;
  showHome(error || new Error('Lobby telah ditutup. Buat lobby baru untuk melanjutkan.'));
}

function buildQR(url) {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const modules = qr.getModuleCount();
  const pixel = 6;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = (modules + 8) * pixel;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (qr.isDark(row, col)) ctx.fillRect((col + 4) * pixel, (row + 4) * pixel, pixel, pixel);
    }
  }
  ui.qr.replaceChildren(canvas);
}

function openRoom(api, code, room) {
  Object.assign(state, {
    mode: 'online', api, code, meta: room.meta, seats: room.seats || {}, race: null
  });
  writeSession(sessionKey, code);
  text(ui['room-code'], displayCode(code));
  buildQR(controllerURL(code));
  const path = roomPath(code);
  state.stop.push(api.watch(path + '/meta', value => {
    if (!value) return observeRoomError();
    state.meta = value;
    if (value.status === 'lobby') state.race = null;
  }, observeRoomError));
  state.stop.push(api.watch(path + '/seats', value => {
    state.seats = value || {};
  }, observeRoomError));
}

async function createOnline() {
  if (state.busy) return;
  text(ui['home-error'], '');
  text(ui['host-error'], '');
  setBusy('create');
  try {
    const api = await firebaseClient('host');
    if (!api.connected()) throw new Error('Firebase sedang menyambung kembali.');
    const code = await createRoom(api);
    const room = await api.get(roomPath(code));
    openRoom(api, code, room);
  } catch (error) {
    showError(ui['home-error'], error);
  } finally {
    setBusy('');
  }
}

async function restoreOnline() {
  const code = readSession(sessionKey);
  if (!code) return;
  setBusy('create');
  try {
    const api = await firebaseClient('host');
    const room = await api.get(roomPath(code));
    if (room?.meta?.host !== api.uid) return showHome();
    openRoom(api, code, room);
  } catch (error) {
    showError(ui['home-error'], error);
  } finally {
    setBusy('');
  }
}

function occupied(seats = state.seats) {
  return SEATS.filter(seat => seats[seat]?.member).map(seat => ({
    seat, name: seats[seat].member.name, bot: false
  }));
}

function initializeRace(entries) {
  state.race = createRace(entries);
  state.accumulator = 0;
  state.nextFinishAttempt = 0;
}

function startPractice() {
  if (state.busy) return;
  const start = Date.now() + COUNTDOWN_MS;
  state.mode = 'demo';
  state.meta = { status: 'racing', round: 1, startsAt: start, endsAt: start + RACE_MS };
  initializeRace(bots);
}

async function writeOnline(action, task) {
  if (state.busy || !state.api?.connected()) return;
  setBusy(action);
  text(ui['host-error'], '');
  try {
    await task();
  } catch (error) {
    showError(ui['host-error'], error);
  } finally {
    setBusy('');
  }
}

function startOnline() {
  void writeOnline('start', async () => {
    const path = roomPath(state.code);
    const start = Math.round(state.api.now() + COUNTDOWN_MS);
    const next = {
      ...lobbyMeta(state.meta), status: 'racing', round: state.meta.round + 1,
      startsAt: start, endsAt: start + RACE_MS
    };
    await state.api.set(path + '/meta', next);
    // Membership is locked by the committed phase transition.
    const seats = await state.api.get(path + '/seats');
    if (!seats) throw new Error('Grid kosong. Buka kembali lobby dan minta pemain bergabung.');
    initializeRace(occupied(seats));
  });
}

function resetOnline() {
  void writeOnline('reset', () => state.api.set(roomPath(state.code) + '/meta', lobbyMeta(state.meta)));
}

function finishRace() {
  const next = { ...state.meta, status: 'finished', ...raceResult(state.race) };
  if (state.mode === 'demo') {
    state.meta = next;
    return;
  }
  if (state.busy || !state.api.connected() || Date.now() < state.nextFinishAttempt) return;
  state.nextFinishAttempt = Date.now() + 2500;
  void writeOnline('finish', () => state.api.set(roomPath(state.code) + '/meta', next));
}

function closeRoom() {
  void writeOnline('close', async () => {
    await state.api.set(roomPath(state.code), null);
    showHome();
  });
}

function updateRace(now, delta) {
  const race = state.race;
  if (!race || state.meta.status !== 'racing' || now < state.meta.startsAt) return;
  if (now < state.meta.endsAt && !race.cars.every(car => car.finishedAt)) {
    const inputs = {};
    if (state.mode === 'demo') {
      inputs.s0 = state.keyboard;
    } else if (state.api.connected()) {
      for (const { seat } of race.cars) {
        const input = state.seats[seat]?.input;
        if (freshInput(input, state.meta.round, now)) inputs[seat] = input;
      }
    }
    const elapsed = now - state.meta.startsAt;
    state.accumulator = Math.min(state.accumulator + delta, 0.1, elapsed / 1000);
    while (state.accumulator >= step) {
      state.accumulator -= step;
      stepRace(race, inputs, step, elapsed - state.accumulator * 1000);
    }
  }
  if (now >= state.meta.endsAt || race.cars.every(car => car.finishedAt)) finishRace();
}

function driverNumber(seat) {
  return String(SEATS.indexOf(seat) + 1).padStart(2, '0');
}

function drawRoster(rows, allowRemove) {
  const signature = JSON.stringify([rows, allowRemove]);
  if (signature === lastRoster) return;
  lastRoster = signature;
  ui.roster.replaceChildren(...rows.map(row => {
    const li = document.createElement('li');
    li.className = 'driver-row' + (row.name ? '' : ' empty');
    li.style.setProperty('--driver-color', COLORS[SEATS.indexOf(row.seat)]);
    const number = document.createElement('span');
    number.className = 'number';
    number.textContent = driverNumber(row.seat);
    const info = document.createElement('div');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = row.name || 'Slot kosong';
    const detail = document.createElement('span');
    detail.className = 'detail';
    detail.textContent = row.detail;
    info.append(name, detail);
    li.append(number, info);
    if (row.name && allowRemove) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-driver';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Keluarkan ' + row.name);
      remove.addEventListener('click', () => void writeOnline('remove', () =>
        state.api.set(roomPath(state.code) + '/seats/' + row.seat, null)));
      li.append(remove);
    }
    return li;
  }));
}

function drawResults(entries) {
  const { times, winner } = state.meta;
  const rows = entries.filter(entry => entry.seat in times).sort((a, b) =>
    (times[a.seat] || Infinity) - (times[b.seat] || Infinity) ||
      Number(b.seat === 's' + winner) - Number(a.seat === 's' + winner));
  const signature = JSON.stringify([rows, times, winner]);
  if (signature === lastPodium) return;
  lastPodium = signature;
  const champion = rows.find(entry => entry.seat === 's' + winner);
  text(ui['result-title'], champion ? champion.name + ' juara!' : 'Waktu habis');
  ui['result-list'].replaceChildren(...rows.map((row, index) => {
    const li = document.createElement('li');
    li.style.setProperty('--driver-color', COLORS[SEATS.indexOf(row.seat)]);
    const name = document.createElement('span');
    name.textContent = (times[row.seat] ? (index + 1) + '. ' : '— ') + row.name;
    const time = document.createElement('strong');
    time.textContent = resultLabel(times[row.seat]);
    li.append(name, time);
    return li;
  }));
}

function drawHUD(now, phase, entries) {
  const { mode, meta, race, api } = state;
  const online = mode === 'online';
  const live = online && api.connected();
  const lobby = phase === 'lobby';
  const finished = phase === 'finished';
  const active = phase === 'racing' || phase === 'countdown';
  const ready = online ? entries.filter(({ seat }) =>
    freshInput(state.seats[seat].input, meta.round, now, PRESENCE_MS)).length : 0;
  ui.intro.hidden = mode !== 'home';
  ui['pit-idle'].hidden = mode !== 'home';
  ui['pit-demo'].hidden = mode !== 'demo';
  ui['pit-online'].hidden = !online;
  ui['lobby-display'].hidden = !lobby;
  ui.podium.hidden = !finished;
  ui.copy.hidden = !lobby;
  ui['close'].disabled = !live || !!state.busy;
  ui.start.hidden = !(lobby || phase === 'interrupted');
  ui.start.disabled = !live || !!state.busy || (lobby && !ready);
  text(ui.start.firstChild, phase === 'interrupted' ? 'Buka ulang lobby ' : 'Mulai balapan ');
  ui.rematch.disabled = !!state.busy || (online && !live);
  text(ui['result-kicker'], mode === 'demo' ? 'HASIL LATIHAN' : 'HASIL BALAPAN');
  text(ui['tower-title'], active ? 'Posisi balapan' : 'Grid pembalap');
  text(ui['seat-count'], entries.length + '/4');
  text(ui['track-mode'], {
    home: 'STANDBY', lobby: 'LOBBY TERBUKA', countdown: 'GRID START', racing: 'BALAPAN',
    finished: 'FINIS', interrupted: 'RONDE TERPUTUS', expired: 'LOBBY KEDALUWARSA'
  }[phase]);
  text(ui.connection, online ? (live ? 'FIREBASE ONLINE' : 'MENYAMBUNG ULANG') : mode === 'demo' ? 'LATIHAN LOKAL' : 'LAYAR HOST');
  ui.connection.dataset.state = online ? (live ? 'online' : 'offline') : 'local';
  text(ui['clock-label'], phase === 'racing' ? 'SISA WAKTU' : 'BATAS WAKTU');
  text(ui.clock, timeLabel(phase === 'racing' ? meta.endsAt - now + 999 : RACE_MS));
  text(ui.laps, LAP_COUNT);
  const go = phase === 'racing' && now - meta.startsAt < 850;
  ui['race-signal'].hidden = phase !== 'countdown' && !go;
  if (!ui['race-signal'].hidden) {
    text(ui['signal-label'], go ? 'BALAPAN DIMULAI' : 'BERSIAP');
    text(ui['signal-number'], go ? 'GO!' : Math.min(3, Math.ceil((meta.startsAt - now) / 1000)));
  }

  let pit = 'Pemain mengendalikan mobil dari HP.';
  if (lobby) pit = ready + ' siap • ' + entries.length + ' slot terisi';
  if (phase === 'interrupted') pit = 'Ronde sebelumnya terputus. Buka kembali lobby untuk memulai ronde baru.';
  if (phase === 'expired') pit = 'Lobby telah mencapai batas 4 jam. Tutup lobby dan buat kode baru.';
  if (!live && online) pit = 'Koneksi Firebase terputus. Menunggu tersambung kembali.';
  text(ui['pit-note'], pit);
  text(ui['footer-status'], {
    home: 'BUAT LOBBY ATAU COBA LATIHAN', lobby: 'PESERTA MASUK LEWAT HP',
    countdown: 'BERSIAP DI GARIS START', racing: 'PANTAU BALAPAN DI LAYAR INI',
    finished: 'HASIL RONDE INI', interrupted: 'BUKA ULANG LOBBY', expired: 'BUAT LOBBY BARU'
  }[phase]);

  const rows = active && race ? standings(race.cars).map((car, rank) => ({
    seat: car.seat,
    name: car.name,
    detail: car.finishedAt ? '#' + (rank + 1) + ' · FINIS' :
      '#' + (rank + 1) + ' · PUTARAN ' + Math.min(LAP_COUNT, car.lap + 1) + '/' + LAP_COUNT
  })) : SEATS.map(seat => {
    const entry = entries.find(item => item.seat === seat);
    const isReady = online && freshInput(state.seats[seat]?.input, meta.round, now, PRESENCE_MS);
    const detail = finished && entry ? resultLabel(meta.times[seat]) : isReady ? 'SIAP' :
      entry ? 'TERPUTUS' : 'MENUNGGU PEMBALAP';
    return { seat, name: entry?.name, detail };
  });
  drawRoster(rows, online && lobby && live);
  if (finished) drawResults(entries);
}

function frame(stamp) {
  const now = serverNow();
  const dt = Math.max(0, (stamp - (state.lastTime || stamp)) / 1000);
  state.lastTime = stamp;
  const entries = state.mode === 'demo' ? bots : occupied();
  let phase = state.meta ? racePhase(state.meta, now) : 'home';
  if (state.mode === 'online' && now >= state.meta.createdAt + ROOM_MS) phase = 'expired';
  if (state.meta?.status === 'racing' && !state.race && phase !== 'expired') phase = 'interrupted';
  if (state.meta?.status === 'racing' && phase !== 'expired') updateRace(now, dt);
  if (state.meta?.status === 'finished' && phase !== 'expired') phase = 'finished';
  if (state.race) {
    renderer(state.race.cars);
    lastTrack = null;
  } else {
    const key = entries.map(entry => entry.seat).join(',');
    if (key !== lastTrack) {
      renderer(createRace(entries).cars);
      lastTrack = key;
    }
  }
  drawHUD(now, phase, entries);
  requestAnimationFrame(frame);
}

ui.create.addEventListener('click', createOnline);
ui.practice.addEventListener('click', startPractice);
ui.start.addEventListener('click', () => state.meta.status === 'racing' ? resetOnline() : startOnline());
ui.rematch.addEventListener('click', () => state.mode === 'demo' ? startPractice() : resetOnline());
ui.close.addEventListener('click', closeRoom);
ui['exit-demo'].addEventListener('click', () => showHome());
ui.copy.addEventListener('click', async () => {
  const url = controllerURL(state.code);
  try {
    await navigator.clipboard.writeText(url);
    if (copied) return;
    copied = true;
    text(ui.copy, 'Link tersalin ✓');
    setTimeout(() => { copied = false; text(ui.copy, 'Salin link ↗'); }, 1900);
  } catch {
    window.prompt('Salin link undangan ini', url);
  }
});
ui.fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    showError(state.mode === 'home' ? ui['home-error'] : ui['host-error'],
      new Error('Gunakan F11 atau menu layar penuh browser.'));
  }
});
document.addEventListener('fullscreenchange', () => {
  text(ui.fullscreen.querySelector('span'), document.fullscreenElement ? 'Keluar layar penuh' : 'Layar penuh');
  ui.fullscreen.setAttribute('aria-label', ui.fullscreen.querySelector('span').textContent);
});
holdKeys(DRIVE_KEYS, (held, map) => {
  state.keyboard = state.mode === 'demo' ? keyboardDrive(held, map) : NEUTRAL;
});
requestAnimationFrame(frame);
void restoreOnline();
