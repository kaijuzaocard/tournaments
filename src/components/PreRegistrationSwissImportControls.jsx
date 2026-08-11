import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, ShieldAlert } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { createRequestId } from '../utils/preRegistration.js';
import {
  buildPreRegistrationSwissHandoffUrl,
  classifyPreRegistrationImportAvailability,
  classifyPreRegistrationImportEntry,
  normalizeSelectedRegistrationIds,
} from '../utils/preRegistrationSwissHandoff.js';

function handoffError(error) {
  const code = String(error?.details || error?.message || error?.code || 'UNKNOWN_ERROR').split('/').pop();
  const messages = {
    EVENT_STARTED: '活動已開始，不能再建立名單快照。',
    HANDOFF_ALREADY_CLAIMED: '名單正在另一個瑞士制視窗處理。',
    NO_IMPORTABLE_REGISTRATIONS: '選取的報名都已匯入，沒有新的玩家可交接。',
    REGISTRATION_IMPORT_CONFLICT: '選取名單含有已匯入其他賽事的玩家。',
    REGISTRATION_NOT_ACTIVE: '選取名單包含已取消的報名。',
    REQUEST_ID_PAYLOAD_MISMATCH: '匯入請求識別碼與選取名單不一致。',
    SWISS_INTEGRATION_REQUIRED: '請先建立或開啟瑞士制賽事，再匯入預報名名單。',
  };
  return messages[code] || `名單交接失敗（${code}）`;
}

function entryStatusLabel(status) {
  return {
    available: '可匯入',
    already_imported: '已匯入瑞士制',
    import_conflict: '已匯入其他賽事',
    waitlisted: '候補（不可匯入）',
    cancelled: '已取消',
    malformed: '資料格式異常',
  }[status] || status;
}

