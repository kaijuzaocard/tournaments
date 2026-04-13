import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { Calendar, Clock, MapPin, Plus, Trash2, Trophy, Swords, Zap, Store, Image as ImageIcon, ChevronLeft, ChevronRight, LayoutList, Tags, BookmarkPlus, BookOpen, User, Phone, CheckCircle2, MessageCircle, Lock, LogOut, Edit, X, Save, Sparkles, UploadCloud } from 'lucide-react';

// ==========================================
// Firebase 初始化與路徑設定
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
  const [reserveForm, setReserveForm] = useState({ gameType: '', date: '', time: '', name: '', contact: '' });
  const [reserveSuccess, setReserveSuccess] = useState(false);

  const [tutorialBanners, setTutorialBanners] = useState([]);
  const [newTutorialBanner, setNewTutorialBanner] = useState({ title: '', url: '' });
  const [tutorialIdx, setTutorialIdx] = useState(0);
  const [formData, setFormData] = useState({ gameType: 'UA', title: '', fee: '', description: '', images: [] });
  const [schedules, setSchedules] = useState([{ date: '', time: '19:00' }]);
  const [addSuccess, setAddSuccess] = useState(false);

  const [expandedNotes, setExpandedNotes] = useState({});
  const [currentImgIdx, setCurrentImgIdx] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editFormData, setEditFormData] = useState(null);

  const categoryScrollRef = useRef(null);

  // 全域防卡死機制，2.5 秒後強制解鎖載入畫面
  useEffect(() => {
    const fallbackTimer = setTimeout(() => {
      setIsLoading(false);
    }, 2500);
    return () => clearTimeout(fallbackTimer);
  }, []);

  // ==========================================
  // 🔐 步驟 1: 處理身份驗證
  // ==========================================
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth); 
        }
      } catch (error) {
        console.error("登入驗證失敗，將強制解鎖畫面:", error);
        setIsLoading(false);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // ==========================================
  // 📊 步驟 2: 只有在 user 成功後才抓資料
  // ==========================================
  useEffect(() => {
    if (!user || !db) return;

    const getPath = (name) => collection(db, 'artifacts', appId, 'public', 'data', name);
    const unsubs = [];

    try {
      unsubs.push(onSnapshot(getPath('monster_tournaments'), (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        data.sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`));
        setTournaments(data);
        setIsLoading(false);
      }, (err) => {
        console.error("賽事讀取報錯:", err);
        setIsLoading(false);
      }));

      unsubs.push(onSnapshot(getPath('game_categories'), (snap) => {
        setCategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, (err) => console.error("分類讀取報錯:", err)));

      unsubs.push(onSnapshot(getPath('note_presets'), (snap) => {
        setNotePresets(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, (err) => console.error("模板讀取報錯:", err)));

      unsubs.push(onSnapshot(getPath('tutorial_reservations'), (snap) => {
        const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        setReservations(data);
      }, (err) => console.error("預約讀取報錯:", err)));

      unsubs.push(onSnapshot(getPath('tutorial_banners'), (snap) => {
        const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        data.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        setTutorialBanners(data);
      }, (err) => console.error("Banner 讀取報錯:", err)));

    } catch (error) {
      console.error("啟動資料監聽失敗:", error);
      setIsLoading(false);
    }

    return () => unsubs.forEach(unsub => unsub());
  }, [user]);

  // ==========================================
  // 🧹 自動清潔工 (清理 14 天前賽事)
  // ==========================================
  useEffect(() => {
    if (isAdminAuth && tournaments.length > 0 && user) {
      const threshold = new Date();
      threshold.setDate(threshold.getDate() - 14);
      tournaments.forEach(t => {
        const eventDate = new Date(`${t.date}T23:59:59`);
        if (eventDate < threshold) {
          deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'monster_tournaments', t.id)).catch(() => {});
        }
      });
    }
  }, [isAdminAuth, tournaments, user]);

  // ==========================================
  // 🎮 邏輯處理
  // ==========================================
  const compressImage = (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX = 800; let w = img.width, h = img.height;
          if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } }
          else { if (h > MAX) { w *= MAX / h; h = MAX; } }
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleAdminLogin = (e) => {
    e.preventDefault();
    if (passwordInput === 'monster113') { setIsAdminAuth(true); setPwdError(false); setPasswordInput(''); }
    else { setPwdError(true); setPasswordInput(''); }
  };

  const togglePlayerFilter = (id) => {
    if (id === 'All') { setPlayerFilters(['All']); return; }
    setPlayerFilters(prev => {
      let next = prev.filter(p => p !== 'All');
      if (next.includes(id)) {
        next = next.filter(p => p !== id);
        return next.length === 0 ? ['All'] : next;
      }
      return [...next, id];
    });
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
      setFormData({ ...formData, title: '', description: '', images: [] });
      setSchedules([{ date: '', time: '19:00' }]);
      setAddSuccess(true); setTimeout(() => setAddSuccess(false), 3000);
    } catch (err) { console.error(err); }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!user || !editingId || !editFormData) return;
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'monster_tournaments', editingId), {
        ...editFormData,
        updatedAt: new Date().toISOString()
      });
      setEditingId(null);
      setEditFormData(null);
    } catch (error) {
      console.error("Error updating document: ", error);
    }
  };

  const handleAddTutorialBanner = async (e) => {
    e.preventDefault();
    if (!newTutorialBanner.title || !newTutorialBanner.url) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'tutorial_banners'), {
        ...newTutorialBanner, createdAt: new Date().toISOString()
      });
      setNewTutorialBanner({ title: '', url: '' });
      if (document.getElementById('tutorial-banner-file')) document.getElementById('tutorial-banner-file').value = '';
    } catch (error) { console.error(error); }
  };

  const handleReserveSubmit = async (e) => {
    e.preventDefault();
    if (!user || !reserveForm.gameType || !reserveForm.name || !reserveForm.contact) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'tutorial_reservations'), {
        ...reserveForm, status: 'pending', createdAt: new Date().toISOString()
      });
      setReserveSuccess(true);
      setReserveForm({ gameType: '', date: '', time: '', name: '', contact: '' });
      setTimeout(() => setReserveSuccess(false), 8000); 
    } catch (error) { console.error(error); }
  };

  const handleAddCategory = async (e) => {
    e.preventDefault();
    if (!user || !newCategoryName.trim()) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'game_categories'), { 
        gameType: newCategoryName.trim(), label: newCategoryName.trim(), color: newCategoryColor, createdAt: new Date().toISOString() 
      });
      setNewCategoryName('');
    } catch (error) { console.error(error); }
  };

  // ==========================================
  // 🖼️ 輔助元件
  // ==========================================
  const formatEventDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString; 
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}(${days[date.getDay()]})`;
  };

  // 💡 鋼鐵防護：確保 renderTextWithLinks 遇到舊資料不會崩潰
  const renderTextWithLinks = (text) => {
    if (!text || typeof text !== 'string') return text;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.split(urlRegex).map((part, i) => (part.startsWith('http')) ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-black" onClick={(e) => e.stopPropagation()}>{part}</a> : <span key={i}>{part}</span>);
  };

  const getDotColor = (bgClass) => {
    const dotMap = {
      'bg-red-200': 'bg-red-500', 'bg-orange-200': 'bg-orange-500', 'bg-yellow-200': 'bg-yellow-500',
      'bg-green-200': 'bg-green-500', 'bg-blue-200': 'bg-blue-500', 'bg-indigo-200': 'bg-indigo-500',
      'bg-purple-200': 'bg-purple-500', 'bg-gray-400': 'bg-gray-800', 'bg-white border border-gray-300': 'bg-gray-400'
    };
    return dotMap[bgClass] || 'bg-gray-500';
  };

  const GameBadge = ({ type }) => {
    const cat = categories.find(c => c.gameType === type) || { label: type, color: 'bg-gray-200' };
    return <span className={`px-2 py-1 text-xs font-black rounded-full text-black shadow-sm ${cat.color}`}>{cat.label}</span>;
  };

  const ImageCarousel = ({ tournament }) => {
    // 💡 鋼鐵防護：確保 imgs 永遠是陣列，就算舊資料是字串也不會崩潰
    const imgs = Array.isArray(tournament.images) && tournament.images.length > 0 
      ? tournament.images 
      : (typeof tournament.image === 'string' && tournament.image ? [tournament.image] : []);
    
    const idx = currentImgIdx[tournament.id] || 0;
    if (imgs.length === 0) return null;

    const safeIdx = idx % Math.max(imgs.length, 1);

    return (
      <div className="mb-3 relative rounded-lg overflow-hidden border border-gray-100 shadow-sm group aspect-video bg-gray-50 flex items-center justify-center">
        <img src={imgs[safeIdx]} alt="賽事圖片" className="max-w-full max-h-full object-contain" />
        {imgs.length > 1 && (
          <>
            <button onClick={(e) => { e.stopPropagation(); setCurrentImgIdx(p => ({...p, [tournament.id]: (safeIdx-1+imgs.length)%imgs.length})); }} className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 text-white p-1.5 rounded-full shadow-sm"><ChevronLeft className="w-4 h-4" /></button>
            <button onClick={(e) => { e.stopPropagation(); setCurrentImgIdx(p => ({...p, [tournament.id]: (safeIdx+1)%imgs.length})); }} className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 text-white p-1.5 rounded-full shadow-sm"><ChevronRight className="w-4 h-4" /></button>
            <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">{imgs.map((_, i) => <div key={i} className={`w-1 h-1 rounded-full ${i === safeIdx ? 'bg-white scale-125' : 'bg-white/40'}`} />)}</div>
          </>
        )}
      </div>
    );
  };

  const weekHeaders = weekStartsOnMonday ? ['一','二','三','四','五','六','日'] : ['日','一','二','三','四','五','六'];

  // ==========================================
  // 🚀 渲染區
  // ==========================================
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white">
        <div className="w-16 h-16 border-4 border-orange-200 border-t-orange-600 rounded-full animate-spin mb-4"></div>
        <p className="text-orange-600 font-black text-xl animate-pulse tracking-widest">怪獸造咔系統啟動中...🚀</p>
        <p className="text-gray-400 text-xs mt-2">正在與資料庫連線，請稍候片刻喔！</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 font-sans pb-12">
      <nav className="bg-orange-600 text-white shadow-lg sticky top-0 z-50">
        <div className="max-w-md mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-2"><Store className="w-6 h-6" /><h1 className="font-black text-xl tracking-wider">怪獸造咔</h1></div>
          <div className="flex gap-2">
            <button onClick={() => setCurrentView('player')} className={`text-sm px-3 py-1.5 rounded-full font-bold transition-all ${currentView === 'player' ? 'bg-white text-orange-600 shadow-sm' : 'bg-orange-700'}`}>玩家看板</button>
            <button onClick={() => setCurrentView('admin')} className={`text-sm px-3 py-1.5 rounded-full font-bold transition-all ${currentView === 'admin' ? 'bg-white text-orange-600 shadow-sm' : 'bg-orange-700'}`}>店家後台</button>
          </div>
        </div>
      </nav>

      <main className="max-w-md mx-auto p-4 space-y-6 mt-4">
        {currentView === 'player' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
              <h2 className="text-xl font-black text-gray-800 flex items-center gap-2 mb-2"><Swords className="w-6 h-6 text-orange-500" /> 近期熱血賽事 🔥</h2>
              <p className="text-sm text-gray-500 flex items-center gap-1 font-bold"><MapPin className="w-4 h-4" /> 台中市南區光輝街113號</p>
            </div>

            <div className="flex flex-col gap-3">
              <style>{`.hide-scrollbar::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; } .hide-scrollbar { -ms-overflow-style: none !important; scrollbar-width: none !important; }`}</style>
              <div className="flex flex-wrap gap-2 px-1">
                <span className="text-[10px] font-bold text-orange-600 bg-orange-50 border border-orange-100 px-2 py-0.5 rounded-md inline-flex items-center shadow-sm">💡 分類按鈕可「多選」篩選！</span>
                <button onClick={() => document.getElementById('tutorial-section')?.scrollIntoView({ behavior: 'smooth' })} className="text-[10px] font-bold text-white bg-orange-500 hover:bg-orange-600 px-2 py-0.5 rounded-md inline-flex items-center shadow-sm active:scale-95 transition-all">🎓 預約新手教學 👉</button>
              </div>

              <div className="flex items-center gap-1 w-full">
                <button onClick={() => categoryScrollRef.current?.scrollBy({ left: -200, behavior: 'smooth' })} className="flex-shrink-0 w-8 h-8 bg-white shadow-sm rounded-full text-orange-600 border border-gray-200 flex items-center justify-center active:scale-90"><ChevronLeft className="w-4 h-4" /></button>
                <div ref={categoryScrollRef} className="flex-1 flex gap-2 overflow-x-auto pb-2 pt-1 px-1 hide-scrollbar scroll-smooth">
                  {[{ id: 'All', label: '全部', color: 'bg-white border-gray-300' }, ...categories.map(c => ({ id: c.gameType, label: c.label, color: c.color }))].map(cat => (
                    <button key={cat.id} onClick={() => togglePlayerFilter(cat.id)} className={`whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-black transition-all shadow-sm text-black ${cat.color} ${playerFilters.includes(cat.id) ? 'ring-2 ring-black ring-offset-1 scale-105 opacity-100' : 'opacity-60'}`}>{cat.label}</button>
                  ))}
                </div>
                <button onClick={() => categoryScrollRef.current?.scrollBy({ left: 200, behavior: 'smooth' })} className="flex-shrink-0 w-8 h-8 bg-white shadow-sm rounded-full text-orange-600 border border-gray-200 flex items-center justify-center active:scale-90"><ChevronRight className="w-4 h-4" /></button>
              </div>

              <div className="flex bg-gray-200 p-1 rounded-xl">
                <button onClick={() => setViewMode('list')} className={`flex-1 flex justify-center items-center gap-2 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'list' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}><LayoutList className="w-4 h-4" /> 列表</button>
                <button onClick={() => setViewMode('calendar')} className={`flex-1 flex justify-center items-center gap-2 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'calendar' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}><Calendar className="w-4 h-4" /> 行事曆</button>
              </div>
            </div>

            {/* 列表模式內容 */}
            {viewMode === 'list' && (() => {
              const now = new Date(); const next = new Date(now); next.setDate(now.getDate() + 14);
              const list = tournaments.filter(t => { const d = new Date(`${t.date}T${t.time}`); return d >= now && d <= next && (playerFilters.includes('All') || playerFilters.includes(t.gameType)); });
              return list.length === 0 ? <div className="text-center py-12 text-gray-400 font-bold bg-white rounded-2xl border-dashed border-2">未來 14 天內尚未安排賽事喔！😆</div> : (
                <div className="space-y-4 max-h-[55vh] overflow-y-auto px-1 py-1 hide-scrollbar">
                  {list.map(t => (
                    <div key={t.id} className="bg-white rounded-2xl p-5 shadow-md border-l-4 border-orange-500 transition-all">
                      <div className="flex justify-between items-start mb-3">
                        <GameBadge type={t.gameType} />
                        <div className="text-right"><div className="text-orange-600 font-black text-lg">{formatEventDate(t.date)}</div><div className="text-gray-500 text-sm font-bold">{t.time} 開打</div></div>
                      </div>
                      <h3 className="text-lg font-black text-gray-800 mb-2">{t.title}</h3>
                      <div className="flex items-center gap-2 text-sm text-gray-600 mb-3 bg-gray-50 p-2 rounded-lg"><Zap className="w-4 h-4 text-yellow-500" /><span className="font-bold">報名費：{t.fee}</span></div>
                      {((Array.isArray(t.images) && t.images.length > 0) || t.image || t.description) && (
                        <div className="mt-1">
                          <button onClick={(e) => toggleNote(e, t.id)} className="w-full text-sm font-bold text-orange-600 bg-orange-50 py-2 rounded-xl flex justify-center items-center gap-1 border border-orange-100 active:scale-95 transition-all">{expandedNotes[t.id] ? '▲ 收起詳細資訊' : '▼ 查看詳細資訊點我'}</button>
                          {expandedNotes[t.id] && <div className="mt-3 pt-3 border-t border-gray-100"><ImageCarousel tournament={t} /><div className="text-sm text-gray-600 whitespace-pre-line font-bold leading-relaxed">{renderTextWithLinks(t.description)}</div></div>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* 行事曆內容 */}
            {viewMode === 'calendar' && (
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))} className="p-2 hover:bg-orange-50 rounded-full text-orange-600 transition-colors"><ChevronLeft className="w-4 h-4"/></button>
                    <h3 className="font-black text-lg text-gray-800 w-20 text-center">{currentMonth.getMonth()+1}月</h3>
                    <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))} className="p-2 hover:bg-orange-50 rounded-full text-orange-600 transition-colors"><ChevronRight className="w-4 h-4"/></button>
                  </div>
                  <button onClick={() => setWeekStartsOnMonday(!weekStartsOnMonday)} className="text-[10px] font-bold text-gray-400 bg-gray-50 px-2 py-1 rounded border">改「{weekStartsOnMonday ? '日' : '一'}」起</button>
                </div>
                <div className="grid grid-cols-7 gap-1 mb-2 text-center text-[10px] font-black text-gray-400">{weekHeaders.map(h => <div key={h}>{h}</div>)}</div>
                <div className="grid grid-cols-7 gap-1">
                  {(() => {
                    const y = currentMonth.getFullYear(), m = currentMonth.getMonth();
                    const dCount = new Date(y, m + 1, 0).getDate();
                    const fDay = new Date(y, m, 1).getDay();
                    const adj = weekStartsOnMonday ? (fDay === 0 ? 6 : fDay - 1) : fDay;
                    const cells = [];
                    for (let i = 0; i < adj; i++) cells.push(<div key={`e-${i}`} className="h-10"></div>);
                    for (let d = 1; d <= dCount; d++) {
                      const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                      const hasEvs = tournaments.some(t => t.date === ds && (playerFilters.includes('All') || playerFilters.includes(t.gameType)));
                      const isToday = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}` === ds;
                      cells.push(
                        <button key={ds} onClick={() => setSelectedDate(selectedDate === ds ? null : ds)} className={`relative h-12 flex flex-col items-center justify-center rounded-xl border transition-all ${selectedDate === ds ? 'bg-orange-100 border-orange-500 shadow-inner' : isToday ? 'bg-orange-50 border-orange-300' : 'bg-white border-transparent hover:border-gray-200'}`}>
                          <span className={`text-sm font-bold ${hasEvs ? 'text-gray-800' : 'text-gray-400'}`}>{d}</span>
                          {hasEvs && <div className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1 shadow-sm"></div>}
                        </button>
                      );
                    }
                    return cells;
                  })()}
                </div>
                {selectedDate && (
                  <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                    <h4 className="font-bold text-gray-600 text-sm flex items-center gap-2">🔥 {selectedDate.replace(/-/g, '/')} 賽事清單</h4>
                    {tournaments.filter(t => t.date === selectedDate && (playerFilters.includes('All') || playerFilters.includes(t.gameType))).length === 0 ? (
                      <p className="text-sm text-gray-400 font-bold bg-gray-50 p-4 rounded-xl text-center">這天沒有安排賽事喔！</p>
                    ) : tournaments.filter(t => t.date === selectedDate && (playerFilters.includes('All') || playerFilters.includes(t.gameType))).map(t => (
                      <div key={t.id} className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex justify-between items-center">
                        <div><div className="font-black text-gray-800">{t.title}</div><div className="text-[10px] text-gray-500 font-bold">{t.time} 開打</div></div>
                        <div className="text-xs font-bold text-orange-600">{t.fee}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {/* 新手教學區 (Banner 輪播) */}
            <div id="tutorial-section" className="bg-white rounded-2xl p-5 shadow-sm border border-orange-200 relative overflow-hidden mt-8">
              <div className="absolute top-0 right-0 bg-orange-100 text-orange-700 text-[10px] font-black px-3 py-1.5 rounded-bl-xl">新手福利</div>
              <h2 className="text-xl font-black text-gray-800 flex items-center gap-2 mb-4"><BookOpen className="w-6 h-6 text-orange-500" /> 預約新手教學 🎓</h2>
              
              <div className="mb-6 relative rounded-2xl overflow-hidden shadow-md aspect-square bg-orange-50 flex items-center justify-center border-2 border-orange-100 group">
                {tutorialBanners.length > 0 ? (
                  (() => {
                    const safeIdx = tutorialIdx % Math.max(tutorialBanners.length, 1);
                    const banner = tutorialBanners[safeIdx] || tutorialBanners[0];
                    if(!banner) return null;
                    return (
                      <>
                        <img src={banner.url} alt="教學圖" className="w-full h-full object-cover transition-opacity duration-500" />
                        <div className="absolute top-3 left-3 bg-black/60 text-white text-[10px] font-black px-2.5 py-1 rounded-full flex items-center gap-1 backdrop-blur-sm"><Sparkles className="w-3 h-3 text-yellow-400" /> {banner.title} 教學情報</div>
                        {tutorialBanners.length > 1 && (
                          <div className="absolute inset-0 flex items-center justify-between px-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => setTutorialIdx((tutorialIdx - 1 + tutorialBanners.length) % tutorialBanners.length)} className="w-8 h-8 bg-white/80 text-orange-600 rounded-full flex items-center justify-center shadow-md active:scale-90"><ChevronLeft className="w-5 h-5"/></button>
                            <button onClick={() => setTutorialIdx((tutorialIdx + 1) % tutorialBanners.length)} className="w-8 h-8 bg-white/80 text-orange-600 rounded-full flex items-center justify-center shadow-md active:scale-90"><ChevronRight className="w-5 h-5"/></button>
                          </div>
                        )}
                        {tutorialBanners.length > 1 && (
                          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2">{tutorialBanners.map((_, i) => <div key={i} className={`h-1.5 rounded-full transition-all ${i === safeIdx ? 'bg-white w-4' : 'bg-white/40 w-1.5'}`} />)}</div>
                        )}
                      </>
                    );
                  })()
                ) : (
                  <div className="text-center p-8 text-gray-400 font-bold flex flex-col items-center gap-2"><ImageIcon className="w-12 h-12 opacity-20" /> 新手福利圖準備中...🚀</div>
                )}
              </div>

              <div className="mb-6 space-y-4 bg-orange-50 p-4 rounded-xl border border-orange-100">
                <a href="https://lin.ee/n9FQFBB" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-[#06C755] text-white font-black rounded-xl shadow-sm active:scale-95 transition-all text-sm"><MessageCircle className="w-5 h-5" /> 觀看 LINE 教學影片</a>
                <form onSubmit={handleReserveSubmit} className="space-y-3 pt-4 border-t border-orange-200">
                  <p className="text-xs text-gray-500 font-bold text-center">看完影片還有疑問？填表預約店長教學！👇</p>
                  <select required value={reserveForm.gameType} onChange={e => setReserveForm({...reserveForm, gameType: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold bg-white">{categories.map(cat => <option key={cat.id} value={cat.gameType}>{cat.label}</option>)}</select>
                  <div className="grid grid-cols-2 gap-2"><input required type="date" value={reserveForm.date} onChange={e => setReserveForm({...reserveForm, date: e.target.value})} className="p-2 border border-gray-300 rounded-lg text-sm font-bold bg-white" /><input required type="time" value={reserveForm.time} onChange={e => setReserveForm({...reserveForm, time: e.target.value})} className="p-2 border border-gray-300 rounded-lg text-sm font-bold bg-white" /></div>
                  <input required type="text" placeholder="您的暱稱" value={reserveForm.name} onChange={e => setReserveForm({...reserveForm, name: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold bg-white" />
                  <input required type="text" placeholder="聯絡方式 (LINE ID 或電話)" value={reserveForm.contact} onChange={e => setReserveForm({...reserveForm, contact: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold bg-white" />
                  <button type="submit" className="w-full py-3 bg-orange-600 text-white font-black rounded-xl shadow-md active:scale-95 transition-all mt-2">送出預約！🚀</button>
                </form>
              </div>
            </div>
            <div className="text-center text-[10px] text-gray-400 mt-8 mb-4">※ 報名請私訊怪獸造咔粉專或現場報名 ※</div>
          </div>
        )}

        {/* ========================================== */}
        {/* 店家後台 (Admin) */}
        {/* ========================================== */}
        {currentView === 'admin' && (
          <div className="space-y-6">
            {!isAdminAuth ? (
              <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-200 text-center mt-10">
                <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4"><Lock className="w-8 h-8 text-orange-600" /></div>
                <h2 className="text-xl font-black text-gray-800 mb-2">店長密碼驗證</h2>
                <form onSubmit={handleAdminLogin} className="space-y-4">
                  <input type="password" placeholder="請輸入密碼..." className={`w-full p-3 border rounded-xl text-center font-bold focus:ring-2 focus:ring-orange-500 outline-none ${pwdError ? 'border-red-500 bg-red-50' : 'border-gray-300 bg-gray-50'}`} value={passwordInput} onChange={e => { setPasswordInput(e.target.value); setPwdError(false); }} />
                  {pwdError && <p className="text-red-500 text-xs mt-2 font-bold animate-pulse">密碼錯誤！</p>}
                  <button type="submit" className="w-full py-3 bg-orange-600 text-white font-black rounded-xl shadow-md active:scale-95 transition-all">登入管理後台</button>
                </form>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex justify-between items-center bg-orange-100 p-4 rounded-2xl border border-orange-200"><span className="font-black text-orange-800 flex items-center gap-2"><Store className="w-5 h-5" /> 歡迎回來，店長！</span><button onClick={() => setIsAdminAuth(false)} className="bg-white text-orange-600 p-2 rounded-lg shadow-sm active:scale-90"><LogOut className="w-4 h-4" /></button></div>
                
                {/* 簡單的系統狀態提示 */}
                <div className="bg-blue-600 text-white p-4 rounded-2xl shadow-md font-black flex items-center justify-between">
                  <span>🚀 系統連線狀態：正常運作中</span>
                  <Sparkles className="w-5 h-5 animate-pulse" />
                </div>
                
                {/* 教學圖管理 */}
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-blue-200">
                  <h2 className="text-xl font-black text-gray-800 mb-4 flex items-center gap-2"><Sparkles className="w-6 h-6 text-blue-500" /> 新手教學圖管理</h2>
                  <div className="grid grid-cols-2 gap-3 mb-6">
                    {tutorialBanners.map(b => (
                      <div key={b.id} className="relative group rounded-xl overflow-hidden aspect-square bg-gray-50 border shadow-sm">
                        <img src={b.url} alt={b.title} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-2 text-center">
                          <span className="text-white text-[10px] font-black mb-2">{b.title}</span>
                          <button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tutorial_banners', b.id))} className="bg-red-500 text-white p-1.5 rounded-full shadow-lg"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    ))}
                    {tutorialBanners.length === 0 && <div className="col-span-full py-8 text-center text-gray-400 font-bold border-2 border-dashed border-gray-200 rounded-xl">目前還沒有教學圖喔，快在下方新增！👇</div>}
                  </div>
                  <form onSubmit={handleAddTutorialBanner} className="space-y-3 bg-blue-50 p-4 rounded-xl border border-blue-100 shadow-inner">
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="text-[10px] font-bold text-gray-500 block mb-1">遊戲名稱</label><input required type="text" placeholder="例如: 寶可夢" className="w-full p-2 border rounded-lg text-sm font-bold" value={newTutorialBanner.title} onChange={e => setNewTutorialBanner({...newTutorialBanner, title: e.target.value})} /></div>
                      <div><label className="text-[10px] font-bold text-gray-500 block mb-1">選圖</label><input id="tutorial-banner-file" required type="file" accept="image/*" className="w-full text-[10px] bg-white border p-1 rounded-lg" onChange={async e => setNewTutorialBanner({...newTutorialBanner, url: await compressImage(e.target.files[0])})} /></div>
                    </div>
                    {newTutorialBanner.url && <img src={newTutorialBanner.url} className="h-16 w-auto rounded border-2 border-blue-200" />}
                    <button type="submit" className="w-full py-2 bg-blue-600 text-white font-black rounded-lg shadow-md active:scale-95"><UploadCloud className="w-4 h-4 inline mr-1" /> 上傳 Banner</button>
                  </form>
                </div>

                {/* 遊戲分類管理區塊 */}
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
                  <h2 className="text-xl font-black text-gray-800 mb-4 flex items-center gap-2">
                    <Tags className="w-6 h-6 text-orange-500" /> 遊戲分類管理
                  </h2>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {categories.map(cat => (
                      <div key={cat.id} className={`flex items-center gap-1 border border-black/10 rounded-lg py-1 pl-2 pr-1 text-sm font-black text-black shadow-sm ${cat.color || 'bg-gray-100'}`}>
                        <span>{cat.label}</span>
                        <button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'game_categories', cat.id))} className="p-1 text-black/50 hover:text-red-500 transition-colors" title="刪除分類">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <form onSubmit={handleAddCategory} className="flex flex-col sm:flex-row gap-2 items-end border-t border-gray-100 pt-4">
                    <div className="flex-1 w-full sm:w-auto">
                      <label className="block text-xs font-bold text-gray-500 mb-1">遊戲名稱</label>
                      <input required type="text" placeholder="例如: 航海王" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50 font-bold" />
                    </div>
                    <div className="w-full sm:w-32">
                      <label className="block text-xs font-bold text-gray-500 mb-1">底色</label>
                      <select value={newCategoryColor} onChange={e => setNewCategoryColor(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50 font-bold">
                        <option value="bg-red-200">🔴 紅色</option><option value="bg-orange-200">🟠 橙色</option><option value="bg-yellow-200">🟡 黃色</option><option value="bg-green-200">🟢 綠色</option><option value="bg-blue-200">🔵 藍色</option><option value="bg-indigo-200">🟣 靛色</option><option value="bg-purple-200">🟪 紫色</option><option value="bg-gray-400">⚫ 黑色</option><option value="bg-white border border-gray-300">⚪ 白色</option>
                      </select>
                    </div>
                    <button type="submit" className="w-full sm:w-auto px-4 py-2 bg-orange-100 text-orange-700 hover:bg-orange-200 font-bold rounded-lg transition-colors whitespace-nowrap">新增分類</button>
                  </form>
                </div>

                {/* 新增賽事 */}
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
                  <h2 className="text-xl font-black text-gray-800 mb-4 flex items-center gap-2"><Plus className="w-6 h-6 text-orange-500" /> 新增賽事情報</h2>
                  <form onSubmit={handleAddTournament} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="text-xs font-bold text-gray-600 block mb-1">遊戲</label><select className="w-full p-2 border rounded-lg bg-gray-50 text-sm font-bold" value={formData.gameType} onChange={e => setFormData({...formData, gameType: e.target.value})}>{categories.map(cat => <option key={cat.id} value={cat.gameType}>{cat.label}</option>)}</select></div>
                      <div><label className="text-xs font-bold text-gray-600 block mb-1">名稱</label><input required type="text" placeholder="賽事標題" className="w-full p-2 border rounded-lg bg-gray-50 text-sm font-bold" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} /></div>
                    </div>
                    <div className="bg-orange-50 p-3 rounded-xl border border-orange-100 shadow-inner">
                      <div className="flex justify-between items-center mb-2"><label className="text-xs font-black text-orange-800">🗓️ 場次發布</label><button type="button" onClick={() => setSchedules([...schedules, { date: '', time: '19:00' }])} className="text-[10px] font-bold text-orange-600 bg-white px-2 py-1 rounded shadow-sm border active:scale-95">加場次</button></div>
                      <div className="space-y-2">{schedules.map((sch, i) => (<div key={i} className="flex gap-2 items-center"><input required type="date" className="flex-1 p-2 border rounded-lg bg-white text-xs font-bold" value={sch.date} onChange={e => { const ns = [...schedules]; ns[i].date = e.target.value; setSchedules(ns); }} /><input required type="time" className="w-24 p-2 border rounded-lg bg-white text-xs font-bold" value={sch.time} onChange={e => { const ns = [...schedules]; ns[i].time = e.target.value; setSchedules(ns); }} />{schedules.length > 1 && <button type="button" onClick={() => setSchedules(schedules.filter((_, idx) => idx !== i))} className="text-red-400 p-1"><Trash2 className="w-4 h-4"/></button>}</div>))}</div>
                    </div>
                    <div><label className="text-xs font-bold text-gray-600 block mb-1">費用</label><input required type="text" placeholder="例如: 200元" className="w-full p-2 border rounded-lg bg-gray-50 text-sm font-bold" value={formData.fee} onChange={e => setFormData({...formData, fee: e.target.value})} /></div>
                    <div><label className="text-xs font-bold text-gray-600 block mb-1">備註</label><textarea rows="3" placeholder="獎勵與賽制..." className="w-full p-2 border rounded-lg bg-gray-50 text-sm font-bold outline-none resize-none" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} /></div>
                    <div><label className="text-xs font-bold text-gray-600 block mb-1 flex items-center gap-1"><ImageIcon className="w-4 h-4 text-orange-500" /> 上傳圖 (限4張)</label><input id="promo-image-upload" type="file" multiple accept="image/*" onChange={async e => { const imgs = await Promise.all(Array.from(e.target.files).slice(0, 4).map(compressImage)); setFormData({...formData, images: [...formData.images, ...imgs].slice(0, 4)}); }} className="w-full p-2 border rounded-lg bg-gray-50 text-xs" />{formData.images.length > 0 && <div className="mt-3 flex gap-2 overflow-x-auto pb-2">{formData.images.map((img, i) => <div key={i} className="relative flex-shrink-0"><img src={img} className="h-16 w-auto rounded border" /><button type="button" onClick={() => setFormData({...formData, images: formData.images.filter((_, idx) => idx !== i)})} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5"><X className="w-3 h-3"/></button></div>)}</div>}</div>
                    <button type="submit" className="w-full py-3 bg-orange-600 text-white font-black rounded-xl shadow-md active:scale-95 transition-all"><Plus className="w-5 h-5 inline mr-1" /> 發布賽事！</button>
                  </form>
                </div>
                
                {/* 編輯與賽事管理清單 */}
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
                  <h2 className="text-xl font-black text-gray-800 mb-4 flex items-center gap-2"><Calendar className="w-6 h-6 text-orange-500" /> 管理清單與編輯</h2>
                  <div className="flex justify-between items-center mb-4 bg-gray-50 p-2 rounded-xl">
                    <div className="flex items-center gap-2"><button onClick={() => setAdminMonth(new Date(adminMonth.getFullYear(), adminMonth.getMonth() - 1, 1))} className="p-2 hover:bg-orange-100 rounded-full"><ChevronLeft className="w-4 h-4"/></button><h3 className="font-black text-lg text-gray-800 w-20 text-center">{adminMonth.getFullYear()}年 {adminMonth.getMonth()+1}月</h3><button onClick={() => setAdminMonth(new Date(adminMonth.getFullYear(), adminMonth.getMonth() + 1, 1))} className="p-2 hover:bg-orange-100 rounded-full"><ChevronRight className="w-4 h-4"/></button></div>
                    <button onClick={() => setWeekStartsOnMonday(!weekStartsOnMonday)} className="text-[10px] font-bold text-gray-500">切換週起始 🔁</button>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {(() => {
                      const year = adminMonth.getFullYear(), month = adminMonth.getMonth();
                      const days = new Date(year, month + 1, 0).getDate();
                      const firstDay = new Date(year, month, 1).getDay();
                      const adj = weekStartsOnMonday ? (firstDay === 0 ? 6 : firstDay - 1) : firstDay;
                      const cells = [];
                      for (let i = 0; i < adj; i++) cells.push(<div key={`e-${i}`} className="h-10"></div>);
                      for (let d = 1; d <= days; d++) {
                        const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                        const evs = tournaments.filter(t => t.date === ds);
                        cells.push(<button key={ds} onClick={() => setAdminSelectedDate(adminSelectedDate === ds ? null : ds)} className={`relative h-12 flex flex-col items-center justify-center rounded-xl border ${adminSelectedDate === ds ? 'bg-orange-100 border-orange-500 shadow-inner' : 'bg-white border-transparent hover:border-gray-200'}`}><span className="text-sm font-bold">{d}</span>{evs.length > 0 && <div className="flex gap-0.5 mt-1">{evs.slice(0,3).map((_,i)=><span key={i} className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>)}</div>}</button>);
                      }
                      return cells;
                    })()}
                  </div>
                  {adminSelectedDate && (
                    <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                      {tournaments.filter(t => t.date === adminSelectedDate).map(t => (
                        editingId === t.id ? (
                          <form key={`edit-${t.id}`} onSubmit={handleSaveEdit} className="p-4 bg-orange-50 shadow-inner rounded-xl border-2 border-orange-300 flex flex-col gap-3">
                            <div className="flex justify-between items-center border-b border-orange-200 pb-2"><span className="font-black text-orange-800 flex items-center gap-1"><Edit className="w-4 h-4"/> 編輯賽事</span><button type="button" onClick={() => { setEditingId(null); setEditFormData(null); }} className="text-gray-500 hover:text-red-500"><X className="w-5 h-5"/></button></div>
                            <div className="grid grid-cols-2 gap-2"><div><label className="text-xs font-bold text-orange-700 block mb-1">遊戲</label><select value={editFormData.gameType} onChange={(e) => setEditFormData({...editFormData, gameType: e.target.value})} className="w-full p-2 border border-orange-200 rounded-lg text-sm font-bold">{categories.map(cat => <option key={cat.id} value={cat.gameType}>{cat.label}</option>)}</select></div><div><label className="text-xs font-bold text-orange-700 block mb-1">名稱</label><input required type="text" value={editFormData.title} onChange={(e) => setEditFormData({...editFormData, title: e.target.value})} className="w-full p-2 border border-orange-200 rounded-lg text-sm font-bold" /></div></div>
                            <div className="grid grid-cols-2 gap-2"><div><label className="text-xs font-bold text-orange-700 block mb-1">日期</label><input required type="date" value={editFormData.date} onChange={(e) => setEditFormData({...editFormData, date: e.target.value})} className="w-full p-2 border border-orange-200 rounded-lg text-sm font-bold" /></div><div><label className="text-xs font-bold text-orange-700 block mb-1">時間</label><input required type="time" value={editFormData.time} onChange={(e) => setEditFormData({...editFormData, time: e.target.value})} className="w-full p-2 border border-orange-200 rounded-lg text-sm font-bold" /></div></div>
                            <div><label className="text-xs font-bold text-orange-700 block mb-1">費用</label><input required type="text" value={editFormData.fee} onChange={(e) => setEditFormData({...editFormData, fee: e.target.value})} className="w-full p-2 border border-orange-200 rounded-lg text-sm font-bold" /></div>
                            <div><label className="text-xs font-bold text-orange-700 block mb-1">備註</label><textarea rows="3" value={editFormData.description} onChange={(e) => setEditFormData({...editFormData, description: e.target.value})} className="w-full p-2 border border-orange-200 rounded-lg text-sm font-bold resize-none" /></div>
                            <div><label className="text-xs font-bold text-orange-700 block mb-1">圖片</label>
                              <input type="file" multiple accept="image/*" onChange={async (e) => {
                                const newImgs = await Promise.all(Array.from(e.target.files).slice(0, 4).map(compressImage));
                                setEditFormData(prev => ({ ...prev, images: [...(Array.isArray(prev.images) ? prev.images : []), ...newImgs].slice(0, 4) }));
                              }} className="w-full p-1 text-xs" />
                              {Array.isArray(editFormData.images) && editFormData.images.length > 0 && (
                                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                                  {editFormData.images.map((img, i) => (
                                    <div key={i} className="relative inline-block flex-shrink-0">
                                      <img src={img} className="h-16 w-auto rounded border border-orange-200 object-cover" />
                                      <button type="button" onClick={() => { const ni = [...editFormData.images]; ni.splice(i, 1); setEditFormData({...editFormData, images: ni}); }} className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5"><X className="w-3 h-3" /></button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <button type="submit" className="w-full py-2.5 bg-orange-600 text-white font-black rounded-lg transition-all active:scale-95 flex justify-center items-center gap-1.5"><Save className="w-4 h-4" /> 儲存變更</button>
                          </form>
                        ) : (
                          <div key={t.id} className="p-3 bg-white shadow-sm rounded-xl border border-red-100 flex justify-between items-center">
                            <div><span className={`px-2 py-1 text-[10px] font-black rounded-full ${categories.find(c=>c.gameType===t.gameType)?.color || 'bg-gray-200'}`}>{t.gameType}</span><div className="font-black text-gray-800 mt-1">{t.title}</div><div className="text-xs text-gray-500 font-bold">{t.time} 開打</div></div>
                            <div className="flex gap-1">
                              <button onClick={() => { setEditingId(t.id); setEditFormData({...t, images: Array.isArray(t.images) && t.images.length > 0 ? t.images : (t.image ? [t.image] : [])}); }} className="p-2 text-blue-500 bg-blue-50 rounded-lg active:scale-90"><Edit className="w-4 h-4"/></button>
                              <button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'monster_tournaments', t.id))} className="p-2 text-red-500 bg-red-50 rounded-lg active:scale-90 transition-all"><Trash2 className="w-4 h-4"/></button>
                            </div>
                          </div>
                        )
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-2xl p-5 shadow-sm border border-orange-200 mt-6"><h2 className="text-xl font-black text-gray-800 mb-4 flex items-center gap-2"><BookOpen className="w-6 h-6 text-orange-500" /> 教學預約單</h2><div className="space-y-3">{reservations.map(res => (<div key={res.id} className={`p-4 rounded-xl border ${res.status === 'completed' ? 'bg-gray-50 opacity-60' : 'bg-white border-orange-200 border-l-4 border-l-orange-500'}`}><div className="flex justify-between items-start mb-2"><div className="flex items-center gap-2"><span className="text-xs font-black bg-gray-200 px-2 py-1 rounded">{res.gameType}</span><span className={`text-[10px] font-bold px-2 py-0.5 rounded ${res.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{res.status === 'completed' ? '✅ 已處理' : '🚨 待聯絡'}</span></div><div className="flex gap-1"><button onClick={async () => await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tutorial_reservations', res.id), { status: res.status === 'pending' ? 'completed' : 'pending' })} className="p-1.5 text-blue-500 font-bold text-[10px]">切換</button><button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tutorial_reservations', res.id))} className="p-1.5 text-red-500"><Trash2 className="w-4 h-4"/></button></div></div><div className="grid grid-cols-2 gap-2 text-xs"><div><span className="text-gray-400 block">👤 暱稱</span><span className="font-black text-gray-800">{res.name}</span></div><div><span className="text-gray-400 block">📱 聯絡</span><span className="font-black text-gray-800">{res.contact}</span></div><div className="col-span-2"><span className="text-gray-400 block">🗓️ 期望時間</span><span className="font-black text-gray-800">{res.date} {res.time}</span></div></div></div>))}</div></div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
