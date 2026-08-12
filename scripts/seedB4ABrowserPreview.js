import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createPreRegistrationService } from '../functions/src/service.js';
import { createTournamentPreRegistrationHandoffService } from '../functions/src/handoffService.js';
import {
  buildB4ABrowserPreviewBlueprint,
  buildB4ABrowserPreviewManifest,
} from './b4aBrowserPreviewData.js';
import { importB4APreviewAdminFixture } from './b4aBrowserPreviewAuthFixture.js';
import {
  listeningB4ABrowserProcessIds,
  verifyB4ABrowserFunctionsReadiness,
} from './b4aBrowserFunctionsReadiness.js';
import {
  B4A_PREVIEW_ADMIN_MANAGEMENT_EVENT_ID,
  B4A_PREVIEW_ADMIN_MANAGEMENT_SWISS_ID,
  B4A_PREVIEW_ADMIN_PROBE_EVENT_ID,
  B4A_PREVIEW_ADMIN_PROBE_SWISS_ID,
} from '../src/b4aPreviewAdminFixture.js';
import {
  B4A_BROWSER_FRONTEND_ORIGIN,
  B4A_BROWSER_HANDOFF_SECRET,
  B4A_BROWSER_PROJECT_ID,
  B4A_BROWSER_SECRET,
  assertBrowserPreviewEnvironment,
  browserPreviewPaths,
} from './b4aBrowserPreviewConfig.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFromFunctions = createRequire(path.join(projectRoot, 'functions', 'package.json'));
const { deleteApp, initializeApp } = requireFromFunctions('firebase-admin/app');
const { getAuth } = requireFromFunctions('firebase-admin/auth');
const { FieldValue, Timestamp, getFirestore } = requireFromFunctions('firebase-admin/firestore');
const paths = browserPreviewPaths(projectRoot);
assertBrowserPreviewEnvironment(process.env);
await verifyB4ABrowserFunctionsReadiness({
  paths,
  listeningProcessIds: listeningB4ABrowserProcessIds,
});

const app = initializeApp({ projectId: B4A_BROWSER_PROJECT_ID }, `b4a-browser-seed-${Date.now()}`);
const db = getFirestore(app);
const blueprint = buildB4ABrowserPreviewBlueprint();
const publicEventRoot = 'artifacts/kaijuzaocard-main/public/data/monster_tournaments';
const privateRoot = 'artifacts/kaijuzaocard-main/private/data/tournamentPreRegistrations';

const registrations = {};
const payloadFor = (eventId, index, allowWaitlist = false) => ({
  requestId: `b4a-preview-${eventId}-${index}`,
  calendarEventId: eventId,
  playerName: `Preview Player ${eventId.slice(-2).toUpperCase()}-${index}`,
  officialId: `PREVIEW-OFFICIAL-${eventId.slice(-2).toUpperCase()}-${index}`,
  deckName: `Preview Deck ${index}`,
  honorId: `PREVIEW-HONOR-${eventId.slice(-2).toUpperCase()}-${index}`,
  ...(allowWaitlist ? { allowWaitlist: true } : {}),
});

try {
  await importB4APreviewAdminFixture(getAuth(app));
  await db.recursiveDelete(db.collection('artifacts'));
  const batch = db.batch();
  for (const event of blueprint.events) {
    const { id, ...eventData } = event;
    batch.set(db.doc(`${publicEventRoot}/${id}`), {
      ...eventData,
      ...([B4A_PREVIEW_ADMIN_PROBE_EVENT_ID, B4A_PREVIEW_ADMIN_MANAGEMENT_EVENT_ID].includes(id) ? {
        swissIntegration: {
          schemaVersion: 1,
          swissTournamentId: id === B4A_PREVIEW_ADMIN_PROBE_EVENT_ID
            ? B4A_PREVIEW_ADMIN_PROBE_SWISS_ID
            : B4A_PREVIEW_ADMIN_MANAGEMENT_SWISS_ID,
          linkedAt: Timestamp.fromMillis(Date.now()),
        },
      } : {}),
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  const service = createPreRegistrationService({
    db,
    FieldValue,
    Timestamp,
    secret: B4A_BROWSER_SECRET,
  });

  for (const event of blueprint.events) {
    const scenario = blueprint.scenarios[event.id];
    const created = [];
    for (let index = 1; index <= scenario.active + scenario.waitlisted; index += 1) {
      const allowWaitlist = index > scenario.active;
      const result = await service.submit(payloadFor(event.id, index, allowWaitlist), `192.0.2.${20 + index}`);
      created.push(result);
    }
    registrations[event.id] = created.map((item) => ({ registrationId: item.registrationId, status: item.status }));
  }

  const handoffService = createTournamentPreRegistrationHandoffService({
    db,
    FieldValue,
    Timestamp,
    secret: B4A_BROWSER_HANDOFF_SECRET,
    allowedOrigins: new Set([B4A_BROWSER_FRONTEND_ORIGIN]),
  });
  const adminProbe = await handoffService.create({
    requestId: 'b4a-preview-admin-authority-probe-request',
    calendarEventId: B4A_PREVIEW_ADMIN_PROBE_EVENT_ID,
    selectedRegistrationIds: [registrations[B4A_PREVIEW_ADMIN_PROBE_EVENT_ID][0].registrationId],
  });
  await db.doc(`${publicEventRoot}/${B4A_PREVIEW_ADMIN_PROBE_EVENT_ID}`).update({
    browserPreviewAdminProbeHandoffId: adminProbe.handoffId,
  });

  const malformedEntries = registrations['b4a-preview-e6-malformed-rank'].filter((item) => item.status === 'waitlisted');
  const malformedBatch = db.batch();
  for (const entry of malformedEntries) {
    malformedBatch.update(db.doc(`${privateRoot}/b4a-preview-e6-malformed-rank/entries/${entry.registrationId}`), { waitlistSequence: 1 });
  }
  await malformedBatch.commit();

  const manifest = buildB4ABrowserPreviewManifest({
    blueprint,
    registrations,
    frontendOrigin: B4A_BROWSER_FRONTEND_ORIGIN,
  });
  fs.mkdirSync(path.dirname(paths.manifest), { recursive: true });
  fs.writeFileSync(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'w' });
  console.log(`Seeded E1-E6 into ${B4A_BROWSER_PROJECT_ID}.`);
  console.log(`Manifest: ${paths.manifest}`);
} finally {
  await deleteApp(app);
}
