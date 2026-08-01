export const CALENDAR_TO_SWISS_SCHEMA_VERSION = 1;
export const SWISS_CREATED_MESSAGE_TYPE = 'KJZC_SWISS_CREATED_V1';
export const SWISS_CANCELLED_MESSAGE_TYPE = 'KJZC_SWISS_CANCELLED_V1';
export const DEFAULT_SWISS_APP_URL = 'https://swiss-tournament-one.vercel.app/';
export const MAX_HANDOFF_BYTES = 2048;

const TOP_CUTS = new Set([0, 2, 4, 8, 16]);
const CREATE_KEYS = Object.freeze([
  'schemaVersion',
  'handoffId',
  'calendarEventId',
  'name',
  'gameCode',
  'eventDate',
  'startTime',
  'entryFee',
  'capacity',
  'suggestedRounds',
  'suggestedTopCut',
]);
const OPEN_KEYS = Object.freeze([
  'schemaVersion',
  'handoffId',
  'action',
  'calendarEventId',
  'swissTournamentId',
]);
const CREATED_MESSAGE_KEYS = Object.freeze([
  'type',
  'schemaVersion',
  'handoffId',
  'calendarEventId',
  'tournamentId',
]);
const CANCELLED_MESSAGE_KEYS = Object.freeze([
  'type',
  'schemaVersion',
  'handoffId',
  'calendarEventId',
]);
const CANCELLED_RETURN_KEYS = Object.freeze([
  'type',
  'schemaVersion',
  'handoffId',
  'calendarEventId',
]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_GAME_CODE = /^(?:ptcg|ucg|godzilla|nivel|other|custom_[a-z0-9][a-z0-9_-]{0,56})$/;

const text = (value) => String(value ?? '').trim();

function exactKeys(value, expected) {
  const prototype = Object.getPrototypeOf(value || {});
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Object.keys(value || {}).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function safeInteger(value, field, { allowMissing = false, fallback = 0, max = 1_000_000 } = {}) {
  const errorCode = `INVALID_${field.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`;
  if (value == null || value === '') {
    if (allowMissing) return null;
    return fallback;
  }
  if (typeof value === 'boolean') throw new Error(errorCode);
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > max) {
    throw new Error(errorCode);
  }
  return number;
}

function validDate(value) {
  const candidate = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return false;
  const [year, month, day] = candidate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function createHandoffId(cryptoObject = globalThis.crypto) {
  if (typeof cryptoObject?.randomUUID === 'function') return cryptoObject.randomUUID();
  if (typeof cryptoObject?.getRandomValues !== 'function') throw new Error('SECURE_RANDOM_UNAVAILABLE');
  const bytes = new Uint8Array(16);
  cryptoObject.getRandomValues(bytes);
  return `ho_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function normalizeCalendarGameCode(gameCode, gameType = '') {
  const explicit = text(gameCode).toLowerCase();
  if (SAFE_GAME_CODE.test(explicit)) return explicit;
  const value = `${explicit} ${text(gameType)}`.toLocaleLowerCase('zh-TW');
  if (value.includes('pokemon') || value.includes('pokémon') || value.includes('寶可夢') || value.includes('ptcg')) return 'ptcg';
  if (value.includes('ultraman') || value.includes('超人力霸王') || value.includes('ucg')) return 'ucg';
  if (value.includes('godzilla') || value.includes('哥吉拉')) return 'godzilla';
  if (value.includes('nivel')) return 'nivel';
  return 'other';
}

export function buildCalendarToSwissPayload(event, handoffId = createHandoffId()) {
  const calendarEventId = text(event?.id ?? event?.calendarEventId);
  const name = text(event?.title ?? event?.name);
  const eventDate = text(event?.date ?? event?.eventDate);
  const startTime = text(event?.time ?? event?.startTime);
  const gameCode = normalizeCalendarGameCode(event?.gameCode, event?.gameType);
  if (!SAFE_ID.test(text(handoffId))) throw new Error('INVALID_HANDOFF_ID');
  if (!SAFE_ID.test(calendarEventId)) throw new Error('INVALID_CALENDAR_EVENT_ID');
  if (!name || name.length > 120) throw new Error('INVALID_NAME');
  if (!validDate(eventDate)) throw new Error('INVALID_EVENT_DATE');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) throw new Error('INVALID_START_TIME');

  const suggestedTopCut = safeInteger(event?.suggestedTopCut, 'suggestedTopCut', { max: 16 });
  if (!TOP_CUTS.has(suggestedTopCut)) throw new Error('INVALID_SUGGESTED_TOP_CUT');

  return {
    schemaVersion: CALENDAR_TO_SWISS_SCHEMA_VERSION,
    handoffId: text(handoffId),
    calendarEventId,
    name,
    gameCode,
    eventDate,
    startTime,
    entryFee: safeInteger(event?.entryFee, 'entryFee', { allowMissing: true }),
    capacity: safeInteger(event?.capacity, 'capacity', { max: 10_000 }),
    suggestedRounds: safeInteger(event?.suggestedRounds, 'suggestedRounds', { max: 50 }),
    suggestedTopCut,
  };
}

export function buildOpenSwissPayload(event, handoffId = createHandoffId()) {
  const calendarEventId = text(event?.id ?? event?.calendarEventId);
  const swissTournamentId = text(event?.swissIntegration?.swissTournamentId ?? event?.swissTournamentId);
  if (!SAFE_ID.test(text(handoffId))) throw new Error('INVALID_HANDOFF_ID');
  if (!SAFE_ID.test(calendarEventId)) throw new Error('INVALID_CALENDAR_EVENT_ID');
  if (!SAFE_ID.test(swissTournamentId)) throw new Error('INVALID_SWISS_TOURNAMENT_ID');
  return {
    schemaVersion: CALENDAR_TO_SWISS_SCHEMA_VERSION,
    handoffId: text(handoffId),
    action: 'open',
    calendarEventId,
    swissTournamentId,
  };
}

export function encodeHandoffPayload(payload) {
  const isCreate = exactKeys(payload, CREATE_KEYS);
  const isOpen = exactKeys(payload, OPEN_KEYS);
  if (!isCreate && !isOpen) throw new Error('INVALID_HANDOFF_FIELDS');
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength > MAX_HANDOFF_BYTES) throw new Error('HANDOFF_TOO_LARGE');
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export function buildSwissHandoffUrl({ event, swissAppUrl = DEFAULT_SWISS_APP_URL, sourceOrigin, action = 'create', handoffId = createHandoffId() }) {
  const payload = action === 'open'
    ? buildOpenSwissPayload(event, handoffId)
    : buildCalendarToSwissPayload(event, handoffId);
  const url = new URL(swissAppUrl);
  url.searchParams.set('handoff', encodeHandoffPayload(payload));
  const normalizedOrigin = new URL(sourceOrigin).origin;
  url.searchParams.set('sourceOrigin', normalizedOrigin);
  return { url: url.toString(), payload };
}

export function parseAllowedOrigins(rawValue, requiredUrl = DEFAULT_SWISS_APP_URL) {
  const origins = new Set([new URL(requiredUrl).origin]);
  text(rawValue).split(',').map((value) => value.trim()).filter(Boolean).forEach((value) => {
    try { origins.add(new URL(value).origin); } catch { /* invalid configured origin stays excluded */ }
  });
  return origins;
}

export function validateSwissCreatedMessage(event, options = {}) {
  const data = event?.data;
  if (!options.allowedOrigins?.has(event?.origin)) return { ok: false, error: 'UNTRUSTED_ORIGIN' };
  if (options.expectedWindow && event?.source !== options.expectedWindow) return { ok: false, error: 'UNTRUSTED_WINDOW' };
  if (!data || typeof data !== 'object' || Array.isArray(data) || !exactKeys(data, CREATED_MESSAGE_KEYS)) {
    return { ok: false, error: 'INVALID_MESSAGE_FIELDS' };
  }
  if (data.type !== SWISS_CREATED_MESSAGE_TYPE || data.schemaVersion !== CALENDAR_TO_SWISS_SCHEMA_VERSION) {
    return { ok: false, error: 'INVALID_MESSAGE_CONTRACT' };
  }
  if (!SAFE_ID.test(data.calendarEventId) || !SAFE_ID.test(data.tournamentId)) {
    return { ok: false, error: 'INVALID_MESSAGE_IDS' };
  }
  if (!SAFE_ID.test(data.handoffId)) return { ok: false, error: 'INVALID_HANDOFF_ID' };
  if (options.expectedHandoffId && data.handoffId !== options.expectedHandoffId) {
    return { ok: false, error: 'HANDOFF_ID_MISMATCH' };
  }
  if (options.expectedCalendarEventId && data.calendarEventId !== options.expectedCalendarEventId) {
    return { ok: false, error: 'CALENDAR_EVENT_MISMATCH' };
  }
  return { ok: true, value: data };
}

export function validateSwissCancelledMessage(event, options = {}) {
  const data = event?.data;
  if (!options.allowedOrigins?.has(event?.origin)) return { ok: false, error: 'UNTRUSTED_ORIGIN' };
  if (options.expectedWindow && event?.source !== options.expectedWindow) return { ok: false, error: 'UNTRUSTED_WINDOW' };
  if (!data || typeof data !== 'object' || Array.isArray(data) || !exactKeys(data, CANCELLED_MESSAGE_KEYS)) {
    return { ok: false, error: 'INVALID_MESSAGE_FIELDS' };
  }
  if (data.type !== SWISS_CANCELLED_MESSAGE_TYPE || data.schemaVersion !== CALENDAR_TO_SWISS_SCHEMA_VERSION) {
    return { ok: false, error: 'INVALID_MESSAGE_CONTRACT' };
  }
  if (!SAFE_ID.test(data.handoffId)) return { ok: false, error: 'INVALID_HANDOFF_ID' };
  if (!SAFE_ID.test(data.calendarEventId)) return { ok: false, error: 'INVALID_CALENDAR_EVENT_ID' };
  if (options.expectedHandoffId && data.handoffId !== options.expectedHandoffId) {
    return { ok: false, error: 'HANDOFF_ID_MISMATCH' };
  }
  if (options.expectedCalendarEventId && data.calendarEventId !== options.expectedCalendarEventId) {
    return { ok: false, error: 'CALENDAR_EVENT_MISMATCH' };
  }
  return { ok: true, value: data };
}

export function parseSwissCancelledReturnUrl(rawUrl, options = {}) {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== options.expectedOrigin) return { ok: false, error: 'UNTRUSTED_RETURN_ORIGIN' };
    const params = new URLSearchParams(url.hash.replace(/^#/, ''));
    const entries = Array.from(params.entries());
    const data = Object.fromEntries(entries);
    if (entries.length !== CANCELLED_RETURN_KEYS.length || !exactKeys(data, CANCELLED_RETURN_KEYS)) {
      return { ok: false, error: 'INVALID_MESSAGE_FIELDS' };
    }
    if (data.schemaVersion !== String(CALENDAR_TO_SWISS_SCHEMA_VERSION)) {
      return { ok: false, error: 'INVALID_MESSAGE_CONTRACT' };
    }
    const event = {
      origin: options.swissOrigin,
      source: options.expectedWindow,
      data: { ...data, schemaVersion: Number(data.schemaVersion) },
    };
    return validateSwissCancelledMessage(event, {
      allowedOrigins: new Set([options.swissOrigin]),
      expectedWindow: options.expectedWindow,
      expectedHandoffId: options.expectedHandoffId,
      expectedCalendarEventId: options.expectedCalendarEventId,
    });
  } catch {
    return { ok: false, error: 'INVALID_RETURN_URL' };
  }
}

export function claimSwissHandoffMessage(event, { pendingSessions, allowedOrigins } = {}) {
  const handoffId = event?.data?.handoffId;
  const pending = pendingSessions?.get(handoffId);
  if (!pending) return { ok: false, error: 'UNKNOWN_HANDOFF' };

  const options = {
    allowedOrigins,
    expectedWindow: pending.popup,
    expectedHandoffId: pending.handoffId,
    expectedCalendarEventId: pending.calendarEventId,
  };
  const validator = event?.data?.type === SWISS_CANCELLED_MESSAGE_TYPE
    ? validateSwissCancelledMessage
    : validateSwissCreatedMessage;
  const message = validator(event, options);
  if (!message.ok) return message;
  if (pending.processing) return { ok: false, error: 'HANDOFF_ALREADY_SETTLED' };

  pending.processing = true;
  pendingSessions.delete(handoffId);
  return {
    ok: true,
    kind: message.value.type === SWISS_CANCELLED_MESSAGE_TYPE ? 'cancelled' : 'created',
    value: message.value,
    pending,
  };
}

export function decideSwissIntegrationUpdate(currentTournamentId, incomingTournamentId) {
  const current = text(currentTournamentId);
  const incoming = text(incomingTournamentId);
  if (!SAFE_ID.test(incoming)) throw new Error('INVALID_SWISS_TOURNAMENT_ID');
  if (!current) return 'write';
  if (current === incoming) return 'unchanged';
  return 'conflict';
}

export function normalizeTournamentIntegrationFields(form) {
  return {
    ...form,
    gameCode: normalizeCalendarGameCode(form?.gameCode, form?.gameType),
    entryFee: safeInteger(form?.entryFee, 'entryFee', { allowMissing: true }),
    capacity: safeInteger(form?.capacity, 'capacity', { max: 10_000 }),
    suggestedRounds: safeInteger(form?.suggestedRounds, 'suggestedRounds', { max: 50 }),
    suggestedTopCut: (() => {
      const value = safeInteger(form?.suggestedTopCut, 'suggestedTopCut', { max: 16 });
      if (!TOP_CUTS.has(value)) throw new Error('INVALID_SUGGESTED_TOP_CUT');
      return value;
    })(),
  };
}
