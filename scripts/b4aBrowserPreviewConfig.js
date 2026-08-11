import path from 'node:path';

export const B4A_BROWSER_PROJECT_ID = 'demo-kaijuzaocard-calendar-browser';
export const B4A_BROWSER_ADMIN_UID = 'z1JOoARRRsSFavRlGbnhZmM4NMQ2';
export const B4A_BROWSER_FRONTEND_ORIGIN = 'http://127.0.0.1:4174';
export const B4A_BROWSER_MANIFEST_RELATIVE_PATH = 'artifacts/b4a-p1/browser-preview-manifest.json';
export const B4A_BROWSER_SECRET = 'emulator-only-b4a-browser-secret-0123456789';
export const B4A_BROWSER_HANDOFF_SECRET = `${B4A_BROWSER_SECRET}-handoff`;

export const B4A_BROWSER_SECRET_FILE_CONTENT = [
  `CALENDAR_REGISTRATION_HMAC_KEY=${B4A_BROWSER_SECRET}`,
  `CALENDAR_SWISS_HANDOFF_HMAC_KEY=${B4A_BROWSER_HANDOFF_SECRET}`,
  '',
].join('\n');

export const B4A_BROWSER_ENV_FILE_CONTENT = [
  `CALENDAR_ADMIN_UIDS=${B4A_BROWSER_ADMIN_UID}`,
  `CALENDAR_SWISS_HANDOFF_ALLOWED_ORIGINS=${B4A_BROWSER_FRONTEND_ORIGIN}`,
  '',
].join('\n');

export function browserPreviewEnvironment(base = {}) {
  return {
    ...base,
    GCLOUD_PROJECT: B4A_BROWSER_PROJECT_ID,
    FIREBASE_CONFIG: JSON.stringify({ projectId: B4A_BROWSER_PROJECT_ID }),
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001',
    METADATA_SERVER_DETECTION: 'none',
  };
}

export function assertBrowserPreviewEnvironment(env = {}) {
  if (env.GCLOUD_PROJECT !== B4A_BROWSER_PROJECT_ID || !String(env.GCLOUD_PROJECT).startsWith('demo-')) {
    throw new Error('B4A_PREVIEW_DEMO_PROJECT_REQUIRED');
  }
  const expected = {
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001',
  };
  for (const [name, value] of Object.entries(expected)) {
    if (env[name] !== value) throw new Error(`B4A_PREVIEW_${name}_INVALID`);
  }
  let firebaseConfig;
  try {
    firebaseConfig = JSON.parse(env.FIREBASE_CONFIG || '');
  } catch {
    throw new Error('B4A_PREVIEW_FIREBASE_CONFIG_INVALID');
  }
  if (firebaseConfig.projectId !== B4A_BROWSER_PROJECT_ID) {
    throw new Error('B4A_PREVIEW_PROJECT_ID_MISMATCH');
  }
  return true;
}

export function browserPreviewPaths(projectRoot) {
  return Object.freeze({
    projectRoot,
    secretOverride: path.join(projectRoot, 'functions', '.secret.local'),
    parameterOverride: path.join(projectRoot, 'functions', '.env.local'),
    manifest: path.join(projectRoot, ...B4A_BROWSER_MANIFEST_RELATIVE_PATH.split('/')),
    processState: path.join(projectRoot, 'artifacts', 'b4a-p1', 'browser-preview-processes.json'),
  });
}
