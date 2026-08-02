import {
  ACTIVE_STATUS,
  APP_ID,
  CANCELLED_STATUS,
  ContractError,
  SCHEMA_VERSION,
  classifyPreRegistrationConfig,
  classifyRegistrationManagementPolicy,
  eventStartMillis,
  normalizeIdentity,
  publicRegistration,
  validateManagePayload,
  validateSubmitPayload,
} from './contracts.js';
import {
  deterministicCredentials,
  hashManagementToken,
  hmac,
  normalizeTrustedIp,
  stableJson,
  tokensEqual,
} from './security.js';

export class ServiceError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
  }
}

function asServiceError(error) {
  if (error instanceof ServiceError) return error;
  if (error instanceof ContractError) return new ServiceError(error.code);
  return error;
}

function assertEventAcceptsRegistration(event, nowMillis) {
  const config = classifyPreRegistrationConfig(event.preRegistration);
  if (config.status === 'malformed') throw new ServiceError('PRE_REGISTRATION_CONFIG_INVALID');
  if (config.status !== 'enabled') throw new ServiceError('PRE_REGISTRATION_CLOSED');
  if (config.deadline && config.deadline.toMillis() <= nowMillis) throw new ServiceError('PRE_REGISTRATION_DEADLINE_PASSED');
  const start = eventStartMillis(event);
  if (start === null) throw new ServiceError('EVENT_SCHEDULE_INVALID');
  if (start <= nowMillis) throw new ServiceError('EVENT_ENDED');
  return config;
}

