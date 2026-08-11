import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { createPreRegistrationService } from '../src/service.js';
import { createTournamentPreRegistrationHandoffService } from '../src/handoffService.js';
import {
  deterministicCredentials,
  hashManagementToken,
  hmac,
  stableJson,
} from '../src/security.js';

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const integrationTest = enabled ? test : test.skip;
const PROJECT_ID = 'demo-kaijuzaocard-calendar-functions';
const SECRET = 'emulator-only-secret-with-at-least-thirty-two-bytes';
const HANDOFF_SECRET = `${SECRET}-handoff`;
const EVENT_ROOT = 'artifacts/kaijuzaocard-main/public/data/monster_tournaments';
const PRIVATE_ROOT = 'artifacts/kaijuzaocard-main/private/data/tournamentPreRegistrations';
const HANDOFF_ROOT = 'artifacts/kaijuzaocard-main/private/data/tournamentPreRegistrationHandoffs';
const HANDOFF_OPERATION_ROOT = 'artifacts/kaijuzaocard-main/private/data/tournamentPreRegistrationHandoffOperations';
const HANDOFF_RATE_ROOT = 'artifacts/kaijuzaocard-main/private/data/tournamentPreRegistrationHandoffRateLimits';
const FUNCTIONS_HOST = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';

let app;
let db;
let clock;
let service;
let handoffService;

function payload(overrides = {}) {
  return {
    requestId: 'request-1',
    calendarEventId: 'event-1',
    playerName: 'Player',
    officialId: 'official-1',
    deckName: 'Deck',
    honorId: '',
    ...overrides,
  };
}

async function seedEvent(overrides = {}) {
  await db.doc(`${EVENT_ROOT}/event-1`).set({
    title: 'Test event',
    date: '2030-08-01',
    time: '19:00',
    preRegistration: { schemaVersion: 1, enabled: true, capacity: 8, deadline: null },
    ...overrides,
  });
}

async function seedLinkedEventAndEntries(entryOverrides = {}) {
  await seedEvent({
    swissIntegration: {
      schemaVersion: 1,
      swissTournamentId: 'tournament-1',
      linkedAt: Timestamp.fromMillis(clock - 1),
    },
  });
  const registrations = ['reg-1', 'reg-2', 'reg-3'];
  await Promise.all(registrations.map((registrationId, index) => db.doc(`${PRIVATE_ROOT}/event-1/entries/${registrationId}`).set({
    schemaVersion: 1,
    registrationId,
    calendarEventId: 'event-1',
    status: 'active',
    playerName: `Player ${index + 1}`,
    officialId: `official-${index + 1}`,
    deckName: `Deck ${index + 1}`,
    honorId: '',
    createdAt: Timestamp.fromMillis(clock - 10),
    updatedAt: Timestamp.fromMillis(clock - 5),
    ...(entryOverrides[registrationId] || {}),
  })));
}

const createHandoffPayload = (overrides = {}) => ({
  requestId: 'handoff-request-1',
  calendarEventId: 'event-1',
  selectedRegistrationIds: ['reg-1', 'reg-2'],
  ...overrides,
});

async function callFunctionEnvelope(name, data) {
  const response = await fetch(`http://${FUNCTIONS_HOST}/${PROJECT_ID}/asia-east1/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const body = await response.json();
  return { response, body };
}

async function callFunction(name, data) {
  const { response, body } = await callFunctionEnvelope(name, data);
  if (!response.ok || body.error) {
    const error = new Error(body.error?.message || `CALLABLE_HTTP_${response.status}`);
    error.callable = body.error;
    throw error;
  }
  return body.result;
}

async function callHandoffHttp({ method = 'POST', origin, body } = {}) {
  const headers = {};
  if (origin) headers.origin = origin;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`http://${FUNCTIONS_HOST}/${PROJECT_ID}/asia-east1/manageTournamentPreRegistrationHandoff`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

before(() => {
  if (!enabled) return;
  app = initializeApp({ projectId: PROJECT_ID }, `b2a-${Date.now()}`);
  db = getFirestore(app);
});

beforeEach(async () => {
  if (!enabled) return;
  await db.recursiveDelete(db.collection('artifacts'));
  clock = Date.parse('2030-01-01T00:00:00Z');
  service = createPreRegistrationService({ db, FieldValue, Timestamp, secret: SECRET, now: () => clock });
  handoffService = createTournamentPreRegistrationHandoffService({
    db,
    FieldValue,
    Timestamp,
    secret: HANDOFF_SECRET,
    allowedOrigins: new Set(['https://swiss.example.test']),
    now: () => clock,
  });
});

after(async () => {
  if (app) await deleteApp(app);
});

integrationTest('legal anonymous submit is atomic, private, and replayable', async () => {
  await seedEvent();
  const first = await service.submit(payload(), '192.0.2.1');
  const replay = await service.submit(payload(), '192.0.2.1');
  assert.equal(replay.registrationId, first.registrationId);
  assert.equal(replay.managementToken, first.managementToken);
  assert.equal(replay.replayed, true);
  assert.equal(replay.status, 'active');
  const entry = (await db.doc(`${PRIVATE_ROOT}/event-1/entries/${first.registrationId}`).get()).data();
  assert.equal(entry.registrationId, first.registrationId);
  assert.equal(entry.status, 'active');
  assert.equal(JSON.stringify(entry).includes(first.managementToken), false);
  assert.equal((await db.collection(`${PRIVATE_ROOT}/event-1/entries`).get()).size, 1);
  assert.equal((await db.collection('artifacts/kaijuzaocard-main/private/data/tournamentPreRegistrationRateLimits').get()).size, 2);
});

integrationTest('deployed callables execute against the Functions and Firestore emulators', async () => {
  await seedEvent();
  const created = await callFunction('submitTournamentPreRegistration', payload({ requestId: 'callable-request' }));
  assert.match(created.registrationId, /^reg_/);
  assert.equal(created.managementToken.length, 43);
  assert.equal(created.schemaVersion, 2);
  assert.equal(created.status, 'active');

  const found = await callFunction('manageTournamentPreRegistration', {
    action: 'get',
    calendarEventId: 'event-1',
    registrationId: created.registrationId,
    managementToken: created.managementToken,
  });
  assert.equal(found.registrationId, created.registrationId);
  assert.equal(found.playerName, 'Player');
  assert.equal(Object.hasOwn(found, 'tokenHash'), false);
});

integrationTest('same requestId with a different payload is rejected without another entry', async () => {
  await seedEvent();
  await service.submit(payload(), '192.0.2.2');
  await assert.rejects(service.submit(payload({ playerName: 'Changed' }), '192.0.2.2'), /REQUEST_ID_PAYLOAD_MISMATCH/);
  assert.equal((await db.collection(`${PRIVATE_ROOT}/event-1/entries`).get()).size, 1);
});

integrationTest('closed, expired, ended, and full events reject new entries', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 1, enabled: false, capacity: 8, deadline: null } });
  await assert.rejects(service.submit(payload(), '192.0.2.3'), /PRE_REGISTRATION_CLOSED/);
  await seedEvent({ preRegistration: { schemaVersion: 1, enabled: true, capacity: 8, deadline: Timestamp.fromMillis(clock - 1) } });
  await assert.rejects(service.submit(payload({ requestId: 'request-2' }), '192.0.2.3'), /PRE_REGISTRATION_DEADLINE_PASSED/);
  await seedEvent({ date: '2029-01-01', preRegistration: { schemaVersion: 1, enabled: true, capacity: 8, deadline: null } });
  await assert.rejects(service.submit(payload({ requestId: 'request-3' }), '192.0.2.3'), /EVENT_ENDED/);
});

