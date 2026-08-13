import { classifySwissIntegration } from './swissIntegration.js';

export const PRE_REGISTRATION_HANDOFF_SCHEMA_VERSION = 1;
export const PRE_REGISTRATION_HANDOFF_ACTION = 'import-preregistration';
export const MAX_PRE_REGISTRATION_HANDOFF_SELECTION = 128;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
const ENVELOPE_KEYS = Object.freeze(['schemaVersion', 'handoffId', 'handoffToken']);

const text = (value) => String(value ?? '').trim();

function eventStartMillis(event) {
  const date = text(event?.date);
  const time = text(event?.time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const value = Date.parse(`${date}T${time}:00+08:00`);
  return Number.isNaN(value) ? null : value;
}

export function classifyPreRegistrationImportEntry(entry, targetSwissTournamentId) {
  if (!entry || typeof entry !== 'object' || !SAFE_ID.test(text(entry.registrationId))) return { status: 'malformed' };
  if (entry.status === 'waitlisted') return { status: 'waitlisted' };
  if (entry.status === 'cancelled') return { status: 'cancelled' };
  if (entry.status !== 'active') return { status: 'malformed' };
  const importedTournamentId = text(entry.importedTournamentId);
  if (!importedTournamentId) return { status: 'available' };
  if (importedTournamentId === text(targetSwissTournamentId)) return { status: 'already_imported' };
  return { status: 'import_conflict', importedTournamentId };
}

export function classifyPreRegistrationImportAvailability({ event, entries, isAdmin, now = Date.now() }) {
  if (!isAdmin) return { status: 'admin_required', selectableIds: [] };
  const integration = classifySwissIntegration(event?.swissIntegration, {
    fieldPresent: Object.prototype.hasOwnProperty.call(event ?? {}, 'swissIntegration'),
  });
  if (integration.status !== 'linked') return { status: integration.status === 'malformed' ? 'malformed_link' : 'unlinked', selectableIds: [] };
  const start = eventStartMillis(event);
  if (start === null) return { status: 'malformed_event', selectableIds: [], targetSwissTournamentId: integration.tournamentId };
  if (start <= now) return { status: 'event_started', selectableIds: [], targetSwissTournamentId: integration.tournamentId };
  const selectableIds = (Array.isArray(entries) ? entries : [])
    .filter((entry) => classifyPreRegistrationImportEntry(entry, integration.tournamentId).status === 'available')
    .map((entry) => entry.registrationId)
    .slice(0, MAX_PRE_REGISTRATION_HANDOFF_SELECTION);
  return {
    status: selectableIds.length ? 'available' : 'empty',
    selectableIds,
    targetSwissTournamentId: integration.tournamentId,
  };
}

export function normalizeSelectedRegistrationIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PRE_REGISTRATION_HANDOFF_SELECTION) {
    throw new Error('INVALID_REGISTRATION_SELECTION');
  }
  const ids = value.map((item) => text(item));
  if (ids.some((item) => !SAFE_ID.test(item)) || new Set(ids).size !== ids.length) {
    throw new Error('INVALID_REGISTRATION_SELECTION');
  }
  return ids.sort();
}

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export function buildPreRegistrationSwissHandoffUrl({ swissAppUrl, handoffId, handoffToken }) {
  const envelope = {
    schemaVersion: PRE_REGISTRATION_HANDOFF_SCHEMA_VERSION,
    handoffId: text(handoffId),
    handoffToken: text(handoffToken),
  };
  if (!SAFE_ID.test(envelope.handoffId) || !TOKEN.test(envelope.handoffToken)
    || Object.keys(envelope).sort().join(',') !== [...ENVELOPE_KEYS].sort().join(',')) {
    throw new Error('INVALID_HANDOFF_RESPONSE');
  }
  const url = new URL(swissAppUrl);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('INVALID_SWISS_APP_URL');
  url.search = '';
  url.hash = '';
  url.searchParams.set('action', PRE_REGISTRATION_HANDOFF_ACTION);
  url.hash = new URLSearchParams({ handoff: encodeBase64Url(envelope) }).toString();
  return url.toString();
}
