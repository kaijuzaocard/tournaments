import fs from 'node:fs';
import { before, after, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';

const address = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^127\.0\.0\.1:\d+$/.test(address || '')) throw Error('Explicit loopback Emulator required');
const [host, port] = address.split(':');
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const uid = rules.match(/request\.auth\.uid\s+in\s+\[\s*'([^']+)'/)[1];
const publicPath = 'artifacts/kaijuzaocard-catalog/public/data/preorder_activities';
const privatePath = 'artifacts/kaijuzaocard-catalog/private/data/preorder_publication_receipts';
let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-kaijuzaocard-calendar', firestore: { host, port: Number(port), rules } });
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), publicPath, 'po_s05'), { name: 'Synthetic S05' });
    await setDoc(doc(ctx.firestore(), privatePath, 'pub_s05'), { status: 'acknowledged' });
  });
});
after(async () => { await env?.cleanup(); });
for (const role of ['visitor', 'anonymous', 'member', 'admin']) {
  test(role + ': public get/list allowed; create/update/delete denied; receipt get/list/write denied', async () => {
    const db = role === 'visitor' ? env.unauthenticatedContext().firestore()
      : env.authenticatedContext(role === 'admin' ? uid : 'synthetic-' + role,
        { firebase: { sign_in_provider: role === 'anonymous' ? 'anonymous' : 'google.com' } }).firestore();
    await assertSucceeds(getDoc(doc(db, publicPath, 'po_s05')));
    await assertSucceeds(getDocs(collection(db, publicPath)));
    await assertFails(setDoc(doc(db, publicPath, 'po_new'), { name: 'Not allowed' }));
    await assertFails(updateDoc(doc(db, publicPath, 'po_s05'), { name: 'Not allowed' }));
    await assertFails(deleteDoc(doc(db, publicPath, 'po_s05')));
    await assertFails(getDoc(doc(db, privatePath, 'pub_s05')));
    await assertFails(getDocs(collection(db, privatePath)));
    await assertFails(setDoc(doc(db, privatePath, 'pub_new'), { status: 'acknowledged' }));
    await assertFails(updateDoc(doc(db, privatePath, 'pub_s05'), { status: 'forged' }));
    await assertFails(deleteDoc(doc(db, privatePath, 'pub_s05')));
    const batch = writeBatch(db);
    batch.set(doc(db, publicPath, 'po_batch'), { name: 'Not allowed' });
    batch.set(doc(db, privatePath, 'pub_batch'), { status: 'forged' });
    await assertFails(batch.commit());
  });
}
test('projection Rules do not authorize sibling apps or nested data', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'artifacts/other/public/data/preorder_activities/po_s05')));
  await assertFails(getDoc(doc(db, publicPath + '/po_s05/private/secret')));
});
