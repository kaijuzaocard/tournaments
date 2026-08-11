import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  B4A_BROWSER_BUILD_ATTESTATION,
  readB4ABrowserBuildAttestation,
  validateB4ABrowserBuildAttestation,
  writeB4ABrowserBuildAttestation,
} from '../scripts/b4aBrowserPreviewAttestation.js';
import {
  buildB4ABrowserPreviewBlueprint,
  buildB4ABrowserPreviewManifest,
} from '../scripts/b4aBrowserPreviewData.js';
import { B4A_PREVIEW_ADMIN_FIXTURE } from '../src/b4aPreviewAdminFixture.js';
import {
  B4A_BROWSER_ADMIN_UID,
  B4A_BROWSER_ENV_FILE_CONTENT,
  B4A_BROWSER_PROJECT_ID,
  B4A_BROWSER_SECRET_FILE_CONTENT,
  assertBrowserPreviewEnvironment,
  assertBrowserPreviewViteEnvironment,
  browserPreviewEnvironment,
  browserPreviewViteEnvironment,
} from '../scripts/b4aBrowserPreviewConfig.js';

function withTemporaryAttestation(contents, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'b4a-build-attestation-'));
  const file = path.join(directory, 'b4a-emulator-build.json');
  try {
    if (contents !== undefined) fs.writeFileSync(file, contents);
    return callback(file);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('canonical preview environment uses one demo project and three fixed loopback emulators', () => {
  const env = browserPreviewEnvironment({});
  assert.equal(assertBrowserPreviewEnvironment(env), true);
  assert.equal(env.GCLOUD_PROJECT, B4A_BROWSER_PROJECT_ID);
  assert.equal(JSON.parse(env.FIREBASE_CONFIG).projectId, B4A_BROWSER_PROJECT_ID);
});

test('canonical Vite environment overrides an inherited production runtime', () => {
  const env = browserPreviewViteEnvironment({
    UNRELATED_VALUE: 'preserved',
    VITE_FIREBASE_RUNTIME: 'production',
    VITE_FIREBASE_ADMIN_UIDS: 'production-admin',
  });
  assert.equal(assertBrowserPreviewViteEnvironment(env), true);
  assert.equal(env.UNRELATED_VALUE, 'preserved');
  assert.equal(env.VITE_FIREBASE_RUNTIME, 'emulator');
  assert.equal(env.VITE_FIREBASE_ADMIN_UIDS, B4A_BROWSER_ADMIN_UID);
});

test('canonical Vite environment overrides inherited production project IDs', () => {
  const env = browserPreviewViteEnvironment({
    VITE_FIREBASE_PROJECT_ID: 'kaijuzaocard-tournaments',
    VITE_FIREBASE_CLI_PROJECT_ID: 'kaijuzaocard-tournaments',
  });
  assert.equal(env.VITE_FIREBASE_PROJECT_ID, B4A_BROWSER_PROJECT_ID);
  assert.equal(env.VITE_FIREBASE_CLI_PROJECT_ID, B4A_BROWSER_PROJECT_ID);
});

for (const [service, hostName, portName, remoteHost, expectedPort] of [
  ['Auth', 'VITE_FIREBASE_AUTH_EMULATOR_HOST', 'VITE_FIREBASE_AUTH_EMULATOR_PORT', 'identitytoolkit.googleapis.com', '9099'],
  ['Firestore', 'VITE_FIREBASE_FIRESTORE_EMULATOR_HOST', 'VITE_FIREBASE_FIRESTORE_EMULATOR_PORT', 'firestore.googleapis.com', '8080'],
  ['Functions', 'VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST', 'VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT', 'cloudfunctions.net', '5001'],
]) {
  test(`canonical Vite environment overrides an inherited remote ${service} endpoint`, () => {
    const env = browserPreviewViteEnvironment({ [hostName]: remoteHost, [portName]: '443' });
    assert.equal(env[hostName], '127.0.0.1');
    assert.equal(env[portName], expectedPort);
  });
}

test('canonical Vite environment removes inherited production Swiss and unknown Firebase values', () => {
  const env = browserPreviewViteEnvironment({
    VITE_SWISS_APP_URL: 'https://swiss-tournament-one.vercel.app',
    VITE_SWISS_ALLOWED_ORIGINS: 'https://swiss-tournament-one.vercel.app',
    VITE_FIREBASE_UNEXPECTED_CREDENTIAL: 'must-not-survive',
  });
  assert.equal(env.VITE_SWISS_APP_URL, 'http://127.0.0.1:4174');
  assert.equal(env.VITE_SWISS_ALLOWED_ORIGINS, 'http://127.0.0.1:4174');
  assert.equal(Object.hasOwn(env, 'VITE_FIREBASE_UNEXPECTED_CREDENTIAL'), false);
  assert.equal(assertBrowserPreviewViteEnvironment(env), true);
});

test('build:emulator uses the dedicated fail-closed build wrapper', () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(
    packageJson.scripts['build:emulator'],
    'node scripts/withB4ABrowserPreviewEnv.js scripts/buildB4ABrowserFrontend.js',
  );
});

