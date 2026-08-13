import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { createPreRegistrationService, ServiceError } from './src/service.js';
import { SCHEMA_VERSION } from './src/contracts.js';
import {
  HandoffServiceError,
  createTournamentPreRegistrationHandoffService,
} from './src/handoffService.js';
import {
  isCalendarAdminAuth,
  parseAdminUids,
  parseExactOriginAllowlist,
} from './src/handoffContracts.js';

if (!getApps().length) initializeApp();

const registrationHmacKey = defineSecret('CALENDAR_REGISTRATION_HMAC_KEY');
const swissHandoffHmacKey = defineSecret('CALENDAR_SWISS_HANDOFF_HMAC_KEY');
const calendarAdminUids = defineString('CALENDAR_ADMIN_UIDS', { default: '' });
const swissHandoffAllowedOrigins = defineString('CALENDAR_SWISS_HANDOFF_ALLOWED_ORIGINS', { default: '' });
const callableOptions = {
  region: 'asia-east1',
  secrets: [registrationHmacKey],
  enforceAppCheck: false,
};
const handoffCallableOptions = {
  region: 'asia-east1',
  secrets: [swissHandoffHmacKey],
  enforceAppCheck: false,
};
const handoffHttpOptions = {
  region: 'asia-east1',
  secrets: [swissHandoffHmacKey],
  cors: false,
};

function functionService() {
  return createPreRegistrationService({
    db: getFirestore(),
    FieldValue,
    Timestamp,
    secret: registrationHmacKey.value(),
  });
}

function handoffService() {
  return createTournamentPreRegistrationHandoffService({
    db: getFirestore(),
    FieldValue,
    Timestamp,
    secret: swissHandoffHmacKey.value(),
    allowedOrigins: parseExactOriginAllowlist(swissHandoffAllowedOrigins.value()),
  });
}

function callableClientIp(request) {
  const address = request.rawRequest?.ip || request.rawRequest?.socket?.remoteAddress;
  if (address) return address;
  return process.env.FUNCTIONS_EMULATOR === 'true' ? '127.0.0.1' : undefined;
}

function requireCalendarAdmin(request) {
  if (!isCalendarAdminAuth(request.auth, parseAdminUids(calendarAdminUids.value()))) {
    throw new HttpsError('permission-denied', 'CALENDAR_ADMIN_REQUIRED');
  }
}

function handoffCallableError(error) {
  const code = error instanceof HandoffServiceError ? error.code : 'INTERNAL_ERROR';
  const expected = new Set([
    'CLAIM_MISMATCH',
    'CLAIM_EXPIRED',
    'COMPLETE_PAYLOAD_MISMATCH',
    'EVENT_NOT_FOUND',
    'EVENT_NAME_INVALID',
    'EVENT_SCHEDULE_INVALID',
    'EVENT_STARTED',
    'HANDOFF_ALREADY_CLAIMED',
    'HANDOFF_ALREADY_COMPLETED',
    'HANDOFF_NOT_FOUND',
    'IMPORTED_REGISTRATION_OUT_OF_SCOPE',
    'NO_IMPORTABLE_REGISTRATIONS',
    'ORIGIN_NOT_ALLOWED',
    'RATE_LIMITED',
    'REGISTRATION_EVENT_MISMATCH',
    'REGISTRATION_IMPORT_CONFLICT',
    'REGISTRATION_NOT_ACTIVE',
    'REGISTRATION_NOT_FOUND',
    'REQUEST_ID_PAYLOAD_MISMATCH',
    'SWISS_INTEGRATION_REQUIRED',
    'TARGET_TOURNAMENT_MISMATCH',
    'UNKNOWN_OR_MISSING_FIELDS',
  ]);
  const publicCode = expected.has(code) || code.startsWith('INVALID_') || code.startsWith('DUPLICATE_')
    ? code
    : 'INTERNAL_ERROR';
  const status = publicCode === 'RATE_LIMITED' ? 'resource-exhausted'
    : publicCode === 'HANDOFF_NOT_FOUND' ? 'not-found'
      : publicCode === 'ORIGIN_NOT_ALLOWED' || publicCode === 'CALENDAR_ADMIN_REQUIRED' ? 'permission-denied'
        : publicCode === 'INTERNAL_ERROR' ? 'internal' : 'failed-precondition';
  if (publicCode === 'INTERNAL_ERROR') console.error('Calendar Swiss preregistration handoff failed', { code: error?.name || code });
  return new HttpsError(status, publicCode);
}

function callableHttpError(error) {
  const callable = handoffCallableError(error);
  const statusByCode = {
    'failed-precondition': [400, 'FAILED_PRECONDITION'],
    'permission-denied': [403, 'PERMISSION_DENIED'],
    'not-found': [404, 'NOT_FOUND'],
    'resource-exhausted': [429, 'RESOURCE_EXHAUSTED'],
    internal: [500, 'INTERNAL'],
  };
  const [httpStatus, status] = statusByCode[callable.code] || statusByCode.internal;
  return {
    httpStatus,
    body: { error: { status, message: callable.message } },
  };
}

