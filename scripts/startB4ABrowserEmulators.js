import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  B4A_BROWSER_ENV_FILE_CONTENT,
  B4A_BROWSER_PROJECT_ID,
  B4A_BROWSER_SECRET_FILE_CONTENT,
  assertBrowserPreviewEnvironment,
  browserPreviewPaths,
} from './b4aBrowserPreviewConfig.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = browserPreviewPaths(projectRoot);
assertBrowserPreviewEnvironment(process.env);
if (fs.readFileSync(paths.secretOverride, 'utf8') !== B4A_BROWSER_SECRET_FILE_CONTENT
  || fs.readFileSync(paths.parameterOverride, 'utf8') !== B4A_BROWSER_ENV_FILE_CONTENT) {
  throw new Error('B4A_PREVIEW_LOCAL_OVERRIDES_NOT_PREPARED');
}

const firebaseCli = path.join(projectRoot, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
const child = spawn(process.execPath, [
  firebaseCli,
  'emulators:start',
  '--only',
  'auth,firestore,functions',
  '--project',
  B4A_BROWSER_PROJECT_ID,
  '--config',
  path.join(projectRoot, 'firebase.json'),
], {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
});

const expectedPorts = [4400, 5001, 8080, 9099];
function listeningProcessIds() {
  if (process.platform !== 'win32') return {};
  const output = execFileSync('netstat.exe', ['-ano'], { encoding: 'utf8' });
  const result = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
    if (!match) continue;
    const port = Number(match[1]);
    if (expectedPorts.includes(port)) result[port] = Number(match[2]);
  }
  return result;
}

function persistProcessState() {
  const processIdsByPort = listeningProcessIds();
  if (!Object.keys(processIdsByPort).length) return;
  fs.mkdirSync(path.dirname(paths.processState), { recursive: true });
  fs.writeFileSync(paths.processState, `${JSON.stringify({
    schemaVersion: 1,
    projectId: B4A_BROWSER_PROJECT_ID,
    launcherPid: child.pid,
    processIdsByPort,
  }, null, 2)}\n`);
}

const stateTimer = setInterval(persistProcessState, 500);
let interrupted = false;
process.on('SIGINT', () => {
  interrupted = true;
  console.log('Waiting for Firebase Emulator children to shut down cleanly...');
});
const status = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code) => resolve(code));
});
clearInterval(stateTimer);
const remaining = listeningProcessIds();
if (!Object.keys(remaining).length) fs.rmSync(paths.processState, { force: true });
process.exitCode = interrupted && status === null ? 130 : (status ?? 1);
