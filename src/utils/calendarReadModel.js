export const CALENDAR_TIME_ZONE = 'Asia/Taipei';
export const PUBLIC_LIST_WINDOW_DAYS = 14;
export const FIRESTORE_IN_QUERY_LIMIT = 30;

function parseCalendarDate(value) {
  const normalized = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) throw new Error('INVALID_CALENDAR_DATE');
  const [, rawYear, rawMonth, rawDay] = match;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) {
    throw new Error('INVALID_CALENDAR_DATE');
  }
  return { normalized, year, month, day, date };
}

function formatUtcDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function taipeiDateString(now = Date.now()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error('INVALID_CALENDAR_NOW');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CALENDAR_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addCalendarDays(value, offset) {
  if (!Number.isSafeInteger(offset)) throw new Error('INVALID_CALENDAR_DAY_OFFSET');
  const { date } = parseCalendarDate(value);
  date.setUTCDate(date.getUTCDate() + offset);
  return formatUtcDate(date);
}

export function calendarMonthRange(year, zeroBasedMonth) {
  if (!Number.isSafeInteger(year) || year < 2000 || year > 9999
    || !Number.isSafeInteger(zeroBasedMonth) || zeroBasedMonth < 0 || zeroBasedMonth > 11) {
    throw new Error('INVALID_CALENDAR_MONTH');
  }
  const first = new Date(Date.UTC(year, zeroBasedMonth, 1));
  const last = new Date(Date.UTC(year, zeroBasedMonth + 1, 0));
  return { start: formatUtcDate(first), end: formatUtcDate(last) };
}

export function monthDateFromDateString(value) {
  const { year, month } = parseCalendarDate(value);
  return new Date(year, month - 1, 1);
}

export function publicCalendarRange({ viewMode, taipeiToday, currentMonth }) {
  if (viewMode === 'list') {
    parseCalendarDate(taipeiToday);
    return {
      start: taipeiToday,
      end: addCalendarDays(taipeiToday, PUBLIC_LIST_WINDOW_DAYS),
    };
  }
  if (viewMode !== 'calendar'
    || !(currentMonth instanceof Date)
    || Number.isNaN(currentMonth.getTime())) {
    throw new Error('INVALID_PUBLIC_CALENDAR_RANGE');
  }
  return calendarMonthRange(currentMonth.getFullYear(), currentMonth.getMonth());
}

export function chunkDocumentIds(values, chunkSize = FIRESTORE_IN_QUERY_LIMIT) {
  if (!Array.isArray(values) || !Number.isSafeInteger(chunkSize)
    || chunkSize < 1 || chunkSize > FIRESTORE_IN_QUERY_LIMIT) {
    throw new Error('INVALID_FIRESTORE_DOCUMENT_ID_CHUNK');
  }
  const ids = [...new Set(values
    .map((value) => String(value || '').trim())
    .filter(Boolean))].sort();
  const chunks = [];
  for (let index = 0; index < ids.length; index += chunkSize) {
    chunks.push(ids.slice(index, index + chunkSize));
  }
  return chunks;
}
