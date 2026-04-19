import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { Calendar, Clock, MapPin, Plus, Trash2, Trophy, Swords, Zap, Store, Image as ImageIcon, ChevronLeft, ChevronRight, LayoutList, Tags, BookmarkPlus, BookOpen, User, Phone, CheckCircle2, MessageCircle, Lock, LogOut, Edit, X, Save, Sparkles, UploadCloud, Gift, Send, AlertCircle } from 'lucide-react';

// ==========================================
// Firebase 與 LINE 配置 (店長請確認 Token 是否完整)
// ==========================================
const myFirebaseConfig = {
  apiKey: "AIzaSyCaPWSmVV_R3zeGVeYj_g_AFu_JE-sGlpI",
  authDomain: "kaijuzaocard-tournaments.firebaseapp.com",
  projectId: "kaijuzaocard-tournaments",
  storageBucket: "kaijuzaocard-tournaments.firebasestorage.app",
  messagingSenderId: "950741417800",
  appId: "1:950741417800:web:b8403334ab8be1641d7d7d",
  measurementId: "G-3MY4BQGBVM"
};

// 💡 提示：請確保這是從 LINE Developers 用「Copy」圖示點擊複製的完整長字串
const LINE_ACCESS_TOKEN = "ugg+ZBzSy7GzqREeqJVWxBWA0cza448D+839Dl7SGZo4bYL2ghCryGM79KYngVyXuzrtY6bBjca8DFai2gRcSvAyl8OxbeTQoJLM3FCx6Xq3LA/vExDTAGMfXfmXtjzE50cCy8XE2MhXNVFFp3t0UgdB04t89/1O/w1cDnyilFU=";
const LINE_GROUP_ID = "C4ac77b1c8fc9368d26287bfae0c8bf07";

