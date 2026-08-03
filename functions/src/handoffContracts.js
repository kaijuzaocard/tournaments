import { eventStartMillis } from './contracts.js';

export const HANDOFF_SCHEMA_VERSION = 1;
export const HANDOFF_MAX_SELECTION = 128;
export const HANDOFF_TTL_MS = 10 * 60 * 1000;
export const CLAIM_LEASE_MS = 5 * 60 * 1000;
export const COMPLETED_HANDOFF_RETENTION_MS = 24 * 60 * 60 * 1000;
export const HANDOFF_OPERATION_TTL_MS = 24 * 60 * 60 * 1000;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
const CREATE_FIELDS = Object.freeze(['requestId', 'calendarEventId', 'selectedRegistrationIds']);
const STATUS_FIELDS = Object.freeze(['handoffId', 'calendarEventId']);
const MANAGE_FIELDS = Object.freeze({
  claim: ['action', 'handoffId', 'handoffToken', 'claimId'],
  release: ['action', 'handoffId', 'handoffToken', 'claimId'],
  complete: [
    'action',
    'handoffId',
    'handoffToken',
    'claimId',
    'targetSwissTournamentId',
    'newlyImportedRegistrationIds',
    'reconciledRegistrationIds',
  ],
});

export class HandoffContractError extends Error {
  constructor(code) {
    super(code);
    this.name = 'HandoffContractError';
    this.code = code;
  }
}

function assertPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HandoffContractError('INVALID_PAYLOAD');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new HandoffContractError('INVALID_PAYLOAD');
}

function assertExactKeys(value, expected) {
  assertPlainObject(value);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new HandoffContractError('UNKNOWN_OR_MISSING_FIELDS');
  }
}

function safeId(value, field) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!SAFE_ID.test(normalized)) throw new HandoffContractError(`INVALID_${field.toUpperCase()}`);
  return normalized;
}

function safeToken(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!TOKEN.test(normalized)) throw new HandoffContractError('HANDOFF_NOT_FOUND');
  return normalized;
}

function uniqueIds(value, field, { max = HANDOFF_MAX_SELECTION, min = 1 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new HandoffContractError(`INVALID_${field.toUpperCase()}`);
  }
  const normalized = value.map((item) => safeId(item, field.replace(/s$/u, '')));
  if (new Set(normalized).size !== normalized.length) throw new HandoffContractError(`DUPLICATE_${field.toUpperCase()}`);
  return normalized.sort();
}

export function validateCreateHandoffPayload(value) {
  assertExactKeys(value, CREATE_FIELDS);
  return {
    requestId: safeId(value.requestId, 'request_id'),
    calendarEventId: safeId(value.calendarEventId, 'calendar_event_id'),
    selectedRegistrationIds: uniqueIds(value.selectedRegistrationIds, 'registration_ids'),
  };
}

export function validateStatusHandoffPayload(value) {
  assertExactKeys(value, STATUS_FIELDS);
  return {
    handoffId: safeId(value.handoffId, 'handoff_id'),
    calendarEventId: safeId(value.calendarEventId, 'calendar_event_id'),
  };
}

export function validateManageHandoffPayload(value) {
  assertPlainObject(value);
  const action = value.action;
  if (!Object.hasOwn(MANAGE_FIELDS, action)) throw new HandoffContractError('INVALID_ACTION');
  assertExactKeys(value, MANAGE_FIELDS[action]);
  const result = {
    action,
    handoffId: safeId(value.handoffId, 'handoff_id'),
    handoffToken: safeToken(value.handoffToken),
    claimId: safeId(value.claimId, 'claim_id'),
  };
  if (action === 'complete') {
    result.targetSwissTournamentId = safeId(value.targetSwissTournamentId, 'target_swiss_tournament_id');
    result.newlyImportedRegistrationIds = uniqueIds(
      value.newlyImportedRegistrationIds,
      'newly_imported_registration_ids',
      { min: 0 },
    );
    result.reconciledRegistrationIds = uniqueIds(
      value.reconciledRegistrationIds,
      'reconciled_registration_ids',
      { min: 0 },
    );
    const allIds = [...result.newlyImportedRegistrationIds, ...result.reconciledRegistrationIds];
    if (allIds.length < 1 || allIds.length > HANDOFF_MAX_SELECTION) {
      throw new HandoffContractError('INVALID_IMPORTED_REGISTRATION_IDS');
    }
    if (new Set(allIds).size !== allIds.length) {
      throw new HandoffContractError('DUPLICATE_IMPORTED_REGISTRATION_IDS');
    }
  }
  return result;
}

export function parseExactOriginAllowlist(rawValue) {
  const origins = new Set();
  String(rawValue || '').split(',').map((item) => item.trim()).filter(Boolean).forEach((item) => {
    if (item === '*' || item.includes('*')) throw new HandoffContractError('INVALID_ORIGIN_CONFIGURATION');
    let url;
    try { url = new URL(item); } catch { throw new HandoffContractError('INVALID_ORIGIN_CONFIGURATION'); }
    if (!['https:', 'http:'].includes(url.protocol)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || url.origin !== item.replace(/\/$/u, '')) {
      throw new HandoffContractError('INVALID_ORIGIN_CONFIGURATION');
    }
    origins.add(url.origin);
  });
  if (!origins.size) throw new HandoffContractError('INVALID_ORIGIN_CONFIGURATION');
  return origins;
}

export function assertAllowedOrigin(origin, allowedOrigins) {
  let normalized = '';
  try { normalized = new URL(String(origin || '')).origin; } catch { /* rejected below */ }
  if (!normalized || normalized !== origin || !allowedOrigins?.has(normalized)) {
    throw new HandoffContractError('ORIGIN_NOT_ALLOWED');
  }
  return normalized;
}

export function parseAdminUids(rawValue) {
  return new Set(String(rawValue || '').split(',').map((uid) => uid.trim()).filter(Boolean));
}

export function isCalendarAdminAuth(auth, configuredUids) {
  const provider = auth?.token?.firebase?.sign_in_provider;
  return provider === 'google.com' && typeof auth?.uid === 'string' && configuredUids?.has(auth.uid);
}

export function classifyLinkedSwissIntegration(value) {
  const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : [];
  if (keys.join(',') !== 'linkedAt,schemaVersion,swissTournamentId') return { status: 'malformed' };
  const tournamentId = typeof value.swissTournamentId === 'string' ? value.swissTournamentId.trim() : '';
  if (value.schemaVersion !== 1 || !SAFE_ID.test(tournamentId) || typeof value.linkedAt?.toMillis !== 'function') {
    return { status: 'malformed' };
  }
  return { status: 'linked', tournamentId };
}

export function assertFutureLinkedEvent(event, nowMillis) {
  const start = eventStartMillis(event);
  if (start === null) throw new HandoffContractError('EVENT_SCHEDULE_INVALID');
  if (start <= nowMillis) throw new HandoffContractError('EVENT_STARTED');
  const integration = classifyLinkedSwissIntegration(event?.swissIntegration);
  if (integration.status !== 'linked') throw new HandoffContractError('SWISS_INTEGRATION_REQUIRED');
  return { start, targetSwissTournamentId: integration.tournamentId };
}
