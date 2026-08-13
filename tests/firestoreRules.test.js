import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, describe, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore';

const PROJECT_ID = 'demo-kaijuzaocard-calendar';
const APP_ID = 'kaijuzaocard-main';
const CATALOG_APP_ID = 'kaijuzaocard-catalog';
const ADMIN_UID = String(process.env.VITE_FIREBASE_ADMIN_UIDS || '')
  .split(',')
  .map((uid) => uid.trim())
  .filter(Boolean)[0];
const DATA_ROOT = `artifacts/${APP_ID}/public/data`;
const CATALOG_DATA_ROOT = `artifacts/${CATALOG_APP_ID}/public/data`;

let testEnv;
const rulesPath = fileURLToPath(new URL('../firestore.rules', import.meta.url));

if (!ADMIN_UID) {
  throw new Error('Rules tests require at least one configured Firebase admin UID.');
}

function parseEmulatorAddress() {
  const [host = '127.0.0.1', rawPort = '8080'] =
    String(process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  return { host, port: Number(rawPort) };
}

function unauthenticatedDb() {
  return testEnv.unauthenticatedContext().firestore();
}

function anonymousDb(uid = 'anonymous-user') {
  return testEnv.authenticatedContext(uid, {
    firebase: { sign_in_provider: 'anonymous' }
  }).firestore();
}

function adminDb() {
  return testEnv.authenticatedContext(ADMIN_UID, {
    email: 'admin@example.test',
    firebase: { sign_in_provider: 'google.com' }
  }).firestore();
}

function regularGoogleDb(uid = 'regular-google-user') {
  return testEnv.authenticatedContext(uid, {
    email: 'member@example.test',
    firebase: { sign_in_provider: 'google.com' }
  }).firestore();
}

function legalReservation(overrides = {}) {
  return {
    gameType: 'ptcg',
    date: '2026-08-01',
    time: '13:30',
    name: 'Test Player',
    contact: 'test-contact',
    status: 'pending',
    createdAt: serverTimestamp(),
    ...overrides
  };
}

async function seed(path, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data);
  });
}

before(async () => {
  const { host, port } = parseEmulatorAddress();
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host,
      port,
      rules: fs.readFileSync(rulesPath, 'utf8')
    }
  });
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv.cleanup();
});

describe('public tournament collections', () => {
  test('1. anonymous users can read monster_tournaments', async () => {
    const path = `${DATA_ROOT}/monster_tournaments/event-1`;
    await seed(path, { title: 'Public tournament' });

    await assertSucceeds(getDoc(doc(anonymousDb(), path)));
  });

  test('2. anonymous users cannot create, update, or delete monster_tournaments', async () => {
    const db = anonymousDb();
    const path = `${DATA_ROOT}/monster_tournaments/event-1`;
    await seed(path, { title: 'Original' });

    await assertFails(setDoc(doc(db, `${DATA_ROOT}/monster_tournaments/event-2`), { title: 'New' }));
    await assertFails(updateDoc(doc(db, path), { title: 'Changed' }));
    await assertFails(deleteDoc(doc(db, path)));
  });

  test('3. allowlisted Google administrators can manage monster_tournaments', async () => {
    const db = adminDb();
    const path = `${DATA_ROOT}/monster_tournaments/admin-event`;

    await assertSucceeds(setDoc(doc(db, path), { title: 'Created' }));
    await assertSucceeds(updateDoc(doc(db, path), { title: 'Updated' }));
    await assertSucceeds(deleteDoc(doc(db, path)));
  });

  test('events with any preregistration aggregate cannot be hard deleted by an administrator', async () => {
    const eventPath = `${DATA_ROOT}/monster_tournaments/protected-event`;
    const aggregatePath = `artifacts/${APP_ID}/private/data/tournamentPreRegistrations/protected-event`;
    await seed(eventPath, { title: 'Protected' });
    await seed(aggregatePath, { schemaVersion: 2, activeCount: 0, waitlistedCount: 0, nextWaitlistSequence: 2 });
    await seed(`${aggregatePath}/entries/cancelled-reg`, { status: 'cancelled', waitlistSequence: 1 });

    await assertFails(deleteDoc(doc(adminDb(), eventPath)));
    await assertSucceeds(getDoc(doc(adminDb(), eventPath)));
    await assertFails(deleteDoc(doc(adminDb(), aggregatePath)));
  });

  test('anonymous auth cannot become admin even when its UID matches the allowlist', async () => {
    const db = anonymousDb(ADMIN_UID);
    await assertFails(setDoc(
      doc(db, `${DATA_ROOT}/monster_tournaments/anonymous-admin-attempt`),
      { title: 'Denied' }
    ));
  });
});

