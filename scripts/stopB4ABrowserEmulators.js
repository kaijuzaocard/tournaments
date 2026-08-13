import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  B4A_BROWSER_FUNCTIONS_PROJECT_ID,
  listeningB4ABrowserProcessIds,
  readB4ABrowserProcessState,
} from './b4aBrowserFunctionsReadiness.js';
import {
  assertBrowserPreviewEnvironment,
  browserPreviewPaths,
} from './b4aBrowserPreviewConfig.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = browserPreviewPaths(projectRoot);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
assertBrowserPreviewEnvironment(process.env);

const current = listeningB4ABrowserProcessIds();
if (!fs.existsSync(paths.processState)) {
  if (!Object.keys(current).length) {
    fs.rmSync(paths.functionsReadiness, { force: true });
    if (fs.existsSync(paths.functionsLog)
      && fs.readFileSync(paths.functionsLog, 'utf8').includes('B4A Browser Functions READY')) {
      fs.rmSync(paths.functionsLog, { force: true });
    }
    console.log('B4A Browser Preview emulators are already stopped.');
    process.exit(0);
  }
  throw new Error('Refusing to stop listeners without B4A preview process state.');
}

const state = readB4ABrowserProcessState(paths.processState, { requireAllPorts: false });
if (state.projectId !== B4A_BROWSER_FUNCTIONS_PROJECT_ID) {
  throw new Error('B4A_PREVIEW_PROCESS_STATE_INVALID');
}
for (const [port, pid] of Object.entries(current)) {
  if (state.processIdsByPort[port] !== pid) {
    throw new Error(`Refusing to stop unrecorded listener on port ${port}.`);
  }
}

try {
  process.kill(state.launcherPid, 'SIGINT');
} catch (error) {
  if (error?.code !== 'ESRCH') throw error;
}
await wait(2_500);

const afterGracefulStop = listeningB4ABrowserProcessIds();
const recordedPids = new Set(Object.values(state.processIdsByPort));
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
if (Object.keys(listeningB4ABrowserProcessIds()).length) throw new Error('B4A_PREVIEW_LISTENER_CLEANUP_FAILED');
const successfulLog = fs.existsSync(paths.functionsLog)
  && fs.readFileSync(paths.functionsLog, 'utf8').includes('B4A Browser Functions READY');
fs.rmSync(paths.functionsReadiness, { force: true });
fs.rmSync(paths.processState, { force: true });
if (successfulLog) fs.rmSync(paths.functionsLog, { force: true });
console.log('B4A Browser Preview emulator listeners stopped.');