test('build attestation has the exact safe canonical shape', () => {
  const validated = validateB4ABrowserBuildAttestation({ ...B4A_BROWSER_BUILD_ATTESTATION });
  assert.deepEqual(validated, B4A_BROWSER_BUILD_ATTESTATION);
  assert.deepEqual(Object.keys(validated), [
    'schemaVersion', 'mode', 'projectId', 'authEndpoint', 'firestoreEndpoint', 'functionsEndpoint',
  ]);
});

test('public build attestation contains no secret, token, API key, or player data', () => {
  assert.doesNotMatch(JSON.stringify(B4A_BROWSER_BUILD_ATTESTATION), /secret|token|apiKey|AIza|player/i);
});

test('attestation writer and start validator round trip the canonical document', () => {
  withTemporaryAttestation(undefined, (file) => {
    writeB4ABrowserBuildAttestation(file);
    assert.deepEqual(readB4ABrowserBuildAttestation(file), B4A_BROWSER_BUILD_ATTESTATION);
  });
});

test('start validator rejects a missing attestation', () => {
  withTemporaryAttestation(undefined, (file) => {
    assert.throws(() => readB4ABrowserBuildAttestation(file), /ATTESTATION_REQUIRED/);
  });
});

test('start validator rejects invalid attestation JSON', () => {
  withTemporaryAttestation('{not-json', (file) => {
    assert.throws(() => readB4ABrowserBuildAttestation(file), /ATTESTATION_JSON_INVALID/);
  });
});

test('start validator rejects an attestation with an extra field', () => {
  assert.throws(
    () => validateB4ABrowserBuildAttestation({ ...B4A_BROWSER_BUILD_ATTESTATION, extra: true }),
    /ATTESTATION_SHAPE_INVALID/,
  );
});

test('start validator rejects a production project attestation', () => {
  const value = { ...B4A_BROWSER_BUILD_ATTESTATION, projectId: 'kaijuzaocard-tournaments' };
  withTemporaryAttestation(JSON.stringify(value), (file) => {
    assert.throws(() => readB4ABrowserBuildAttestation(file), /PROJECTID_INVALID/);
  });
});

test('start validator rejects a remote endpoint attestation', () => {
  const value = { ...B4A_BROWSER_BUILD_ATTESTATION, authEndpoint: 'https://identitytoolkit.googleapis.com' };
  withTemporaryAttestation(JSON.stringify(value), (file) => {
    assert.throws(() => readB4ABrowserBuildAttestation(file), /AUTHENDPOINT_INVALID/);
  });
});

test('seed safety rejects a production project ID', () => {
  const env = browserPreviewEnvironment({});
  env.GCLOUD_PROJECT = 'kaijuzaocard-tournaments';
  assert.throws(() => assertBrowserPreviewEnvironment(env), /DEMO_PROJECT_REQUIRED/);
});

for (const [name, value] of [
  ['FIRESTORE_EMULATOR_HOST', 'firestore.googleapis.com:443'],
  ['FIREBASE_AUTH_EMULATOR_HOST', 'identitytoolkit.googleapis.com:443'],
  ['FUNCTIONS_EMULATOR_HOST', 'cloudfunctions.net:443'],
]) {
  test(`seed safety rejects non-canonical ${name}`, () => {
    assert.throws(
      () => assertBrowserPreviewEnvironment({ ...browserPreviewEnvironment({}), [name]: value }),
      new RegExp(name),
    );
  });
}

