import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const firebaseCli = path.join(projectRoot, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
const testFile = path.join(projectRoot, 'functions', 'test', 'emulator.test.js');
const config = path.join(projectRoot, 'firebase.json');
const secretOverride = path.join(projectRoot, 'functions', '.secret.local');
const parameterOverride = path.join(projectRoot, 'functions', '.env.local');
const emulatorSecret = 'emulator-only-secret-with-at-least-thirty-two-bytes';

if (fs.existsSync(secretOverride) || fs.existsSync(parameterOverride)) {
  throw new Error('Refusing to overwrite an existing Functions emulator override file.');
}

let status = 1;
try {
  fs.writeFileSync(secretOverride, `CALENDAR_REGISTRATION_HMAC_KEY=${emulatorSecret}\nCALENDAR_SWISS_HANDOFF_HMAC_KEY=${emulatorSecret}-handoff\n`, { flag: 'wx' });
  fs.writeFileSync(parameterOverride, 'CALENDAR_ADMIN_UIDS=emulator-calendar-admin\nCALENDAR_SWISS_HANDOFF_ALLOWED_ORIGINS=http://127.0.0.1:4173\n', { flag: 'wx' });
  const result = spawnSync(process.execPath, [
    firebaseCli,
    'emulators:exec',
    '--only',
    'firestore,functions',
    '--project',
    'demo-kaijuzaocard-calendar-functions',
    '--config',
    config,
    `node --test "${testFile}"`,
  ], {
    cwd: os.tmpdir(),
    env: {
      ...process.env,
      GCLOUD_PROJECT: 'demo-kaijuzaocard-calendar-functions',
    },
    stdio: 'inherit',
  });
  status = result.status ?? 1;
} finally {
  fs.rmSync(secretOverride, { force: true });
  fs.rmSync(parameterOverride, { force: true });
}

process.exit(status);
