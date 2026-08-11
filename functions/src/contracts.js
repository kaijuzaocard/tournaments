export const APP_ID = 'kaijuzaocard-main';
export const SCHEMA_VERSION = 2;
export const LEGACY_SCHEMA_VERSION = 1;
export const MAX_CAPACITY = 256;
export const ACTIVE_STATUS = 'active';
export const WAITLISTED_STATUS = 'waitlisted';
export const CANCELLED_STATUS = 'cancelled';
export const LIVE_STATUSES = Object.freeze([ACTIVE_STATUS, WAITLISTED_STATUS]);

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const hasControlCharacters = (value) => Array.from(value)
  .some((character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127);
const SUBMIT_BASE_FIELDS = Object.freeze([
  'calendarEventId',
  'deckName',
  'honorId',
  'officialId',
  'playerName',
  'requestId',
]);
const MANAGE_BASE_FIELDS = Object.freeze([
  'action',
  'calendarEventId',
  'managementToken',
  'registrationId',
]);
const CUSTOMER_FIELDS = Object.freeze(['playerName', 'officialId', 'deckName', 'honorId']);

export class ContractError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'ContractError';
    this.code = code;
  }
}

function assertPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractError('INVALID_PAYLOAD');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new ContractError('INVALID_PAYLOAD');
}

function assertExactKeys(value, expected) {
  assertPlainObject(value);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new ContractError('UNKNOWN_OR_MISSING_FIELDS');
  }
}

function safeId(value, field) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!SAFE_ID.test(normalized)) throw new ContractError(`INVALID_${field.toUpperCase()}`);
  return normalized;
}

function safeText(value, field, { required = false, max }) {
  if (typeof value !== 'string') throw new ContractError(`INVALID_${field.toUpperCase()}`);
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > max || hasControlCharacters(normalized)) {
    throw new ContractError(`INVALID_${field.toUpperCase()}`);
  }
  return normalized;
}

export function normalizeCustomerFields(value) {
  return {
    playerName: safeText(value.playerName, 'player_name', { required: true, max: 40 }),
    officialId: safeText(value.officialId, 'official_id', { max: 40 }),
    deckName: safeText(value.deckName, 'deck_name', { max: 80 }),
    honorId: safeText(value.honorId, 'honor_id', { max: 40 }),
  };
}

export function validateSubmitPayload(value) {
  assertPlainObject(value);
  const actual = Object.keys(value).sort();
  const expected = [...SUBMIT_BASE_FIELDS, ...(Object.hasOwn(value, 'allowWaitlist') ? ['allowWaitlist'] : [])].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ContractError('UNKNOWN_OR_MISSING_FIELDS');
  }
  if (Object.hasOwn(value, 'allowWaitlist') && typeof value.allowWaitlist !== 'boolean') {
    throw new ContractError('INVALID_ALLOW_WAITLIST');
  }
  return {
    requestId: safeId(value.requestId, 'request_id'),
    calendarEventId: safeId(value.calendarEventId, 'calendar_event_id'),
    allowWaitlist: value.allowWaitlist === true,
    ...normalizeCustomerFields(value),
  };
}

export function validateManagePayload(value) {
  assertPlainObject(value);
  const action = value.action;
  if (!['get', 'update', 'cancel'].includes(action)) throw new ContractError('INVALID_ACTION');
  const expected = action === 'update' ? [...MANAGE_BASE_FIELDS, ...CUSTOMER_FIELDS] : MANAGE_BASE_FIELDS;
  assertExactKeys(value, expected);
  const managementToken = typeof value.managementToken === 'string' ? value.managementToken.trim() : '';
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(managementToken)) throw new ContractError('REGISTRATION_NOT_FOUND');
  const result = {
    action,
    calendarEventId: safeId(value.calendarEventId, 'calendar_event_id'),
    registrationId: safeId(value.registrationId, 'registration_id'),
    managementToken,
  };
  if (action === 'update') Object.assign(result, normalizeCustomerFields(value));
  return result;
}

