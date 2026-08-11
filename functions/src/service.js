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
  normalizeIdentities,
  publicRegistration,
  validateAdminManagePayload,
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
  constructor(code, publicDetails = null) {
    super(code);
    this.name = 'ServiceError';
    this.code = code;
    this.publicDetails = code === 'PRE_REGISTRATION_FULL'
      ? Object.freeze({
        code: 'PRE_REGISTRATION_FULL',
        waitlistAvailable: publicDetails?.waitlistAvailable === true,
      })
      : undefined;
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

function unavailableWaitlistRank(reason) {
  console.warn('Calendar waitlist rank unavailable', {
    code: 'WAITLIST_RANK_UNAVAILABLE',
    reason,
  });
  return { state: 'unavailable', rank: null };
}

function waitlistRank(snapshot, registrationId, ownSequence) {
  if (!Number.isSafeInteger(ownSequence) || ownSequence < 1) {
    return unavailableWaitlistRank('OWN_SEQUENCE_INVALID');
  }
  const sequences = new Set();
  let ownMatches = 0;
  for (const document of snapshot.docs) {
    const entry = document.data();
    const sequence = entry.waitlistSequence;
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      return unavailableWaitlistRank('LIVE_SEQUENCE_INVALID');
    }
    if (sequences.has(sequence)) return unavailableWaitlistRank('DUPLICATE_LIVE_SEQUENCE');
    sequences.add(sequence);
    if ((entry.registrationId || document.id) === registrationId) {
      ownMatches += 1;
      if (sequence !== ownSequence) return unavailableWaitlistRank('OWN_SEQUENCE_MISMATCH');
    }
  }
  if (ownMatches !== 1 || !sequences.has(ownSequence)) {
    return unavailableWaitlistRank('OWN_ENTRY_NOT_PROVEN');
  }
  const ordered = [...sequences].sort((left, right) => left - right);
  return { state: 'available', rank: ordered.indexOf(ownSequence) + 1 };
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
  const liveEntries = (eventId) => registrationRef(eventId)
    .collection('entries')
    .where('status', 'in', [ACTIVE_STATUS, WAITLISTED_STATUS]);

  const hashesForIdentities = (eventId, identities) => identities
    .map((identity) => hmac(secret, 'identity', `${eventId}:${identity}`));
  const identityHashesForFields = (eventId, fields) => hashesForIdentities(
    eventId,
    normalizeIdentities(fields),
  );
  const identityHashesForEntry = (eventId, entry) => [...new Set([
    ...(Array.isArray(entry.identityHashes)
      ? entry.identityHashes.filter((value) => typeof value === 'string' && value)
      : []),
    ...(typeof entry.identityHash === 'string' && entry.identityHash ? [entry.identityHash] : []),
    ...identityHashesForFields(eventId, entry),
  ])];

  const sameIdentityHashes = (left, right) => left.length === right.length
    && left.every((value) => right.includes(value));

  async function checkLegacyIdentityConflicts({
    transaction,
    eventId,
    registrationId,
    requestedIdentities,
    aggregate,
    conflictCodeForIdentity = () => 'POSSIBLE_DUPLICATE_REGISTRATION',
  }) {
    if (aggregate === null || aggregate?.identityAuthorityVersion === 2) return true;
    const snapshot = await transaction.get(liveEntries(eventId));
    const requested = new Set(requestedIdentities);
    let allLiveEntriesUseMultiIdentityLocks = true;
    for (const document of snapshot.docs) {
      const entry = document.data();
      const entryRegistrationId = entry.registrationId || document.id;
      const entryIdentities = normalizeIdentities(entry);
      const expectedHashes = hashesForIdentities(eventId, entryIdentities);
      const storedHashes = Array.isArray(entry.identityHashes)
        ? [...new Set(entry.identityHashes.filter((value) => typeof value === 'string' && value))]
        : null;
      if (!storedHashes || !sameIdentityHashes(storedHashes, expectedHashes)) {
        allLiveEntriesUseMultiIdentityLocks = false;
      }
      const conflictingIdentity = entryIdentities.find((identity) => requested.has(identity));
      if (entryRegistrationId !== registrationId && conflictingIdentity) {
        throw new ServiceError(conflictCodeForIdentity(conflictingIdentity));
      }
    }
    return allLiveEntriesUseMultiIdentityLocks;
  }

  async function readIdentityLocks(transaction, eventId, hashes) {
    const locks = new Map();
    for (const hash of hashes) {
      const reference = identityRef(eventId, hash);
      locks.set(hash, { reference, snapshot: await transaction.get(reference) });
    }
    return locks;
  }

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

  function writeCounts(transaction, eventId, aggregate, timestamp, { identityAuthorityReady = false } = {}) {
    const counts = {
      schemaVersion: SCHEMA_VERSION,
      activeCount: aggregate.activeCount,
      waitlistedCount: aggregate.waitlistedCount,
      updatedAt: timestamp,
    };
    const privateCounts = {
      ...counts,
      nextWaitlistSequence: aggregate.nextWaitlistSequence,
    };
    if (identityAuthorityReady) privateCounts.identityAuthorityVersion = 2;
    transaction.set(registrationRef(eventId), privateCounts, { merge: true });
    transaction.set(statsRef(eventId), counts);
  }

  async function currentWaitlistRank(eventId, registrationId, sequence) {
    if (sequence === null) return { state: 'not_applicable', rank: null };
    const snapshot = await entriesWithStatus(eventId, WAITLISTED_STATUS).get();
    return waitlistRank(snapshot, registrationId, sequence);
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
    const rankResult = await currentWaitlistRank(
      payload.calendarEventId,
      operation.registrationId || credentials.registrationId,
      sequence,
    );
    return {
      ...credentials,
      status,
      waitlistRank: rankResult.rank,
      waitlistRankState: rankResult.state,
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
      const identities = normalizeIdentities(payload);
      const identityHashes = hashesForIdentities(payload.calendarEventId, identities);
      const identity = normalizeIdentity(payload);
      const identityHash = identityHashes[0] ?? null;
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
          if (!config.waitlistEnabled || !payload.allowWaitlist) {
            throw new ServiceError('PRE_REGISTRATION_FULL', {
              waitlistAvailable: config.waitlistEnabled === true,
            });
          }
          status = WAITLISTED_STATUS;
          sequence = counts.nextWaitlistSequence;
        }

        const identityAuthorityReady = await checkLegacyIdentityConflicts({
          transaction,
          eventId: payload.calendarEventId,
          registrationId: credentials.registrationId,
          requestedIdentities: identities,
          aggregate,
        });
        const identityLocks = await readIdentityLocks(transaction, payload.calendarEventId, identityHashes);
        for (const { snapshot } of identityLocks.values()) {
          if (snapshot.exists
            && snapshot.data().registrationId !== credentials.registrationId
            && isLiveRegistrationStatus(snapshot.data().status)) {
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
          identityHashes,
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
        for (const { reference } of identityLocks.values()) {
          transaction.set(reference, {
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
        }, timestamp, { identityAuthorityReady });
        return { created: true, status, waitlistSequence: sequence };
      });

      const rankResult = await currentWaitlistRank(
        payload.calendarEventId,
        credentials.registrationId,
        outcome.waitlistSequence,
      );
      return {
        ...credentials,
        status: outcome.status,
        waitlistRank: rankResult.rank,
        waitlistRankState: rankResult.state,
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

  async function getAdminEntryAndEvent(transaction, payload) {
    const reference = entryRef(payload.calendarEventId, payload.registrationId);
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new ServiceError('REGISTRATION_NOT_FOUND');
    const entry = snapshot.data();
    if (entry.calendarEventId !== payload.calendarEventId) {
      throw new ServiceError('REGISTRATION_NOT_FOUND');
    }
    const eventSnapshot = await transaction.get(eventRef(payload.calendarEventId));
    if (!eventSnapshot.exists) throw new ServiceError('EVENT_UNAVAILABLE');
    const policy = classifyRegistrationManagementPolicy(eventSnapshot.data(), now());
    return { reference, entry, policy };
  }

  async function cancelLiveRegistration({ transaction, payload, reference, entry, policy }) {
    if (entry.status === CANCELLED_STATUS) return publicRegistration(entry, policy);
    if (!isLiveRegistrationStatus(entry.status)) throw new ServiceError('REGISTRATION_NOT_ACTIVE');
    if (!policy.canCancel) throw new ServiceError('REGISTRATION_CANCELLATION_CLOSED');
    const aggregateReference = registrationRef(payload.calendarEventId);
    const aggregateSnapshot = await transaction.get(aggregateReference);
    const aggregate = aggregateSnapshot.exists ? aggregateSnapshot.data() : null;
    const counts = readLiveCounts(aggregate);
    const previousIdentityHashes = identityHashesForEntry(payload.calendarEventId, entry);
    const identityLocks = await readIdentityLocks(
      transaction,
      payload.calendarEventId,
      previousIdentityHashes,
    );
    const timestamp = FieldValue.serverTimestamp();
    transaction.update(reference, {
      status: CANCELLED_STATUS,
      cancelledAt: timestamp,
      updatedAt: timestamp,
    });
    for (const { reference: identityReference, snapshot: identitySnapshot } of identityLocks.values()) {
      if (identitySnapshot.exists
        && identitySnapshot.data().registrationId === payload.registrationId) {
        transaction.delete(identityReference);
      }
    }
    writeCounts(transaction, payload.calendarEventId, {
      activeCount: Math.max(0, counts.activeCount - (entry.status === ACTIVE_STATUS ? 1 : 0)),
      waitlistedCount: Math.max(0, counts.waitlistedCount - (entry.status === WAITLISTED_STATUS ? 1 : 0)),
      nextWaitlistSequence: counts.nextWaitlistSequence,
    }, timestamp);
    return publicRegistration({
      ...entry,
      status: CANCELLED_STATUS,
      cancelledAt: timestamp,
      updatedAt: timestamp,
    }, policy);
  }

  async function updateLiveRegistration({
    transaction,
    payload,
    reference,
    entry,
    policy,
    exposeIdentityConflictKind = false,
  }) {
    if (!isLiveRegistrationStatus(entry.status)) throw new ServiceError('REGISTRATION_NOT_ACTIVE');
    if (!policy.canUpdate) throw new ServiceError('REGISTRATION_UPDATE_CLOSED');
    const nextFields = {
      playerName: payload.playerName,
      officialId: payload.officialId,
      deckName: payload.deckName,
      honorId: payload.honorId,
    };
    const nextIdentities = normalizeIdentities(nextFields);
    const nextIdentityHashes = hashesForIdentities(payload.calendarEventId, nextIdentities);
    const previousIdentityHashes = identityHashesForEntry(payload.calendarEventId, entry);
    const allIdentityHashes = [...new Set([...previousIdentityHashes, ...nextIdentityHashes])];
    const aggregateSnapshot = await transaction.get(registrationRef(payload.calendarEventId));
    const aggregate = aggregateSnapshot.exists ? aggregateSnapshot.data() : null;
    const conflictCodeForIdentity = (identity) => {
      if (!exposeIdentityConflictKind) return 'POSSIBLE_DUPLICATE_REGISTRATION';
      return identity.startsWith('official:') ? 'OFFICIAL_ID_CONFLICT' : 'HONOR_ID_CONFLICT';
    };
    await checkLegacyIdentityConflicts({
      transaction,
      eventId: payload.calendarEventId,
      registrationId: payload.registrationId,
      requestedIdentities: nextIdentities,
      aggregate,
      conflictCodeForIdentity,
    });
    const identityLocks = await readIdentityLocks(
      transaction,
      payload.calendarEventId,
      allIdentityHashes,
    );
    const identityByHash = new Map(nextIdentityHashes.map((hash, index) => [hash, nextIdentities[index]]));
    for (const hash of nextIdentityHashes) {
      const duplicateSnapshot = identityLocks.get(hash).snapshot;
      if (duplicateSnapshot.exists
        && duplicateSnapshot.data().registrationId !== payload.registrationId
        && isLiveRegistrationStatus(duplicateSnapshot.data().status)) {
        throw new ServiceError(conflictCodeForIdentity(identityByHash.get(hash)));
      }
    }
    let rankResult = { state: 'not_applicable', rank: null };
    if (entry.status === WAITLISTED_STATUS) {
      const waitlistedSnapshot = await transaction.get(entriesWithStatus(payload.calendarEventId, WAITLISTED_STATUS));
      rankResult = waitlistRank(waitlistedSnapshot, payload.registrationId, entry.waitlistSequence);
    }
    const timestamp = FieldValue.serverTimestamp();
    for (const hash of nextIdentityHashes) {
      transaction.set(identityLocks.get(hash).reference, {
        schemaVersion: SCHEMA_VERSION,
        registrationId: payload.registrationId,
        status: entry.status,
        updatedAt: timestamp,
      });
    }
    for (const hash of previousIdentityHashes.filter((value) => !nextIdentityHashes.includes(value))) {
      const previousLock = identityLocks.get(hash);
      if (previousLock.snapshot.exists
        && previousLock.snapshot.data().registrationId === payload.registrationId) {
        transaction.delete(previousLock.reference);
      }
    }
    transaction.update(reference, {
      ...nextFields,
      identityHash: nextIdentityHashes[0] ?? null,
      identityHashes: nextIdentityHashes,
      updatedAt: timestamp,
    });
    return {
      ...publicRegistration({ ...entry, ...nextFields }, policy, rankResult),
      ...nextFields,
    };
  }

  async function manage(rawPayload, rawIp) {
    try {
      const ip = normalizeTrustedIp(rawIp);
      await consumeRateLimit({ scope: 'manage_ip', subject: ip, limit: 30, windowMs: 5 * 60 * 1000 });
      const payload = validateManagePayload(rawPayload);

      return await db.runTransaction(async (transaction) => {
        const { reference, entry, policy } = await getVerifiedEntryAndEvent(transaction, payload);
        if (payload.action === 'get') {
          let rankResult = { state: 'not_applicable', rank: null };
          if (entry.status === WAITLISTED_STATUS) {
            const waitlistedSnapshot = await transaction.get(entriesWithStatus(payload.calendarEventId, WAITLISTED_STATUS));
            rankResult = waitlistRank(waitlistedSnapshot, payload.registrationId, entry.waitlistSequence);
          }
          return publicRegistration(entry, policy, rankResult);
        }
        if (payload.action === 'cancel') {
          return cancelLiveRegistration({ transaction, payload, reference, entry, policy });
        }
        return updateLiveRegistration({ transaction, payload, reference, entry, policy });
      });
    } catch (error) {
      const converted = asServiceError(error);
      if (converted.code === 'NOT_FOUND') throw new ServiceError('REGISTRATION_NOT_FOUND');
      throw converted;
    }
  }

  async function adminManage(rawPayload) {
    try {
      const payload = validateAdminManagePayload(rawPayload);
      return await db.runTransaction(async (transaction) => {
        const { reference, entry, policy } = await getAdminEntryAndEvent(transaction, payload);
        if (payload.action === 'cancel') {
          return cancelLiveRegistration({ transaction, payload, reference, entry, policy });
        }
        return updateLiveRegistration({
          transaction,
          payload,
          reference,
          entry,
          policy,
          exposeIdentityConflictKind: true,
        });
      });
    } catch (error) {
      const converted = asServiceError(error);
      if (converted.code === 'NOT_FOUND') throw new ServiceError('REGISTRATION_NOT_FOUND');
      throw converted;
    }
  }

  return { submit, manage, adminManage, consumeRateLimit };
}
