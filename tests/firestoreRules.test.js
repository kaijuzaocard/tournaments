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
const ADMIN_UID = String(process.env.VITE_FIREBASE_ADMIN_UIDS || '')
  .split(',')
  .map((uid) => uid.trim())
  .filter(Boolean)[0];
const DATA_ROOT = `artifacts/${APP_ID}/public/data`;

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

  test('anonymous auth cannot become admin even when its UID matches the allowlist', async () => {
    const db = anonymousDb(ADMIN_UID);
    await assertFails(setDoc(
      doc(db, `${DATA_ROOT}/monster_tournaments/anonymous-admin-attempt`),
      { title: 'Denied' }
    ));
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
