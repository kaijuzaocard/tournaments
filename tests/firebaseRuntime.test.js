import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FUNCTIONS_REGION,
  PRODUCTION_FIREBASE_CONFIG,
  connectFirebaseEmulatorServices,
  createFirebaseRuntimeConfig,
  createPublicRuntimeEvidence,
  isLoopbackHost,
  isLoopbackUrl,
} from '../src/firebaseRuntimeConfig.js';

const emulatorEnv = (overrides = {}) => ({
  VITE_FIREBASE_RUNTIME: 'emulator',
  VITE_FIREBASE_PROJECT_ID: 'demo-kaijuzaocard-calendar-browser',
  VITE_FIREBASE_CLI_PROJECT_ID: 'demo-kaijuzaocard-calendar-browser',
  VITE_FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1',
  VITE_FIREBASE_AUTH_EMULATOR_PORT: '9099',
  VITE_FIREBASE_FIRESTORE_EMULATOR_HOST: '127.0.0.1',
  VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: '8080',
  VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST: '127.0.0.1',
  VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: '5001',
  ...overrides,
});

test('production is the default runtime and preserves the existing Firebase project', () => {
  const runtime = createFirebaseRuntimeConfig({ env: {} });
  assert.equal(runtime.mode, 'production');
  assert.equal(runtime.firebaseConfig, PRODUCTION_FIREBASE_CONFIG);
  assert.equal(runtime.projectId, 'kaijuzaocard-tournaments');
});

test('explicit production runtime remains supported', () => {
  assert.equal(createFirebaseRuntimeConfig({ env: { VITE_FIREBASE_RUNTIME: 'production' } }).mode, 'production');
});

test('production injected Firebase config behavior is preserved', () => {
  const injected = { projectId: 'injected-project', apiKey: 'injected-key' };
  const runtime = createFirebaseRuntimeConfig({ env: {}, injectedFirebaseConfig: JSON.stringify(injected) });
  assert.deepEqual(runtime.firebaseConfig, injected);
});

test('Functions region remains asia-east1 in both runtimes', () => {
  const production = createFirebaseRuntimeConfig({ env: {}, buildMode: 'production' });
  const emulator = createFirebaseRuntimeConfig({ env: emulatorEnv(), buildMode: 'emulator', browserOrigin: 'http://127.0.0.1:4174' });
  assert.equal(FUNCTIONS_REGION, 'asia-east1');
  assert.equal(production.functionsRegion, 'asia-east1');
  assert.equal(emulator.functionsRegion, 'asia-east1');
});

test('explicit emulator runtime accepts one demo project and three loopback endpoints', () => {
  const runtime = createFirebaseRuntimeConfig({ env: emulatorEnv(), buildMode: 'emulator', browserOrigin: 'http://127.0.0.1:4174' });
  assert.equal(runtime.mode, 'emulator');
  assert.equal(runtime.projectId, 'demo-kaijuzaocard-calendar-browser');
  assert.equal(runtime.cliProjectId, runtime.projectId);
  assert.deepEqual(Object.values(runtime.endpoints).map(({ host, port }) => [host, port]), [
    ['127.0.0.1', 9099], ['127.0.0.1', 8080], ['127.0.0.1', 5001],
  ]);
});

test('emulator runtime rejects a production Firebase project ID', () => {
  assert.throws(
    () => createFirebaseRuntimeConfig({ env: emulatorEnv({ VITE_FIREBASE_PROJECT_ID: 'kaijuzaocard-tournaments', VITE_FIREBASE_CLI_PROJECT_ID: 'kaijuzaocard-tournaments' }), buildMode: 'emulator', browserOrigin: 'http://127.0.0.1:4174' }),
    /EMULATOR_PROJECT_ID_NOT_DEMO/,
  );
});

test('emulator runtime rejects a non-loopback browser origin', () => {
  assert.throws(
    () => createFirebaseRuntimeConfig({ env: emulatorEnv(), buildMode: 'emulator', browserOrigin: 'https://preview.example.test' }),
    /BROWSER_ORIGIN_NOT_LOOPBACK/,
  );
});

