import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { Calendar, Clock, MapPin, Plus, Trash2, Trophy, Swords, Zap, Store, Image as ImageIcon, ChevronLeft, ChevronRight, LayoutList, Tags, BookmarkPlus, BookOpen, User, Phone, CheckCircle2, MessageCircle, Lock, LogOut } from 'lucide-react';

// ==========================================
// Firebase 初始化與設定 (自動判斷：測試環境 / 正式環境)
// ==========================================
let app, auth, db, appId;
try {
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
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  // 💡 特助終極修復：強制將斜線替換為短橫線，確保資料庫路徑永遠保持合法的 5 段 (奇數段)
  appId = typeof __app_id !== 'undefined' ? String(__app_id).replace(/\//g, '-') : 'kaijuzaocard-main';
} catch (error) {
  console.error("Firebase initialization error:", error);
}

export default function App() {
  const [user, setUser] = useState(null);
  const [tournaments, setTournaments] = useState([]);
  const [currentView, setCurrentView] = useState('player'); 
  const [isLoading, setIsLoading] = useState(true);

  // 店長後台密碼鎖狀態
  const [isAdminAuth, setIsAdminAuth] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [pwdError, setPwdError] = useState(false);

  // 玩家看板狀態改為「陣列」以支援複選功能
  const [playerFilters, setPlayerFilters] = useState(['All']);
  const [viewMode, setViewMode] = useState('list'); 
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);

  // 後台專屬行事曆狀態
  const [adminMonth, setAdminMonth] = useState(new Date());
  const [adminSelectedDate, setAdminSelectedDate] = useState(null);

  // 分類管理狀態
  const [categories, setCategories] = useState([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('bg-red-200');

  // 快捷備註模板狀態
  const [notePresets, setNotePresets] = useState([]);
  const [newPresetTitle, setNewPresetTitle] = useState('');

  // 新手教學預約狀態
  const [reservations, setReservations] = useState([]);
  const [reserveForm, setReserveForm] = useState({ gameType: '', date: '', time: '', name: '', contact: '' });
  const [reserveSuccess, setReserveSuccess] = useState(false);

  // 表單狀態
  const [schedules, setSchedules] = useState([{ date: '', time: '19:00' }]);
  const [formData, setFormData] = useState({ gameType: 'UA', title: '', fee: '', description: '', image: '' });
  const [addSuccess, setAddSuccess] = useState(false);

  // 一鍵收合宣傳圖與備註文字狀態管理
  const [expandedNotes, setExpandedNotes] = useState({});
  const toggleNote = (e, id) => {
    e.stopPropagation();
    setExpandedNotes(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // 分類按鈕的左右滑動控制
  const categoryScrollRef = useRef(null);
  const scrollCategories = (offset) => {
    if (categoryScrollRef.current) {
      categoryScrollRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  // 智慧處理複選點擊邏輯
  const togglePlayerFilter = (categoryId) => {
    if (categoryId === 'All') {
      setPlayerFilters(['All']);
      return;
    }

    setPlayerFilters(prev => {
      let newFilters = prev.filter(id => id !== 'All');
      if (newFilters.includes(categoryId)) {
        newFilters = newFilters.filter(id => id !== categoryId);
        if (newFilters.length === 0) return ['All'];
        return newFilters;
      } else {
        return [...newFilters, categoryId];
      }
    });
  };

  // ==========================================
  // 認證與資料讀取
  // ==========================================
  useEffect(() => {
    if (!auth) return;

    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth); 
        }
      } catch (error) {
        console.error("Auth error:", error);
      }
    };

    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db) return;

    // 💡 特助升級：全面加上防護網 (try-catch)，避免資料庫路徑異常時造成畫面崩潰
    let unsubTournaments, unsubCategories, unsubPresets, unsubRes;

    try {
      const tournamentsRef = collection(db, 'artifacts', appId, 'public', 'data', 'monster_tournaments');
      unsubTournaments = onSnapshot(tournamentsRef, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        data.sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`));
        setTournaments(data);
        setIsLoading(false);
      }, (error) => {
        console.error("Firestore error:", error);
        setIsLoading(false);
      });

      const categoriesRef = collection(db, 'artifacts', appId, 'public', 'data', 'game_categories');
      unsubCategories = onSnapshot(categoriesRef, (snapshot) => {
        setCategories(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, (error) => console.error("Categories fetch error:", error));

      const presetsRef = collection(db, 'artifacts', appId, 'public', 'data', 'note_presets');
      unsubPresets = onSnapshot(presetsRef, (snapshot) => {
        setNotePresets(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, (error) => console.error("Presets fetch error:", error));

      const resRef = collection(db, 'artifacts', appId, 'public', 'data', 'tutorial_reservations');
      unsubRes = onSnapshot(resRef, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        setReservations(data);
      }, (error) => console.error("Reservations fetch error:", error));

    } catch (error) {
      console.error("Database connection error:", error);
      setIsLoading(false);
    }

    return () => {
      // 💡 安全關閉資料庫連線，防止死當
      if (unsubTournaments) unsubTournaments();
      if (unsubCategories) unsubCategories();
      if (unsubPresets) unsubPresets();
      if (unsubRes) unsubRes();
    };
  }, [user]);

  // ==========================================
  // 後台功能與操作
  // ==========================================
  const handleAdminLogin = (e) => {
    e.preventDefault();
    if (passwordInput === 'monster113') {
      setIsAdminAuth(true);
      setPwdError(false);
      setPasswordInput('');
    } else {
      setPwdError(true);
      setPasswordInput('');
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 800; 
          const MAX_HEIGHT = 800; 
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
          } else {
            if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
          setFormData({ ...formData, image: compressedDataUrl });
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddTournament = async (e) => {
    e.preventDefault();
    if (!user || !formData.title || schedules.length === 0) return;
    
    const validSchedules = schedules.filter(s => s.date && s.time);
    if (validSchedules.length === 0) return;

    try {
      const tournamentsRef = collection(db, 'artifacts', appId, 'public', 'data', 'monster_tournaments');
      const promises = validSchedules.map(schedule => 
        addDoc(tournamentsRef, { 
          ...formData, date: schedule.date, time: schedule.time, createdAt: new Date().toISOString(), createdBy: user.uid 
        })
      );
      
      await Promise.all(promises);

      setFormData({ ...formData, title: '', description: '', image: '' });
      setSchedules([{ date: '', time: '19:00' }]);
      
      const fileInput = document.getElementById('promo-image-upload');
      if (fileInput) fileInput.value = '';

      setAddSuccess(true);
      setTimeout(() => setAddSuccess(false), 3000);
    } catch (error) { console.error("Error adding document: ", error); }
  };

  const handleDelete = async (id) => {
    if (!user) return;
    try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'monster_tournaments', id)); } 
    catch (error) { console.error("Error deleting document: ", error); }
  };

  const handleAddCategory = async (e) => {
    e.preventDefault();
    if (!user || !newCategoryName.trim()) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'game_categories'), { 
        gameType: newCategoryName.trim(), label: newCategoryName.trim(), color: newCategoryColor, createdAt: new Date().toISOString() 
      });
      setNewCategoryName('');
    } catch (error) { console.error("Error adding category: ", error); }
  };

  const handleDeleteCategory = async (id) => {
    if (!user) return;
    try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'game_categories', id)); } 
    catch (error) { console.error("Error deleting category: ", error); }
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
    } catch (error) { console.error("Error saving reservation: ", error); }
  };

  const handleDeleteReservation = async (id) => {
    if (!user) return;
    try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tutorial_reservations', id)); } 
    catch (error) { console.error("Error deleting reservation: ", error); }
  };

  const handleToggleReservationStatus = async (id, currentStatus) => {
    if (!user) return;
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'tutorial_reservations', id);
      await updateDoc(docRef, { status: currentStatus === 'pending' ? 'completed' : 'pending' });
    } catch (error) { console.error("Error updating reservation status: ", error); }
  };

  // ==========================================
  // UI 輔助元件
  // ==========================================
  const formatEventDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString; // 💡 防呆：如果日期異常，直接回傳原字串避免崩潰
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dayOfWeek = days[date.getDay()];
    return `${month}-${day}(${dayOfWeek})`;
  };

  const renderTextWithLinks = (text) => {
    if (!text) return null;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    
    return text.split(urlRegex).map((part, i) => 
      (part.startsWith('http://') || part.startsWith('https://')) ? (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline break-all font-black" onClick={(e) => e.stopPropagation()}>
          {part}
        </a>
      ) : (
        <span key={i}>{part}</span>
      )
    );
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
    return (
      <span className={`px-2 py-1 text-xs font-black rounded-full text-black shadow-sm ${cat.color}`}>
        {cat.label}
      </span>
    );
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 font-bold">讀取賽事資訊中...🚀</div>;
  }

  return (
    <div className="min-h-screen bg-gray-100 font-sans pb-12">
      {/* 導覽列 */}
      <nav className="bg-orange-600 text-white shadow-lg sticky top-0 z-50">
        <div className="max-w-md mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Store className="w-6 h-6" />
            <h1 className="font-black text-xl tracking-wider">怪獸造咔</h1>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setCurrentView('player')} className={`text-sm px-3 py-1.5 rounded-full font-bold transition-colors ${currentView === 'player' ? 'bg-white text-orange-600' : 'bg-orange-700 hover:bg-orange-800'}`}>玩家看版</button>
            <button onClick={() => setCurrentView('admin')} className={`text-sm px-3 py-1.5 rounded-full font-bold transition-colors ${currentView === 'admin' ? 'bg-white text-orange-600' : 'bg-orange-700 hover:bg-orange-800'}`}>店家後台</button>
          </div>
        </div>
      </nav>

      <main className="max-w-md mx-auto p-4 space-y-6 mt-4">
        
        {/* ========================================== */}
        {/* 玩家看版 (Player View) */}
        {/* ========================================== */}
        {currentView === 'player' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
              <h2 className="text-xl font-black text-gray-800 flex items-center gap-2 mb-2">
                <Swords className="w-6 h-6 text-orange-500" /> 近期熱血賽事 🔥
              </h2>
              <p className="text-sm text-gray-500 flex items-center gap-1"><MapPin className="w-4 h-4" /> 台中市南區光輝街113號</p>
            </div>

            <div className="flex flex-col gap-3">
              
              <div className="relative flex items-center">
                <button 
                  onClick={() => scrollCategories(-200)} 
                  className="absolute left-0 z-10 flex items-center justify-center w-7 h-7 bg-white/95 shadow-[2px_0_8px_rgba(0,0,0,0.1)] rounded-full text-orange-600 border border-gray-100 hover:bg-orange-50 transition-all"
                >
                  <ChevronLeft className="w-4 h-4 -ml-0.5" />
                </button>
                
                <div ref={categoryScrollRef} className="flex gap-2 overflow-x-auto pb-2 pt-1 px-8 scrollbar-hide w-full scroll-smooth">
                  {[{ id: 'All', label: '全部', color: 'bg-white border border-gray-300' }, ...categories.map(c => ({ id: c.gameType, label: c.label, color: c.color || 'bg-gray-200' }))].map(cat => {
                    const isSelected = playerFilters.includes(cat.id);
                    return (
                      <button
                        key={cat.id} 
                        onClick={() => togglePlayerFilter(cat.id)}
                        className={`whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-black transition-all shadow-sm text-black ${cat.color} ${
                          isSelected ? 'ring-2 ring-black ring-offset-1 scale-105 opacity-100' : 'opacity-60 hover:opacity-100'
                        }`}
                      >
                        {cat.label}
                      </button>
                    );
                  })}
                </div>

                <button 
                  onClick={() => scrollCategories(200)} 
                  className="absolute right-0 z-10 flex items-center justify-center w-7 h-7 bg-white/95 shadow-[-2px_0_8px_rgba(0,0,0,0.1)] rounded-full text-orange-600 border border-gray-100 hover:bg-orange-50 transition-all"
                >
                  <ChevronRight className="w-4 h-4 -mr-0.5" />
                </button>
              </div>

              <div className="flex bg-gray-200 p-1 rounded-xl">
                <button onClick={() => setViewMode('list')} className={`flex-1 flex justify-center items-center gap-2 py-2 rounded-lg text-sm font-bold transition-colors ${viewMode === 'list' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><LayoutList className="w-4 h-4" /> 列表</button>
                <button onClick={() => setViewMode('calendar')} className={`flex-1 flex justify-center items-center gap-2 py-2 rounded-lg text-sm font-bold transition-colors ${viewMode === 'calendar' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><Calendar className="w-4 h-4" /> 行事曆</button>
              </div>
            </div>

            {/* 列表模式 (14天精簡流 + 滾動區) */}
            {viewMode === 'list' && (() => {
                const now = new Date();
                const nextWeek = new Date(now);
                nextWeek.setDate(now.getDate() + 14);
                nextWeek.setHours(23, 59, 59, 999);

                const listTournaments = tournaments.filter(t => {
                  const eventDate = new Date(`${t.date}T${t.time}`);
                  return eventDate >= now && eventDate <= nextWeek && (playerFilters.includes('All') || playerFilters.includes(t.gameType));
                });

                return listTournaments.length === 0 ? (
                  <div className="text-center py-12 text-gray-400 font-bold bg-white rounded-2xl border border-gray-200 border-dashed">
                    未來 14 天內沒有即將到來的賽事喔！<br/>可以切換到「行事曆」查看更久之後的安排！😆
                  </div>
                ) : (
                  <div className="space-y-4 max-h-[55vh] overflow-y-auto px-1 py-1 overscroll-contain scrollbar-hide">
                    {listTournaments.map(t => (
                      <div key={t.id} className="bg-white rounded-2xl p-5 shadow-md border-l-4 border-orange-500 relative overflow-hidden transition-transform hover:-translate-y-1">
                        <div className="flex justify-between items-start mb-3">
                          <GameBadge type={t.gameType} />
                          <div className="text-right">
                            <div className="text-orange-600 font-black text-lg">{formatEventDate(t.date)}</div>
                            <div className="text-gray-500 text-sm font-bold">{t.time} 開打</div>
                          </div>
                        </div>
                        <h3 className="text-lg font-black text-gray-800 mb-2">{t.title}</h3>
                        <div className="flex items-center gap-2 text-sm text-gray-600 mb-3 bg-gray-50 p-2 rounded-lg">
                          <Zap className="w-4 h-4 text-yellow-500" /><span className="font-bold">報名費：{t.fee}</span>
                        </div>
                        
                        {(t.image || t.description) && (
                          <div className="mt-1">
                            <button onClick={(e) => toggleNote(e, t.id)} className="w-full text-sm font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 py-2 rounded-xl flex justify-center items-center gap-1 transition-colors border border-orange-100">
                              {expandedNotes[t.id] ? '▲ 收起詳細資訊' : '▼ 詳細資訊點我展開'}
                            </button>
                            {expandedNotes[t.id] && (
                              <div className="mt-3 pt-3 border-t border-gray-100 transition-opacity duration-300">
                                {t.image && (
                                  <div className="mb-3 rounded-lg overflow-hidden border border-gray-100 shadow-sm"><img src={t.image} alt={t.title} className="w-full h-auto object-cover" /></div>
                                )}
                                {t.description && (
                                  <div className="text-sm text-gray-600 whitespace-pre-line">{renderTextWithLinks(t.description)}</div>
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

            {/* 行事曆模式 */}
            {viewMode === 'calendar' && (
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                  <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))} className="p-2 hover:bg-orange-50 rounded-full text-orange-600 transition-colors"><ChevronLeft className="w-5 h-5" /></button>
                  <h3 className="font-black text-lg text-gray-800">{currentMonth.getFullYear()}年 {currentMonth.getMonth() + 1}月</h3>
                  <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))} className="p-2 hover:bg-orange-50 rounded-full text-orange-600 transition-colors"><ChevronRight className="w-5 h-5" /></button>
                </div>
                <div className="grid grid-cols-7 gap-1 mb-2 text-center text-xs font-bold text-gray-400">
                  <div>日</div><div>一</div><div>二</div><div>三</div><div>四</div><div>五</div><div>六</div>
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {(() => {
                    const year = currentMonth.getFullYear(), month = currentMonth.getMonth();
                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                    const firstDay = new Date(year, month, 1).getDay();
                    const cells = [];
                    for (let i = 0; i < firstDay; i++) cells.push(<div key={`empty-${i}`} className="h-10"></div>);
                    for (let d = 1; d <= daysInMonth; d++) {
                      const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                      const dayEvents = tournaments.filter(t => t.date === dateString && (playerFilters.includes('All') || playerFilters.includes(t.gameType)));
                      const isSelected = selectedDate === dateString;
                      const today = new Date();
                      const isToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}` === dateString;

                      cells.push(
                        <button
                          key={dateString} onClick={() => setSelectedDate(isSelected ? null : dateString)}
                          className={`relative h-12 flex flex-col items-center justify-center rounded-xl border transition-all ${isSelected ? 'bg-orange-100 border-orange-500 shadow-inner' : isToday ? 'bg-gray-100 border-gray-300' : 'bg-white border-transparent hover:border-gray-200 hover:bg-gray-50'}`}
                        >
                          <span className={`text-sm font-bold ${dayEvents.length > 0 ? 'text-gray-800' : 'text-gray-400'}`}>{d}</span>
                          {dayEvents.length > 0 && (
                            <div className="flex gap-0.5 mt-1">
                              {dayEvents.slice(0, 3).map((e, i) => {
                                const catColor = categories.find(c => c.gameType === e.gameType)?.color || 'bg-gray-200';
                                return <span key={i} className={`w-1.5 h-1.5 rounded-full ${getDotColor(catColor)}`}></span>;
                              })}
                              {dayEvents.length > 3 && <span className="w-1.5 h-1.5 rounded-full bg-black"></span>}
                            </div>
                          )}
                        </button>
                      );
                    }
                    return cells;
                  })()}
                </div>

                {/* 行事曆下方詳細賽程列表 */}
                {selectedDate && (
                  <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
                    <h4 className="font-bold text-gray-600 text-sm flex items-center gap-2 mb-2">
                      <Calendar className="w-4 h-4 text-orange-500" /> {formatEventDate(selectedDate)} 賽事情報
                    </h4>
                    {tournaments.filter(t => t.date === selectedDate && (playerFilters.includes('All') || playerFilters.includes(t.gameType))).length === 0 ? (
                      <p className="text-sm text-gray-400 font-bold bg-gray-50 p-4 rounded-xl border border-gray-100 text-center">這天目前沒有安排賽事喔！</p>
                    ) : (
                      tournaments.filter(t => t.date === selectedDate && (playerFilters.includes('All') || playerFilters.includes(t.gameType))).map(t => (
                        <div key={t.id} className="p-4 bg-white shadow-md rounded-xl border-l-4 border-l-orange-500 flex flex-col transition-transform hover:-translate-y-0.5">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <GameBadge type={t.gameType} />
                              <div className="font-black text-gray-800 mt-1.5 text-lg leading-tight">{t.title}</div>
                              <div className="text-xs text-gray-500 font-bold mt-1 flex items-center gap-1"><Clock className="w-3 h-3"/> {t.time} 開打</div>
                            </div>
                            <div className="text-xs font-bold text-orange-600 bg-orange-100 border border-orange-200 px-2 py-1 rounded-lg whitespace-nowrap ml-2 shadow-sm">
                              {t.fee}
                            </div>
                          </div>
                          
                          {(t.image || t.description) && (
                            <div className="mt-2">
                              <button onClick={(e) => toggleNote(e, t.id)} className="w-full text-xs font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 py-1.5 rounded-lg flex justify-center items-center gap-1 transition-colors border border-orange-100">
                                {expandedNotes[t.id] ? '▲ 收起詳細資訊' : '▼ 詳細資訊點我展開'}
                              </button>
                              {expandedNotes[t.id] && (
                                <div className="mt-2 pt-2 border-t border-gray-100 transition-opacity duration-300">
                                  {t.image && (
                                    <div className="mb-2 rounded-lg overflow-hidden border border-gray-100 shadow-sm">
                                      <img src={t.image} alt={t.title} className="w-full h-auto object-cover" />
                                    </div>
                                  )}
                                  {t.description && (
                                    <div className="text-xs text-gray-600 whitespace-pre-line">
                                      {renderTextWithLinks(t.description)}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
            
            {/* 新手教學預約區塊 */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-orange-200 relative overflow-hidden mt-8">
              <div className="absolute top-0 right-0 bg-orange-100 text-orange-700 text-xs font-black px-3 py-1.5 rounded-bl-xl shadow-sm">新手專區</div>
              <h2 className="text-xl font-black text-gray-800 flex items-center gap-2 mb-4">
                <BookOpen className="w-6 h-6 text-orange-500" /> 預約新手教學 🎓
              </h2>
              
              <div className="mb-6 space-y-4 bg-orange-50 p-4 rounded-xl border border-orange-100 shadow-sm">
                <div>
                  <p className="text-sm text-gray-800 font-black mb-2 flex items-center gap-1.5">
                    <span className="bg-orange-500 text-white px-2 py-0.5 rounded-md text-xs shadow-sm">1</span> 建議先看影片 📺
                  </p>
                  <a 
                    href="https://lin.ee/n9FQFBB" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 w-full px-4 py-2.5 bg-[#06C755] text-white font-black rounded-xl shadow-sm hover:bg-[#05b34c] hover:-translate-y-0.5 transition-all text-sm"
                  >
                    <MessageCircle className="w-5 h-5" /> 前往 LINE 觀看教學影片
                  </a>
                </div>
                
                <div className="border-t border-orange-200 pt-3">
                  <p className="text-sm text-gray-800 font-black mb-1 flex items-center gap-1.5">
                    <span className="bg-orange-500 text-white px-2 py-0.5 rounded-md text-xs shadow-sm">2</span> 再填表預約 👇
                  </p>
                  <p className="text-xs text-gray-600 font-bold leading-relaxed ml-7">
                    看完有疑問或需要專人說明，請填寫下方表單讓店長為您安排！
                  </p>
                </div>
              </div>
              
              {reserveSuccess ? (
                <div className="bg-green-50 p-4 rounded-xl text-center border border-green-200 shadow-inner animate-pulse">
                  <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
                  <div className="text-green-700 font-black text-lg mb-1">預約已送出！🎉</div>
                  <div className="text-green-600 text-sm font-bold mb-3">請稍候，我們會盡快為您安排教學時間。</div>
                  <div className="bg-white rounded-lg p-3 text-xs text-gray-600 border border-green-100 flex flex-col items-center gap-3">
                    <p>💡 建議您可以先 <span className="font-black text-green-700 text-sm">截圖此畫面</span><br/>然後點擊下方按鈕直接傳送給我們喔！</p>
                    <a 
                      href="https://lin.ee/n9FQFBB" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-[#06C755] text-white font-black rounded-full shadow-md hover:bg-[#05b34c] hover:scale-105 transition-all"
                    >
                      <MessageCircle className="w-4 h-4" /> 前往官方 LINE 傳送截圖
                    </a>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleReserveSubmit} className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">想學哪款遊戲？</label>
                    <select required value={reserveForm.gameType} onChange={(e) => setReserveForm({...reserveForm, gameType: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg bg-gray-50 text-sm font-bold focus:ring-2 focus:ring-orange-500 outline-none">
                      <option value="">請選擇遊戲...</option>
                      {categories.map(cat => <option key={cat.id} value={cat.gameType}>{cat.label}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1">希望日期</label>
                      <input required type="date" value={reserveForm.date} onChange={(e) => setReserveForm({...reserveForm, date: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg bg-gray-50 text-sm font-bold focus:ring-2 focus:ring-orange-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1">希望時間</label>
                      <input required type="time" value={reserveForm.time} onChange={(e) => setReserveForm({...reserveForm, time: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg bg-gray-50 text-sm font-bold focus:ring-2 focus:ring-orange-500 outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1 flex items-center gap-1"><User className="w-3.5 h-3.5"/> 您的 LINE 名稱</label>
                    <input required type="text" placeholder="請輸入您在 LINE 上的顯示名稱" value={reserveForm.name} onChange={(e) => setReserveForm({...reserveForm, name: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg bg-gray-50 text-sm font-bold focus:ring-2 focus:ring-orange-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1 flex items-center gap-1"><Phone className="w-3.5 h-3.5"/> 聯絡方式 (LINE ID 或 電話)</label>
                    <input required type="text" placeholder="方便我們聯繫您的管道" value={reserveForm.contact} onChange={(e) => setReserveForm({...reserveForm, contact: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg bg-gray-50 text-sm font-bold focus:ring-2 focus:ring-orange-500 outline-none" />
                  </div>
                  <button type="submit" className="w-full py-3 bg-orange-600 text-white font-black rounded-xl shadow-md hover:bg-orange-700 transition-colors mt-2">
                    確認送出預約！
                  </button>
                </form>
              )}
            </div>

            <div className="text-center text-xs text-gray-400 mt-8 mb-4">※ 報名請私訊怪獸造咔粉專或現場報名 ※</div>
          </div>
        )}

        {/* ========================================== */}
        {/* 店家後台 (Admin View) */}
        {/* ========================================== */}
        {currentView === 'admin' && (
          <div className="space-y-6">
            
            {/* 店長密碼鎖防護層 */}
            {!isAdminAuth ? (
              <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-200 text-center mt-10">
                <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Lock className="w-8 h-8 text-orange-600" />
                </div>
                <h2 className="text-xl font-black text-gray-800 mb-2">店長專屬後台登入</h2>
                <p className="text-sm text-gray-500 mb-6 font-bold">請輸入專屬密碼以管理怪獸造咔賽事</p>
                <form onSubmit={handleAdminLogin}>
                  <input 
                    type="password" 
                    placeholder="請輸入店長密碼..." 
                    className={`w-full p-3 border rounded-xl text-center font-bold focus:outline-none focus:ring-2 focus:ring-orange-500 transition-colors ${pwdError ? 'border-red-500 bg-red-50' : 'border-gray-300 bg-gray-50'}`}
                    value={passwordInput}
                    onChange={(e) => {
                      setPasswordInput(e.target.value);
                      setPwdError(false); 
                    }}
                  />
                  {pwdError && <p className="text-red-500 text-xs mt-2 font-bold animate-pulse">密碼錯誤，請重新輸入！</p>}
                  <button type="submit" className="w-full mt-4 py-3 bg-orange-600 text-white font-black rounded-xl shadow-md hover:bg-orange-700 transition-colors">
                    登入後台
                  </button>
                </form>
              </div>
            ) : (
              /* ===== 登入成功後的管理畫面 ===== */
              <>
                <div className="flex justify-between items-center bg-orange-100 p-4 rounded-2xl border border-orange-200">
                  <span className="font-black text-orange-800 flex items-center gap-2">
                    <Store className="w-5 h-5" /> 歡迎回來，店長！
                  </span>
                  <button 
                    onClick={() => setIsAdminAuth(false)} 
                    className="text-xs font-bold bg-white text-orange-600 px-3 py-1.5 rounded-lg shadow-sm hover:bg-orange-50 flex items-center gap-1 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" /> 登出
                  </button>
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
                        <button onClick={() => handleDeleteCategory(cat.id)} className="p-1 text-black/50 hover:text-black hover:bg-black/10 rounded-md transition-colors" title="刪除分類">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {categories.length === 0 && <span className="text-sm text-gray-400 font-bold">目前無自訂分類，請在下方新增👇</span>}
                  </div>

                  <form onSubmit={handleAddCategory} className="flex flex-col sm:flex-row gap-2 items-end border-t border-gray-100 pt-4">
                    <div className="flex-1 w-full sm:w-auto">
                      <label className="block text-xs font-bold text-gray-500 mb-1">遊戲名稱</label>
                      <input required type="text" placeholder="例如: 航海王" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50 text-black font-bold" />
                    </div>
                    <div className="w-full sm:w-32">
                      <label className="block text-xs font-bold text-gray-500 mb-1">底色(黑字展示)</label>
                      <select value={newCategoryColor} onChange={e => setNewCategoryColor(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50 font-bold">
                        <option value="bg-red-200">🔴 紅色</option>
                        <option value="bg-orange-200">🟠 橙色</option>
                        <option value="bg-yellow-200">🟡 黃色</option>
                        <option value="bg-green-200">🟢 綠色</option>
                        <option value="bg-blue-200">🔵 藍色</option>
                        <option value="bg-indigo-200">🟣 靛色</option>
                        <option value="bg-purple-200">🟪 紫色</option>
                        <option value="bg-gray-400">⚫ 黑色(深灰)</option>
                        <option value="bg-white border border-gray-300">⚪ 白色</option>
                      </select>
                    </div>
                    <button type="submit" className="w-full sm:w-auto px-4 py-2 bg-orange-100 text-orange-700 hover:bg-orange-200 font-bold rounded-lg transition-colors whitespace-nowrap">
                      新增分類
                    </button>
                  </form>
                </div>

                {/* 新增賽事區塊 */}
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
                  <h2 className="text-xl font-black text-gray-800 mb-4 flex items-center gap-2">
                    <Plus className="w-6 h-6 text-orange-500" /> 新增賽事情報
                  </h2>

                  <form onSubmit={handleAddTournament} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-600 mb-1">遊戲種類</label>
                        <select 
                          className="w-full p-2 border border-gray-300 rounded-lg bg-gray-50 text-sm focus:ring-2 focus:ring-orange-500 outline-none font-bold"
                          value={formData.gameType} onChange={(e) => setFormData({...formData, gameType: e.target.value})}
                        >
                          {categories.length === 0 && <option value="">請先建立分類</option>}
                          {categories.map(cat => <option key={cat.id} value={cat.gameType}>{cat.label}</option>)}
                          {formData.gameType && !categories.find(c => c.gameType === formData.gameType) && <option value={formData.gameType}>{formData.gameType}</option>}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-600 mb-1">賽事名稱</label>
                        <input required type="text" placeholder="例如：週末奪包賽" className="w-full p-2 border border-gray-300 rounded-lg bg-gray-50 text-sm focus:ring-2 focus:ring-orange-500 outline-none font-bold" value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} />
                      </div>
                    </div>

                    <div className="bg-orange-50 p-3 rounded-xl border border-orange-100 shadow-inner">
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-xs font-black text-orange-800">🗓️ 開賽日期與時間 (可一次新增多筆)</label>
                        <button type="button" onClick={() => setSchedules([...schedules, { date: '', time: '19:00' }])} className="text-xs font-bold text-orange-600 bg-white px-2 py-1 rounded shadow-sm border border-orange-200 hover:bg-orange-100 flex items-center gap-1 transition-colors">
                          <Plus className="w-3 h-3" /> 新增場次
                        </button>
                      </div>
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                        {schedules.map((sch, index) => (
                          <div key={index} className="flex gap-2 items-center">
                            <input required type="date" className="flex-1 p-2 border border-gray-300 rounded-lg bg-white text-sm focus:ring-2 focus:ring-orange-500 outline-none font-bold" value={sch.date} onChange={(e) => {
                              const newSch = [...schedules];
                              newSch[index] = { ...newSch[index], date: e.target.value };
                              setSchedules(newSch);
                            }} />
                            <input required type="time" className="w-28 p-2 border border-gray-300 rounded-lg bg-white text-sm focus:ring-2 focus:ring-orange-500 outline-none font-bold" value={sch.time} onChange={(e) => {
                              const newSch = [...schedules];
                              newSch[index] = { ...newSch[index], time: e.target.value };
                              setSchedules(newSch);
                            }} />
                            {schedules.length > 1 && (
                              <button type="button" onClick={() => {
                                const newSch = schedules.filter((_, i) => i !== index);
                                setSchedules(newSch);
                              }} className="p-2 text-red-400 hover:text-red-600 transition-colors bg-white rounded-lg border border-red-100 hover:border-red-200 shadow-sm" title="移除此場次">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1">報名費/方案</label>
                      <input required type="text" placeholder="例如：200元 或 買2包" className="w-full p-2 border border-gray-300 rounded-lg bg-gray-50 text-sm focus:ring-2 focus:ring-orange-500 outline-none font-bold" value={formData.fee} onChange={(e) => setFormData({...formData, fee: e.target.value})} />
                    </div>

                    <div>
                      <label className="block text-xs font-black text-gray-600 mb-1">備註</label>
                      
                      <div className="mb-2 p-3 bg-orange-50 border border-orange-100 rounded-lg shadow-inner">
                        <div className="text-xs font-bold text-orange-800 mb-2 flex items-center gap-1">
                          <BookmarkPlus className="w-4 h-4"/> 快捷備註模板
                        </div>
                        
                        {notePresets.length > 0 ? (
                          <div className="flex flex-wrap gap-2 mb-3">
                            {notePresets.map(p => (
                              <div key={p.id} className="flex items-center gap-1 bg-white border border-orange-200 rounded px-2 py-1 shadow-sm">
                                <button type="button" onClick={() => setFormData({...formData, description: p.content})} className="text-xs font-bold text-gray-700 hover:text-orange-600 transition-colors" title="點擊帶入此模板">
                                  {p.title}
                                </button>
                                <button type="button" onClick={() => handleDeletePreset(p.id)} className="text-red-400 hover:text-red-600 ml-1 transition-colors" title="刪除模板">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs font-bold text-orange-600/70 mb-3">目前沒有儲存的模板喔！在下方輸入備註後即可存為模板。</p>
                        )}

                        <div className="flex flex-col sm:flex-row gap-2">
                          <input type="text" placeholder="替目前的備註命名 (如: 寶可夢奪包賽)" className="flex-1 p-2 text-xs font-bold border border-orange-200 rounded-lg outline-none focus:ring-2 focus:ring-orange-500" value={newPresetTitle} onChange={(e) => setNewPresetTitle(e.target.value)} />
                          <button type="button" onClick={handleSavePreset} className="px-3 py-2 bg-orange-500 text-white text-xs font-bold rounded-lg shadow-sm hover:bg-orange-600 transition-colors whitespace-nowrap">
                            儲存當前備註為模板
                          </button>
                        </div>
                      </div>

                      <textarea 
                        rows="4" placeholder="填寫獎勵內容、賽制說明..."
                        className="w-full p-2 border border-gray-300 rounded-lg bg-gray-50 text-sm focus:ring-2 focus:ring-orange-500 outline-none resize-none font-bold"
                        value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1 flex items-center gap-1">
                        <ImageIcon className="w-4 h-4 text-orange-500" /> 上傳宣傳圖
                      </label>
                      <input id="promo-image-upload" type="file" accept="image/*" onChange={handleImageUpload} className="w-full p-2 border border-gray-300 rounded-lg bg-gray-50 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-bold file:bg-orange-100 file:text-orange-700 hover:file:bg-orange-200 cursor-pointer outline-none transition-colors" />
                      {formData.image && (
                        <div className="mt-3 relative inline-block">
                          <img src={formData.image} alt="宣傳圖預覽" className="h-32 w-auto rounded-lg border border-gray-200 shadow-sm" />
                          <button type="button" onClick={() => setFormData({...formData, image: ''})} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-colors"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      )}
                    </div>

                    <button type="submit" className="w-full py-3 bg-orange-600 text-white font-black rounded-xl shadow-md hover:bg-orange-700 transition-colors flex justify-center items-center gap-2">
                      <Plus className="w-5 h-5" /> 發布賽事！
                    </button>
                  </form>
                </div>

                {/* 賽事管理行事曆 */}
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
                  <h2 className="text-xl font-black text-gray-800 mb-4 flex items-center gap-2">
                    <Calendar className="w-6 h-6 text-orange-500" /> 賽事行事曆管理
                  </h2>

                  <div className="flex justify-between items-center mb-4 bg-gray-50 rounded-xl p-2 border border-gray-100">
                    <button onClick={() => setAdminMonth(new Date(adminMonth.getFullYear(), adminMonth.getMonth() - 1, 1))} className="p-2 hover:bg-orange-100 rounded-full text-orange-600 transition-colors"><ChevronLeft className="w-5 h-5" /></button>
                    <h3 className="font-black text-lg text-gray-800">{adminMonth.getFullYear()}年 {adminMonth.getMonth() + 1}月</h3>
                    <button onClick={() => setAdminMonth(new Date(adminMonth.getFullYear(), adminMonth.getMonth() + 1, 1))} className="p-2 hover:bg-orange-100 rounded-full text-orange-600 transition-colors"><ChevronRight className="w-5 h-5" /></button>
                  </div>

                  <div className="grid grid-cols-7 gap-1 mb-2 text-center text-xs font-bold text-gray-400">
                    <div>日</div><div>一</div><div>二</div><div>三</div><div>四</div><div>五</div><div>六</div>
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {(() => {
                      const year = adminMonth.getFullYear(), month = adminMonth.getMonth();
                      const daysInMonth = new Date(year, month + 1, 0).getDate();
                      const firstDay = new Date(year, month, 1).getDay();
                      const cells = [];
                      for (let i = 0; i < firstDay; i++) cells.push(<div key={`empty-${i}`} className="h-10"></div>);
                      for (let d = 1; d <= daysInMonth; d++) {
                        const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                        const dayEvents = tournaments.filter(t => t.date === dateString);
                        const isSelected = adminSelectedDate === dateString;
                        const today = new Date();
                        const isToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}` === dateString;

                        cells.push(
                          <button
                            key={dateString} onClick={() => setAdminSelectedDate(isSelected ? null : dateString)}
                            className={`relative h-12 flex flex-col items-center justify-center rounded-xl border transition-all ${isSelected ? 'bg-orange-100 border-orange-500 shadow-inner' : isToday ? 'bg-gray-100 border-gray-300' : 'bg-white border-transparent hover:border-gray-200 hover:bg-gray-50'}`}
                          >
                            <span className={`text-sm font-bold ${dayEvents.length > 0 ? 'text-gray-800' : 'text-gray-400'}`}>{d}</span>
                            {dayEvents.length > 0 && (
                              <div className="flex gap-0.5 mt-1">
                                {dayEvents.slice(0, 3).map((e, i) => {
                                  const catColor = categories.find(c => c.gameType === e.gameType)?.color || 'bg-gray-200';
                                  return <span key={i} className={`w-1.5 h-1.5 rounded-full ${getDotColor(catColor)}`}></span>;
                                })}
                                {dayEvents.length > 3 && <span className="w-1.5 h-1.5 rounded-full bg-black"></span>}
                              </div>
                            )}
                          </button>
                        );
                      }
                      return cells;
                    })()}
                  </div>

                  {adminSelectedDate ? (
                    <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                      <h4 className="font-bold text-gray-600 text-sm flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-orange-500" /> {formatEventDate(adminSelectedDate)} 管理清單
                      </h4>
                      {tournaments.filter(t => t.date === adminSelectedDate).length === 0 ? (
                        <p className="text-sm text-gray-400 font-bold bg-gray-50 p-4 rounded-xl border border-gray-100 text-center">這天目前沒有安排賽事喔！</p>
                      ) : (
                        tournaments.filter(t => t.date === adminSelectedDate).map(t => (
                          <div key={t.id} className="p-3 bg-white shadow-sm rounded-xl border border-red-100 flex flex-col transition-colors hover:border-red-300">
                            <div className="flex justify-between items-start">
                              <div>
                                <GameBadge type={t.gameType} />
                                <div className="font-black text-gray-800 mt-1">{t.title}</div>
                                <div className="text-xs text-gray-500 font-bold">{t.time} 開打</div>
                              </div>
                              <button onClick={() => handleDelete(t.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0 ml-2 border border-transparent hover:border-red-200" title="刪除賽事">
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </div>
                            
                            {(t.image || t.description) && (
                              <div className="mt-2">
                                <button onClick={(e) => toggleNote(e, t.id)} className="w-full text-xs font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 py-1.5 rounded-lg flex justify-center items-center gap-1 transition-colors border border-orange-100">
                                  {expandedNotes[t.id] ? '▲ 收起詳細資訊' : '▼ 詳細資訊點我展開'}
                                </button>
                                {expandedNotes[t.id] && (
                                  <div className="mt-2 pt-2 border-t border-gray-100 transition-opacity duration-300">
                                    {t.image && (
                                      <div className="mb-2 rounded-lg overflow-hidden border border-gray-100 shadow-sm">
                                        <img src={t.image} alt={t.title} className="w-full h-auto object-cover" />
                                      </div>
                                    )}
                                    {t.description && (
                                      <div className="text-xs text-gray-600 whitespace-pre-line">
                                        {renderTextWithLinks(t.description)}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    <div className="mt-4 pt-4 border-t border-gray-100 text-center text-sm font-bold text-gray-400 bg-gray-50 p-3 rounded-xl border-dashed">
                      👆 點擊上方日期來管理該日賽事
                    </div>
                  )}
                </div>

                {/* 新手教學預約清單 (後台) */}
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-orange-200 mt-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 bg-orange-100 text-orange-700 text-xs font-black px-3 py-1.5 rounded-bl-xl shadow-sm">後台專屬</div>
                  <h2 className="text-xl font-black text-gray-800 flex items-center gap-2 mb-4">
                    <BookOpen className="w-6 h-6 text-orange-500" /> 新手教學預約清單 🎓
                  </h2>
                  
                  <div className="space-y-3">
                    {reservations.length === 0 ? (
                      <div className="text-center py-6 text-gray-400 font-bold bg-gray-50 rounded-xl border border-gray-200 border-dashed">
                        目前還沒有預約喔！
                      </div>
                    ) : (
                      reservations.map(res => (
                        <div key={res.id} className={`p-4 rounded-xl border transition-colors ${res.status === 'completed' ? 'bg-gray-50 border-gray-200 opacity-60' : 'bg-white border-orange-200 shadow-sm border-l-4 border-l-orange-500'}`}>
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2">
                              <GameBadge type={res.gameType} />
                              <span className={`text-xs font-bold px-2 py-0.5 rounded ${res.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {res.status === 'completed' ? '✅ 已處理' : '🚨 待聯絡'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button onClick={() => handleToggleReservationStatus(res.id, res.status)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-md transition-colors font-bold text-xs border border-transparent hover:border-blue-200" title="切換處理狀態">
                                切換狀態
                              </button>
                              <button onClick={() => handleDeleteReservation(res.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-md transition-colors" title="刪除預約單">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div className="text-gray-800 font-black"><span className="text-gray-500 text-xs block">👤 LINE 名稱</span>{res.name}</div>
                            <div className="text-gray-800 font-black"><span className="text-gray-500 text-xs block">📱 聯絡方式</span>{res.contact}</div>
                            <div className="text-gray-800 font-black col-span-2"><span className="text-gray-500 text-xs block">🗓️ 期望時間</span>{res.date} {res.time}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
