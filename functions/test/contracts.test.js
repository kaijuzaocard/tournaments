import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  ContractError,
  classifyPreRegistrationConfig,
  classifyRegistrationManagementPolicy,
  normalizeIdentity,
  normalizeIdentities,
  publicRegistration,
  validateManagePayload,
  validateSubmitPayload,
} from '../src/contracts.js';
import {
  deterministicCredentials,
  hashManagementToken,
  normalizeTrustedIp,
  stableJson,
  tokensEqual,
} from '../src/security.js';

const SECRET = 'test-only-secret-with-at-least-thirty-two-bytes';
const validSubmit = {
  requestId: 'request-1',
  calendarEventId: 'event-1',
  playerName: ' Player ',
  officialId: ' PTCG 123 ',
  deckName: ' Deck ',
  honorId: '',
};

test('submit contract trims the exact allowlist', () => {
  assert.deepEqual(validateSubmitPayload(validSubmit), {
    ...validSubmit,
    allowWaitlist: false,
    playerName: 'Player',
    officialId: 'PTCG 123',
    deckName: 'Deck',
  });
});

test('waitlist submission is an explicit strict boolean opt-in', () => {
  assert.equal(validateSubmitPayload({ ...validSubmit, allowWaitlist: true }).allowWaitlist, true);
  assert.throws(() => validateSubmitPayload({ ...validSubmit, allowWaitlist: 'true' }), /INVALID_ALLOW_WAITLIST/);
});

test('submit rejects unknown, forged, malformed, and oversized fields', () => {
  for (const field of ['status', 'createdAt', 'importedAt', 'registrationId']) {
    assert.throws(() => validateSubmitPayload({ ...validSubmit, [field]: 'forged' }), ContractError);
  }
  assert.throws(() => validateSubmitPayload({ ...validSubmit, playerName: 'x'.repeat(41) }), /INVALID_PLAYER_NAME/);
  assert.throws(() => validateSubmitPayload({ ...validSubmit, deckName: 'a\nb' }), /INVALID_DECK_NAME/);
});

test('management actions use strict action-specific fields', () => {
  const base = { action: 'get', calendarEventId: 'event-1', registrationId: 'reg-1', managementToken: 'a'.repeat(43) };
  assert.equal(validateManagePayload(base).action, 'get');
  assert.throws(() => validateManagePayload({ ...base, status: 'cancelled' }), /UNKNOWN_OR_MISSING_FIELDS/);
  assert.throws(() => validateManagePayload({ ...base, action: 'update' }), /UNKNOWN_OR_MISSING_FIELDS/);
});

test('identity normalization keeps a legacy primary while exposing every canonical identity', () => {
  assert.equal(normalizeIdentity({ officialId: ' ptcg 123 ', honorId: 'H1', playerName: 'Same' }), 'official:PTCG123');
  assert.deepEqual(
    normalizeIdentities({ officialId: ' ｐｔｃｇ 123 ', honorId: ' h 1 ', playerName: 'Same' }),
    ['official:PTCG123', 'honor:H1'],
  );
  assert.equal(normalizeIdentity({ officialId: '', honorId: ' h 1 ', playerName: 'Same' }), 'honor:H1');
  assert.equal(normalizeIdentity({ officialId: '', honorId: '', playerName: 'Same' }), null);
  assert.deepEqual(normalizeIdentities({ officialId: '', honorId: '', playerName: 'Same' }), []);
});

test('deterministic credentials recover the same 256-bit token without storing plaintext', () => {
  const first = deterministicCredentials(SECRET, 'request-1', 'fingerprint');
  const second = deterministicCredentials(SECRET, 'request-1', 'fingerprint');
  assert.deepEqual(first, second);
  assert.equal(Buffer.from(first.managementToken, 'base64url').length, 32);
  const tokenHash = hashManagementToken(SECRET, first.managementToken);
  assert.notEqual(tokenHash, first.managementToken);
  assert.equal(tokensEqual(tokenHash, hashManagementToken(SECRET, second.managementToken)), true);
  assert.throws(() => deterministicCredentials('weak', 'request-1', 'fingerprint'), /HMAC_SECRET_UNAVAILABLE/);
});

test('the deploy entry preserves B2A callables and exports the three B2B operations', () => {
  const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.match(source, /export const submitTournamentPreRegistration/);
  assert.match(source, /export const manageTournamentPreRegistration/);
  assert.match(source, /export const createTournamentPreRegistrationHandoff/);
  assert.match(source, /export const manageTournamentPreRegistrationHandoff/);
  assert.match(source, /export const getTournamentPreRegistrationHandoffStatus/);
});