for (const [service, envName] of [
  ['Auth', 'VITE_FIREBASE_AUTH_EMULATOR_HOST'],
  ['Firestore', 'VITE_FIREBASE_FIRESTORE_EMULATOR_HOST'],
  ['Functions', 'VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST'],
]) {
  test(`emulator runtime rejects a remote ${service} host`, () => {
    assert.throws(
      () => createFirebaseRuntimeConfig({ env: emulatorEnv({ [envName]: 'firebase.example.test' }), buildMode: 'emulator', browserOrigin: 'http://localhost:4174' }),
      /NOT_LOOPBACK/,
    );
  });
}

for (const envName of [
  'VITE_FIREBASE_AUTH_EMULATOR_HOST',
  'VITE_FIREBASE_FIRESTORE_EMULATOR_PORT',
  'VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST',
]) {
  test(`emulator runtime rejects missing endpoint field ${envName}`, () => {
    assert.throws(
      () => createFirebaseRuntimeConfig({ env: emulatorEnv({ [envName]: '' }), buildMode: 'emulator', browserOrigin: 'http://127.0.0.1:4174' }),
      /REQUIRED|INVALID/,
    );
  });
}

for (const port of ['0', '65536', 'not-a-port', '5001.5']) {
  test(`emulator runtime rejects invalid port ${port}`, () => {
    assert.throws(
      () => createFirebaseRuntimeConfig({ env: emulatorEnv({ VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: port }), buildMode: 'emulator', browserOrigin: 'http://127.0.0.1:4174' }),
      /FUNCTIONS_EMULATOR_PORT_INVALID/,
    );
  });
}

test('invalid runtime values fail closed', () => {
  assert.throws(
    () => createFirebaseRuntimeConfig({ env: { VITE_FIREBASE_RUNTIME: 'auto' } }),
    /FIREBASE_RUNTIME_INVALID/,
  );
});

test('emulator build mode rejects an explicit production runtime', () => {
  assert.throws(
    () => createFirebaseRuntimeConfig({ env: { VITE_FIREBASE_RUNTIME: 'production' }, buildMode: 'emulator' }),
    /EMULATOR_BUILD_RUNTIME_MISMATCH/,
  );
});

test('emulator build mode rejects a missing runtime', () => {
  assert.throws(
    () => createFirebaseRuntimeConfig({ env: {}, buildMode: 'emulator' }),
    /EMULATOR_BUILD_RUNTIME_MISMATCH/,
  );
});

test('emulator build mode with the canonical runtime creates an emulator config', () => {
  const runtime = createFirebaseRuntimeConfig({
    env: emulatorEnv(),
    buildMode: 'emulator',
    browserOrigin: 'http://127.0.0.1:4174',
  });
  assert.equal(runtime.mode, 'emulator');
  assert.equal(runtime.projectId, 'demo-kaijuzaocard-calendar-browser');
});

for (const buildMode of ['production', 'development']) {
  test(`emulator runtime rejects ${buildMode} build mode`, () => {
    assert.throws(
      () => createFirebaseRuntimeConfig({ env: emulatorEnv(), buildMode, browserOrigin: 'http://127.0.0.1:4174' }),
      /EMULATOR_RUNTIME_BUILD_MODE_MISMATCH/,
    );
  });
}

test('normal production build mode preserves the existing production config', () => {
  const runtime = createFirebaseRuntimeConfig({ env: {}, buildMode: 'production' });
  assert.equal(runtime.mode, 'production');
  assert.equal(runtime.firebaseConfig, PRODUCTION_FIREBASE_CONFIG);
});

test('emulator app and CLI project IDs must match', () => {
  assert.throws(
    () => createFirebaseRuntimeConfig({ env: emulatorEnv({ VITE_FIREBASE_CLI_PROJECT_ID: 'demo-other' }), buildMode: 'emulator', browserOrigin: 'http://127.0.0.1:4174' }),
    /EMULATOR_PROJECT_ID_MISMATCH/,
  );
});

test('loopback helpers accept only local hosts and URLs', () => {
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackUrl('http://localhost:4175/path'), true);
  assert.equal(isLoopbackUrl('https://swiss.example.test'), false);
});

test('public runtime evidence contains only the safe allowlist', () => {
  const runtime = createFirebaseRuntimeConfig({ env: emulatorEnv(), buildMode: 'emulator', browserOrigin: 'http://127.0.0.1:4174' });
  const evidence = createPublicRuntimeEvidence(runtime, true);
  assert.deepEqual(Object.keys(evidence).sort(), ['authEndpoint', 'connected', 'firestoreEndpoint', 'functionsEndpoint', 'mode', 'projectId']);
  assert.equal(JSON.stringify(evidence).includes('apiKey'), false);
  assert.equal(JSON.stringify(evidence).includes('secret'), false);
});

