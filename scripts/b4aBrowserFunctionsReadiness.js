import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const B4A_BROWSER_FUNCTIONS_PROJECT_ID = 'demo-kaijuzaocard-calendar-browser';
export const B4A_BROWSER_FUNCTIONS_REGION = 'asia-east1';
export const B4A_BROWSER_FUNCTIONS_ENDPOINT = 'http://127.0.0.1:5001';
export const B4A_BROWSER_FUNCTIONS_FRONTEND_ORIGIN = 'http://127.0.0.1:4174';
export const B4A_BROWSER_FUNCTIONS_DISCOVERY_TIMEOUT = '60';
export const B4A_BROWSER_FUNCTIONS_STARTUP_TIMEOUT_MS = 120_000;
export const B4A_BROWSER_FUNCTIONS_REQUEST_TIMEOUT_MS = 5_000;
export const B4A_BROWSER_FUNCTIONS_REQUIRED = Object.freeze([
  'submitTournamentPreRegistration',
  'manageTournamentPreRegistration',
  'adminManageTournamentPreRegistration',
  'createTournamentPreRegistrationHandoff',
  'manageTournamentPreRegistrationHandoff',
  'getTournamentPreRegistrationHandoffStatus',
]);
export const B4A_BROWSER_FUNCTIONS_FATAL_MARKERS = Object.freeze([
  'Failed to load function definition from source',
  'Cannot determine backend specification',
  'Timeout after',
  'Functions codebase could not be analyzed successfully',
  'Failed to parse function definition',
]);

const READINESS_KEYS = Object.freeze([
  'schemaVersion',
  'mode',
  'projectId',
  'region',
  'functionsEndpoint',
  'discoveryTimeoutSeconds',
  'requiredFunctions',
  'launcherPid',
  'sessionId',
  'verifiedAt',
]);
const PROCESS_STATE_KEYS = Object.freeze([
  'schemaVersion',
  'projectId',
  'sessionId',
  'launcherPid',
  'startedAt',
  'processIdsByPort',
]);
const EXPECTED_PORTS = Object.freeze([4400, 5001, 8080, 9099]);
const MAX_ATTESTATION_AGE_MS = 15 * 60 * 1000;
const PROBES = Object.freeze([
  { name: 'submitTournamentPreRegistration', method: 'POST', status: 400, errorStatus: 'FAILED_PRECONDITION', message: 'UNKNOWN_OR_MISSING_FIELDS' },
  { name: 'manageTournamentPreRegistration', method: 'POST', status: 400, errorStatus: 'FAILED_PRECONDITION', message: 'INVALID_ACTION' },
  { name: 'adminManageTournamentPreRegistration', method: 'POST', status: 403, errorStatus: 'PERMISSION_DENIED', message: 'CALENDAR_ADMIN_REQUIRED' },
  { name: 'createTournamentPreRegistrationHandoff', method: 'POST', status: 403, errorStatus: 'PERMISSION_DENIED', message: 'CALENDAR_ADMIN_REQUIRED' },
  { name: 'getTournamentPreRegistrationHandoffStatus', method: 'POST', status: 403, errorStatus: 'PERMISSION_DENIED', message: 'CALENDAR_ADMIN_REQUIRED' },
  { name: 'manageTournamentPreRegistrationHandoff', method: 'OPTIONS', status: 204 },
]);
const SNAPSHOT_COLLECTION_IDS = Object.freeze([
  'monster_tournaments',
  'tournamentPreRegistrations',
  'entries',
  'operations',
  'identities',
  'tournamentPreRegistrationRateLimits',
  'tournamentPreRegistrationHandoffs',
  'tournamentPreRegistrationHandoffRateLimits',
]);

export class B4ABrowserFunctionsReadinessError extends Error {
  constructor(code, { retriable = false, cause } = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = 'B4ABrowserFunctionsReadinessError';
    this.code = code;
    this.retriable = retriable;
  }
}

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value)) === JSON.stringify(expected);
}