export function classifyPreRegistrationConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'disabled' };
  const keys = Object.keys(value).sort();
  const hasVersion = Object.hasOwn(value, 'schemaVersion');
  const isLegacy = !hasVersion || value.schemaVersion === LEGACY_SCHEMA_VERSION;
  const isCurrent = value.schemaVersion === SCHEMA_VERSION;
  const allowed = isLegacy
    ? (hasVersion ? ['capacity', 'deadline', 'enabled', 'schemaVersion'] : ['capacity', 'deadline', 'enabled'])
    : ['capacity', 'deadline', 'enabled', 'schemaVersion', 'waitlistEnabled'];
  const required = isCurrent
    ? ['capacity', 'deadline', 'enabled', 'schemaVersion']
    : allowed;
  if ((!isLegacy && !isCurrent)
    || required.some((key) => !Object.hasOwn(value, key))
    || keys.some((key) => !allowed.includes(key))) {
    return { status: 'malformed' };
  }
  if (typeof value.enabled !== 'boolean') return { status: 'malformed' };
  if (!Number.isSafeInteger(value.capacity) || value.capacity < 1 || value.capacity > MAX_CAPACITY) {
    return { status: 'malformed' };
  }
  const deadline = value.deadline;
  if (deadline !== null && typeof deadline?.toMillis !== 'function') return { status: 'malformed' };
  return {
    status: value.enabled ? 'enabled' : 'disabled',
    capacity: value.capacity,
    deadline,
    waitlistEnabled: !isLegacy && value.waitlistEnabled === true,
  };
}

export function eventStartMillis(event) {
  const date = String(event?.date || '').trim();
  const time = String(event?.time || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const millis = Date.parse(`${date}T${time}:00+08:00`);
  return Number.isNaN(millis) ? null : millis;
}

export function normalizeIdentity(fields) {
  return normalizeIdentities(fields)[0] ?? null;
}

export function normalizeIdentities(fields) {
  const normalize = (value) => String(value || '').normalize('NFKC').trim().toUpperCase().replace(/\s+/g, '');
  const officialId = normalize(fields?.officialId);
  const honorId = normalize(fields?.honorId);
  return [
    ...(officialId ? [`official:${officialId}`] : []),
    ...(honorId ? [`honor:${honorId}`] : []),
  ];
}

export function isLiveRegistrationStatus(status) {
  return LIVE_STATUSES.includes(status);
}

export function classifyRegistrationManagementPolicy(event, nowMillis) {
  const start = eventStartMillis(event);
  if (start === null) return { state: 'configuration_error', canUpdate: false, canCancel: false };
  if (start <= nowMillis) return { state: 'event_started', canUpdate: false, canCancel: false };

  const config = classifyPreRegistrationConfig(event.preRegistration);
  if (config.status === 'malformed') return { state: 'configuration_error', canUpdate: false, canCancel: true };
  if (config.status !== 'enabled') return { state: 'closed', canUpdate: false, canCancel: true };
  if (config.deadline && config.deadline.toMillis() <= nowMillis) {
    return { state: 'deadline_passed', canUpdate: false, canCancel: true };
  }
  return { state: 'open', canUpdate: true, canCancel: true };
}

export function publicRegistration(
  entry,
  policy = { state: 'open', canUpdate: true, canCancel: true },
  rankResult = { state: 'not_applicable', rank: null },
) {
  const live = isLiveRegistrationStatus(entry.status);
  const waitlistRankState = entry.status === WAITLISTED_STATUS && rankResult?.state === 'available'
    ? 'available'
    : entry.status === WAITLISTED_STATUS ? 'unavailable' : 'not_applicable';
  return {
    schemaVersion: SCHEMA_VERSION,
    registrationId: entry.registrationId,
    playerName: entry.playerName,
    officialId: entry.officialId,
    deckName: entry.deckName,
    honorId: entry.honorId,
    status: entry.status,
    waitlistRank: waitlistRankState === 'available'
      && Number.isSafeInteger(rankResult.rank) && rankResult.rank > 0
      ? rankResult.rank
      : null,
    waitlistRankState,
    createdAt: entry.createdAt?.toDate?.().toISOString?.() ?? null,
    updatedAt: entry.updatedAt?.toDate?.().toISOString?.() ?? null,
    cancelledAt: entry.cancelledAt?.toDate?.().toISOString?.() ?? null,
    managementState: policy.state,
    canUpdate: live && policy.canUpdate,
    canCancel: live && policy.canCancel,
  };
}
