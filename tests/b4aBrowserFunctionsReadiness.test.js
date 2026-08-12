import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  B4A_BROWSER_FUNCTIONS_DISCOVERY_TIMEOUT,
  B4A_BROWSER_FUNCTIONS_ENDPOINT,
  B4A_BROWSER_FUNCTIONS_FATAL_MARKERS,
  B4A_BROWSER_FUNCTIONS_PROBES,
  B4A_BROWSER_FUNCTIONS_PROJECT_ID,
  B4A_BROWSER_FUNCTIONS_REGION,
  B4A_BROWSER_FUNCTIONS_REQUIRED,
  B4ABrowserFunctionsReadinessError,
  b4aBrowserFunctionUrl,
  createB4ABrowserFunctionsReadiness,
  findB4ABrowserFunctionsFatalMarker,
  readB4ABrowserFunctionsReadiness,
  runB4ABrowserFunctionsEndpointProbes,
  runB4ABrowserFunctionsZeroWriteCheck,
  validateB4ABrowserFunctionsReadiness,
  validateB4ABrowserProbeObservation,
  validateB4ABrowserProcessState,
  verifyB4ABrowserFunctionsReadiness,
  waitForB4ABrowserFunctionsProbes,
  writeB4ABrowserFunctionsReadiness,
} from '../scripts/b4aBrowserFunctionsReadiness.js';
import {
  B4A_BROWSER_VITE_ENVIRONMENT,
  assertBrowserPreviewEnvironment,
  browserPreviewEnvironment,
} from '../scripts/b4aBrowserPreviewConfig.js';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const STARTED_AT = '2026-08-12T00:00:00.000Z';
const VERIFIED_AT = '2026-08-12T00:00:01.000Z';
const NOW = Date.parse('2026-08-12T00:00:02.000Z');

function temporaryDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'b4a-functions-readiness-'));
  try {
    return callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function validReadiness(overrides = {}) {
  return { ...createB4ABrowserFunctionsReadiness({ launcherPid: 1234, sessionId: SESSION_ID, verifiedAt: VERIFIED_AT }), ...overrides };
}

function validProcessState(overrides = {}) {
  return {
    schemaVersion: 2,
    projectId: B4A_BROWSER_FUNCTIONS_PROJECT_ID,
    sessionId: SESSION_ID,
    launcherPid: 1234,
    startedAt: STARTED_AT,
    processIdsByPort: { 4400: 2001, 5001: 2002, 8080: 2003, 9099: 2004 },
    ...overrides,
  };
}

function observationFor(probe) {
  return probe.method === 'OPTIONS'
    ? { status: 204, redirected: false, allowOrigin: 'http://127.0.0.1:4174', json: null }
    : {
      status: probe.status,
      redirected: false,
      allowOrigin: null,
      json: { error: { status: probe.errorStatus, message: probe.message } },
    };
}

function expectedFetch(url, init) {
  const probe = B4A_BROWSER_FUNCTIONS_PROBES.find((candidate) => url.endsWith(`/${candidate.name}`));
  assert.ok(probe);
  assert.equal(init.redirect, 'manual');
  if (probe.method === 'OPTIONS') {
    assert.equal(init.headers.Origin, 'http://127.0.0.1:4174');
    return Promise.resolve(new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4174' },
    }));
  }
  assert.equal(init.body, '{"data":{}}');
  return Promise.resolve(new Response(JSON.stringify({
    error: { status: probe.errorStatus, message: probe.message },
  }), { status: probe.status, headers: { 'Content-Type': 'application/json' } }));
}

for (const inherited of ['1', '10', 'not-a-number', '']) {
  test(`canonical discovery timeout overrides inherited ${JSON.stringify(inherited)}`, () => {
    const env = browserPreviewEnvironment({ FUNCTIONS_DISCOVERY_TIMEOUT: inherited });
    assert.equal(env.FUNCTIONS_DISCOVERY_TIMEOUT, '60');
    assert.equal(assertBrowserPreviewEnvironment(env), true);
  });
}

