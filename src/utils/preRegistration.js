export const PRE_REGISTRATION_SCHEMA_VERSION = 2;
export const PRE_REGISTRATION_LEGACY_SCHEMA_VERSION = 1;
export const PRE_REGISTRATION_MAX_CAPACITY = 256;
export const PRE_REGISTRATION_ENTRY_FIELDS = Object.freeze([
  'requestId',
  'calendarEventId',
  'playerName',
  'officialId',
  'deckName',
  'honorId',
]);

const hasControlCharacters = (value) => Array.from(value)
  .some((character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127);

function asSafeInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value === 'boolean' || value === '' || value == null) return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) return null;
  return number;
}

function toMillis(value) {
  if (value == null) return null;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const millis = new Date(value).getTime();
    return Number.isNaN(millis) ? null : millis;
  }
  if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
  return null;
}

export function normalizePreRegistrationSettings(value, eventCapacity = 0) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const enabled = source.enabled === true;
  const fallbackCapacity = asSafeInteger(eventCapacity, { min: 1, max: PRE_REGISTRATION_MAX_CAPACITY });
  const hasExplicitCapacity = source.capacity !== '' && source.capacity != null;
  const explicitCapacity = asSafeInteger(source.capacity, { min: 1, max: PRE_REGISTRATION_MAX_CAPACITY });
  const capacity = hasExplicitCapacity ? (explicitCapacity ?? 0) : (fallbackCapacity ?? 0);
  const deadline = source.deadline ?? null;
  return {
    schemaVersion: PRE_REGISTRATION_SCHEMA_VERSION,
    enabled,
    waitlistEnabled: source.waitlistEnabled === true,
    capacity,
    deadline,
  };
}

export function validatePreRegistrationSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'INVALID_PRE_REGISTRATION' };
  const keys = Object.keys(value).sort();
  const hasVersion = Object.prototype.hasOwnProperty.call(value, 'schemaVersion');
  const isLegacy = !hasVersion || value.schemaVersion === PRE_REGISTRATION_LEGACY_SCHEMA_VERSION;
  const isCurrent = value.schemaVersion === PRE_REGISTRATION_SCHEMA_VERSION;
  const allowed = isLegacy
    ? (hasVersion ? ['capacity', 'deadline', 'enabled', 'schemaVersion'] : ['capacity', 'deadline', 'enabled'])
    : ['capacity', 'deadline', 'enabled', 'schemaVersion', 'waitlistEnabled'];
  const required = isCurrent
    ? ['capacity', 'deadline', 'enabled', 'schemaVersion']
    : allowed;
  if ((!isLegacy && !isCurrent)
    || required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
    || keys.some((key) => !allowed.includes(key))) {
    return { ok: false, error: 'INVALID_PRE_REGISTRATION_FIELDS' };
  }
  if (typeof value.enabled !== 'boolean') {
    return { ok: false, error: 'INVALID_PRE_REGISTRATION' };
  }
  const capacity = typeof value.capacity === 'number'
    ? asSafeInteger(value.capacity, { min: 1, max: PRE_REGISTRATION_MAX_CAPACITY })
    : null;
  if (!capacity) return { ok: false, error: 'INVALID_PRE_REGISTRATION_CAPACITY' };
  if (value.deadline !== null && typeof value.deadline?.toMillis !== 'function') {
    return { ok: false, error: 'INVALID_PRE_REGISTRATION_DEADLINE' };
  }
  return {
    ok: true,
    value: {
      ...value,
      schemaVersion: isLegacy ? PRE_REGISTRATION_LEGACY_SCHEMA_VERSION : PRE_REGISTRATION_SCHEMA_VERSION,
      capacity,
      waitlistEnabled: !isLegacy && value.waitlistEnabled === true,
    },
  };
}

export function parseTaipeiDateTimeLocal(value) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) return null;
  const millis = Date.parse(`${normalized}:00+08:00`);
  return Number.isNaN(millis) ? null : millis;
}

export function formatTaipeiDateTimeLocal(value) {
  const millis = toMillis(value);
  if (millis === null) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(millis));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function preparePreRegistrationForWrite(form, eventCapacity = 0, timestampFromMillis = (value) => new Date(value)) {
  const normalized = normalizePreRegistrationSettings(form?.preRegistration, eventCapacity);
  const rawDeadline = form?.preRegistration?.deadline;
  if (typeof rawDeadline === 'string' && rawDeadline.trim()) {
    const millis = parseTaipeiDateTimeLocal(rawDeadline);
    if (millis === null) throw new Error('INVALID_PRE_REGISTRATION_DEADLINE');
    normalized.deadline = timestampFromMillis(millis);
  }
  if (!normalized.enabled && normalized.capacity === 0) return null;
  const validation = validatePreRegistrationSettings(normalized);
  if (!validation.ok) throw new Error(validation.error);
  return validation.value;
}