const identityHash = (identity) => hmac(SECRET, 'identity', `event-1:${identity}`);

integrationTest('full race returns structured consent details without mutating registration state', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 1, deadline: null } });
  await service.submit(payload({ requestId: 'full-seat', officialId: '', playerName: 'Seat' }), '192.0.2.103');
  const racePayload = payload({ requestId: 'full-race', officialId: '', playerName: 'Race' });
  await assert.rejects(
    service.submit(racePayload, '192.0.2.104'),
    (error) => {
      assert.equal(error.code, 'PRE_REGISTRATION_FULL');
      assert.deepEqual(error.publicDetails, {
        code: 'PRE_REGISTRATION_FULL', waitlistAvailable: true,
      });
      return true;
    },
  );
  const operationId = hmac(SECRET, 'operation-id', racePayload.requestId);
  assert.equal((await db.doc(`${PRIVATE_ROOT}/event-1/operations/${operationId}`).get()).exists, false);
  assert.equal((await db.collection(`${PRIVATE_ROOT}/event-1/entries`).get()).size, 1);
  let aggregate = (await db.doc(`${PRIVATE_ROOT}/event-1`).get()).data();
  assert.deepEqual(
    { activeCount: aggregate.activeCount, waitlistedCount: aggregate.waitlistedCount, nextWaitlistSequence: aggregate.nextWaitlistSequence },
    { activeCount: 1, waitlistedCount: 0, nextWaitlistSequence: 1 },
  );

  const consented = await service.submit({ ...racePayload, allowWaitlist: true }, '192.0.2.104');
  assert.equal(consented.status, 'waitlisted');
  aggregate = (await db.doc(`${PRIVATE_ROOT}/event-1`).get()).data();
  assert.deepEqual(
    { activeCount: aggregate.activeCount, waitlistedCount: aggregate.waitlistedCount, nextWaitlistSequence: aggregate.nextWaitlistSequence },
    { activeCount: 1, waitlistedCount: 1, nextWaitlistSequence: 2 },
  );

  await db.doc(`${EVENT_ROOT}/event-1`).update({ 'preRegistration.waitlistEnabled': false });
  await assert.rejects(
    service.submit(payload({ requestId: 'full-no-waitlist', officialId: '', playerName: 'No waitlist' }), '192.0.2.105'),
    (error) => {
      assert.deepEqual(error.publicDetails, {
        code: 'PRE_REGISTRATION_FULL', waitlistAvailable: false,
      });
      return true;
    },
  );
});

integrationTest('deployed callable exposes only safe structured full details', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 1, deadline: null } });
  await service.submit(payload({ requestId: 'callable-full-seat', officialId: '', playerName: 'Seat' }), '192.0.2.106');
  const { response, body } = await callFunctionEnvelope(
    'submitTournamentPreRegistration',
    payload({ requestId: 'callable-full-race', officialId: '', playerName: 'Race' }),
  );
  assert.equal(response.ok, false);
  assert.equal(body.error.message, 'PRE_REGISTRATION_FULL');
  assert.deepEqual(body.error.details, {
    code: 'PRE_REGISTRATION_FULL', waitlistAvailable: true,
  });
  assert.deepEqual(Object.keys(body.error.details).sort(), ['code', 'waitlistAvailable']);
});

integrationTest('C1 last active seat grants exactly one normal registration', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 1, enabled: true, capacity: 1, deadline: null } });
  const results = await Promise.allSettled([
    service.submit(payload({ requestId: 'parallel-1', officialId: '' }), '192.0.2.4'),
    service.submit(payload({ requestId: 'parallel-2', officialId: '', playerName: 'Other' }), '192.0.2.5'),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal((await db.collection(`${PRIVATE_ROOT}/event-1/entries`).where('status', '==', 'active').get()).size, 1);
});

integrationTest('legacy request replay keeps its v1 fingerprint when allowWaitlist is omitted or false', async () => {
  await seedEvent();
  const legacyPayload = payload({ requestId: 'legacy-replay' });
  const fingerprint = hmac(SECRET, 'payload-fingerprint', stableJson(legacyPayload));
  const operationId = hmac(SECRET, 'operation-id', legacyPayload.requestId);
  const credentials = deterministicCredentials(SECRET, legacyPayload.requestId, fingerprint);
  await db.doc(`${PRIVATE_ROOT}/event-1/operations/${operationId}`).set({
    schemaVersion: 1,
    fingerprint,
    registrationId: credentials.registrationId,
    createdAt: Timestamp.fromMillis(clock - 1),
  });
  const replay = await service.submit(legacyPayload, '192.0.2.102');
  assert.equal(replay.registrationId, credentials.registrationId);
  assert.equal(replay.status, 'active');
  assert.equal(replay.replayed, true);
  const explicitFalse = await service.submit({ ...legacyPayload, allowWaitlist: false }, '192.0.2.102');
  assert.equal(explicitFalse.registrationId, credentials.registrationId);
  assert.equal(explicitFalse.replayed, true);
});

integrationTest('C2 last seat with explicit waitlist opt-in creates one active and one waitlisted entry', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 1, deadline: null } });
  const results = await Promise.all([
    service.submit(payload({ requestId: 'c2-a', officialId: '', playerName: 'A', allowWaitlist: true }), '192.0.2.70'),
    service.submit(payload({ requestId: 'c2-b', officialId: '', playerName: 'B', allowWaitlist: true }), '192.0.2.71'),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ['active', 'waitlisted']);
  assert.equal((await db.collection(`${PRIVATE_ROOT}/event-1/entries`).where('status', '==', 'active').get()).size, 1);
  assert.equal((await db.collection(`${PRIVATE_ROOT}/event-1/entries`).where('status', '==', 'waitlisted').get()).size, 1);
});

integrationTest('C3 concurrent waitlist joins receive unique monotonic server sequences', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 1, deadline: null } });
  await service.submit(payload({ requestId: 'c3-seat', officialId: '', playerName: 'Seat' }), '192.0.2.72');
  const results = await Promise.all([
    service.submit(payload({ requestId: 'c3-a', officialId: '', playerName: 'Wait A', allowWaitlist: true }), '192.0.2.73'),
    service.submit(payload({ requestId: 'c3-b', officialId: '', playerName: 'Wait B', allowWaitlist: true }), '192.0.2.74'),
  ]);
  assert.ok(results.every((result) => result.status === 'waitlisted'));
  const replay = await service.submit(payload({ requestId: 'c3-a', officialId: '', playerName: 'Wait A', allowWaitlist: true }), '192.0.2.73');
  assert.equal(replay.replayed, true);
  assert.equal(replay.status, 'waitlisted');
  const snapshot = await db.collection(`${PRIVATE_ROOT}/event-1/entries`).where('status', '==', 'waitlisted').get();
  assert.deepEqual(snapshot.docs.map((item) => item.data().waitlistSequence).sort((a, b) => a - b), [1, 2]);
  assert.ok(snapshot.docs.every((item) => !Object.hasOwn(item.data(), 'waitlistRank') && !Object.hasOwn(item.data(), 'rank')));
  const aggregate = (await db.doc(`${PRIVATE_ROOT}/event-1`).get()).data();
  assert.equal(aggregate.waitlistedCount, 2);
  assert.equal(aggregate.nextWaitlistSequence, 3);
});