for (const invalid of [undefined, '', '1', '10', '060', 60]) {
  test(`environment assertion rejects non-canonical discovery timeout ${JSON.stringify(invalid)}`, () => {
    const env = browserPreviewEnvironment({});
    if (invalid === undefined) delete env.FUNCTIONS_DISCOVERY_TIMEOUT;
    else env.FUNCTIONS_DISCOVERY_TIMEOUT = invalid;
    assert.throws(() => assertBrowserPreviewEnvironment(env), /FUNCTIONS_DISCOVERY_TIMEOUT/);
  });
}

test('discovery timeout is harness-only and absent from Vite production/runtime values', () => {
  assert.equal(B4A_BROWSER_FUNCTIONS_DISCOVERY_TIMEOUT, '60');
  assert.equal(Object.hasOwn(B4A_BROWSER_VITE_ENVIRONMENT, 'FUNCTIONS_DISCOVERY_TIMEOUT'), false);
});

test('canonical harness uses CLI manifest-output discovery to avoid localhost startup races', () => {
  const env = browserPreviewEnvironment({ FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH: 'remote-or-inherited' });
  assert.equal(env.FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH, 'true');
  assert.equal(assertBrowserPreviewEnvironment(env), true);
});

test('environment assertion rejects a non-canonical discovery output mode', () => {
  assert.throws(
    () => assertBrowserPreviewEnvironment({
      ...browserPreviewEnvironment({}),
      FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH: 'false',
    }),
    /FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH/,
  );
});

test('fixed function URLs derive from loopback project region and function name', () => {
  assert.equal(
    b4aBrowserFunctionUrl('submitTournamentPreRegistration'),
    `${B4A_BROWSER_FUNCTIONS_ENDPOINT}/${B4A_BROWSER_FUNCTIONS_PROJECT_ID}/${B4A_BROWSER_FUNCTIONS_REGION}/submitTournamentPreRegistration`,
  );
});

for (const endpoint of ['https://cloudfunctions.net', 'http://localhost:5001', 'http://127.0.0.1:5002']) {
  test(`remote or non-canonical endpoint is rejected: ${endpoint}`, () => {
    assert.throws(() => b4aBrowserFunctionUrl('submitTournamentPreRegistration', endpoint), /REMOTE_ENDPOINT_REJECTED/);
  });
}

for (const probe of B4A_BROWSER_FUNCTIONS_PROBES) {
  test(`${probe.name} exact readiness response is accepted`, () => {
    assert.equal(validateB4ABrowserProbeObservation(probe, observationFor(probe)), true);
  });
}

test('404 readiness response is rejected', () => {
  const probe = B4A_BROWSER_FUNCTIONS_PROBES[0];
  assert.throws(() => validateB4ABrowserProbeObservation(probe, { ...observationFor(probe), status: 404 }), /NOT_FOUND/);
});

test('INTERNAL readiness response is rejected', () => {
  const probe = B4A_BROWSER_FUNCTIONS_PROBES[0];
  assert.throws(() => validateB4ABrowserProbeObservation(probe, { ...observationFor(probe), status: 500 }), /INTERNAL/);
});

test('malformed callable JSON is rejected', () => {
  const probe = B4A_BROWSER_FUNCTIONS_PROBES[0];
  assert.throws(() => validateB4ABrowserProbeObservation(probe, { ...observationFor(probe), json: null }), /JSON_INVALID/);
});

test('unexpected callable error contract is rejected', () => {
  const probe = B4A_BROWSER_FUNCTIONS_PROBES[0];
  const observation = observationFor(probe);
  observation.json.error.message = 'INTERNAL';
  assert.throws(() => validateB4ABrowserProbeObservation(probe, observation), /CONTRACT_UNEXPECTED/);
});

test('redirect is rejected', () => {
  const probe = B4A_BROWSER_FUNCTIONS_PROBES[0];
  assert.throws(() => validateB4ABrowserProbeObservation(probe, { ...observationFor(probe), status: 302 }), /REDIRECT/);
});

