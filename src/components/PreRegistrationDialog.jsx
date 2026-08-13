import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Clipboard, Search, ShieldCheck, X } from 'lucide-react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  classifyPreRegistrationAvailability,
  buildManagementUrl,
  createRequestId,
  deriveWaitlistRanks,
  extractCallableErrorCode,
  extractCallableErrorDetails,
  normalizeCustomerFields,
  registrationStatusLabel,
  removePreRegistrationSecrets,
  shortenRegistrationId,
  WAITLIST_SELF_SERVICE_NOTICE,
  waitlistSelfServiceNoticeForStatus,
} from '../utils/preRegistration.js';
import {
  clearManagementRoute,
  clearGeneratedManagementUrl,
  consumeGeneratedManagementUrl,
  getManagementRoute,
  storeGeneratedManagementUrl,
  withManagementToken,
} from '../utils/managementTokenBootstrap.js';
import PreRegistrationSwissImportControls from './PreRegistrationSwissImportControls.jsx';
import { useModalDialogFocus } from '../hooks/useModalDialogFocus.js';
import {
  adminPreRegistrationActionsForStatus,
  adminPreRegistrationErrorMessage,
  buildAdminPreRegistrationPayload,
} from '../utils/adminPreRegistration.js';

const EMPTY_FORM = Object.freeze({ playerName: '', officialId: '', deckName: '', honorId: '' });

function errorMessage(error) {
  const code = extractCallableErrorCode(error);
  const messages = {
    PRE_REGISTRATION_CLOSED: '本場預報名目前未開放。',
    PRE_REGISTRATION_DEADLINE_PASSED: '本場預報名已截止。',
    PRE_REGISTRATION_FULL: '本場預報名已額滿。',
    EVENT_ENDED: '本場活動已結束。',
    POSSIBLE_DUPLICATE_REGISTRATION: '這組官方 ID 或榮耀 ID 可能已完成報名。',
    RATE_LIMITED: '操作次數過多，請稍後再試。',
    REGISTRATION_NOT_FOUND: '找不到報名資料或管理連結已失效。',
    REGISTRATION_NOT_ACTIVE: '這筆報名已取消，無法再修改。',
    REGISTRATION_UPDATE_CLOSED: '本場已停止修改報名資料；仍可查看摘要。',
    REGISTRATION_CANCELLATION_CLOSED: '活動已開始或結束，無法再取消報名。',
    EVENT_UNAVAILABLE: '活動不存在或已結束，無法讀取報名資料。',
    INVALID_MANAGEMENT_LINK: '管理連結格式無效。',
  };
  return messages[code] || `操作失敗（${code}）`;
}

export function PreRegistrationPanel({ event, stats, activeCount = 0, waitlistedCount = 0, onRegister }) {
  const availability = classifyPreRegistrationAvailability(event, stats ?? { activeCount, waitlistedCount });
  if (availability.status === 'not_open') return null;

  const labels = {
    open: '預先報名',
    closed: '已關閉',
    deadline: '報名已截止',
    full: '已額滿',
    ended: '活動已結束',
    malformed: '設定異常',
  };
  const deadline = availability.settings?.deadline;
  const deadlineText = deadline
    ? new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(typeof deadline.toMillis === 'function' ? deadline.toMillis() : deadline))
    : '活動開始前';

  return (
    <div className="mt-4 border-t border-emerald-100 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-emerald-800">賽事預報名</p>
          <p className="text-xs font-bold text-gray-500">
            {availability.activeCount} / {availability.capacity} 人 · 截止 {deadlineText}
          </p>
          {availability.waitlistedCount > 0 && (
            <p className="text-xs font-bold text-amber-700 mt-1">目前候補 {availability.waitlistedCount} 人</p>
          )}
        </div>
        {availability.status === 'open' ? (
          <button type="button" onClick={(clickEvent) => { clickEvent.stopPropagation(); onRegister({ event }); }} className="px-4 py-2 bg-emerald-600 text-white text-sm font-black rounded-lg hover:bg-emerald-700 active:scale-95">
            預先報名
          </button>
        ) : availability.status === 'waitlist' ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-sm font-black text-amber-700">正取已滿</span>
            <button type="button" onClick={(clickEvent) => { clickEvent.stopPropagation(); onRegister({ event, allowWaitlist: true }); }} className="px-4 py-2 bg-amber-600 text-white text-sm font-black rounded-lg hover:bg-amber-700 active:scale-95">
              加入候補
            </button>
          </div>
        ) : (
          <span className="text-sm font-black text-gray-500">{labels[availability.status]}</span>
        )}
      </div>
      {availability.status === 'waitlist' && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-relaxed text-amber-800">{WAITLIST_SELF_SERVICE_NOTICE}</p>
      )}
    </div>
  );
}