integrationTest('C4 concurrent submissions for one identity create only one live registration', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 1, deadline: null } });
  const attempts = await Promise.allSettled([
    service.submit(payload({ requestId: 'c4-a', playerName: 'Identity A', allowWaitlist: true }), '192.0.2.75'),
    service.submit(payload({ requestId: 'c4-b', playerName: 'Identity B', allowWaitlist: true }), '192.0.2.76'),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  assert.match(attempts.find((attempt) => attempt.status === 'rejected').reason.message, /POSSIBLE_DUPLICATE_REGISTRATION/);
  const entries = await db.collection(`${PRIVATE_ROOT}/event-1/entries`).get();
  assert.equal(entries.docs.filter((item) => ['active', 'waitlisted'].includes(item.data().status)).length, 1);
});

integrationTest('live identity uniqueness spans active and waitlisted entries, then releases on cancellation', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 1, deadline: null } });
  await service.submit(payload({ requestId: 'identity-seat', officialId: 'seat-id', playerName: 'Seat' }), '192.0.2.92');
  const first = await service.submit(payload({ requestId: 'identity-wait-1', officialId: 'wait-id', playerName: 'Wait A', allowWaitlist: true }), '192.0.2.93');
  await assert.rejects(
    service.submit(payload({ requestId: 'identity-wait-2', officialId: 'WAIT-ID', playerName: 'Wait B', allowWaitlist: true }), '192.0.2.94'),
    /POSSIBLE_DUPLICATE_REGISTRATION/,
  );
  await assert.rejects(
    service.submit(payload({ requestId: 'identity-active-duplicate', officialId: 'seat-id', playerName: 'Seat Duplicate', allowWaitlist: true }), '192.0.2.95'),
    /POSSIBLE_DUPLICATE_REGISTRATION/,
  );
  await service.manage({
    action: 'cancel', calendarEventId: 'event-1', registrationId: first.registrationId, managementToken: first.managementToken,
  }, '192.0.2.96');
  const replacement = await service.submit(payload({ requestId: 'identity-wait-3', officialId: 'wait-id', playerName: 'Wait Again', allowWaitlist: true }), '192.0.2.97');
  assert.equal(replacement.status, 'waitlisted');
  assert.equal((await db.doc(`${PRIVATE_ROOT}/event-1/entries/${replacement.registrationId}`).get()).data().waitlistSequence, 2);
});

integrationTest('official and honor duplicates are blocked while player names are not identifiers', async () => {
  await seedEvent();
  await service.submit(payload(), '192.0.2.6');
  await assert.rejects(service.submit(payload({ requestId: 'duplicate-official', playerName: 'Other' }), '192.0.2.7'), /POSSIBLE_DUPLICATE_REGISTRATION/);
  await service.submit(payload({ requestId: 'honor-1', officialId: '', honorId: 'honor-1' }), '192.0.2.8');
  await assert.rejects(service.submit(payload({ requestId: 'honor-2', officialId: '', honorId: ' HONOR-1 ', playerName: 'Other' }), '192.0.2.9'), /POSSIBLE_DUPLICATE_REGISTRATION/);
  await service.submit(payload({ requestId: 'name-only-1', officialId: '', honorId: '', playerName: 'Same' }), '192.0.2.10');
  await service.submit(payload({ requestId: 'name-only-2', officialId: '', honorId: '', playerName: 'Same' }), '192.0.2.11');
});

integrationTest('same Official is blocked even when Honor differs', async () => {
  await seedEvent();
  await service.submit(payload({ requestId: 'official-owner', officialId: 'shared-official', honorId: 'honor-a' }), '192.0.2.110');
  await assert.rejects(
    service.submit(payload({ requestId: 'official-conflict', officialId: ' SHARED-OFFICIAL ', honorId: 'honor-b' }), '192.0.2.111'),
    /POSSIBLE_DUPLICATE_REGISTRATION/,
  );
});

integrationTest('same Honor is blocked even when Official differs', async () => {
  await seedEvent();
  await service.submit(payload({ requestId: 'honor-owner', officialId: 'official-a', honorId: 'shared-honor' }), '192.0.2.112');
  await assert.rejects(
    service.submit(payload({ requestId: 'honor-conflict', officialId: 'official-b', honorId: ' SHARED-HONOR ' }), '192.0.2.113'),
    /POSSIBLE_DUPLICATE_REGISTRATION/,
  );
});

integrationTest('multi-identity locks block active-to-waitlisted and waitlisted-to-waitlisted duplicates', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 1, deadline: null } });
  await service.submit(payload({ requestId: 'multi-active', officialId: 'active-official', honorId: 'active-honor' }), '192.0.2.114');
  await assert.rejects(
    service.submit(payload({ requestId: 'active-official-wait', officialId: 'ACTIVE-OFFICIAL', honorId: 'other-honor', allowWaitlist: true }), '192.0.2.115'),
    /POSSIBLE_DUPLICATE_REGISTRATION/,
  );
  await assert.rejects(
    service.submit(payload({ requestId: 'active-honor-wait', officialId: 'other-official', honorId: 'ACTIVE-HONOR', allowWaitlist: true }), '192.0.2.116'),
    /POSSIBLE_DUPLICATE_REGISTRATION/,
  );
  await service.submit(payload({ requestId: 'wait-owner', officialId: 'wait-official', honorId: 'wait-honor', allowWaitlist: true }), '192.0.2.117');
  await assert.rejects(
    service.submit(payload({ requestId: 'wait-conflict', officialId: 'new-official', honorId: 'WAIT-HONOR', allowWaitlist: true }), '192.0.2.118'),
    /POSSIBLE_DUPLICATE_REGISTRATION/,
  );
});

integrationTest('cancellation releases both Official and Honor locks for reuse', async () => {
  await seedEvent();
  const first = await service.submit(payload({ requestId: 'release-both', officialId: 'release-official', honorId: 'release-honor' }), '192.0.2.119');
  await service.manage({
    action: 'cancel', calendarEventId: 'event-1', registrationId: first.registrationId, managementToken: first.managementToken,
  }, '192.0.2.120');
  const replacement = await service.submit(payload({ requestId: 'reuse-both', officialId: 'RELEASE OFFICIAL', honorId: 'RELEASE HONOR' }), '192.0.2.121');
  assert.equal(replacement.status, 'active');
  const locks = await db.collection(`${PRIVATE_ROOT}/event-1/identities`).get();
  assert.equal(locks.size, 2);
  assert.ok(locks.docs.every((document) => document.data().registrationId === replacement.registrationId));
});

