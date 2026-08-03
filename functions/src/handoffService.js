import {
  ACTIVE_STATUS,
  APP_ID,
  normalizeCustomerFields,
} from './contracts.js';
import {
  CLAIM_LEASE_MS,
  COMPLETED_HANDOFF_RETENTION_MS,
  HANDOFF_OPERATION_TTL_MS,
  HANDOFF_SCHEMA_VERSION,
  HANDOFF_TTL_MS,
  HandoffContractError,
  assertAllowedOrigin,
  assertFutureLinkedEvent,
  validateCreateHandoffPayload,
  validateManageHandoffPayload,
  validateStatusHandoffPayload,
} from './handoffContracts.js';
import {
  hmac,
  normalizeTrustedIp,
  stableJson,
  tokensEqual,
} from './security.js';

export class HandoffServiceError extends Error {
  constructor(code) {
    super(code);
    this.name = 'HandoffServiceError';
    this.code = code;
  }
}

function asServiceError(error) {
  if (error instanceof HandoffServiceError) return error;
  if (error instanceof HandoffContractError) return new HandoffServiceError(error.code);
  return error;
}

function millis(value) {
  return typeof value?.toMillis === 'function' ? value.toMillis() : null;
}

function deterministicHandoffCredentials(secret, requestId, fingerprint) {
  const seed = `${requestId}:${fingerprint}`;
  return {
    handoffId: `pho_${hmac(secret, 'prereg-handoff-id', seed).slice(0, 32)}`,
    handoffToken: hmac(secret, 'prereg-handoff-token', seed),
  };
}

function hashHandoffToken(secret, token) {
  return hmac(secret, 'prereg-handoff-token-hash', token);
}

function hashClaimId(secret, claimId) {
  return hmac(secret, 'prereg-handoff-claim-id', claimId);
}

function publicSnapshotEntry(entry, registrationId) {
  const fields = normalizeCustomerFields(entry);
  return {
    registrationId,
    ...fields,
    entryUpdatedAt: millis(entry.updatedAt),
  };
}

function publicClaim(handoff) {
  return {
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    handoffRevision: handoff.handoffRevision,
    handoffId: handoff.handoffId,
    calendarEventId: handoff.calendarEventId,
    eventName: handoff.eventName,
    targetSwissTournamentId: handoff.targetSwissTournamentId,
    snapshotCreatedAt: millis(handoff.snapshotCreatedAt),
    expiresAt: millis(handoff.expiresAt),
    entries: handoff.snapshot,
  };
}

function publicStatus(handoff, nowMillis) {
  const expiresAt = millis(handoff.expiresAt);
  const claimLeaseExpiresAt = millis(handoff.claimLeaseExpiresAt);
  const status = expiresAt !== null && expiresAt <= nowMillis
    ? 'expired'
    : handoff.status === 'claimed' && claimLeaseExpiresAt !== null && claimLeaseExpiresAt <= nowMillis
      ? 'ready'
      : handoff.status;
  return {
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    status,
    selectedCount: handoff.selectedCount,
    claimedAt: handoff.claimedAt || null,
    completedAt: handoff.completedAt || null,
    importedCount: handoff.importedCount || 0,
    expiresAt: handoff.expiresAt || null,
    targetSwissTournamentId: handoff.targetSwissTournamentId,
  };
}

