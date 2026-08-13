import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRESTORE_IN_QUERY_LIMIT,
  PUBLIC_LIST_WINDOW_DAYS,
  addCalendarDays,
  calendarMonthRange,
  chunkDocumentIds,
  monthDateFromDateString,
  publicCalendarRange,
  taipeiDateString,
} from '../src/utils/calendarReadModel.js';

test('Taipei today is authoritative across the UTC date boundary', () => {
  assert.equal(taipeiDateString(Date.parse('2026-08-13T15:59:59Z')), '2026-08-13');
  assert.equal(taipeiDateString(Date.parse('2026-08-13T16:00:00Z')), '2026-08-14');
});

test('public list range preserves today through fourteen days inclusive', () => {
  assert.equal(PUBLIC_LIST_WINDOW_DAYS, 14);
  assert.equal(addCalendarDays('2026-08-14', PUBLIC_LIST_WINDOW_DAYS), '2026-08-28');
  assert.deepEqual(publicCalendarRange({
    viewMode: 'list',
    taipeiToday: '2026-08-14',
    currentMonth: monthDateFromDateString('2026-08-14'),
  }), { start: '2026-08-14', end: '2026-08-28' });
});

test('calendar mode uses the complete displayed month including leap years', () => {
  assert.deepEqual(calendarMonthRange(2026, 7), { start: '2026-08-01', end: '2026-08-31' });
  assert.deepEqual(calendarMonthRange(2028, 1), { start: '2028-02-01', end: '2028-02-29' });
  assert.deepEqual(publicCalendarRange({
    viewMode: 'calendar',
    taipeiToday: '2026-08-14',
    currentMonth: new Date(2026, 10, 1),
  }), { start: '2026-11-01', end: '2026-11-30' });
});

test('calendar date helpers reject malformed or impossible dates', () => {
  assert.throws(() => addCalendarDays('2026-02-30', 1), /INVALID_CALENDAR_DATE/);
  assert.throws(() => addCalendarDays('2026-08-14', 1.5), /INVALID_CALENDAR_DAY_OFFSET/);
  assert.throws(() => calendarMonthRange(2026, 12), /INVALID_CALENDAR_MONTH/);
  assert.throws(() => monthDateFromDateString('not-a-date'), /INVALID_CALENDAR_DATE/);
});

test('stats document IDs are unique sorted and split below the Firestore disjunction limit', () => {
  assert.equal(FIRESTORE_IN_QUERY_LIMIT, 30);
  const ids = Array.from({ length: 65 }, (_, index) => `event-${String(65 - index).padStart(2, '0')}`);
  ids.push('event-01');
  const chunks = chunkDocumentIds(ids);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [30, 30, 5]);
  assert.equal(chunks.flat().length, 65);
  assert.deepEqual(chunks.flat(), [...new Set(ids)].sort());
  assert.deepEqual(chunkDocumentIds([]), []);
});

test('frontend separates bounded public listeners from admin historical listeners', () => {
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /where\('date',\s*'>=',\s*publicDateRange\.start\)/);
  assert.match(app, /where\('date',\s*'<=',\s*publicDateRange\.end\)/);
  assert.match(app, /orderBy\('date',\s*'asc'\)/);
  assert.match(app, /where\(documentId\(\),\s*'in',\s*eventIdChunk\)/);
  assert.match(app, /if \(!user \|\| isAdminWorkspace\) return undefined/);
  assert.match(app, /if \(!user \|\| !isAdminWorkspace\) return undefined/);
  assert.match(app, /setupListener\(\s*getCollection\('monster_tournaments'\),\s*setAdminTournaments/);
  assert.match(app, /setupListener\(\s*getCollection\('tournamentPreRegistrationStats'\),/);
  assert.match(app, /const probeSnapshot = await getDoc\(doc\(/);
  assert.doesNotMatch(app, /setupListener\(getCollection\('monster_tournaments'\), setPublicTournaments/);
  assert.doesNotMatch(app, /setupListener\(getCollection\('tournamentPreRegistrationStats'\),\s*\(data\) => \{\s*setPublicPreRegistrationStats/);
  assert.doesNotMatch(app, /const probeEvent = tournaments\.find/);
});