integrationTest('update adding an occupied Honor rolls back the entry and every lock', async () => {
  await seedEvent();
  const first = await service.submit(payload({ requestId: 'update-first', officialId: 'first-official', honorId: '' }), '192.0.2.122');
  const second = await service.submit(payload({ requestId: 'update-second', officialId: 'second-official', honorId: 'occupied-honor' }), '192.0.2.123');
  const base = { calendarEventId: 'event-1', registrationId: first.registrationId, managementToken: first.managementToken };
  await assert.rejects(service.manage({
    action: 'update', ...base, playerName: 'Changed', officialId: 'first-official', deckName: 'Changed', honorId: 'OCCUPIED-HONOR',
  }, '192.0.2.124'), /POSSIBLE_DUPLICATE_REGISTRATION/);
  const entry = (await db.doc(`${PRIVATE_ROOT}/event-1/entries/${first.registrationId}`).get()).data();
  assert.equal(entry.playerName, 'Player');
  assert.equal(entry.honorId, '');
  assert.equal((await db.doc(`${PRIVATE_ROOT}/event-1/identities/${identityHash('honor:OCCUPIED-HONOR')}`).get()).data().registrationId, second.registrationId);
  assert.equal((await db.collection(`${PRIVATE_ROOT}/event-1/identities`).get()).size, 3);
});

integrationTest('update changes Official while retaining the owned Honor lock', async () => {
  await seedEvent();
  const created = await service.submit(payload({ requestId: 'change-official', officialId: 'old-official', honorId: 'keep-honor' }), '192.0.2.125');
  const base = { calendarEventId: 'event-1', registrationId: created.registrationId, managementToken: created.managementToken };
  await service.manage({
    action: 'update', ...base, playerName: 'Player', officialId: 'new-official', deckName: 'Deck', honorId: 'keep-honor',
  }, '192.0.2.126');
  assert.equal((await db.doc(`${PRIVATE_ROOT}/event-1/identities/${identityHash('official:OLD-OFFICIAL')}`).get()).exists, false);
  assert.equal((await db.doc(`${PRIVATE_ROOT}/event-1/identities/${identityHash('official:NEW-OFFICIAL')}`).get()).data().registrationId, created.registrationId);
  assert.equal((await db.doc(`${PRIVATE_ROOT}/event-1/identities/${identityHash('honor:KEEP-HONOR')}`).get()).data().registrationId, created.registrationId);
  const entry = (await db.doc(`${PRIVATE_ROOT}/event-1/entries/${created.registrationId}`).get()).data();
  assert.deepEqual(new Set(entry.identityHashes), new Set([
    identityHash('official:NEW-OFFICIAL'), identityHash('honor:KEEP-HONOR'),
  ]));
});

integrationTest('legacy primary-only entry blocks secondary Honor duplicates and can cancel safely', async () => {
  await seedEvent();
  const registrationId = 'reg-legacy-identities';
  const managementToken = 'L'.repeat(43);
  const officialHash = identityHash('official:LEGACY-OFFICIAL');
  await db.doc(`${PRIVATE_ROOT}/event-1`).set({ schemaVersion: 1, activeCount: 1 });
  await db.doc(`${PRIVATE_ROOT}/event-1/entries/${registrationId}`).set({
    schemaVersion: 1,
    registrationId,
    calendarEventId: 'event-1',
    playerName: 'Legacy',
    officialId: 'legacy-official',
    honorId: 'legacy-honor',
    deckName: '',
    status: 'active',
    tokenHash: hashManagementToken(SECRET, managementToken),
    identityHash: officialHash,
    createdAt: Timestamp.fromMillis(clock - 2),
    updatedAt: Timestamp.fromMillis(clock - 1),
  });
  await db.doc(`${PRIVATE_ROOT}/event-1/identities/${officialHash}`).set({
    schemaVersion: 1, registrationId, status: 'active', updatedAt: Timestamp.fromMillis(clock - 1),
  });
  await assert.rejects(
    service.submit(payload({ requestId: 'legacy-secondary-conflict', officialId: 'new-official', honorId: ' LEGACY-HONOR ' }), '192.0.2.127'),
    /POSSIBLE_DUPLICATE_REGISTRATION/,
  );
  const cancelled = await service.manage({
    action: 'cancel', calendarEventId: 'event-1', registrationId, managementToken,
  }, '192.0.2.128');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal((await db.doc(`${PRIVATE_ROOT}/event-1/identities/${officialHash}`).get()).exists, false);
});

integrationTest('exact replay creates no additional Official or Honor lock', async () => {
  await seedEvent();
  const request = payload({ requestId: 'identity-replay', officialId: 'replay-official', honorId: 'replay-honor' });
  const first = await service.submit(request, '192.0.2.129');
  const replay = await service.submit(request, '192.0.2.129');
  assert.equal(replay.registrationId, first.registrationId);
  assert.equal(replay.replayed, true);
  const locks = await db.collection(`${PRIVATE_ROOT}/event-1/identities`).get();
  assert.equal(locks.size, 2);
  assert.ok(locks.docs.every((document) => document.data().registrationId === first.registrationId));
});

integrationTest('correct token can get and update only customer fields; incorrect token is ambiguous', async () => {
  await seedEvent();
  const created = await service.submit(payload(), '192.0.2.12');
  const base = { calendarEventId: 'event-1', registrationId: created.registrationId, managementToken: created.managementToken };
  const found = await service.manage({ action: 'get', ...base }, '192.0.2.13');
  assert.equal(found.playerName, 'Player');
  assert.equal(Object.hasOwn(found, 'tokenHash'), false);
  const updated = await service.manage({ action: 'update', ...base, playerName: 'Updated', officialId: 'official-2', deckName: '', honorId: '' }, '192.0.2.13');
  assert.equal(updated.playerName, 'Updated');
  await assert.rejects(service.manage({ action: 'get', ...base, managementToken: 'x'.repeat(43) }, '192.0.2.13'), /REGISTRATION_NOT_FOUND/);
  await assert.rejects(service.manage({ action: 'get', ...base, registrationId: 'reg_missing' }, '192.0.2.13'), /REGISTRATION_NOT_FOUND/);
});

integrationTest('cancel is idempotent, releases capacity, and preserves the entry', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 1, enabled: true, capacity: 1, deadline: null } });
  const created = await service.submit(payload(), '192.0.2.14');
  const base = { calendarEventId: 'event-1', registrationId: created.registrationId, managementToken: created.managementToken };
  assert.equal((await service.manage({ action: 'cancel', ...base }, '192.0.2.15')).status, 'cancelled');
  assert.equal((await service.manage({ action: 'cancel', ...base }, '192.0.2.15')).status, 'cancelled');
  const replacement = await service.submit(payload({ requestId: 'replacement' }), '192.0.2.16');
  assert.notEqual(replacement.registrationId, created.registrationId);
  assert.equal((await db.collection(`${PRIVATE_ROOT}/event-1/entries`).get()).size, 2);
});

integrationTest('allowWaitlist still allocates an active seat when one is available at transaction time', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 1, deadline: null } });
  const created = await service.submit(payload({ requestId: 'seat-open', allowWaitlist: true }), '192.0.2.77');
  assert.equal(created.status, 'active');
  assert.equal(created.waitlistRank, null);
});

integrationTest('full legacy or waitlist-disabled events require explicit enabled waitlist authority', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 1, enabled: true, capacity: 1, deadline: null } });
  await service.submit(payload({ requestId: 'legacy-seat', officialId: '', playerName: 'Seat' }), '192.0.2.78');
  await assert.rejects(
    service.submit(payload({ requestId: 'legacy-full', officialId: '', playerName: 'Wait', allowWaitlist: true }), '192.0.2.79'),
    /PRE_REGISTRATION_FULL/,
  );
});

