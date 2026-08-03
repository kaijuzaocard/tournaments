import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Clipboard, Search, ShieldCheck, X } from 'lucide-react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  classifyPreRegistrationAvailability,
  buildManagementUrl,
  createRequestId,
  normalizeCustomerFields,
  removePreRegistrationSecrets,
  shortenRegistrationId,
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

const EMPTY_FORM = Object.freeze({ playerName: '', officialId: '', deckName: '', honorId: '' });

function errorMessage(error) {
  const raw = error?.details || error?.message || error?.code || 'UNKNOWN_ERROR';
  const code = String(raw).split('/').pop();
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

export function PreRegistrationPanel({ event, activeCount = 0, onRegister }) {
  const availability = classifyPreRegistrationAvailability(event, activeCount);
  if (availability.status === 'not_open') return null;

  const labels = {
    open: '預先報名',
    closed: '已關閉',
    deadline: '報名已截止',
    full: '報名已額滿',
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
        </div>
        {availability.status === 'open' ? (
          <button type="button" onClick={(clickEvent) => { clickEvent.stopPropagation(); onRegister(event); }} className="px-4 py-2 bg-emerald-600 text-white text-sm font-black rounded-lg hover:bg-emerald-700 active:scale-95">
            預先報名
          </button>
        ) : (
          <span className="text-sm font-black text-gray-500">{labels[availability.status]}</span>
        )}
      </div>
    </div>
  );
}

export function PreRegistrationDialog({ event, functions, onClose }) {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [registrationId, setRegistrationId] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const requestIdRef = useRef(createRequestId());

  const submit = async (submitEvent) => {
    submitEvent.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const fields = normalizeCustomerFields(form);
      const callable = httpsCallable(functions, 'submitTournamentPreRegistration');
      const response = await callable({
        requestId: requestIdRef.current,
        calendarEventId: event.id,
        ...fields,
      });
      setRegistrationId(response.data.registrationId);
      storeGeneratedManagementUrl(buildManagementUrl({
        origin: window.location.origin,
        calendarEventId: event.id,
        registrationId: response.data.registrationId,
        managementToken: response.data.managementToken,
      }));
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const copyManagementUrl = async () => {
    try {
      await consumeGeneratedManagementUrl((url) => navigator.clipboard.writeText(url));
      setLinkCopied(true);
    } catch (copyError) {
      setError(errorMessage(copyError));
    }
  };

  const close = () => {
    clearGeneratedManagementUrl();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/55 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg bg-white border border-gray-200 rounded-lg shadow-2xl p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div><h2 className="text-xl font-black text-gray-900">{registrationId ? '報名成功' : '賽事預報名'}</h2><p className="text-sm font-bold text-gray-500 mt-1">{event.title}</p></div>
          <button type="button" onClick={close} title="關閉" className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
        </div>
        {registrationId ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-lg"><CheckCircle2 className="w-6 h-6 text-emerald-600" /><div><p className="font-black text-emerald-900">預報名已完成</p><p className="text-sm font-bold text-emerald-700">編號：{shortenRegistrationId(registrationId)}</p></div></div>
            <p className="text-sm text-gray-600 font-bold">管理連結可用來查看、修改或取消這筆報名。請立即保存，系統不會把管理憑證留在瀏覽器儲存空間。</p>
            {error && <p role="alert" className="text-sm font-bold text-rose-700">{error}</p>}
            <button type="button" disabled={linkCopied} onClick={copyManagementUrl} className="w-full py-3 bg-gray-900 text-white font-black rounded-lg flex items-center justify-center gap-2 disabled:opacity-60"><Clipboard className="w-4 h-4" /> {linkCopied ? '管理連結已複製並從頁面記憶體清除' : '複製管理連結'}</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm font-black text-gray-700">玩家名稱<input required maxLength={40} value={form.playerName} onChange={(e) => setForm({ ...form, playerName: e.target.value })} className="mt-1 w-full p-3 border border-gray-300 rounded-lg" /></label>
            <label className="block text-sm font-black text-gray-700">官方玩家 ID（選填）<input maxLength={40} value={form.officialId} onChange={(e) => setForm({ ...form, officialId: e.target.value })} className="mt-1 w-full p-3 border border-gray-300 rounded-lg" /></label>
            <label className="block text-sm font-black text-gray-700">使用牌組（選填）<input maxLength={80} value={form.deckName} onChange={(e) => setForm({ ...form, deckName: e.target.value })} className="mt-1 w-full p-3 border border-gray-300 rounded-lg" /></label>
            <label className="block text-sm font-black text-gray-700">榮耀 ID（選填）<input maxLength={40} value={form.honorId} onChange={(e) => setForm({ ...form, honorId: e.target.value })} className="mt-1 w-full p-3 border border-gray-300 rounded-lg" /></label>
            <p className="text-xs leading-relaxed text-gray-500">以上資料僅用於本場賽事辨識、名單管理與後續報到；不蒐集電話、Email 或付款資料。</p>
            {error && <p role="alert" className="text-sm font-bold text-rose-700">{error}</p>}
            <button disabled={submitting} className="w-full py-3 bg-emerald-600 text-white font-black rounded-lg disabled:opacity-60">{submitting ? '送出中……' : '送出預報名'}</button>
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
    <div className="fixed inset-0 z-[100] bg-black/55 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg bg-white border border-gray-200 rounded-lg shadow-2xl p-6">
        <div className="flex items-center justify-between mb-5"><h2 className="text-xl font-black text-gray-900">管理我的預報名</h2><button type="button" onClick={close} title="關閉" className="p-2 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button></div>
        {loading ? <p className="font-bold text-gray-500">正在安全讀取報名資料……</p> : error && !entry ? <p role="alert" className="font-bold text-rose-700">{error}</p> : entry && (
          <div className="space-y-4">
            <p className="text-sm font-bold text-gray-500">報名編號：{shortenRegistrationId(entry.registrationId)} · {entry.status === 'active' ? '有效' : '已取消'}</p>
            {entry.managementState === 'event_started' && <p className="text-sm font-bold text-amber-700">活動已開始或結束，目前僅提供報名摘要查閱。</p>}
            {entry.managementState === 'deadline_passed' && <p className="text-sm font-bold text-amber-700">修改期限已截止；活動開始前仍可取消報名。</p>}
            {entry.managementState === 'closed' && <p className="text-sm font-bold text-amber-700">主辦方已關閉新報名與資料修改；活動開始前仍可取消。</p>}
            {entry.status === 'active' && <>
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

export function PreRegistrationAdminDialog({ open, event, isAdmin, db, appId, functions, swissAppUrl, onClose }) {
  const [entries, setEntries] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('active');
  const [error, setError] = useState('');

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
  const visible = entries.filter((entry) => (filter === 'all' || entry.status === filter)
    && (!needle || [entry.playerName, entry.officialId, entry.deckName, entry.honorId, entry.registrationId]
      .some((value) => String(value || '').toLocaleLowerCase('zh-TW').includes(needle))));

  return (
    <div className="fixed inset-0 z-[100] bg-black/55 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-4xl max-h-[85vh] overflow-auto bg-white rounded-lg shadow-2xl p-6">
        <div className="flex items-start justify-between gap-4 mb-5"><div><h2 className="text-xl font-black">預報名名單</h2><p className="text-sm font-bold text-gray-500">{event.title} · {entries.filter((entry) => entry.status === 'active').length} 人有效</p></div><button type="button" title="關閉" onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button></div>
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <label className="relative flex-1"><Search className="w-4 h-4 absolute left-3 top-3.5 text-gray-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋玩家或報名編號" className="w-full pl-9 pr-3 py-3 border rounded-lg" /></label>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="p-3 border rounded-lg font-bold"><option value="active">有效</option><option value="cancelled">已取消</option><option value="all">全部</option></select>
        </div>
        {error ? <p role="alert" className="font-bold text-rose-700">{error}</p> : visible.length === 0 ? <p className="font-bold text-gray-400 py-10 text-center">沒有符合條件的預報名</p> : (
          <div className="divide-y border rounded-lg overflow-hidden">{visible.map((entry) => (
            <div key={entry.registrationId} className="p-4 grid grid-cols-1 md:grid-cols-7 gap-2 text-sm">
              <span className="font-black">{entry.playerName}</span><span>{entry.officialId || '無官方 ID'}</span><span>{entry.deckName || '未填牌組'}</span><span>{entry.honorId || '無榮耀 ID'}</span><span className="font-mono">{shortenRegistrationId(entry.registrationId)}</span><span>{entry.createdAt ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(entry.createdAt?.toMillis?.() ?? entry.createdAt)) : '時間待同步'}</span><span className={entry.status === 'active' ? 'text-emerald-700 font-black' : 'text-gray-500 font-black'}>{entry.status === 'active' ? '有效' : '已取消'}</span>
            </div>
          ))}</div>
        )}
        {!error && <PreRegistrationSwissImportControls event={event} entries={entries} isAdmin={isAdmin} functions={functions} swissAppUrl={swissAppUrl} />}
        <div className="mt-5 flex items-center gap-2 text-xs text-gray-500 font-bold"><ShieldCheck className="w-4 h-4" /> 名單僅在管理員視窗開啟期間讀取；不顯示 token、IP 或內部稽核資料。</div>
      </div>
    </div>
  );
}
