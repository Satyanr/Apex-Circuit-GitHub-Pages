import {
  SEATS, COLORS, ROOM_MS, NEUTRAL, DRIVE_KEYS, clamp, cleanName, normalizeCode, validCode,
  displayCode, readSession, writeSession, holdKeys, keyboardDrive, showError, racePhase, resultLabel
} from './common.js';
import { firebaseClient, joinRoom, roomPath } from './firebase.js';

const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map(node => [node.id, node]));
const query = new URLSearchParams(location.search);
const sessionKey = 'apex-controller:' + (query.get('emulator') === '1' ? 'emulator' : 'online');
const actions = new Map();
const STICK_TRAVEL = 0.31;
let player = null;
let joining = false;
let keys = NEUTRAL;
let mode = 'touch';
let steer = 0;
let touchSteer = 0;
let steeringPointer = null;
let center = null;
let rawTilt = null;
let rotation = null;
let lastSample = 0;
let tiltAttempt = 0;
let tiltTimer;

function text(node, value) {
  if (node.textContent !== String(value)) node.textContent = value;
}

function clearControls() {
  keys = NEUTRAL;
  steer = 0;
  const pointer = steeringPointer;
  steeringPointer = null;
  touchSteer = 0;
  if (pointer !== null && ui.joystick.hasPointerCapture(pointer)) {
    ui.joystick.releasePointerCapture(pointer);
  }
  for (const pointers of actions.values()) pointers.clear();
}

function setMode(next, note) {
  mode = next;
  ui.touch.setAttribute('aria-pressed', String(next === 'touch'));
  ui.tilt.setAttribute('aria-pressed', String(next !== 'touch'));
  ui.joystick.hidden = next !== 'touch';
  ui['tilt-controls'].hidden = next === 'touch';
  ui.calibrate.hidden = next !== 'tilt';
  text(ui['mode-note'], note);
}

function useTouch(note = 'Geser joystick untuk belok. Tahan rem sampai mobil berhenti untuk mundur.') {
  tiltAttempt++;
  clearTimeout(tiltTimer);
  clearControls();
  center = null;
  setMode('touch', note);
}

async function enableTilt() {
  if (!isSecureContext || !window.DeviceOrientationEvent) {
    useTouch('Sensor memerlukan HTTPS dan HP yang mendukung. Joystick sentuh aktif.');
    return;
  }
  const attempt = ++tiltAttempt;
  clearControls();
  center = null;
  rawTilt = null;
  lastSample = 0;
  setMode('waiting', 'Menunggu sensor. Pegang HP pada posisi setir tengah.');
  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function' &&
        await DeviceOrientationEvent.requestPermission() !== 'granted') {
      if (attempt === tiltAttempt) useTouch('Izin sensor ditolak. Joystick sentuh aktif.');
      return;
    }
  } catch {
    if (attempt === tiltAttempt) useTouch('Sensor tidak dapat diaktifkan. Joystick sentuh aktif.');
    return;
  }
  if (attempt === tiltAttempt && mode === 'waiting') {
    clearTimeout(tiltTimer);
    tiltTimer = setTimeout(() => useTouch('Sensor belum mengirim data. Joystick sentuh aktif.'), 2200);
  }
}

function orientation(event) {
  if (mode === 'touch' || !Number.isFinite(event.gamma) || !Number.isFinite(event.beta)) return;
  const angle = screen.orientation?.angle ?? window.orientation ?? 0;
  const radians = angle * Math.PI / 180;
  rawTilt = event.gamma * Math.cos(radians) + event.beta * Math.sin(radians);
  lastSample = performance.now();
  if (center === null || angle !== rotation) {
    rotation = angle;
    center = rawTilt;
    steer = 0;
  }
  const delta = ((rawTilt - center + 540) % 360) - 180;
  const target = Math.sign(delta) * clamp((Math.abs(delta) - 2) / 25, 0, 1);
  steer += (target - steer) * 0.34;
  if (mode === 'waiting') {
    clearTimeout(tiltTimer);
    setMode('tilt', 'Miringkan HP untuk belok. Tahan rem sampai mobil berhenti untuk mundur.');
  }
}

function moveJoystick(event) {
  if (event.pointerId !== steeringPointer) return;
  const { left, width } = ui.joystick.getBoundingClientRect();
  const offset = (event.clientX - left - width / 2) / (width * STICK_TRAVEL);
  const deadZone = 0.08;
  touchSteer = Math.sign(offset) * clamp((Math.abs(offset) - deadZone) / (1 - deadZone), 0, 1);
  updateController();
}