function fixedFunctionsEndpoint(endpoint) {
  if (endpoint !== B4A_BROWSER_FUNCTIONS_ENDPOINT) {
    throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_REMOTE_ENDPOINT_REJECTED');
  }
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '5001') {
    throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_REMOTE_ENDPOINT_REJECTED');
  }
  return url.origin;
}

export function b4aBrowserFunctionUrl(functionName, endpoint = B4A_BROWSER_FUNCTIONS_ENDPOINT) {
  if (!B4A_BROWSER_FUNCTIONS_REQUIRED.includes(functionName)) {
    throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_NAME_INVALID');
  }
  return `${fixedFunctionsEndpoint(endpoint)}/${B4A_BROWSER_FUNCTIONS_PROJECT_ID}/${B4A_BROWSER_FUNCTIONS_REGION}/${functionName}`;
}

export function findB4ABrowserFunctionsFatalMarker(logText) {
  return B4A_BROWSER_FUNCTIONS_FATAL_MARKERS.find((marker) => String(logText || '').includes(marker)) || null;
}

export function listeningB4ABrowserProcessIds() {
  if (process.platform !== 'win32') {
    throw new B4ABrowserFunctionsReadinessError('B4A_PROCESS_LISTENER_CHECK_REQUIRES_WINDOWS');
  }
  const output = execFileSync('netstat.exe', ['-ano'], { encoding: 'utf8' });
  const result = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
    if (!match) continue;
    const port = Number(match[1]);
    if (EXPECTED_PORTS.includes(port)) result[port] = Number(match[2]);
  }
  return result;
}

function nestedErrorCode(error) {
  if (!error || typeof error !== 'object') return null;
  if (typeof error.code === 'string') return error.code;
  const direct = nestedErrorCode(error.cause);
  if (direct) return direct;
  if (Array.isArray(error.errors)) {
    for (const nested of error.errors) {
      const code = nestedErrorCode(nested);
      if (code) return code;
    }
  }
  return null;
}

function classifyFetchError(error) {
  const code = nestedErrorCode(error);
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || code === 'ETIMEDOUT') {
    return new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_PROBE_TIMEOUT', { cause: error });
  }
  if (['ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(code)) {
    return new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_ENDPOINT_NOT_READY', {
      cause: error,
      retriable: code === 'ECONNREFUSED',
    });
  }
  return new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_PROBE_NETWORK_FAILURE', { cause: error });
}

export function validateB4ABrowserProbeObservation(probe, observation) {
  if (!probe || !PROBES.some((candidate) => candidate.name === probe.name)) {
    throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_PROBE_INVALID');
  }
  if (observation.redirected || (observation.status >= 300 && observation.status < 400)) {
    throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_PROBE_REDIRECT_REJECTED');
  }
  if (observation.status === 404) {
    throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_ENDPOINT_NOT_FOUND');
  }
  if (observation.status >= 500) {
    throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_INTERNAL_RESPONSE_REJECTED');
  }
  if (observation.status !== probe.status) {
    throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_PROBE_STATUS_UNEXPECTED');
  }
  if (probe.method === 'OPTIONS') {
    if (observation.allowOrigin !== B4A_BROWSER_FUNCTIONS_FRONTEND_ORIGIN) {
      throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_CORS_ORIGIN_INVALID');
    }
    return true;
  }
  if (!observation.json || typeof observation.json !== 'object') {
    throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_PROBE_JSON_INVALID');
  }
  if (observation.json.error?.status !== probe.errorStatus
    || observation.json.error?.message !== probe.message) {
    throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_PROBE_CONTRACT_UNEXPECTED');
  }
  return true;
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, redirect: 'manual', signal: controller.signal });
  } catch (error) {
    throw classifyFetchError(error);
  } finally {
    clearTimeout(timer);
  }
}