test('wrong OPTIONS CORS origin is rejected', () => {
  const probe = B4A_BROWSER_FUNCTIONS_PROBES.find(({ method }) => method === 'OPTIONS');
  assert.throws(() => validateB4ABrowserProbeObservation(probe, { ...observationFor(probe), allowOrigin: '*' }), /CORS_ORIGIN/);
});

test('the complete six-endpoint probe accepts only exact zero-write observations', async () => {
  const result = await runB4ABrowserFunctionsEndpointProbes({ fetchImpl: expectedFetch });
  assert.equal(result.results.length, 6);
  assert.deepEqual(result.results.map(({ name }) => name), B4A_BROWSER_FUNCTIONS_PROBES.map(({ name }) => name));
});

test('request timeout is rejected and is not startup-retriable', async () => {
  await assert.rejects(
    runB4ABrowserFunctionsEndpointProbes({ fetchImpl: async () => { throw new DOMException('timeout', 'TimeoutError'); } }),
    (error) => error.code === 'B4A_FUNCTIONS_PROBE_TIMEOUT' && error.retriable === false,
  );
});

test('connection reset is rejected and is not startup-retriable', async () => {
  const failure = new TypeError('fetch failed', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) });
  await assert.rejects(
    runB4ABrowserFunctionsEndpointProbes({ fetchImpl: async () => { throw failure; } }),
    (error) => error.code === 'B4A_FUNCTIONS_ENDPOINT_NOT_READY' && error.retriable === false,
  );
});

test('connection refused is marked retriable only for bounded startup retry', async () => {
  const failure = new TypeError('fetch failed', { cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) });
  await assert.rejects(
    runB4ABrowserFunctionsEndpointProbes({ fetchImpl: async () => { throw failure; } }),
    (error) => error.code === 'B4A_FUNCTIONS_ENDPOINT_NOT_READY' && error.retriable === true,
  );
});

test('bounded startup retry recovers from one connection-refused snapshot', async () => {
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    if (calls === 1) throw new TypeError('fetch failed', { cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) });
    if (url.includes(':8080/')) return new Response('[]', { status: 200 });
    if (url.includes(':9099/')) return new Response('{"users":[]}', { status: 200 });
    return expectedFetch(url, init);
  };
  const result = await waitForB4ABrowserFunctionsProbes({
    deadlineAt: Date.now() + 1_000,
    retryDelayMs: 0,
    fetchImpl,
  });
  assert.equal(result.stateUnchanged, true);
  assert.ok(calls > 1);
});

test('zero-write probe rejects any fixture or rate-limit state mutation', async () => {
  let firestoreCalls = 0;
  const fetchImpl = async (url, init) => {
    if (url.includes(':8080/')) {
      firestoreCalls += 1;
      return new Response(firestoreCalls > 8
        ? '[{"document":{"name":"projects/demo/databases/(default)/documents/artifacts/mutated"}}]'
        : '[]', { status: 200 });
    }
    if (url.includes(':9099/')) return new Response('{"users":[]}', { status: 200 });
    return expectedFetch(url, init);
  };
  await assert.rejects(runB4ABrowserFunctionsZeroWriteCheck({ fetchImpl }), /PROBE_MUTATED_STATE/);
});

for (const marker of B4A_BROWSER_FUNCTIONS_FATAL_MARKERS) {
  test(`fatal discovery marker is detected: ${marker}`, () => {
    assert.equal(findB4ABrowserFunctionsFatalMarker(`prefix ${marker} suffix`), marker);
  });
}

test('All emulators ready without a fatal marker is not itself readiness evidence', () => {
  assert.equal(findB4ABrowserFunctionsFatalMarker('All emulators ready!'), null);
  const startSource = fs.readFileSync(new URL('../scripts/startB4ABrowserEmulators.js', import.meta.url), 'utf8');
  assert.match(startSource, /definitionsLoaded && portsReady/);
  assert.match(startSource, /waitForB4ABrowserFunctionsProbes/);
});

test('port 5001 alone is not readiness evidence', () => {
  const startSource = fs.readFileSync(new URL('../scripts/startB4ABrowserEmulators.js', import.meta.url), 'utf8');
  assert.doesNotMatch(startSource, /if \(.*5001.*\).*READY/);
});