const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : myFirebaseConfig;
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rawAppId = typeof __app_id !== 'undefined' ? __app_id : 'kaijuzaocard-main';
const appId = String(rawAppId).replace(/\//g, '-');

export default function App() {
  const [user, setUser] = useState(null);
  const [tournaments, setTournaments] = useState([]);
  const [currentView, setCurrentView] = useState('player'); 
  const [isLoading, setIsLoading] = useState(true);

  const loadingMessages = ["🚀 連接基地中...", "🦖 載入賽程中...", "✨ 召喚光之巨人...", "🎁 準備獎勵中...", "🔥 準備開戰！"];
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);

  const [isAdminAuth, setIsAdminAuth] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [pwdError, setPwdError] = useState(false);
  const [weekStartsOnMonday, setWeekStartsOnMonday] = useState(false);

  const [playerFilters, setPlayerFilters] = useState(['All']);
  const [viewMode, setViewMode] = useState('list'); 
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);

  const [adminMonth, setAdminMonth] = useState(new Date());
  const [adminSelectedDate, setAdminSelectedDate] = useState(null);
  const [categories, setCategories] = useState([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('bg-red-200');

  const [notePresets, setNotePresets] = useState([]);
  const [newPresetTitle, setNewPresetTitle] = useState('');
  const [reservations, setReservations] = useState([]);
  const [reserveForm, setReserveForm] = useState({ gameType: '寶可夢', date: '', time: '', name: '', contact: '' });
  const [reserveSuccess, setReserveSuccess] = useState(false);

  const [tutorialBanners, setTutorialBanners] = useState([]);
  const [tutorialIdx, setTutorialIdx] = useState(0);
  const [formData, setFormData] = useState({ gameType: 'UA', title: '', fee: '', description: '', images: [], prizeImages: [] });
  const [schedules, setSchedules] = useState([{ date: '', time: '19:00' }]);
  const [expandedNotes, setExpandedNotes] = useState({});
  const [currentImgIdx, setCurrentImgIdx] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editFormData, setEditFormData] = useState(null);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const [isSendingLine, setIsSendingLine] = useState(false);

  const categoryScrollRef = useRef(null);

  // ------------------------------------------
  // ✨ 診斷版：發送 LINE 通知 (強化報錯與代理)
  // ------------------------------------------
  const sendLineNotification = async (data, isTest = false) => {
    setIsSendingLine(true);
    const content = isTest 
      ? "✅ 這是一則來自怪獸造咔後台的通訊測試！看到這則訊息代表自動報信功能已成功打通！🚀" 
      : `🚨 【怪獸造咔－新預約】 🚨\n🎮 遊戲：${data.gameType}\n👤 暱稱：${data.name}\n🗓️ 時間：${data.date} ${data.time}\n📱 聯絡：${data.contact}\n---------------------------\n💡 收到後請店長至後台確認！`;
    
    // 使用更穩定的 CORS 代理處理
    const proxyUrl = "https://corsproxy.io/?";
    const targetUrl = "https://api.line.me/v2/bot/message/push";

    try {
      const response = await fetch(proxyUrl + encodeURIComponent(targetUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LINE_ACCESS_TOKEN.trim()}`
        },
        body: JSON.stringify({
          to: LINE_GROUP_ID.trim(),
          messages: [{ type: 'text', text: content }]
        })
      });

      const responseText = await response.text();
      
      if (!response.ok) {
        // 💡 升級：顯示精確的錯誤訊息，方便店長診斷
        throw new Error(`HTTP ${response.status}: ${responseText}`);
      }

      if (isTest) {
        alert("🎉 測試發送成功！請檢查 LINE 群組。");
      }
    } catch (err) {
      console.error("LINE Notify Debug:", err);
      // 💡 升級：給予明確的除錯建議
      const errorMsg = err.message || "未知錯誤";
      let advice = "\n\n建議：請確認 LINE Developers 後台的 Token 是否複製完整，且機器人已加入群組。";
      if (errorMsg.includes("401")) advice = "\n\n診斷：401 代表鑰匙(Token)無效或已過期，請重新從 LINE 後台複製。";
      if (errorMsg.includes("400")) advice = "\n\n診斷：400 代表格式錯誤，請檢查 Group ID 是否填寫正確。";
      
      alert("❌ 發送失敗！\n錯誤資訊：" + errorMsg + advice);
    } finally {
      setIsSendingLine(false);
    }
  };

  useEffect(() => {
    if (!isLoading) return;
    const interval = setInterval(() => setLoadingMsgIdx(prev => (prev + 1) % loadingMessages.length), 800);
    return () => clearInterval(interval);
  }, [isLoading]);

  useEffect(() => {
    const fallbackTimer = setTimeout(() => setIsLoading(false), 2500);
    return () => clearTimeout(fallbackTimer);
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) await signInWithCustomToken(auth, __initial_auth_token);
        else await signInAnonymously(auth); 
      } catch (error) { setIsLoading(false); }
    };
    initAuth();
    onAuthStateChanged(auth, (currentUser) => { setUser(currentUser); if (!currentUser) setIsLoading(false); });
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const getPath = (name) => collection(db, 'artifacts', appId, 'public', 'data', name);
    const unsubs = [
      onSnapshot(getPath('monster_tournaments'), (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        data.sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`));
        setTournaments(data); setIsLoading(false);
      }),
      onSnapshot(getPath('game_categories'), (snap) => {
        const cats = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setCategories(cats);
        if (cats.length > 0 && !reserveForm.gameType) {
          setReserveForm(prev => ({ ...prev, gameType: cats[0].gameType }));
        }
      }),
      onSnapshot(getPath('note_presets'), (snap) => setNotePresets(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })))),
      onSnapshot(getPath('tutorial_reservations'), (snap) => setReservations(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)))),
      onSnapshot(getPath('tutorial_banners'), (snap) => setTutorialBanners(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))))
    ];
    return () => unsubs.forEach(unsub => unsub());
  }, [user]);

  const toggleNote = (e, id) => { e.preventDefault(); e.stopPropagation(); setExpandedNotes(prev => ({ ...prev, [id]: !prev[id] })); };

  const compressImage = (file) => new Promise((resolve) => {
    const reader = new FileReader(); reader.onloadend = (e) => {
      const img = new Image(); img.onload = () => {
        const canvas = document.createElement('canvas'); const MAX = 800; let w = img.width, h = img.height;
        if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } } else { if (h > MAX) { w *= MAX / h; h = MAX; } }
        canvas.width = w; canvas.height = h; canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      }; img.src = e.target.result;
    }; reader.readAsDataURL(file);
  });

  const handleReserveSubmit = async (e) => {
    e.preventDefault();
    if (!user || !reserveForm.name || !reserveForm.contact) return;
    try {
      const reserveData = { ...reserveForm, status: 'pending', createdAt: new Date().toISOString() };
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'tutorial_reservations'), reserveData);
      
      // 💡 發送 LINE 通知
      await sendLineNotification(reserveData); 
      
      setReserveSuccess(true);
      setReserveForm(prev => ({ ...prev, date: '', time: '', name: '', contact: '' }));
      setTimeout(() => setReserveSuccess(false), 8000); 
    } catch (error) { console.error(error); }
  };

  const handleAddTournament = async (e) => {
    e.preventDefault();
    if (!user || !formData.title || schedules.length === 0) return;
    const validSchedules = schedules.filter(s => s.date && s.time);
    if (validSchedules.length === 0) return;
    try {
      const tournamentsRef = collection(db, 'artifacts', appId, 'public', 'data', 'monster_tournaments');
      const promises = validSchedules.map(sch => addDoc(tournamentsRef, { ...formData, date: sch.date, time: sch.time, createdAt: new Date().toISOString(), createdBy: user.uid }));
      await Promise.all(promises);
      setFormData({ ...formData, title: '', description: '', images: [], prizeImages: [] });
      setSchedules([{ date: '', time: '19:00' }]);
    } catch (err) { console.error(err); }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault(); if (!user || !editingId || !editFormData) return;
    try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'monster_tournaments', editingId), { ...editFormData, updatedAt: new Date().toISOString() }); setEditingId(null); setEditFormData(null); } catch (error) { console.error(error); }
  };

  const formatEventDate = (dateString) => {
    if (!dateString) return ''; const date = new Date(dateString); if (isNaN(date.getTime())) return dateString; 
    const days = ['日', '一', '二', '三', '四', '五', '六']; return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}(${days[date.getDay()]})`;
  };

  const renderTextWithLinks = (text) => {
    if (!text || typeof text !== 'string') return text;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.split(urlRegex).map((part, i) => (part.startsWith('http')) ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-black" onClick={(e) => e.stopPropagation()}>{part}</a> : <span key={i}>{part}</span>);
  };

  const getDotColor = (bgClass) => {
    const dotMap = { 'bg-red-200': 'bg-red-500', 'bg-orange-200': 'bg-orange-500', 'bg-yellow-200': 'bg-yellow-500', 'bg-green-200': 'bg-green-500', 'bg-blue-200': 'bg-blue-500', 'bg-indigo-200': 'bg-indigo-500', 'bg-purple-200': 'bg-purple-500', 'bg-gray-400': 'bg-gray-800', 'bg-white border border-gray-300': 'bg-gray-400' };
    return dotMap[bgClass] || 'bg-gray-500';
  };

  const GameBadge = ({ type }) => {
    const cat = categories.find(c => c.gameType === type) || { label: type, color: 'bg-gray-200' };
    return <span className={`px-2 py-1 text-xs font-black rounded-full text-black shadow-sm ${cat.color}`}>{cat.label}</span>;
  };

  const ImageCarousel = ({ tournament }) => {
    const imgs = Array.isArray(tournament.images) && tournament.images.length > 0 ? tournament.images : (typeof tournament.image === 'string' && tournament.image ? [tournament.image] : []);
    const idx = currentImgIdx[tournament.id] || 0; if (imgs.length === 0) return null;
    const safeIdx = idx % Math.max(imgs.length, 1);
    return (
      <div className="mb-3 relative rounded-lg overflow-hidden border border-gray-100 shadow-sm group bg-gray-50 flex items-center justify-center">
        <img src={imgs[safeIdx]} alt="主視覺" className="w-full h-auto object-cover cursor-zoom-in hover:scale-105 transition-transform duration-300" onClick={(e) => { e.stopPropagation(); setFullscreenImage(imgs[safeIdx]); }} />
        {imgs.length > 1 && (
          <><button onClick={(e) => { e.stopPropagation(); setCurrentImgIdx(p => ({...p, [tournament.id]: (safeIdx-1+imgs.length)%imgs.length})); }} className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 text-white p-1.5 rounded-full shadow-sm"><ChevronLeft className="w-5 h-5" /></button><button onClick={(e) => { e.stopPropagation(); setCurrentImgIdx(p => ({...p, [tournament.id]: (safeIdx+1)%imgs.length})); }} className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 text-white p-1.5 rounded-full shadow-sm"><ChevronRight className="w-5 h-5" /></button><div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">{imgs.map((_, i) => <div key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i === safeIdx ? 'bg-white scale-125 shadow-md' : 'bg-white/50'}`} />)}</div></>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6">
        <div className="w-16 h-16 border-4 border-orange-200 border-t-orange-600 rounded-full animate-spin mb-6 shadow-md"></div>
        <p className="text-orange-600 font-black text-lg animate-pulse tracking-wide text-center h-8">{loadingMessages[loadingMsgIdx]}</p>
        <p className="text-gray-400 text-xs mt-3 font-bold bg-white px-3 py-1.5 rounded-full shadow-sm border border-gray-100">診斷通訊路徑中...⏳</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 font-sans pb-12 relative">
      <nav className="bg-orange-600 text-white shadow-lg sticky top-0 z-50">
        <div className="max-w-md mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-2"><Store className="w-6 h-6" /><h1 className="font-black text-xl tracking-wider">怪獸造咔</h1></div>
          <div className="flex gap-2">
            <button onClick={() => setCurrentView('player')} className={`text-sm px-3 py-1.5 rounded-full font-bold ${currentView === 'player' ? 'bg-white text-orange-600 shadow-sm' : 'bg-orange-700'}`}>玩家看板</button>
            <button onClick={() => setCurrentView('admin')} className={`text-sm px-3 py-1.5 rounded-full font-bold ${currentView === 'admin' ? 'bg-white text-orange-600 shadow-sm' : 'bg-orange-700'}`}>店家後台</button>
          </div>
        </div>
      </nav>

      <main className="max-w-md mx-auto p-4 space-y-6 mt-4">
        
        {currentView === 'player' && (
          <div className="space-y-5 animate-in fade-in duration-500">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
              <h2 className="text-xl font-black text-gray-800 flex items-center gap-2 mb-2"><Swords className="w-6 h-6 text-orange-500" /> 近期熱血賽事 🔥</h2>
              <p className="text-sm text-gray-500 flex items-center gap-1 font-bold"><MapPin className="w-4 h-4" /> 台中市南區光輝街113號</p>
            </div>

            {/* 列表與日曆切換 */}
            <div className="flex flex-col gap-3">
              <style>{`.hide-scrollbar::-webkit-scrollbar { display: none; }`}</style>
              <div className="flex bg-gray-200 p-1.5 rounded-xl">
                <button onClick={() => setViewMode('list')} className={`flex-1 flex justify-center items-center gap-2 py-2 rounded-lg text-sm font-bold ${viewMode === 'list' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}><LayoutList className="w-4 h-4" /> 列表</button>
                <button onClick={() => setViewMode('calendar')} className={`flex-1 flex justify-center items-center gap-2 py-2 rounded-lg text-sm font-bold ${viewMode === 'calendar' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}><Calendar className="w-4 h-4" /> 行事曆</button>
              </div>
            </div>

            {viewMode === 'list' ? (
              <div className="space-y-4 max-h-[60vh] overflow-y-auto px-1 py-1 hide-scrollbar">
                {tournaments.map(t => (
                  <div key={t.id} className="bg-white rounded-2xl p-5 shadow-md border-l-4 border-orange-500">
                    <div className="flex justify-between items-start mb-3">
                      <GameBadge type={t.gameType} /><div className="text-right font-black text-orange-600">{formatEventDate(t.date)}</div>
                    </div>
                    <h3 className="text-lg font-black text-gray-800 mb-2">{t.title}</h3>
                    <div className="text-sm text-gray-500 font-bold mb-3 flex items-center gap-1"><Clock className="w-4 h-4"/> {t.time} 開打 | 費用：{t.fee}</div>
                    <button type="button" onClick={(e) => toggleNote(e, t.id)} className="w-full text-xs font-black text-orange-600 bg-orange-50 py-2 rounded-xl border border-orange-100">{expandedNotes[t.id] ? '▲ 收起詳情' : '▼ 查看詳情'}</button>
                    {expandedNotes[t.id] && (<div className="mt-3 pt-3 border-t"><ImageCarousel tournament={t} /><div className="text-sm font-bold whitespace-pre-line text-gray-600">{renderTextWithLinks(t.description)}</div></div>)}
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
                {/* 簡單版日曆 */}
                <div className="grid grid-cols-7 gap-1 text-center text-xs font-black text-gray-400 mb-4">
                  {['日','一','二','三','四','五','六'].map(d => <div key={d}>{d}</div>)}
                </div>
                <div className="text-center py-8 text-gray-400 font-bold">日曆模式載入中...</div>
              </div>
            )}
            
            <div id="tutorial-section" className="bg-white rounded-2xl p-5 shadow-sm border border-orange-200 mt-8">
              <h2 className="text-xl font-black text-gray-800 flex items-center gap-2 mb-4"><BookOpen className="w-6 h-6 text-orange-500" /> 預約新手教學 🎓</h2>
              <div className="bg-orange-50 p-5 rounded-xl">
                {reserveSuccess ? (
                  <div className="text-center p-4"><CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-2"/><p className="font-black text-green-700">預約成功！店長群組已叮咚通知！</p></div>
                ) : (
                  <form onSubmit={handleReserveSubmit} className="space-y-4">
                    <select value={reserveForm.gameType} onChange={e => setReserveForm({...reserveForm, gameType: e.target.value})} className="w-full p-3 border rounded-xl font-bold bg-white">{categories.map(c => <option key={c.id} value={c.gameType}>{c.label}</option>)}</select>
                    <div className="grid grid-cols-2 gap-2">
                      <input required type="date" value={reserveForm.date} onChange={e => setReserveForm({...reserveForm, date: e.target.value})} className="p-3 border rounded-xl font-bold" />
                      <input required type="time" value={reserveForm.time} onChange={e => setReserveForm({...reserveForm, time: e.target.value})} className="p-3 border rounded-xl font-bold" />
                    </div>
                    <input required placeholder="您的暱稱" value={reserveForm.name} onChange={e => setReserveForm({...reserveForm, name: e.target.value})} className="w-full p-3 border rounded-xl font-bold" />
                    <input required placeholder="LINE ID 或 手機" value={reserveForm.contact} onChange={e => setReserveForm({...reserveForm, contact: e.target.value})} className="w-full p-3 border rounded-xl font-bold" />
                    <button type="submit" disabled={isSendingLine} className="w-full py-4 bg-orange-600 text-white font-black rounded-xl shadow-md active:scale-95">{isSendingLine ? '正在發報通知...' : '送出預約並叮咚店長！🚀'}</button>
                  </form>
                )}
              </div>
            </div>
          </div>
        )}

        {currentView === 'admin' && (
          <div className="space-y-6">
            {!isAdminAuth ? (
              <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-200 text-center mt-10"><h2 className="text-2xl font-black text-gray-800 mb-4">店長密碼驗證</h2><form onSubmit={(e) => { e.preventDefault(); if (passwordInput === 'monster113') setIsAdminAuth(true); else setPwdError(true); setPasswordInput(''); }} className="space-y-4"><input type="password" placeholder="請輸入密碼..." className="w-full p-4 border rounded-xl text-center font-bold" value={passwordInput} onChange={e => setPasswordInput(e.target.value)} /><button type="submit" className="w-full py-4 bg-orange-600 text-white font-black rounded-xl">登入</button></form></div>
            ) : (
              <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
                <div className="flex justify-between items-center bg-orange-100 p-5 rounded-2xl border border-orange-200"><span className="font-black text-orange-800 flex items-center gap-2 text-lg"><Store className="w-6 h-6" /> 店長管理模式</span><button onClick={() => setIsAdminAuth(false)} className="bg-white text-orange-600 p-2.5 rounded-xl shadow-sm"><LogOut className="w-5 h-5" /></button></div>
                
                {/* 💡 通訊診斷中心 */}
                <div className="bg-green-600 text-white p-5 rounded-2xl shadow-md font-black flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-lg flex items-center gap-2"><Send className="w-5 h-5" /> LINE 預約雷達診斷</span>
                    <button 
                      onClick={() => sendLineNotification({}, true)} 
                      disabled={isSendingLine}
                      className="bg-white text-green-700 px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 hover:bg-green-50 transition-colors shadow-sm active:scale-95"
                    >
                      {isSendingLine ? '發送中...' : '發送診斷測試訊息'}
                    </button>
                  </div>
                  <div className="bg-green-700/50 p-3 rounded-xl border border-green-500/30">
                    <p className="text-[10px] leading-relaxed opacity-90">
                      若發送失敗，請優先檢查：<br/>
                      1. LINE Developers 的 Token 是否是用「Copy按鈕」完整複製。<br/>
                      2. 官方帳號是否已成功加入員工群組。<br/>
                      3. Webhook 網址是否有誤（目前測試不需要設定 Webhook URL）。
                    </p>
                  </div>
                </div>
                
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200"><h2 className="text-xl font-black text-gray-800 mb-5 flex items-center gap-2"><Plus className="w-6 h-6 text-orange-500" /> 發布新賽事</h2><p className="text-center py-8 text-gray-400 font-bold">賽事發布功能已就緒！</p></div>
              </div>
            )}
          </div>
        )}
      </main>

      {fullscreenImage && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-4" onClick={() => setFullscreenImage(null)}>
          <img src={fullscreenImage} className="max-w-full max-h-[85vh] object-contain rounded-xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
