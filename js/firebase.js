import { firebaseConfig } from './firebase-config.js';
import { SEATS, createCode } from './common.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const demoProject = 'demo-apex-circuit';
const clients = new Map();

export function firebaseClient(role) {
  if (!clients.has(role)) {
    clients.set(role, connect(role).catch(error => {
      clients.delete(role);
      throw error;
    }));
  }
  return clients.get(role);
}

async function connect(role) {
  const emulator = new URLSearchParams(location.search).get('emulator') === '1';
  if (emulator && !['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
    throw new Error('Mode emulator hanya tersedia di localhost.');
  }
  if (!emulator && (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith('ISI_') ||
      !/^https:\/\//.test(firebaseConfig.databaseURL))) {
    throw new Error('Isi konfigurasi Firebase di js/firebase-config.js untuk bermain online.');
  }

  const [{ initializeApp, getApps }, authSdk, rtdb] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-database.js')
  ]);
  const name = 'apex-' + role;
  let app = getApps().find(item => item.name === name);
  let auth;
  let db;
  if (app) {
    auth = authSdk.getAuth(app);
    db = rtdb.getDatabase(app);
  } else {
    const config = emulator ? {
      apiKey: 'fake-api-key',
      authDomain: demoProject + '.firebaseapp.com',
      projectId: demoProject,
      databaseURL: 'https://' + demoProject + '-default-rtdb.firebaseio.com'
    } : firebaseConfig;
    app = initializeApp(config, name);
    auth = authSdk.initializeAuth(app, { persistence: authSdk.browserSessionPersistence });
    if (emulator) authSdk.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    db = rtdb.getDatabase(app);
    if (emulator) rtdb.connectDatabaseEmulator(db, '127.0.0.1', 9000);
  }
  await auth.authStateReady();
  const user = auth.currentUser ?? (await authSdk.signInAnonymously(auth)).user;

  let offset = 0;
  let connected = false;
  let resolveConnection;
  const firstConnection = new Promise(resolve => { resolveConnection = resolve; });
  const connectionHandlers = new Set();
  const stopOffset = rtdb.onValue(rtdb.ref(db, '.info/serverTimeOffset'), snap => {
    offset = Number(snap.val()) || 0;
  });
  const stopConnection = rtdb.onValue(rtdb.ref(db, '.info/connected'), snap => {
    connected = snap.val() === true;
    if (connected) resolveConnection();
    for (const handler of connectionHandlers) handler(connected);
  });
  let timer;
  try {
    await Promise.race([
      firstConnection,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Firebase belum tersambung. Periksa databaseURL dan internet.')), 12000);
      })
    ]);
  } catch (error) {
    stopOffset();
    stopConnection();
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return {
    uid: user.uid,
    now: () => Date.now() + offset,
    connected: () => connected,
    stamp: rtdb.serverTimestamp,
    onConnection(handler) {
      connectionHandlers.add(handler);
      handler(connected);
      return () => connectionHandlers.delete(handler);
    },
    watch(path, listener, onError) {
      return rtdb.onValue(rtdb.ref(db, path), snap => listener(snap.val()), onError);
    },
    async get(path) {
      return (await rtdb.get(rtdb.ref(db, path))).val();
    },
    set: (path, value) => rtdb.set(rtdb.ref(db, path), value)
  };
}

export const roomPath = code => 'races/' + code;

export function isDenied(error) {
  return /permission[-_\s]+denied/i.test(String(error?.code || error?.message));
}

export async function createRoom(api) {
  const code = createCode();
  await api.set(roomPath(code), {
    meta: { host: api.uid, createdAt: api.stamp(), status: 'lobby', round: 0, startsAt: 0, endsAt: 0 }
  });
  return code;
}

export async function joinRoom(api, code, name) {
  const path = roomPath(code);
  try {
    const room = await api.get(path);
    const seat = SEATS.find(key => room?.seats?.[key]?.member?.uid === api.uid);
    if (seat) return seat;
  } catch (error) {
    if (!isDenied(error)) throw error;
  }
  for (const seat of SEATS) {
    try {
      await api.set(path + '/seats/' + seat + '/member', { uid: api.uid, name });
      return seat;
    } catch (error) {
      if (!isDenied(error)) throw error;
    }
  }
  throw new Error('Lobby tidak tersedia. Periksa kode atau minta host mengecek slot dan membuka lobby.');
}