integrationTest('waitlisted management returns server rank, excludes cancelled entries, and permits edit', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 1, deadline: null } });
  await service.submit(payload({ requestId: 'rank-seat', officialId: '', playerName: 'Seat' }), '192.0.2.80');
  const first = await service.submit(payload({ requestId: 'rank-first', officialId: '', playerName: 'First', allowWaitlist: true }), '192.0.2.81');
  const second = await service.submit(payload({ requestId: 'rank-second', officialId: '', playerName: 'Second', allowWaitlist: true }), '192.0.2.82');
  const firstBase = { calendarEventId: 'event-1', registrationId: first.registrationId, managementToken: first.managementToken };
  const secondBase = { calendarEventId: 'event-1', registrationId: second.registrationId, managementToken: second.managementToken };
  assert.equal((await service.manage({ action: 'get', ...secondBase }, '192.0.2.83')).waitlistRank, 2);
  const updated = await service.manage({ action: 'update', ...secondBase, playerName: 'Second Updated', officialId: '', deckName: '', honorId: '' }, '192.0.2.83');
  assert.equal(updated.status, 'waitlisted');
  assert.equal(updated.waitlistRank, 2);
  await service.manage({ action: 'cancel', ...firstBase }, '192.0.2.84');
  assert.equal((await service.manage({ action: 'get', ...secondBase }, '192.0.2.83')).waitlistRank, 1);
  assert.equal((await db.doc(`${PRIVATE_ROOT}/event-1/entries/${second.registrationId}`).get()).data().waitlistSequence, 2);
});

integrationTest('normal waitlist rank remains canonical for positions 1, 2, and 3', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 1, deadline: null } });
  await service.submit(payload({ requestId: 'rank3-seat', officialId: '', playerName: 'Seat' }), '192.0.2.130');
  const waiting = [];
  for (let index = 1; index <= 3; index += 1) {
    waiting.push(await service.submit(payload({
      requestId: `rank3-${index}`, officialId: '', playerName: `Wait ${index}`, allowWaitlist: true,
    }), `192.0.2.${130 + index}`));
  }
  for (let index = 0; index < waiting.length; index += 1) {
    const item = waiting[index];
    const found = await service.manage({
      action: 'get', calendarEventId: 'event-1', registrationId: item.registrationId, managementToken: item.managementToken,
    }, `192.0.2.${140 + index}`);
    assert.equal(found.waitlistRankState, 'available');
    assert.equal(found.waitlistRank, index + 1);
  }
});

integrationTest('malformed waitlist sequence never crashes another or its own manage response', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 1, deadline: null } });
  await service.submit(payload({ requestId: 'rank-broken-seat', officialId: '', playerName: 'Seat' }), '192.0.2.144');
  const broken = await service.submit(payload({ requestId: 'rank-broken', officialId: '', playerName: 'Broken', allowWaitlist: true }), '192.0.2.145');
  const healthy = await service.submit(payload({ requestId: 'rank-healthy', officialId: '', playerName: 'Healthy', allowWaitlist: true }), '192.0.2.146');
  await db.doc(`${PRIVATE_ROOT}/event-1/entries/${broken.registrationId}`).update({ waitlistSequence: null });
  for (const [item, ip] of [[healthy, '192.0.2.147'], [broken, '192.0.2.148']]) {
    const found = await service.manage({
      action: 'get', calendarEventId: 'event-1', registrationId: item.registrationId, managementToken: item.managementToken,
    }, ip);
    assert.equal(found.status, 'waitlisted');
    assert.equal(found.waitlistRank, null);
    assert.equal(found.waitlistRankState, 'unavailable');
  }
});

integrationTest('duplicate live waitlist sequence returns unavailable instead of guessing rank', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 1, deadline: null } });
  await service.submit(payload({ requestId: 'rank-dup-seat', officialId: '', playerName: 'Seat' }), '192.0.2.149');
  const first = await service.submit(payload({ requestId: 'rank-dup-first', officialId: '', playerName: 'First', allowWaitlist: true }), '192.0.2.150');
  const second = await service.submit(payload({ requestId: 'rank-dup-second', officialId: '', playerName: 'Second', allowWaitlist: true }), '192.0.2.151');
  await db.doc(`${PRIVATE_ROOT}/event-1/entries/${first.registrationId}`).update({ waitlistSequence: 2 });
  const found = await service.manage({
    action: 'get', calendarEventId: 'event-1', registrationId: second.registrationId, managementToken: second.managementToken,
  }, '192.0.2.152');
  assert.equal(found.status, 'waitlisted');
  assert.equal(found.waitlistRank, null);
  assert.equal(found.waitlistRankState, 'unavailable');
});

integrationTest('active cancellation never auto-promotes an existing waitlisted entry', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 1, deadline: null } });
  const active = await service.submit(payload({ requestId: 'no-promote-seat', officialId: '', playerName: 'Seat' }), '192.0.2.85');
  const waiting = await service.submit(payload({ requestId: 'no-promote-wait', officialId: '', playerName: 'Wait', allowWaitlist: true }), '192.0.2.86');
  await service.manage({
    action: 'cancel', calendarEventId: 'event-1', registrationId: active.registrationId, managementToken: active.managementToken,
  }, '192.0.2.87');
  assert.equal((await db.doc(`${PRIVATE_ROOT}/event-1/entries/${waiting.registrationId}`).get()).data().status, 'waitlisted');
  const stats = (await db.doc('artifacts/kaijuzaocard-main/public/data/tournamentPreRegistrationStats/event-1').get()).data();
  assert.deepEqual({ activeCount: stats.activeCount, waitlistedCount: stats.waitlistedCount }, { activeCount: 0, waitlistedCount: 1 });
});

integrationTest('C5 concurrent waitlisted cancellation and submit preserves count and never reuses sequence', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 1, deadline: null } });
  await service.submit(payload({ requestId: 'c5-seat', officialId: '', playerName: 'Seat' }), '192.0.2.88');
  const waiting = await service.submit(payload({ requestId: 'c5-wait', officialId: '', playerName: 'Old Wait', allowWaitlist: true }), '192.0.2.89');
  const cancelPayload = {
    action: 'cancel', calendarEventId: 'event-1', registrationId: waiting.registrationId, managementToken: waiting.managementToken,
  };
  const [, replacement] = await Promise.all([
    service.manage(cancelPayload, '192.0.2.90'),
    service.submit(payload({ requestId: 'c5-new', officialId: '', playerName: 'New Wait', allowWaitlist: true }), '192.0.2.91'),
  ]);
  assert.equal(replacement.status, 'waitlisted');
  const oldEntry = (await db.doc(`${PRIVATE_ROOT}/event-1/entries/${waiting.registrationId}`).get()).data();
  const newEntry = (await db.doc(`${PRIVATE_ROOT}/event-1/entries/${replacement.registrationId}`).get()).data();
  assert.equal(oldEntry.status, 'cancelled');
  assert.equal(oldEntry.waitlistSequence, 1);
  assert.equal(newEntry.waitlistSequence, 2);
  const aggregate = (await db.doc(`${PRIVATE_ROOT}/event-1`).get()).data();
  assert.deepEqual(
    { activeCount: aggregate.activeCount, waitlistedCount: aggregate.waitlistedCount, nextWaitlistSequence: aggregate.nextWaitlistSequence },
    { activeCount: 1, waitlistedCount: 1, nextWaitlistSequence: 3 },
  );
});