test('cross-project manage uses the capability boundary while create and status require Calendar admin', () => {
  const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const createSection = source.slice(
    source.indexOf('export const createTournamentPreRegistrationHandoff'),
    source.indexOf('export const manageTournamentPreRegistrationHandoff'),
  );
  const manageSection = source.slice(
    source.indexOf('export const manageTournamentPreRegistrationHandoff'),
    source.indexOf('export const getTournamentPreRegistrationHandoffStatus'),
  );
  const statusSection = source.slice(source.indexOf('export const getTournamentPreRegistrationHandoffStatus'));
  assert.match(createSection, /requireCalendarAdmin\(request\)/);
  assert.doesNotMatch(manageSection, /requireCalendarAdmin\(request\)/);
  assert.match(manageSection, /onRequest\(handoffHttpOptions/);
  assert.match(manageSection, /applyExactHandoffCors\(request, response\)/);
  assert.match(manageSection, /request\.headers\.origin/);
  assert.match(statusSection, /requireCalendarAdmin\(request\)/);
});

test('stable JSON fingerprint input is key-order independent', () => {
  assert.equal(stableJson({ b: 2, a: 1 }), stableJson({ a: 1, b: 2 }));
});

test('trusted IP normalization handles IPv4, mapped IPv4, and IPv6', () => {
  assert.equal(normalizeTrustedIp('192.0.2.5'), '192.0.2.5');
  assert.equal(normalizeTrustedIp('::ffff:192.0.2.5'), '192.0.2.5');
  assert.equal(normalizeTrustedIp('2001:0db8::1'), '2001:db8::1');
  assert.throws(() => normalizeTrustedIp('198.51.100.1, 203.0.113.1'), /CLIENT_IP_UNAVAILABLE/);
});

test('event registration config is strict and fail closed', () => {
  const timestamp = { toMillis: () => Date.now() + 1000 };
  assert.deepEqual(classifyPreRegistrationConfig({ enabled: true, capacity: 8, deadline: timestamp }), {
    status: 'enabled', capacity: 8, deadline: timestamp, waitlistEnabled: false,
  });
  assert.deepEqual(classifyPreRegistrationConfig({ schemaVersion: 1, enabled: true, capacity: 8, deadline: timestamp }), {
    status: 'enabled', capacity: 8, deadline: timestamp, waitlistEnabled: false,
  });
  assert.equal(classifyPreRegistrationConfig({ schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 8, deadline: timestamp }).waitlistEnabled, true);
  for (const waitlistEnabled of [undefined, null, false, 'true', 1, {}, []]) {
    const config = { schemaVersion: 2, enabled: true, capacity: 8, deadline: timestamp };
    if (waitlistEnabled !== undefined) config.waitlistEnabled = waitlistEnabled;
    const result = classifyPreRegistrationConfig(config);
    assert.equal(result.status, 'enabled');
    assert.equal(result.waitlistEnabled, false);
  }
  assert.equal(classifyPreRegistrationConfig({ schemaVersion: 1, enabled: true, capacity: 257, deadline: null }).status, 'malformed');
  assert.equal(classifyPreRegistrationConfig({ schemaVersion: 1, enabled: true, capacity: '8', deadline: null }).status, 'malformed');
  assert.equal(classifyPreRegistrationConfig({ schemaVersion: 1, enabled: true, capacity: 8, deadline: null, extra: true }).status, 'malformed');
  assert.equal(classifyPreRegistrationConfig({ enabled: true, capacity: 8, deadline: null, extra: true }).status, 'malformed');
  assert.equal(classifyPreRegistrationConfig({ schemaVersion: 3, enabled: true, capacity: 8, deadline: null }).status, 'malformed');
});

test('public management view supports active, waitlisted, and cancelled without persisting rank', () => {
  const base = { registrationId: 'reg-1', playerName: 'P', officialId: '', deckName: '', honorId: '' };
  assert.equal(publicRegistration({ ...base, status: 'active' }).canUpdate, true);
  const waitlisted = publicRegistration(
    { ...base, status: 'waitlisted' },
    undefined,
    { state: 'available', rank: 3 },
  );
  assert.equal(waitlisted.waitlistRank, 3);
  assert.equal(waitlisted.waitlistRankState, 'available');
  assert.equal(waitlisted.canCancel, true);
  const unavailable = publicRegistration({ ...base, status: 'waitlisted' });
  assert.equal(unavailable.waitlistRank, null);
  assert.equal(unavailable.waitlistRankState, 'unavailable');
  const cancelled = publicRegistration({ ...base, status: 'cancelled' });
  assert.equal(cancelled.canUpdate, false);
  assert.equal(cancelled.waitlistRankState, 'not_applicable');
});

test('management lifecycle is read-only after close/deadline/start and cancel stays open until start', () => {
  const now = Date.parse('2030-01-01T00:00:00Z');
  const event = { date: '2030-08-01', time: '19:00', preRegistration: { schemaVersion: 1, enabled: true, capacity: 8, deadline: null } };
  assert.deepEqual(classifyRegistrationManagementPolicy(event, now), { state: 'open', canUpdate: true, canCancel: true });
  assert.deepEqual(classifyRegistrationManagementPolicy({ ...event, preRegistration: { ...event.preRegistration, enabled: false } }, now), { state: 'closed', canUpdate: false, canCancel: true });
  assert.deepEqual(classifyRegistrationManagementPolicy({ ...event, preRegistration: { ...event.preRegistration, deadline: { toMillis: () => now - 1 } } }, now), { state: 'deadline_passed', canUpdate: false, canCancel: true });
  assert.deepEqual(classifyRegistrationManagementPolicy(event, Date.parse('2030-08-01T19:01:00+08:00')), { state: 'event_started', canUpdate: false, canCancel: false });
});