test('exact-shape readiness attestation is accepted', () => {
  assert.deepEqual(
    validateB4ABrowserFunctionsReadiness(validReadiness(), { startedAt: STARTED_AT, now: NOW }),
    validReadiness(),
  );
});

const readinessMutations = [
  ['wrong project', { projectId: 'kaijuzaocard-tournaments' }, /PROJECTID/],
  ['wrong region', { region: 'us-central1' }, /REGION/],
  ['remote endpoint', { functionsEndpoint: 'https://cloudfunctions.net' }, /FUNCTIONSENDPOINT/],
  ['missing required function', { requiredFunctions: B4A_BROWSER_FUNCTIONS_REQUIRED.slice(1) }, /REQUIREDFUNCTIONS/],
  ['PID mismatch', {}, /PID_MISMATCH/, { expectedLauncherPid: 9999 }],
  ['session mismatch', {}, /SESSION_MISMATCH/, { expectedSessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }],
  ['stale timestamp', { verifiedAt: '2026-08-11T00:00:00.000Z' }, /STALE/],
];
for (const [label, mutation, pattern, options = {}] of readinessMutations) {
  test(`readiness rejects ${label}`, () => {
    assert.throws(
      () => validateB4ABrowserFunctionsReadiness(validReadiness(mutation), { startedAt: STARTED_AT, now: NOW, ...options }),
      pattern,
    );
  });
}

test('readiness rejects an extra key', () => {
  assert.throws(() => validateB4ABrowserFunctionsReadiness({ ...validReadiness(), extra: true }, { now: NOW }), /SHAPE/);
});

test('readiness writer uses safe exact content and reader rejects missing file', () => {
  temporaryDirectory((directory) => {
    const file = path.join(directory, 'ready.json');
    assert.throws(() => readB4ABrowserFunctionsReadiness(file), /READINESS_REQUIRED/);
    writeB4ABrowserFunctionsReadiness(file, createB4ABrowserFunctionsReadiness({ launcherPid: 1234, sessionId: SESSION_ID }));
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /secret|HMAC|token|credential|player|AIza/i);
    assert.equal(Object.keys(JSON.parse(text)).length, 10);
  });
});

test('process state exact shape and complete listeners are accepted', () => {
  assert.deepEqual(validateB4ABrowserProcessState(validProcessState()), validProcessState());
});

for (const [label, mutation] of [
  ['wrong project', { projectId: 'demo-other' }],
  ['wrong session', { sessionId: 'not-a-session' }],
  ['missing listener', { processIdsByPort: { 4400: 1, 5001: 2, 8080: 3 } }],
  ['extra key', { extra: true }],
]) {
  test(`process state rejects ${label}`, () => {
    assert.throws(() => validateB4ABrowserProcessState(validProcessState(mutation)), B4ABrowserFunctionsReadinessError);
  });
}

test('live verifier binds attestation session PID listener log and re-probe', async () => {
  await temporaryDirectory(async (directory) => {
    const paths = {
      processState: path.join(directory, 'state.json'),
      functionsReadiness: path.join(directory, 'ready.json'),
      functionsLog: path.join(directory, 'functions.log'),
    };
    fs.writeFileSync(paths.processState, JSON.stringify(validProcessState()));
    fs.writeFileSync(paths.functionsReadiness, JSON.stringify(validReadiness()));
    fs.writeFileSync(paths.functionsLog, 'Loaded functions definitions from source:\nB4A Browser Functions READY\n');
    let probeCalls = 0;
    const result = await verifyB4ABrowserFunctionsReadiness({
      paths,
      listeningProcessIds: () => ({ 5001: 2002 }),
      isProcessAlive: () => true,
      probe: async () => { probeCalls += 1; return { stateUnchanged: true }; },
      now: NOW,
    });
    assert.equal(result.readiness.sessionId, SESSION_ID);
    assert.equal(probeCalls, 1);
  });
});