describe('tournament pre-registration privacy', () => {
  const eventPath = `${DATA_ROOT}/monster_tournaments/event-prereg`;
  const statsPath = `${DATA_ROOT}/tournamentPreRegistrationStats/event-prereg`;
  const entryPath = `artifacts/${APP_ID}/private/data/tournamentPreRegistrations/event-prereg/entries/reg-1`;
  const entriesPath = `artifacts/${APP_ID}/private/data/tournamentPreRegistrations/event-prereg/entries`;

  test('public visitors can read event settings and aggregate counts', async () => {
    await seed(eventPath, { title: 'Open', preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 8, deadline: null } });
    await seed(statsPath, { schemaVersion: 2, activeCount: 1, waitlistedCount: 2 });
    await assertSucceeds(getDoc(doc(unauthenticatedDb(), eventPath)));
    await assertSucceeds(getDoc(doc(unauthenticatedDb(), statsPath)));
  });

  test('unauthenticated, anonymous, and regular Google users cannot read private entries', async () => {
    await seed(entryPath, { registrationId: 'reg-1', playerName: 'Private' });
    await assertFails(getDoc(doc(unauthenticatedDb(), entryPath)));
    await assertFails(getDocs(collection(anonymousDb(), entriesPath)));
    await assertFails(getDocs(collection(regularGoogleDb(), entriesPath)));
  });

  test('clients cannot directly create, update, or delete entries', async () => {
    await seed(entryPath, { registrationId: 'reg-1', playerName: 'Private' });
    for (const db of [unauthenticatedDb(), anonymousDb(), regularGoogleDb(), adminDb()]) {
      await assertFails(setDoc(doc(db, `${entriesPath}/reg-2`), { playerName: 'Injected' }));
      await assertFails(updateDoc(doc(db, entryPath), { playerName: 'Changed' }));
      await assertFails(deleteDoc(doc(db, entryPath)));
    }
  });

  test('allowlisted Google administrators can read and list entries', async () => {
    await seed(entryPath, { registrationId: 'reg-1', playerName: 'Private' });
    await assertSucceeds(getDoc(doc(adminDb(), entryPath)));
    await assertSucceeds(getDocs(collection(adminDb(), entriesPath)));
  });

  test('internal indexes, operations, and rate limits remain unreadable to clients', async () => {
    const identity = `artifacts/${APP_ID}/private/data/tournamentPreRegistrations/event-prereg/identities/hash`;
    const rate = `artifacts/${APP_ID}/private/data/tournamentPreRegistrationRateLimits/bucket`;
    await seed(identity, { registrationId: 'reg-1' });
    await seed(rate, { count: 1 });
    await assertFails(getDoc(doc(adminDb(), identity)));
    await assertFails(getDoc(doc(adminDb(), rate)));
  });
});

describe('B2B handoff privacy', () => {
  const paths = [
    `artifacts/${APP_ID}/private/data/tournamentPreRegistrationHandoffs/handoff-1`,
    `artifacts/${APP_ID}/private/data/tournamentPreRegistrationHandoffOperations/operation-1`,
    `artifacts/${APP_ID}/private/data/tournamentPreRegistrationHandoffRateLimits/bucket-1`,
  ];

  test('all handoff state is denied to every client, including Calendar administrators', async () => {
    for (const path of paths) await seed(path, { private: true });
    for (const db of [unauthenticatedDb(), anonymousDb(), regularGoogleDb(), adminDb()]) {
      for (const path of paths) {
        await assertFails(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, path), { forged: true }));
      }
    }
  });
});

