import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  B4A_PREVIEW_ADMIN_FIXTURE,
  B4A_PREVIEW_GOOGLE_ID_TOKEN_CLAIMS,
} from '../src/b4aPreviewAdminFixture.js';
import {
  B4A_PREVIEW_ADMIN_IDENTITY_MISMATCH,
  assertB4APreviewAdminRuntime,
  createB4APreviewGoogleCredential,
  signInWithB4APreviewAdmin,
  validateB4APreviewAdminIdentity,
} from '../src/firebaseEmulatorAdminAuth.js';
import {
  deleteB4APreviewAdminFixture,
  importB4APreviewAdminFixture,
  isAuthUserNotFound,
} from '../scripts/b4aBrowserPreviewAuthFixture.js';

const runtimeInfo = (overrides = {}) => ({
  mode: 'emulator',
  projectId: 'demo-kaijuzaocard-calendar-browser',
  connected: true,
  authEndpoint: 'http://127.0.0.1:9099',
  firestoreEndpoint: 'http://127.0.0.1:8080',
  functionsEndpoint: 'http://127.0.0.1:5001',
  ...overrides,
});

const user = (overrides = {}) => ({
  uid: B4A_PREVIEW_ADMIN_FIXTURE.uid,
  isAnonymous: false,
  providerData: [{
    providerId: 'google.com',
    uid: B4A_PREVIEW_ADMIN_FIXTURE.providerSub,
    email: B4A_PREVIEW_ADMIN_FIXTURE.email,
  }],
  ...overrides,
});

test('preview auth fixture is the exact fixed fictional Google identity', () => {
  assert.deepEqual(B4A_PREVIEW_ADMIN_FIXTURE, {
    uid: 'z1JOoARRRsSFavRlGbnhZmM4NMQ2',
    providerSub: 'b4a-preview-google-admin-sub',
    email: 'b4a-admin@example.test',
    displayName: 'B4A Preview Admin',
    providerId: 'google.com',
  });
});

test('client mock token claims use the same provider sub and fictional profile', () => {
  assert.equal(B4A_PREVIEW_GOOGLE_ID_TOKEN_CLAIMS.sub, B4A_PREVIEW_ADMIN_FIXTURE.providerSub);
  assert.equal(B4A_PREVIEW_GOOGLE_ID_TOKEN_CLAIMS.email, B4A_PREVIEW_ADMIN_FIXTURE.email);
  assert.equal(B4A_PREVIEW_GOOGLE_ID_TOKEN_CLAIMS.email_verified, true);
});

test('canonical emulator runtime accepts deterministic preview sign-in', () => {
  assert.equal(assertB4APreviewAdminRuntime({
    isFirebaseEmulatorRuntime: true,
    runtimeInfo: runtimeInfo(),
    browserOrigin: 'http://127.0.0.1:4174',
  }), true);
});

for (const [name, input] of [
  ['production runtime', { isFirebaseEmulatorRuntime: false }],
  ['non-demo project', { runtimeInfo: runtimeInfo({ projectId: 'kaijuzaocard-tournaments' }) }],
  ['disconnected runtime', { runtimeInfo: runtimeInfo({ connected: false }) }],
  ['remote Auth endpoint', { runtimeInfo: runtimeInfo({ authEndpoint: 'https://identitytoolkit.googleapis.com' }) }],
  ['non-loopback browser origin', { browserOrigin: 'https://preview.example.test' }],
]) {
  test(`${name} cannot create deterministic preview credentials`, () => {
    assert.throws(() => createB4APreviewGoogleCredential({
      isFirebaseEmulatorRuntime: true,
      runtimeInfo: runtimeInfo(),
      browserOrigin: 'http://127.0.0.1:4174',
      credentialFactory: () => 'credential',
      ...input,
    }), new RegExp(B4A_PREVIEW_ADMIN_IDENTITY_MISMATCH));
  });
}

test('credential factory receives only the exact fictional JSON claims', () => {
  let received;
  const credential = createB4APreviewGoogleCredential({
    isFirebaseEmulatorRuntime: true,
    runtimeInfo: runtimeInfo(),
    browserOrigin: 'http://localhost:4174',
    credentialFactory: (value) => { received = value; return 'credential'; },
  });
  assert.equal(credential, 'credential');
  assert.deepEqual(JSON.parse(received), B4A_PREVIEW_GOOGLE_ID_TOKEN_CLAIMS);
});

test('exact UID provider data token provider and admin allowlist validate', () => {
  const proof = validateB4APreviewAdminIdentity({
    user: user(),
    tokenResult: { signInProvider: 'google.com' },
    isAdminUser: () => true,
  });
  assert.equal(proof.uid, B4A_PREVIEW_ADMIN_FIXTURE.uid);
  assert.equal(proof.signInProvider, 'google.com');
});

