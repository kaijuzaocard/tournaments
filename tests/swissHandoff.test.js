import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildCalendarToSwissPayload,
  buildOpenSwissPayload,
  buildSwissHandoffUrl,
  createHandoffId,
  decideSwissIntegrationUpdate,
  encodeHandoffPayload,
  normalizeCalendarGameCode,
  normalizeTournamentIntegrationFields,
  parseAllowedOrigins,
  validateSwissCreatedMessage,
} from '../src/utils/swissHandoff.js';

const HANDOFF_ID = 'handoff-1';

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

test('normalizes formal integration fields without parsing the legacy fee text', () => {
  const normalized = normalizeTournamentIntegrationFields({ ...event, entryFee: '300', fee: '買兩包' });
  assert.equal(normalized.entryFee, 300);
  assert.equal(normalized.fee, '買兩包');
  assert.equal(normalized.suggestedTopCut, 8);
});

test('App wires success-only persistence, popup failure and manual unlink confirmation', () => {
  const source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(source, /validateSwissCreatedMessage/);
  assert.match(source, /if \(!message\.ok \|\| pending\.processing\) return;/);
  assert.match(source, /if \(!message\.ok[\s\S]*?await runTransaction/);
  assert.match(source, /swissTournamentId:\s*message\.value\.tournamentId/);
  assert.match(source, /if \(!popup\)/);
  assert.match(source, /confirm\('確定要清除這場活動的瑞士制關聯/);
  assert.match(source, /isAdminAuth &&/);
  assert.match(source, /開啟瑞士制賽事/);
  assert.match(source, /pendingSwissRef = useRef\(new Map\(\)\)/);
  assert.match(source, /KJZC_SWISS_HANDOFF_\$\{payload\.handoffId\}/);
  assert.match(source, /SWISS_LINK_CONFLICT/);
});
