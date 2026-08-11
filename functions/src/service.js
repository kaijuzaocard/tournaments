import {
  ACTIVE_STATUS,
  APP_ID,
  CANCELLED_STATUS,
  ContractError,
  SCHEMA_VERSION,
  WAITLISTED_STATUS,
  classifyPreRegistrationConfig,
  classifyRegistrationManagementPolicy,
  eventStartMillis,
  isLiveRegistrationStatus,
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

function waitlistRank(snapshot, ownSequence) {
  if (!Number.isSafeInteger(ownSequence) || ownSequence < 1) throw new ServiceError('WAITLIST_STATE_INVALID');
  let rank = 0;
  snapshot.forEach((document) => {
    const sequence = document.data().waitlistSequence;
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new ServiceError('WAITLIST_STATE_INVALID');
    if (sequence <= ownSequence) rank += 1;
  });
  return rank || null;
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

  const entriesWithStatus = (eventId, status) => registrationRef(eventId)
    .collection('entries')
    .where('status', '==', status);

  function readLiveCounts(aggregate) {
    const aggregateFields = ['activeCount', 'waitlistedCount', 'nextWaitlistSequence'];
    const hasCompleteAggregate = aggregateFields.every((field) => Object.hasOwn(aggregate ?? {}, field));
    if (hasCompleteAggregate) {
      if (!Number.isSafeInteger(aggregate.activeCount) || aggregate.activeCount < 0
        || !Number.isSafeInteger(aggregate.waitlistedCount) || aggregate.waitlistedCount < 0
        || !Number.isSafeInteger(aggregate.nextWaitlistSequence) || aggregate.nextWaitlistSequence < 1) {
        throw new ServiceError('WAITLIST_STATE_INVALID');
      }
      return {
        activeCount: aggregate.activeCount,
        waitlistedCount: aggregate.waitlistedCount,
        nextWaitlistSequence: aggregate.nextWaitlistSequence,
      };
    }

    // B2A has always written the private aggregate in the same transaction as
    // every entry. A missing document therefore means a new event, while a v1
    // aggregate can only contain active entries. Trusting that server-owned
    // invariant avoids collection-query retries during the first concurrent
    // submissions and keeps v1 reads compatible.
    if (aggregate !== null
      && (!Number.isSafeInteger(aggregate.activeCount) || aggregate.activeCount < 0)) {
      throw new ServiceError('WAITLIST_STATE_INVALID');
    }
    return {
      activeCount: aggregate?.activeCount ?? 0,
      waitlistedCount: 0,
      nextWaitlistSequence: 1,
    };
  }

  function writeCounts(transaction, eventId, aggregate, timestamp) {
    const counts = {
      schemaVersion: SCHEMA_VERSION,
      activeCount: aggregate.activeCount,
      waitlistedCount: aggregate.waitlistedCount,
      updatedAt: timestamp,
    };
    transaction.set(registrationRef(eventId), {
      ...counts,
      nextWaitlistSequence: aggregate.nextWaitlistSequence,
    }, { merge: true });
    transaction.set(statsRef(eventId), counts);
  }

  async function currentWaitlistRank(eventId, sequence) {
    if (sequence === null) return null;
    const snapshot = await entriesWithStatus(eventId, WAITLISTED_STATUS).get();
    return waitlistRank(snapshot, sequence);
  }

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
    const status = operation.status === WAITLISTED_STATUS ? WAITLISTED_STATUS : ACTIVE_STATUS;
    const sequence = status === WAITLISTED_STATUS ? operation.waitlistSequence : null;
    return {
      ...credentials,
      status,
      waitlistRank: await currentWaitlistRank(payload.calendarEventId, sequence),
      replayed: true,
    };
  }

  async function submit(rawPayload, rawIp) {
    try {
      const payload = validateSubmitPayload(rawPayload);
      const fingerprintPayload = payload.allowWaitlist
        ? payload
        : Object.fromEntries(Object.entries(payload).filter(([field]) => field !== 'allowWaitlist'));
      const canonical = stableJson(fingerprintPayload);
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
      const outcome = await db.runTransaction(async (transaction) => {
        const eventSnapshot = await transaction.get(eventRef(payload.calendarEventId));
        if (!eventSnapshot.exists) throw new ServiceError('EVENT_NOT_FOUND');
        const config = assertEventAcceptsRegistration(eventSnapshot.data(), now());
        const operationReference = operationRef(payload.calendarEventId, operationId);
        const operationSnapshot = await transaction.get(operationReference);
        if (operationSnapshot.exists) {
          const operation = operationSnapshot.data();
          if (operation.fingerprint !== fingerprint) throw new ServiceError('REQUEST_ID_PAYLOAD_MISMATCH');
          const status = operation.status === WAITLISTED_STATUS ? WAITLISTED_STATUS : ACTIVE_STATUS;
          return {
            created: false,
            status,
            waitlistSequence: status === WAITLISTED_STATUS ? operation.waitlistSequence : null,
          };
        }

        const aggregateReference = registrationRef(payload.calendarEventId);
        const aggregateSnapshot = await transaction.get(aggregateReference);
        const aggregate = aggregateSnapshot.exists ? aggregateSnapshot.data() : null;
        const counts = readLiveCounts(aggregate);
        let status = ACTIVE_STATUS;
        let sequence = null;
        if (counts.activeCount >= config.capacity) {
          if (!config.waitlistEnabled || !payload.allowWaitlist) throw new ServiceError('PRE_REGISTRATION_FULL');
          status = WAITLISTED_STATUS;
          sequence = counts.nextWaitlistSequence;
        }

        let duplicateReference = null;
        if (identityHash) {
          duplicateReference = identityRef(payload.calendarEventId, identityHash);
          const duplicateSnapshot = await transaction.get(duplicateReference);
          if (duplicateSnapshot.exists && isLiveRegistrationStatus(duplicateSnapshot.data().status)) {
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
          status,
          tokenHash: hashManagementToken(secret, credentials.managementToken),
          identityHash,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        if (sequence !== null) entry.waitlistSequence = sequence;
        transaction.create(entryRef(payload.calendarEventId, credentials.registrationId), entry);
        const operation = {
          schemaVersion: SCHEMA_VERSION,
          fingerprint,
          registrationId: credentials.registrationId,
          status,
          createdAt: timestamp,
        };
        if (sequence !== null) operation.waitlistSequence = sequence;
        transaction.create(operationReference, operation);
        if (duplicateReference) {
          transaction.set(duplicateReference, {
            schemaVersion: SCHEMA_VERSION,
            registrationId: credentials.registrationId,
            status,
            updatedAt: timestamp,
          });
        }
        writeCounts(transaction, payload.calendarEventId, {
          activeCount: counts.activeCount + (status === ACTIVE_STATUS ? 1 : 0),
          waitlistedCount: counts.waitlistedCount + (status === WAITLISTED_STATUS ? 1 : 0),
          nextWaitlistSequence: sequence === null ? counts.nextWaitlistSequence : sequence + 1,
        }, timestamp);
        return { created: true, status, waitlistSequence: sequence };
      });

      return {
        ...credentials,
        status: outcome.status,
        waitlistRank: await currentWaitlistRank(payload.calendarEventId, outcome.waitlistSequence),
        replayed: !outcome.created,
      };
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
        let rank = null;
        if (entry.status === WAITLISTED_STATUS && payload.action !== 'cancel') {
          const waitlistedSnapshot = await transaction.get(entriesWithStatus(payload.calendarEventId, WAITLISTED_STATUS));
          rank = waitlistRank(waitlistedSnapshot, entry.waitlistSequence);
        }
        if (payload.action === 'get') return publicRegistration(entry, policy, rank);
        if (payload.action === 'cancel') {
          if (entry.status === CANCELLED_STATUS) return publicRegistration(entry, policy);
          if (!isLiveRegistrationStatus(entry.status)) throw new ServiceError('REGISTRATION_NOT_ACTIVE');
          if (!policy.canCancel) throw new ServiceError('REGISTRATION_CANCELLATION_CLOSED');
          const aggregateReference = registrationRef(payload.calendarEventId);
          const aggregateSnapshot = await transaction.get(aggregateReference);
          const aggregate = aggregateSnapshot.exists ? aggregateSnapshot.data() : null;
          const counts = readLiveCounts(aggregate);
          const identityReference = entry.identityHash
            ? identityRef(payload.calendarEventId, entry.identityHash)
            : null;
          const identitySnapshot = identityReference ? await transaction.get(identityReference) : null;
          const timestamp = FieldValue.serverTimestamp();
          transaction.update(reference, {
            status: CANCELLED_STATUS,
            cancelledAt: timestamp,
            updatedAt: timestamp,
          });
          if (identityReference && identitySnapshot.exists
            && identitySnapshot.data().registrationId === payload.registrationId) {
            transaction.delete(identityReference);
          }
          writeCounts(transaction, payload.calendarEventId, {
            activeCount: Math.max(0, counts.activeCount - (entry.status === ACTIVE_STATUS ? 1 : 0)),
            waitlistedCount: Math.max(0, counts.waitlistedCount - (entry.status === WAITLISTED_STATUS ? 1 : 0)),
            nextWaitlistSequence: counts.nextWaitlistSequence,
          }, timestamp);
          return { ...publicRegistration(entry, policy), status: CANCELLED_STATUS, canUpdate: false, canCancel: false };
        }

        if (!isLiveRegistrationStatus(entry.status)) throw new ServiceError('REGISTRATION_NOT_ACTIVE');
        if (!policy.canUpdate) throw new ServiceError('REGISTRATION_UPDATE_CLOSED');
        const nextFields = {
          playerName: payload.playerName,
          officialId: payload.officialId,
          deckName: payload.deckName,
          honorId: payload.honorId,
        };
        const nextIdentity = normalizeIdentity(nextFields);
        const nextIdentityHash = nextIdentity ? hmac(secret, 'identity', `${payload.calendarEventId}:${nextIdentity}`) : null;
        const identityChanged = nextIdentityHash !== entry.identityHash;
        const nextIdentityReference = nextIdentityHash && identityChanged
          ? identityRef(payload.calendarEventId, nextIdentityHash)
          : null;
        const previousIdentityReference = entry.identityHash && identityChanged
          ? identityRef(payload.calendarEventId, entry.identityHash)
          : null;
        const duplicateSnapshot = nextIdentityReference ? await transaction.get(nextIdentityReference) : null;
        const previousIdentitySnapshot = previousIdentityReference
          ? await transaction.get(previousIdentityReference)
          : null;
        if (duplicateSnapshot) {
          if (duplicateSnapshot.exists && isLiveRegistrationStatus(duplicateSnapshot.data().status)) {
            throw new ServiceError('POSSIBLE_DUPLICATE_REGISTRATION');
          }
        }
        const timestamp = FieldValue.serverTimestamp();
        if (nextIdentityReference) {
          transaction.set(nextIdentityReference, {
            schemaVersion: SCHEMA_VERSION,
            registrationId: payload.registrationId,
            status: entry.status,
            updatedAt: timestamp,
          });
        }
        if (previousIdentityReference && previousIdentitySnapshot.exists
          && previousIdentitySnapshot.data().registrationId === payload.registrationId) {
          transaction.delete(previousIdentityReference);
        }
        transaction.update(reference, {
          ...nextFields,
          identityHash: nextIdentityHash,
          updatedAt: timestamp,
        });
        return { ...publicRegistration({ ...entry, ...nextFields }, policy, rank), ...nextFields };
      });
    } catch (error) {
      const converted = asServiceError(error);
      if (converted.code === 'NOT_FOUND') throw new ServiceError('REGISTRATION_NOT_FOUND');
      throw converted;
    }
  }

  return { submit, manage, consumeRateLimit };
}
