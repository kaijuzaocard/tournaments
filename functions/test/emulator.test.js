import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { createPreRegistrationService } from '../src/service.js';

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const integrationTest = enabled ? test : test.skip;
const PROJECT_ID = 'demo-kaijuzaocard-calendar-functions';
const SECRET = 'emulator-only-secret-with-at-least-thirty-two-bytes';
const EVENT_ROOT = 'artifacts/kaijuzaocard-main/public/data/monster_tournaments';
const PRIVATE_ROOT = 'artifacts/kaijuzaocard-main/private/data/tournamentPreRegistrations';
const FUNCTIONS_HOST = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';

let app;
let db;
let clock;
let service;

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

async function callFunction(name, data) {
  const response = await fetch(`http://${FUNCTIONS_HOST}/${PROJECT_ID}/asia-east1/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body.error?.message || `CALLABLE_HTTP_${response.status}`);
  }
  return body.result;
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

integrationTest('concurrent submissions cannot exceed event capacity', async () => {
  await seedEvent({ preRegistration: { schemaVersion: 1, enabled: true, capacity: 1, deadline: null } });
  const results = await Promise.allSettled([
    service.submit(payload({ requestId: 'parallel-1', officialId: '' }), '192.0.2.4'),
    service.submit(payload({ requestId: 'parallel-2', officialId: '', playerName: 'Other' }), '192.0.2.5'),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal((await db.collection(`${PRIVATE_ROOT}/event-1/entries`).where('status', '==', 'active').get()).size, 1);
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

integrationTest('IP rate limit counts failed management lookups', async () => {
  await seedEvent();
  const request = { action: 'get', calendarEventId: 'event-1', registrationId: 'reg-missing', managementToken: 'x'.repeat(43) };
  for (let index = 0; index < 30; index += 1) {
    await assert.rejects(service.manage(request, '192.0.2.20'), /REGISTRATION_NOT_FOUND/);
  }
  await assert.rejects(service.manage(request, '192.0.2.20'), /RATE_LIMITED/);
});