async function observeProbe(fetchImpl, probe, timeoutMs) {
  const response = await fetchWithTimeout(fetchImpl, b4aBrowserFunctionUrl(probe.name), {
    method: probe.method,
    headers: probe.method === 'OPTIONS'
      ? { Origin: B4A_BROWSER_FUNCTIONS_FRONTEND_ORIGIN }
      : { 'Content-Type': 'application/json' },
    ...(probe.method === 'POST' ? { body: JSON.stringify({ data: {} }) } : {}),
  }, timeoutMs);
  const observation = {
    status: response.status,
    redirected: response.redirected,
    allowOrigin: response.headers.get('access-control-allow-origin'),
    json: null,
  };
  if (probe.method !== 'OPTIONS') {
    const text = await response.text();
    try {
      observation.json = JSON.parse(text);
    } catch (error) {
      throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_PROBE_JSON_INVALID', { cause: error });
    }
  }
  validateB4ABrowserProbeObservation(probe, observation);
  return Object.freeze({ name: probe.name, method: probe.method, status: response.status });
}

export async function runB4ABrowserFunctionsEndpointProbes({
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = B4A_BROWSER_FUNCTIONS_REQUEST_TIMEOUT_MS,
  fatalMarker = () => null,
} = {}) {
  fixedFunctionsEndpoint(B4A_BROWSER_FUNCTIONS_ENDPOINT);
  const startedAt = Date.now();
  const results = [];
  for (const probe of PROBES) {
    const marker = fatalMarker();
    if (marker) throw new B4ABrowserFunctionsReadinessError(`B4A_FUNCTIONS_DISCOVERY_FATAL:${marker}`);
    results.push(await observeProbe(fetchImpl, probe, requestTimeoutMs));
  }
  return Object.freeze({ elapsedMs: Date.now() - startedAt, results: Object.freeze(results) });
}

async function firestoreCollectionNames(fetchImpl, collectionId, timeoutMs) {
  const url = `http://127.0.0.1:8080/v1/projects/${B4A_BROWSER_FUNCTIONS_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const response = await fetchWithTimeout(fetchImpl, url, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId, allDescendants: true }] } }),
  }, timeoutMs);
  if (!response.ok) throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_STATE_SNAPSHOT_FAILED');
  let body;
  try {
    body = JSON.parse(await response.text());
  } catch (error) {
    throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_STATE_SNAPSHOT_JSON_INVALID', { cause: error });
  }
  if (!Array.isArray(body)) throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_STATE_SNAPSHOT_JSON_INVALID');
  return body.flatMap((item) => item.document?.name ? [item.document.name] : []).sort();
}

export async function captureB4ABrowserProbeState({
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = B4A_BROWSER_FUNCTIONS_REQUEST_TIMEOUT_MS,
} = {}) {
  const collections = {};
  for (const collectionId of SNAPSHOT_COLLECTION_IDS) {
    collections[collectionId] = await firestoreCollectionNames(fetchImpl, collectionId, requestTimeoutMs);
  }
  const authUrl = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${B4A_BROWSER_FUNCTIONS_PROJECT_ID}/accounts:batchGet?maxResults=1000`;
  const response = await fetchWithTimeout(fetchImpl, authUrl, {
    method: 'GET',
    headers: { Authorization: 'Bearer owner' },
  }, requestTimeoutMs);
  if (!response.ok) throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_AUTH_SNAPSHOT_FAILED');
  let authBody;
  try {
    authBody = JSON.parse(await response.text());
  } catch (error) {
    throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_AUTH_SNAPSHOT_JSON_INVALID', { cause: error });
  }
  return Object.freeze({
    collections: Object.freeze(collections),
    authUserIds: Object.freeze((authBody.users || []).map((user) => user.localId).sort()),
  });
}

