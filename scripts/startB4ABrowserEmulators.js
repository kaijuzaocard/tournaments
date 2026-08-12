import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  B4A_BROWSER_FUNCTIONS_REQUIRED,
  B4A_BROWSER_FUNCTIONS_STARTUP_TIMEOUT_MS,
  B4A_BROWSER_EXPECTED_PORTS,
  createB4ABrowserFunctionsReadiness,
  findB4ABrowserFunctionsFatalMarker,
  listeningB4ABrowserProcessIds,
  waitForB4ABrowserFunctionsProbes,
  writeB4ABrowserFunctionsReadiness,
} from './b4aBrowserFunctionsReadiness.js';
import {
  B4A_BROWSER_ENV_FILE_CONTENT,
  B4A_BROWSER_PROJECT_ID,
  B4A_BROWSER_SECRET_FILE_CONTENT,
  assertBrowserPreviewEnvironment,
  browserPreviewPaths,
} from './b4aBrowserPreviewConfig.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = browserPreviewPaths(projectRoot);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function writeProcessState(state) {
  fs.mkdirSync(path.dirname(paths.processState), { recursive: true });
  fs.writeFileSync(paths.processState, `${JSON.stringify(state, null, 2)}\n`);
}

async function stopOwnedProcesses(child, processIdsByPort) {
  try {
    child.kill('SIGINT');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  await wait(3_000);
  const current = listeningB4ABrowserProcessIds();
  const recordedPids = new Set(Object.values(processIdsByPort));
  for (const [port, pid] of Object.entries(current)) {
    if (!recordedPids.has(pid) || processIdsByPort[port] !== pid) {
      throw new Error(`Refusing to stop unrecorded listener on port ${port}.`);
    }
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  await wait(750);
  if (Object.keys(listeningB4ABrowserProcessIds()).length) {
    throw new Error('B4A_PREVIEW_LISTENER_CLEANUP_FAILED');
  }
}

async function main() {
  assertBrowserPreviewEnvironment(process.env);
  if (fs.readFileSync(paths.secretOverride, 'utf8') !== B4A_BROWSER_SECRET_FILE_CONTENT
    || fs.readFileSync(paths.parameterOverride, 'utf8') !== B4A_BROWSER_ENV_FILE_CONTENT) {
    throw new Error('B4A_PREVIEW_LOCAL_OVERRIDES_NOT_PREPARED');
  }
  if (Object.keys(listeningB4ABrowserProcessIds()).length) {
    throw new Error('B4A_PREVIEW_FIXED_PORT_ALREADY_LISTENING');
  }
  fs.rmSync(paths.functionsReadiness, { force: true });
  if (fs.existsSync(paths.functionsLog)) {
    throw new Error('B4A_PREVIEW_FUNCTIONS_LOG_EXISTS_RUN_EXPLICIT_CLEANUP');
  }
  fs.mkdirSync(path.dirname(paths.functionsLog), { recursive: true });
  const logStream = fs.createWriteStream(paths.functionsLog, { flags: 'wx' });
  const firebaseCli = path.join(projectRoot, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
  const startedAt = new Date();
  const startupStarted = Date.now();
  const deadlineAt = startupStarted + B4A_BROWSER_FUNCTIONS_STARTUP_TIMEOUT_MS;
  const sessionId = randomUUID();
  let logTail = '';
  let definitionsLoaded = false;
  let childExited = false;
  let childStatus = null;
  let interrupted = false;
  let processIdsByPort = {};

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
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  const state = () => ({
    schemaVersion: 2,
    projectId: B4A_BROWSER_PROJECT_ID,
    sessionId,
    launcherPid: child.pid,
    startedAt: startedAt.toISOString(),
    processIdsByPort,
  });
  const consumeLog = (stream, chunk) => {
    stream.write(chunk);
    logStream.write(chunk);
    logTail = `${logTail}${chunk}`.slice(-200_000);
    if (logTail.includes('Loaded functions definitions from source:')
      && B4A_BROWSER_FUNCTIONS_REQUIRED.every((name) => logTail.includes(name))) {
      definitionsLoaded = true;
    }
  };
  child.stdout.on('data', (chunk) => consumeLog(process.stdout, chunk));
  child.stderr.on('data', (chunk) => consumeLog(process.stderr, chunk));
  child.once('exit', (code) => {
    childExited = true;
    childStatus = code;
  });
  const childExit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code));
  });
  const persist = () => {
    processIdsByPort = listeningB4ABrowserProcessIds();
    if (Object.keys(processIdsByPort).length) writeProcessState(state());
  };
  const stateTimer = setInterval(persist, 500);
  process.on('SIGINT', () => {
    interrupted = true;
    console.log('Waiting for Firebase Emulator children to shut down cleanly...');
  });

  try {
    while (Date.now() < deadlineAt) {
      const fatal = findB4ABrowserFunctionsFatalMarker(logTail);
      if (fatal) throw new Error(`B4A_FUNCTIONS_DISCOVERY_FATAL:${fatal}`);
      if (childExited) throw new Error(`B4A_FUNCTIONS_EMULATOR_EXITED_BEFORE_READY:${childStatus}`);
      persist();
      const portsReady = B4A_BROWSER_EXPECTED_PORTS.every((port) => Number.isSafeInteger(processIdsByPort[port]));
      if (definitionsLoaded && portsReady) break;
      await wait(250);
    }
    if (Date.now() >= deadlineAt) throw new Error('B4A_FUNCTIONS_STARTUP_DEADLINE_EXCEEDED');
    const probe = await waitForB4ABrowserFunctionsProbes({
      deadlineAt,
      fatalMarker: () => findB4ABrowserFunctionsFatalMarker(logTail),
    });
    persist();
    writeB4ABrowserFunctionsReadiness(paths.functionsReadiness, createB4ABrowserFunctionsReadiness({
      launcherPid: child.pid,
      sessionId,
    }));
    const startupElapsed = Date.now() - startupStarted;
    const readyMessage = `B4A Browser Functions READY (startup ${startupElapsed} ms; probe ${probe.elapsedMs} ms)`;
    console.log(readyMessage);
    logStream.write(`${readyMessage}\n`);
  } catch (error) {
    fs.rmSync(paths.functionsReadiness, { force: true });
    clearInterval(stateTimer);
    persist();
    await stopOwnedProcesses(child, processIdsByPort);
    fs.rmSync(paths.processState, { force: true });
    logStream.end();
    throw error;
  }

  const status = await childExit;
  clearInterval(stateTimer);
  fs.rmSync(paths.functionsReadiness, { force: true });
  const remaining = listeningB4ABrowserProcessIds();
  if (!Object.keys(remaining).length) fs.rmSync(paths.processState, { force: true });
  logStream.end();
  process.exitCode = interrupted && status === null ? 130 : (status ?? 1);
}

await main();