test('seed safety rejects a Firebase config project mismatch', () => {
  assert.throws(
    () => assertBrowserPreviewEnvironment({ ...browserPreviewEnvironment({}), FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-other' }) }),
    /PROJECT_ID_MISMATCH/,
  );
});

test('E1-E6 blueprint is complete and preserves every requested scenario', () => {
  const blueprint = buildB4ABrowserPreviewBlueprint(Date.parse('2026-08-12T00:00:00+08:00'));
  assert.equal(blueprint.events.length, 6);
  assert.deepEqual(blueprint.events.map(({ id }) => id), [
    'b4a-preview-e1-legacy-open',
    'b4a-preview-e2-full-no-waitlist',
    'b4a-preview-e3-full-waitlist',
    'b4a-preview-e4-last-seat-race',
    'b4a-preview-e5-ranked-waitlist',
    'b4a-preview-e6-malformed-rank',
  ]);
  assert.equal(Object.hasOwn(blueprint.events[0].preRegistration, 'schemaVersion'), false);
  assert.equal(blueprint.events[1].preRegistration.waitlistEnabled, false);
  assert.equal(blueprint.events[2].preRegistration.waitlistEnabled, true);
  assert.deepEqual(blueprint.scenarios['b4a-preview-e4-last-seat-race'], { active: 1, waitlisted: 0 });
  assert.deepEqual(blueprint.scenarios['b4a-preview-e5-ranked-waitlist'], { active: 2, waitlisted: 3 });
  assert.equal(blueprint.scenarios['b4a-preview-e6-malformed-rank'].duplicateWaitlistSequence, true);
});

test('preview fixtures are fictional and contain no production identities', () => {
  const serialized = JSON.stringify(buildB4ABrowserPreviewBlueprint(0));
  assert.match(serialized, /Preview/);
  assert.doesNotMatch(serialized, /kaijuzaocard-tournaments|AIza|script\.google\.com/);
});

test('preview manifest exposes safe Auth fixture metadata and no token or secret', () => {
  const blueprint = buildB4ABrowserPreviewBlueprint(0);
  const registrations = Object.fromEntries(blueprint.events.map((event) => [event.id, []]));
  const manifest = buildB4ABrowserPreviewManifest({
    blueprint,
    registrations,
    frontendOrigin: 'http://127.0.0.1:4174',
    generatedAt: '2026-08-12T00:00:00.000Z',
  });
  assert.equal(manifest.adminMockUid, B4A_PREVIEW_ADMIN_FIXTURE.uid);
  assert.equal(manifest.adminMockProviderSub, B4A_PREVIEW_ADMIN_FIXTURE.providerSub);
  assert.equal(manifest.authProvider, 'google.com');
  assert.doesNotMatch(JSON.stringify(manifest), /managementToken|managementUrl|refreshToken|customToken|idToken|secret|HMAC/i);
});

test('Auth seed imports only the fixed Google fixture and validates the import result', () => {
  const source = fs.readFileSync(new URL('../scripts/b4aBrowserPreviewAuthFixture.js', import.meta.url), 'utf8');
  assert.match(source, /successCount !== 1 \|\| result\.failureCount !== 0/);
  assert.match(source, /providerId: B4A_PREVIEW_ADMIN_FIXTURE\.providerId/);
  assert.match(source, /deleteUser\(B4A_PREVIEW_ADMIN_FIXTURE\.uid\)/);
  assert.doesNotMatch(source, /listUsers|deleteUsers/);
});

test('cleanup skips all Auth and Firestore networking in files-only mode', () => {
  const source = fs.readFileSync(new URL('../scripts/cleanupB4ABrowserPreview.js', import.meta.url), 'utf8');
  const networking = source.slice(source.indexOf("if (!process.argv.includes('--files-only'))"), source.indexOf('fs.rmSync(paths.manifest'));
  assert.match(networking, /getAuth/);
  assert.match(networking, /getFirestore/);
  assert.match(networking, /deleteB4APreviewAdminFixture/);
});

test('local Functions parameters use the Rules UID and emulator-only values', () => {
  const envFile = fs.readFileSync(new URL('../.env.emulator', import.meta.url), 'utf8');
  const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(envFile, new RegExp(B4A_BROWSER_ADMIN_UID));
  assert.match(rules, new RegExp(B4A_BROWSER_ADMIN_UID));
  assert.match(B4A_BROWSER_ENV_FILE_CONTENT, new RegExp(B4A_BROWSER_ADMIN_UID));
  assert.match(B4A_BROWSER_SECRET_FILE_CONTENT, /emulator-only/);
});

test('prepare refuses overwrite and cleanup owns only exact local files', () => {
  const prepare = fs.readFileSync(new URL('../scripts/prepareB4ABrowserPreview.js', import.meta.url), 'utf8');
  const cleanup = fs.readFileSync(new URL('../scripts/cleanupB4ABrowserPreview.js', import.meta.url), 'utf8');
  assert.match(prepare, /flag: 'wx'/);
  assert.match(prepare, /Refusing to overwrite/);
  assert.match(cleanup, /Refusing to remove a local file not created/);
  assert.match(cleanup, /force: true/);
});

test('preview manifest is ignored and never part of the production bundle input', () => {
  const gitignore = fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(gitignore, /artifacts\/b4a-p1\/browser-preview-manifest\.json/);
  assert.match(gitignore, /artifacts\/b4a-p1\/browser-preview-processes\.json/);
});

test('the stop flow refuses unrecorded listeners and removes only recorded harness PIDs', () => {
  const stop = fs.readFileSync(new URL('../scripts/stopB4ABrowserEmulators.js', import.meta.url), 'utf8');
  assert.match(stop, /Refusing to stop listeners without B4A preview process state/);
  assert.match(stop, /Refusing to stop unrecorded listener/);
  assert.match(stop, /state\.projectId !== B4A_BROWSER_PROJECT_ID/);
  assert.match(stop, /process\.kill\(pid, 'SIGTERM'\)/);
});
