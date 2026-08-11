import {
  extractCallableErrorCode,
  normalizeCustomerFields,
} from './preRegistration.js';

export const ADMIN_PRE_REGISTRATION_CUSTOMER_FIELDS = Object.freeze([
  'playerName',
  'officialId',
  'deckName',
  'honorId',
]);

export function adminPreRegistrationActionsForStatus(status) {
  const live = status === 'active' || status === 'waitlisted';
  return Object.freeze({ canEdit: live, canCancel: live });
}

export function buildAdminPreRegistrationPayload({
  action,
  calendarEventId,
  registrationId,
  fields,
}) {
  const base = { action, calendarEventId, registrationId };
  if (action === 'cancel') return base;
  if (action !== 'update') throw new Error('INVALID_ADMIN_PRE_REGISTRATION_ACTION');
  return { ...base, ...normalizeCustomerFields(fields) };
}

export function adminPreRegistrationErrorMessage(error) {
  const code = extractCallableErrorCode(error);
  const messages = {
    REGISTRATION_NOT_FOUND: '找不到這筆報名，名單可能已更新。',
    REGISTRATION_NOT_ACTIVE: '這筆報名已取消，不能再修改或重複取消。',
    OFFICIAL_ID_CONFLICT: '官方玩家 ID 已被另一筆有效報名使用。',
    HONOR_ID_CONFLICT: '榮耀 ID 已被另一筆有效報名使用。',
    POSSIBLE_DUPLICATE_REGISTRATION: '官方玩家 ID 或榮耀 ID 已被另一筆有效報名使用。',
    REGISTRATION_UPDATE_CLOSED: '活動已不允許修改報名資料。',
    REGISTRATION_CANCELLATION_CLOSED: '活動已開始或結束，不能取消報名。',
    EVENT_UNAVAILABLE: '活動不存在或目前無法管理。',
    CALENDAR_ADMIN_REQUIRED: '管理員權限驗證失敗，請重新登入。',
    PERMISSION_DENIED: '管理員權限驗證失敗，請重新登入。',
    UNKNOWN_OR_MISSING_FIELDS: '送出的管理資料格式不正確。',
    INVALID_ACTION: '不支援這個管理操作。',
    INVALID_PAYLOAD: '送出的管理資料格式不正確。',
  };
  if (messages[code]) return messages[code];
  if (code.startsWith('INVALID_')) return '送出的管理資料格式不正確。';
  return '暫時無法完成管理操作，請稍後再試。';
}