export function eventStartMillis(event) {
  const date = String(event?.date || '').trim();
  const time = String(event?.time || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const millis = Date.parse(`${date}T${time}:00+08:00`);
  return Number.isNaN(millis) ? null : millis;
}

export function normalizePreRegistrationStats(value) {
  if (typeof value === 'number') {
    return { activeCount: asSafeInteger(value, { min: 0 }) ?? 0, waitlistedCount: 0 };
  }
  return {
    activeCount: asSafeInteger(value?.activeCount, { min: 0 }) ?? 0,
    waitlistedCount: asSafeInteger(value?.waitlistedCount, { min: 0 }) ?? 0,
  };
}

export function classifyPreRegistrationAvailability(event, stats = 0, now = Date.now()) {
  const fieldPresent = Object.prototype.hasOwnProperty.call(event ?? {}, 'preRegistration');
  const counts = normalizePreRegistrationStats(stats);
  if (!fieldPresent) return { status: 'not_open', ...counts, capacity: 0 };
  const validation = validatePreRegistrationSettings(event.preRegistration);
  if (!validation.ok) return { status: 'malformed', error: validation.error, ...counts, capacity: 0 };
  const settings = validation.value;
  const start = eventStartMillis(event);
  const summary = { ...counts, capacity: settings.capacity, settings };
  if (start !== null && start <= now) return { status: 'ended', ...summary };
  if (!settings.enabled) return { status: 'closed', ...summary };
  const deadline = toMillis(settings.deadline);
  if (deadline !== null && deadline <= now) return { status: 'deadline', ...summary };
  if (counts.activeCount >= settings.capacity) {
    return { status: settings.waitlistEnabled ? 'waitlist' : 'full', ...summary };
  }
  return { status: 'open', ...summary };
}

export function normalizeCustomerFields(value) {
  const limits = { playerName: 40, officialId: 40, deckName: 80, honorId: 40 };
  const result = {};
  for (const [field, max] of Object.entries(limits)) {
    if (typeof value?.[field] !== 'string') throw new Error(`INVALID_${field.toUpperCase()}`);
    const normalized = value[field].trim();
    if (hasControlCharacters(normalized) || normalized.length > max || (field === 'playerName' && !normalized)) {
      throw new Error(`INVALID_${field.toUpperCase()}`);
    }
    result[field] = normalized;
  }
  return result;
}

export function createRequestId(cryptoObject = globalThis.crypto) {
  if (typeof cryptoObject?.randomUUID !== 'function') throw new Error('SECURE_RANDOM_UNAVAILABLE');
  return cryptoObject.randomUUID();
}

export function shortenRegistrationId(value) {
  const id = String(value || '');
  return id.length <= 12 ? id : `${id.slice(0, 6)}...${id.slice(-4)}`;
}

export function buildManagementUrl({ origin, calendarEventId, registrationId, managementToken }) {
  const url = new URL(origin);
  url.searchParams.set('event', calendarEventId);
  url.searchParams.set('registration', registrationId);
  url.hash = new URLSearchParams({ manage: managementToken }).toString();
  return url.toString();
}

export function extractCallableErrorDetails(error) {
  const details = error?.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  if (details.code !== 'PRE_REGISTRATION_FULL') return null;
  return {
    code: 'PRE_REGISTRATION_FULL',
    waitlistAvailable: details.waitlistAvailable === true,
  };
}

export function extractCallableErrorCode(error) {
  const details = extractCallableErrorDetails(error);
  if (details) return details.code;
  for (const candidate of [error?.message, error?.code]) {
    if (typeof candidate !== 'string') continue;
    const match = candidate.match(/([A-Z][A-Z0-9_]{2,80})$/);
    if (match) return match[1];
  }
  return 'UNKNOWN_ERROR';
}

export function removePreRegistrationSecrets(entry) {
  const status = ['active', 'waitlisted', 'cancelled'].includes(entry?.status) ? entry.status : 'invalid';
  return {
    registrationId: String(entry?.registrationId || ''),
    playerName: String(entry?.playerName || ''),
    officialId: String(entry?.officialId || ''),
    deckName: String(entry?.deckName || ''),
    honorId: String(entry?.honorId || ''),
    status,
    waitlistSequence: Number.isSafeInteger(entry?.waitlistSequence) && entry.waitlistSequence > 0
      ? entry.waitlistSequence
      : null,
    waitlistRank: Number.isSafeInteger(entry?.waitlistRank) && entry.waitlistRank > 0
      ? entry.waitlistRank
      : null,
    waitlistRankState: entry?.status === 'waitlisted'
      && entry?.waitlistRankState === 'available'
      && Number.isSafeInteger(entry?.waitlistRank)
      && entry.waitlistRank > 0
      ? 'available'
      : entry?.status === 'waitlisted' ? 'unavailable' : 'not_applicable',
    createdAt: entry?.createdAt ?? null,
    updatedAt: entry?.updatedAt ?? null,
    cancelledAt: entry?.cancelledAt ?? null,
    importedAt: entry?.importedAt ?? null,
    importedTournamentId: String(entry?.importedTournamentId || ''),
    handoffRevision: Number.isSafeInteger(entry?.handoffRevision) ? entry.handoffRevision : null,
    managementState: ['open', 'closed', 'deadline_passed', 'event_started', 'configuration_error'].includes(entry?.managementState)
      ? entry.managementState
      : 'configuration_error',
    canUpdate: entry?.canUpdate === true,
    canCancel: entry?.canCancel === true,
  };
}

export function deriveWaitlistRanks(entries) {
  const waitlisted = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.status === 'waitlisted');
  const sequences = new Set();
  for (const entry of waitlisted) {
    if (!Number.isSafeInteger(entry.waitlistSequence)
      || entry.waitlistSequence < 1
      || sequences.has(entry.waitlistSequence)) return {};
    sequences.add(entry.waitlistSequence);
  }
  waitlisted.sort((left, right) => left.waitlistSequence - right.waitlistSequence
    || String(left.registrationId).localeCompare(String(right.registrationId)));
  return Object.fromEntries(waitlisted.map((entry, index) => [entry.registrationId, index + 1]));
}

export function registrationStatusLabel(status, waitlistRank = null, waitlistRankState = 'available') {
  if (status === 'active') return '正取';
  if (status === 'waitlisted') {
    if (waitlistRankState === 'unavailable') return '候補 · 順位暫時無法計算';
    return Number.isSafeInteger(waitlistRank) && waitlistRank > 0
      ? `候補 · 目前候補第 ${waitlistRank} 位`
      : '候補';
  }
  if (status === 'cancelled') return '已取消';
  return '資料異常';
}