export function createTournamentPreRegistrationHandoffService({
  db,
  FieldValue,
  Timestamp,
  secret,
  allowedOrigins,
  now = () => Date.now(),
}) {
  const root = (...parts) => db.doc(['artifacts', APP_ID, ...parts].join('/'));
  const eventRef = (eventId) => root('public', 'data', 'monster_tournaments', eventId);
  const registrationRef = (eventId) => root('private', 'data', 'tournamentPreRegistrations', eventId);
  const entryRef = (eventId, registrationId) => registrationRef(eventId).collection('entries').doc(registrationId);
  const handoffRef = (handoffId) => root('private', 'data', 'tournamentPreRegistrationHandoffs', handoffId);
  const operationRef = (operationId) => root('private', 'data', 'tournamentPreRegistrationHandoffOperations', operationId);
  const rateLimitRef = (bucketId) => root('private', 'data', 'tournamentPreRegistrationHandoffRateLimits', bucketId);

  async function consumeRateLimit({ scope, subject, limit, windowMs }) {
    const current = now();
    const windowStart = Math.floor(current / windowMs) * windowMs;
    const bucketId = hmac(secret, 'prereg-handoff-rate-limit-id', `${scope}:${subject}:${windowStart}`);
    await db.runTransaction(async (transaction) => {
      const reference = rateLimitRef(bucketId);
      const snapshot = await transaction.get(reference);
      const count = snapshot.exists ? snapshot.data().count : 0;
      if (!Number.isSafeInteger(count) || count < 0) throw new HandoffServiceError('RATE_LIMIT_STATE_INVALID');
      if (count >= limit) throw new HandoffServiceError('RATE_LIMITED');
      transaction.set(reference, {
        schemaVersion: HANDOFF_SCHEMA_VERSION,
        scope,
        subjectHash: hmac(secret, 'prereg-handoff-rate-limit-subject', subject),
        count: count + 1,
        windowStartedAt: Timestamp.fromMillis(windowStart),
        expiresAt: Timestamp.fromMillis(windowStart + (2 * windowMs)),
      });
    });
  }

  async function create(rawPayload) {
    try {
      const payload = validateCreateHandoffPayload(rawPayload);
      const canonical = stableJson({
        calendarEventId: payload.calendarEventId,
        selectedRegistrationIds: payload.selectedRegistrationIds,
      });
      const fingerprint = hmac(secret, 'prereg-handoff-payload-fingerprint', canonical);
      const operationId = hmac(secret, 'prereg-handoff-operation-id', payload.requestId);
      const credentials = deterministicHandoffCredentials(secret, payload.requestId, fingerprint);

      return await db.runTransaction(async (transaction) => {
        const operationReference = operationRef(operationId);
        const operationSnapshot = await transaction.get(operationReference);
        if (operationSnapshot.exists) {
          const operation = operationSnapshot.data();
          if (operation.fingerprint !== fingerprint) throw new HandoffServiceError('REQUEST_ID_PAYLOAD_MISMATCH');
          return { ...credentials, handoffId: operation.handoffId, replayed: true, alreadyImportedCount: operation.alreadyImportedCount || 0 };
        }

        const eventSnapshot = await transaction.get(eventRef(payload.calendarEventId));
        if (!eventSnapshot.exists) throw new HandoffServiceError('EVENT_NOT_FOUND');
        const event = eventSnapshot.data();
        const { targetSwissTournamentId } = assertFutureLinkedEvent(event, now());
        const eventName = String(event.title || '').trim().slice(0, 120);
        if (!eventName) throw new HandoffServiceError('EVENT_NAME_INVALID');
        const entrySnapshots = [];
        for (const registrationId of payload.selectedRegistrationIds) {
          entrySnapshots.push(await transaction.get(entryRef(payload.calendarEventId, registrationId)));
        }

        const snapshot = [];
        let alreadyImportedCount = 0;
        entrySnapshots.forEach((entrySnapshot, index) => {
          if (!entrySnapshot.exists) throw new HandoffServiceError('REGISTRATION_NOT_FOUND');
          const entry = entrySnapshot.data();
          if (entry.calendarEventId !== payload.calendarEventId) throw new HandoffServiceError('REGISTRATION_EVENT_MISMATCH');
          if (entry.status !== ACTIVE_STATUS) throw new HandoffServiceError('REGISTRATION_NOT_ACTIVE');
          const importedTournamentId = typeof entry.importedTournamentId === 'string' ? entry.importedTournamentId.trim() : '';
          if (importedTournamentId && importedTournamentId !== targetSwissTournamentId) {
            throw new HandoffServiceError('REGISTRATION_IMPORT_CONFLICT');
          }
          if (importedTournamentId === targetSwissTournamentId) {
            alreadyImportedCount += 1;
            return;
          }
          snapshot.push(publicSnapshotEntry(entry, payload.selectedRegistrationIds[index]));
        });
        if (!snapshot.length) throw new HandoffServiceError('NO_IMPORTABLE_REGISTRATIONS');

        const current = now();
        const timestamp = Timestamp.fromMillis(current);
        const expiresAt = Timestamp.fromMillis(current + HANDOFF_TTL_MS);
        const handoff = {
          schemaVersion: HANDOFF_SCHEMA_VERSION,
          handoffRevision: 1,
          handoffId: credentials.handoffId,
          calendarEventId: payload.calendarEventId,
          eventName,
          targetSwissTournamentId,
          status: 'ready',
          selectedCount: snapshot.length,
          alreadyImportedCount,
          snapshot,
          snapshotCreatedAt: timestamp,
          expiresAt,
          tokenHash: hashHandoffToken(secret, credentials.handoffToken),
          importedCount: 0,
          createdAt: FieldValue.serverTimestamp(),
        };
        transaction.create(handoffRef(credentials.handoffId), handoff);
        transaction.create(operationReference, {
          schemaVersion: HANDOFF_SCHEMA_VERSION,
          requestIdHash: hmac(secret, 'prereg-handoff-request-id', payload.requestId),
          fingerprint,
          handoffId: credentials.handoffId,
          calendarEventId: payload.calendarEventId,
          alreadyImportedCount,
          createdAt: FieldValue.serverTimestamp(),
          expiresAt: Timestamp.fromMillis(current + HANDOFF_OPERATION_TTL_MS),
        });
        return { ...credentials, replayed: false, alreadyImportedCount };
      });
    } catch (error) {
      throw asServiceError(error);
    }
  }

  function assertValidHandoff(handoff, payload) {
    if (!handoff || !tokensEqual(handoff.tokenHash, hashHandoffToken(secret, payload.handoffToken))) {
      throw new HandoffServiceError('HANDOFF_NOT_FOUND');
    }
    const expiresAtMs = millis(handoff.expiresAt);
    if (expiresAtMs === null || expiresAtMs <= now()) {
      throw new HandoffServiceError('HANDOFF_NOT_FOUND');
    }
  }

  async function claim(payload, rawIp) {
    const ip = normalizeTrustedIp(rawIp);
    await consumeRateLimit({ scope: 'claim_ip', subject: ip, limit: 20, windowMs: 10 * 60 * 1000 });
    await consumeRateLimit({ scope: 'claim_handoff', subject: payload.handoffId, limit: 5, windowMs: 10 * 60 * 1000 });
    return db.runTransaction(async (transaction) => {
      const reference = handoffRef(payload.handoffId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new HandoffServiceError('HANDOFF_NOT_FOUND');
      const handoff = snapshot.data();
      assertValidHandoff(handoff, payload);
      const claimHash = hashClaimId(secret, payload.claimId);
      const leaseExpiresAtMs = millis(handoff.claimLeaseExpiresAt);
      if (handoff.status === 'completed') throw new HandoffServiceError('HANDOFF_ALREADY_COMPLETED');
      if (handoff.status === 'claimed' && handoff.claimHash !== claimHash && leaseExpiresAtMs > now()) {
        throw new HandoffServiceError('HANDOFF_ALREADY_CLAIMED');
      }
      if (handoff.status === 'claimed' && handoff.claimHash === claimHash && leaseExpiresAtMs > now()) return publicClaim(handoff);
      if (!['ready', 'claimed'].includes(handoff.status)) throw new HandoffServiceError('HANDOFF_NOT_FOUND');
      const claimedAt = Timestamp.fromMillis(now());
      const claimLeaseExpiresAt = Timestamp.fromMillis(now() + CLAIM_LEASE_MS);
      transaction.update(reference, {
        status: 'claimed',
        claimHash,
        claimedAt,
        claimLeaseExpiresAt,
      });
      return publicClaim({ ...handoff, status: 'claimed', claimHash, claimedAt, claimLeaseExpiresAt });
    });
  }

  async function complete(payload) {
    const completeIds = [
      ...payload.newlyImportedRegistrationIds,
      ...payload.reconciledRegistrationIds,
    ].sort();
    const importedFingerprint = hmac(secret, 'prereg-handoff-complete', stableJson({
      newlyImportedRegistrationIds: payload.newlyImportedRegistrationIds,
      reconciledRegistrationIds: payload.reconciledRegistrationIds,
    }));
    return db.runTransaction(async (transaction) => {
      const reference = handoffRef(payload.handoffId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new HandoffServiceError('HANDOFF_NOT_FOUND');
      const handoff = snapshot.data();
      assertValidHandoff(handoff, payload);
      if (handoff.targetSwissTournamentId !== payload.targetSwissTournamentId) {
        throw new HandoffServiceError('TARGET_TOURNAMENT_MISMATCH');
      }
      if (handoff.status === 'completed') {
        if (handoff.importedFingerprint !== importedFingerprint) throw new HandoffServiceError('COMPLETE_PAYLOAD_MISMATCH');
        return { schemaVersion: HANDOFF_SCHEMA_VERSION, status: 'completed', importedCount: handoff.importedCount, replayed: true };
      }
      if (handoff.status !== 'claimed' || handoff.claimHash !== hashClaimId(secret, payload.claimId)) {
        throw new HandoffServiceError('CLAIM_MISMATCH');
      }
      const claimLeaseExpiresAtMs = millis(handoff.claimLeaseExpiresAt);
      if (claimLeaseExpiresAtMs === null || claimLeaseExpiresAtMs <= now()) {
        throw new HandoffServiceError('CLAIM_EXPIRED');
      }
      const snapshotIds = new Set(handoff.snapshot.map((entry) => entry.registrationId));
      if (completeIds.some((registrationId) => !snapshotIds.has(registrationId))) {
        throw new HandoffServiceError('IMPORTED_REGISTRATION_OUT_OF_SCOPE');
      }
      const entrySnapshots = [];
      for (const registrationId of completeIds) {
        entrySnapshots.push(await transaction.get(entryRef(handoff.calendarEventId, registrationId)));
      }
      entrySnapshots.forEach((entrySnapshot) => {
        if (!entrySnapshot.exists) throw new HandoffServiceError('REGISTRATION_NOT_FOUND');
        const entry = entrySnapshot.data();
        if (entry.calendarEventId !== handoff.calendarEventId) {
          throw new HandoffServiceError('REGISTRATION_EVENT_MISMATCH');
        }
        if (entry.status !== ACTIVE_STATUS) throw new HandoffServiceError('REGISTRATION_NOT_ACTIVE');
        const currentTarget = String(entry.importedTournamentId || '').trim();
        if (currentTarget && currentTarget !== handoff.targetSwissTournamentId) {
          throw new HandoffServiceError('REGISTRATION_IMPORT_CONFLICT');
        }
      });
      const completedAt = FieldValue.serverTimestamp();
      const completedExpiresAt = Timestamp.fromMillis(now() + COMPLETED_HANDOFF_RETENTION_MS);
      entrySnapshots.forEach((entrySnapshot) => {
        transaction.update(entrySnapshot.ref, {
          importedAt: completedAt,
          importedTournamentId: handoff.targetSwissTournamentId,
          handoffRevision: handoff.handoffRevision,
        });
      });
      transaction.update(reference, {
        status: 'completed',
        completedAt,
        importedCount: completeIds.length,
        newlyImportedCount: payload.newlyImportedRegistrationIds.length,
        reconciledCount: payload.reconciledRegistrationIds.length,
        importedFingerprint,
        expiresAt: completedExpiresAt,
        claimHash: FieldValue.delete(),
        claimLeaseExpiresAt: FieldValue.delete(),
      });
      return {
        schemaVersion: HANDOFF_SCHEMA_VERSION,
        status: 'completed',
        importedCount: completeIds.length,
        replayed: false,
      };
    });
  }

  async function release(payload) {
    return db.runTransaction(async (transaction) => {
      const reference = handoffRef(payload.handoffId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new HandoffServiceError('HANDOFF_NOT_FOUND');
      const handoff = snapshot.data();
      assertValidHandoff(handoff, payload);
      if (handoff.status === 'completed') return { schemaVersion: HANDOFF_SCHEMA_VERSION, status: 'completed', replayed: true };
      if (handoff.status === 'ready') return { schemaVersion: HANDOFF_SCHEMA_VERSION, status: 'ready', replayed: true };
      if (handoff.status !== 'claimed' || handoff.claimHash !== hashClaimId(secret, payload.claimId)) {
        throw new HandoffServiceError('CLAIM_MISMATCH');
      }
      transaction.update(reference, {
        status: 'ready',
        claimHash: FieldValue.delete(),
        claimedAt: FieldValue.delete(),
        claimLeaseExpiresAt: FieldValue.delete(),
      });
      return { schemaVersion: HANDOFF_SCHEMA_VERSION, status: 'ready', replayed: false };
    });
  }

  async function manage(rawPayload, rawIp, origin) {
    try {
      assertAllowedOrigin(origin, allowedOrigins);
      const payload = validateManageHandoffPayload(rawPayload);
      if (payload.action === 'claim') return await claim(payload, rawIp);
      await consumeRateLimit({ scope: `manage_${payload.action}`, subject: payload.handoffId, limit: 30, windowMs: 10 * 60 * 1000 });
      return payload.action === 'complete' ? await complete(payload) : await release(payload);
    } catch (error) {
      throw asServiceError(error);
    }
  }

  async function status(rawPayload) {
    try {
      const payload = validateStatusHandoffPayload(rawPayload);
      const snapshot = await handoffRef(payload.handoffId).get();
      if (!snapshot.exists || snapshot.data().calendarEventId !== payload.calendarEventId) {
        throw new HandoffServiceError('HANDOFF_NOT_FOUND');
      }
      return publicStatus(snapshot.data(), now());
    } catch (error) {
      throw asServiceError(error);
    }
  }

  return { create, manage, status, consumeRateLimit };
}