export function createPreRegistrationService({ db, FieldValue, Timestamp, secret, now = () => Date.now() }) {
  const root = (...parts) => db.doc(['artifacts', APP_ID, ...parts].join('/'));
  const eventRef = (eventId) => root('public', 'data', 'monster_tournaments', eventId);
  const registrationRef = (eventId) => root('private', 'data', 'tournamentPreRegistrations', eventId);
  const entryRef = (eventId, registrationId) => registrationRef(eventId).collection('entries').doc(registrationId);
  const operationRef = (eventId, operationId) => registrationRef(eventId).collection('operations').doc(operationId);
  const identityRef = (eventId, identityHash) => registrationRef(eventId).collection('identities').doc(identityHash);
  const statsRef = (eventId) => root('public', 'data', 'tournamentPreRegistrationStats', eventId);
  const rateLimitRef = (id) => root('private', 'data', 'tournamentPreRegistrationRateLimits', id);

  async function consumeRateLimit({ scope, subject, limit, windowMs }) {
    const current = now();
    const windowStart = Math.floor(current / windowMs) * windowMs;
    const documentId = hmac(secret, 'rate-limit-id', `${scope}:${subject}:${windowStart}`);
    const reference = rateLimitRef(documentId);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const count = snapshot.exists ? snapshot.data().count : 0;
      if (!Number.isSafeInteger(count) || count < 0) throw new ServiceError('RATE_LIMIT_STATE_INVALID');
      if (count >= limit) throw new ServiceError('RATE_LIMITED');
      transaction.set(reference, {
        schemaVersion: SCHEMA_VERSION,
        scope,
        subjectHash: hmac(secret, 'rate-limit-subject', subject),
        windowStartedAt: Timestamp.fromMillis(windowStart),
        count: count + 1,
        expiresAt: Timestamp.fromMillis(windowStart + windowMs * 2),
      });
    });
  }

  async function findReplay(payload, operationId, fingerprint) {
    const snapshot = await operationRef(payload.calendarEventId, operationId).get();
    if (!snapshot.exists) return null;
    const operation = snapshot.data();
    if (operation.fingerprint !== fingerprint) throw new ServiceError('REQUEST_ID_PAYLOAD_MISMATCH');
    const credentials = deterministicCredentials(secret, payload.requestId, fingerprint);
    return { ...credentials, replayed: true };
  }

  async function submit(rawPayload, rawIp) {
    try {
      const payload = validateSubmitPayload(rawPayload);
      const canonical = stableJson(payload);
      const fingerprint = hmac(secret, 'payload-fingerprint', canonical);
      const operationId = hmac(secret, 'operation-id', payload.requestId);
      const replay = await findReplay(payload, operationId, fingerprint);
      if (replay) return replay;

      const ip = normalizeTrustedIp(rawIp);
      await consumeRateLimit({ scope: 'submit_ip', subject: ip, limit: 8, windowMs: 10 * 60 * 1000 });
      const identity = normalizeIdentity(payload);
      const identityHash = identity ? hmac(secret, 'identity', `${payload.calendarEventId}:${identity}`) : null;
      if (identityHash) {
        await consumeRateLimit({
          scope: 'submit_identity',
          subject: `${payload.calendarEventId}:${identity}`,
          limit: 3,
          windowMs: 60 * 60 * 1000,
        });
      }

      const credentials = deterministicCredentials(secret, payload.requestId, fingerprint);
      const created = await db.runTransaction(async (transaction) => {
        const eventSnapshot = await transaction.get(eventRef(payload.calendarEventId));
        if (!eventSnapshot.exists) throw new ServiceError('EVENT_NOT_FOUND');
        const config = assertEventAcceptsRegistration(eventSnapshot.data(), now());
        const operationReference = operationRef(payload.calendarEventId, operationId);
        const operationSnapshot = await transaction.get(operationReference);
        if (operationSnapshot.exists) {
          if (operationSnapshot.data().fingerprint !== fingerprint) throw new ServiceError('REQUEST_ID_PAYLOAD_MISMATCH');
          return false;
        }

        const aggregateReference = registrationRef(payload.calendarEventId);
        await transaction.get(aggregateReference);
        const entriesQuery = aggregateReference.collection('entries').where('status', '==', ACTIVE_STATUS);
        const activeSnapshot = await transaction.get(entriesQuery);
        const activeCount = activeSnapshot.size;
        if (activeCount >= config.capacity) throw new ServiceError('PRE_REGISTRATION_FULL');

        let duplicateReference = null;
        if (identityHash) {
          duplicateReference = identityRef(payload.calendarEventId, identityHash);
          const duplicateSnapshot = await transaction.get(duplicateReference);
          if (duplicateSnapshot.exists && duplicateSnapshot.data().status === ACTIVE_STATUS) {
            throw new ServiceError('POSSIBLE_DUPLICATE_REGISTRATION');
          }
        }

        const timestamp = FieldValue.serverTimestamp();
        const entry = {
          schemaVersion: SCHEMA_VERSION,
          registrationId: credentials.registrationId,
          calendarEventId: payload.calendarEventId,
          playerName: payload.playerName,
          officialId: payload.officialId,
          deckName: payload.deckName,
          honorId: payload.honorId,
          status: ACTIVE_STATUS,
          tokenHash: hashManagementToken(secret, credentials.managementToken),
          identityHash,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        transaction.create(entryRef(payload.calendarEventId, credentials.registrationId), entry);
        transaction.create(operationReference, {
          schemaVersion: SCHEMA_VERSION,
          fingerprint,
          registrationId: credentials.registrationId,
          createdAt: timestamp,
        });
        if (duplicateReference) {
          transaction.set(duplicateReference, {
            schemaVersion: SCHEMA_VERSION,
            registrationId: credentials.registrationId,
            status: ACTIVE_STATUS,
            updatedAt: timestamp,
          });
        }
        transaction.set(aggregateReference, {
          schemaVersion: SCHEMA_VERSION,
          activeCount: activeCount + 1,
          updatedAt: timestamp,
        }, { merge: true });
        transaction.set(statsRef(payload.calendarEventId), {
          schemaVersion: SCHEMA_VERSION,
          activeCount: activeCount + 1,
          updatedAt: timestamp,
        });
        return true;
      });

      return { ...credentials, replayed: !created };
    } catch (error) {
      throw asServiceError(error);
    }
  }

  async function getVerifiedEntryAndEvent(transaction, payload) {
    const reference = entryRef(payload.calendarEventId, payload.registrationId);
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new ServiceError('REGISTRATION_NOT_FOUND');
    const entry = snapshot.data();
    const presentedHash = hashManagementToken(secret, payload.managementToken);
    if (!tokensEqual(entry.tokenHash, presentedHash)) throw new ServiceError('REGISTRATION_NOT_FOUND');
    const eventSnapshot = await transaction.get(eventRef(payload.calendarEventId));
    if (!eventSnapshot.exists) throw new ServiceError('EVENT_UNAVAILABLE');
    const policy = classifyRegistrationManagementPolicy(eventSnapshot.data(), now());
    return { reference, entry, policy };
  }

  async function manage(rawPayload, rawIp) {
    try {
      const ip = normalizeTrustedIp(rawIp);
      await consumeRateLimit({ scope: 'manage_ip', subject: ip, limit: 30, windowMs: 5 * 60 * 1000 });
      const payload = validateManagePayload(rawPayload);

      return await db.runTransaction(async (transaction) => {
        const { reference, entry, policy } = await getVerifiedEntryAndEvent(transaction, payload);
        if (payload.action === 'get') return publicRegistration(entry, policy);
        if (payload.action === 'cancel') {
          if (entry.status === CANCELLED_STATUS) return publicRegistration(entry, policy);
          if (entry.status !== ACTIVE_STATUS) throw new ServiceError('REGISTRATION_NOT_ACTIVE');
          if (!policy.canCancel) throw new ServiceError('REGISTRATION_CANCELLATION_CLOSED');
          const aggregateReference = registrationRef(payload.calendarEventId);
          const activeSnapshot = await transaction.get(aggregateReference.collection('entries').where('status', '==', ACTIVE_STATUS));
          const activeCount = Math.max(0, activeSnapshot.size - 1);
          const timestamp = FieldValue.serverTimestamp();
          transaction.update(reference, {
            status: CANCELLED_STATUS,
            cancelledAt: timestamp,
            updatedAt: timestamp,
          });
          if (entry.identityHash) transaction.delete(identityRef(payload.calendarEventId, entry.identityHash));
          transaction.set(aggregateReference, { schemaVersion: SCHEMA_VERSION, activeCount, updatedAt: timestamp }, { merge: true });
          transaction.set(statsRef(payload.calendarEventId), { schemaVersion: SCHEMA_VERSION, activeCount, updatedAt: timestamp });
          return { ...publicRegistration(entry, policy), status: CANCELLED_STATUS, canUpdate: false, canCancel: false };
        }

        if (entry.status !== ACTIVE_STATUS) throw new ServiceError('REGISTRATION_NOT_ACTIVE');
        if (!policy.canUpdate) throw new ServiceError('REGISTRATION_UPDATE_CLOSED');
        const nextFields = {
          playerName: payload.playerName,
          officialId: payload.officialId,
          deckName: payload.deckName,
          honorId: payload.honorId,
        };
        const nextIdentity = normalizeIdentity(nextFields);
        const nextIdentityHash = nextIdentity ? hmac(secret, 'identity', `${payload.calendarEventId}:${nextIdentity}`) : null;
        if (nextIdentityHash && nextIdentityHash !== entry.identityHash) {
          const nextIdentityReference = identityRef(payload.calendarEventId, nextIdentityHash);
          const duplicateSnapshot = await transaction.get(nextIdentityReference);
          if (duplicateSnapshot.exists && duplicateSnapshot.data().status === ACTIVE_STATUS) {
            throw new ServiceError('POSSIBLE_DUPLICATE_REGISTRATION');
          }
          transaction.set(nextIdentityReference, {
            schemaVersion: SCHEMA_VERSION,
            registrationId: payload.registrationId,
            status: ACTIVE_STATUS,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        if (entry.identityHash && entry.identityHash !== nextIdentityHash) {
          transaction.delete(identityRef(payload.calendarEventId, entry.identityHash));
        }
        transaction.update(reference, {
          ...nextFields,
          identityHash: nextIdentityHash,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { ...publicRegistration({ ...entry, ...nextFields }, policy), ...nextFields };
      });
    } catch (error) {
      const converted = asServiceError(error);
      if (converted.code === 'NOT_FOUND') throw new ServiceError('REGISTRATION_NOT_FOUND');
      throw converted;
    }
  }

  return { submit, manage, consumeRateLimit };
}
