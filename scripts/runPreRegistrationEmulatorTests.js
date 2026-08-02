import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const firebaseCli = path.join(projectRoot, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
const testFile = path.join(projectRoot, 'functions', 'test', 'emulator.test.js');
const config = path.join(projectRoot, 'firebase.json');
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
    CALENDAR_REGISTRATION_HMAC_KEY: 'emulator-only-secret-with-at-least-thirty-two-bytes',
  },
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