describe('public catalog collections', () => {
  test('unauthenticated visitors can read product_categories and monster_products', async () => {
    const categoriesPath = `${CATALOG_DATA_ROOT}/product_categories/category-1`;
    const productsPath = `${CATALOG_DATA_ROOT}/monster_products/product-1`;
    await seed(categoriesPath, { name: 'Cards' });
    await seed(productsPath, { name: 'Public product', status: 'instock' });
    const db = unauthenticatedDb();

    await assertSucceeds(getDoc(doc(db, categoriesPath)));
    await assertSucceeds(getDocs(collection(db, `${CATALOG_DATA_ROOT}/product_categories`)));
    await assertSucceeds(getDoc(doc(db, productsPath)));
    await assertSucceeds(getDocs(collection(db, `${CATALOG_DATA_ROOT}/monster_products`)));
  });

  test('unauthenticated visitors cannot create, update, or delete catalog data', async () => {
    const db = unauthenticatedDb();
    const categoryPath = `${CATALOG_DATA_ROOT}/product_categories/category-1`;
    const productPath = `${CATALOG_DATA_ROOT}/monster_products/product-1`;
    await seed(categoryPath, { name: 'Cards' });
    await seed(productPath, { name: 'Public product' });

    await assertFails(setDoc(
      doc(db, `${CATALOG_DATA_ROOT}/product_categories/category-2`),
      { name: 'Injected' }
    ));
    await assertFails(updateDoc(doc(db, categoryPath), { name: 'Changed' }));
    await assertFails(deleteDoc(doc(db, categoryPath)));
    await assertFails(setDoc(
      doc(db, `${CATALOG_DATA_ROOT}/monster_products/product-2`),
      { name: 'Injected' }
    ));
    await assertFails(updateDoc(doc(db, productPath), { name: 'Changed' }));
    await assertFails(deleteDoc(doc(db, productPath)));
  });

  test('anonymous Firebase users cannot write catalog data', async () => {
    const db = anonymousDb();
    const categoryPath = `${CATALOG_DATA_ROOT}/product_categories/category-1`;
    const productPath = `${CATALOG_DATA_ROOT}/monster_products/product-1`;
    await seed(categoryPath, { name: 'Cards' });
    await seed(productPath, { name: 'Public product' });

    await assertFails(setDoc(
      doc(db, `${CATALOG_DATA_ROOT}/product_categories/category-2`),
      { name: 'Injected' }
    ));
    await assertFails(updateDoc(doc(db, categoryPath), { name: 'Changed' }));
    await assertFails(deleteDoc(doc(db, categoryPath)));
    await assertFails(setDoc(
      doc(db, `${CATALOG_DATA_ROOT}/monster_products/product-2`),
      { name: 'Injected' }
    ));
    await assertFails(updateDoc(doc(db, productPath), { name: 'Changed' }));
    await assertFails(deleteDoc(doc(db, productPath)));
  });

  test('allowlisted Google administrators can manage catalog data', async () => {
    const db = adminDb();
    const categoryPath = `${CATALOG_DATA_ROOT}/product_categories/admin-category`;
    const productPath = `${CATALOG_DATA_ROOT}/monster_products/admin-product`;

    await assertSucceeds(setDoc(doc(db, categoryPath), { name: 'Cards' }));
    await assertSucceeds(updateDoc(doc(db, categoryPath), { name: 'Updated cards' }));
    await assertSucceeds(deleteDoc(doc(db, categoryPath)));

    await assertSucceeds(setDoc(
      doc(db, productPath),
      { name: 'Admin product', status: 'instock' }
    ));
    await assertSucceeds(updateDoc(doc(db, productPath), { name: 'Updated product' }));
    await assertSucceeds(deleteDoc(doc(db, productPath)));
  });

  test('note_templates remain private to allowlisted Google administrators', async () => {
    const path = `${CATALOG_DATA_ROOT}/note_templates/template-1`;
    await seed(path, { text: 'Admin template' });

    await assertFails(getDoc(doc(unauthenticatedDb(), path)));
    await assertFails(getDocs(collection(
      anonymousDb(),
      `${CATALOG_DATA_ROOT}/note_templates`
    )));

    const db = adminDb();
    await assertSucceeds(getDoc(doc(db, path)));
    await assertSucceeds(setDoc(
      doc(db, `${CATALOG_DATA_ROOT}/note_templates/template-2`),
      { text: 'Created by admin' }
    ));
    await assertSucceeds(updateDoc(doc(db, path), { text: 'Updated by admin' }));
    await assertSucceeds(deleteDoc(doc(db, path)));
  });

  test('catalog permissions do not apply to another appId', async () => {
    const path = `${DATA_ROOT}/monster_products/product-1`;
    await seed(path, { name: 'Wrong app product' });

    await assertFails(getDoc(doc(unauthenticatedDb(), path)));
  });
});

