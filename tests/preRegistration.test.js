import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManagementUrl,
  classifyPreRegistrationAvailability,
  formatTaipeiDateTimeLocal,
  normalizeCustomerFields,
  normalizePreRegistrationSettings,
  parseTaipeiDateTimeLocal,
  preparePreRegistrationForWrite,
} from '../src/utils/preRegistration.js';
import { captureManagementRoute } from '../src/utils/managementTokenBootstrap.js';

const futureEvent = (preRegistration) => ({
  id: 'event-1',
  title: 'Test',
  date: '2030-08-01',
  time: '19:00',
  preRegistration,
});

test('old events without preRegistration remain closed and render no public action', () => {
  assert.equal(classifyPreRegistrationAvailability({ date: '2030-08-01', time: '19:00' }, 0, Date.parse('2030-01-01')).status, 'not_open');
});

test('valid settings normalize and cap capacity at a positive safe integer', () => {
  assert.deepEqual(normalizePreRegistrationSettings({ enabled: true, capacity: 8, deadline: null }), {
    schemaVersion: 1,
    enabled: true,
    capacity: 8,
    deadline: null,
  });
  assert.throws(() => preparePreRegistrationForWrite({ preRegistration: { enabled: true, capacity: 257, deadline: null } }), /INVALID_PRE_REGISTRATION_CAPACITY/);
});

test('Taipei deadline input round trips independently from browser timezone', () => {
  const millis = parseTaipeiDateTimeLocal('2030-08-01T18:30');
  assert.equal(millis, Date.parse('2030-08-01T18:30:00+08:00'));
  assert.equal(formatTaipeiDateTimeLocal(new Date(millis)), '2030-08-01T18:30');
});

test('public availability distinguishes open, deadline, full, closed, and ended', () => {
  const settings = { schemaVersion: 1, enabled: true, capacity: 2, deadline: new Date('2030-08-01T18:00:00+08:00') };
  assert.equal(classifyPreRegistrationAvailability(futureEvent(settings), 1, Date.parse('2030-01-01')).status, 'open');
  assert.equal(classifyPreRegistrationAvailability(futureEvent(settings), 2, Date.parse('2030-01-01')).status, 'full');
  assert.equal(classifyPreRegistrationAvailability(futureEvent(settings), 0, Date.parse('2030-08-01T18:30:00+08:00')).status, 'deadline');
  assert.equal(classifyPreRegistrationAvailability(futureEvent({ ...settings, enabled: false }), 0, Date.parse('2030-01-01')).status, 'closed');
  assert.equal(classifyPreRegistrationAvailability(futureEvent({ ...settings, deadline: null }), 0, Date.parse('2030-08-01T19:01:00+08:00')).status, 'ended');
});

test('customer fields trim values and reject control characters or oversized input', () => {
  assert.deepEqual(normalizeCustomerFields({ playerName: ' Player ', officialId: ' ID ', deckName: '', honorId: '' }), {
    playerName: 'Player', officialId: 'ID', deckName: '', honorId: '',
  });
  assert.throws(() => normalizeCustomerFields({ playerName: 'A\nB', officialId: '', deckName: '', honorId: '' }), /INVALID_PLAYERNAME/);
  assert.throws(() => normalizeCustomerFields({ playerName: 'x'.repeat(41), officialId: '', deckName: '', honorId: '' }), /INVALID_PLAYERNAME/);
});

test('management token is placed only in the fragment and stripped immediately', () => {
  const token = 'a'.repeat(43);
  const url = new URL(buildManagementUrl({ origin: 'https://calendar.example/', calendarEventId: 'event-1', registrationId: 'reg-1', managementToken: token }));
  assert.equal(url.searchParams.get('event'), 'event-1');
  assert.equal(url.searchParams.get('registration'), 'reg-1');
  assert.equal(url.searchParams.has('manage'), false);
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('manage'), token);

  let replacement = '';
  const route = captureManagementRoute(url, { state: null, replaceState: (_state, _title, value) => { replacement = value; } });
  assert.equal(route.managementToken, token);
  assert.equal(replacement.includes('manage='), false);
});

test('management bootstrap runs before React, Firebase, or App modules load', () => {
  const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(main, /^import '\.\/utils\/managementTokenBootstrap\.js';/);
  assert.match(main, /await import\('\.\/renderApp\.jsx'\)/);
  assert.doesNotMatch(main, /from 'react'|from 'firebase|import App/);
});

test('management tokens are never written to browser storage', () => {
  const sources = [
    fs.readFileSync(new URL('../src/utils/managementTokenBootstrap.js', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../src/components/PreRegistrationDialog.jsx', import.meta.url), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(sources, /localStorage|sessionStorage/);
});

test('customer pre-registration code uses callables and never directly writes or lists private entries', () => {
  const component = fs.readFileSync(new URL('../src/components/PreRegistrationDialog.jsx', import.meta.url), 'utf8');
  const customerSection = component.slice(0, component.indexOf('export function PreRegistrationAdminDialog'));
  assert.match(customerSection, /httpsCallable/);
  assert.doesNotMatch(customerSection, /\baddDoc\b|\bgetDocs\b|\bsetDoc\b|\bupdateDoc\b|\bdeleteDoc\b/);
});

test('admin entry listener is scoped to the open authorized modal and returns cleanup', () => {
  const component = fs.readFileSync(new URL('../src/components/PreRegistrationDialog.jsx', import.meta.url), 'utf8');
  assert.match(component, /if \(!open \|\| !isAdmin \|\| !event\?\.id\) return undefined/);
  assert.match(component, /return unsubscribe/);
});

test('B1 Swiss handoff remains present and pre-registration is not added to its payload contract', () => {
  const handoff = fs.readFileSync(new URL('../src/utils/swissHandoff.js', import.meta.url), 'utf8');
  assert.match(handoff, /calendarEventId/);
  assert.doesNotMatch(handoff, /preRegistration|registrationId|playerName/);
});
