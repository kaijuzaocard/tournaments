import { deleteField, doc, runTransaction } from 'firebase/firestore';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const LINK_KEYS = Object.freeze(['linkedAt', 'schemaVersion', 'swissTournamentId']);

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isTimestamp(value) {
  return !!value
    && typeof value === 'object'
    && Number.isInteger(value.seconds)
    && Number.isInteger(value.nanoseconds)
    && value.nanoseconds >= 0
    && value.nanoseconds < 1_000_000_000;
}

export function classifySwissIntegration(value, { fieldPresent = value !== undefined } = {}) {
  if (!fieldPresent) return { status: 'unlinked', tournamentId: '' };
  if (!hasExactKeys(value, LINK_KEYS) || value.schemaVersion !== 1) {
    return { status: 'malformed', tournamentId: '' };
  }
  if (value.swissTournamentId === null && value.linkedAt === null) {
    return { status: 'legacy_unlinked', tournamentId: '' };
  }
  const tournamentId = typeof value.swissTournamentId === 'string'
    ? value.swissTournamentId.trim()
    : '';
  if (SAFE_ID.test(tournamentId) && isTimestamp(value.linkedAt)) {
    return { status: 'linked', tournamentId };
  }
  return { status: 'malformed', tournamentId: '' };
}

export function removeSwissIntegrationKey(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return event;
  const { swissIntegration: _removed, ...withoutSwissIntegration } = event;
  return withoutSwissIntegration;
}

export async function clearSwissIntegrationSafely({
  db,
  appId,
  calendarEventId,
  expectedTournamentId = '',
  currentUser,
  isAdminUser,
  firestore = {},
}) {
  if (typeof isAdminUser !== 'function' || !isAdminUser(currentUser)) {
    throw new Error('CALENDAR_ADMIN_REQUIRED');
  }
  if (!SAFE_ID.test(String(calendarEventId ?? '').trim())) {
    throw new Error('INVALID_CALENDAR_EVENT_ID');
  }
  const expected = String(expectedTournamentId ?? '').trim();
  if (expected && !SAFE_ID.test(expected)) throw new Error('INVALID_EXPECTED_TOURNAMENT_ID');

  const docFn = firestore.doc ?? doc;
  const runTransactionFn = firestore.runTransaction ?? runTransaction;
  const deleteFieldFn = firestore.deleteField ?? deleteField;
  const eventRef = docFn(db, 'artifacts', appId, 'public', 'data', 'monster_tournaments', calendarEventId);
  let result = { status: 'already-unlinked' };

  await runTransactionFn(db, async (transaction) => {
    const snapshot = await transaction.get(eventRef);
    if (!snapshot.exists()) throw new Error('CALENDAR_EVENT_NOT_FOUND');

    const data = snapshot.data();
    const fieldPresent = Object.prototype.hasOwnProperty.call(data, 'swissIntegration');
    const integration = classifySwissIntegration(data.swissIntegration, { fieldPresent });
    if (integration.status === 'unlinked') return;
    if (integration.status === 'malformed') throw new Error('SWISS_INTEGRATION_MALFORMED');
    if (integration.status === 'linked' && !expected) {
      throw new Error('INVALID_EXPECTED_TOURNAMENT_ID');
    }
    if (integration.status === 'linked' && integration.tournamentId !== expected) {
      throw new Error('SWISS_UNLINK_CONFLICT');
    }

    transaction.update(eventRef, { swissIntegration: deleteFieldFn() });
    result = { status: 'cleared' };
  });

  return result;
}