describe('tutorial reservation privacy', () => {
  test('4. anonymous users can create a valid tutorial_reservation', async () => {
    await assertSucceeds(setDoc(
      doc(anonymousDb(), `${DATA_ROOT}/tutorial_reservations/reservation-1`),
      legalReservation()
    ));
  });

  test('5. anonymous users cannot create a completed reservation', async () => {
    await assertFails(setDoc(
      doc(anonymousDb(), `${DATA_ROOT}/tutorial_reservations/reservation-1`),
      legalReservation({ status: 'completed' })
    ));
  });

  test('6. anonymous users cannot add extra reservation fields', async () => {
    await assertFails(setDoc(
      doc(anonymousDb(), `${DATA_ROOT}/tutorial_reservations/reservation-1`),
      legalReservation({ injectedRole: 'admin' })
    ));
  });

  test('7. anonymous users cannot read one tutorial_reservation', async () => {
    const path = `${DATA_ROOT}/tutorial_reservations/reservation-1`;
    await seed(path, { ...legalReservation(), createdAt: new Date() });

    await assertFails(getDoc(doc(anonymousDb(), path)));
  });

  test('8. anonymous users cannot list tutorial_reservations', async () => {
    await seed(
      `${DATA_ROOT}/tutorial_reservations/reservation-1`,
      { ...legalReservation(), createdAt: new Date() }
    );

    await assertFails(getDocs(collection(anonymousDb(), `${DATA_ROOT}/tutorial_reservations`)));
  });

  test('9. anonymous users cannot update or delete reservations', async () => {
    const path = `${DATA_ROOT}/tutorial_reservations/reservation-1`;
    await seed(path, { ...legalReservation(), createdAt: new Date() });
    const db = anonymousDb();

    await assertFails(updateDoc(doc(db, path), { status: 'completed' }));
    await assertFails(deleteDoc(doc(db, path)));
  });

  test('10. administrators can read, update, and delete reservations', async () => {
    const path = `${DATA_ROOT}/tutorial_reservations/reservation-1`;
    await seed(path, { ...legalReservation(), createdAt: new Date() });
    const db = adminDb();

    await assertSucceeds(getDoc(doc(db, path)));
    await assertSucceeds(updateDoc(doc(db, path), { status: 'completed' }));
    await assertSucceeds(deleteDoc(doc(db, path)));
  });
});

describe('admin-only and unknown paths', () => {
  test('11. anonymous users cannot read note_presets', async () => {
    const path = `${DATA_ROOT}/note_presets/preset-1`;
    await seed(path, { title: 'Private preset', content: 'Admin only' });

    await assertFails(getDoc(doc(anonymousDb(), path)));
    await assertFails(getDocs(collection(anonymousDb(), `${DATA_ROOT}/note_presets`)));
  });

  test('12. unknown paths are denied by default', async () => {
    const path = `${DATA_ROOT}/unknown_collection/document-1`;
    await seed(path, { value: 'private' });
    const db = anonymousDb();

    await assertFails(getDoc(doc(db, path)));
    await assertFails(setDoc(doc(db, `${DATA_ROOT}/unknown_collection/document-2`), { value: 'denied' }));
  });
});