integrationTest('closing or passing the deadline keeps get available, blocks update, and allows pre-start cancel', async () => {
  await seedEvent();
  const created = await service.submit(payload(), '192.0.2.30');
  const base = { calendarEventId: 'event-1', registrationId: created.registrationId, managementToken: created.managementToken };
  await db.doc(`${EVENT_ROOT}/event-1`).update({ 'preRegistration.enabled': false });
  const closed = await service.manage({ action: 'get', ...base }, '192.0.2.31');
  assert.equal(closed.managementState, 'closed');
  assert.equal(closed.canUpdate, false);
  assert.equal(closed.canCancel, true);
  await assert.rejects(service.manage({ action: 'update', ...base, playerName: 'No', officialId: 'official-1', deckName: '', honorId: '' }, '192.0.2.31'), /REGISTRATION_UPDATE_CLOSED/);
  await db.doc(`${EVENT_ROOT}/event-1`).update({ 'preRegistration.enabled': true, 'preRegistration.deadline': Timestamp.fromMillis(clock - 1) });
  const deadline = await service.manage({ action: 'get', ...base }, '192.0.2.31');
  assert.equal(deadline.managementState, 'deadline_passed');
  assert.equal((await service.manage({ action: 'cancel', ...base }, '192.0.2.31')).status, 'cancelled');
});

integrationTest('started events are read-only and deleted events reveal no orphan entry', async () => {
  await seedEvent();
  const created = await service.submit(payload(), '192.0.2.32');
  const base = { calendarEventId: 'event-1', registrationId: created.registrationId, managementToken: created.managementToken };
  clock = Date.parse('2030-08-01T19:01:00+08:00');
  const started = await service.manage({ action: 'get', ...base }, '192.0.2.33');
  assert.equal(started.managementState, 'event_started');
  assert.equal(started.canUpdate, false);
  assert.equal(started.canCancel, false);
  await assert.rejects(service.manage({ action: 'cancel', ...base }, '192.0.2.33'), /REGISTRATION_CANCELLATION_CLOSED/);
  await db.doc(`${EVENT_ROOT}/event-1`).delete();
  await assert.rejects(service.manage({ action: 'get', ...base }, '192.0.2.33'), /EVENT_UNAVAILABLE/);
  assert.equal((await db.doc(`${PRIVATE_ROOT}/event-1/entries/${created.registrationId}`).get()).exists, true);
});

integrationTest('lowering capacity below active count preserves entries and only blocks new submit', async () => {
  await seedEvent();
  const first = await service.submit(payload({ requestId: 'capacity-1', officialId: '' }), '192.0.2.34');
  const second = await service.submit(payload({ requestId: 'capacity-2', officialId: '', playerName: 'Second' }), '192.0.2.35');
  await db.doc(`${EVENT_ROOT}/event-1`).update({ 'preRegistration.capacity': 1 });
  await assert.rejects(service.submit(payload({ requestId: 'capacity-3', officialId: '', playerName: 'Third' }), '192.0.2.36'), /PRE_REGISTRATION_FULL/);
  assert.equal((await db.doc(`${PRIVATE_ROOT}/event-1/entries/${first.registrationId}`).get()).data().status, 'active');
  assert.equal((await db.doc(`${PRIVATE_ROOT}/event-1/entries/${second.registrationId}`).get()).data().status, 'active');
});

integrationTest('C6 concurrent capacity adjustment and submit serialize against event authority', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 2, deadline: null } });
  await service.submit(payload({ requestId: 'c6-seat', officialId: '', playerName: 'Seat' }), '192.0.2.98');
  const [created] = await Promise.all([
    service.submit(payload({ requestId: 'c6-race', officialId: '', playerName: 'Racer', allowWaitlist: true }), '192.0.2.99'),
    db.doc(`${EVENT_ROOT}/event-1`).update({ 'preRegistration.capacity': 1 }),
  ]);
  const activeCount = (await db.collection(`${PRIVATE_ROOT}/event-1/entries`).where('status', '==', 'active').get()).size;
  const waitlistedCount = (await db.collection(`${PRIVATE_ROOT}/event-1/entries`).where('status', '==', 'waitlisted').get()).size;
  assert.equal((await db.doc(`${EVENT_ROOT}/event-1`).get()).data().preRegistration.capacity, 1);
  if (created.status === 'active') {
    assert.deepEqual({ activeCount, waitlistedCount }, { activeCount: 2, waitlistedCount: 0 });
  } else {
    assert.equal(created.status, 'waitlisted');
    assert.deepEqual({ activeCount, waitlistedCount }, { activeCount: 1, waitlistedCount: 1 });
  }
});

integrationTest('C7 legacy aggregate and explicit zero stats converge without count drift', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 1, enabled: true, capacity: 1, deadline: null } });
  await db.doc(`${PRIVATE_ROOT}/event-1`).set({ schemaVersion: 1, activeCount: 0 });
  const statsReference = db.doc('artifacts/kaijuzaocard-main/public/data/tournamentPreRegistrationStats/event-1');
  await statsReference.set({ schemaVersion: 1, activeCount: 0, waitlistedCount: 0 });
  const created = await service.submit(payload({ requestId: 'c7-submit' }), '192.0.2.100');
  let aggregate = (await db.doc(`${PRIVATE_ROOT}/event-1`).get()).data();
  let stats = (await statsReference.get()).data();
  assert.deepEqual(
    { activeCount: aggregate.activeCount, waitlistedCount: aggregate.waitlistedCount, nextWaitlistSequence: aggregate.nextWaitlistSequence },
    { activeCount: 1, waitlistedCount: 0, nextWaitlistSequence: 1 },
  );
  assert.deepEqual({ activeCount: stats.activeCount, waitlistedCount: stats.waitlistedCount }, { activeCount: 1, waitlistedCount: 0 });
  await service.manage({
    action: 'cancel', calendarEventId: 'event-1', registrationId: created.registrationId, managementToken: created.managementToken,
  }, '192.0.2.101');
  aggregate = (await db.doc(`${PRIVATE_ROOT}/event-1`).get()).data();
  stats = (await statsReference.get()).data();
  assert.deepEqual({ activeCount: aggregate.activeCount, waitlistedCount: aggregate.waitlistedCount }, { activeCount: 0, waitlistedCount: 0 });
  assert.deepEqual({ activeCount: stats.activeCount, waitlistedCount: stats.waitlistedCount }, { activeCount: 0, waitlistedCount: 0 });
});

integrationTest('IP rate limit counts failed management lookups', async () => {
  await seedEvent();
  const request = { action: 'get', calendarEventId: 'event-1', registrationId: 'reg-missing', managementToken: 'x'.repeat(43) };
  for (let index = 0; index < 30; index += 1) {
    await assert.rejects(service.manage(request, '192.0.2.20'), /REGISTRATION_NOT_FOUND/);
  }
  await assert.rejects(service.manage(request, '192.0.2.20'), /RATE_LIMITED/);
});

