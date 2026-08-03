import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  HandoffContractError,
  assertAllowedOrigin,
  classifyLinkedSwissIntegration,
  isCalendarAdminAuth,
  parseAdminUids,
  parseExactOriginAllowlist,
  validateCreateHandoffPayload,
  validateManageHandoffPayload,
  validateStatusHandoffPayload,
} from '../src/handoffContracts.js';

const token = 'x'.repeat(43);
const fixture = JSON.parse(fs.readFileSync(new URL('../../contracts/b2b-preregistration-swiss-handoff.v1.json', import.meta.url), 'utf8'));

test('canonical cross-repository fixture uses the exact versioned envelope, snapshot, and completion contract', () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.deepEqual(Object.keys(fixture.fragmentEnvelope).sort(), ['handoffId', 'handoffToken', 'schemaVersion']);
  assert.deepEqual(Object.keys(fixture.claimSnapshot).sort(), [
    'calendarEventId', 'entries', 'eventName', 'expiresAt', 'handoffId', 'handoffRevision',
    'schemaVersion', 'snapshotCreatedAt', 'targetSwissTournamentId',
  ].sort());
  assert.deepEqual(Object.keys(fixture.claimSnapshot.entries[0]).sort(), [
    'deckName', 'entryUpdatedAt', 'honorId', 'officialId', 'playerName', 'registrationId',
  ].sort());
  assert.deepEqual(validateManageHandoffPayload(fixture.completeRequest), fixture.completeRequest);
});

test('create and status payloads use exact field allowlists', () => {
  assert.deepEqual(validateCreateHandoffPayload({ requestId: 'request-1', calendarEventId: 'event-1', selectedRegistrationIds: ['reg-2', 'reg-1'] }), {
    requestId: 'request-1', calendarEventId: 'event-1', selectedRegistrationIds: ['reg-1', 'reg-2'],
  });
  assert.deepEqual(validateStatusHandoffPayload({ handoffId: 'handoff-1', calendarEventId: 'event-1' }), { handoffId: 'handoff-1', calendarEventId: 'event-1' });
  assert.throws(() => validateCreateHandoffPayload({ requestId: 'request-1', calendarEventId: 'event-1', selectedRegistrationIds: ['reg-1'], playerName: 'forged' }), HandoffContractError);
});

test('manage lifecycle payloads reject unknown fields and out-of-snapshot shapes', () => {
  assert.equal(validateManageHandoffPayload({ action: 'claim', handoffId: 'handoff-1', handoffToken: token, claimId: 'claim-1' }).action, 'claim');
  assert.deepEqual(validateManageHandoffPayload({
    action: 'complete',
    handoffId: 'handoff-1',
    handoffToken: token,
    claimId: 'claim-1',
    targetSwissTournamentId: 'tournament-1',
    newlyImportedRegistrationIds: ['reg-1'],
    reconciledRegistrationIds: ['reg-2'],
  }), {
    action: 'complete',
    handoffId: 'handoff-1',
    handoffToken: token,
    claimId: 'claim-1',
    targetSwissTournamentId: 'tournament-1',
    newlyImportedRegistrationIds: ['reg-1'],
    reconciledRegistrationIds: ['reg-2'],
  });
  assert.throws(() => validateManageHandoffPayload({
    action: 'complete', handoffId: 'handoff-1', handoffToken: token, claimId: 'claim-1',
    targetSwissTournamentId: 'tournament-1', newlyImportedRegistrationIds: [], reconciledRegistrationIds: [],
  }), /INVALID_IMPORTED_REGISTRATION_IDS/);
  assert.throws(() => validateManageHandoffPayload({
    action: 'complete', handoffId: 'handoff-1', handoffToken: token, claimId: 'claim-1',
    targetSwissTournamentId: 'tournament-1', newlyImportedRegistrationIds: ['reg-1'], reconciledRegistrationIds: ['reg-1'],
  }), /DUPLICATE_IMPORTED_REGISTRATION_IDS/);
  assert.throws(() => validateManageHandoffPayload({ action: 'claim', handoffId: 'handoff-1', handoffToken: token, claimId: 'claim-1', extra: true }), /UNKNOWN_OR_MISSING_FIELDS/);
});

test('selection rejects duplicates and more than 128 registration IDs', () => {
  assert.throws(() => validateCreateHandoffPayload({ requestId: 'request-1', calendarEventId: 'event-1', selectedRegistrationIds: ['reg-1', 'reg-1'] }), /DUPLICATE_REGISTRATION_IDS/);
  assert.throws(() => validateCreateHandoffPayload({ requestId: 'request-1', calendarEventId: 'event-1', selectedRegistrationIds: Array.from({ length: 129 }, (_, index) => `reg-${index}`) }), /INVALID_REGISTRATION_IDS/);
});

test('origin configuration is exact and rejects wildcard, paths, query, and fragments', () => {
  const allowed = parseExactOriginAllowlist('https://swiss.example.test,http://127.0.0.1:4173');
  assert.equal(assertAllowedOrigin('https://swiss.example.test', allowed), 'https://swiss.example.test');
  for (const value of ['*', 'https://*.example.test', 'https://swiss.example.test/path', 'https://swiss.example.test/?q=1', 'https://swiss.example.test/#x']) {
    assert.throws(() => parseExactOriginAllowlist(value), /INVALID_ORIGIN_CONFIGURATION/);
  }
  assert.throws(() => assertAllowedOrigin('https://other.example.test', allowed), /ORIGIN_NOT_ALLOWED/);
});

test('Calendar admin auth requires an allowlisted Google identity', () => {
  const allowlist = parseAdminUids(' admin-1, admin-2 ');
  assert.equal(isCalendarAdminAuth({ uid: 'admin-1', token: { firebase: { sign_in_provider: 'google.com' } } }, allowlist), true);
  assert.equal(isCalendarAdminAuth({ uid: 'admin-1', token: { firebase: { sign_in_provider: 'anonymous' } } }, allowlist), false);
  assert.equal(isCalendarAdminAuth({ uid: 'other', token: { firebase: { sign_in_provider: 'google.com' } } }, allowlist), false);
});

test('linked Swiss integration requires the complete canonical contract', () => {
  const timestamp = { toMillis: () => 1 };
  assert.deepEqual(classifyLinkedSwissIntegration({ schemaVersion: 1, swissTournamentId: 'tournament-1', linkedAt: timestamp }), { status: 'linked', tournamentId: 'tournament-1' });
  assert.equal(classifyLinkedSwissIntegration({ schemaVersion: 1, swissTournamentId: null, linkedAt: null }).status, 'malformed');
  assert.equal(classifyLinkedSwissIntegration({ schemaVersion: 1, swissTournamentId: 'tournament-1', linkedAt: timestamp, extra: true }).status, 'malformed');
});