function applyExactHandoffCors(request, response) {
  const origin = String(request.headers.origin || '');
  const allowed = parseExactOriginAllowlist(swissHandoffAllowedOrigins.value());
  if (!origin || !allowed.has(origin)) return false;
  response.set('Access-Control-Allow-Origin', origin);
  response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.set('Access-Control-Allow-Headers', 'Content-Type');
  response.set('Access-Control-Max-Age', '3600');
  response.set('Vary', 'Origin');
  return true;
}

function callableError(error) {
  const code = error instanceof ServiceError ? error.code : 'INTERNAL_ERROR';
  const expected = new Set([
    'EVENT_NOT_FOUND',
    'EVENT_UNAVAILABLE',
    'EVENT_ENDED',
    'EVENT_SCHEDULE_INVALID',
    'PRE_REGISTRATION_CLOSED',
    'PRE_REGISTRATION_CONFIG_INVALID',
    'PRE_REGISTRATION_DEADLINE_PASSED',
    'PRE_REGISTRATION_FULL',
    'OFFICIAL_ID_CONFLICT',
    'HONOR_ID_CONFLICT',
    'POSSIBLE_DUPLICATE_REGISTRATION',
    'REQUEST_ID_PAYLOAD_MISMATCH',
    'REGISTRATION_NOT_FOUND',
    'REGISTRATION_NOT_ACTIVE',
    'REGISTRATION_UPDATE_CLOSED',
    'REGISTRATION_CANCELLATION_CLOSED',
    'RATE_LIMITED',
    'UNKNOWN_OR_MISSING_FIELDS',
  ]);
  const publicCode = expected.has(code) || code.startsWith('INVALID_') ? code : 'INTERNAL_ERROR';
  const status = publicCode === 'RATE_LIMITED' ? 'resource-exhausted'
    : publicCode === 'INTERNAL_ERROR' ? 'internal'
      : publicCode === 'REGISTRATION_NOT_FOUND' ? 'not-found'
        : 'failed-precondition';
  if (publicCode === 'INTERNAL_ERROR') {
    const safeCode = typeof error?.code === 'string' && /^[A-Z0-9_.:-]{1,80}$/i.test(error.code)
      ? error.code
      : null;
    const safeMessage = typeof error?.message === 'string' && /^[A-Z0-9_.:-]{1,80}$/.test(error.message)
      ? error.message
      : null;
    const diagnosticCode = safeCode || safeMessage || error?.name || 'UnknownError';
    console.error('Calendar pre-registration callable failed', { code, diagnosticCode });
  }
  const details = error instanceof ServiceError && publicCode === error.code
    ? error.publicDetails
    : undefined;
  return new HttpsError(status, publicCode, details);
}

export const submitTournamentPreRegistration = onCall(callableOptions, async (request) => {
  try {
    const result = await functionService().submit(request.data, callableClientIp(request));
    return {
      schemaVersion: SCHEMA_VERSION,
      registrationId: result.registrationId,
      managementToken: result.managementToken,
      status: result.status,
      waitlistRank: result.waitlistRank,
      waitlistRankState: result.waitlistRankState,
      replayed: result.replayed,
    };
  } catch (error) {
    throw callableError(error);
  }
});

export const manageTournamentPreRegistration = onCall(callableOptions, async (request) => {
  try {
    return await functionService().manage(request.data, callableClientIp(request));
  } catch (error) {
    throw callableError(error);
  }
});

export const adminManageTournamentPreRegistration = onCall(callableOptions, async (request) => {
  try {
    requireCalendarAdmin(request);
    return await functionService().adminManage(request.data);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw callableError(error);
  }
});

export const createTournamentPreRegistrationHandoff = onCall(handoffCallableOptions, async (request) => {
  try {
    requireCalendarAdmin(request);
    return await handoffService().create(request.data);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw handoffCallableError(error);
  }
});

export const manageTournamentPreRegistrationHandoff = onRequest(handoffHttpOptions, async (request, response) => {
  if (!applyExactHandoffCors(request, response)) {
    response.status(403).json({ error: { status: 'PERMISSION_DENIED', message: 'ORIGIN_NOT_ALLOWED' } });
    return;
  }
  if (request.method === 'OPTIONS') {
    response.status(204).send('');
    return;
  }
  if (request.method !== 'POST') {
    response.status(405).json({ error: { status: 'INVALID_ARGUMENT', message: 'INVALID_CALLABLE_REQUEST' } });
    return;
  }
  try {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.getPrototypeOf(body) !== Object.prototype
      || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'data')) {
      throw new HandoffServiceError('INVALID_CALLABLE_REQUEST');
    }
    const result = await handoffService().manage(
      body.data,
      callableClientIp({ rawRequest: request }),
      request.headers.origin,
    );
    response.status(200).json({ data: result });
  } catch (error) {
    const safe = callableHttpError(error);
    response.status(safe.httpStatus).json(safe.body);
  }
});

export const getTournamentPreRegistrationHandoffStatus = onCall(handoffCallableOptions, async (request) => {
  try {
    requireCalendarAdmin(request);
    return await handoffService().status(request.data);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw handoffCallableError(error);
  }
});
