import fs from 'node:fs';
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

const projectId = 'demo-kaijuzaocard-calendar';
const address = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^127\.0\.0\.1:\d+$/.test(address || '')) throw new Error('Explicit loopback Firestore emulator required');
const [host, port] = address.split(':');
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const adminUid = rules.match(/request\.auth\.uid\s+in\s+\[\s*'([^']+)'/)[1];
const publicRoot = 'artifacts/kaijuzaocard-catalog/public/data/monster_products';
const privateRoot = 'artifacts/kaijuzaocard-catalog/private/data/product_internal_notes';
let env;
const dbFor = (uid, provider = 'google.com') => env.authenticatedContext(uid, {
  firebase: { sign_in_provider: provider }
}).firestore();
const seed = (path, data) => env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), path), data));

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules } });
});
afterEach(async () => { await env.clearFirestore(); });
after(async () => { await env?.cleanup(); });

test('unauthenticated and anonymous visitors read public legacy documents, never private get/list', async () => {
  await seed(`${publicRoot}/p`, { name: 'Synthetic', internalNotes: 'synthetic legacy' });
  await seed(`${privateRoot}/p`, { internalNotes: 'synthetic private' });
  for (const db of [env.unauthenticatedContext().firestore(), dbFor('anon', 'anonymous')]) {
    await assertSucceeds(getDoc(doc(db, publicRoot, 'p')));
    await assertFails(getDoc(doc(db, privateRoot, 'p')));
    await assertFails(getDocs(collection(db, privateRoot)));
    await assertFails(setDoc(doc(db, privateRoot, 'new'), { internalNotes: 'no' }));
    await assertFails(updateDoc(doc(db, privateRoot, 'p'), { internalNotes: 'no' }));
    await assertFails(deleteDoc(doc(db, privateRoot, 'p')));
  }
});

test('non-admin and allowlisted UID with wrong provider cannot read/write private notes', async () => {
  await seed(`${privateRoot}/p`, { internalNotes: 'private' });
  for (const db of [dbFor('regular-member'), dbFor(adminUid, 'anonymous')]) {
    await assertFails(getDoc(doc(db, privateRoot, 'p')));
    await assertFails(getDocs(collection(db, privateRoot)));
    await assertFails(setDoc(doc(db, privateRoot, 'new'), { internalNotes: 'no' }));
    await assertFails(updateDoc(doc(db, privateRoot, 'p'), { internalNotes: 'no' }));
    await assertFails(deleteDoc(doc(db, privateRoot, 'p')));
  }
});