for (const [name, changedUser, tokenResult, isAdminUser] of [
  ['UID mismatch', user({ uid: 'wrong-uid' }), { signInProvider: 'google.com' }, () => true],
  ['anonymous user', user({ isAnonymous: true }), { signInProvider: 'google.com' }, () => true],
  ['non-Google provider data', user({ providerData: [{ providerId: 'password', uid: 'x' }] }), { signInProvider: 'google.com' }, () => true],
  ['provider sub mismatch', user({ providerData: [{ providerId: 'google.com', uid: 'wrong-sub', email: B4A_PREVIEW_ADMIN_FIXTURE.email }] }), { signInProvider: 'google.com' }, () => true],
  ['token sign-in provider mismatch', user(), { signInProvider: 'custom' }, () => true],
  ['admin allowlist rejection', user(), { signInProvider: 'google.com' }, () => false],
]) {
  test(`${name} fails closed`, () => {
    assert.throws(() => validateB4APreviewAdminIdentity({ user: changedUser, tokenResult, isAdminUser }), new RegExp(B4A_PREVIEW_ADMIN_IDENTITY_MISMATCH));
  });
}

test('successful deterministic sign-in requires a Functions admin authority result', async () => {
  const proof = await signInWithB4APreviewAdmin({
    auth: 'auth',
    isFirebaseEmulatorRuntime: true,
    runtimeInfo: runtimeInfo(),
    browserOrigin: 'http://127.0.0.1:4174',
    isAdminUser: () => true,
    verifyAdminAuthority: async () => true,
    credentialFactory: () => 'credential',
    signInWithCredentialFn: async () => ({ user: user() }),
    getIdTokenResultFn: async () => ({ signInProvider: 'google.com' }),
  });
  assert.equal(proof.functionsAdminCallable, 'accepted');
});

test('identity mismatch signs out and restores anonymous auth', async () => {
  const calls = [];
  await assert.rejects(signInWithB4APreviewAdmin({
    auth: 'auth',
    isFirebaseEmulatorRuntime: true,
    runtimeInfo: runtimeInfo(),
    browserOrigin: 'http://127.0.0.1:4174',
    isAdminUser: () => true,
    verifyAdminAuthority: async () => true,
    credentialFactory: () => 'credential',
    signInWithCredentialFn: async () => ({ user: user({ uid: 'wrong' }) }),
    getIdTokenResultFn: async () => ({ signInProvider: 'google.com' }),
    signOutFn: async () => calls.push('signOut'),
    signInAnonymouslyFn: async () => calls.push('anonymous'),
  }), new RegExp(B4A_PREVIEW_ADMIN_IDENTITY_MISMATCH));
  assert.deepEqual(calls, ['signOut', 'anonymous']);
});

test('fixture cleanup deletes only the fixed fixture UID', async () => {
  const deleted = [];
  await deleteB4APreviewAdminFixture({ deleteUser: async (uid) => deleted.push(uid) });
  assert.deepEqual(deleted, [B4A_PREVIEW_ADMIN_FIXTURE.uid]);
});

test('fixture cleanup treats Auth user-not-found as idempotent success', async () => {
  const result = await deleteB4APreviewAdminFixture({
    deleteUser: async () => { const error = new Error('missing'); error.code = 'auth/user-not-found'; throw error; },
  });
  assert.equal(result, 'not_found');
  assert.equal(isAuthUserNotFound({ code: 'auth/user-not-found' }), true);
});

test('fixture import validates one success and reads back the exact Google provider sub', async () => {
  const calls = [];
  const imported = await importB4APreviewAdminFixture({
    deleteUser: async () => { const error = new Error('missing'); error.code = 'auth/user-not-found'; throw error; },
    importUsers: async (records) => { calls.push(records); return { successCount: 1, failureCount: 0 }; },
    getUser: async () => ({ uid: B4A_PREVIEW_ADMIN_FIXTURE.uid, providerData: [{ providerId: 'google.com', uid: B4A_PREVIEW_ADMIN_FIXTURE.providerSub }] }),
  });
  assert.equal(calls[0][0].providerData[0].uid, B4A_PREVIEW_GOOGLE_ID_TOKEN_CLAIMS.sub);
  assert.equal(imported.uid, B4A_PREVIEW_ADMIN_FIXTURE.uid);
});

test('production popup remains while preview helper contains no custom-token or token output path', () => {
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const helper = fs.readFileSync(new URL('../src/firebaseEmulatorAdminAuth.js', import.meta.url), 'utf8');
  assert.match(app, /signInWithPopup\(auth, provider\)/);
  assert.match(app, /const isB4APreviewAdminRuntime = import\.meta\.env\.MODE === 'emulator'\s*&& isFirebaseEmulatorRuntime/);
  assert.match(app, /\{isB4APreviewAdminRuntime \? \(/);
  assert.doesNotMatch(helper, /signInWithCustomToken|console\.|globalThis\.__/);
});
