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

  // 系統狀態
  const [isAdminAuth, setIsAdminAuth] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [pwdError, setPwdError] = useState(false);
  const [weekStartsOnMonday, setWeekStartsOnMonday] = useState(false);

  // 玩家功能狀態
  const [playerFilters, setPlayerFilters] = useState(['All']);
  const [viewMode, setViewMode] = useState('list'); 
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);

  // 店家功能狀態
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

  // Banner 與圖片狀態
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
  // 🔐 處理身份驗證
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
  // 📊 只有在 user 成功後才抓資料
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
        console.error("賽事讀取被拒絕:", err);
        setIsLoading(false);
      }));

      unsubs.push(onSnapshot(getPath('game_categories'), (snap) => {
        setCategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, (err) => console.error("分類讀取被拒絕:", err)));

      unsubs.push(onSnapshot(getPath('note_presets'), (snap) => {
        setNotePresets(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, (err) => console.error("模板讀取被拒絕:", err)));

      unsubs.push(onSnapshot(getPath('tutorial_reservations'), (snap) => {
        const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        setReservations(data);
      }, (err) => console.error("預約讀取被拒絕:", err)));

      unsubs.push(onSnapshot(getPath('tutorial_banners'), (snap) => {
        const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        data.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        setTutorialBanners(data);
      }, (err) => console.error("Banner 讀取被拒絕:", err)));

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
  // 🖼️ 輔助元件與樣式
  // ==========================================
  const formatEventDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString; 
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}(${days[date.getDay()]})`;
  };

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
    const imgs = Array.isArray(tournament.images) && tournament.images.length > 0 
      ? tournament.images 
      : (typeof tournament.image === 'string' && tournament.image ? [tournament.image] : []);
    
    const idx = currentImgIdx[tournament.id] || 0;
    if (imgs.length === 0) return null;

    const safeIdx = idx % Math.max(imgs.length, 1);

    return (
      <div className="mb-3 relative rounded-lg overflow-hidden border border-gray-100 shadow-sm group bg-gray-50 flex items-center justify-center">
        {/* 恢復為充滿版面、高度自適應，不再強制裁切成正方形 */}
        <img src={imgs[safeIdx]} alt="賽事圖片" className="w-full h-auto object-cover" />
        
        {imgs.length > 1 && (
          <>
            <button onClick={(e) => { e.stopPropagation(); setCurrentImgIdx(p => ({...p, [tournament.id]: (safeIdx-1+imgs.length)%imgs.length})); }} className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 text-white p-1.5 rounded-full shadow-sm hover:bg-black/60 transition-colors"><ChevronLeft className="w-5 h-5" /></button>
            <button onClick={(e) => { e.stopPropagation(); setCurrentImgIdx(p => ({...p, [tournament.id]: (safeIdx+1)%imgs.length})); }} className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 text-white p-1.5 rounded-full shadow-sm hover:bg-black/60 transition-colors"><ChevronRight className="w-5 h-5" /></button>
            <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
              {imgs.map((_, i) => <div key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i === safeIdx ? 'bg-white scale-125 shadow-md' : 'bg-white/50'}`} />)}
            </div>
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
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <div className="w-16 h-16 border-4 border-orange-200 border-t-orange-600 rounded-full animate-spin mb-4"></div>
        <p className="text-orange-600 font-black text-xl animate-pulse tracking-widest">怪獸造咔系統啟動中...🚀</p>
        <p className="text-gray-400 text-sm mt-2 font-bold">正在為您準備最熱血的賽程與福利！</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 font-sans pb-12">
      {/* 導覽列 */}
      <nav className="bg-orange-600 text-white shadow-lg sticky top-0 z-50">
        <div className="max-w-md mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-2"><Store className="w-6 h-6" /><h1 className="font-black text-xl tracking-wider">怪獸造咔</h1></div>
          <div className="flex gap-2">
            <button onClick={() => setCurrentView('player')} className={`text-sm px-3 py-1.5 rounded-full font-bold transition-all ${currentView === 'player' ? 'bg-white text-orange-600 shadow-sm' : 'bg-orange-700 hover:bg-orange-800'}`}>玩家看板</button>
            <button onClick={() => setCurrentView('admin')} className={`text-sm px-3 py-1.5 rounded-full font-bold transition-all ${currentView === 'admin' ? 'bg-white text-orange-600 shadow-sm' : 'bg-orange-700 hover:bg-orange-800'}`}>店家後台</button>
          </div>
        </div>
      </nav>

      <main className="max-w-md mx-auto p-4 space-y-6 mt-4">
        
        {/* ========================================== */}
        {/* 玩家看版 (Player View) */}
        {/* ========================================== */}
        {currentView === 'player' && (
          <div className="space-y-5 animate-in fade-in duration-500">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
              <h2 className="text-xl font-black text-gray-800 flex items-center gap-2 mb-2"><Swords className="w-6 h-6 text-orange-500" /> 近期熱血賽事 🔥</h2>
              <p className="text-sm text-gray-500 flex items-center gap-1 font-bold"><MapPin className="w-4 h-4" /> 台中市南區光輝街113號</p>
            </div>

            <div className="flex flex-col gap-3">
              {/* 隱藏原生捲動條的 CSS */}
              <style>{`.hide-scrollbar::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; } .hide-scrollbar { -ms-overflow-style: none !important; scrollbar-width: none !important; }`}</style>
              
              <div className="flex flex-wrap gap-2 px-1">
                <span className="text-xs font-bold text-orange-600 bg-orange-100 border border-orange-200 px-2 py-1 rounded-md inline-flex items-center shadow-sm">💡 分類按鈕可「多選」篩選！</span>
                <button onClick={() => document.getElementById('tutorial-section')?.scrollIntoView({ behavior: 'smooth' })} className="text-xs font-bold text-white bg-orange-500 hover:bg-orange-600 px-2 py-1 rounded-md inline-flex items-center shadow-sm active:scale-95 transition-all">🎓 預約新手教學 👉</button>
              </div>

              {/* 美感回歸：分類滑動按鈕區塊 */}
              <div className="flex items-center gap-1 w-full">
                <button onClick={() => categoryScrollRef.current?.scrollBy({ left: -200, behavior: 'smooth' })} className="flex-shrink-0 w-9 h-9 bg-white shadow-sm rounded-full text-orange-600 border border-gray-200 flex items-center justify-center hover:bg-orange-50 active:scale-95 transition-all"><ChevronLeft className="w-5 h-5 -ml-0.5" /></button>
                <div ref={categoryScrollRef} className="flex-1 flex gap-2 overflow-x-auto pb-2 pt-1 px-1 hide-scrollbar scroll-smooth">
                  {[{ id: 'All', label: '全部', color: 'bg-white border border-gray-300' }, ...categories.map(c => ({ id: c.gameType, label: c.label, color: c.color }))].map(cat => (
                    <button key={cat.id} onClick={() => togglePlayerFilter(cat.id)} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-black transition-all shadow-sm text-black ${cat.color} ${playerFilters.includes(cat.id) ? 'ring-2 ring-black ring-offset-1 scale-105 opacity-100' : 'opacity-60 hover:opacity-100'}`}>{cat.label}</button>
                  ))}
                </div>
                <button onClick={() => categoryScrollRef.current?.scrollBy({ left: 200, behavior: 'smooth' })} className="flex-shrink-0 w-9 h-9 bg-white shadow-sm rounded-full text-orange-600 border border-gray-200 flex items-center justify-center hover:bg-orange-50 active:scale-95 transition-all"><ChevronRight className="w-5 h-5 -mr-0.5" /></button>
              </div>

              {/* 列表 / 行事曆 切換 */}
              <div className="flex bg-gray-200 p-1.5 rounded-xl">
                <button onClick={() => setViewMode('list')} className={`flex-1 flex justify-center items-center gap-2 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'list' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><LayoutList className="w-4 h-4" /> 列表</button>
                <button onClick={() => setViewMode('calendar')} className={`flex-1 flex justify-center items-center gap-2 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'calendar' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><Calendar className="w-4 h-4" /> 行事曆</button>
              </div>
            </div>

            {/* 列表模式內容 */}
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
                      
                      {((Array.isArray(t.images) && t.images.length > 0) || t.image || t.description) && (
                        <div className="mt-2">
                          <button onClick={(e) => toggleNote(e, t.id)} className="w-full text-sm font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 py-2.5 rounded-xl flex justify-center items-center gap-1 border border-orange-100 active:scale-95 transition-all">{expandedNotes[t.id] ? '▲ 收起詳細資訊' : '▼ 查看詳細資訊點我'}</button>
                          {expandedNotes[t.id] && (
                            <div className="mt-3 pt-3 border-t border-gray-100 animate-in slide-in-from-top-2 duration-300">
                              <ImageCarousel tournament={t} />
                              <div className="text-sm text-gray-600 whitespace-pre-line font-bold leading-relaxed">{renderTextWithLinks(t.description)}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* 行事曆內容 (修復點點顏色問題) */}
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
                
                {/* 星期標題 */}
                <div className="grid grid-cols-7 gap-1 mb-2 text-center text-xs font-black text-gray-400">
                  {weekHeaders.map(h => <div key={h}>{h}</div>)}
                </div>
                
                {/* 日期格子 */}
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
                              {/* 💡 修復：動態顯示各遊戲對應顏色的點點 */}
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

                {/* 點擊日期展開的賽事列表 */}
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
                        {((Array.isArray(t.images) && t.images.length > 0) || t.image || t.description) && (
                          <div className="mt-2">
                            <button onClick={(e) => toggleNote(e, t.id)} className="w-full text-sm font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 py-2 rounded-xl flex justify-center items-center gap-1 border border-orange-100 transition-colors">{expandedNotes[t.id] ? '▲ 收起詳細資訊' : '▼ 查看詳細資訊'}</button>
                            {expandedNotes[t.id] && (
                              <div className="mt-3 pt-3 border-t border-gray-100">
                                <ImageCarousel tournament={t} />
                                <div className="text-sm text-gray-600 font-bold whitespace-pre-line leading-relaxed">{renderTextWithLinks(t.description)}</div>
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
            
            {/* 新手教學區 (Banner 輪播保持正方形 aspect-square，適合店長的圖) */}
            <div id="tutorial-section" className="bg-white rounded-2xl p-5 shadow-sm border border-orange-200 relative overflow-hidden mt-8">
              <div className="absolute top-0 right-0 bg-orange-100 text-orange-700 text-xs font-black px-3 py-1.5 rounded-bl-xl shadow-sm">新手福利區</div>
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
                        <div className="absolute top-3 left-3 bg-black/70 text-white text-xs font-black px-3 py-1.5 rounded-full flex items-center gap-1 backdrop-blur-md shadow-sm"><Sparkles className="w-4 h-4 text-yellow-400" /> {banner.title} 專屬福利</div>
                        
                        {/* 左右導航按鈕 (預設隱藏，hover顯示) */}
                        {tutorialBanners.length > 1 && (
                          <div className="absolute inset-0 flex items-center justify-between px-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                            <button onClick={() => setTutorialIdx((tutorialIdx - 1 + tutorialBanners.length) % tutorialBanners.length)} className="w-10 h-10 bg-white/90 text-orange-600 rounded-full flex items-center justify-center shadow-lg hover:bg-white hover:scale-110 active:scale-95 transition-all"><ChevronLeft className="w-6 h-6 -ml-0.5"/></button>
                            <button onClick={() => setTutorialIdx((tutorialIdx + 1) % tutorialBanners.length)} className="w-10 h-10 bg-white/90 text-orange-600 rounded-full flex items-center justify-center shadow-lg hover:bg-white hover:scale-110 active:scale-95 transition-all"><ChevronRight className="w-6 h-6 -mr-0.5"/></button>
                          </div>
                        )}
                        
                        {/* 底部點點 */}
                        {tutorialBanners.length > 1 && (
                          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2">
                            {tutorialBanners.map((_, i) => <div key={i} className={`h-2 rounded-full transition-all shadow-sm ${i === safeIdx ? 'bg-white w-6' : 'bg-white/50 w-2'}`} />)}
                          </div>
                        )}
                      </>
                    );
                  })()
                ) : (
                  <div className="text-center p-8 text-gray-400 font-bold flex flex-col items-center gap-3"><ImageIcon className="w-16 h-16 opacity-20" /> 新手福利圖準備中...🚀</div>
                )}
              </div>

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
                      <button type="submit" className="w-full py-3.5 bg-orange-600 text-white font-black rounded-xl shadow-md hover:bg-orange-700 active:scale-95 transition-all mt-2 text-lg">送出預約！🚀</button>
                    </form>
                  )}
                </div>
              </div>
            </div>
            <div className="text-center text-xs font-bold text-gray-400 mt-8 mb-4 tracking-widest">※ 報名請私訊怪獸造咔粉專或現場報名 ※</div>
          </div>
        )}

        {/* ========================================== */}
        {/* 店家後台 (Admin) */}
        {/* ========================================== */}
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
                
                {/* 系統狀態提示 */}
                <div className="bg-blue-600 text-white p-5 rounded-2xl shadow-md font-black flex items-center justify-between">
                  <span className="text-lg">🚀 系統連線狀態：正常運作中</span>
                  <Sparkles className="w-6 h-6 animate-pulse text-yellow-300" />
                </div>
                
                {/* 教學圖管理 */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-blue-200">
                  <h2 className="text-xl font-black text-gray-800 mb-5 flex items-center gap-2"><Sparkles className="w-6 h-6 text-blue-500" /> 新手教學福利圖管理</h2>
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

                {/* 新增賽事 */}
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
                    <div><label className="text-xs font-bold text-gray-600 block mb-2">備註與賽制說明</label><textarea rows="4" placeholder="填寫詳細的獎勵內容..." className="w-full p-3 border border-gray-300 rounded-xl bg-gray-50 text-sm font-bold focus:ring-2 focus:ring-orange-500 outline-none resize-none" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} /></div>
                    <div>
                      <label className="text-xs font-bold text-gray-600 block mb-2 flex items-center gap-1"><ImageIcon className="w-4 h-4 text-orange-500" /> 上傳宣傳圖 (選填，最多4張)</label>
                      <input id="promo-image-upload" type="file" multiple accept="image/*" onChange={async e => { const imgs = await Promise.all(Array.from(e.target.files).slice(0, 4).map(compressImage)); setFormData({...formData, images: [...formData.images, ...imgs].slice(0, 4)}); }} className="w-full p-2 border border-gray-300 rounded-xl bg-gray-50 text-xs text-gray-500 file:bg-orange-100 file:text-orange-700 file:font-bold file:border-0 file:rounded-lg file:px-4 file:py-2 file:mr-3 cursor-pointer" />
                      {formData.images.length > 0 && (
                        <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
                          {formData.images.map((img, i) => (
                            <div key={i} className="relative flex-shrink-0">
                              <img src={img} className="h-20 w-auto rounded-lg border-2 border-gray-200 shadow-sm" />
                              <button type="button" onClick={() => setFormData({...formData, images: formData.images.filter((_, idx) => idx !== i)})} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:scale-110 transition-transform"><X className="w-4 h-4"/></button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <button type="submit" className="w-full py-4 bg-orange-600 text-white font-black rounded-xl shadow-md hover:bg-orange-700 active:scale-95 transition-all text-lg flex justify-center items-center gap-2"><Plus className="w-6 h-6" /> 確認發布賽事！</button>
                  </form>
                </div>
                
                {/* 賽事管理月曆與編輯清單 */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                  <h2 className="text-xl font-black text-gray-800 mb-5 flex items-center gap-2"><Calendar className="w-6 h-6 text-orange-500" /> 賽事管理與編輯</h2>
                  <div className="flex justify-between items-center mb-5 bg-gray-50 p-3 rounded-2xl border border-gray-100">
                    <div className="flex items-center gap-2"><button onClick={() => setAdminMonth(new Date(adminMonth.getFullYear(), adminMonth.getMonth() - 1, 1))} className="p-2 hover:bg-orange-100 rounded-full text-orange-600"><ChevronLeft className="w-5 h-5"/></button><h3 className="font-black text-lg text-gray-800 w-24 text-center">{adminMonth.getMonth()+1}月</h3><button onClick={() => setAdminMonth(new Date(adminMonth.getFullYear(), adminMonth.getMonth() + 1, 1))} className="p-2 hover:bg-orange-100 rounded-full text-orange-600"><ChevronRight className="w-5 h-5"/></button></div>
                    <button onClick={() => setWeekStartsOnMonday(!weekStartsOnMonday)} className="text-xs font-bold text-gray-500 hover:text-orange-600 border border-gray-200 bg-white px-3 py-1.5 rounded-lg shadow-sm transition-colors">改以「{weekStartsOnMonday ? '週日' : '週一'}」為起始</button>
                  </div>
                  
                  {/* 💡 修復：後台月曆補上星期標題 */}
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
                                {/* 💡 修復：後台點點顏色也跟前台一樣自動抓取對應遊戲色 */}
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
                            <div><label className="text-xs font-bold text-orange-800 block mb-1.5">備註</label><textarea rows="3" value={editFormData.description} onChange={(e) => setEditFormData({...editFormData, description: e.target.value})} className="w-full p-3 border border-orange-200 rounded-xl text-sm font-bold resize-none bg-white focus:ring-2 focus:ring-orange-500 outline-none leading-relaxed" /></div>
                            <div><label className="text-xs font-bold text-orange-800 block mb-1.5">圖片修改</label>
                              <input type="file" multiple accept="image/*" onChange={async (e) => {
                                const newImgs = await Promise.all(Array.from(e.target.files).slice(0, 4).map(compressImage));
                                setEditFormData(prev => ({ ...prev, images: [...(Array.isArray(prev.images) ? prev.images : []), ...newImgs].slice(0, 4) }));
                              }} className="w-full p-1 text-xs text-gray-500 file:bg-orange-100 file:text-orange-700 file:font-bold file:border-0 file:rounded-lg file:px-3 file:py-1 cursor-pointer" />
                              {Array.isArray(editFormData.images) && editFormData.images.length > 0 && (
                                <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
                                  {editFormData.images.map((img, i) => (
                                    <div key={i} className="relative inline-block flex-shrink-0">
                                      <img src={img} className="h-16 w-auto rounded-lg border-2 border-orange-200 object-cover shadow-sm" />
                                      <button type="button" onClick={() => { const ni = [...editFormData.images]; ni.splice(i, 1); setEditFormData({...editFormData, images: ni}); }} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:scale-110 transition-transform"><X className="w-3 h-3" /></button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <button type="submit" className="w-full py-3.5 mt-2 bg-orange-600 text-white font-black rounded-xl transition-all active:scale-95 flex justify-center items-center gap-2 text-lg shadow-md hover:bg-orange-700"><Save className="w-5 h-5" /> 儲存賽事變更</button>
                          </form>
                        ) : (
                          <div key={t.id} className="p-4 bg-white shadow-sm rounded-2xl border border-gray-200 flex justify-between items-center transition-all hover:border-blue-300">
                            <div><span className={`px-2.5 py-1 text-xs font-black rounded-full shadow-sm ${categories.find(c=>c.gameType===t.gameType)?.color || 'bg-gray-200'}`}>{t.gameType}</span><div className="font-black text-gray-800 mt-2.5 text-lg">{t.title}</div><div className="text-sm text-gray-500 font-bold mt-1 flex items-center gap-1"><Clock className="w-4 h-4"/> {t.time} 開打</div></div>
                            <div className="flex gap-2 flex-col sm:flex-row">
                              <button onClick={() => { setEditingId(t.id); setEditFormData({...t, images: Array.isArray(t.images) && t.images.length > 0 ? t.images : (t.image ? [t.image] : [])}); }} className="p-3 text-blue-600 bg-blue-50 rounded-xl hover:bg-blue-100 active:scale-90 transition-all shadow-sm flex items-center justify-center"><Edit className="w-5 h-5"/></button>
                              <button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'monster_tournaments', t.id))} className="p-3 text-red-600 bg-red-50 rounded-xl hover:bg-red-100 active:scale-90 transition-all shadow-sm flex items-center justify-center"><Trash2 className="w-5 h-5"/></button>
                            </div>
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
    </div>
  );
}
