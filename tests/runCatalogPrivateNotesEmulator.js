// Local-only harness: no Firebase CLI, login, credentials, imports or exports.
// FIRESTORE_EMULATOR_JAR must point to a preinstalled Firestore emulator JAR.
// CATALOG_PRIVATE_NOTES_MODULE must point to the Catalog src/utils/privateNotes.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
for (const name of ['firebase', '@firebase/rules-unit-testing']) {
  const packagePath = require.resolve(`${name}/package.json`);
  const version = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
  if (version !== lock.packages[`node_modules/${name}`].version) {
    throw new Error(`Install the worktree lockfile dependencies before testing: ${name}`);
  }
  console.log(`DEPENDENCY ${name}=${version} path=${packagePath}`);
}
const jar = process.env.FIRESTORE_EMULATOR_JAR;
const catalogModule = process.env.CATALOG_PRIVATE_NOTES_MODULE;
if (!jar || !fs.existsSync(jar) || !catalogModule || !fs.existsSync(catalogModule)) {
  throw new Error('Existing emulator JAR and Catalog private-notes module paths are required');
}
const rulesPath = path.join(root, 'firestore.rules');
const rules = fs.readFileSync(rulesPath, 'utf8');
const uid = rules.match(/request\.auth\.uid\s+in\s+\[\s*'([^']+)'/)?.[1];
if (!uid) throw new Error('No Rules admin allowlist found');
const reserve = net.createServer();
await new Promise((resolve, reject) => { reserve.once('error', reject); reserve.listen(0, '127.0.0.1', resolve); });
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-private-notes-emulator-'));
const log = fs.createWriteStream(path.join(scratch, 'emulator.log'));
const childEnv = { ...process.env };
for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_CONFIG']) delete childEnv[key];
const emulator = spawn('java', ['-jar', jar, '--host', '127.0.0.1', '--port', String(port),
  '--project_id', 'demo-kaijuzaocard-calendar', '--single_project_mode', '--single_project_mode_error', '--rules', rulesPath
], { cwd: scratch, env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
emulator.stdout.pipe(log, { end: false }); emulator.stderr.pipe(log, { end: false });
let startupError;
emulator.on('error', error => { startupError = error; });
let closed = false;
const exited = new Promise(resolve => emulator.once('close', () => { closed = true; resolve(); }));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (startupError) throw startupError;
    if (closed) throw new Error(`Emulator exited; inspect ${scratch}`);
    ready = await new Promise(resolve => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    if (ready) break;
    await delay(200);
  }
  if (!ready) throw new Error(`Emulator startup timeout; inspect ${scratch}`);
  console.log(`ISOLATION project=demo-kaijuzaocard-calendar host=127.0.0.1:${port} single-project-error=true`);
  console.log(`Rules=${rulesPath}\nEmulator log=${path.join(scratch, 'emulator.log')}`);
  const tests = spawn(process.execPath, ['--test', '--test-concurrency=1',
    path.join(root, 'tests/firestoreRules.test.js'), path.join(root, 'tests/catalogPrivateNotesRules.test.js')
  ], { cwd: root, windowsHide: true, stdio: 'inherit', env: { ...childEnv,
    FIRESTORE_EMULATOR_HOST: `127.0.0.1:${port}`, VITE_FIREBASE_ADMIN_UIDS: uid,
    CATALOG_PRIVATE_NOTES_MODULE: catalogModule
  } });
  process.exitCode = await new Promise((resolve, reject) => { tests.once('error', reject); tests.once('exit', code => resolve(code ?? 1)); });
} finally {
  if (!closed) emulator.kill();
  await exited;
  log.end();
}