function driveInput() {
  if (document.hidden || !document.hasFocus()) return NEUTRAL;
  const pressed = action => actions.get(action).size > 0;
  const turn = mode === 'tilt' ? steer : touchSteer;
  return {
    steer: Math.round(clamp(turn + keys.steer, -1, 1) * 100) / 100,
    gas: Number(pressed('gas') || keys.gas > 0),
    brake: Number(pressed('brake') || keys.brake > 0)
  };
}

function resetPlayer(message) {
  for (const stop of player?.stop || []) stop();
  player = null;
  writeSession(sessionKey, null);
  useTouch();
  ui['drive-panel'].hidden = true;
  ui['join-panel'].hidden = false;
  ui.leave.disabled = false;
  text(ui.connection, 'PIT LANE');
  ui.connection.dataset.state = 'local';
  if (message) text(ui['join-error'], message);
}

function openDrive(api, code, seat, room) {
  const index = SEATS.indexOf(seat);
  const name = room.seats[seat].member.name;
  const path = roomPath(code);
  const current = {
    api, code, path, seat, meta: room.meta, stop: [], lastSent: 0, lastValue: '',
    pending: false, failures: 0, leaving: false
  };
  player = current;
  writeSession(sessionKey, { code, name });
  ui['drive-panel'].style.setProperty('--driver-color', COLORS[index]);
  text(ui['driver-number'], String(index + 1).padStart(2, '0'));
  text(ui['driver-name'], name);
  text(ui['active-room'], 'LOBBY ' + displayCode(code));
  text(ui['drive-error'], '');
  ui['join-panel'].hidden = true;
  ui['drive-panel'].hidden = false;
  const unavailable = () => {
    if (player === current && !current.leaving) {
      resetPlayer('Slot dilepas atau lobby ditutup. Minta kode aktif dari host.');
    }
  };
  current.stop.push(api.watch(path + '/meta', meta => {
    if (!meta) return unavailable();
    current.meta = meta;
  }, unavailable));
  current.stop.push(api.watch(path + '/seats/' + seat + '/member', member => {
    if (member?.uid !== api.uid) unavailable();
  }, unavailable));
}

async function submitJoin(event) {
  event?.preventDefault();
  if (joining) return;
  const code = normalizeCode(ui.code.value);
  const name = cleanName(ui.name.value);
  if (!validCode(code) || !name) {
    text(ui['join-error'], 'Masukkan kode lobby 10 karakter dan nama pembalap.');
    return;
  }
  joining = true;
  ui.join.disabled = true;
  text(ui.join.firstChild, 'Menyambung ');
  text(ui['join-error'], '');
  try {
    const api = await firebaseClient('controller');
    if (!api.connected()) throw new Error('Firebase sedang menyambung kembali.');
    const seat = await joinRoom(api, code, name);
    const room = await api.get(roomPath(code));
    openDrive(api, code, seat, room);
  } catch (error) {
    showError(ui['join-error'], error);
  } finally {
    joining = false;
    ui.join.disabled = false;
    text(ui.join.firstChild, 'Gabung balapan ');
  }
}

async function sendInput(current, now, phase, input) {
  const { api, path, seat, meta } = current;
  const clock = performance.now();
  if (current.pending || current.leaving || !api.connected() ||
      now >= meta.createdAt + ROOM_MS || phase === 'finished' || clock - current.lastSent < 62) return;
  const value = [meta.round, input.steer, input.gas, input.brake].join('/');
  if (value === current.lastValue && clock - current.lastSent < 780) return;
  current.pending = true;
  current.lastSent = clock;
  try {
    await api.set(path + '/seats/' + seat + '/input', { ...input, round: meta.round, at: api.stamp() });
    current.lastValue = value;
    current.failures = 0;
    if (player === current) text(ui['drive-error'], '');
  } catch (error) {
    current.lastValue = '';
    current.failures++;
    if (player === current && current.failures >= 4) showError(ui['drive-error'], error);
  } finally {
    current.pending = false;
  }
}

