export const SEATS = ['s0', 's1', 's2', 's3'];
export const COLORS = ['#d5fa52', '#53dfff', '#ff8860', '#e397ff'];
export const LAP_COUNT = 3;
export const COUNTDOWN_MS = 3500;
export const RACE_MS = 90000;
export const ROOM_MS = 4 * 60 * 60 * 1000;
export const PRESENCE_MS = 4000;
export const INPUT_TIMEOUT_MS = 1250;
export const NEUTRAL = Object.freeze({ steer: 0, gas: 0, brake: 0 });
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), n => ALPHABET[n & 31]).join('');
}

export function normalizeCode(value) {
  return value.toUpperCase().replace(/[\s\u2010-\u2015-]/g, '');
}

export function validCode(code) {
  return /^[A-HJ-NP-Z2-9]{10}$/.test(code);
}

export function displayCode(code) {
  return code.slice(0, 5) + '–' + code.slice(5);
}

export function cleanName(value) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 20);
}

export function controllerURL(code) {
  const url = new URL('./controller.html', location.href);
  url.searchParams.set('room', code);
  if (new URLSearchParams(location.search).get('emulator') === '1') {
    url.searchParams.set('emulator', '1');
  }
  return url.href;
}

export function readSession(key) {
  try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
}

export function writeSession(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch { /* The current session can still run without browser storage. */ }
}

export function timeLabel(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' +
    String(seconds % 60).padStart(2, '0');
}

export function resultLabel(ms) {
  return ms ? (ms / 1000).toFixed(2).replace('.', ',') + ' dtk' : 'DNF';
}

export function racePhase(meta, now) {
  if (meta.status !== 'racing') return meta.status;
  return now < meta.startsAt ? 'countdown' : 'racing';
}

export function freshInput(input, round, now, timeout = INPUT_TIMEOUT_MS) {
  return input?.round === round && input.at >= now - timeout && input.at <= now + 150;
}

export function showError(element, error) {
  const code = String(error?.code || '').toLowerCase();
  if (code.includes('operation-not-allowed')) {
    element.textContent = 'Aktifkan metode Anonymous di Firebase Authentication.';
  } else if (/permission[-_\s]+denied/i.test(code || error?.message || '')) {
    element.textContent = 'Akses ditolak. Periksa aturan Firebase atau status lobby.';
  } else if (code.includes('network') || error instanceof TypeError) {
    element.textContent = 'Gagal tersambung. Periksa internet dan konfigurasi Firebase.';
  } else {
    element.textContent = error?.message || 'Terjadi kesalahan. Coba lagi.';
  }
}

export function holdKeys(map, change) {
  const held = new Set();
  function set(event, pressed) {
    if (!(event.code in map) || event.altKey || event.metaKey || event.ctrlKey ||
        event.target.closest?.('input, textarea, select, [contenteditable]') ||
        (event.code === 'Space' && event.target.closest?.('button, a'))) return;
    event.preventDefault();
    if (pressed) held.add(event.code);
    else held.delete(event.code);
    change(held, map);
  }
  const down = event => set(event, true);
  const up = event => set(event, false);
  function clear() { held.clear(); change(held, map); }
  function clearIfHidden() { if (document.hidden) clear(); }
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', clearIfHidden);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', clear);
    document.removeEventListener('visibilitychange', clearIfHidden);
    clear();
  };
}

export const DRIVE_KEYS = Object.freeze({
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'gas', KeyW: 'gas', ArrowDown: 'brake', KeyS: 'brake', Space: 'brake'
});

export function keyboardDrive(held, map) {
  const actions = new Set(Array.from(held, key => map[key]));
  return {
    steer: Number(actions.has('right')) - Number(actions.has('left')),
    gas: Number(actions.has('gas')),
    brake: Number(actions.has('brake'))
  };
}
