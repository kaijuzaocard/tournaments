import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapFirebaseAuth } from '../src/authBootstrap.js';

const GOOGLE_USER = Object.freeze({
  uid: 'admin-user',
  isAnonymous: false,
  providerData: [{ providerId: 'google.com' }],
});

function createHarness({ restoredUser = null, initialUser = null } = {}) {
  const events = [];
  const auth = {
    currentUser: initialUser,
    authStateReady: async () => {
      events.push('auth-state-ready');
      auth.currentUser = restoredUser;
    },
  };
  const anonymousUser = { uid: 'anonymous-user', isAnonymous: true };
  const calls = {
    anonymous: 0,
    customToken: 0,
  };

  return {
    auth,
    calls,
    events,
    signInAnonymously: async () => {
      assert.deepEqual(events, ['auth-state-ready']);
      calls.anonymous += 1;
      auth.currentUser = anonymousUser;
    },
    signInWithCustomToken: async () => {
      assert.deepEqual(events, ['auth-state-ready']);
      calls.customToken += 1;
    },
  };
}

test('preserves a restored Google user instead of replacing it with an anonymous user', async () => {
  const harness = createHarness({ restoredUser: GOOGLE_USER });

  await bootstrapFirebaseAuth(harness);

  assert.equal(harness.auth.currentUser, GOOGLE_USER);
  assert.equal(harness.calls.anonymous, 0);
  assert.equal(harness.calls.customToken, 0);
});

test('signs in anonymously only after auth persistence resolves with no user', async () => {
  const harness = createHarness();

  await bootstrapFirebaseAuth(harness);

  assert.equal(harness.auth.currentUser.isAnonymous, true);
  assert.equal(harness.calls.anonymous, 1);
});

test('preserves a restored user when custom-token sign-in fails', async () => {
  const harness = createHarness({ restoredUser: GOOGLE_USER });
  const warnings = [];
  harness.initialAuthToken = 'invalid-custom-token';
  harness.logger = { warn: (...args) => warnings.push(args) };
  harness.signInWithCustomToken = async () => {
    harness.calls.customToken += 1;
    throw Object.assign(new Error('invalid custom token'), { code: 'auth/invalid-custom-token' });
  };

  await bootstrapFirebaseAuth(harness);

  assert.equal(harness.auth.currentUser, GOOGLE_USER);
  assert.equal(harness.calls.customToken, 1);
  assert.equal(harness.calls.anonymous, 0);
  assert.equal(warnings.length, 1);
});

test('falls back to anonymous after custom-token failure only when no user was restored', async () => {
  const harness = createHarness();
  harness.initialAuthToken = 'invalid-custom-token';
  harness.logger = { warn: () => {} };
  harness.signInWithCustomToken = async () => {
    harness.calls.customToken += 1;
    throw Object.assign(new Error('invalid custom token'), { code: 'auth/invalid-custom-token' });
  };

  await bootstrapFirebaseAuth(harness);

  assert.equal(harness.calls.customToken, 1);
  assert.equal(harness.calls.anonymous, 1);
  assert.equal(harness.auth.currentUser.isAnonymous, true);
});

test('does not attempt sign-in when persisted auth initialization fails', async () => {
  const harness = createHarness();
  harness.auth.authStateReady = async () => {
    throw Object.assign(new Error('storage unavailable'), { code: 'auth/network-request-failed' });
  };

  await assert.rejects(() => bootstrapFirebaseAuth(harness), {
    code: 'auth/network-request-failed',
  });
  assert.equal(harness.calls.customToken, 0);
  assert.equal(harness.calls.anonymous, 0);
});
