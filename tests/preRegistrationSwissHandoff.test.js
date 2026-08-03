import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  MAX_PRE_REGISTRATION_HANDOFF_SELECTION,
  buildPreRegistrationSwissHandoffUrl,
  classifyPreRegistrationImportAvailability,
  classifyPreRegistrationImportEntry,
  normalizeSelectedRegistrationIds,
} from '../src/utils/preRegistrationSwissHandoff.js';

const linkedEvent = {
  id: 'event-1',
  title: 'Test event',
  date: '2030-08-10',
  time: '19:00',
  swissIntegration: {
    schemaVersion: 1,
    swissTournamentId: 'tournament-1',
    linkedAt: { seconds: 1, nanoseconds: 0 },
  },
};

const entry = (registrationId, overrides = {}) => ({
  registrationId,
  status: 'active',
  playerName: `Player ${registrationId}`,
  officialId: '',
  deckName: '',
  honorId: '',
  ...overrides,
});

function decodeEnvelope(urlString) {
  const url = new URL(urlString);
  const encoded = new URLSearchParams(url.hash.slice(1)).get('handoff');
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
}

test('only an admin may select active registrations for a linked future event', () => {
  const entries = [entry('reg-1'), entry('reg-2')];
  assert.equal(classifyPreRegistrationImportAvailability({ event: linkedEvent, entries, isAdmin: false }).status, 'admin_required');
  assert.deepEqual(
    classifyPreRegistrationImportAvailability({ event: linkedEvent, entries, isAdmin: true, now: 0 }),
    { status: 'available', selectableIds: ['reg-1', 'reg-2'], targetSwissTournamentId: 'tournament-1' },
  );
});

test('unlinked, malformed, and started events fail closed', () => {
  assert.equal(classifyPreRegistrationImportAvailability({ event: { ...linkedEvent, swissIntegration: undefined }, entries: [entry('reg-1')], isAdmin: true }).status, 'malformed_link');
  assert.equal(classifyPreRegistrationImportAvailability({ event: { ...linkedEvent, swissIntegration: { schemaVersion: 7 } }, entries: [entry('reg-1')], isAdmin: true }).status, 'malformed_link');
  assert.equal(classifyPreRegistrationImportAvailability({ event: linkedEvent, entries: [entry('reg-1')], isAdmin: true, now: Date.parse('2031-01-01T00:00:00Z') }).status, 'event_started');
});

test('entry availability distinguishes active, cancelled, same-target, and cross-target imports', () => {
  assert.equal(classifyPreRegistrationImportEntry(entry('reg-1'), 'tournament-1').status, 'available');
  assert.equal(classifyPreRegistrationImportEntry(entry('reg-1', { status: 'cancelled' }), 'tournament-1').status, 'cancelled');
  assert.equal(classifyPreRegistrationImportEntry(entry('reg-1', { importedTournamentId: 'tournament-1' }), 'tournament-1').status, 'already_imported');
  assert.equal(classifyPreRegistrationImportEntry(entry('reg-1', { importedTournamentId: 'tournament-2' }), 'tournament-1').status, 'import_conflict');
});

test('selection is exact, unique, sorted, and capped at 128 entries', () => {
  assert.deepEqual(normalizeSelectedRegistrationIds(['reg-2', 'reg-1']), ['reg-1', 'reg-2']);
  assert.throws(() => normalizeSelectedRegistrationIds([]), /INVALID_REGISTRATION_SELECTION/);
  assert.throws(() => normalizeSelectedRegistrationIds(['reg-1', 'reg-1']), /INVALID_REGISTRATION_SELECTION/);
  assert.throws(() => normalizeSelectedRegistrationIds(Array.from({ length: MAX_PRE_REGISTRATION_HANDOFF_SELECTION + 1 }, (_, index) => `reg-${index}`)), /INVALID_REGISTRATION_SELECTION/);
});

test('Swiss URL carries only the B2B envelope in a fragment', () => {
  const handoffToken = 'x'.repeat(43);
  const result = buildPreRegistrationSwissHandoffUrl({
    swissAppUrl: 'https://swiss.example.test/old?x=1#old',
    handoffId: 'handoff-1',
    handoffToken,
  });
  const url = new URL(result);
  assert.equal(url.origin, 'https://swiss.example.test');
  assert.equal(url.pathname, '/old');
  assert.equal(url.search, '?action=import-preregistration');
  assert.deepEqual(decodeEnvelope(result), { schemaVersion: 1, handoffId: 'handoff-1', handoffToken });
  assert.equal(result.includes('playerName'), false);
  assert.equal(result.includes('registrationId'), false);
});

test('handoff UI reserves the popup before creating a callable handoff', () => {
  const source = fs.readFileSync(new URL('../src/components/PreRegistrationSwissImportControls.jsx', import.meta.url), 'utf8');
  assert.ok(source.indexOf("window.open('', 'KJZC_PREREGISTRATION_SWISS_IMPORT')") < source.indexOf("httpsCallable(functions, 'createTournamentPreRegistrationHandoff')"));
  assert.match(source, /getTournamentPreRegistrationHandoffStatus/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|console\.log/);
});

test('B1 and B2B use separate payloads and actions', () => {
  const b1Source = fs.readFileSync(new URL('../src/utils/swissHandoff.js', import.meta.url), 'utf8');
  const b2bSource = fs.readFileSync(new URL('../src/utils/preRegistrationSwissHandoff.js', import.meta.url), 'utf8');
  assert.doesNotMatch(b1Source, /import-preregistration|handoffToken|selectedRegistrationIds/);
  assert.match(b2bSource, /import-preregistration/);
  assert.doesNotMatch(b2bSource, /playerName|officialId|deckName|honorId/);
});

test('the admin listener remains the only client reader of private entries', () => {
  const dialog = fs.readFileSync(new URL('../src/components/PreRegistrationDialog.jsx', import.meta.url), 'utf8');
  assert.match(dialog, /onSnapshot\(query\(entriesRef/);
  assert.match(dialog, /PreRegistrationSwissImportControls/);
  assert.doesNotMatch(dialog, /setDoc|addDoc|updateDoc|deleteDoc/);
});