integrationTest('B2B create is private, deterministic, replayable, and stores no plaintext token', async () => {
  await seedLinkedEventAndEntries();
  const created = await handoffService.create(createHandoffPayload());
  const replay = await handoffService.create(createHandoffPayload());
  assert.equal(replay.handoffId, created.handoffId);
  assert.equal(replay.handoffToken, created.handoffToken);
  assert.equal(replay.replayed, true);
  assert.equal(Buffer.from(created.handoffToken, 'base64url').length, 32);

  const handoff = (await db.doc(`${HANDOFF_ROOT}/${created.handoffId}`).get()).data();
  const serialized = JSON.stringify(handoff);
  assert.equal(serialized.includes(created.handoffToken), false);
  assert.equal(Object.hasOwn(handoff, 'handoffToken'), false);
  assert.equal(handoff.snapshot.length, 2);
  assert.equal(Object.hasOwn(handoff.snapshot[0], 'managementToken'), false);
  const operations = await db.collection(HANDOFF_OPERATION_ROOT).get();
  assert.equal(operations.size, 1);
  assert.equal(operations.docs[0].data().expiresAt.toMillis(), clock + (24 * 60 * 60 * 1000));
  assert.equal(handoff.expiresAt.toMillis(), clock + (10 * 60 * 1000));

  const status = await handoffService.status({ handoffId: created.handoffId, calendarEventId: 'event-1' });
  assert.deepEqual(Object.keys(status).sort(), ['claimedAt', 'completedAt', 'expiresAt', 'importedCount', 'schemaVersion', 'selectedCount', 'status', 'targetSwissTournamentId'].sort());
  assert.equal(status.status, 'ready');
});

integrationTest('B2B request replay rejects a changed selection and entry eligibility fails closed', async () => {
  await seedLinkedEventAndEntries();
  await handoffService.create(createHandoffPayload());
  await assert.rejects(handoffService.create(createHandoffPayload({ selectedRegistrationIds: ['reg-3'] })), /REQUEST_ID_PAYLOAD_MISMATCH/);

  await db.doc(`${PRIVATE_ROOT}/event-1/entries/reg-2`).update({ status: 'cancelled' });
  await assert.rejects(handoffService.create(createHandoffPayload({ requestId: 'handoff-request-2' })), /REGISTRATION_NOT_ACTIVE/);
  await db.doc(`${PRIVATE_ROOT}/event-1/entries/reg-2`).update({ status: 'waitlisted', waitlistSequence: null });
  await assert.rejects(handoffService.create(createHandoffPayload({ requestId: 'handoff-request-waitlisted' })), /REGISTRATION_NOT_ACTIVE/);
  await db.doc(`${PRIVATE_ROOT}/event-1/entries/reg-2`).update({ status: 'active', importedTournamentId: 'tournament-other' });
  await assert.rejects(handoffService.create(createHandoffPayload({ requestId: 'handoff-request-3' })), /REGISTRATION_IMPORT_CONFLICT/);
});

integrationTest('B2B maximum 128-entry snapshot remains bounded below the Firestore document limit', async () => {
  await seedEvent({
    title: 'X'.repeat(120),
    swissIntegration: {
      schemaVersion: 1,
      swissTournamentId: 'tournament-1',
      linkedAt: Timestamp.fromMillis(clock - 1),
    },
  });
  const registrationIds = Array.from({ length: 128 }, (_, index) => `reg-max-${index}`);
  await Promise.all(registrationIds.map((registrationId) => db.doc(`${PRIVATE_ROOT}/event-1/entries/${registrationId}`).set({
    schemaVersion: 1,
    registrationId,
    calendarEventId: 'event-1',
    status: 'active',
    playerName: '玩'.repeat(40),
    officialId: 'O'.repeat(40),
    deckName: 'D'.repeat(80),
    honorId: 'H'.repeat(40),
    createdAt: Timestamp.fromMillis(clock - 10),
    updatedAt: Timestamp.fromMillis(clock - 5),
  })));
  const created = await handoffService.create({
    requestId: 'handoff-request-max', calendarEventId: 'event-1', selectedRegistrationIds: registrationIds,
  });
  const document = (await db.doc(`${HANDOFF_ROOT}/${created.handoffId}`).get()).data();
  assert.equal(document.snapshot.length, 128);
  assert.ok(Buffer.byteLength(JSON.stringify(document), 'utf8') < 900_000);
});

integrationTest('B2B callable HTTP boundary enforces exact CORS and strict callable envelopes', async () => {
  await seedLinkedEventAndEntries();
  const created = await handoffService.create(createHandoffPayload());
  const allowedOrigin = 'http://127.0.0.1:4173';
  const preflight = await callHandoffHttp({ method: 'OPTIONS', origin: allowedOrigin });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.equal((await callHandoffHttp({ method: 'OPTIONS', origin: 'https://forged.example.test' })).status, 403);
  assert.equal((await callHandoffHttp({ method: 'OPTIONS' })).status, 403);

  const malformed = await callHandoffHttp({ origin: allowedOrigin, body: { wrong: {} } });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: { status: 'FAILED_PRECONDITION', message: 'INVALID_CALLABLE_REQUEST' } });

  const claimPayload = {
    action: 'claim', handoffId: created.handoffId, handoffToken: created.handoffToken, claimId: 'http-claim',
  };
  const claimed = await callHandoffHttp({ origin: allowedOrigin, body: { data: claimPayload } });
  assert.equal(claimed.status, 200);
  assert.equal((await claimed.json()).data.handoffId, created.handoffId);

  const invalidToken = await callHandoffHttp({
    origin: allowedOrigin,
    body: { data: { ...claimPayload, handoffToken: 'y'.repeat(43) } },
  });
  const invalidTokenBody = await invalidToken.json();
  assert.equal(invalidToken.status, 404);
  assert.equal(invalidTokenBody.error.message, 'HANDOFF_NOT_FOUND');
  assert.equal(JSON.stringify(invalidTokenBody).includes(created.handoffToken), false);
  assert.equal(JSON.stringify(invalidTokenBody).includes('http-claim'), false);
});

integrationTest('B2B claim lease, exact origin, release, and expiry are enforced', async () => {
  await seedLinkedEventAndEntries();
  const created = await handoffService.create(createHandoffPayload());
  const claimPayload = { action: 'claim', handoffId: created.handoffId, handoffToken: created.handoffToken, claimId: 'claim-1' };
  await assert.rejects(handoffService.manage(claimPayload, '192.0.2.40', 'https://other.example.test'), /ORIGIN_NOT_ALLOWED/);
  const claim = await handoffService.manage(claimPayload, '192.0.2.40', 'https://swiss.example.test');
  assert.equal(claim.targetSwissTournamentId, 'tournament-1');
  assert.equal((await handoffService.manage(claimPayload, '192.0.2.40', 'https://swiss.example.test')).handoffId, created.handoffId);
  await assert.rejects(handoffService.manage({ ...claimPayload, claimId: 'claim-2' }, '192.0.2.41', 'https://swiss.example.test'), /HANDOFF_ALREADY_CLAIMED/);
  assert.equal((await handoffService.manage({ action: 'release', handoffId: created.handoffId, handoffToken: created.handoffToken, claimId: 'claim-1' }, '192.0.2.40', 'https://swiss.example.test')).status, 'ready');

  clock += 11 * 60 * 1000;
  await assert.rejects(handoffService.manage({ ...claimPayload, claimId: 'claim-3' }, '192.0.2.42', 'https://swiss.example.test'), /HANDOFF_NOT_FOUND/);
  assert.ok((await db.collection(HANDOFF_RATE_ROOT).get()).size > 0);
});

