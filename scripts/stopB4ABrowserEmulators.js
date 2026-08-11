import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  B4A_BROWSER_PROJECT_ID,
  assertBrowserPreviewEnvironment,
  browserPreviewPaths,
} from './b4aBrowserPreviewConfig.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = browserPreviewPaths(projectRoot);
const expectedPorts = [4400, 5001, 8080, 9099];
assertBrowserPreviewEnvironment(process.env);

function listeningProcessIds() {
  if (process.platform !== 'win32') throw new Error('B4A_PREVIEW_STOP_REQUIRES_WINDOWS');
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

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const current = listeningProcessIds();
if (!fs.existsSync(paths.processState)) {
  if (!Object.keys(current).length) {
    console.log('B4A Browser Preview emulators are already stopped.');
    process.exit(0);
  }
  throw new Error('Refusing to stop listeners without B4A preview process state.');
}

const state = JSON.parse(fs.readFileSync(paths.processState, 'utf8'));
if (state.schemaVersion !== 1 || state.projectId !== B4A_BROWSER_PROJECT_ID
  || !Number.isSafeInteger(state.launcherPid) || !state.processIdsByPort) {
  throw new Error('B4A_PREVIEW_PROCESS_STATE_INVALID');
}

try {
  process.kill(state.launcherPid, 'SIGINT');
} catch (error) {
  if (error?.code !== 'ESRCH') throw error;
}
await wait(2500);

const afterGracefulStop = listeningProcessIds();
const recordedPids = new Set(Object.values(state.processIdsByPort).filter(Number.isSafeInteger));
for (const [port, pid] of Object.entries(afterGracefulStop)) {
  if (!recordedPids.has(pid) || state.processIdsByPort[port] !== pid) {
    throw new Error(`Refusing to stop unrecorded listener on port ${port}.`);
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}
await wait(750);
const remaining = listeningProcessIds();
if (Object.keys(remaining).length) throw new Error('B4A_PREVIEW_LISTENER_CLEANUP_FAILED');
fs.rmSync(paths.processState, { force: true });
console.log('B4A Browser Preview emulator listeners stopped.');
