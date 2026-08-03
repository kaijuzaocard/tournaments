import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { createPreRegistrationService } from '../src/service.js';
import { createTournamentPreRegistrationHandoffService } from '../src/handoffService.js';

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const integrationTest = enabled ? test : test.skip;
const PROJECT_ID = 'demo-kaijuzaocard-calendar-functions';
const SECRET = 'emulator-only-secret-with-at-least-thirty-two-bytes';
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
    secret: SECRET,
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
