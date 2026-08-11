export const FUNCTIONS_REGION = 'asia-east1';

export const PRODUCTION_FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyCaPWSmVV_R3zeGVeYj_g_AFu_JE-sGlpI',
  authDomain: 'kaijuzaocard-tournaments.firebaseapp.com',
  projectId: 'kaijuzaocard-tournaments',
  storageBucket: 'kaijuzaocard-tournaments.firebasestorage.app',
  messagingSenderId: '950741417800',
  appId: '1:950741417800:web:b8403334ab8be1641d7d7d',
  measurementId: 'G-3MY4BQGBVM',
});

export class FirebaseRuntimeConfigError extends Error {
  constructor(code) {
    super(code);
    this.name = 'FirebaseRuntimeConfigError';
    this.code = code;
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function requiredString(value, code) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new FirebaseRuntimeConfigError(code);
  return normalized;
}

function parsePort(value, code) {
  const normalized = requiredString(value, code);
  if (!/^[0-9]{1,5}$/.test(normalized)) throw new FirebaseRuntimeConfigError(code);
  const port = Number(normalized);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new FirebaseRuntimeConfigError(code);
  }
  return port;
}

export function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(String(host || '').toLowerCase());
}

export function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

function parseEndpoint(env, prefix) {
  const host = requiredString(env[`VITE_FIREBASE_${prefix}_EMULATOR_HOST`], `${prefix}_EMULATOR_HOST_REQUIRED`);
  if (!isLoopbackHost(host)) throw new FirebaseRuntimeConfigError(`${prefix}_EMULATOR_HOST_NOT_LOOPBACK`);
  const port = parsePort(env[`VITE_FIREBASE_${prefix}_EMULATOR_PORT`], `${prefix}_EMULATOR_PORT_INVALID`);
  const urlHost = host === '::1' ? '[::1]' : host;
  return Object.freeze({
    host,
    port,
    endpoint: `http://${urlHost}:${port}`,
  });
}

function parseInjectedFirebaseConfig(injectedFirebaseConfig) {
  if (!injectedFirebaseConfig) return PRODUCTION_FIREBASE_CONFIG;
  const parsed = typeof injectedFirebaseConfig === 'string'
    ? JSON.parse(injectedFirebaseConfig)
    : injectedFirebaseConfig;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new FirebaseRuntimeConfigError('PRODUCTION_FIREBASE_CONFIG_INVALID');
  }
  return parsed;
}

function browserOriginHostname(origin) {
  try {
    return new URL(origin).hostname;
  } catch {
    throw new FirebaseRuntimeConfigError('BROWSER_ORIGIN_INVALID');
  }
}

function createEmulatorFirebaseConfig(projectId) {
  return Object.freeze({
    apiKey: 'demo-api-key',
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: `${projectId}.appspot.com`,
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:0000000000000000000000',
  });
}

export function createFirebaseRuntimeConfig({
  env = {},
  browserOrigin,
  injectedFirebaseConfig,
} = {}) {
  const runtimeValue = String(env.VITE_FIREBASE_RUNTIME || '').trim();
  if (runtimeValue && runtimeValue !== 'production' && runtimeValue !== 'emulator') {
    throw new FirebaseRuntimeConfigError('FIREBASE_RUNTIME_INVALID');
  }

  if (runtimeValue !== 'emulator') {
    const firebaseConfig = parseInjectedFirebaseConfig(injectedFirebaseConfig);
    return Object.freeze({
      mode: 'production',
      projectId: firebaseConfig.projectId,
      firebaseConfig,
      functionsRegion: FUNCTIONS_REGION,
      connected: false,
      endpoints: null,
    });
  }

  const projectId = requiredString(env.VITE_FIREBASE_PROJECT_ID, 'EMULATOR_PROJECT_ID_REQUIRED');
  if (!projectId.startsWith('demo-')) throw new FirebaseRuntimeConfigError('EMULATOR_PROJECT_ID_NOT_DEMO');
  const cliProjectId = requiredString(env.VITE_FIREBASE_CLI_PROJECT_ID, 'EMULATOR_CLI_PROJECT_ID_REQUIRED');
  if (cliProjectId !== projectId) throw new FirebaseRuntimeConfigError('EMULATOR_PROJECT_ID_MISMATCH');
  if (!isLoopbackHost(browserOriginHostname(browserOrigin))) {
    throw new FirebaseRuntimeConfigError('BROWSER_ORIGIN_NOT_LOOPBACK');
  }

  const auth = parseEndpoint(env, 'AUTH');
  const firestore = parseEndpoint(env, 'FIRESTORE');
  const functions = parseEndpoint(env, 'FUNCTIONS');
  const firebaseConfig = createEmulatorFirebaseConfig(projectId);

  return Object.freeze({
    mode: 'emulator',
    projectId,
    cliProjectId,
    firebaseConfig,
    functionsRegion: FUNCTIONS_REGION,
    connected: false,
    endpoints: Object.freeze({ auth, firestore, functions }),
  });
}

export function createPublicRuntimeEvidence(runtimeConfig, connected) {
  return Object.freeze({
    mode: runtimeConfig.mode,
    projectId: runtimeConfig.projectId,
    authEndpoint: runtimeConfig.endpoints?.auth.endpoint || null,
    firestoreEndpoint: runtimeConfig.endpoints?.firestore.endpoint || null,
    functionsEndpoint: runtimeConfig.endpoints?.functions.endpoint || null,
    connected: connected === true,
  });
}

export function connectFirebaseEmulatorServices({
  runtimeConfig,
  auth,
  db,
  functions,
  connectAuth,
  connectFirestore,
  connectFunctions,
}) {
  if (runtimeConfig.mode !== 'emulator') return false;
  const { endpoints } = runtimeConfig;
  connectAuth(auth, endpoints.auth.endpoint, { disableWarnings: true });
  connectFirestore(db, endpoints.firestore.host, endpoints.firestore.port);
  connectFunctions(functions, endpoints.functions.host, endpoints.functions.port);
  return true;
}