export function PreRegistrationDialog({ event, allowWaitlist = false, functions, onClose }) {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [registrationId, setRegistrationId] = useState('');
  const [registrationStatus, setRegistrationStatus] = useState('');
  const [waitlistRank, setWaitlistRank] = useState(null);
  const [waitlistRankState, setWaitlistRankState] = useState('not_applicable');
  const [linkCopied, setLinkCopied] = useState(false);
  const [waitlistConsent, setWaitlistConsent] = useState(allowWaitlist === true);
  const [waitlistOffer, setWaitlistOffer] = useState(false);
  const requestIdRef = useRef(createRequestId());
  const playerNameInputRef = useRef(null);
  const { dialogRef, onDialogKeyDown } = useModalDialogFocus({
    initialFocusRef: playerNameInputRef,
    onClose: () => {
      clearGeneratedManagementUrl();
      onClose();
    },
    focusVersion: `${registrationId}:${waitlistOffer}:${submitting}`,
  });

  const submitWithConsent = async (consent) => {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    setWaitlistOffer(false);
    try {
      const fields = normalizeCustomerFields(form);
      const callable = httpsCallable(functions, 'submitTournamentPreRegistration');
      const payload = {
        requestId: requestIdRef.current,
        calendarEventId: event.id,
        ...fields,
      };
      if (consent) payload.allowWaitlist = true;
      const response = await callable(payload);
      setRegistrationId(response.data.registrationId);
      setRegistrationStatus(response.data.status);
      setWaitlistRank(response.data.waitlistRank);
      setWaitlistRankState(response.data.waitlistRankState);
      storeGeneratedManagementUrl(buildManagementUrl({
        origin: window.location.origin,
        calendarEventId: event.id,
        registrationId: response.data.registrationId,
        managementToken: response.data.managementToken,
      }));
    } catch (submitError) {
      const details = extractCallableErrorDetails(submitError);
      if (!consent
        && extractCallableErrorCode(submitError) === 'PRE_REGISTRATION_FULL'
        && details?.waitlistAvailable === true) {
        setError('正取席位剛剛額滿；你可以保留目前資料並明確同意改加入候補。');
        setWaitlistOffer(true);
      } else {
        setError(errorMessage(submitError));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submit = (submitEvent) => {
    submitEvent.preventDefault();
    void submitWithConsent(waitlistConsent);
  };

  const acceptWaitlistOffer = () => {
    setWaitlistConsent(true);
    void submitWithConsent(true);
  };

  const copyManagementUrl = async () => {
    try {
      await consumeGeneratedManagementUrl((url) => navigator.clipboard.writeText(url));
      setLinkCopied(true);
    } catch (copyError) {
      setError(errorMessage(copyError));
    }
  };

  const openManagementPage = async () => {
    try {
      await consumeGeneratedManagementUrl((url) => window.location.assign(url));
    } catch (openError) {
      setError(errorMessage(openError));
    }
  };

  const close = () => {
    clearGeneratedManagementUrl();
    onClose();
  };

  return (
    <div ref={dialogRef} tabIndex={-1} onKeyDown={onDialogKeyDown} className="fixed inset-0 z-[100] bg-black/55 p-4 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="pre-registration-dialog-title">
      <div className="w-full max-w-lg bg-white border border-gray-200 rounded-lg shadow-2xl p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div><h2 id="pre-registration-dialog-title" className="text-xl font-black text-gray-900">{registrationId ? (registrationStatus === 'waitlisted' ? '加入候補成功' : '報名成功') : (waitlistConsent ? '加入賽事候補' : '賽事預報名')}</h2><p className="text-sm font-bold text-gray-500 mt-1">{event.title}</p></div>
          <button type="button" onClick={close} title="關閉" aria-label="關閉賽事預報名對話框" className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
        </div>
        {registrationId ? (
          <div className="space-y-4">
            <div className={`flex items-center gap-3 p-4 rounded-lg border ${registrationStatus === 'waitlisted' ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}><CheckCircle2 className={`w-6 h-6 ${registrationStatus === 'waitlisted' ? 'text-amber-600' : 'text-emerald-600'}`} /><div><p className={`font-black ${registrationStatus === 'waitlisted' ? 'text-amber-900' : 'text-emerald-900'}`}>{registrationStatus === 'waitlisted' ? (waitlistRankState === 'unavailable' ? '已加入候補，順位暫時無法計算' : `已加入候補${waitlistRank ? `，目前第 ${waitlistRank} 位` : ''}`) : '已取得正取席位'}</p><p className={`text-sm font-bold ${registrationStatus === 'waitlisted' ? 'text-amber-700' : 'text-emerald-700'}`}>編號：{shortenRegistrationId(registrationId)}</p></div></div>
            {waitlistSelfServiceNoticeForStatus(registrationStatus) && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold leading-relaxed text-amber-800">{waitlistSelfServiceNoticeForStatus(registrationStatus)}</p>}
            <p className="text-sm text-gray-600 font-bold">管理連結可用來查看、修改或取消這筆報名。請立即保存，系統不會把管理憑證留在瀏覽器儲存空間。</p>
            {error && <p role="alert" className="text-sm font-bold text-rose-700">{error}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button type="button" disabled={linkCopied} onClick={copyManagementUrl} className="w-full py-3 bg-gray-900 text-white font-black rounded-lg flex items-center justify-center gap-2 disabled:opacity-60"><Clipboard className="w-4 h-4" /> {linkCopied ? '管理連結已複製並清除' : '複製管理連結'}</button>
              <button type="button" disabled={linkCopied} onClick={openManagementPage} className="w-full py-3 bg-indigo-700 text-white font-black rounded-lg disabled:opacity-60">直接開啟管理頁面</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {waitlistConsent && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold leading-relaxed text-amber-800">正取目前已額滿。送出後由伺服器再次確認席位；若已有空位會取得正取，若仍額滿才會加入候補。{WAITLIST_SELF_SERVICE_NOTICE}</p>}
            <label className="block text-sm font-black text-gray-700">玩家名稱<input ref={playerNameInputRef} required maxLength={40} value={form.playerName} onChange={(e) => setForm({ ...form, playerName: e.target.value })} className="mt-1 w-full p-3 border border-gray-300 rounded-lg" /></label>
            <label className="block text-sm font-black text-gray-700">官方玩家 ID（選填）<input maxLength={40} value={form.officialId} onChange={(e) => setForm({ ...form, officialId: e.target.value })} className="mt-1 w-full p-3 border border-gray-300 rounded-lg" /></label>
            <label className="block text-sm font-black text-gray-700">使用牌組（選填）<input maxLength={80} value={form.deckName} onChange={(e) => setForm({ ...form, deckName: e.target.value })} className="mt-1 w-full p-3 border border-gray-300 rounded-lg" /></label>
            <label className="block text-sm font-black text-gray-700">榮耀 ID（選填）<input maxLength={40} value={form.honorId} onChange={(e) => setForm({ ...form, honorId: e.target.value })} className="mt-1 w-full p-3 border border-gray-300 rounded-lg" /></label>
            <p className="text-xs leading-relaxed text-gray-500">以上資料僅用於本場賽事辨識、名單管理與後續報到；不蒐集電話、Email 或付款資料。</p>
            {error && <p role="alert" className="text-sm font-bold text-rose-700">{error}</p>}
            {waitlistOffer && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold leading-relaxed text-amber-800">{WAITLIST_SELF_SERVICE_NOTICE}</p>}
            {waitlistOffer && <button type="button" disabled={submitting} onClick={acceptWaitlistOffer} className="w-full py-3 bg-amber-600 text-white font-black rounded-lg disabled:opacity-60">同意改加入候補</button>}
            {!waitlistOffer && <button disabled={submitting} className={`w-full py-3 text-white font-black rounded-lg disabled:opacity-60 ${waitlistConsent ? 'bg-amber-600' : 'bg-emerald-600'}`}>{submitting ? '送出中……' : waitlistConsent ? '確認加入候補' : '送出預報名'}</button>}
          </form>
        )}
      </div>
    </div>
  );
}

export function RegistrationManagementDialog({ functions, onClose }) {
  const route = useMemo(() => getManagementRoute(), []);
  const [entry, setEntry] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const closeButtonRef = useRef(null);
  const { dialogRef, onDialogKeyDown } = useModalDialogFocus({
    initialFocusRef: closeButtonRef,
    onClose: () => {
      clearManagementRoute();
      onClose();
    },
    focusVersion: `${loading}:${entry?.registrationId || ''}:${entry?.status || ''}`,
  });

  useEffect(() => {
    if (!route || route.invalid) {
      setError('管理連結格式無效。');
      setLoading(false);
      return undefined;
    }
    let active = true;
    withManagementToken(async (managementToken, ids) => {
      try {
        const callable = httpsCallable(functions, 'manageTournamentPreRegistration');
        const response = await callable({ action: 'get', ...ids, managementToken });
        if (!active) return;
        const safeEntry = removePreRegistrationSecrets(response.data);
        setEntry(safeEntry);
        setForm({ playerName: safeEntry.playerName, officialId: safeEntry.officialId, deckName: safeEntry.deckName, honorId: safeEntry.honorId });
      } catch (loadError) {
        if (active) setError(errorMessage(loadError));
      } finally {
        if (active) setLoading(false);
      }
    }).catch((loadError) => {
      if (active) { setError(errorMessage(loadError)); setLoading(false); }
    });
    return () => { active = false; };
  }, [functions, route]);

  const runAction = async (action) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const fields = action === 'update' ? normalizeCustomerFields(form) : {};
      const response = await withManagementToken(async (managementToken, ids) => {
        const callable = httpsCallable(functions, 'manageTournamentPreRegistration');
        return callable({ action, ...ids, managementToken, ...fields });
      });
      setEntry(removePreRegistrationSecrets(response.data));
      if (action === 'cancel') clearManagementRoute();
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    clearManagementRoute();
    onClose();
  };

  return (
    <div ref={dialogRef} tabIndex={-1} onKeyDown={onDialogKeyDown} className="fixed inset-0 z-[100] bg-black/55 p-4 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="registration-management-dialog-title">
      <div className="w-full max-w-lg bg-white border border-gray-200 rounded-lg shadow-2xl p-6">
        <div className="flex items-center justify-between mb-5"><h2 id="registration-management-dialog-title" className="text-xl font-black text-gray-900">管理我的預報名</h2><button ref={closeButtonRef} type="button" onClick={close} title="關閉" aria-label="關閉預報名管理對話框" className="p-2 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button></div>
        {loading ? <p className="font-bold text-gray-500">正在安全讀取報名資料……</p> : error && !entry ? <p role="alert" className="font-bold text-rose-700">{error}</p> : entry && (
          <div className="space-y-4">
            <p className="text-sm font-bold text-gray-500">報名編號：{shortenRegistrationId(entry.registrationId)} · {registrationStatusLabel(entry.status, entry.waitlistRank, entry.waitlistRankState)}</p>
            {entry.status === 'waitlisted' && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold leading-relaxed text-amber-800"><p>{entry.waitlistRankState === 'unavailable' ? '候補順位資料目前無法完整驗證。' : '候補順位已依目前資料計算。'}</p><p className="mt-1">{WAITLIST_SELF_SERVICE_NOTICE}</p></div>}
            {entry.managementState === 'event_started' && <p className="text-sm font-bold text-amber-700">活動已開始或結束，目前僅提供報名摘要查閱。</p>}
            {entry.managementState === 'deadline_passed' && <p className="text-sm font-bold text-amber-700">修改期限已截止；活動開始前仍可取消報名。</p>}
            {entry.managementState === 'closed' && <p className="text-sm font-bold text-amber-700">主辦方已關閉新報名與資料修改；活動開始前仍可取消。</p>}
            {['active', 'waitlisted'].includes(entry.status) && <>
              <label className="block text-sm font-black">玩家名稱<input maxLength={40} value={form.playerName} onChange={(e) => setForm({ ...form, playerName: e.target.value })} className="mt-1 w-full p-3 border rounded-lg" /></label>
              <label className="block text-sm font-black">官方玩家 ID<input maxLength={40} value={form.officialId} onChange={(e) => setForm({ ...form, officialId: e.target.value })} className="mt-1 w-full p-3 border rounded-lg" /></label>
              <label className="block text-sm font-black">使用牌組<input maxLength={80} value={form.deckName} onChange={(e) => setForm({ ...form, deckName: e.target.value })} className="mt-1 w-full p-3 border rounded-lg" /></label>
              <label className="block text-sm font-black">榮耀 ID<input maxLength={40} value={form.honorId} onChange={(e) => setForm({ ...form, honorId: e.target.value })} className="mt-1 w-full p-3 border rounded-lg" /></label>
              {error && <p role="alert" className="text-sm font-bold text-rose-700">{error}</p>}
              <div className="grid grid-cols-2 gap-3"><button disabled={saving || !entry.canUpdate} onClick={() => runAction('update')} className="py-3 bg-gray-900 text-white font-black rounded-lg disabled:opacity-60">儲存修改</button><button disabled={saving || !entry.canCancel} onClick={() => runAction('cancel')} className="py-3 bg-rose-50 text-rose-700 border border-rose-200 font-black rounded-lg disabled:opacity-60">取消報名</button></div>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}

export function AdminPreRegistrationEntryDialog({
  event,
  entry,
  action,
  functions,
  onClose,
  onSuccess,
}) {
  const [form, setForm] = useState({
    playerName: entry.playerName,
    officialId: entry.officialId,
    deckName: entry.deckName,
    honorId: entry.honorId,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const playerNameInputRef = useRef(null);
  const safeReturnButtonRef = useRef(null);
  const editing = action === 'update';
  const initialFocusRef = editing ? playerNameInputRef : safeReturnButtonRef;
  const { dialogRef, onDialogKeyDown } = useModalDialogFocus({
    initialFocusRef,
    onClose,
    focusVersion: `${action}:${saving}:${error}`,
  });

  const runAction = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const payload = buildAdminPreRegistrationPayload({
        action,
        calendarEventId: event.id,
        registrationId: entry.registrationId,
        fields: form,
      });
      const callable = httpsCallable(functions, 'adminManageTournamentPreRegistration');
      const response = await callable(payload);
      onSuccess({ action, entry: removePreRegistrationSecrets(response.data) });
    } catch (actionError) {
      setError(adminPreRegistrationErrorMessage(actionError));
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = (submitEvent) => {
    submitEvent.preventDefault();
    runAction();
  };

  const statusText = registrationStatusLabel(
    entry.status,
    entry.waitlistRank,
    entry.waitlistRankState,
  );

  return (
    <div ref={dialogRef} tabIndex={-1} onKeyDown={onDialogKeyDown} className="fixed inset-0 z-[110] bg-black/60 p-3 sm:p-4 flex items-center justify-center overflow-y-auto overflow-x-hidden" role="dialog" aria-modal="true" aria-labelledby="admin-pre-registration-entry-dialog-title">
      <div className="w-full max-w-lg max-h-[calc(100vh-1.5rem)] overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-2xl p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <h2 id="admin-pre-registration-entry-dialog-title" className="text-xl font-black text-gray-900">{editing ? '編輯預報名資料' : '確認取消報名'}</h2>
            <p className="mt-1 text-sm font-bold text-gray-500 break-words">{event.title}</p>
          </div>
          <button type="button" onClick={onClose} title="關閉" aria-label={editing ? '關閉管理員編輯預報名對話框' : '關閉取消報名確認對話框'} className="shrink-0 p-2 rounded-lg text-gray-500 hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="mb-5 grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-bold text-gray-600">
          <p className="break-words">狀態：<span className="text-gray-900">{statusText}</span></p>
          <p className="break-all">編號：<span className="font-mono text-gray-900">{shortenRegistrationId(entry.registrationId)}</span></p>
          {entry.status === 'waitlisted' && <p className="sm:col-span-2">候補序號：<span className="text-gray-900">{entry.waitlistSequence ?? '資料異常'}</span> · 目前順位：<span className="text-gray-900">{entry.waitlistRank ?? '無法計算'}</span></p>}
        </div>

        {editing ? (
          <form onSubmit={submitEdit} className="space-y-4">
            <label className="block text-sm font-black text-gray-700">玩家名稱<input ref={playerNameInputRef} required maxLength={40} value={form.playerName} onChange={(changeEvent) => setForm({ ...form, playerName: changeEvent.target.value })} className="mt-1 w-full min-w-0 p-3 border border-gray-300 rounded-lg" /></label>
            <label className="block text-sm font-black text-gray-700">官方玩家 ID<input maxLength={40} value={form.officialId} onChange={(changeEvent) => setForm({ ...form, officialId: changeEvent.target.value })} className="mt-1 w-full min-w-0 p-3 border border-gray-300 rounded-lg" /></label>
            <label className="block text-sm font-black text-gray-700">使用牌組<input maxLength={80} value={form.deckName} onChange={(changeEvent) => setForm({ ...form, deckName: changeEvent.target.value })} className="mt-1 w-full min-w-0 p-3 border border-gray-300 rounded-lg" /></label>
            <label className="block text-sm font-black text-gray-700">榮耀 ID<input maxLength={40} value={form.honorId} onChange={(changeEvent) => setForm({ ...form, honorId: changeEvent.target.value })} className="mt-1 w-full min-w-0 p-3 border border-gray-300 rounded-lg" /></label>
            {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button type="button" onClick={onClose} disabled={saving} className="py-3 border border-gray-300 text-gray-700 font-black rounded-lg disabled:opacity-60">返回名單</button>
              <button type="submit" disabled={saving} className="py-3 bg-gray-900 text-white font-black rounded-lg disabled:opacity-60">{saving ? '儲存中……' : '儲存修改'}</button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-relaxed text-amber-900">
              <p className="font-black break-words">確定要取消「{entry.playerName}」的報名嗎？</p>
              <p className="mt-2">這會將報名標記為已取消，不會刪除紀錄。</p>
              <p className="mt-1">{entry.status === 'active' ? '取消正取只會釋出名額；' : '取消候補只會釋出該候補席位；'}本階段不會自動補位，也不會發送通知。</p>
            </div>
            {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button ref={safeReturnButtonRef} type="button" onClick={onClose} disabled={saving} className="py-3 border border-gray-300 text-gray-700 font-black rounded-lg disabled:opacity-60">返回名單</button>
              <button type="button" onClick={runAction} disabled={saving} className="py-3 bg-rose-700 text-white font-black rounded-lg disabled:opacity-60">{saving ? '正在取消……' : '確認取消報名'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function PreRegistrationAdminDialog({ open, event, isAdmin, db, appId, functions, swissAppUrl, onClose }) {
  const [entries, setEntries] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('active');
  const [error, setError] = useState('');
  const [entryAction, setEntryAction] = useState(null);
  const [mutationMessage, setMutationMessage] = useState('');
  const searchInputRef = useRef(null);
  const { dialogRef, onDialogKeyDown } = useModalDialogFocus({
    open,
    initialFocusRef: searchInputRef,
    onClose,
    focusVersion: `${event?.id || ''}:${entries.length}:${error}`,
  });

  useEffect(() => {
    if (!open || !isAdmin || !event?.id) return undefined;
    const entriesRef = collection(db, 'artifacts', appId, 'private', 'data', 'tournamentPreRegistrations', event.id, 'entries');
    const unsubscribe = onSnapshot(query(entriesRef, orderBy('createdAt', 'desc')), (snapshot) => {
      setEntries(snapshot.docs.map((item) => removePreRegistrationSecrets({ registrationId: item.id, ...item.data() })));
      setError('');
    }, (listenerError) => {
      setEntries([]);
      setError(`名單載入失敗（${listenerError.code || 'UNKNOWN'}）`);
    });
    return unsubscribe;
  }, [open, isAdmin, event?.id, db, appId]);

  if (!open || !event) return null;
  const needle = search.trim().toLocaleLowerCase('zh-TW');
  const waitlistRanks = deriveWaitlistRanks(entries);
  const waitlistSequenceCounts = entries
    .filter((entry) => entry.status === 'waitlisted' && Number.isSafeInteger(entry.waitlistSequence) && entry.waitlistSequence > 0)
    .reduce((counts, entry) => counts.set(entry.waitlistSequence, (counts.get(entry.waitlistSequence) || 0) + 1), new Map());
  const visible = entries.filter((entry) => (filter === 'all' || entry.status === filter)
    && (!needle || [entry.playerName, entry.officialId, entry.deckName, entry.honorId, entry.registrationId]
      .some((value) => String(value || '').toLocaleLowerCase('zh-TW').includes(needle))))
    .sort((left, right) => filter === 'waitlisted'
      ? (left.waitlistSequence ?? Number.MAX_SAFE_INTEGER) - (right.waitlistSequence ?? Number.MAX_SAFE_INTEGER)
      : 0);

  return (
    <>
      <div ref={dialogRef} tabIndex={-1} onKeyDown={onDialogKeyDown} className="fixed inset-0 z-[100] bg-black/55 p-3 sm:p-4 flex items-center justify-center overflow-x-hidden" role="dialog" aria-modal="true" aria-labelledby="pre-registration-admin-dialog-title">
        <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto overflow-x-hidden bg-white rounded-xl shadow-2xl p-4 sm:p-6">
          <div className="flex items-start justify-between gap-4 mb-5"><div className="min-w-0"><h2 id="pre-registration-admin-dialog-title" className="text-xl font-black">預報名名單</h2><p className="text-sm font-bold text-gray-500 break-words">{event.title} · 正取 {entries.filter((entry) => entry.status === 'active').length} 人 · 候補 {entries.filter((entry) => entry.status === 'waitlisted').length} 人</p></div><button type="button" title="關閉" aria-label="關閉預報名名單對話框" onClick={onClose} className="shrink-0 p-2 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button></div>
          <div className="flex flex-col sm:flex-row gap-3 mb-5">
            <label className="relative flex-1 min-w-0"><Search className="w-4 h-4 absolute left-3 top-3.5 text-gray-400" /><input ref={searchInputRef} value={search} onChange={(changeEvent) => setSearch(changeEvent.target.value)} placeholder="搜尋玩家或報名編號" className="w-full min-w-0 pl-9 pr-3 py-3 border rounded-lg" /></label>
            <select value={filter} onChange={(changeEvent) => setFilter(changeEvent.target.value)} className="p-3 border rounded-lg font-bold"><option value="active">正取</option><option value="waitlisted">候補</option><option value="cancelled">已取消</option><option value="all">全部</option></select>
          </div>
          {mutationMessage && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{mutationMessage}</p>}
          {error ? <p role="alert" className="font-bold text-rose-700">{error}</p> : visible.length === 0 ? <p className="font-bold text-gray-400 py-10 text-center">沒有符合條件的預報名</p> : (
            <div className="divide-y border rounded-xl overflow-hidden">{visible.map((entry) => {
              const actions = adminPreRegistrationActionsForStatus(entry.status);
              const rank = waitlistRanks[entry.registrationId];
              const rankState = entry.status === 'waitlisted' && !rank ? 'unavailable' : 'available';
              const statusLabel = entry.status === 'waitlisted' && (!Number.isSafeInteger(entry.waitlistSequence) || entry.waitlistSequence < 1 || waitlistSequenceCounts.get(entry.waitlistSequence) > 1)
                ? '候補 · 順位資料異常'
                : registrationStatusLabel(entry.status, rank, rankState);
              return (
                <div key={entry.registrationId} data-admin-entry-status={entry.status} className="p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-4 text-sm">
                  <div className="min-w-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
                    <p className="min-w-0 break-words"><span className="block text-[11px] font-bold text-gray-400">玩家</span><span className="font-black text-gray-900 break-all">{entry.playerName}</span></p>
                    <p className="min-w-0 break-all"><span className="block text-[11px] font-bold text-gray-400">官方玩家 ID</span>{entry.officialId || '未填'}</p>
                    <p className="min-w-0 break-words"><span className="block text-[11px] font-bold text-gray-400">牌組</span>{entry.deckName || '未填'}</p>
                    <p className="min-w-0 break-all"><span className="block text-[11px] font-bold text-gray-400">榮耀 ID</span>{entry.honorId || '未填'}</p>
                    <p className="min-w-0 break-all"><span className="block text-[11px] font-bold text-gray-400">報名編號</span><span className="font-mono">{shortenRegistrationId(entry.registrationId)}</span></p>
                    <p className={entry.status === 'active' ? 'font-black text-emerald-700' : entry.status === 'waitlisted' ? 'font-black text-amber-700' : 'font-black text-gray-500'}><span className="block text-[11px] font-bold text-gray-400">狀態</span>{statusLabel}</p>
                  </div>
                  <div data-admin-entry-actions={actions.canEdit ? 'available' : 'unavailable'} className="self-center grid grid-cols-2 lg:grid-cols-1 gap-2 min-w-0 lg:w-28">
                    {actions.canEdit ? <>
                      <button type="button" onClick={() => { setMutationMessage(''); setEntryAction({ action: 'update', entry: { ...entry, waitlistRank: rank, waitlistRankState: rankState } }); }} className="min-w-0 px-3 py-2 rounded-lg bg-gray-900 text-white font-black">編輯</button>
                      <button type="button" onClick={() => { setMutationMessage(''); setEntryAction({ action: 'cancel', entry: { ...entry, waitlistRank: rank, waitlistRankState: rankState } }); }} className="min-w-0 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 font-black">取消報名</button>
                    </> : <span className="col-span-2 lg:col-span-1 text-center rounded-lg bg-gray-100 px-3 py-2 font-bold text-gray-500">已取消，僅供查看</span>}
                  </div>
                </div>
              );
            })}</div>
          )}
          {!error && <PreRegistrationSwissImportControls event={event} entries={entries} isAdmin={isAdmin} functions={functions} swissAppUrl={swissAppUrl} />}
          <div className="mt-5 flex items-center gap-2 text-xs text-gray-500 font-bold"><ShieldCheck className="w-4 h-4 shrink-0" /> 名單僅在管理員視窗開啟期間讀取；不顯示 token、IP 或內部稽核資料。</div>
        </div>
      </div>
      {entryAction && (
        <AdminPreRegistrationEntryDialog
          key={`${entryAction.action}:${entryAction.entry.registrationId}`}
          event={event}
          entry={entryAction.entry}
          action={entryAction.action}
          functions={functions}
          onClose={() => setEntryAction(null)}
          onSuccess={({ action: completedAction }) => {
            setMutationMessage(completedAction === 'update' ? '報名資料已更新。' : '報名已標記為取消。');
            setEntryAction(null);
          }}
        />
      )}
    </>
  );
}