test('admin may create/read/list/update/clear/delete private notes', async () => {
  const db = dbFor(adminUid), ref = doc(db, privateRoot, 'p');
  await assertSucceeds(setDoc(ref, { internalNotes: 'private', updatedAt: serverTimestamp() }));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(getDocs(collection(db, privateRoot)));
  await assertSucceeds(updateDoc(ref, { internalNotes: 'edited', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref, { internalNotes: '', updatedAt: serverTimestamp() }));
  assert.equal((await getDoc(ref)).data().internalNotes, '');
  await assertSucceeds(deleteDoc(ref));
});

test('admin public create rejects internalNotes even empty or null', async () => {
  const db = dbFor(adminUid);
  for (const internalNotes of ['private', '', null]) {
    await assertFails(setDoc(doc(db, publicRoot, 'new'), { name: 'Synthetic', internalNotes }));
  }
  await assertSucceeds(setDoc(doc(db, publicRoot, 'new'), { name: 'Synthetic', salesType: 'preorder' }));
});

test('legacy public updates preserve unchanged internalNotes, including full replacement with same value', async () => {
  await seed(`${publicRoot}/p`, { name: 'Before', internalNotes: 'legacy' });
  const ref = doc(dbFor(adminUid), publicRoot, 'p');
  await assertSucceeds(updateDoc(ref, { name: 'After', preorderLink: 'https://example.test/customer' }));
  assert.equal((await getDoc(ref)).data().internalNotes, 'legacy');
  await assertSucceeds(setDoc(ref, { name: 'Replacement', internalNotes: 'legacy' }));
  await assertSucceeds(updateDoc(ref, { internalNotes: 'legacy' }));
});

test('admin cannot introduce, change, remove or null public internalNotes', async () => {
  const db = dbFor(adminUid);
  await seed(`${publicRoot}/legacy`, { name: 'Legacy', internalNotes: 'legacy' });
  await seed(`${publicRoot}/clean`, { name: 'Clean' });
  const ref = doc(db, publicRoot, 'legacy');
  for (const internalNotes of ['changed', '', null, deleteField()]) {
    await assertFails(updateDoc(ref, { internalNotes }));
  }
  await assertFails(setDoc(ref, { name: 'Replacement that removes note' }));
  await assertFails(updateDoc(doc(db, publicRoot, 'clean'), { internalNotes: 'new' }));
  await assertFails(setDoc(doc(db, publicRoot, 'clean'), { internalNotes: '' }, { merge: true }));
});

test('public product delete authority remains admin-only, including legacy products', async () => {
  await seed(`${publicRoot}/p`, { name: 'Legacy', internalNotes: 'legacy' });
  await assertFails(deleteDoc(doc(dbFor('member'), publicRoot, 'p')));
  await assertSucceeds(deleteDoc(doc(dbFor(adminUid), publicRoot, 'p')));
});

test('private permission does not extend to another app or nested collection', async () => {
  const db = dbFor(adminUid);
  await assertFails(setDoc(doc(db, 'artifacts/other/private/data/product_internal_notes/p'), { internalNotes: 'no' }));
  await assertFails(setDoc(doc(db, `${privateRoot}/p/nested/n`), { internalNotes: 'no' }));
});

test('a denied public write rejects the entire batch, leaving the private note unchanged', async () => {
  const db = dbFor(adminUid);
  await seed(`${publicRoot}/p`, { name: 'Before', internalNotes: 'legacy' });
  await seed(`${privateRoot}/p`, { internalNotes: 'before' });
  const batch = writeBatch(db);
  batch.update(doc(db, publicRoot, 'p'), { name: 'After', internalNotes: 'forbidden' });
  batch.set(doc(db, privateRoot, 'p'), { internalNotes: 'after', updatedAt: serverTimestamp() });
  await assertFails(batch.commit());
  assert.equal((await getDoc(doc(db, publicRoot, 'p'))).data().name, 'Before');
  assert.equal((await getDoc(doc(db, privateRoot, 'p'))).data().internalNotes, 'before');
});

test('denied private write rejects a public create in the same batch', async () => {
  const db = dbFor(adminUid), batch = writeBatch(db);
  batch.set(doc(db, publicRoot, 'p'), { name: 'Synthetic' });
  batch.set(doc(db, 'artifacts/other/private/data/product_internal_notes/p'), { internalNotes: 'no' });
  await assertFails(batch.commit());
  assert.equal((await getDoc(doc(db, publicRoot, 'p'))).exists(), false);
});

test('actual Catalog save helper creates and edits atomically without touching public legacy notes', {
  skip: !process.env.CATALOG_PRIVATE_NOTES_MODULE
}, async () => {
  const { saveProductWithPrivateNote } = await import(pathToFileURL(process.env.CATALOG_PRIVATE_NOTES_MODULE));
  const db = dbFor(adminUid);
  const args = { db, appId: 'kaijuzaocard-catalog', productId: null,
    draft: { name: 'Synthetic preorder', internalNotes: 'must not leak', salesType: 'preorder',
      preorderLink: 'https://example.test/customer', preorderEndDate: '2026-11-01T18:00:00+08:00',
      preorderGroupId: 'g', preorderGroupName: 'Synthetic group', preorderGroupSort: 1, preorderGroupImage: 'image' },
    overrides: {}, internalNotes: 'private', collection, doc, writeBatch, serverTimestamp };
  const id = await saveProductWithPrivateNote(args);
  const publicData = (await getDoc(doc(db, publicRoot, id))).data();
  assert.equal(Object.hasOwn(publicData, 'internalNotes'), false);
  assert.equal(publicData.preorderLink, args.draft.preorderLink);
  assert.equal(publicData.preorderEndDate, args.draft.preorderEndDate);
  assert.equal(publicData.preorderGroupId, 'g');
  const note = (await getDoc(doc(db, privateRoot, id))).data();
  assert.equal(note.internalNotes, 'private'); assert.ok(note.updatedAt.toMillis() > 0);
  await seed(`${publicRoot}/legacy`, { ...publicData, internalNotes: 'legacy retained' });
  await saveProductWithPrivateNote({ ...args, productId: 'legacy', internalNotes: '' });
  assert.equal((await getDoc(doc(db, publicRoot, 'legacy'))).data().internalNotes, 'legacy retained');
  assert.equal((await getDoc(doc(db, privateRoot, 'legacy'))).data().internalNotes, '');
});
