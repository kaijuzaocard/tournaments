import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { Calendar, Clock, MapPin, Plus, Trash2, Trophy, Swords, Zap, Store, Image as ImageIcon, ChevronLeft, ChevronRight, LayoutList, Tags, BookmarkPlus, BookOpen, User, Phone, CheckCircle2, MessageCircle, Lock, LogOut, Edit, X, Save, Sparkles, UploadCloud, Gift, Send, AlertCircle, ZoomIn, ExternalLink } from 'lucide-react';

// ==========================================
// Firebase 與 LINE 配置 (資料庫與報信核心)
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

  // 載入文案輪播
  const loadingMessages = ["🚀 連接光輝街基地...", "🦖 抓取野比賽中...", "✨ 召喚光之巨人...", "🎁 整理卡包獎勵...", "🔥 準備開戰！"];
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);

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
  const [categories, setCategories] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [reserveForm, setReserveForm] = useState({ gameType: '', date: '', time: '', name: '', contact: '' });
  const [reserveSuccess, setReserveSuccess] = useState(false);

  // Banner 與圖片狀態
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
  // ✨ 報信引擎：發送 LINE 通知
  // ------------------------------------------
  const sendLineNotification = async (data, isTest = false) => {
    setIsSendingLine(true);
    const content = isTest 
      ? "✅ 怪獸造咔通訊診斷：連線成功！報信雷達已就緒！🚀" 
      : `🚨 【怪獸造咔－新預約】 🚨\n🎮 遊戲：${data.gameType}\n👤 暱稱：${data.name}\n🗓️ 時間：${data.date} ${data.time}\n📱 聯絡：${data.contact}\n---------------------------\n💡 請店長盡快確認預約喔！`;
    
    const targetUrl = "https://api.line.me/v2/bot/message/push";
    const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`;

    try {
      const response = await fetch(proxyUrl, {
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

      if (!response.ok) throw new Error(`LINE伺服器回報錯誤 (${response.status})`);
      if (isTest) alert("🎉 診斷成功！請檢查 LINE 群組。");
    } catch (err) {
      console.error("LINE Notify Error:", err);
      if (isTest) alert("❌ 發送失敗！錯誤詳情：" + err.message);
    } finally {
      setIsSendingLine(false);
    }
  };

  // ------------------------------------------
  // 核心生命週期與資料抓取
  // ------------------------------------------
  useEffect(() => {
    if (!isLoading) return;
    const interval = setInterval(() => setLoadingMsgIdx(prev => (prev + 1) % loadingMessages.length), 800);
    return () => clearInterval(interval);
  }, [isLoading]);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) await signInWithCustomToken(auth, __initial_auth_token);
        else await signInAnonymously(auth); 
      } catch (e) { setIsLoading(false); }
    };
    initAuth();
    onAuthStateChanged(auth, (currentUser) => { setUser(currentUser); if (!currentUser) setIsLoading(false); });
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const getPath = (name) => collection(db, 'artifacts', appId, 'public', 'data', name);
    const unsubs = [
      onSnapshot(getPath('monster_tournaments'), (snap) => {
        const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        data.sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`));
        setTournaments(data); setIsLoading(false);
      }),
      onSnapshot(getPath('game_categories'), (snap) => {
        const cats = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setCategories(cats);
        if (cats.length > 0 && !reserveForm.gameType) setReserveForm(prev => ({ ...prev, gameType: cats[0].gameType }));
      }),
      onSnapshot(getPath('tutorial_reservations'), (snap) => setReservations(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)))),
      onSnapshot(getPath('tutorial_banners'), (snap) => setTutorialBanners(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))))
    ];
    return () => unsubs.forEach(unsub => unsub());
  }, [user, reserveForm.gameType]);

  const handleReserveSubmit = async (e) => {
    e.preventDefault();
    if (!user || !reserveForm.name || !reserveForm.contact) return;
    try {
      const finalReserve = { ...reserveForm, gameType: reserveForm.gameType || (categories[0]?.gameType || '未指定'), status: 'pending', createdAt: new Date().toISOString() };
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'tutorial_reservations'), finalReserve);
      await sendLineNotification(finalReserve); 
      setReserveSuccess(true);
      setReserveForm(prev => ({ ...prev, date: '', time: '', name: '', contact: '' }));
      setTimeout(() => setReserveSuccess(false), 8000); 
    } catch (e) { console.error(e); }
  };

  const toggleNote = (e, id) => { e.preventDefault(); e.stopPropagation(); setExpandedNotes(prev => ({ ...prev, [id]: !prev[id] })); };

  const formatEventDate = (dateString) => {
    if (!dateString) return ''; const date = new Date(dateString); if (isNaN(date.getTime())) return dateString; 
    const days = ['日', '一', '二', '三', '四', '五', '六']; return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}(${days[date.getDay()]})`;
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
          <><button onClick={(e) => { e.stopPropagation(); setCurrentImgIdx(p => ({...p, [tournament.id]: (safeIdx-1+imgs.length)%imgs.length})); }} className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 text-white p-1.5 rounded-full"><ChevronLeft className="w-5 h-5" /></button><button onClick={(e) => { e.stopPropagation(); setCurrentImgIdx(p => ({...p, [tournament.id]: (safeIdx+1)%imgs.length})); }} className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 text-white p-1.5 rounded-full"><ChevronRight className="w-5 h-5" /></button></>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6">
        <div className="w-16 h-16 border-4 border-orange-200 border-t-orange-600 rounded-full animate-spin mb-6 shadow-md"></div>
        <p className="text-orange-600 font-black text-lg animate-pulse tracking-wide">{loadingMessages[loadingMsgIdx]}</p>
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
            {/* 熱血賽事標題 */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
              <h2 className="text-xl font-black text-gray-800 flex items-center gap-2 mb-2"><Swords className="w-6 h-6 text-orange-500" /> 近期熱血賽事 🔥</h2>
              <p className="text-sm text-gray-500 font-bold flex items-center gap-1"><MapPin className="w-4 h-4" /> 台中市南區光輝街113號</p>
            </div>

            {/* 列表模式與日曆切換 */}
            <div className="flex bg-gray-200 p-1.5 rounded-xl">
              <button onClick={() => setViewMode('list')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'list' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}>列表</button>
              <button onClick={() => setViewMode('calendar')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'calendar' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}>日曆</button>
            </div>

            {viewMode === 'list' ? (
              <div className="space-y-4 max-h-[60vh] overflow-y-auto px-1 py-1 scrollbar-hide">
                {tournaments.length === 0 ? <div className="text-center py-10 text-gray-400 font-bold">目前無安排賽事喔！😆</div> : tournaments.map(t => (
                  <div key={t.id} className="bg-white rounded-2xl p-5 shadow-md border-l-4 border-orange-500 hover:-translate-y-1 transition-all">
                    <div className="flex justify-between items-start mb-3">
                      <GameBadge type={t.gameType} /><div className="text-orange-600 font-black text-lg">{formatEventDate(t.date)}</div>
                    </div>
                    <h3 className="text-lg font-black text-gray-800 mb-2">{t.title}</h3>
                    <div className="text-sm text-gray-500 font-bold mb-3 flex items-center gap-1"><Clock className="w-4 h-4"/> {t.time} 開打 | 費用：{t.fee}</div>
                    <button type="button" onClick={(e) => toggleNote(e, t.id)} className="w-full text-xs font-black text-orange-600 bg-orange-50 py-2.5 rounded-xl border border-orange-100 active:scale-95 transition-all">{expandedNotes[t.id] ? '▲ 收起詳情' : '▼ 查看獎品與賽制'}</button>
                    {expandedNotes[t.id] && (<div className="mt-3 pt-3 border-t border-gray-100 animate-in slide-in-from-top-2 duration-300"><ImageCarousel tournament={t} /><div className="text-sm font-bold text-gray-600 whitespace-pre-line leading-relaxed">{t.description}</div></div>)}
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-2xl p-10 shadow-sm border border-gray-200 text-center text-gray-400 font-bold">日曆系統即將上線！📅</div>
            )}
            
            {/* 新手預約區塊 */}
            <div id="tutorial-section" className="bg-white rounded-2xl p-5 shadow-sm border border-orange-200 mt-8 relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-orange-100 text-orange-700 text-[10px] font-black px-3 py-1.5 rounded-bl-xl">新手福利區</div>
              <h2 className="text-xl font-black text-gray-800 flex items-center gap-2 mb-4"><BookOpen className="w-6 h-6 text-orange-500" /> 預約新手教學 🎓</h2>
              
              <div className="bg-orange-50 p-5 rounded-xl border border-orange-100">
                {reserveSuccess ? (
                  <div className="text-center p-4 animate-bounce"><CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-2"/><p className="font-black text-green-700 text-lg">預約已送出！<br/>店內群組已叮咚店長！🚀</p></div>
                ) : (
                  <form onSubmit={handleReserveSubmit} className="space-y-4">
                    <div><label className="text-xs font-bold text-gray-500 block mb-1">想學哪款遊戲？</label><select required value={reserveForm.gameType} onChange={e => setReserveForm({...reserveForm, gameType: e.target.value})} className="w-full p-3 border rounded-xl font-bold bg-white focus:ring-2 focus:ring-orange-500 outline-none">{categories.map(c => <option key={c.id} value={c.gameType}>{c.label}</option>)}</select></div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="text-xs font-bold text-gray-500 block mb-1">期望日期</label><input required type="date" value={reserveForm.date} onChange={e => setReserveForm({...reserveForm, date: e.target.value})} className="w-full p-3 border rounded-xl font-bold outline-none" /></div>
                      <div><label className="text-xs font-bold text-gray-500 block mb-1">期望時間</label><input required type="time" value={reserveForm.time} onChange={e => setReserveForm({...reserveForm, time: e.target.value})} className="w-full p-3 border rounded-xl font-bold outline-none" /></div>
                    </div>
                    <div><label className="text-xs font-bold text-gray-500 block mb-1">您的暱稱</label><input required placeholder="怎麼稱呼您呢" value={reserveForm.name} onChange={e => setReserveForm({...reserveForm, name: e.target.value})} className="w-full p-3 border rounded-xl font-bold outline-none" /></div>
                    <div><label className="text-xs font-bold text-gray-500 block mb-1">聯絡方式</label><input required placeholder="LINE ID 或 手機號碼" value={reserveForm.contact} onChange={e => setReserveForm({...reserveForm, contact: e.target.value})} className="w-full p-3 border rounded-xl font-bold outline-none" /></div>
                    <button type="submit" disabled={isSendingLine} className="w-full py-4 bg-orange-600 text-white font-black rounded-xl shadow-md active:scale-95 transition-all text-lg flex items-center justify-center gap-2">{isSendingLine ? '正在發報通知...' : '送出預約並叮咚店長！🚀'}</button>
                  </form>
                )}
              </div>
            </div>
            <p className="text-center text-[10px] font-bold text-gray-400 mt-6 tracking-widest">※ 報名比賽請私訊粉專或現場報名 ※</p>
          </div>
        )}

        {currentView === 'admin' && (
          <div className="space-y-6">
            {!isAdminAuth ? (
              <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-200 text-center mt-10"><h2 className="text-2xl font-black text-gray-800 mb-6 flex items-center justify-center gap-2"><Lock className="w-6 h-6 text-orange-600" /> 店長管理登入</h2><form onSubmit={(e) => { e.preventDefault(); if (passwordInput === 'monster113') setIsAdminAuth(true); else setPwdError(true); setPasswordInput(''); }} className="space-y-4"><input type="password" placeholder="請輸入店長密碼..." className={`w-full p-4 border rounded-xl text-center font-bold outline-none ${pwdError ? 'border-red-500 bg-red-50' : 'bg-gray-50'}`} value={passwordInput} onChange={e => setPasswordInput(e.target.value)} />{pwdError && <p className="text-red-500 text-xs font-bold animate-pulse">密碼錯誤，請重新確認！</p>}<button type="submit" className="w-full py-4 bg-orange-600 text-white font-black rounded-xl shadow-md">登入基地後台</button></form></div>
            ) : (
              <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
                <div className="flex justify-between items-center bg-orange-100 p-5 rounded-2xl border border-orange-200"><span className="font-black text-orange-800 text-lg flex items-center gap-2"><Store className="w-6 h-6" /> 店長管理模式</span><button onClick={() => setIsAdminAuth(false)} className="bg-white text-orange-600 p-2 rounded-xl shadow-sm hover:bg-orange-50 transition-colors"><LogOut className="w-5 h-5" /></button></div>
                
                {/* 💡 通訊診斷中心 */}
                <div className="bg-green-600 text-white p-5 rounded-2xl shadow-md font-black flex flex-col gap-3">
                  <div className="flex items-center justify-between"><span className="text-lg flex items-center gap-2"><Send className="w-5 h-5" /> LINE 預約雷達診斷</span><button onClick={() => sendLineNotification({}, true)} disabled={isSendingLine} className="bg-white text-green-700 px-4 py-2 rounded-xl text-xs shadow-sm active:scale-95 transition-all">{isSendingLine ? '診斷中...' : '發送診斷測試訊息'}</button></div>
                  <p className="text-[10px] opacity-80 leading-relaxed">※ 若發送失敗，請確認 Token 鑰匙是否複製完整，且機器人已加入群組。</p>
                </div>

                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 text-center py-10 text-gray-400 font-bold flex flex-col items-center gap-3"><Plus className="w-10 h-10 opacity-20" /> 賽事與預約管理系統<br/>資料庫已就緒，請店長放心管理！</div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* 🔍 全域放大視窗 */}
      {fullscreenImage && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-in fade-in" onClick={() => setFullscreenImage(null)}>
          <button className="absolute top-6 right-6 text-white bg-white/10 p-2 rounded-full"><X className="w-8 h-8" /></button>
          <img src={fullscreenImage} className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl animate-in zoom-in-95" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