test('live verifier rejects dead or mismatched listener', async () => {
  await temporaryDirectory(async (directory) => {
    const paths = {
      processState: path.join(directory, 'state.json'),
      functionsReadiness: path.join(directory, 'ready.json'),
      functionsLog: path.join(directory, 'functions.log'),
    };
    fs.writeFileSync(paths.processState, JSON.stringify(validProcessState()));
    fs.writeFileSync(paths.functionsReadiness, JSON.stringify(validReadiness()));
    fs.writeFileSync(paths.functionsLog, 'READY');
    await assert.rejects(verifyB4ABrowserFunctionsReadiness({
      paths,
      listeningProcessIds: () => ({ 5001: 9999 }),
      isProcessAlive: () => true,
      probe: async () => ({}),
      now: NOW,
    }), /LISTENER_MISMATCH/);
  });
});

test('seed and preview both require the same live verifier before work', () => {
  const seed = fs.readFileSync(new URL('../scripts/seedB4ABrowserPreview.js', import.meta.url), 'utf8');
  const preview = fs.readFileSync(new URL('../scripts/startB4ABrowserFrontend.js', import.meta.url), 'utf8');
  assert.match(seed, /await verifyB4ABrowserFunctionsReadiness/);
  assert.ok(seed.indexOf('await verifyB4ABrowserFunctionsReadiness') < seed.indexOf('const app = initializeApp'));
  assert.match(preview, /await verifyB4ABrowserFunctionsReadiness/);
  assert.ok(preview.indexOf('await verifyB4ABrowserFunctionsReadiness') < preview.indexOf("spawn(process.execPath"));
});

test('direct service-layer seed remains gated and is not treated as readiness', () => {
  const seed = fs.readFileSync(new URL('../scripts/seedB4ABrowserPreview.js', import.meta.url), 'utf8');
  assert.ok(seed.indexOf('await verifyB4ABrowserFunctionsReadiness') < seed.indexOf('const service = createPreRegistrationService'));
});

test('malformed manage actions fail before the rate-limit write', () => {
  const service = fs.readFileSync(new URL('../functions/src/service.js', import.meta.url), 'utf8');
  const manageStart = service.indexOf('async function manage(rawPayload, rawIp)');
  const transactionStart = service.indexOf('return await db.runTransaction', manageStart);
  const managePreamble = service.slice(manageStart, transactionStart);
  assert.ok(manageStart >= 0);
  assert.ok(transactionStart > manageStart);
  assert.ok(managePreamble.indexOf('validateManagePayload(rawPayload)') < managePreamble.indexOf('consumeRateLimit'));
});

test('failed startup removes readiness and keeps diagnostic log', () => {
  const start = fs.readFileSync(new URL('../scripts/startB4ABrowserEmulators.js', import.meta.url), 'utf8');
  assert.match(start, /fs\.rmSync\(paths\.functionsReadiness, \{ force: true \}\)/);
  assert.doesNotMatch(start, /catch[\s\S]*fs\.rmSync\(paths\.functionsLog/);
});

test('cleanup and stop own readiness while unrelated files are not recursively removed', () => {
  const cleanup = fs.readFileSync(new URL('../scripts/cleanupB4ABrowserPreview.js', import.meta.url), 'utf8');
  const stop = fs.readFileSync(new URL('../scripts/stopB4ABrowserEmulators.js', import.meta.url), 'utf8');
  assert.match(cleanup, /paths\.functionsReadiness/);
  assert.match(stop, /paths\.functionsReadiness/);
  assert.doesNotMatch(cleanup, /rmSync\(.*artifacts.*recursive/);
});

test('isolated emulator runners keep their original fail-closed lifecycle checks', () => {
  const functionsRunner = fs.readFileSync(new URL('../scripts/runPreRegistrationEmulatorTests.js', import.meta.url), 'utf8');
  const rulesRunner = fs.readFileSync(new URL('../scripts/runRulesEmulatorTests.js', import.meta.url), 'utf8');
  assert.match(functionsRunner, /Refusing to overwrite an existing Functions emulator override file/);
  assert.match(rulesRunner, /port: 8080/);
  assert.match(rulesRunner, /emulators:exec/);
});
