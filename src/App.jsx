import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { Calendar, Clock, MapPin, Plus, Trash2, Trophy, Swords, Zap, Store, Image as ImageIcon, ChevronLeft, ChevronRight, LayoutList, Tags, BookmarkPlus, BookOpen, User, Phone, CheckCircle2, MessageCircle, Lock, LogOut, Edit, X, Save, Sparkles, UploadCloud, Gift, Send } from 'lucide-react';

// ==========================================
// Firebase 與 GAS 配置 (核心旗艦基底)
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

const GAS_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbywkOTGBA5hh_vGfK2xHy2YE4uMnQNqbWrAHHtiB3wPoKWJJ9xu2IJqND-CqGHdu8d_/exec";

const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : myFirebaseConfig;
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 確保路徑中不包含會破壞 Firestore 結構的特殊字元
const rawAppId = typeof __app_id !== 'undefined' ? __app_id : 'kaijuzaocard-main';
const appId = String(rawAppId).replace(/\//g, '-');

export default function App() {
  const [user, setUser] = useState(null);
  const [tournaments, setTournaments] = useState([]);
  const [currentView, setCurrentView] = useState('player'); 
  const [isLoading, setIsLoading] = useState(true);

  const loadingMessages = [
    "🚀 連接光輝街 113 號基地中...",
    "🦖 野生的賽程表正在努力載入中...",
    "✨ 光之巨人們正在趕來的路上...",
    "🎁 正在為您準備最豪華的奪包獎勵...",
    "🔥 咔友們準備好開戰了嗎？"
  ];
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
  const [reserveForm, setReserveForm] = useState({ gameType: '', date: '', time: '', name: '', contact: '' });
  const [reserveSuccess, setReserveSuccess] = useState(false);

  const [tutorialBanners, setTutorialBanners] = useState([]);
  const [newTutorialBanner, setNewTutorialBanner] = useState({ title: '', url: '' });
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
  const hasRandomizedBanner = useRef(false);

  const sendLineNotification = async (data, isTest = false) => {
    setIsSendingLine(true);
    
    const payloadData = isTest ? {
      name: "店長診斷測試",
      contact: "測試聯絡人",
      gameType: "系統通訊測試",
      date: "今天",
      time: "現在"
    } : data;

    try {
      await fetch(GAS_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payloadData)
      });
      
      if (isTest) alert("🎉 GAS 轉發測試成功！請檢查您的 Google 試算表與 LINE 群組。");
    } catch (err) {
      console.error("GAS 轉發失敗:", err);
      if (isTest) alert("❌ 發送失敗，請檢查網路狀況。");
    } finally {
      setIsSendingLine(false);
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setLoadingMsgIdx(prev => (prev + 1) % loadingMessages.length);
    }, 800);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth); 
        }
      } catch (error) {
        console.error("Firebase 驗證失敗", error);
        setIsLoading(false);
      }
    };
    initAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) setIsLoading(false);
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user || !db) return;

    const getCollection = (collectionName) => 
      collection(db, 'artifacts', appId, 'public', 'data', collectionName);
    
    const unsubs = [];

    const setupListener = (colRef, setter, sortFn = null) => {
      const unsub = onSnapshot(colRef, 
        (snapshot) => {
          let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          if (sortFn) data = sortFn(data);
          setter(data);
          if (isLoading) setIsLoading(false);
        }, 
        (err) => {
          console.error(`讀取 ${colRef.path} 失敗:`, err);
          if (isLoading) setIsLoading(false);
        }
      );
      unsubs.push(unsub);
    };

    setupListener(getCollection('monster_tournaments'), setTournaments, (data) => 
      data.sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`))
    );

    setupListener(getCollection('game_categories'), (data) => {
      setCategories(data);
      if (data.length > 0 && !reserveForm.gameType) {
        setReserveForm(prev => ({ ...prev, gameType: data[0].gameType }));
      }
    });

    setupListener(getCollection('note_presets'), setNotePresets);

    setupListener(getCollection('tutorial_reservations'), setReservations, (data) =>
      data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    );

    setupListener(getCollection('tutorial_banners'), setTutorialBanners, (data) =>
      data.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    );

    return () => unsubs.forEach(unsub => unsub());
  }, [user]);

  useEffect(() => {
    const fallbackTimer = setTimeout(() => {
      setIsLoading(false);
    }, 4000);
    return () => clearTimeout(fallbackTimer);
  }, []);

  useEffect(() => {
    if (tutorialBanners.length > 0 && !hasRandomizedBanner.current) {
      const randomStartIdx = Math.floor(Math.random() * tutorialBanners.length);
      setTutorialIdx(randomStartIdx);
      hasRandomizedBanner.current = true;
    }
  }, [tutorialBanners]);

  const toggleNote = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    setExpandedNotes(prev => ({ ...prev, [id]: !prev[id] }));
  };

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
      setFormData({ ...formData, title: '', description: '', images: [], prizeImages: [] });
      setSchedules([{ date: '', time: '19:00' }]);
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
    if (!user || !reserveForm.name || !reserveForm.contact) return;
    try {
      const reserveData = { 
        ...reserveForm, 
        gameType: reserveForm.gameType || (categories[0]?.gameType || '未指定'),
        status: 'pending', 
        createdAt: new Date().toISOString() 
      };
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'tutorial_reservations'), reserveData);
      await sendLineNotification(reserveData); 
      setReserveSuccess(true);
      setReserveForm(prev => ({ ...prev, date: '', time: '', name: '', contact: '' }));
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

  const handleSavePreset = async () => {
    if (!user || !newPresetTitle.trim() || !formData.description.trim()) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'note_presets'), {
        title: newPresetTitle.trim(), content: formData.description.trim(), createdAt: new Date().toISOString()
      });
      setNewPresetTitle('');
    } catch (error) { console.error("Error saving preset: ", error); }
  };

  const handleDeletePreset = async (id) => {
    if (!user) return;
    try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'note_presets', id)); } 
    catch (error) { console.error("Error deleting preset: ", error); }
  };

  const formatEventDate = (dateString) => {
    if (!dateString) return '';
    if (typeof dateString !== 'string') return String(dateString);
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString; 
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}(${days[date.getDay()]})`;
  };

  const renderTextWithLinks = (text) => {
    if (!text) return '';
    if (typeof text !== 'string') return String(text);
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
    const imgs = Array.isArray(tournament.images) && tournament.images.length > 0 ? tournament.images : (tournament.image ? [tournament.image] : []);
    const idx = currentImgIdx[tournament.id] || 0; if (imgs.length === 0) return null;
    const safeIdx = idx % imgs.length;
    return (
      <div className="mb-3 relative rounded-lg overflow-hidden border border-gray-100 shadow-sm group bg-gray-50 flex items-center justify-center">
        <img src={imgs[safeIdx]} alt="主視覺" className="w-full h-auto object-cover cursor-zoom-in" onClick={(e) => { e.stopPropagation(); setFullscreenImage(imgs[safeIdx]); }} />
        {imgs.length > 1 && (
          <><button onClick={(e) => { e.stopPropagation(); setCurrentImgIdx(p => ({...p, [tournament.id]: (safeIdx-1+imgs.length)%imgs.length})); }} className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 text-white p-1.5 rounded-full shadow-sm"><ChevronLeft className="w-5 h-5" /></button><button onClick={(e) => { e.stopPropagation(); setCurrentImgIdx(p => ({...p, [tournament.id]: (safeIdx+1)%imgs.length})); }} className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 text-white p-1.5 rounded-full shadow-sm"><ChevronRight className="w-5 h-5" /></button><div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">{imgs.map((_, i) => <div key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i === safeIdx ? 'bg-white scale-125 shadow-md' : 'bg-white/50'}`} />)}</div></>
        )}
      </div>
    );
  };

  const TutorialCarousel = ({ banners, tutorialIdx, setTutorialIdx }) => {
    if (!banners || banners.length === 0) return <div className="py-10 text-center text-gray-400 font-bold">新手福利圖準備中...🚀</div>;
    const safeIdx = tutorialIdx % banners.length;
    const banner = banners[safeIdx];
    const prevIdx = (safeIdx - 1 + banners.length) % banners.length;
    const nextIdx = (safeIdx + 1) % banners.length;
    return (
      <div className="mb-6 flex flex-col items-center">
        <div className="relative w-full py-5 bg-orange-50/50 rounded-2xl overflow-hidden flex items-center justify-center border border-orange-100 min-h-[250px]">
          {banners.length > 1 && (<div className="absolute right-[88%] w-[80%] aspect-square rounded-2xl overflow-hidden opacity-40 scale-90 cursor-pointer" onClick={() => setTutorialIdx(prevIdx)}><img src={banners[prevIdx].url} className="w-full h-full object-cover" /></div>)}
          <div className="relative z-10 w-[85%] aspect-square rounded-2xl overflow-hidden shadow-xl border-2 border-white"><img src={banner.url} className="w-full h-full object-cover" /><div className="absolute top-2 left-2 bg-black/70 text-white text-[9px] font-black px-2 py-1 rounded-md flex items-center gap-1 backdrop-blur-md"><Sparkles className="w-2.5 h-2.5 text-yellow-400" /> {banner.title} 福利</div></div>
          {banners.length > 1 && (<div className="absolute left-[88%] w-[80%] aspect-square rounded-2xl overflow-hidden opacity-40 scale-90 cursor-pointer" onClick={() => setTutorialIdx(nextIdx)}><img src={banners[nextIdx].url} className="w-full h-full object-cover" /></div>)}
        </div>
      </div>
    );
  };

  const weekHeaders = weekStartsOnMonday ? ['一','二','三','四','五','六','日'] : ['日','一','二','三','四','五','六'];

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6">
        <div className="w-16 h-16 border-4 border-orange-200 border-t-orange-600 rounded-full animate-spin mb-6 shadow-md"></div>
        <p className="text-orange-600 font-black text-lg animate-pulse tracking-wide text-center h-8">{loadingMessages[loadingMsgIdx]}</p>
        <p className="text-gray-400 text-xs mt-3 font-bold bg-white px-3 py-1.5 rounded-full border">初次載入約需 1~3 秒，請稍候片刻喔！⏳</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 font-sans pb-12 relative">
      <nav className="bg-orange-600 text-white shadow-lg sticky top-0 z-50">
        <div className="max-w-md mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-2 font-black text-xl tracking-wider cursor-pointer" onClick={() => window.location.reload()}><Store className="w-6 h-6" /> 怪獸造咔</div>
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
              <p className="text-sm text-gray-500 font-bold flex items-center gap-1"><MapPin className="w-4 h-4" /> 台中市南區光輝街113號</p>
            </div>

            <div className="flex flex-col gap-3">
              <style>{`.hide-scrollbar::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; } .hide-scrollbar { -ms-overflow-style: none !important; scrollbar-width: none !important; }`}</style>
              
              <div className="flex flex-wrap gap-2 px-1">
                <span className="text-[10px] font-bold text-orange-600 bg-orange-100 border border-orange-200 px-2 py-0.5 rounded-md inline-flex items-center shadow-sm">💡 分類按鈕可「多選」篩選！</span>
                <button onClick={() => document.getElementById('tutorial-section')?.scrollIntoView({ behavior: 'smooth' })} className="text-[10px] font-bold text-white bg-orange-500 hover:bg-orange-600 px-2 py-0.5 rounded-md inline-flex items-center shadow-sm active:scale-95 transition-all">🎓 預約新手教學 👉</button>
              </div>

              <div className="flex items-center gap-1 w-full">
                <button onClick={() => categoryScrollRef.current?.scrollBy({ left: -200, behavior: 'smooth' })} className="flex-shrink-0 w-9 h-9 bg-white shadow-sm rounded-full text-orange-600 border border-gray-200 flex items-center justify-center hover:bg-orange-50 active:scale-95 transition-all"><ChevronLeft className="w-5 h-5 -ml-0.5" /></button>
                <div ref={categoryScrollRef} className="flex-1 flex gap-2 overflow-x-auto pb-2 pt-1 px-1 hide-scrollbar scroll-smooth">
                  {[{ id: 'All', label: '全部', color: 'bg-white border-gray-300' }, ...categories.map(c => ({ id: c.gameType, label: c.label, color: c.color }))].map(cat => (
                    <button key={cat.id} onClick={() => togglePlayerFilter(cat.id)} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-black transition-all shadow-sm text-black ${cat.color} ${playerFilters.includes(cat.id) ? 'ring-2 ring-black ring-offset-1 scale-105 opacity-100' : 'opacity-60 hover:opacity-100'}`}>{cat.label}</button>
                  ))}
                </div>
                <button onClick={() => categoryScrollRef.current?.scrollBy({ left: 200, behavior: 'smooth' })} className="flex-shrink-0 w-9 h-9 bg-white shadow-sm rounded-full text-orange-600 border border-gray-200 flex items-center justify-center hover:bg-orange-50 active:scale-95 transition-all"><ChevronRight className="w-5 h-5 -mr-0.5" /></button>
              </div>

              <div className="flex bg-gray-200 p-1.5 rounded-xl">
                <button onClick={() => setViewMode('list')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'list' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><LayoutList className="w-4 h-4 inline mr-1" /> 列表</button>
                <button onClick={() => setViewMode('calendar')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'calendar' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><Calendar className="w-4 h-4 inline mr-1" /> 行事曆</button>
              </div>
            </div>

            {viewMode === 'list' && (() => {
              const now = new Date(); const next = new Date(now); next.setDate(now.getDate() + 14);
              const list = tournaments.filter(t => { const d = new Date(`${t.date}T${t.time}`); return d >= now && d <= next && (playerFilters.includes('All') || playerFilters.includes(t.gameType)); });
              return list.length === 0 ? <div className="text-center py-12 text-gray-400 font-bold bg-white rounded-2xl border-dashed border-2 border-gray-200">未來 14 天內尚未安排賽事喔！😆</div> : (
                <div className="space-y-4 max-h-[55vh] overflow-y-auto px-1 py-1 hide-scrollbar">
                  {list.map(t => (
                    <div key={t.id} className="bg-white rounded-2xl p-5 shadow-md border-l-4 border-orange-500 transition-all hover:-translate-y-1">
                      <div className="flex justify-between items-start mb-3">
                        <GameBadge type={t.gameType} />
                        <div className="text-right"><div className="text-orange-600 font-black text-lg">{formatEventDate(t.date)}</div><div className="text-gray-500 text-sm font-bold">{t.time} 開打</div></div>
                      </div>
                      <h3 className="text-lg font-black text-gray-800 mb-2">{t.title}</h3>
                      <div className="flex items-center gap-2 text-sm text-gray-600 mb-3 bg-gray-50 p-3 rounded-lg border border-gray-100"><Zap className="w-5 h-5 text-yellow-500" /><span className="font-bold">報名費/方案：{t.fee}</span></div>
                      
                      {((Array.isArray(t.images) && t.images.length > 0) || (Array.isArray(t.prizeImages) && t.prizeImages.length > 0) || t.image || (t.description && typeof t.description === 'string' && t.description.trim())) && (
                        <div className="mt-2">
                          <button type="button" onClick={(e) => toggleNote(e, t.id)} className="w-full text-sm font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 py-2.5 rounded-xl flex justify-center items-center gap-1 border border-orange-100 active:scale-95 transition-all">{expandedNotes[t.id] ? '▲ 收起詳細資訊' : '▼ 查看詳細資訊'}</button>
                          {expandedNotes[t.id] && (
                            <div className="mt-3 pt-3 border-t border-gray-100 animate-in slide-in-from-top-2 duration-300">
                              <ImageCarousel tournament={t} />
                              <div className="text-sm text-gray-600 whitespace-pre-line font-bold leading-relaxed">{renderTextWithLinks(t.description)}</div>
                              
                              {t.prizeImages && t.prizeImages.length > 0 && (
                                <div className="mt-4 p-3.5 bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl border border-yellow-200 shadow-sm">
                                  <div className="text-sm font-black text-orange-800 mb-3 flex items-center gap-1.5">
                                    <Gift className="w-4 h-4 text-orange-500" /> 本場豪華獎勵一覽
                                  </div>
                                  <div className={`grid gap-2 ${t.prizeImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                    {t.prizeImages.map((img, i) => (
                                      <img 
                                        key={`prize-img-${i}`} 
                                        src={img} 
                                        alt={`豪華獎品 ${i+1}`} 
                                        className="w-full h-auto rounded-lg border border-yellow-300 shadow-sm object-cover cursor-zoom-in hover:scale-105 transition-transform duration-300" 
                                        onClick={(e) => { e.stopPropagation(); setFullscreenImage(img); }}
                                      />
                                    ))}
                                  </div>
                                </div>
                              )}
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
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))} className="p-2 hover:bg-orange-50 rounded-full text-orange-600 transition-colors"><ChevronLeft className="w-5 h-5"/></button>
                    <h3 className="font-black text-lg text-gray-800 w-24 text-center">{currentMonth.getMonth()+1}月</h3>
                    <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))} className="p-2 hover:bg-orange-50 rounded-full text-orange-600 transition-colors"><ChevronRight className="w-5 h-5"/></button>
                  </div>
                  <button onClick={() => setWeekStartsOnMonday(!weekStartsOnMonday)} className="text-xs font-bold text-gray-500 hover:text-orange-600 bg-gray-50 hover:bg-orange-50 px-3 py-1.5 rounded-lg border border-gray-200 transition-colors">改以「{weekStartsOnMonday ? '週日' : '週一'}」為起始</button>
                </div>
                
                <div className="grid grid-cols-7 gap-1 mb-2 text-center text-xs font-black text-gray-400">
                  {weekHeaders.map(h => <div key={h}>{h}</div>)}
                </div>
                
                <div className="grid grid-cols-7 gap-1">
                  {(() => {
                    const y = currentMonth.getFullYear(), m = currentMonth.getMonth();
                    const dCount = new Date(y, m + 1, 0).getDate();
                    const fDay = new Date(y, m, 1).getDay();
                    const adj = weekStartsOnMonday ? (fDay === 0 ? 6 : fDay - 1) : fDay;
                    const cells = [];
                    for (let i = 0; i < adj; i++) cells.push(<div key={`e-${i}`} className="h-12"></div>);
                    for (let d = 1; d <= dCount; d++) {
                      const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                      const events = tournaments.filter(t => t.date === ds && (playerFilters.includes('All') || playerFilters.includes(t.gameType)));
                      const isToday = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}` === ds;
                      cells.push(
                        <button key={ds} onClick={() => setSelectedDate(selectedDate === ds ? null : ds)} className={`relative h-12 flex flex-col items-center justify-center rounded-xl border transition-all ${selectedDate === ds ? 'bg-orange-100 border-orange-500 shadow-inner' : isToday ? 'bg-gray-100 border-gray-300' : 'bg-white border-transparent hover:border-gray-200 hover:bg-gray-50'}`}>
                          <span className={`text-sm font-bold ${events.length > 0 ? 'text-gray-800' : 'text-gray-400'}`}>{d}</span>
                          {events.length > 0 && (
                            <div className="flex gap-0.5 mt-1">
                              {events.slice(0, 3).map((e, i) => {
                                const catColor = categories.find(c => c.gameType === e.gameType)?.color || 'bg-gray-200';
                                return <span key={i} className={`w-1.5 h-1.5 rounded-full ${getDotColor(catColor)} shadow-sm`} />
                              })}
                              {events.length > 3 && <span className="w-1.5 h-1.5 rounded-full bg-black shadow-sm" />}
                            </div>
                          )}
                        </button>
                      );
                    }
                    return cells;
                  })()}
                </div>

                {selectedDate && (
                  <div className="mt-5 pt-5 border-t border-gray-100 space-y-4">
                    <h4 className="font-black text-gray-700 text-md flex items-center gap-2"><Calendar className="w-5 h-5 text-orange-500" /> {selectedDate.replace(/-/g, '/')} 賽事清單</h4>
                    {tournaments.filter(t => t.date === selectedDate && (playerFilters.includes('All') || playerFilters.includes(t.gameType))).length === 0 ? (
                      <p className="text-sm text-gray-400 font-bold bg-gray-50 p-4 rounded-xl text-center border border-gray-100 border-dashed">這天沒有安排賽事喔！</p>
                    ) : tournaments.filter(t => t.date === selectedDate && (playerFilters.includes('All') || playerFilters.includes(t.gameType))).map(t => (
                      <div key={t.id} className="p-4 bg-white shadow-md rounded-xl border-l-4 border-l-orange-500 transition-all hover:-translate-y-0.5">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <GameBadge type={t.gameType} />
                            <div className="font-black text-gray-800 mt-2 text-lg">{t.title}</div>
                            <div className="text-sm text-gray-500 font-bold mt-1 flex items-center gap-1"><Clock className="w-4 h-4"/> {t.time} 開打</div>
                          </div>
                          <div className="text-xs font-bold text-orange-600 bg-orange-100 border border-orange-200 px-3 py-1.5 rounded-lg shadow-sm">{t.fee}</div>
                        </div>
                        {((Array.isArray(t.images) && t.images.length > 0) || (Array.isArray(t.prizeImages) && t.prizeImages.length > 0) || t.image || (t.description && typeof t.description === 'string' && t.description.trim())) && (
                          <div className="mt-2">
                            <button type="button" onClick={(e) => toggleNote(e, t.id)} className="w-full text-sm font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 py-2 rounded-xl flex justify-center items-center gap-1 border border-orange-100 transition-colors">{expandedNotes[t.id] ? '▲ 收起詳細資訊' : '▼ 查看詳細資訊'}</button>
                            {expandedNotes[t.id] && (
                              <div className="mt-3 pt-3 border-t border-gray-100">
                                <ImageCarousel tournament={t} />
                                <div className="text-sm text-gray-600 font-bold whitespace-pre-line leading-relaxed">{renderTextWithLinks(t.description)}</div>
                                
                                {t.prizeImages && t.prizeImages.length > 0 && (
                                  <div className="mt-4 p-3.5 bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl border border-yellow-200 shadow-sm">
                                    <div className="text-sm font-black text-orange-800 mb-3 flex items-center gap-1.5">
                                      <Gift className="w-4 h-4 text-orange-500" /> 本場豪華獎勵一覽
                                    </div>
                                    <div className={`grid gap-2 ${t.prizeImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                      {t.prizeImages.map((img, i) => (
                                        <img 
                                          key={`prize-img-${i}`} 
                                          src={img} 
                                          alt={`豪華獎品 ${i+1}`} 
                                          className="w-full h-auto rounded-lg border border-yellow-300 shadow-sm object-cover cursor-zoom-in hover:scale-105 transition-transform duration-300" 
                                          onClick={(e) => { e.stopPropagation(); setFullscreenImage(img); }}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            <div id="tutorial-section" className="bg-white rounded-2xl p-5 shadow-sm border border-orange-200 relative overflow-hidden mt-8">
              <div className="absolute top-0 right-0 bg-orange-100 text-orange-700 text-xs font-black px-3 py-1.5 rounded-bl-xl shadow-sm">新手福利區</div>
              <h2 className="text-xl font-black text-gray-800 flex items-center gap-2 mb-4"><BookOpen className="w-6 h-6 text-orange-500" /> 預約新手教學 🎓</h2>
              
              <div className="px-1 mb-3">
                <span className="text-[10px] font-bold text-orange-600 bg-orange-50 border border-orange-100 px-2 py-0.5 rounded-md inline-flex items-center gap-1 shadow-sm">
                  💡 點擊兩側圖片，即可快速切換觀看各遊戲福利！
                </span>
              </div>
              
              <TutorialCarousel banners={tutorialBanners} tutorialIdx={tutorialIdx} setTutorialIdx={setTutorialIdx} />

              <div className="mb-6 space-y-4 bg-orange-50 p-5 rounded-xl border border-orange-100 shadow-sm">
                <div>
                  <p className="text-sm text-gray-800 font-black mb-2 flex items-center gap-1.5"><span className="bg-orange-500 text-white px-2 py-0.5 rounded-md text-xs shadow-sm">1</span> 建議先看影片 📺</p>
                  <a href="https://lin.ee/n9FQFBB" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-[#06C755] text-white font-black rounded-xl shadow-md hover:bg-[#05b34c] hover:-translate-y-0.5 active:scale-95 transition-all text-sm"><MessageCircle className="w-6 h-6" /> 觀看 LINE 教學影片</a>
                </div>
                <div className="border-t border-orange-200 pt-4">
                  <p className="text-sm text-gray-800 font-black mb-1 flex items-center gap-1.5"><span className="bg-orange-500 text-white px-2 py-0.5 rounded-md text-xs shadow-sm">2</span> 再填表預約 👇</p>
                  <p className="text-xs text-gray-600 font-bold ml-7 mb-3">看完影片還有疑問？直接填表預約店長親自教學！</p>
                  
                  {reserveSuccess ? (
                    <div className="bg-green-50 p-5 rounded-xl text-center border border-green-200 shadow-inner animate-pulse">
                      <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-2" />
                      <div className="text-green-700 font-black text-xl mb-1">預約已送出！🎉</div>
                      <div className="text-green-600 text-sm font-bold mb-4">我們會盡快為您安排。</div>
                      <a href="https://lin.ee/n9FQFBB" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#06C755] text-white font-black rounded-full shadow-md hover:bg-[#05b34c] hover:scale-105 transition-all"><MessageCircle className="w-5 h-5" /> 前往官方 LINE 聯繫</a>
                    </div>
                  ) : (
                    <form onSubmit={handleReserveSubmit} className="space-y-4">
                      <div><label className="text-xs font-bold text-gray-600 block mb-1">想學哪款遊戲？</label><select required value={reserveForm.gameType} onChange={e => setReserveForm({...reserveForm, gameType: e.target.value})} className="w-full p-3 border border-gray-300 rounded-lg text-sm font-bold bg-white focus:ring-2 focus:ring-orange-500 outline-none">{categories.map(cat => <option key={cat.id} value={cat.gameType}>{cat.label}</option>)}</select></div>
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className="text-xs font-bold text-gray-600 block mb-1">希望日期</label><input required type="date" value={reserveForm.date} onChange={e => setReserveForm({...reserveForm, date: e.target.value})} className="w-full p-3 border border-gray-300 rounded-lg text-sm font-bold bg-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                        <div><label className="text-xs font-bold text-gray-600 block mb-1">希望時間</label><input required type="time" value={reserveForm.time} onChange={e => setReserveForm({...reserveForm, time: e.target.value})} className="w-full p-3 border border-gray-300 rounded-lg text-sm font-bold bg-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                      </div>
                      <div><label className="text-xs font-bold text-gray-600 block mb-1 flex items-center gap-1"><User className="w-4 h-4"/> 您的暱稱</label><input required type="text" placeholder="怎麼稱呼您呢" value={reserveForm.name} onChange={e => setReserveForm({...reserveForm, name: e.target.value})} className="w-full p-3 border border-gray-300 rounded-lg text-sm font-bold bg-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                      <div><label className="text-xs font-bold text-gray-600 block mb-1 flex items-center gap-1"><Phone className="w-4 h-4"/> 聯絡方式</label><input required type="text" placeholder="LINE ID 或 手機號碼" value={reserveForm.contact} onChange={e => setReserveForm({...reserveForm, contact: e.target.value})} className="w-full p-3 border border-gray-300 rounded-lg text-sm font-bold bg-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                      <button type="submit" disabled={isSendingLine} className="w-full py-3.5 bg-orange-600 text-white font-black rounded-xl shadow-md hover:bg-orange-700 active:scale-95 transition-all mt-2 text-lg flex items-center justify-center gap-2">{isSendingLine ? '發報通知...' : '送出預約！🚀'}</button>
                    </form>
                  )}
                </div>
              </div>
            </div>
            <div className="text-center text-xs font-bold text-gray-400 mt-8 mb-4 tracking-widest">※ 報名請私訊怪獸造咔粉專或現場報名 ※</div>
          </div>
        )}

        {currentView === 'admin' && (
          <div className="space-y-6">
            {!isAdminAuth ? (
              <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-200 text-center mt-10">
                <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner"><Lock className="w-10 h-10 text-orange-600" /></div>
                <h2 className="text-2xl font-black text-gray-800 mb-2">店長密碼驗證</h2>
                <p className="text-sm text-gray-500 mb-6 font-bold">請輸入專屬密碼以管理系統</p>
                <form onSubmit={handleAdminLogin} className="space-y-4">
                  <input type="password" placeholder="請輸入密碼..." className={`w-full p-4 border rounded-xl text-center font-bold focus:ring-2 focus:ring-orange-500 outline-none transition-colors ${pwdError ? 'border-red-500 bg-red-50' : 'border-gray-300 bg-gray-50'}`} value={passwordInput} onChange={e => { setPasswordInput(e.target.value); setPwdError(false); }} />
                  {pwdError && <p className="text-red-500 text-sm font-bold animate-pulse">密碼錯誤，請重新輸入！</p>}
                  <button type="submit" className="w-full py-4 bg-orange-600 text-white text-lg font-black rounded-xl shadow-md hover:bg-orange-700 active:scale-95 transition-all">登入管理後台</button>
                </form>
              </div>
            ) : (
              <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
                <div className="flex justify-between items-center bg-orange-100 p-5 rounded-2xl border border-orange-200 shadow-sm">
                  <span className="font-black text-orange-800 flex items-center gap-2 text-lg"><Store className="w-6 h-6" /> 店長管理模式</span>
                  <button onClick={() => setIsAdminAuth(false)} className="bg-white text-orange-600 p-2.5 rounded-xl shadow-sm hover:bg-orange-50 active:scale-90 transition-all"><LogOut className="w-5 h-5" /></button>
                </div>
                
                <div className="bg-blue-600 text-white p-5 rounded-2xl shadow-md font-black flex items-center justify-between">
                  <span className="text-lg">🚀 系統連線狀態：正常運作中</span>
                  <Sparkles className="w-6 h-6 animate-pulse text-yellow-300" />
                </div>
                
                {/* 💡 通訊診斷中心 (改用 GAS 測試) */}
                <div className="bg-green-600 text-white p-5 rounded-2xl shadow-md font-black flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-lg flex items-center gap-2"><Send className="w-5 h-5" /> Google 試算表連動測試</span>
                    <button onClick={() => sendLineNotification({}, true)} disabled={isSendingLine} className="bg-white text-green-700 px-4 py-2 rounded-xl text-xs shadow-sm active:scale-95 transition-all">{isSendingLine ? '診斷中...' : '發送測試通知'}</button>
                  </div>
                  <p className="text-[10px] opacity-80 leading-relaxed font-bold">※ 點擊按鈕測試是否能將資料送達您綁定的 Google 試算表與 LINE 群組。</p>
                </div>

                {/* 教學圖管理 */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-blue-200">
                  <h2 className="text-xl font-black text-gray-800 mb-5 flex items-center gap-2"><Sparkles className="w-6 h-6 text-blue-500" /> 新手教學福利圖管理</h2>
                  
                  <div className="mb-6">
                    <p className="text-xs text-gray-500 font-bold mb-2">前台玩家畫面預覽：</p>
                    <TutorialCarousel banners={tutorialBanners} tutorialIdx={tutorialIdx} setTutorialIdx={setTutorialIdx} />
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-6">
                    {tutorialBanners.map(b => (
                      <div key={b.id} className="relative group rounded-xl overflow-hidden aspect-square bg-gray-50 border border-gray-200 shadow-sm">
                        <img src={b.url} alt={b.title} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-3 text-center backdrop-blur-sm">
                          <span className="text-white text-xs font-black mb-3 border border-white/50 px-3 py-1 rounded-full">{b.title}</span>
                          <button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tutorial_banners', b.id))} className="bg-red-500 text-white p-2.5 rounded-full shadow-lg hover:bg-red-600 hover:scale-110 transition-all"><Trash2 className="w-5 h-5" /></button>
                        </div>
                      </div>
                    ))}
                    {tutorialBanners.length === 0 && <div className="col-span-full py-10 text-center text-gray-400 font-bold border-2 border-dashed border-gray-200 rounded-xl">目前還沒有教學圖喔，快在下方新增！👇</div>}
                  </div>

                  <form onSubmit={handleAddTutorialBanner} className="space-y-4 bg-blue-50 p-5 rounded-xl border border-blue-100 shadow-inner">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div><label className="text-xs font-bold text-blue-800 block mb-2">對應遊戲名稱</label><input required type="text" placeholder="例如: 寶可夢" className="w-full p-3 border border-blue-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" value={newTutorialBanner.title} onChange={e => setNewTutorialBanner({...newTutorialBanner, title: e.target.value})} /></div>
                      <div><label className="text-xs font-bold text-blue-800 block mb-2">選擇圖片檔案</label><input id="tutorial-banner-file" required type="file" accept="image/*" className="w-full text-xs bg-white border border-blue-200 p-2 rounded-xl text-gray-500 file:bg-blue-100 file:text-blue-700 file:font-bold file:border-0 file:rounded-lg file:px-3 file:py-1 file:mr-3 cursor-pointer" onChange={async e => setNewTutorialBanner({...newTutorialBanner, url: await compressImage(e.target.files[0])})} /></div>
                    </div>
                    {newTutorialBanner.url && <img src={newTutorialBanner.url} className="h-24 w-auto rounded-lg border-2 border-blue-300 shadow-sm" />}
                    <button type="submit" className="w-full py-3 bg-blue-600 text-white font-black rounded-xl shadow-md hover:bg-blue-700 active:scale-95 transition-all text-lg"><UploadCloud className="w-5 h-5 inline mr-1 -mt-1" /> 上傳至新手福利區</button>
                  </form>
                </div>

                {/* 遊戲分類管理 */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                  <h2 className="text-xl font-black text-gray-800 mb-5 flex items-center gap-2"><Tags className="w-6 h-6 text-orange-500" /> 遊戲分類標籤管理</h2>
                  <div className="flex flex-wrap gap-3 mb-5">
                    {categories.map(cat => (
                      <div key={cat.id} className={`flex items-center gap-1 border border-black/10 rounded-xl py-1.5 pl-3 pr-1.5 text-sm font-black text-black shadow-sm ${cat.color || 'bg-gray-100'}`}>
                        <span>{cat.label}</span>
                        <button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'game_categories', cat.id))} className="p-1 text-black/40 hover:text-red-600 hover:bg-black/10 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ))}
                    {categories.length === 0 && <span className="text-sm text-gray-400 font-bold py-2">無自訂分類，請在下方新增👇</span>}
                  </div>
                  <form onSubmit={handleAddCategory} className="flex flex-col sm:flex-row gap-3 items-end border-t border-gray-100 pt-5">
                    <div className="flex-1 w-full sm:w-auto"><label className="block text-xs font-bold text-gray-500 mb-2">標籤名稱</label><input required type="text" placeholder="例如: 航海王" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} className="w-full p-3 border border-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50 font-bold" /></div>
                    <div className="w-full sm:w-40"><label className="block text-xs font-bold text-gray-500 mb-2">標籤底色</label><select value={newCategoryColor} onChange={e => setNewCategoryColor(e.target.value)} className="w-full p-3 border border-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50 font-bold">
                        <option value="bg-red-200">🔴 紅色</option><option value="bg-orange-200">🟠 橙色</option><option value="bg-yellow-200">🟡 黃色</option><option value="bg-green-200">🟢 綠色</option><option value="bg-blue-200">🔵 藍色</option><option value="bg-indigo-200">🟣 靛色</option><option value="bg-purple-200">🟪 紫色</option><option value="bg-gray-400">⚫ 黑色</option><option value="bg-white border border-gray-300">⚪ 白色</option>
                      </select></div>
                    <button type="submit" className="w-full sm:w-auto px-5 py-3 bg-orange-100 text-orange-700 hover:bg-orange-200 font-black rounded-xl transition-colors whitespace-nowrap active:scale-95 shadow-sm">新增分類</button>
                  </form>
                </div>

                {/* 新增賽事 (加入獎品庫上傳功能) */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                  <h2 className="text-xl font-black text-gray-800 mb-5 flex items-center gap-2"><Plus className="w-6 h-6 text-orange-500" /> 發布新賽事情報</h2>
                  <form onSubmit={handleAddTournament} className="space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                      <div><label className="text-xs font-bold text-gray-600 block mb-2">遊戲種類</label><select className="w-full p-3 border border-gray-300 rounded-xl bg-gray-50 text-sm font-bold focus:ring-2 focus:ring-orange-500 outline-none" value={formData.gameType} onChange={e => setFormData({...formData, gameType: e.target.value})}>{categories.map(cat => <option key={cat.id} value={cat.gameType}>{cat.label}</option>)}</select></div>
                      <div><label className="text-xs font-bold text-gray-600 block mb-2">賽事名稱</label><input required type="text" placeholder="例如：寶可夢奪包賽" className="w-full p-3 border border-gray-300 rounded-xl bg-gray-50 text-sm font-bold focus:ring-2 focus:ring-orange-500 outline-none" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} /></div>
                    </div>
                    
                    <div className="bg-orange-50 p-4 rounded-2xl border border-orange-100 shadow-inner">
                      <div className="flex justify-between items-center mb-3"><label className="text-sm font-black text-orange-800">🗓️ 場次日期與時間</label><button type="button" onClick={() => setSchedules([...schedules, { date: '', time: '19:00' }])} className="text-xs font-bold text-orange-700 bg-white px-3 py-1.5 rounded-lg shadow-sm border border-orange-200 hover:bg-orange-100 active:scale-95 transition-all flex items-center gap-1"><Plus className="w-4 h-4" /> 加場次</button></div>
                      <div className="space-y-3">{schedules.map((sch, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <input required type="date" className="flex-1 p-3 border border-gray-300 rounded-xl bg-white text-sm font-bold focus:ring-2 focus:ring-orange-500 outline-none" value={sch.date} onChange={e => { const ns = [...schedules]; ns[i].date = e.target.value; setSchedules(ns); }} />
                          <input required type="time" className="w-32 p-3 border border-gray-300 rounded-xl bg-white text-sm font-bold focus:ring-2 focus:ring-orange-500 outline-none" value={sch.time} onChange={e => { const ns = [...schedules]; ns[i].time = e.target.value; setSchedules(ns); }} />
                          {schedules.length > 1 && <button type="button" onClick={() => setSchedules(schedules.filter((_, idx) => idx !== i))} className="p-2 text-red-400 hover:text-red-600 bg-white rounded-lg border border-red-100 shadow-sm"><Trash2 className="w-5 h-5"/></button>}
                        </div>
                      ))}</div>
                    </div>

                    <div><label className="text-xs font-bold text-gray-600 block mb-2">報名費或方案</label><input required type="text" placeholder="例如: 200元 或 買2包" className="w-full p-3 border border-gray-300 rounded-xl bg-gray-50 text-sm font-bold focus:ring-2 focus:ring-orange-500 outline-none" value={formData.fee} onChange={e => setFormData({...formData, fee: e.target.value})} /></div>
                    
                    {/* 備註模板區塊 */}
                    <div>
                      <label className="text-xs font-bold text-gray-600 block mb-2">備註與賽制說明</label>
                      <div className="mb-3 p-4 bg-orange-50 border border-orange-100 rounded-xl shadow-inner">
                        <div className="text-sm font-black text-orange-800 mb-3 flex items-center gap-1"><BookmarkPlus className="w-4 h-4"/> 快捷備註模板管理</div>
                        {notePresets.length > 0 ? (
                          <div className="flex flex-wrap gap-2 mb-4">
                            {notePresets.map(p => (
                              <div key={p.id} className="flex items-center gap-1 bg-white border border-orange-200 rounded-lg px-2.5 py-1 shadow-sm">
                                <button type="button" onClick={() => setFormData({...formData, description: p.content})} className="text-xs font-bold text-gray-700 hover:text-orange-600 transition-colors" title="點擊帶入此模板">{p.title}</button>
                                <button type="button" onClick={() => handleDeletePreset(p.id)} className="text-red-400 hover:text-red-600 ml-1 transition-colors" title="刪除模板"><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs font-bold text-orange-600/70 mb-4">目前沒有儲存的模板喔！在下方輸入備註後即可存為模板。</p>
                        )}
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input type="text" placeholder="替目前的備註命名 (如: 寶可夢奪包賽)" className="flex-1 p-2.5 text-xs font-bold border border-orange-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500 bg-white" value={newPresetTitle} onChange={(e) => setNewPresetTitle(e.target.value)} />
                          <button type="button" onClick={handleSavePreset} className="px-4 py-2.5 bg-orange-500 text-white text-xs font-black rounded-xl shadow-sm hover:bg-orange-600 active:scale-95 transition-all whitespace-nowrap">儲存當前備註為模板</button>
                        </div>
                      </div>
                      <textarea rows="4" placeholder="填寫詳細的獎勵內容..." className="w-full p-3 border border-gray-300 rounded-xl bg-gray-50 text-sm font-bold focus:ring-2 focus:ring-orange-500 outline-none resize-none" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                      {/* 上傳主視覺 */}
                      <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                        <label className="text-xs font-black text-gray-700 block mb-2 flex items-center gap-1.5"><ImageIcon className="w-4 h-4 text-orange-500" /> 上傳主視覺宣傳圖 (最多4張)</label>
                        <input type="file" multiple accept="image/*" onChange={async e => { 
                          const imgs = await Promise.all(Array.from(e.target.files).slice(0, 4).map(compressImage)); 
                          setFormData({...formData, images: [...formData.images, ...imgs].slice(0, 4)}); 
                        }} className="w-full text-xs text-gray-500 file:bg-orange-100 file:text-orange-700 file:font-bold file:border-0 file:rounded-lg file:px-3 file:py-1.5 file:mr-2 cursor-pointer" />
                        {formData.images && formData.images.length > 0 && (
                          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                            {formData.images.map((img, i) => (
                              <div key={i} className="relative flex-shrink-0">
                                <img src={img} className="h-16 w-auto rounded-lg border-2 border-gray-200 shadow-sm" />
                                <button type="button" onClick={() => setFormData({...formData, images: formData.images.filter((_, idx) => idx !== i)})} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:scale-110 transition-transform"><X className="w-3 h-3"/></button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* 上傳獨立豪華獎品庫 */}
                      <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-200">
                        <label className="text-xs font-black text-yellow-800 block mb-2 flex items-center gap-1.5"><Gift className="w-4 h-4 text-yellow-600" /> 獨立豪華獎品庫 (最多4張)</label>
                        <input type="file" multiple accept="image/*" onChange={async e => { 
                          const imgs = await Promise.all(Array.from(e.target.files).slice(0, 4).map(compressImage)); 
                          setFormData({...formData, prizeImages: [...(formData.prizeImages || []), ...imgs].slice(0, 4)}); 
                        }} className="w-full text-xs text-yellow-700 file:bg-yellow-200 file:text-yellow-800 file:font-bold file:border-0 file:rounded-lg file:px-3 file:py-1.5 file:mr-2 cursor-pointer" />
                        {formData.prizeImages && formData.prizeImages.length > 0 && (
                          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                            {formData.prizeImages.map((img, i) => (
                              <div key={`prize-${i}`} className="relative flex-shrink-0">
                                <img src={img} className="h-16 w-auto rounded-lg border-2 border-yellow-300 shadow-sm" />
                                <button type="button" onClick={() => setFormData({...formData, prizeImages: formData.prizeImages.filter((_, idx) => idx !== i)})} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:scale-110 transition-transform"><X className="w-3 h-3"/></button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <button type="submit" className="w-full py-4 bg-orange-600 text-white font-black rounded-xl shadow-md hover:bg-orange-700 active:scale-95 transition-all text-lg flex justify-center items-center gap-2 mt-4"><Plus className="w-6 h-6" /> 確認發布賽事！</button>
                  </form>
                </div>
                
                {/* 賽事管理月曆與編輯清單 */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                  <h2 className="text-xl font-black text-gray-800 mb-5 flex items-center gap-2"><Calendar className="w-6 h-6 text-orange-500" /> 賽事管理與編輯</h2>
                  <div className="flex justify-between items-center mb-5 bg-gray-50 p-3 rounded-2xl border border-gray-100">
                    <div className="flex items-center gap-2"><button onClick={() => setAdminMonth(new Date(adminMonth.getFullYear(), adminMonth.getMonth() - 1, 1))} className="p-2 hover:bg-orange-100 rounded-full text-orange-600"><ChevronLeft className="w-5 h-5"/></button><h3 className="font-black text-lg text-gray-800 w-24 text-center">{adminMonth.getMonth()+1}月</h3><button onClick={() => setAdminMonth(new Date(adminMonth.getFullYear(), adminMonth.getMonth() + 1, 1))} className="p-2 hover:bg-orange-100 rounded-full text-orange-600"><ChevronRight className="w-5 h-5"/></button></div>
                    <button onClick={() => setWeekStartsOnMonday(!weekStartsOnMonday)} className="text-xs font-bold text-gray-500 hover:text-orange-600 border border-gray-200 bg-white px-3 py-1.5 rounded-lg shadow-sm transition-colors">改以「{weekStartsOnMonday ? '週日' : '週一'}」為起始</button>
                  </div>
                  
                  {/* 星期標題 */}
                  <div className="grid grid-cols-7 gap-1 mb-2 text-center text-xs font-black text-gray-400">
                    {weekHeaders.map(h => <div key={h}>{h}</div>)}
                  </div>
                  
                  <div className="grid grid-cols-7 gap-1">
                    {(() => {
                      const year = adminMonth.getFullYear(), month = adminMonth.getMonth();
                      const days = new Date(year, month + 1, 0).getDate();
                      const firstDay = new Date(year, month, 1).getDay();
                      const adj = weekStartsOnMonday ? (firstDay === 0 ? 6 : firstDay - 1) : firstDay;
                      const cells = [];
                      for (let i = 0; i < adj; i++) cells.push(<div key={`e-${i}`} className="h-12"></div>);
                      for (let d = 1; d <= days; d++) {
                        const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                        const evs = tournaments.filter(t => t.date === ds);
                        cells.push(
                          <button key={ds} onClick={() => setAdminSelectedDate(adminSelectedDate === ds ? null : ds)} className={`relative h-12 flex flex-col items-center justify-center rounded-xl border transition-all ${adminSelectedDate === ds ? 'bg-orange-100 border-orange-500 shadow-inner' : 'bg-white border-transparent hover:border-gray-200 hover:bg-gray-50'}`}>
                            <span className={`text-sm font-bold ${evs.length > 0 ? 'text-gray-800' : 'text-gray-400'}`}>{d}</span>
                            {evs.length > 0 && (
                              <div className="flex gap-0.5 mt-1">
                                {evs.slice(0,3).map((e, i) => {
                                  const catColor = categories.find(c => c.gameType === e.gameType)?.color || 'bg-gray-200';
                                  return <span key={i} className={`w-1.5 h-1.5 rounded-full ${getDotColor(catColor)} shadow-sm`}></span>
                                })}
                              </div>
                            )}
                          </button>
                        );
                      }
                      return cells;
                    })()}
                  </div>

                  {adminSelectedDate && (
                    <div className="mt-6 pt-5 border-t border-gray-100 space-y-4">
                      <h4 className="font-black text-gray-700 text-md flex items-center gap-2"><Calendar className="w-5 h-5 text-orange-500" /> {adminSelectedDate.replace(/-/g, '/')} 管理清單</h4>
                      {tournaments.filter(t => t.date === adminSelectedDate).length === 0 ? (
                        <p className="text-sm text-gray-400 font-bold bg-gray-50 p-4 rounded-xl text-center border border-gray-100 border-dashed">這天沒有賽事可以管理喔！</p>
                      ) : tournaments.filter(t => t.date === adminSelectedDate).map(t => (
                        editingId === t.id ? (
                          <form key={`edit-${t.id}`} onSubmit={handleSaveEdit} className="p-5 bg-orange-50 shadow-inner rounded-2xl border-2 border-orange-300 flex flex-col gap-4 animate-in slide-in-from-top-2">
                            <div className="flex justify-between items-center border-b border-orange-200 pb-3"><span className="font-black text-orange-800 flex items-center gap-1.5 text-lg"><Edit className="w-5 h-5"/> 編輯賽事內容</span><button type="button" onClick={() => { setEditingId(null); setEditFormData(null); }} className="text-gray-400 hover:text-red-500 bg-white rounded-full p-1 shadow-sm transition-colors"><X className="w-5 h-5"/></button></div>
                            <div className="grid grid-cols-2 gap-3"><div><label className="text-xs font-bold text-orange-800 block mb-1.5">遊戲</label><select value={editFormData.gameType} onChange={(e) => setEditFormData({...editFormData, gameType: e.target.value})} className="w-full p-2.5 border border-orange-200 rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-orange-500 outline-none">{categories.map(cat => <option key={cat.id} value={cat.gameType}>{cat.label}</option>)}</select></div><div><label className="text-xs font-bold text-orange-800 block mb-1.5">名稱</label><input required type="text" value={editFormData.title} onChange={(e) => setEditFormData({...editFormData, title: e.target.value})} className="w-full p-2.5 border border-orange-200 rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-orange-500 outline-none" /></div></div>
                            <div className="grid grid-cols-2 gap-3"><div><label className="text-xs font-bold text-orange-800 block mb-1.5">日期</label><input required type="date" value={editFormData.date} onChange={(e) => setEditFormData({...editFormData, date: e.target.value})} className="w-full p-2.5 border border-orange-200 rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-orange-500 outline-none" /></div><div><label className="text-xs font-bold text-orange-800 block mb-1.5">時間</label><input required type="time" value={editFormData.time} onChange={(e) => setEditFormData({...editFormData, time: e.target.value})} className="w-full p-2.5 border border-orange-200 rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-orange-500 outline-none" /></div></div>
                            <div><label className="text-xs font-bold text-orange-800 block mb-1.5">費用</label><input required type="text" value={editFormData.fee} onChange={(e) => setEditFormData({...editFormData, fee: e.target.value})} className="w-full p-2.5 border border-orange-200 rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                            
                            <div>
                              <div className="flex justify-between items-end mb-1.5">
                                <label className="text-xs font-bold text-orange-800 block">備註</label>
                                <select onChange={(e) => { if(e.target.value) setEditFormData({...editFormData, description: e.target.value})}} className="text-xs border border-orange-200 rounded-lg p-1 bg-white text-orange-700 font-bold outline-none max-w-[140px] shadow-sm cursor-pointer">
                                  <option value="">載入模板...</option>
                                  {notePresets.map(p => <option key={p.id} value={p.content}>{p.title}</option>)}
                                </select>
                              </div>
                              <textarea rows="3" value={editFormData.description} onChange={(e) => setEditFormData({...editFormData, description: e.target.value})} className="w-full p-3 border border-orange-200 rounded-xl text-sm font-bold resize-none bg-white focus:ring-2 focus:ring-orange-500 outline-none leading-relaxed" />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {/* 修改主視覺 */}
                              <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                                <label className="text-xs font-bold text-gray-700 block mb-2 flex items-center gap-1"><ImageIcon className="w-4 h-4 text-orange-500" /> 主視覺圖</label>
                                <input type="file" multiple accept="image/*" onChange={async (e) => {
                                  const newImgs = await Promise.all(Array.from(e.target.files).slice(0, 4).map(compressImage));
                                  setEditFormData(prev => ({ ...prev, images: [...(Array.isArray(prev.images) ? prev.images : []), ...newImgs].slice(0, 4) }));
                                }} className="w-full p-1 text-xs text-gray-500 file:bg-gray-100 file:text-gray-700 file:font-bold file:border-0 file:rounded-lg file:px-2 file:py-1 cursor-pointer" />
                                {Array.isArray(editFormData.images) && editFormData.images.length > 0 && (
                                  <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                                    {editFormData.images.map((img, i) => (
                                      <div key={i} className="relative inline-block flex-shrink-0">
                                        <img src={img} className="h-12 w-auto rounded border border-gray-200 object-cover shadow-sm" />
                                        <button type="button" onClick={() => { const ni = [...editFormData.images]; ni.splice(i, 1); setEditFormData({...editFormData, images: ni}); }} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 shadow-md"><X className="w-3 h-3" /></button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              
                              {/* 修改獨立獎品庫 */}
                              <div className="bg-yellow-50 p-3 rounded-xl border border-yellow-200 shadow-sm">
                                <label className="text-xs font-bold text-yellow-800 block mb-2 flex items-center gap-1"><Gift className="w-4 h-4 text-yellow-600" /> 獎品庫圖片</label>
                                <input type="file" multiple accept="image/*" onChange={async (e) => {
                                  const newImgs = await Promise.all(Array.from(e.target.files).slice(0, 4).map(compressImage));
                                  setEditFormData(prev => ({ ...prev, prizeImages: [...(Array.isArray(prev.prizeImages) ? prev.prizeImages : []), ...newImgs].slice(0, 4) }));
                                }} className="w-full p-1 text-xs text-yellow-700 file:bg-yellow-200 file:text-yellow-800 file:font-bold file:border-0 file:rounded-lg file:px-2 file:py-1 cursor-pointer" />
                                {Array.isArray(editFormData.prizeImages) && editFormData.prizeImages.length > 0 && (
                                  <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                                    {editFormData.prizeImages.map((img, i) => (
                                      <div key={`edit-prize-${i}`} className="relative inline-block flex-shrink-0">
                                        <img src={img} className="h-12 w-auto rounded border-2 border-yellow-300 object-cover shadow-sm" />
                                        <button type="button" onClick={() => { const ni = [...editFormData.prizeImages]; ni.splice(i, 1); setEditFormData({...editFormData, prizeImages: ni}); }} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 shadow-md"><X className="w-3 h-3" /></button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>

                            <button type="submit" className="w-full py-3.5 mt-2 bg-orange-600 text-white font-black rounded-xl transition-all active:scale-95 flex justify-center items-center gap-2 text-lg shadow-md hover:bg-orange-700"><Save className="w-5 h-5" /> 儲存賽事變更</button>
                          </form>
                        ) : (
                          <div key={t.id} className="p-4 bg-white shadow-sm rounded-2xl border border-gray-200 flex justify-between items-center transition-all hover:border-blue-300">
                            <div><span className={`px-2.5 py-1 text-xs font-black rounded-full shadow-sm ${categories.find(c=>c.gameType===t.gameType)?.color || 'bg-gray-200'}`}>{t.gameType}</span><div className="font-black text-gray-800 mt-2.5 text-lg">{t.title}</div><div className="text-sm text-gray-500 font-bold mt-1 flex items-center gap-1"><Clock className="w-4 h-4"/> {t.time} 開打</div></div>
                            <div className="flex gap-2 flex-col sm:flex-row">
                              <button type="button" onClick={(e) => toggleNote(e, t.id)} className="p-3 text-orange-600 bg-orange-50 rounded-xl hover:bg-orange-100 active:scale-90 transition-all shadow-sm flex items-center justify-center" title="查看詳細資訊"><BookmarkPlus className="w-5 h-5"/></button>
                              <button type="button" onClick={() => { 
                                setEditingId(t.id); 
                                setEditFormData({
                                  ...t, 
                                  images: Array.isArray(t.images) && t.images.length > 0 ? t.images : (t.image ? [t.image] : []),
                                  prizeImages: Array.isArray(t.prizeImages) ? t.prizeImages : []
                                }); 
                              }} className="p-3 text-blue-600 bg-blue-50 rounded-xl hover:bg-blue-100 active:scale-90 transition-all shadow-sm flex items-center justify-center"><Edit className="w-5 h-5"/></button>
                              <button type="button" onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'monster_tournaments', t.id))} className="p-3 text-red-600 bg-red-50 rounded-xl hover:bg-red-100 active:scale-90 transition-all shadow-sm flex items-center justify-center"><Trash2 className="w-5 h-5"/></button>
                            </div>
                            
                            {/* 後台也同步顯示展開的資訊與獨立獎品庫 */}
                            {expandedNotes[t.id] && (
                              <div className="w-full mt-3 pt-3 border-t border-gray-100 col-span-full">
                                <ImageCarousel tournament={t} />
                                <div className="text-sm text-gray-600 font-bold whitespace-pre-line leading-relaxed">{renderTextWithLinks(t.description)}</div>
                                
                                {t.prizeImages && t.prizeImages.length > 0 && (
                                  <div className="mt-4 p-3.5 bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl border border-yellow-200 shadow-sm">
                                    <div className="text-sm font-black text-orange-800 mb-3 flex items-center gap-1.5">
                                      <Gift className="w-4 h-4 text-orange-500" /> 本場豪華獎勵一覽
                                    </div>
                                    <div className={`grid gap-2 ${t.prizeImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                      {t.prizeImages.map((img, i) => (
                                        <img 
                                          key={`admin-prize-${i}`} 
                                          src={img} 
                                          className="w-full h-auto rounded-lg border border-yellow-300 shadow-sm object-cover cursor-zoom-in hover:scale-105 transition-transform duration-300" 
                                          onClick={(e) => { e.stopPropagation(); setFullscreenImage(img); }}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      ))}
                    </div>
                  )}
                </div>

                {/* 教學預約單 */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-orange-200 mt-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 bg-orange-100 text-orange-700 text-xs font-black px-3 py-1.5 rounded-bl-xl shadow-sm">後台清單</div>
                  <h2 className="text-xl font-black text-gray-800 mb-5 flex items-center gap-2"><BookOpen className="w-6 h-6 text-orange-500" /> 教學預約管理</h2>
                  <div className="space-y-4">
                    {reservations.length === 0 ? <div className="text-center py-8 text-gray-400 font-bold bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">目前無人預約教學喔！</div> : reservations.map(res => (
                      <div key={res.id} className={`p-5 rounded-2xl border transition-colors shadow-sm ${res.status === 'completed' ? 'bg-gray-50 opacity-60 border-gray-200' : 'bg-white border-orange-200 border-l-4 border-l-orange-500'}`}>
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black bg-gray-200 px-2.5 py-1 rounded-full shadow-sm">{res.gameType}</span>
                            <span className={`text-xs font-bold px-2.5 py-1 rounded-full shadow-sm ${res.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{res.status === 'completed' ? '✅ 已處理' : '🚨 待聯絡'}</span>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={async () => await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tutorial_reservations', res.id), { status: res.status === 'pending' ? 'completed' : 'pending' })} className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg font-bold text-xs shadow-sm hover:bg-blue-100 active:scale-95 transition-all">切換狀態</button>
                            <button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tutorial_reservations', res.id))} className="p-1.5 bg-red-50 text-red-500 rounded-lg shadow-sm hover:bg-red-100 active:scale-95 transition-all"><Trash2 className="w-4 h-4"/></button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-sm bg-white p-3 rounded-xl border border-gray-100">
                          <div><span className="text-gray-400 block text-xs font-bold mb-0.5">👤 暱稱</span><span className="font-black text-gray-800">{res.name}</span></div>
                          <div><span className="text-gray-400 block text-xs font-bold mb-0.5">📱 聯絡</span><span className="font-black text-gray-800">{res.contact}</span></div>
                          <div className="col-span-2 border-t border-gray-100 pt-2"><span className="text-gray-400 block text-xs font-bold mb-0.5">🗓️ 期望時間</span><span className="font-black text-orange-600">{res.date} {res.time}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            )}
          </div>
        )}
      </main>

      {/* 🔍 全域放大圖片懸浮視窗 (Lightbox) */}
      {fullscreenImage && (
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={() => setFullscreenImage(null)}
        >
          <div className="relative max-w-full max-h-full flex flex-col items-center">
            <button 
              className="absolute -top-12 right-0 text-white/70 hover:text-white bg-black/50 hover:bg-black/80 p-2 rounded-full transition-colors"
              onClick={() => setFullscreenImage(null)}
              title="關閉放大"
            >
              <X className="w-6 h-6" />
            </button>
            <img 
              src={fullscreenImage} 
              alt="放大預覽" 
              className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl animate-in zoom-in-95 duration-200 cursor-zoom-out" 
              onClick={(e) => {
                e.stopPropagation();
                setFullscreenImage(null);
              }} 
            />
          </div>
        </div>
      )}
    </div>
  );
}
