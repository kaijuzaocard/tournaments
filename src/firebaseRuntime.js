import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import {
  connectFirebaseEmulatorServices,
  createFirebaseRuntimeConfig,
  createPublicRuntimeEvidence,
} from './firebaseRuntimeConfig.js';

const RUNTIME_SINGLETON = Symbol.for('kaijuzaocard.firebaseRuntime.singleton');

function buildRuntime() {
  const runtimeConfig = createFirebaseRuntimeConfig({
    env: import.meta.env,
    buildMode: import.meta.env.MODE,
    browserOrigin: globalThis.location?.origin,
    injectedFirebaseConfig: globalThis.__firebase_config,
  });
  const existingApp = getApps().length ? getApp() : null;
  if (existingApp && existingApp.options.projectId !== runtimeConfig.projectId) {
    throw new Error('FIREBASE_APP_PROJECT_MISMATCH');
  }

  const app = existingApp || initializeApp(runtimeConfig.firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, runtimeConfig.functionsRegion);
  const connected = connectFirebaseEmulatorServices({
    runtimeConfig,
    auth,
    db,
    functions,
    connectAuth: connectAuthEmulator,
    connectFirestore: connectFirestoreEmulator,
    connectFunctions: connectFunctionsEmulator,
  });

  return Object.freeze({
    app,
    auth,
    db,
    functions,
    isFirebaseEmulatorRuntime: runtimeConfig.mode === 'emulator',
    firebaseRuntimeInfo: createPublicRuntimeEvidence(runtimeConfig, connected),
  });
}

const existingRuntime = globalThis[RUNTIME_SINGLETON];
const runtime = existingRuntime || buildRuntime();
if (!existingRuntime) globalThis[RUNTIME_SINGLETON] = runtime;

if (runtime.isFirebaseEmulatorRuntime) {
  globalThis.__KJZC_FIREBASE_RUNTIME__ = runtime.firebaseRuntimeInfo;
} else if (Object.hasOwn(globalThis, '__KJZC_FIREBASE_RUNTIME__')) {
  delete globalThis.__KJZC_FIREBASE_RUNTIME__;
}

export const {
  app,
  auth,
  db,
  functions,
  firebaseRuntimeInfo,
  isFirebaseEmulatorRuntime,
} = runtime;
