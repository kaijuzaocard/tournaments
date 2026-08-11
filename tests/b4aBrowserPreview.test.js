import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildB4ABrowserPreviewBlueprint } from '../scripts/b4aBrowserPreviewData.js';
import {
  B4A_BROWSER_ADMIN_UID,
  B4A_BROWSER_ENV_FILE_CONTENT,
  B4A_BROWSER_PROJECT_ID,
  B4A_BROWSER_SECRET_FILE_CONTENT,
  assertBrowserPreviewEnvironment,
  browserPreviewEnvironment,
} from '../scripts/b4aBrowserPreviewConfig.js';

test('canonical preview environment uses one demo project and three fixed loopback emulators', () => {
  const env = browserPreviewEnvironment({});
  assert.equal(assertBrowserPreviewEnvironment(env), true);
  assert.equal(env.GCLOUD_PROJECT, B4A_BROWSER_PROJECT_ID);
  assert.equal(JSON.parse(env.FIREBASE_CONFIG).projectId, B4A_BROWSER_PROJECT_ID);
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
  assert.deepEqual(blueprint.scenarios['b4a-preview-e5-ranked-waitlist'], { active: 1, waitlisted: 3 });
  assert.equal(blueprint.scenarios['b4a-preview-e6-malformed-rank'].duplicateWaitlistSequence, true);
});

test('preview fixtures are fictional and contain no production identities', () => {
  const serialized = JSON.stringify(buildB4ABrowserPreviewBlueprint(0));
  assert.match(serialized, /Preview/);
  assert.doesNotMatch(serialized, /kaijuzaocard-tournaments|AIza|script\.google\.com/);
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