export async function runB4ABrowserFunctionsZeroWriteCheck(options = {}) {
  const before = await captureB4ABrowserProbeState(options);
  const probes = await runB4ABrowserFunctionsEndpointProbes(options);
  const after = await captureB4ABrowserProbeState(options);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    const changed = Object.keys(before.collections)
      .filter((collectionId) => JSON.stringify(before.collections[collectionId]) !== JSON.stringify(after.collections[collectionId]))
      .map((collectionId) => `${collectionId}:${before.collections[collectionId].length}->${after.collections[collectionId].length}`);
    if (JSON.stringify(before.authUserIds) !== JSON.stringify(after.authUserIds)) {
      changed.push(`auth:${before.authUserIds.length}->${after.authUserIds.length}`);
    }
    throw new B4ABrowserFunctionsReadinessError(`B4A_FUNCTIONS_PROBE_MUTATED_STATE:${changed.join(',')}`);
  }
  return Object.freeze({ ...probes, stateUnchanged: true });
}

export async function waitForB4ABrowserFunctionsProbes({
  deadlineAt,
  retryDelayMs = 250,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ...options
} = {}) {
  while (Date.now() < deadlineAt) {
    try {
      return await runB4ABrowserFunctionsZeroWriteCheck(options);
    } catch (error) {
      if (!(error instanceof B4ABrowserFunctionsReadinessError) || !error.retriable) throw error;
      await sleep(retryDelayMs);
    }
  }
  throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_STARTUP_DEADLINE_EXCEEDED');
}

export function createB4ABrowserFunctionsReadiness({ launcherPid, sessionId, verifiedAt = new Date().toISOString() }) {
  return Object.freeze({
    schemaVersion: 1,
    mode: 'emulator',
    projectId: B4A_BROWSER_FUNCTIONS_PROJECT_ID,
    region: B4A_BROWSER_FUNCTIONS_REGION,
    functionsEndpoint: B4A_BROWSER_FUNCTIONS_ENDPOINT,
    discoveryTimeoutSeconds: Number(B4A_BROWSER_FUNCTIONS_DISCOVERY_TIMEOUT),
    requiredFunctions: [...B4A_BROWSER_FUNCTIONS_REQUIRED],
    launcherPid,
    sessionId,
    verifiedAt,
  });
}

export function validateB4ABrowserFunctionsReadiness(value, {
  expectedLauncherPid,
  expectedSessionId,
  startedAt,
  now = Date.now(),
} = {}) {
  if (!exactKeys(value, READINESS_KEYS)) throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_READINESS_SHAPE_INVALID');
  const expected = createB4ABrowserFunctionsReadiness({
    launcherPid: value.launcherPid,
    sessionId: value.sessionId,
    verifiedAt: value.verifiedAt,
  });
  for (const key of READINESS_KEYS.slice(0, 7)) {
    if (JSON.stringify(value[key]) !== JSON.stringify(expected[key])) {
      throw new B4ABrowserFunctionsReadinessError(`B4A_FUNCTIONS_READINESS_${key.toUpperCase()}_INVALID`);
    }
  }
  if (!Number.isSafeInteger(value.launcherPid) || value.launcherPid <= 0) {
    throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_READINESS_LAUNCHERPID_INVALID');
  }
  if (typeof value.sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.sessionId)) {
    throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_READINESS_SESSIONID_INVALID');
  }
  if (expectedLauncherPid !== undefined && value.launcherPid !== expectedLauncherPid) {
    throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_READINESS_PID_MISMATCH');
  }
  if (expectedSessionId !== undefined && value.sessionId !== expectedSessionId) {
    throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_READINESS_SESSION_MISMATCH');
  }
  const verifiedAtMillis = Date.parse(value.verifiedAt);
  const startedAtMillis = Date.parse(startedAt || '');
  if (!Number.isFinite(verifiedAtMillis)
    || (Number.isFinite(startedAtMillis) && verifiedAtMillis < startedAtMillis)
    || verifiedAtMillis > now + 5_000
    || now - verifiedAtMillis > MAX_ATTESTATION_AGE_MS) {
    throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_READINESS_STALE');
  }
  return Object.freeze({ ...value, requiredFunctions: Object.freeze([...value.requiredFunctions]) });
}