function updateController() {
  if (!player) return;
  const current = player;
  const { api, meta, seat } = current;
  const now = api.now();
  if (now >= meta.createdAt + ROOM_MS) {
    resetPlayer('Lobby kedaluwarsa. Minta kode baru dari host.');
    return;
  }
  if (mode === 'tilt' && !document.hidden && performance.now() - lastSample > 2000) {
    useTouch('Data sensor terhenti. Joystick sentuh aktif.');
  }
  const phase = racePhase(meta, now);
  const online = api.connected();
  text(ui.connection, online ? 'TERHUBUNG' : 'MENYAMBUNG ULANG');
  ui.connection.dataset.state = online ? 'online' : 'offline';
  const status = {
    lobby: 'Siap · Menunggu host',
    countdown: 'Bersiap · ' + clamp(Math.ceil((meta.startsAt - now) / 1000), 1, 3),
    racing: now < meta.endsAt ? 'Balapan · Lihat videotron' : 'Menunggu hasil',
    finished: (meta.winner === SEATS.indexOf(seat) ? 'Juara! · ' : 'Ronde selesai · ') + resultLabel(meta.times?.[seat])
  };
  text(ui['drive-status'], online ? status[phase] : 'Koneksi terputus · input dijeda');

  const input = driveInput();
  ui.wheel.style.setProperty('--steer', input.steer * 47 + 'deg');
  ui.joystick.style.setProperty('--stick-position', (0.5 + input.steer * STICK_TRAVEL) * 100 + '%');
  ui.joystick.dataset.pressed = String(steeringPointer !== null);
  ui.gas.dataset.pressed = String(input.gas > 0);
  ui.brake.dataset.pressed = String(input.brake > 0);
  void sendInput(current, now, phase, phase === 'racing' && now < meta.endsAt ? input : NEUTRAL);
}

async function leaveRoom() {
  const current = player;
  if (!current || current.leaving) return;
  if (current.meta.status !== 'lobby') {
    resetPlayer('Controller dilepas. Slot tetap tersedia untukmu sampai lobby dibuka lagi.');
    return;
  }
  if (!current.api.connected()) {
    text(ui['drive-error'], 'Tunggu koneksi pulih agar slot dapat dilepas.');
    return;
  }
  current.leaving = true;
  ui.leave.disabled = true;
  clearControls();
  try {
    await current.api.set(current.path + '/seats/' + current.seat, null);
    resetPlayer('Kamu sudah keluar dari lobby.');
  } catch (error) {
    current.leaving = false;
    ui.leave.disabled = false;
    showError(ui['drive-error'], error);
  }
}

ui.joystick.addEventListener('pointerdown', event => {
  if (event.button !== 0 || steeringPointer !== null || mode !== 'touch') return;
  event.preventDefault();
  ui.joystick.setPointerCapture(event.pointerId);
  steeringPointer = event.pointerId;
  moveJoystick(event);
});
ui.joystick.addEventListener('pointermove', moveJoystick);
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  ui.joystick.addEventListener(type, event => {
    if (event.pointerId !== steeringPointer) return;
    steeringPointer = null;
    touchSteer = 0;
    updateController();
  });
}
ui.joystick.addEventListener('contextmenu', event => event.preventDefault());

for (const action of ['gas', 'brake']) {
  const button = ui[action];
  const pointers = new Set();
  actions.set(action, pointers);
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    pointers.add(event.pointerId);
    updateController();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(type, event => {
      pointers.delete(event.pointerId);
      updateController();
    });
  }
  button.addEventListener('contextmenu', event => event.preventDefault());
}
ui['join-form'].addEventListener('submit', submitJoin);
ui.leave.addEventListener('click', leaveRoom);
ui.tilt.addEventListener('click', enableTilt);
ui.touch.addEventListener('click', () => useTouch());
ui.calibrate.addEventListener('click', () => {
  if (rawTilt === null) return;
  center = rawTilt;
  steer = 0;
  text(ui['mode-note'], 'Posisi tengah tersimpan. Miringkan HP untuk belok.');
});
window.addEventListener('deviceorientation', orientation);
window.addEventListener('blur', clearControls);
document.addEventListener('visibilitychange', clearControls);
holdKeys(DRIVE_KEYS, (held, map) => { keys = player ? keyboardDrive(held, map) : NEUTRAL; });
setInterval(updateController, 67);

const invitedCode = normalizeCode(query.get('room') || '');
const saved = readSession(sessionKey);
if (validCode(invitedCode)) ui.code.value = displayCode(invitedCode);
if (ui['join-loading']) ui['join-loading'].hidden = true;
ui.join.disabled = false;
if (saved && (!invitedCode || invitedCode === saved.code)) {
  ui.code.value = displayCode(saved.code);
  ui.name.value = saved.name;
  void submitJoin();
}
