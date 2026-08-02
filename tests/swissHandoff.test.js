import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildCalendarToSwissPayload,
  buildOpenSwissPayload,
  buildSwissHandoffUrl,
  claimSwissHandoffMessage,
  createHandoffId,
  decideSwissIntegrationUpdate,
  encodeHandoffPayload,
  normalizeCalendarGameCode,
  normalizeTournamentIntegrationFields,
  parseAllowedOrigins,
  parseSwissCancelledReturnUrl,
  validateSwissCancelledMessage,
  validateSwissCreatedMessage,
} from '../src/utils/swissHandoff.js';
import {
  classifySwissIntegration,
  clearSwissIntegrationSafely,
  removeSwissIntegrationKey,
} from '../src/utils/swissIntegration.js';

const HANDOFF_ID = 'handoff-1';
const LINKED_AT = Object.freeze({ seconds: 1_785_555_600, nanoseconds: 0 });

function createSwissIntegrationHarness(initialData, { exists = true } = {}) {
  const deleteSentinel = Symbol('delete-field');
  let data = initialData;
  const updates = [];
  const firestore = {
    deleteField: () => deleteSentinel,
    doc: (_db, ...segments) => ({ path: segments.join('/') }),
    runTransaction: async (_db, operation) => operation({
      get: async () => ({ exists: () => exists, data: () => data }),
      update: (_reference, payload) => {
        updates.push(payload);
        if (payload.swissIntegration === deleteSentinel) {
          data = removeSwissIntegrationKey(data);
        }
      },
    }),
  };
  return { deleteSentinel, firestore, getData: () => data, updates };
}

const linkedEventData = () => ({
  title: '正式活動內容',
  date: '2026-08-08',
  swissIntegration: {
    schemaVersion: 1,
    swissTournamentId: 't_existing',
    linkedAt: LINKED_AT,
  },
});
const TEST_ADMIN = Object.freeze({ uid: 'test-admin' });
const clearWithAdmin = (options) => clearSwissIntegrationSafely({
  currentUser: TEST_ADMIN,
  isAdminUser: (user) => user === TEST_ADMIN,
  ...options,
});

const event = {
  id: 'calendar-event-1',
  title: '週末寶可夢賽',
  gameType: '寶可夢集換式卡牌遊戲',
  date: '2026-08-08',
  time: '14:00',
  fee: '現場依公告方案',
  entryFee: 300,
  capacity: 32,
  suggestedRounds: 5,
  suggestedTopCut: 8,
};

test('builds the exact B1 create payload with suggestedTopCut', () => {
  assert.deepEqual(buildCalendarToSwissPayload(event, HANDOFF_ID), {
    schemaVersion: 1,
    handoffId: HANDOFF_ID,
    calendarEventId: 'calendar-event-1',
    name: '週末寶可夢賽',
    gameCode: 'ptcg',
    eventDate: '2026-08-08',
    startTime: '14:00',
    entryFee: 300,
    capacity: 32,
    suggestedRounds: 5,
    suggestedTopCut: 8,
  });
});

test('legacy fee remains display text and a missing entryFee is handed off for confirmation', () => {
  const payload = buildCalendarToSwissPayload({ ...event, entryFee: undefined }, HANDOFF_ID);
  assert.equal(payload.entryFee, null);
  assert.equal(Object.hasOwn(payload, 'fee'), false);
});

test('rejects unknown payload fields and limits encoded payload size', () => {
  assert.throws(() => encodeHandoffPayload({ ...buildCalendarToSwissPayload(event, HANDOFF_ID), phone: 'secret' }), /INVALID_HANDOFF_FIELDS/);
  assert.throws(() => buildCalendarToSwissPayload({ ...event, suggestedTopCut: 6 }, HANDOFF_ID), /INVALID_SUGGESTED_TOP_CUT/);
  assert.throws(() => buildCalendarToSwissPayload({ ...event, entryFee: -1 }, HANDOFF_ID), /INVALID_ENTRY_FEE/);
  assert.throws(() => buildCalendarToSwissPayload({ ...event, date: '2026-02-31' }, HANDOFF_ID), /INVALID_EVENT_DATE/);
  assert.throws(() => encodeHandoffPayload({ ...buildCalendarToSwissPayload(event, HANDOFF_ID), name: 'x'.repeat(3000) }), /HANDOFF_TOO_LARGE/);
  const polluted = Object.assign(Object.create({ admin: true }), buildCalendarToSwissPayload(event, HANDOFF_ID));
  assert.throws(() => encodeHandoffPayload(polluted), /INVALID_HANDOFF_FIELDS/);
});