integrationTest('B2B concurrent claim race grants one lease and rejects the other claimant', async () => {
  await seedLinkedEventAndEntries();
  const created = await handoffService.create(createHandoffPayload());
  const attempts = await Promise.allSettled(['claim-race-a', 'claim-race-b'].map((claimId, index) => (
    handoffService.manage({
      action: 'claim', handoffId: created.handoffId, handoffToken: created.handoffToken, claimId,
    }, `192.0.2.${60 + index}`, 'https://swiss.example.test')
  )));
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === 'rejected').length, 1);
  assert.match(attempts.find((attempt) => attempt.status === 'rejected').reason.message, /HANDOFF_ALREADY_CLAIMED/);
});

integrationTest('B2B expired claim leases may be safely reacquired but cannot complete stale claims', async () => {
  await seedLinkedEventAndEntries();
  const created = await handoffService.create(createHandoffPayload());
  await handoffService.manage({ action: 'claim', handoffId: created.handoffId, handoffToken: created.handoffToken, claimId: 'claim-old' }, '192.0.2.45', 'https://swiss.example.test');
  clock += 6 * 60 * 1000;
  await assert.rejects(handoffService.manage({
    action: 'complete', handoffId: created.handoffId, handoffToken: created.handoffToken, claimId: 'claim-old',
    targetSwissTournamentId: 'tournament-1', newlyImportedRegistrationIds: ['reg-1'], reconciledRegistrationIds: [],
  }, '192.0.2.45', 'https://swiss.example.test'), /CLAIM_EXPIRED/);
  const takeover = await handoffService.manage({ action: 'claim', handoffId: created.handoffId, handoffToken: created.handoffToken, claimId: 'claim-new' }, '192.0.2.46', 'https://swiss.example.test');
  assert.equal(takeover.handoffId, created.handoffId);
});

integrationTest('B2B complete marks only the imported subset and is exactly-once replayable', async () => {
  await seedLinkedEventAndEntries();
  const created = await handoffService.create(createHandoffPayload());
  const claimId = 'claim-complete';
  await handoffService.manage({ action: 'claim', handoffId: created.handoffId, handoffToken: created.handoffToken, claimId }, '192.0.2.50', 'https://swiss.example.test');
  const complete = {
    action: 'complete',
    handoffId: created.handoffId,
    handoffToken: created.handoffToken,
    claimId,
    targetSwissTournamentId: 'tournament-1',
    newlyImportedRegistrationIds: ['reg-1'],
    reconciledRegistrationIds: [],
  };
  await assert.rejects(handoffService.manage({ ...complete, targetSwissTournamentId: 'tournament-other' }, '192.0.2.50', 'https://swiss.example.test'), /TARGET_TOURNAMENT_MISMATCH/);
  const first = await handoffService.manage(complete, '192.0.2.50', 'https://swiss.example.test');
  const replay = await handoffService.manage(complete, '192.0.2.50', 'https://swiss.example.test');
  assert.equal(first.importedCount, 1);
  assert.equal(replay.replayed, true);
  assert.equal((await db.doc(`${PRIVATE_ROOT}/event-1/entries/reg-1`).get()).data().importedTournamentId, 'tournament-1');
  assert.equal(Object.hasOwn((await db.doc(`${PRIVATE_ROOT}/event-1/entries/reg-2`).get()).data(), 'importedTournamentId'), false);
  assert.equal((await handoffService.manage({
    action: 'release', handoffId: created.handoffId, handoffToken: created.handoffToken, claimId,
  }, '192.0.2.50', 'https://swiss.example.test')).status, 'completed');
  await assert.rejects(handoffService.manage({
    action: 'claim', handoffId: created.handoffId, handoffToken: created.handoffToken, claimId: 'claim-after-complete',
  }, '192.0.2.50', 'https://swiss.example.test'), /HANDOFF_ALREADY_COMPLETED/);
  await assert.rejects(handoffService.manage({ ...complete, newlyImportedRegistrationIds: ['reg-2'] }, '192.0.2.50', 'https://swiss.example.test'), /COMPLETE_PAYLOAD_MISMATCH/);
});

integrationTest('B2B reconciliation marks existing same-target players without requiring a duplicate Swiss insert', async () => {
  await seedLinkedEventAndEntries();
  const created = await handoffService.create(createHandoffPayload());
  const claimId = 'claim-reconcile';
  const claim = await handoffService.manage({
    action: 'claim', handoffId: created.handoffId, handoffToken: created.handoffToken, claimId,
  }, '192.0.2.51', 'https://swiss.example.test');
  assert.equal(claim.entries[0].entryUpdatedAt, clock - 5);
  assert.equal(claim.snapshotCreatedAt, clock);
  const completed = await handoffService.manage({
    action: 'complete',
    handoffId: created.handoffId,
    handoffToken: created.handoffToken,
    claimId,
    targetSwissTournamentId: 'tournament-1',
    newlyImportedRegistrationIds: [],
    reconciledRegistrationIds: ['reg-1'],
  }, '192.0.2.51', 'https://swiss.example.test');
  assert.equal(completed.importedCount, 1);
  const handoff = (await db.doc(`${HANDOFF_ROOT}/${created.handoffId}`).get()).data();
  assert.equal(handoff.reconciledCount, 1);
  assert.equal(handoff.newlyImportedCount, 0);
  assert.equal(handoff.expiresAt.toMillis(), clock + (24 * 60 * 60 * 1000));
  assert.equal((await db.doc(`${PRIVATE_ROOT}/event-1/entries/reg-1`).get()).data().importedTournamentId, 'tournament-1');
  clock += 23 * 60 * 60 * 1000;
  assert.equal((await handoffService.status({ handoffId: created.handoffId, calendarEventId: 'event-1' })).status, 'completed');
  clock += 2 * 60 * 60 * 1000;
  assert.equal((await handoffService.status({ handoffId: created.handoffId, calendarEventId: 'event-1' })).status, 'expired');
});

integrationTest('B2B completion rejects reconciled IDs outside the exact snapshot or moved to another target', async () => {
  await seedLinkedEventAndEntries();
  const created = await handoffService.create(createHandoffPayload());
  const claimId = 'claim-reconcile-conflict';
  await handoffService.manage({
    action: 'claim', handoffId: created.handoffId, handoffToken: created.handoffToken, claimId,
  }, '192.0.2.52', 'https://swiss.example.test');
  const base = {
    action: 'complete', handoffId: created.handoffId, handoffToken: created.handoffToken, claimId,
    targetSwissTournamentId: 'tournament-1', newlyImportedRegistrationIds: [],
  };
  await assert.rejects(handoffService.manage({ ...base, reconciledRegistrationIds: ['reg-3'] }, '192.0.2.52', 'https://swiss.example.test'), /IMPORTED_REGISTRATION_OUT_OF_SCOPE/);
  await db.doc(`${PRIVATE_ROOT}/event-1/entries/reg-1`).update({ importedTournamentId: 'tournament-other' });
  await assert.rejects(handoffService.manage({ ...base, reconciledRegistrationIds: ['reg-1'] }, '192.0.2.52', 'https://swiss.example.test'), /REGISTRATION_IMPORT_CONFLICT/);
});
