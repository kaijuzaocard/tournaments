import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createPreRegistrationService } from '../functions/src/service.js';
import { buildB4ABrowserPreviewBlueprint } from './b4aBrowserPreviewData.js';
import {
  B4A_BROWSER_ADMIN_UID,
  B4A_BROWSER_FRONTEND_ORIGIN,
  B4A_BROWSER_PROJECT_ID,
  B4A_BROWSER_SECRET,
  assertBrowserPreviewEnvironment,
  browserPreviewPaths,
} from './b4aBrowserPreviewConfig.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFromFunctions = createRequire(path.join(projectRoot, 'functions', 'package.json'));
const { deleteApp, initializeApp } = requireFromFunctions('firebase-admin/app');
const { FieldValue, Timestamp, getFirestore } = requireFromFunctions('firebase-admin/firestore');
const paths = browserPreviewPaths(projectRoot);
assertBrowserPreviewEnvironment(process.env);

const app = initializeApp({ projectId: B4A_BROWSER_PROJECT_ID }, `b4a-browser-seed-${Date.now()}`);
const db = getFirestore(app);
const blueprint = buildB4ABrowserPreviewBlueprint();
const publicEventRoot = 'artifacts/kaijuzaocard-main/public/data/monster_tournaments';
const privateRoot = 'artifacts/kaijuzaocard-main/private/data/tournamentPreRegistrations';

const management = {};
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
  await db.recursiveDelete(db.collection('artifacts'));
  const batch = db.batch();
  for (const event of blueprint.events) {
    const { id, ...eventData } = event;
    batch.set(db.doc(`${publicEventRoot}/${id}`), { ...eventData, createdAt: FieldValue.serverTimestamp() });
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
    const manageable = created.find((item) => item.status === 'waitlisted') || created[0];
    management[event.id] = `${B4A_BROWSER_FRONTEND_ORIGIN}/?event=${encodeURIComponent(event.id)}&registration=${encodeURIComponent(manageable.registrationId)}#manage=${encodeURIComponent(manageable.managementToken)}`;
  }

  const malformedEntries = registrations['b4a-preview-e6-malformed-rank'].filter((item) => item.status === 'waitlisted');
  const malformedBatch = db.batch();
  for (const entry of malformedEntries) {
    malformedBatch.update(db.doc(`${privateRoot}/b4a-preview-e6-malformed-rank/entries/${entry.registrationId}`), { waitlistSequence: 1 });
  }
  await malformedBatch.commit();

  const manifest = {
    schemaVersion: 1,
    projectId: B4A_BROWSER_PROJECT_ID,
    frontendOrigin: B4A_BROWSER_FRONTEND_ORIGIN,
    adminMockUid: B4A_BROWSER_ADMIN_UID,
    authProvider: 'google.com',
    generatedAt: new Date().toISOString(),
    events: Object.fromEntries(blueprint.events.map((event) => [event.id, {
      title: event.title,
      date: event.date,
      expected: blueprint.scenarios[event.id],
      registrations: registrations[event.id],
      managementUrl: management[event.id],
    }])),
  };
  fs.mkdirSync(path.dirname(paths.manifest), { recursive: true });
  fs.writeFileSync(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'w' });
  console.log(`Seeded E1-E6 into ${B4A_BROWSER_PROJECT_ID}.`);
  console.log(`Manifest: ${paths.manifest}`);
} finally {
  await deleteApp(app);
}
