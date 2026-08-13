import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  ADMIN_PRE_REGISTRATION_CUSTOMER_FIELDS,
  adminPreRegistrationActionsForStatus,
  adminPreRegistrationErrorMessage,
  buildAdminPreRegistrationPayload,
} from '../src/utils/adminPreRegistration.js';

const identifiers = {
  calendarEventId: 'event-1',
  registrationId: 'reg-1',
};

const fields = {
  playerName: ' Player ',
  officialId: ' Official ',
  deckName: ' Deck ',
  honorId: ' Honor ',
};

test('admin update payload has exactly identifiers action and four canonical fields', () => {
  const payload = buildAdminPreRegistrationPayload({ action: 'update', ...identifiers, fields });
  assert.deepEqual(payload, {
    action: 'update',
    ...identifiers,
    playerName: 'Player',
    officialId: 'Official',
    deckName: 'Deck',
    honorId: 'Honor',
  });
  assert.deepEqual(ADMIN_PRE_REGISTRATION_CUSTOMER_FIELDS, [
    'playerName', 'officialId', 'deckName', 'honorId',
  ]);
  assert.equal(Object.hasOwn(payload, 'status'), false);
  assert.equal(Object.hasOwn(payload, 'managementToken'), false);
  assert.equal(Object.hasOwn(payload, 'note'), false);
});

test('admin cancel payload is exact and contains no customer or mutation override fields', () => {
  const payload = buildAdminPreRegistrationPayload({ action: 'cancel', ...identifiers, fields });
  assert.deepEqual(payload, { action: 'cancel', ...identifiers });
  assert.equal(Object.keys(payload).length, 3);
});

test('only active and waitlisted entries expose admin edit and cancel actions', () => {
  assert.deepEqual(adminPreRegistrationActionsForStatus('active'), { canEdit: true, canCancel: true });
  assert.deepEqual(adminPreRegistrationActionsForStatus('waitlisted'), { canEdit: true, canCancel: true });
  assert.deepEqual(adminPreRegistrationActionsForStatus('cancelled'), { canEdit: false, canCancel: false });
  assert.deepEqual(adminPreRegistrationActionsForStatus('invalid'), { canEdit: false, canCancel: false });
});

test('admin error sanitizer maps private failures to fixed friendly copy', () => {
  assert.equal(
    adminPreRegistrationErrorMessage({ message: 'OFFICIAL_ID_CONFLICT' }),
    '官方玩家 ID 已被另一筆有效報名使用。',
  );
  assert.equal(
    adminPreRegistrationErrorMessage({ message: 'HONOR_ID_CONFLICT' }),
    '榮耀 ID 已被另一筆有效報名使用。',
  );
  const privateFailure = adminPreRegistrationErrorMessage({
    message: 'Firebase stack /artifacts/private HMAC identityHash OTHER-PLAYER [object Object]',
  });
  assert.equal(privateFailure, '暫時無法完成管理操作，請稍後再試。');
  assert.doesNotMatch(privateFailure, /identity|HMAC|artifacts|Object|OTHER-PLAYER/i);
});

test('admin entry dialog uses the approved focus hook and safe initial targets', () => {
  const source = fs.readFileSync(new URL('../src/components/PreRegistrationDialog.jsx', import.meta.url), 'utf8');
  const section = source.slice(
    source.indexOf('export function AdminPreRegistrationEntryDialog'),
    source.indexOf('export function PreRegistrationAdminDialog'),
  );
  assert.match(section, /useModalDialogFocus/);
  assert.match(section, /editing \? playerNameInputRef : safeReturnButtonRef/);
  assert.match(section, /aria-modal="true"/);
  assert.match(section, /aria-labelledby="admin-pre-registration-entry-dialog-title"/);
  assert.match(section, /aria-label=\{editing/);
  assert.match(section, /onSubmit=\{submitEdit\}/);
  assert.doesNotMatch(section, /deleteDoc|status dropdown|managementToken|promot|checkedIn/i);
});

test('admin list renders responsive row actions only for live entries', () => {
  const source = fs.readFileSync(new URL('../src/components/PreRegistrationDialog.jsx', import.meta.url), 'utf8');
  const section = source.slice(source.indexOf('export function PreRegistrationAdminDialog'));
  assert.match(section, /data-admin-entry-actions=\{actions\.canEdit \? 'available' : 'unavailable'\}/);
  assert.match(section, />編輯<\/button>/);
  assert.match(section, />取消報名<\/button>/);
  assert.match(section, /已取消，僅供查看/);
  assert.match(source, /adminManageTournamentPreRegistration/);
  assert.doesNotMatch(section, /deleteDoc|managementToken|status.*onChange/i);
});

test('cancel confirmation is not a hard delete and warns that promotion and notification do not occur', () => {
  const source = fs.readFileSync(new URL('../src/components/PreRegistrationDialog.jsx', import.meta.url), 'utf8');
  const section = source.slice(
    source.indexOf('export function AdminPreRegistrationEntryDialog'),
    source.indexOf('export function PreRegistrationAdminDialog'),
  );
  assert.match(section, /不會刪除紀錄/);
  assert.match(section, /不會自動補位，也不會發送通知/);
  assert.match(section, /確認取消報名/);
  assert.doesNotMatch(section, /deleteDoc|hard delete/i);
});
