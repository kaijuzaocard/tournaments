import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = path.join(os.tmpdir(), 'kaijuzaocard-calendar-rules-emulator');
const firebaseCli = path.join(
  projectRoot,
  'node_modules',
  'firebase-tools',
  'lib',
  'bin',
  'firebase.js'
);
const testFile = path.join(projectRoot, 'tests', 'firestoreRules.test.js');
const localEnvFile = path.join(projectRoot, '.env.local');

if (!process.env.VITE_FIREBASE_ADMIN_UIDS && fs.existsSync(localEnvFile)) {
  const adminUidLine = fs.readFileSync(localEnvFile, 'utf8')
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith('VITE_FIREBASE_ADMIN_UIDS='));

  if (adminUidLine) {
    process.env.VITE_FIREBASE_ADMIN_UIDS = adminUidLine.split('=').slice(1).join('=').trim();
  }
}

if (!process.env.VITE_FIREBASE_ADMIN_UIDS) {
  const rulesSource = fs.readFileSync(path.join(projectRoot, 'firestore.rules'), 'utf8');
  const allowlistMatch = rulesSource.match(/request\.auth\.uid\s+in\s+\[\s*'([^']+)'/);
  if (allowlistMatch) process.env.VITE_FIREBASE_ADMIN_UIDS = allowlistMatch[1];
}

if (!process.env.VITE_FIREBASE_ADMIN_UIDS) {
  throw new Error('VITE_FIREBASE_ADMIN_UIDS is required for Rules tests.');
}

fs.rmSync(tempRoot, { recursive: true, force: true });
fs.mkdirSync(tempRoot, { recursive: true });
fs.copyFileSync(
  path.join(projectRoot, 'firestore.rules'),
  path.join(tempRoot, 'firestore.rules')
);
fs.writeFileSync(
  path.join(tempRoot, 'firebase.json'),
  JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: {
      firestore: { host: '127.0.0.1', port: 8080 },
      ui: { enabled: false },
      singleProjectMode: true
    }
  }, null, 2)
);

const testCommand = `node --test "${testFile}"`;
const result = spawnSync(
  process.execPath,
  [
    firebaseCli,
    'emulators:exec',
    '--only',
    'firestore',
    '--project',
    'demo-kaijuzaocard-calendar',
    '--config',
    path.join(tempRoot, 'firebase.json'),
    testCommand
  ],
  {
    cwd: tempRoot,
    env: process.env,
    stdio: 'inherit'
  }
);

process.exit(result.status ?? 1);