export function writeB4ABrowserFunctionsReadiness(file, value) {
  validateB4ABrowserFunctionsReadiness(value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

export function readB4ABrowserFunctionsReadiness(file, options = {}) {
  if (!fs.existsSync(file)) throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_READINESS_REQUIRED');
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_READINESS_JSON_INVALID', { cause: error });
  }
  return validateB4ABrowserFunctionsReadiness(value, options);
}

export function validateB4ABrowserProcessState(value, { requireAllPorts = true } = {}) {
  if (!exactKeys(value, PROCESS_STATE_KEYS)) throw new B4ABrowserFunctionsReadinessError('B4A_PROCESS_STATE_SHAPE_INVALID');
  if (value.schemaVersion !== 2 || value.projectId !== B4A_BROWSER_FUNCTIONS_PROJECT_ID) {
    throw new B4ABrowserFunctionsReadinessError('B4A_PROCESS_STATE_AUTHORITY_INVALID');
  }
  if (typeof value.sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.sessionId)
    || !Number.isSafeInteger(value.launcherPid) || value.launcherPid <= 0
    || !Number.isFinite(Date.parse(value.startedAt))
    || !value.processIdsByPort || typeof value.processIdsByPort !== 'object') {
    throw new B4ABrowserFunctionsReadinessError('B4A_PROCESS_STATE_INVALID');
  }
  for (const [port, pid] of Object.entries(value.processIdsByPort)) {
    if (!EXPECTED_PORTS.includes(Number(port)) || !Number.isSafeInteger(pid) || pid <= 0) {
      throw new B4ABrowserFunctionsReadinessError('B4A_PROCESS_STATE_LISTENER_INVALID');
    }
  }
  if (requireAllPorts && EXPECTED_PORTS.some((port) => !Number.isSafeInteger(value.processIdsByPort[port]))) {
    throw new B4ABrowserFunctionsReadinessError('B4A_PROCESS_STATE_LISTENERS_INCOMPLETE');
  }
  return Object.freeze({ ...value, processIdsByPort: Object.freeze({ ...value.processIdsByPort }) });
}

export function readB4ABrowserProcessState(file, options = {}) {
  if (!fs.existsSync(file)) throw new B4ABrowserFunctionsReadinessError('B4A_PROCESS_STATE_REQUIRED');
  try {
    return validateB4ABrowserProcessState(JSON.parse(fs.readFileSync(file, 'utf8')), options);
  } catch (error) {
    if (error instanceof B4ABrowserFunctionsReadinessError) throw error;
    throw new B4ABrowserFunctionsReadinessError('B4A_PROCESS_STATE_JSON_INVALID', { cause: error });
  }
}

export async function verifyB4ABrowserFunctionsReadiness({
  paths,
  listeningProcessIds,
  isProcessAlive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  probe = runB4ABrowserFunctionsZeroWriteCheck,
  now = Date.now(),
} = {}) {
  const state = readB4ABrowserProcessState(paths.processState);
  const readiness = readB4ABrowserFunctionsReadiness(paths.functionsReadiness, {
    expectedLauncherPid: state.launcherPid,
    expectedSessionId: state.sessionId,
    startedAt: state.startedAt,
    now,
  });
  if (!isProcessAlive(state.launcherPid)) throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_LAUNCHER_DEAD');
  const listeners = listeningProcessIds();
  if (listeners[5001] !== state.processIdsByPort[5001]) {
    throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_LISTENER_MISMATCH');
  }
  if (!fs.existsSync(paths.functionsLog)) throw new B4ABrowserFunctionsReadinessError('B4A_FUNCTIONS_LOG_REQUIRED');
  const fatal = findB4ABrowserFunctionsFatalMarker(fs.readFileSync(paths.functionsLog, 'utf8'));
  if (fatal) throw new B4ABrowserFunctionsReadinessError(`B4A_FUNCTIONS_DISCOVERY_FATAL:${fatal}`);
  const result = await probe();
  return Object.freeze({ state, readiness, probe: result });
}

export const B4A_BROWSER_FUNCTIONS_PROBES = PROBES;
export const B4A_BROWSER_EXPECTED_PORTS = EXPECTED_PORTS;