test('all three emulator connectors run in Auth, Firestore, Functions order', () => {
  const runtimeConfig = createFirebaseRuntimeConfig({ env: emulatorEnv(), buildMode: 'emulator', browserOrigin: 'http://127.0.0.1:4174' });
  const calls = [];
  const connected = connectFirebaseEmulatorServices({
    runtimeConfig,
    auth: 'auth', db: 'db', functions: 'functions',
    connectAuth: (...args) => calls.push(['auth', ...args]),
    connectFirestore: (...args) => calls.push(['firestore', ...args]),
    connectFunctions: (...args) => calls.push(['functions', ...args]),
  });
  assert.equal(connected, true);
  assert.deepEqual(calls.map(([name]) => name), ['auth', 'firestore', 'functions']);
});

test('connector failure is thrown and never falls back to production', () => {
  const runtimeConfig = createFirebaseRuntimeConfig({ env: emulatorEnv(), buildMode: 'emulator', browserOrigin: 'http://127.0.0.1:4174' });
  let laterConnectorCalled = false;
  assert.throws(() => connectFirebaseEmulatorServices({
    runtimeConfig,
    auth: {}, db: {}, functions: {},
    connectAuth: () => { throw new Error('AUTH_CONNECT_FAILED'); },
    connectFirestore: () => { laterConnectorCalled = true; },
    connectFunctions: () => { laterConnectorCalled = true; },
  }), /AUTH_CONNECT_FAILED/);
  assert.equal(laterConnectorCalled, false);
});

test('production mode never invokes emulator connectors', () => {
  const runtimeConfig = createFirebaseRuntimeConfig({ env: {} });
  let called = false;
  const connected = connectFirebaseEmulatorServices({
    runtimeConfig,
    connectAuth: () => { called = true; },
    connectFirestore: () => { called = true; },
    connectFunctions: () => { called = true; },
  });
  assert.equal(connected, false);
  assert.equal(called, false);
});

test('App delegates Firebase initialization and production isolation to the runtime module', () => {
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const runtime = fs.readFileSync(new URL('../src/firebaseRuntime.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /initializeApp|getAuth\(|getFirestore\(|getFunctions\(/);
  assert.match(runtime, /Symbol\.for\('kaijuzaocard\.firebaseRuntime\.singleton'\)/);
  assert.match(runtime, /connectAuthEmulator/);
  assert.match(runtime, /connectFirestoreEmulator/);
  assert.match(runtime, /connectFunctionsEmulator/);
});

test('production render has no emulator-only admin bootstrap or automatic hostname switch', () => {
  const sources = [
    fs.readFileSync(new URL('../src/firebaseRuntimeConfig.js', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(sources, /location\.hostname\s*===/);
  assert.doesNotMatch(sources, /signInWithCustomToken\([^)]*emulator/i);
  assert.match(sources, /EMULATOR_EXTERNAL_NOTIFICATION_DISABLED/);
});

test('the emulator banner renders only when the explicit emulator runtime is active', () => {
  const banner = fs.readFileSync(new URL('../src/components/FirebaseEmulatorBanner.jsx', import.meta.url), 'utf8');
  assert.match(banner, /if \(!isFirebaseEmulatorRuntime\) return null/);
  assert.match(banner, /LOCAL FIREBASE EMULATOR PREVIEW/);
  assert.match(banner, /data-runtime-evidence=\{JSON\.stringify\(firebaseRuntimeInfo\)\}/);
});

test('fixed 375x812 visual harness is emulator-only and never changes admin authority', () => {
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /isFirebaseEmulatorRuntime\s*&& new URLSearchParams/);
  assert.match(app, /data-b4a-mobile-viewport/);
  assert.doesNotMatch(app, /b4aViewport.*isAdmin|isAdmin.*b4aViewport/);
});

test('preview bootstrap failure renders a fatal stop instead of an interactive App', () => {
  const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(main, /LOCAL FIREBASE EMULATOR PREVIEW FAILED/);
  assert.match(main, /replaceChildren\(\)/);
  assert.doesNotMatch(main, /fallback.*production/i);
});
