import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { createPreRegistrationService, ServiceError } from './src/service.js';

if (!getApps().length) initializeApp();

const registrationHmacKey = defineSecret('CALENDAR_REGISTRATION_HMAC_KEY');
const callableOptions = {
  region: 'asia-east1',
  secrets: [registrationHmacKey],
  enforceAppCheck: false,
};

function functionService() {
  return createPreRegistrationService({
    db: getFirestore(),
    FieldValue,
    Timestamp,
    secret: registrationHmacKey.value(),
  });
}

function callableClientIp(request) {
  const address = request.rawRequest?.ip || request.rawRequest?.socket?.remoteAddress;
  if (address) return address;
  return process.env.FUNCTIONS_EMULATOR === 'true' ? '127.0.0.1' : undefined;
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
  return new HttpsError(status, publicCode);
}

export const submitTournamentPreRegistration = onCall(callableOptions, async (request) => {
  try {
    const result = await functionService().submit(request.data, callableClientIp(request));
    return {
      schemaVersion: 1,
      registrationId: result.registrationId,
      managementToken: result.managementToken,
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