test('UTF-8 Chinese, symbols and emoji survive URL-safe encoding', () => {
  const payload = buildCalendarToSwissPayload({ ...event, title: '怪獸盃 #1 🎴' }, HANDOFF_ID);
  const encoded = encodeHandoffPayload(payload);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.equal(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')).name, '怪獸盃 #1 🎴');
});

test('handoff IDs require secure randomness and are safe identifiers', () => {
  const id = createHandoffId({ getRandomValues: (bytes) => bytes.fill(0xab) });
  assert.equal(id, `ho_${'ab'.repeat(16)}`);
  assert.throws(() => createHandoffId({}), /SECURE_RANDOM_UNAVAILABLE/);
});

test('maps stable game codes and preserves safe custom codes', () => {
  assert.equal(normalizeCalendarGameCode('', 'Ultraman Card Game'), 'ucg');
  assert.equal(normalizeCalendarGameCode('custom_store_game', '任意顯示名稱'), 'custom_store_game');
  assert.equal(normalizeCalendarGameCode('', '未知遊戲'), 'other');
});

test('builds create and open URLs without adding personal data', () => {
  const create = buildSwissHandoffUrl({ event, sourceOrigin: 'https://calendar.example', swissAppUrl: 'https://swiss.example/', handoffId: HANDOFF_ID });
  assert.equal(new URL(create.url).origin, 'https://swiss.example');
  assert.equal(new URL(create.url).searchParams.get('sourceOrigin'), 'https://calendar.example');
  assert.equal(create.url.includes('phone'), false);

  const open = buildOpenSwissPayload({ ...event, swissIntegration: { swissTournamentId: 't_123' } }, HANDOFF_ID);
  assert.deepEqual(open, {
    schemaVersion: 1,
    handoffId: HANDOFF_ID,
    action: 'open',
    calendarEventId: 'calendar-event-1',
    swissTournamentId: 't_123',
  });
});

test('accepts only the expected popup, origin, type, schema and event id', () => {
  const popup = {};
  const allowedOrigins = parseAllowedOrigins('https://preview.swiss.example', 'https://swiss.example/');
  const good = {
    origin: 'https://swiss.example',
    source: popup,
    data: { type: 'KJZC_SWISS_CREATED_V1', schemaVersion: 1, handoffId: HANDOFF_ID, calendarEventId: 'calendar-event-1', tournamentId: 't_123' },
  };
  assert.equal(validateSwissCreatedMessage(good, { allowedOrigins, expectedWindow: popup, expectedHandoffId: HANDOFF_ID, expectedCalendarEventId: 'calendar-event-1' }).ok, true);
  assert.equal(validateSwissCreatedMessage({ ...good, origin: 'https://evil.example' }, { allowedOrigins, expectedWindow: popup }).ok, false);
  assert.equal(validateSwissCreatedMessage({ ...good, source: {} }, { allowedOrigins, expectedWindow: popup }).ok, false);
  assert.equal(validateSwissCreatedMessage({ ...good, data: { ...good.data, type: 'OTHER' } }, { allowedOrigins, expectedWindow: popup }).ok, false);
  assert.equal(validateSwissCreatedMessage({ ...good, data: { ...good.data, schemaVersion: 2 } }, { allowedOrigins, expectedWindow: popup }).ok, false);
  assert.equal(validateSwissCreatedMessage({ ...good, data: { ...good.data, handoffId: 'old-session' } }, { allowedOrigins, expectedWindow: popup, expectedHandoffId: HANDOFF_ID }).ok, false);
  assert.equal(validateSwissCreatedMessage({ ...good, data: { ...good.data, uid: 'unexpected' } }, { allowedOrigins, expectedWindow: popup }).ok, false);
});

test('accepts only an exact cancellation from the expected Swiss popup', () => {
  const popup = {};
  const allowedOrigins = parseAllowedOrigins('', 'https://swiss.example/');
  const good = {
    origin: 'https://swiss.example',
    source: popup,
    data: {
      type: 'KJZC_SWISS_CANCELLED_V1',
      schemaVersion: 1,
      handoffId: HANDOFF_ID,
      calendarEventId: 'calendar-event-1',
    },
  };
  const options = {
    allowedOrigins,
    expectedWindow: popup,
    expectedHandoffId: HANDOFF_ID,
    expectedCalendarEventId: 'calendar-event-1',
  };
  assert.equal(validateSwissCancelledMessage(good, options).ok, true);
  assert.equal(validateSwissCancelledMessage({ ...good, origin: 'https://evil.example' }, options).ok, false);
  assert.equal(validateSwissCancelledMessage({ ...good, source: {} }, options).ok, false);
  assert.equal(validateSwissCancelledMessage({ ...good, data: { ...good.data, handoffId: 'stale-handoff' } }, options).ok, false);
  assert.equal(validateSwissCancelledMessage({ ...good, data: { ...good.data, calendarEventId: 'other-event' } }, options).ok, false);
  assert.equal(validateSwissCancelledMessage({ ...good, data: { ...good.data, tournamentId: 'forbidden' } }, options).ok, false);
});

test('accepts a protected-preview cancellation return only from the expected popup URL', () => {
  const popup = {};
  const options = {
    expectedOrigin: 'https://calendar.example',
    swissOrigin: 'https://swiss.example',
    expectedWindow: popup,
    expectedHandoffId: HANDOFF_ID,
    expectedCalendarEventId: 'calendar-event-1',
  };
  const valid = 'https://calendar.example/#type=KJZC_SWISS_CANCELLED_V1&schemaVersion=1&handoffId=handoff-1&calendarEventId=calendar-event-1';
  assert.equal(parseSwissCancelledReturnUrl(valid, options).ok, true);
  assert.equal(parseSwissCancelledReturnUrl(valid.replace('calendar.example', 'evil.example'), options).ok, false);
  assert.equal(parseSwissCancelledReturnUrl(`${valid}&uid=forbidden`, options).ok, false);
  assert.equal(parseSwissCancelledReturnUrl(`${valid}&handoffId=handoff-1`, options).ok, false);
  assert.equal(parseSwissCancelledReturnUrl(valid.replace('schemaVersion=1', 'schemaVersion=01'), options).ok, false);
  assert.equal(parseSwissCancelledReturnUrl(valid.replace('handoff-1', 'stale-handoff'), options).ok, false);
  assert.equal(parseSwissCancelledReturnUrl(valid.replace('calendar-event-1', 'other-event'), options).ok, false);
});

test('a handoff session settles once and parallel or stale messages cannot cross-match', () => {
  const popupA = {};
  const popupB = {};
  const allowedOrigins = parseAllowedOrigins('', 'https://swiss.example/');
  const pendingSessions = new Map([
    ['handoff-a', { handoffId: 'handoff-a', calendarEventId: 'event-a', popup: popupA }],
    ['handoff-b', { handoffId: 'handoff-b', calendarEventId: 'event-b', popup: popupB }],
  ]);
  const event = (source, data) => ({ origin: 'https://swiss.example', source, data });
  const cancelledA = event(popupA, {
    type: 'KJZC_SWISS_CANCELLED_V1', schemaVersion: 1, handoffId: 'handoff-a', calendarEventId: 'event-a',
  });
  const createdA = event(popupA, {
    type: 'KJZC_SWISS_CREATED_V1', schemaVersion: 1, handoffId: 'handoff-a', calendarEventId: 'event-a', tournamentId: 't_a',
  });

  assert.equal(claimSwissHandoffMessage(cancelledA, { pendingSessions, allowedOrigins }).kind, 'cancelled');
  assert.equal(claimSwissHandoffMessage(cancelledA, { pendingSessions, allowedOrigins }).error, 'UNKNOWN_HANDOFF');
  assert.equal(claimSwissHandoffMessage(createdA, { pendingSessions, allowedOrigins }).error, 'UNKNOWN_HANDOFF');
  assert.equal(pendingSessions.has('handoff-b'), true);

  const forgedForB = event(popupA, {
    type: 'KJZC_SWISS_CANCELLED_V1', schemaVersion: 1, handoffId: 'handoff-b', calendarEventId: 'event-b',
  });
  assert.equal(claimSwissHandoffMessage(forgedForB, { pendingSessions, allowedOrigins }).error, 'UNTRUSTED_WINDOW');

  const createdB = event(popupB, {
    type: 'KJZC_SWISS_CREATED_V1', schemaVersion: 1, handoffId: 'handoff-b', calendarEventId: 'event-b', tournamentId: 't_b',
  });
  const cancelledB = event(popupB, {
    type: 'KJZC_SWISS_CANCELLED_V1', schemaVersion: 1, handoffId: 'handoff-b', calendarEventId: 'event-b',
  });
  assert.equal(claimSwissHandoffMessage(createdB, { pendingSessions, allowedOrigins }).kind, 'created');
  assert.equal(claimSwissHandoffMessage(cancelledB, { pendingSessions, allowedOrigins }).error, 'UNKNOWN_HANDOFF');
});

test('parallel popup sessions cannot cross-match handoff IDs or window sources', () => {
  const allowedOrigins = parseAllowedOrigins('', 'https://swiss.example/');
  const popupA = {};
  const popupB = {};
  const eventFor = (popup, handoffId, calendarEventId) => ({
    origin: 'https://swiss.example',
    source: popup,
    data: {
      type: 'KJZC_SWISS_CREATED_V1',
      schemaVersion: 1,
      handoffId,
      calendarEventId,
      tournamentId: `t_${calendarEventId}`,
    },
  });
  const eventA = eventFor(popupA, 'handoff-a', 'event-a');
  const eventB = eventFor(popupB, 'handoff-b', 'event-b');
  assert.equal(validateSwissCreatedMessage(eventA, { allowedOrigins, expectedWindow: popupA, expectedHandoffId: 'handoff-a', expectedCalendarEventId: 'event-a' }).ok, true);
  assert.equal(validateSwissCreatedMessage(eventB, { allowedOrigins, expectedWindow: popupB, expectedHandoffId: 'handoff-b', expectedCalendarEventId: 'event-b' }).ok, true);
  assert.equal(validateSwissCreatedMessage(eventA, { allowedOrigins, expectedWindow: popupB, expectedHandoffId: 'handoff-b', expectedCalendarEventId: 'event-b' }).ok, false);
  assert.equal(validateSwissCreatedMessage({ ...eventB, source: popupA }, { allowedOrigins, expectedWindow: popupB, expectedHandoffId: 'handoff-b', expectedCalendarEventId: 'event-b' }).ok, false);
});

test('Swiss integration writes once, preserves matching links and rejects conflicts', () => {
  assert.equal(decideSwissIntegrationUpdate('', 't_1'), 'write');
  assert.equal(decideSwissIntegrationUpdate('t_1', 't_1'), 'unchanged');
  assert.equal(decideSwissIntegrationUpdate('t_existing', 't_other'), 'conflict');
});

test('Swiss integration canonical states distinguish unlinked, legacy, linked and malformed values', () => {
  assert.deepEqual(classifySwissIntegration(undefined, { fieldPresent: false }), { status: 'unlinked', tournamentId: '' });
  assert.deepEqual(classifySwissIntegration({ schemaVersion: 1, swissTournamentId: null, linkedAt: null }), { status: 'legacy_unlinked', tournamentId: '' });
  assert.deepEqual(classifySwissIntegration(linkedEventData().swissIntegration), { status: 'linked', tournamentId: 't_existing' });
  assert.deepEqual(classifySwissIntegration({ ...linkedEventData().swissIntegration, swissTournamentId: '  t_existing  ' }), { status: 'linked', tournamentId: 't_existing' });
  assert.equal(classifySwissIntegration({ schemaVersion: 1, swissTournamentId: '', linkedAt: LINKED_AT }).status, 'malformed');
  assert.equal(classifySwissIntegration(null, { fieldPresent: true }).status, 'malformed');
  assert.equal(classifySwissIntegration({ swissTournamentId: null }, { fieldPresent: true }).status, 'malformed');
  assert.equal(classifySwissIntegration({ ...linkedEventData().swissIntegration, schemaVersion: 2 }).status, 'malformed');
  assert.equal(classifySwissIntegration({ ...linkedEventData().swissIntegration, adminNote: 'forbidden' }).status, 'malformed');
});

test('valid Swiss integration is removed with one exact deleteField update and preserves all event fields', async () => {
  const before = linkedEventData();
  const harness = createSwissIntegrationHarness(before);
  const result = await clearWithAdmin({
    db: {},
    appId: 'calendar-app',
    calendarEventId: 'calendar-event-1',
    expectedTournamentId: 't_existing',
    firestore: harness.firestore,
  });

  assert.deepEqual(result, { status: 'cleared' });
  assert.equal(harness.updates.length, 1);
  assert.deepEqual(Object.keys(harness.updates[0]), ['swissIntegration']);
  assert.equal(harness.updates[0].swissIntegration, harness.deleteSentinel);
  assert.deepEqual(harness.getData(), { title: before.title, date: before.date });
});

test('Swiss integration clear rejects conflicts, missing documents and malformed data without writes', async () => {
  const conflict = createSwissIntegrationHarness(linkedEventData());
  await assert.rejects(
    clearWithAdmin({
      db: {}, appId: 'calendar-app', calendarEventId: 'calendar-event-1', expectedTournamentId: 't_other', firestore: conflict.firestore,
    }),
    /SWISS_UNLINK_CONFLICT/,
  );
  assert.equal(conflict.updates.length, 0);
  assert.equal(conflict.getData().swissIntegration.swissTournamentId, 't_existing');

  const missing = createSwissIntegrationHarness({}, { exists: false });
  await assert.rejects(
    clearWithAdmin({
      db: {}, appId: 'calendar-app', calendarEventId: 'calendar-event-1', expectedTournamentId: 't_existing', firestore: missing.firestore,
    }),
    /CALENDAR_EVENT_NOT_FOUND/,
  );
  assert.equal(missing.updates.length, 0);

  const malformed = createSwissIntegrationHarness({
    title: '活動',
    swissIntegration: { schemaVersion: 1, swissTournamentId: 't_existing', linkedAt: null },
  });
  await assert.rejects(
    clearWithAdmin({
      db: {}, appId: 'calendar-app', calendarEventId: 'calendar-event-1', expectedTournamentId: 't_existing', firestore: malformed.firestore,
    }),
    /SWISS_INTEGRATION_MALFORMED/,
  );
  assert.equal(malformed.updates.length, 0);
});

test('unlinked and legacy-null Swiss integrations clear idempotently into the canonical unlinked state', async () => {
  const absent = createSwissIntegrationHarness({ title: '活動' });
  const absentResult = await clearWithAdmin({
    db: {}, appId: 'calendar-app', calendarEventId: 'calendar-event-1', firestore: absent.firestore,
  });
  assert.deepEqual(absentResult, { status: 'already-unlinked' });
  assert.equal(absent.updates.length, 0);

  const legacy = createSwissIntegrationHarness({
    title: '活動',
    swissIntegration: { schemaVersion: 1, swissTournamentId: null, linkedAt: null },
  });
  await clearWithAdmin({
    db: {}, appId: 'calendar-app', calendarEventId: 'calendar-event-1', firestore: legacy.firestore,
  });
  const repeated = await clearWithAdmin({
    db: {}, appId: 'calendar-app', calendarEventId: 'calendar-event-1', firestore: legacy.firestore,
  });
  assert.equal(legacy.updates.length, 1);
  assert.equal(Object.hasOwn(legacy.getData(), 'swissIntegration'), false);
  assert.deepEqual(repeated, { status: 'already-unlinked' });
});

test('Swiss integration clear requires the current Calendar Google administrator', async () => {
  const harness = createSwissIntegrationHarness(linkedEventData());
  await assert.rejects(
    clearSwissIntegrationSafely({
      db: {},
      appId: 'calendar-app',
      calendarEventId: 'calendar-event-1',
      expectedTournamentId: 't_existing',
      currentUser: { uid: 'not-admin' },
      isAdminUser: () => false,
      firestore: harness.firestore,
    }),
    /CALENDAR_ADMIN_REQUIRED/,
  );
  assert.equal(harness.updates.length, 0);
});

test('local state removal omits the Swiss integration key without mutating the original event', () => {
  const before = linkedEventData();
  const after = removeSwissIntegrationKey(before);
  assert.equal(Object.hasOwn(after, 'swissIntegration'), false);
  assert.equal(Object.hasOwn(before, 'swissIntegration'), true);
  assert.equal(after.title, before.title);
  assert.equal(after.date, before.date);
});

test('normalizes formal integration fields without parsing the legacy fee text', () => {
  const normalized = normalizeTournamentIntegrationFields({ ...event, entryFee: '300', fee: '買兩包' });
  assert.equal(normalized.entryFee, 300);
  assert.equal(normalized.fee, '買兩包');
  assert.equal(normalized.suggestedTopCut, 8);
});

test('App wires success-only persistence, popup failure and manual unlink confirmation', () => {
  const source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(source, /claimSwissHandoffMessage/);
  assert.match(source, /if \(!message\.ok\) return;/);
  assert.match(source, /if \(message\.kind === 'cancelled'\)[\s\S]*?setSwissStatus\(pending\.calendarEventId, 'idle'\);[\s\S]*?return;/);
  assert.match(source, /if \(message\.kind === 'cancelled'\)[\s\S]*?return;[\s\S]*?await runTransaction/);
  assert.match(source, /swissTournamentId:\s*message\.value\.tournamentId/);
  assert.match(source, /if \(!popup\)/);
  assert.match(source, /parseSwissCancelledReturnUrl\(popupUrl/);
  assert.match(source, /if \(returnedCancellation\?\.ok\)[\s\S]*?setSwissStatus\(tournamentItem\.id, 'idle'\);[\s\S]*?popup\.close\(\)/);
  assert.match(source, /if \(!popup\.closed\) return;/);
  assert.match(source, /confirm\('確定要清除這場活動的瑞士制關聯/);
  assert.match(source, /clearSwissIntegrationSafely\(\{/);
  assert.match(source, /currentUser:\s*user/);
  assert.match(source, /isAdminUser:\s*isFirebaseAdmin/);
  assert.match(source, /removeSwissIntegrationKey\(item\)/);
  assert.match(source, /swissClearInFlightRef\.current\.has\(tournamentItem\.id\)/);
  assert.match(source, /swissClearInFlightRef\.current\.add\(tournamentItem\.id\)/);
  assert.match(source, /swissClearInFlightRef\.current\.delete\(tournamentItem\.id\)/);
  assert.doesNotMatch(source, /swissIntegration:\s*\{\s*schemaVersion:\s*1,\s*swissTournamentId:\s*null/);
  assert.match(source, /isAdminAuth &&/);
  assert.match(source, /開啟瑞士制賽事/);
  assert.match(source, /建立瑞士制賽事/);
  assert.match(source, /pendingSwissRef = useRef\(new Map\(\)\)/);
  assert.match(source, /KJZC_SWISS_HANDOFF_\$\{payload\.handoffId\}/);
  assert.match(source, /SWISS_LINK_CONFLICT/);
  assert.match(source, /瑞士制關聯格式異常/);
});

test('Swiss integration clearing never deletes or overwrites the event document', () => {
  const source = fs.readFileSync(new URL('../src/utils/swissIntegration.js', import.meta.url), 'utf8');
  assert.match(source, /transaction\.update\(eventRef, \{ swissIntegration: deleteFieldFn\(\) \}\)/);
  assert.doesNotMatch(source, /\bdeleteDoc\s*\(/);
  assert.doesNotMatch(source, /\bsetDoc\s*\(/);
});