export default function PreRegistrationSwissImportControls({ event, entries, isAdmin, functions, swissAppUrl }) {
  const availability = useMemo(
    () => classifyPreRegistrationImportAvailability({ event, entries, isAdmin }),
    [event, entries, isAdmin],
  );
  const [selected, setSelected] = useState(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [handoff, setHandoff] = useState(null);
  const [error, setError] = useState('');
  const pollTimerRef = useRef(null);
  const selectionInitializedRef = useRef(false);
  const selectableKey = (availability.selectableIds || []).join('\u0000');

  useEffect(() => {
    selectionInitializedRef.current = false;
    setSelected(new Set());
    setConfirming(false);
    setHandoff(null);
    setError('');
  }, [event?.id, availability.targetSwissTournamentId]);

  useEffect(() => {
    const selectableIds = availability.selectableIds || [];
    const selectable = new Set(selectableIds);
    if (!selectionInitializedRef.current && selectableIds.length > 0) {
      selectionInitializedRef.current = true;
      setSelected(new Set(selectableIds));
      return;
    }
    setSelected((current) => new Set(Array.from(current).filter((registrationId) => selectable.has(registrationId))));
  }, [selectableKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
  }, []);

  const pollStatus = (handoffId) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    const getStatus = httpsCallable(functions, 'getTournamentPreRegistrationHandoffStatus');
    const run = async () => {
      try {
        const response = await getStatus({ handoffId, calendarEventId: event.id });
        const status = response.data?.status;
        setHandoff((current) => current?.handoffId === handoffId ? { ...current, ...response.data } : current);
        if (['completed', 'expired'].includes(status)) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      } catch (pollError) {
        setError(handoffError(pollError));
      }
    };
    run();
    pollTimerRef.current = setInterval(run, 2000);
  };

  const launch = async () => {
    if (working) return;
    let popup = null;
    try {
      const selectedRegistrationIds = normalizeSelectedRegistrationIds(Array.from(selected));
      popup = window.open('', 'KJZC_PREREGISTRATION_SWISS_IMPORT');
      if (!popup) {
        setError('瀏覽器已阻擋新視窗；尚未建立或消耗任何名單交接。');
        return;
      }
      popup.document.title = '正在準備瑞士制名單匯入';
      popup.document.body.textContent = '正在安全準備名單交接……';
      setWorking(true);
      setError('');
      const createHandoff = httpsCallable(functions, 'createTournamentPreRegistrationHandoff');
      const response = await createHandoff({
        requestId: createRequestId(),
        calendarEventId: event.id,
        selectedRegistrationIds,
      });
      const { handoffId, handoffToken, alreadyImportedCount = 0 } = response.data || {};
      const destination = buildPreRegistrationSwissHandoffUrl({ swissAppUrl, handoffId, handoffToken });
      setHandoff({ handoffId, status: 'ready', selectedCount: selectedRegistrationIds.length, alreadyImportedCount });
      setConfirming(false);
      popup.location.replace(destination);
      pollStatus(handoffId);
    } catch (launchError) {
      popup?.close?.();
      setError(handoffError(launchError));
    } finally {
      setWorking(false);
    }
  };

  if (!swissAppUrl) {
    return <p className="mt-4 rounded-lg border border-slate-300 bg-slate-100 p-3 text-sm font-bold text-slate-700">Preview-only：Swiss 外部名單交接已停用。</p>;
  }
  if (availability.status === 'unlinked') {
    return <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">請先建立或開啟瑞士制賽事，再匯入預報名名單。</p>;
  }
  if (availability.status === 'malformed_link') {
    return <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">瑞士制關聯資料異常，名單匯入已安全停用。</p>;
  }
  if (availability.status === 'event_started' || availability.status === 'malformed_event') {
    return <p className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm font-bold text-gray-600">活動已開始或時間資料異常，不能建立預報名快照。</p>;
  }

  return (
    <section className="mt-5 border-t border-emerald-100 pt-5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h3 className="font-black text-gray-800">匯入至瑞士制待報到名單</h3><p className="text-xs font-bold text-gray-500 mt-1">匯入為當下名單快照，後續修改不會自動同步。</p></div>
        <span className="text-xs font-black text-emerald-700">已選 {selected.size} / 128</span>
      </div>
      <div className="max-h-52 overflow-auto rounded-lg border divide-y">
        {entries.map((entry) => {
          const classification = classifyPreRegistrationImportEntry(entry, availability.targetSwissTournamentId);
          const selectable = classification.status === 'available';
          return <label key={entry.registrationId} className={`grid grid-cols-[auto,1fr,auto] gap-3 p-3 items-center text-sm ${selectable ? 'bg-white' : 'bg-gray-50 text-gray-500'}`}>
            <input type="checkbox" checked={selected.has(entry.registrationId)} disabled={!selectable || working} onChange={(e) => setSelected((current) => { const next = new Set(current); if (e.target.checked) next.add(entry.registrationId); else next.delete(entry.registrationId); return next; })} />
            <span><b>{entry.playerName}</b><span className="block text-xs">{entry.officialId || '無官方 ID'} · {entry.deckName || '未填牌組'} · {entry.honorId || '無 Honor ID'}</span></span>
            <span className="text-xs font-black">{entryStatusLabel(classification.status)}</span>
          </label>;
        })}
      </div>
      {confirming && <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm"><p className="font-black text-indigo-900">即將建立 {selected.size} 筆短效一次性名單快照</p><p className="mt-1 text-xs font-bold text-indigo-700">玩家會以「待報到」匯入；不會自動報到、開始輪次或建立配對。</p></div>}
      {handoff && <p className="text-sm font-bold text-indigo-700">交接狀態：{handoff.status === 'completed' ? `完成（${handoff.importedCount || 0} 人）` : handoff.status === 'claimed' ? '瑞士制已領取' : handoff.status === 'expired' ? '已過期' : '等待瑞士制領取'}</p>}
      {error && <p role="alert" className="text-sm font-bold text-rose-700 flex items-start gap-2"><ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />{error}</p>}
      <div className="flex justify-end gap-2">
        {confirming && <button type="button" disabled={working} onClick={() => setConfirming(false)} className="px-3 py-2 rounded-lg border font-bold">返回選擇</button>}
        <button type="button" disabled={working || selected.size < 1 || availability.status !== 'available'} onClick={confirming ? launch : () => setConfirming(true)} className="px-4 py-2 rounded-lg bg-indigo-700 text-white font-black disabled:opacity-50 flex items-center gap-2"><ExternalLink className="w-4 h-4" />{working ? '正在建立交接……' : confirming ? '確認並開啟瑞士制' : '匯入至瑞士制待報到名單'}</button>
      </div>
    </section>
  );
}
