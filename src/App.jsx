import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { Calendar, Clock, MapPin, Plus, Trash2, Trophy, Swords, Zap, Store, Image as ImageIcon, ChevronLeft, ChevronRight, LayoutList, Tags, BookmarkPlus, BookOpen, User, Phone, CheckCircle2, MessageCircle, Lock, LogOut, Edit, X, Save, Sparkles, UploadCloud, Gift, Send } from 'lucide-react';

// ==========================================
// Firebase 與 LINE 配置
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
  // ✨ 更新版：發送 LINE 通知 (使用 CORS Proxy)
  // ------------------------------------------
  const sendLineNotification = async (data, isTest = false) => {
    setIsSendingLine(true);
    const content = isTest 
      ? "✅ 這是一則來自怪獸造咔後台的測試訊息！通訊正常！" 
      : `🚨 【怪獸造咔－新預約】 🚨\n🎮 遊戲：${data.gameType}\n👤 暱稱：${data.name}\n🗓️ 時間：${data.date} ${data.time}\n📱 聯絡：${data.contact}\n---------------------------\n💡 收到後請店長至後台確認！`;
    
    // 使用公共 CORS 代理來繞過瀏覽器限制
    const proxyUrl = "https://corsproxy.io/?";
    const targetUrl = "https://api.line.me/v2/bot/message/push";

    try {
      const response = await fetch(proxyUrl + encodeURIComponent(targetUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
        },
        body: JSON.stringify({
          to: LINE_GROUP_ID,
          messages: [{ type: 'text', text: content }]
        })
      });

      if (!response.ok) throw new Error("LINE API 回應錯誤");
      if (isTest) {
          // 測試成功提示
          alert("測試成功！請檢查 LINE 群組是否收到通知。");
      }
    } catch (err) {
      console.error("LINE Notify Error:", err);
      if (isTest) alert("發送失敗，請確認 Access Token 或 Group ID 是否正確。");
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
      onSnapshot(getPath('game_categories'), (snap) => setCategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })))),
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
      setReserveForm({ gameType: categories[0]?.gameType || '寶可夢', date: '', time: '', name: '', contact: '' });
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

  const handleSavePreset = async () => {
    if (!user || !newPresetTitle.trim() || !formData.description.trim()) return;
    try { await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'note_presets'), { title: newPresetTitle.trim(), content: formData.description.trim(), createdAt: new Date().toISOString() }); setNewPresetTitle(''); } catch (error) { console.error(error); }
  };

  const handleDeletePreset = async (id) => { if (!user) return; try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'note_presets', id)); } catch (error) { console.error(error); } };

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
        <p className="text-gray-400 text-xs mt-3 font-bold bg-white px-3 py-1.5 rounded-full shadow-sm border border-gray-100">串聯光輝街 113 號基地中...⏳</p>
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

            <div className="flex flex-col gap-3">
              <style>{`.hide-scrollbar::-webkit-scrollbar { display: none; }`}</style>
              <div className="flex flex-wrap gap-2 px-1">
                <span className="text-[10px] font-bold text-orange-600 bg-orange-100 border border-orange-200 px-2 py-0.5 rounded-md inline-flex items-center shadow-sm">💡 分類按鈕可「多選」篩選！</span>
                <button onClick={() => document.getElementById('tutorial-section')?.scrollIntoView({ behavior: 'smooth' })} className="text-[10px] font-bold text-white bg-orange-500 hover:bg-orange-600 px-2 py-0.5 rounded-md inline-flex items-center shadow-sm active:scale-95 transition-all">🎓 預約新手教學 👉</button>
              </div>
              <div className="flex items-center gap-1 w-full">
                <button onClick={() => categoryScrollRef.current?.scrollBy({ left: -200, behavior: 'smooth' })} className="flex-shrink-0 w-9 h-9 bg-white shadow-sm rounded-full text-orange-600 border border-gray-200 flex items-center justify-center active:scale-95"><ChevronLeft className="w-5 h-5" /></button>
                <div ref={categoryScrollRef} className="flex-1 flex gap-2 overflow-x-auto pb-2 pt-1 px-1 hide-scrollbar scroll-smooth">
                  {[{ id: 'All', label: '全部', color: 'bg-white border-gray-300' }, ...categories.map(c => ({ id: c.gameType, label: c.label, color: c.color }))].map(cat => (
                    <button key={cat.id} onClick={() => { if (cat.id === 'All') setPlayerFilters(['All']); else setPlayerFilters(prev => { let n = prev.filter(p => p !== 'All'); if (n.includes(cat.id)) { n = n.filter(p => p !== cat.id); return n.length === 0 ? ['All'] : n; } return [...n, cat.id]; }); }} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-black transition-all shadow-sm text-black ${cat.color} ${playerFilters.includes(cat.id) ? 'ring-2 ring-black ring-offset-1 scale-105 opacity-100' : 'opacity-60 hover:opacity-100'}`}>{cat.label}</button>
                  ))}
                </div>
                <button onClick={() => categoryScrollRef.current?.scrollBy({ left: 200, behavior: 'smooth' })} className="flex-shrink-0 w-9 h-9 bg-white shadow-sm rounded-full text-orange-600 border border-gray-200 flex items-center justify-center active:scale-95"><ChevronRight className="w-5 h-5" /></button>
              </div>
              <div className="flex bg-gray-200 p-1.5 rounded-xl">
                <button onClick={() => setViewMode('list')} className={`flex-1 flex justify-center items-center gap-2 py-2 rounded-lg text-sm font-bold ${viewMode === 'list' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}><LayoutList className="w-4 h-4" /> 列表</button>
                <button onClick={() => setViewMode('calendar')} className={`flex-1 flex justify-center items-center gap-2 py-2 rounded-lg text-sm font-bold ${viewMode === 'calendar' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}><Calendar className="w-4 h-4" /> 行事曆</button>
              </div>
            </div>

            {viewMode === 'list' && (() => {
              const list = tournaments.filter(t => (playerFilters.includes('All') || playerFilters.includes(t.gameType)));
              return list.length === 0 ? <div className="text-center py-12 text-gray-400 font-bold bg-white rounded-2xl border-dashed border-2 border-gray-200">目前尚未安排賽事喔！😆</div> : (
                <div className="space-y-4 max-h-[60vh] overflow-y-auto px-1 py-1 hide-scrollbar">
                  {list.map(t => (
                    <div key={t.id} className="bg-white rounded-2xl p-5 shadow-md border-l-4 border-orange-500 transition-all hover:-translate-y-1">
                      <div className="flex justify-between items-start mb-3">
                        <GameBadge type={t.gameType} /><div className="text-right"><div className="text-orange-600 font-black text-lg">{formatEventDate(t.date)}</div><div className="text-gray-500 text-sm font-bold">{t.time} 開打</div></div>
                      </div>
                      <h3 className="text-lg font-black text-gray-800 mb-2">{t.title}</h3>
                      <div className="flex items-center gap-2 text-sm text-gray-600 mb-3 bg-gray-50 p-3 rounded-lg border border-gray-100"><Zap className="w-5 h-5 text-yellow-500" /><span className="font-bold">報名費/方案：{t.fee}</span></div>
                      <button type="button" onClick={(e) => toggleNote(e, t.id)} className="w-full text-sm font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 py-2.5 rounded-xl flex justify-center items-center gap-1 border border-orange-100 active:scale-95 transition-all">{expandedNotes[t.id] ? '▲ 收起詳細資訊' : '▼ 查看詳細資訊'}</button>
                      {expandedNotes[t.id] && (
                        <div className="mt-3 pt-3 border-t border-gray-100 animate-in slide-in-from-top-2 duration-300">
                          <ImageCarousel tournament={t} /><div className="text-sm text-gray-600 whitespace-pre-line font-bold leading-relaxed">{renderTextWithLinks(t.description)}</div>
                          {t.prizeImages && t.prizeImages.length > 0 && (
                            <div className="mt-4 p-3.5 bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl border border-yellow-200 shadow-sm">
                              <div className="text-sm font-black text-orange-800 mb-3 flex items-center gap-1.5"><Gift className="w-4 h-4 text-orange-500" /> 本場豪華獎勵一覽</div>
                              <div className={`grid gap-2 ${t.prizeImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                {t.prizeImages.map((img, i) => (<img key={`prize-${i}`} src={img} className="w-full h-auto rounded-lg border border-yellow-300 shadow-sm object-cover cursor-zoom-in" onClick={(e) => { e.stopPropagation(); setFullscreenImage(img); }} />))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}

            {viewMode === 'calendar' && (
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
                {/* 日曆邏輯維持原樣 */}
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))} className="p-2 hover:bg-orange-50 rounded-full text-orange-600"><ChevronLeft className="w-5 h-5"/></button>
                    <h3 className="font-black text-lg text-gray-800 w-24 text-center">{currentMonth.getMonth()+1}月</h3>
                    <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))} className="p-2 hover:bg-orange-50 rounded-full text-orange-600"><ChevronRight className="w-5 h-5"/></button>
                  </div>
                  <button onClick={() => setWeekStartsOnMonday(!weekStartsOnMonday)} className="text-xs font-bold text-gray-500 hover:text-orange-600 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200">改以「{weekStartsOnMonday ? '週日' : '週一'}」為起始</button>
                </div>
                <div className="grid grid-cols-7 gap-1 mb-2 text-center text-xs font-black text-gray-400">{(weekStartsOnMonday ? ['一','二','三','四','五','六','日'] : ['日','一','二','三','四','五','六']).map(h => <div key={h}>{h}</div>)}</div>
                <div className="grid grid-cols-7 gap-1">
                  {(() => {
                    const y = currentMonth.getFullYear(), m = currentMonth.getMonth(); const dCount = new Date(y, m + 1, 0).getDate(); const fDay = new Date(y, m, 1).getDay(); const adj = weekStartsOnMonday ? (fDay === 0 ? 6 : fDay - 1) : fDay;
                    const cells = []; for (let i = 0; i < adj; i++) cells.push(<div key={`e-${i}`} className="h-12"></div>);
                    for (let d = 1; d <= dCount; d++) {
                      const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                      const events = tournaments.filter(t => t.date === ds && (playerFilters.includes('All') || playerFilters.includes(t.gameType)));
                      const isToday = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}` === ds;
                      cells.push(
                        <button key={ds} onClick={() => setSelectedDate(selectedDate === ds ? null : ds)} className={`relative h-12 flex flex-col items-center justify-center rounded-xl border transition-all ${selectedDate === ds ? 'bg-orange-100 border-orange-500 shadow-inner' : isToday ? 'bg-gray-100 border-gray-300' : 'bg-white border-transparent hover:border-gray-200 hover:bg-gray-50'}`}>
                          <span className={`text-sm font-bold ${events.length > 0 ? 'text-gray-800' : 'text-gray-400'}`}>{d}</span>
                          {events.length > 0 && (<div className="flex gap-0.5 mt-1">{events.slice(0, 3).map((e, i) => <span key={i} className={`w-1.5 h-1.5 rounded-full ${getDotColor(categories.find(c => c.gameType === e.gameType)?.color || 'bg-gray-200')} shadow-sm`} />)}</div>)}
                        </button>
                      );
                    }
                    return cells;
                  })()}
                </div>
                {selectedDate && (
                  <div className="mt-5 pt-5 border-t border-gray-100 space-y-4">
                    <h4 className="font-black text-gray-700 text-md flex items-center gap-2"><Calendar className="w-5 h-5 text-orange-500" /> {selectedDate.replace(/-/g, '/')} 賽事清單</h4>
                    {tournaments.filter(t => t.date === selectedDate).map(t => (
                      <div key={t.id} className="p-4 bg-white shadow-md rounded-xl border-l-4 border-l-orange-500">
                        <div className="flex justify-between items-start mb-3">
                          <div><GameBadge type={t.gameType} /><div className="font-black text-gray-800 mt-2 text-lg">{t.title}</div><div className="text-sm text-gray-500 font-bold mt-1 flex items-center gap-1"><Clock className="w-4 h-4"/> {t.time} 開打</div></div>
                        </div>
                        <button type="button" onClick={(e) => toggleNote(e, t.id)} className="w-full text-sm font-bold text-orange-600 bg-orange-50 py-2 rounded-xl flex justify-center items-center gap-1 border border-orange-100">{expandedNotes[t.id] ? '▲ 收起' : '▼ 詳情'}</button>
                        {expandedNotes[t.id] && (<div className="mt-3 pt-3 border-t border-gray-100"><ImageCarousel tournament={t} /><div className="text-sm text-gray-600 font-bold whitespace-pre-line">{renderTextWithLinks(t.description)}</div></div>)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            <div id="tutorial-section" className="bg-white rounded-2xl p-5 shadow-sm border border-orange-200 relative overflow-hidden mt-8">
              <div className="absolute top-0 right-0 bg-orange-100 text-orange-700 text-xs font-black px-3 py-1.5 rounded-bl-xl shadow-sm">新手福利區</div>
              <h2 className="text-xl font-black text-gray-800 flex items-center gap-2 mb-4"><BookOpen className="w-6 h-6 text-orange-500" /> 預約新手教學 🎓</h2>
              {/* 教學輪播省略，維持原樣 */}
              <div className="mb-6 space-y-4 bg-orange-50 p-5 rounded-xl border border-orange-100">
                <div>
                  <p className="text-sm text-gray-800 font-black mb-2 flex items-center gap-1.5"><span className="bg-orange-500 text-white px-2 py-0.5 rounded-md text-xs shadow-sm">1</span> 建議先看影片 📺</p>
                  <a href="https://lin.ee/n9FQFBB" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-[#06C755] text-white font-black rounded-xl shadow-md hover:bg-[#05b34c] text-sm"><MessageCircle className="w-6 h-6" /> 觀看 LINE 教學影片</a>
                </div>
                <div className="border-t border-orange-200 pt-4">
                  <p className="text-sm text-gray-800 font-black mb-1 flex items-center gap-1.5"><span className="bg-orange-500 text-white px-2 py-0.5 rounded-md text-xs shadow-sm">2</span> 再填表預約 👇</p>
                  {reserveSuccess ? (
                    <div className="bg-green-50 p-5 rounded-xl text-center border border-green-200"><CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-2" /><div className="text-green-700 font-black text-xl mb-1">預約已送出！🎉</div><p className="text-xs text-green-600 font-bold mb-4">店長手機已響起「叮咚」通知！</p><a href="https://lin.ee/n9FQFBB" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#06C755] text-white font-black rounded-full shadow-md"><MessageCircle className="w-5 h-5" /> 前往官方 LINE</a></div>
                  ) : (
                    <form onSubmit={handleReserveSubmit} className="space-y-4">
                      <div><label className="text-xs font-bold text-gray-600 block mb-1">遊戲</label><select required value={reserveForm.gameType} onChange={e => setReserveForm({...reserveForm, gameType: e.target.value})} className="w-full p-3 border border-gray-300 rounded-lg text-sm font-bold bg-white outline-none">{categories.map(cat => <option key={cat.id} value={cat.gameType}>{cat.label}</option>)}</select></div>
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className="text-xs font-bold text-gray-600 block mb-1">日期</label><input required type="date" value={reserveForm.date} onChange={e => setReserveForm({...reserveForm, date: e.target.value})} className="w-full p-3 border border-gray-300 rounded-lg text-sm font-bold bg-white outline-none" /></div>
                        <div><label className="text-xs font-bold text-gray-600 block mb-1">時間</label><input required type="time" value={reserveForm.time} onChange={e => setReserveForm({...reserveForm, time: e.target.value})} className="w-full p-3 border border-gray-300 rounded-lg text-sm font-bold bg-white outline-none" /></div>
                      </div>
                      <div><label className="text-xs font-bold text-gray-600 block mb-1">暱稱</label><input required type="text" placeholder="怎麼稱呼您呢" value={reserveForm.name} onChange={e => setReserveForm({...reserveForm, name: e.target.value})} className="w-full p-3 border border-gray-300 rounded-lg text-sm font-bold bg-white outline-none" /></div>
                      <div><label className="text-xs font-bold text-gray-600 block mb-1">聯絡方式</label><input required type="text" placeholder="手機或 LINE" value={reserveForm.contact} onChange={e => setReserveForm({...reserveForm, contact: e.target.value})} className="w-full p-3 border border-gray-300 rounded-lg text-sm font-bold bg-white outline-none" /></div>
                      <button type="submit" disabled={isSendingLine} className="w-full py-3.5 bg-orange-600 text-white font-black rounded-xl shadow-md hover:bg-orange-700 active:scale-95 transition-all text-lg flex justify-center items-center gap-2">{isSendingLine ? '正在發報通知...' : '送出預約並叮咚店長！🚀'}</button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {currentView === 'admin' && (
          <div className="space-y-6">
            {!isAdminAuth ? (
              <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-200 text-center mt-10"><div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4"><Lock className="w-10 h-10 text-orange-600" /></div><h2 className="text-2xl font-black text-gray-800 mb-2">店長密碼驗證</h2><form onSubmit={(e) => { e.preventDefault(); if (passwordInput === 'monster113') setIsAdminAuth(true); setPasswordInput(''); }} className="space-y-4"><input type="password" placeholder="請輸入密碼..." className="w-full p-4 border rounded-xl text-center font-bold focus:ring-2 focus:ring-orange-500 outline-none border-gray-300 bg-gray-50" value={passwordInput} onChange={e => setPasswordInput(e.target.value)} /><button type="submit" className="w-full py-4 bg-orange-600 text-white text-lg font-black rounded-xl shadow-md active:scale-95 transition-all">登入管理後台</button></form></div>
            ) : (
              <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
                <div className="flex justify-between items-center bg-orange-100 p-5 rounded-2xl border border-orange-200"><span className="font-black text-orange-800 flex items-center gap-2 text-lg"><Store className="w-6 h-6" /> 店長管理模式</span><button onClick={() => setIsAdminAuth(false)} className="bg-white text-orange-600 p-2.5 rounded-xl shadow-sm"><LogOut className="w-5 h-5" /></button></div>
                
                {/* 💡 通訊測試區塊 */}
                <div className="bg-green-600 text-white p-5 rounded-2xl shadow-md font-black flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-lg">📢 LINE 預約雷達狀態</span>
                    <button 
                      onClick={() => sendLineNotification({}, true)} 
                      disabled={isSendingLine}
                      className="bg-white text-green-700 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 hover:bg-green-50 transition-colors shadow-sm active:scale-95"
                    >
                      <Send className="w-3.5 h-3.5" /> {isSendingLine ? '發送中...' : '發送測試通知'}
                    </button>
                  </div>
                  <p className="text-[10px] opacity-80 font-bold">※ 點擊按鈕後，若店內員工群組收到「通訊正常」訊息，代表功能已打通！</p>
                </div>
                
                {/* 預約管理 */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-orange-200"><h2 className="text-xl font-black text-gray-800 mb-5 flex items-center gap-2"><BookOpen className="w-6 h-6 text-orange-500" /> 教學預約管理</h2><div className="space-y-4">{reservations.map(res => (<div key={res.id} className={`p-5 rounded-2xl border shadow-sm ${res.status === 'completed' ? 'bg-gray-50' : 'bg-white border-orange-200 border-l-4 border-l-orange-500'}`}><div className="flex justify-between mb-3"><div><span className="text-xs font-black bg-gray-200 px-2.5 py-1 rounded-full">{res.gameType}</span></div><div className="flex gap-2"><button onClick={async () => await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tutorial_reservations', res.id), { status: res.status === 'pending' ? 'completed' : 'pending' })} className="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg font-bold text-xs">切換</button><button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tutorial_reservations', res.id))} className="p-1 bg-red-50 text-red-500 rounded-lg"><Trash2 className="w-4 h-4"/></button></div></div><div className="grid grid-cols-2 gap-3 text-sm bg-gray-50 p-3 rounded-xl"><div><span className="text-gray-400 block text-xs">👤 暱稱</span><span className="font-black">{res.name}</span></div><div><span className="text-gray-400 block text-xs">📱 聯絡</span><span className="font-black">{res.contact}</span></div><div className="col-span-2 border-t pt-2"><span className="text-gray-400 block text-xs">🗓️ 時間</span><span className="font-black text-orange-600">{res.date} {res.time}</span></div></div></div>))}</div></div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Lightbox 省略 */}
      {fullscreenImage && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-4" onClick={() => setFullscreenImage(null)}>
          <img src={fullscreenImage} className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
