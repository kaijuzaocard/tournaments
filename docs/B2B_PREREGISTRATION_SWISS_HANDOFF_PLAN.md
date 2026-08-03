# B2B Preregistration to Swiss Handoff Plan

## Scope

B2B transfers an administrator-selected snapshot of active Calendar preregistrations into the already-linked Swiss tournament as pending check-ins. It does not create a tournament, perform check-in, start a round, pair players, change Calendar registration status, or establish real-time synchronization.

## Functions

| Function | Caller | Purpose |
|---|---|---|
| `createTournamentPreRegistrationHandoff` | Calendar allowlisted Google admin | Validate event/link/entries and create an idempotent 10-minute snapshot. |
| `manageTournamentPreRegistrationHandoff` | Exact-origin Swiss client holding the capability token; Swiss UI separately requires its existing admin session | Claim, complete, or release the short-lived handoff. |
| `getTournamentPreRegistrationHandoffStatus` | Calendar allowlisted Google admin | Return minimal status without token or player snapshot. |

All are Gen 2, Node.js 22, `asia-east1`, App Check monitor mode, and bind only the dedicated `CALENDAR_SWISS_HANDOFF_HMAC_KEY` secret. Missing Secret, admin allowlist, or exact-origin configuration fails closed.

## Data Contract

The URL fragment contains exactly `{schemaVersion,handoffId,handoffToken}`. The claim response contains only `schemaVersion`, `handoffRevision`, `handoffId`, `calendarEventId`, `eventName`, `targetSwissTournamentId`, `snapshotCreatedAt`, `expiresAt`, and up to 128 `entries`. Each entry contains exactly `registrationId`, `playerName`, `officialId`, `deckName`, `honorId`, and `entryUpdatedAt`. Management tokens, token hashes, IP hashes, identity indexes, operation records, rate-limit records, and administrator identifiers are excluded.

The Swiss player receives a fresh internal ID and `checkedIn:false`. Source metadata makes replay detection independent of names. `already_imported` is skipped, stable identity conflicts are blocked, same-name entries without stable IDs require explicit confirmation, and malformed rows are blocked.

## Atomicity and Recovery

Calendar create and complete operations are Firestore transactions. Calendar create and status require an allowlisted Calendar Google administrator. Swiss lifecycle management is a cross-Firebase-project capability boundary: it requires the 256-bit handoff token, exact Swiss origin, TTL, claim lease, and rate limits, while the Swiss UI independently requires its existing Google administrator session before it claims. Swiss import uses an exclusive Web Lock and re-reads localStorage and cloud current immediately before persistence. The cloud transaction checks the exact tournament and revision, then localStorage is saved before React state is applied. Local failure triggers a revision-checked cloud rollback.

`complete` carries disjoint `newlyImportedRegistrationIds` and `reconciledRegistrationIds`. A same-handoff retry reports players whose source handoff and revision match. If that handoff expires, Calendar may create a new handoff for the still-active, still-unmarked registrations; Swiss may reconcile only players whose `sourceRegistrationId` and `sourceCalendarEventId` already exist in the exact linked target. Calendar verifies both arrays are disjoint subsets of that handoff snapshot before marking the entries. A source found in another event or another target is a conflict. Deleting a Swiss player later never automatically unlinks Calendar imported metadata; staff must resolve that exceptional case manually rather than silently recreating a player.

Ready/claimed handoffs expire after 10 minutes and claims lease for 5 minutes. Completion extends `handoffs.expiresAt` to 24 hours so Calendar polling and exactly-once replay remain observable. Create-operation idempotency records retain for 24 hours. Rate-limit documents retain for two rate windows. These are separate TTL collection groups; TTL never applies to entries, events, Swiss tournaments, history, stats, or identities.

## Security Checks

- Token appears only in the URL fragment and is stripped before app initialization.
- No wildcard origin and no preview/deployment URL inference.
- Private handoff collections deny every Client read/write.
- Raw IP, token, claim ID, request ID, and stable identities are never stored as plaintext handoff indexes.
- B1 and B2B payloads, routes, parsers, and UI are independent.

## Verification

- Calendar root and Functions unit tests.
- Firestore Rules Emulator, including admin denial for handoff internals.
- Functions plus Firestore Emulator lifecycle tests for actual HTTP callable framing, exact CORS preflight, concurrent claim races, replay, claim lease, release, expiry, subset complete, reconciliation, retention, and entry metadata.
- Swiss unit tests for bootstrap, target validation, conflict classes, Web Lock, cloud revision rollback, pending check-in, ranking/history/JSON exclusions, and B1/QR regressions.
- The Calendar fixture at `contracts/b2b-preregistration-swiss-handoff.v1.json` is canonical; both repositories carry an identical copy and both CI workflows byte-compare against the peer branch.
- Calendar build/lint/node syntax/diff checks and Swiss build/node syntax/diff checks.
- CI uses Node.js 22, Java 21, Firebase demo projects, local emulator-only Secret overrides, and no deploy credentials.

## Deployment Gate

No deployment is part of this implementation batch. A later approved rollout must create the dedicated Secret and exact-origin parameters first, publish the complete merged Rules, deploy only the three B2B Functions, then deploy and verify Calendar and Swiss Previews before any Production merge.
