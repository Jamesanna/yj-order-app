import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Utensils, Coffee, Users, ShoppingCart, User, Settings, 
  LogOut, Plus, Trash2, Edit, Save, X, Image as ImageIcon, 
  ChevronLeft, ChevronRight, Download, Upload, Shield, 
  CheckCircle, AlertCircle, Clock, DollarSign, Menu, List,
  Key, Megaphone, Bell, Calendar, CheckSquare, Square, FileSpreadsheet, Filter,
  LayoutGrid
} from 'lucide-react';

// Firebase Imports
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  signInWithCustomToken
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  where, 
  onSnapshot, 
  serverTimestamp,
  orderBy
} from 'firebase/firestore';

// --- Global Setup & Helpers ---

// 1. 設定檔 (請放在最上面)
const firebaseConfig = {
  apiKey: "AIzaSyDRS1zLZ9HEY0B6d0Huo3pbqdmR49LwAVI",
  authDomain: "yj-order-system.firebaseapp.com",
  projectId: "yj-order-system",
  storageBucket: "yj-order-system.firebasestorage.app",
  messagingSenderId: "568496529184",
  appId: "1:568496529184:web:a17f23c3e960e0a4da0145"
};

// 2. 啟動 Firebase (這三行必須存在，且不能被註解掉！)
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 3. 設定 App ID
const appId = 'yj-order-system';


// Utility: Dynamic Script Loader for JSZip
const loadJSZip = () => {
  return new Promise((resolve, reject) => {
    if (window.JSZip) return resolve(window.JSZip);
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    script.onload = () => resolve(window.JSZip);
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

// Utility: Date Formatting
const getTodayStr = () => new Date().toISOString().split('T')[0];
const formatCurrency = (num) => new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', minimumFractionDigits: 0 }).format(num);

// Utility: Get Date Ranges
const getDateRange = (type) => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  switch(type) {
    case 'today':
      return { start: today, end: today };
    case 'yesterday':
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const yStr = y.toISOString().split('T')[0];
      return { start: yStr, end: yStr };
    case 'week':
      const first = now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1); // Monday
      const last = first + 6; // Sunday
      const firstDay = new Date(now.setDate(first)).toISOString().split('T')[0];
      const lastDay = new Date(now.setDate(last)).toISOString().split('T')[0];
      return { start: firstDay, end: lastDay };
    case 'month':
      const firstMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const lastMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
      return { start: firstMonth, end: lastMonth };
    case 'year':
      const firstYear = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
      const lastYear = new Date(now.getFullYear(), 11, 31).toISOString().split('T')[0];
      return { start: firstYear, end: lastYear };
    default:
      return { start: today, end: today };
  }
};

// Utility: Image Compression to Base64 (to fit Firestore 1MB limit)
// Modified: Added maxSize parameter and smart scaling logic (Long edge limit)
const compressImage = (file, maxSize = 800) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        
        let width = img.width;
        let height = img.height;

        // Smart resize: Constrain the longest side to maxSize
        if (width > height) {
          if (width > maxSize) {
            height = Math.round(height * (maxSize / width));
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = Math.round(width * (maxSize / height));
            height = maxSize;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7)); // Compress to JPEG 70%
      };
    };
  });
};

// --- Main Application Component ---
export default function App() {
  // --- Global State ---
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState(null); // { type: 'success'|'error', msg: '' }

  // --- Data State ---
  const [orders, setOrders] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [announcements, setAnnouncements] = useState([]); // 新增公告資料

  // --- UI State ---
  const [viewMode, setViewMode] = useState('user'); // 'user' or 'admin'
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [adminUser, setAdminUser] = useState(null); // Current admin info
  
  // --- Auth & Initial Load ---
  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });

    // Check Storage for Admin Persistence (Local or Session)
    const savedAdmin = localStorage.getItem('yj_admin_session') || sessionStorage.getItem('yj_admin_session');
    if (savedAdmin) {
      try {
        const parsed = JSON.parse(savedAdmin);
        // Simple expiry check (24 hours)
        if (new Date().getTime() - parsed.timestamp < 86400000) {
          setIsAdminLoggedIn(true);
          setAdminUser(parsed.user);
          setViewMode('admin');
        }
      } catch (e) { 
        localStorage.removeItem('yj_admin_session');
        sessionStorage.removeItem('yj_admin_session');
      }
    }

    return () => unsubscribe();
  }, []);

  // --- Firestore Listeners ---
  useEffect(() => {
    if (!user) return;

    // Listeners for public data
    const unsubOrders = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'orders'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setOrders(list);
    }, (err) => console.error("Orders sync error", err));

    const unsubMenu = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'menuItems'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setMenuItems(list);
    }, (err) => console.error("Menu sync error", err));

    const unsubUsers = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'usersList'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sort users by name for easier finding
      list.sort((a, b) => a.name.localeCompare(b.name, 'zh-hant'));
      setUsersList(list);
    }, (err) => console.error("Users sync error", err));

    const unsubAdmins = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'adminUsers'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAdmins(list);
    }, (err) => console.error("Admins sync error", err));

    // 新增：公告監聽
    const unsubAnnouncements = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'announcements'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // 依照建立時間排序 (新到舊)
      list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setAnnouncements(list);
    }, (err) => console.error("Announcements sync error", err));

    return () => {
      unsubOrders();
      unsubMenu();
      unsubUsers();
      unsubAdmins();
      unsubAnnouncements();
    };
  }, [user]);

  // --- Notification Helper ---
  const showNotify = (type, msg) => {
    setNotification({ type, msg });
    setTimeout(() => setNotification(null), 3000);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-100 text-slate-500">系統載入中...</div>;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      {/* --- Notification Toast --- */}
      {notification && (
        <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 text-white animate-fade-in-down ${notification.type === 'error' ? 'bg-red-500' : 'bg-green-600'}`}>
          {notification.type === 'error' ? <AlertCircle size={20} /> : <CheckCircle size={20} />}
          <span>{notification.msg}</span>
        </div>
      )}

      {/* --- Main View Switcher --- */}
      {viewMode === 'admin' && isAdminLoggedIn ? (
        <AdminInterface 
          user={user} 
          orders={orders} 
          menuItems={menuItems} 
          usersList={usersList} 
          admins={admins}
          announcements={announcements} // 傳遞公告資料
          adminUser={adminUser}
          onLogout={() => {
            setIsAdminLoggedIn(false);
            setAdminUser(null);
            setViewMode('user');
            localStorage.removeItem('yj_admin_session');
            sessionStorage.removeItem('yj_admin_session');
            showNotify('success', '已登出管理後台');
          }}
          showNotify={showNotify}
        />
      ) : (
        <UserInterface 
          user={user} 
          orders={orders} 
          menuItems={menuItems} 
          usersList={usersList} 
          admins={admins}
          announcements={announcements} // 傳遞公告資料
          onAdminRequest={() => setViewMode('login')}
          showNotify={showNotify}
        />
      )}

      {/* --- Admin Login Modal --- */}
      {viewMode === 'login' && (
        <LoginModal 
          admins={admins}
          onLogin={(adminData, remember) => {
            setIsAdminLoggedIn(true);
            setAdminUser(adminData);
            setViewMode('admin');
            
            const sessionData = JSON.stringify({
              user: adminData,
              timestamp: new Date().getTime()
            });

            if (remember) {
              localStorage.setItem('yj_admin_session', sessionData);
            } else {
              sessionStorage.setItem('yj_admin_session', sessionData);
            }
            
            showNotify('success', `歡迎回來，${adminData.name}`);
          }}
          onCancel={() => setViewMode('user')}
        />
      )}
    </div>
  );
}

// ==========================================
// USER INTERFACE COMPONENTS
// ==========================================

function UserInterface({ orders, menuItems, usersList, announcements, onAdminRequest, showNotify }) {
  const [activeTab, setActiveTab] = useState('meal'); // meal, drink, group
  const [selectedUser, setSelectedUser] = useState('');
  const [cart, setCart] = useState([]);
  const [lightboxImg, setLightboxImg] = useState(null);
  
  // Real-time Clock State
  const [currentTime, setCurrentTime] = useState(new Date());

  // Filter published announcements for frontend
  const publishedAnnouncements = useMemo(() => {
    return announcements.filter(a => a.isPublished);
  }, [announcements]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date) => {
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const day = days[date.getDay()];
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${yyyy}年${mm}月${dd}日 星期${day} ${hh}:${min}:${ss}`;
  };

  // Theme Colors based on active tab
  const theme = useMemo(() => {
    switch(activeTab) {
      case 'meal': return { main: 'bg-indigo-600', sub: 'bg-indigo-50', text: 'text-indigo-600', border: 'border-indigo-200', name: '訂餐食' };
      case 'drink': return { main: 'bg-amber-500', sub: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', name: '訂飲料' };
      case 'group': return { main: 'bg-pink-500', sub: 'bg-pink-50', text: 'text-pink-600', border: 'border-pink-200', name: '揪團購' };
      default: return { main: 'bg-gray-600', sub: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200', name: '一般' };
    }
  }, [activeTab]);

  const todayStr = getTodayStr();
  const currentMenu = menuItems.find(m => m.menuDate === todayStr && m.type === activeTab);
  
  // Cutoff Logic
  const isLocked = useMemo(() => {
    if (!currentMenu) return true;
    if (!currentMenu.cutoffTime) return false;
    const now = new Date();
    const [hours, minutes] = currentMenu.cutoffTime.split(':').map(Number);
    const cutoffDate = new Date();
    cutoffDate.setHours(hours, minutes, 0, 0);
    return now > cutoffDate;
  }, [currentMenu]);

  // Orders for today matching current tab
  const todayOrders = useMemo(() => {
    return orders.filter(o => o.dateString === todayStr && o.orderType === activeTab);
  }, [orders, todayStr, activeTab]);

  const addToCart = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const priceVal = parseInt(formData.get('price'));

    // 防呆驗證：確保金額有效
    if (isNaN(priceVal) || priceVal <= 0) {
      showNotify('error', '請輸入正確的金額');
      return;
    }

    const newItem = {
      name: formData.get('itemName'),
      price: priceVal,
      note: formData.get('note'),
      qty: 1, // Default 1 for now, can expand later
      tempId: Date.now()
    };
    setCart([...cart, newItem]);
    e.target.reset();
  };

  const submitOrder = async () => {
    if (!selectedUser) return showNotify('error', '請選擇訂購人姓名');
    if (cart.length === 0) return showNotify('error', '購物車是空的');

    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    
    // Construct single string for items if we want simple display, or array
    // To match requirement "orders: { items: [...] }", we store the array
    const orderData = {
      userName: selectedUser,
      items: cart,
      totalAmount,
      note: cart.map(i => i.note).filter(Boolean).join(', '),
      status: '準備中',
      isPaid: false,
      orderType: activeTab,
      dateString: todayStr,
      createdAt: serverTimestamp()
    };

    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'orders'), orderData);
      showNotify('success', '訂單已送出！');
      setCart([]);
    } catch (err) {
      console.error(err);
      showNotify('error', '送出失敗，請重試');
    }
  };

  return (
    <div className="pb-20 md:pb-0">
      {/* Header */}
      <header className={`${theme.main} text-white shadow-md transition-colors duration-300`}>
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between relative">
          {/* Logo Section */}
          <div className="flex items-center gap-2 relative z-10">
            <Utensils className="w-6 h-6" />
            <h1 className="font-bold text-lg md:text-xl tracking-wide">羿鈞科技 <span className="text-xs opacity-80 font-normal block md:inline md:ml-2">訂餐、揪團系統</span></h1>
          </div>

          {/* Time Display (Desktop: Centered, Mobile: Hidden to avoid overlap) */}
          <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 hidden md:block font-mono font-medium tracking-wide opacity-90 text-sm">
            {formatTime(currentTime)}
          </div>

          {/* Admin Button */}
          <button 
            onClick={onAdminRequest}
            className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition relative z-10"
            title="管理員登入"
          >
            <Settings size={20} />
          </button>
        </div>
        
        {/* Time Display (Mobile Only: Shown below the header row) */}
        <div className="md:hidden text-center text-xs py-1 bg-black/10 font-mono tracking-wide">
          {formatTime(currentTime)}
        </div>
        
        {/* Tabs */}
        <div className="max-w-5xl mx-auto px-4 flex gap-1 mt-2 overflow-x-auto no-scrollbar">
          {[
            { id: 'meal', icon: Utensils, label: '訂餐食' },
            { id: 'drink', icon: Coffee, label: '訂飲料' },
            { id: 'group', icon: Users, label: '揪團購' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 min-w-[100px] flex items-center justify-center gap-2 py-3 rounded-t-lg text-sm font-medium transition-all ${
                activeTab === tab.id 
                  ? 'bg-slate-50 text-slate-800 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]' 
                  : 'bg-white/10 text-white/80 hover:bg-white/20'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 space-y-6">
        
        {/* System Announcements Carousel */}
        {publishedAnnouncements && publishedAnnouncements.length > 0 && (
          <AnnouncementCarousel announcements={publishedAnnouncements} />
        )}

        {/* Menu Section */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          {currentMenu ? (
            <div className="flex flex-col md:flex-row">
              {currentMenu.imageUrl && (
                <div className="w-full md:w-1/3 h-48 md:h-auto bg-slate-100 relative group cursor-pointer" onClick={() => setLightboxImg(currentMenu.imageUrl)}>
                  <img src={currentMenu.imageUrl} alt="Menu" className="w-full h-full object-cover object-center transition transform group-hover:scale-105" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 flex items-center justify-center transition">
                    <ImageIcon className="text-white opacity-0 group-hover:opacity-100 drop-shadow-md" />
                  </div>
                </div>
              )}
              <div className="p-6 flex-1 flex flex-col justify-center">
                <div className="flex justify-between items-start mb-2">
                  <h2 className="text-2xl font-bold text-slate-800">{currentMenu.storeName}</h2>
                  {currentMenu.cutoffTime && (
                    <span className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${isLocked ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                      <Clock size={12} />
                      {currentMenu.cutoffTime} 截止
                    </span>
                  )}
                </div>
                <p className="text-slate-600 mb-4 text-sm whitespace-pre-wrap">{currentMenu.description || "今日無特別說明"}</p>
                {isLocked && (
                  <div className="bg-red-50 border-l-4 border-red-400 p-3 text-red-700 text-sm flex items-center gap-2">
                    <AlertCircle size={16} />
                    <span>已超過截止時間，停止收單。如需補單請聯繫管理員。</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-12 text-center text-slate-400">
              <Coffee size={48} className="mx-auto mb-3 opacity-20" />
              <p>今日尚未設定此類別的菜單</p>
            </div>
          )}
        </div>

        {/* Ordering Area */}
        {!isLocked && currentMenu && (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Form */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
              <h3 className={`text-lg font-bold mb-4 flex items-center gap-2 ${theme.text}`}>
                <Plus size={20} /> 新增訂單
              </h3>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">訂購人</label>
                <select 
                  className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  value={selectedUser}
                  onChange={(e) => setSelectedUser(e.target.value)}
                >
                  <option value="">請選擇姓名...</option>
                  {usersList.map(u => (
                    <option key={u.id} value={u.name}>{u.name}</option>
                  ))}
                </select>
              </div>

              <form onSubmit={addToCart} className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <input name="itemName" required placeholder="品項名稱" className="w-full p-2 border border-slate-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    {/* 修改金額輸入框：強制輸入、最小直為 1 */}
                    <input 
                      name="price" 
                      type="number" 
                      required 
                      min="1"
                      placeholder="金額" 
                      className="w-full p-2 border border-slate-300 rounded-lg text-sm" 
                    />
                  </div>
                </div>
                <input name="note" placeholder="備註 (半糖少冰、加辣...)" className="w-full p-2 border border-slate-300 rounded-lg text-sm" />
                <button type="submit" className={`w-full py-2 rounded-lg font-medium transition ${theme.sub} ${theme.text} hover:brightness-95`}>
                  加入購物車
                </button>
              </form>
            </div>

            {/* Cart */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-700">
                <ShoppingCart size={20} /> 待送出清單
              </h3>
              
              <div className="flex-1 overflow-y-auto min-h-[150px] mb-4 space-y-2">
                {cart.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm">
                    <p>購物車是空的</p>
                  </div>
                ) : (
                  cart.map((item, idx) => (
                    <div key={item.tempId} className="flex justify-between items-center bg-slate-50 p-2 rounded border border-slate-100 text-sm">
                      <div className="flex-1">
                        <div className="font-medium text-slate-800">{item.name}</div>
                        <div className="text-xs text-slate-500">{item.note}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-slate-600">${item.price}</span>
                        <button 
                          onClick={() => setCart(cart.filter((_, i) => i !== idx))}
                          className="text-red-400 hover:text-red-600"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
                <div className="text-sm text-slate-500">
                  總計: <span className="text-lg font-bold text-slate-800 ml-1">{formatCurrency(cart.reduce((a,b)=>a+b.price,0))}</span>
                </div>
                <button 
                  onClick={submitOrder}
                  disabled={cart.length === 0}
                  className={`px-6 py-2 rounded-lg text-white font-bold shadow-md transition transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${theme.main}`}
                >
                  送出訂單
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Today's Orders List */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <h3 className="font-bold text-slate-700 flex items-center gap-2">
              <List size={20} /> 今日點餐狀況
              <span className="bg-slate-200 text-slate-600 text-xs px-2 py-0.5 rounded-full">{todayOrders.length} 筆</span>
            </h3>
            {/* 移除 text-xs，保留 font-bold 並使用預設大小(text-base)以與標題一致 */}
            <div className="font-bold text-red-600">刪、改單請親洽管理員</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 font-medium">
                <tr>
                  <th className="p-3">姓名</th>
                  <th className="p-3">餐點內容</th>
                  {/* 已移除金額欄位標題 */}
                  <th className="p-3 text-center">狀態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {todayOrders.map(order => (
                  <tr key={order.id} className="hover:bg-slate-50 transition">
                    <td className="p-3 font-medium text-slate-700 w-1/4">{order.userName}</td>
                    <td className="p-3 text-slate-600">
                      {order.items.map((i, idx) => (
                        <div key={idx}>
                          {i.name} <span className="text-slate-400 text-xs">{i.note && `(${i.note})`}</span>
                        </div>
                      ))}
                    </td>
                    {/* 已移除金額顯示欄位 */}
                    <td className="p-3 text-center w-1/6">
                      <span className={`px-2 py-1 rounded text-xs ${order.status === '已出餐' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {order.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {todayOrders.length === 0 && (
                  <tr>
                    <td colSpan="3" className="p-6 text-center text-slate-400">目前尚無人點餐</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
      
      {/* Lightbox */}
      {lightboxImg && (
        <div 
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4 cursor-zoom-out animate-fade-in"
          onClick={() => setLightboxImg(null)}
        >
          <img src={lightboxImg} alt="Full Menu" className="max-w-full max-h-full rounded shadow-2xl" />
          <button className="absolute top-4 right-4 text-white hover:text-gray-300">
            <X size={32} />
          </button>
        </div>
      )}
    </div>
  );
}

// ==========================================
// ADMIN INTERFACE COMPONENTS
// ==========================================

function AdminInterface({ user, orders, menuItems, usersList, admins, announcements, adminUser, onLogout, showNotify }) {
  const [tab, setTab] = useState('orders'); // orders, history, menu, users, settings, announcements
  const [isMobileNavOpen, setMobileNavOpen] = useState(false);

  // Helper to render content based on tab
  const renderContent = () => {
    switch (tab) {
      case 'orders': return <AdminOrders orders={orders} menuItems={menuItems} showNotify={showNotify} />;
      case 'history': return <AdminHistory orders={orders} usersList={usersList} showNotify={showNotify} />;
      case 'menu': return <AdminMenu menuItems={menuItems} showNotify={showNotify} />;
      case 'announcements': return <AdminAnnouncements announcements={announcements} showNotify={showNotify} />;
      case 'users': return <AdminUsers usersList={usersList} showNotify={showNotify} />;
      case 'settings': return <AdminSettings admins={admins} adminUser={adminUser} user={user} orders={orders} menuItems={menuItems} usersList={usersList} showNotify={showNotify} />;
      default: return null;
    }
  };

  const navItems = [
    { id: 'orders', icon: List, label: '今日訂單' },
    { id: 'history', icon: Clock, label: '歷史紀錄' },
    { id: 'menu', icon: Utensils, label: '菜單管理' },
    { id: 'announcements', icon: Megaphone, label: '系統公告' }, // 新增公告Tab
    { id: 'users', icon: Users, label: '同事管理' }, // 修改標籤名稱
    { id: 'settings', icon: Settings, label: '系統設定' },
  ];

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-100">
      {/* Sidebar */}
      <aside className={`bg-slate-900 text-slate-300 w-full md:w-64 flex-shrink-0 transition-all ${isMobileNavOpen ? 'h-auto' : 'h-16 md:h-screen overflow-hidden'}`}>
        <div className="h-16 flex items-center justify-between px-4 bg-slate-950 md:bg-transparent">
          <div className="font-bold text-white tracking-wider">後台管理系統</div>
          <button className="md:hidden" onClick={() => setMobileNavOpen(!isMobileNavOpen)}>
            <Menu />
          </button>
        </div>
        
        <nav className={`p-4 space-y-1 ${isMobileNavOpen ? 'block' : 'hidden md:block'}`}>
          <div className="mb-6 px-3">
            <div className="text-xs uppercase text-slate-500 font-bold mb-2">管理員</div>
            <div className="flex items-center gap-2 text-white">
              <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center font-bold">
                {adminUser.name[0]}
              </div>
              <div>
                <div className="text-sm font-medium">{adminUser.name}</div>
                <div className="text-xs text-slate-500">{adminUser.role === 'super' ? '超級管理員' : '副管理員'}</div>
              </div>
            </div>
          </div>

          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => { setTab(item.id); setMobileNavOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                tab === item.id ? 'bg-indigo-600 text-white shadow-lg' : 'hover:bg-white/5 hover:text-white'
              }`}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
          
          <button 
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-red-400 hover:bg-red-900/20 mt-8"
          >
            <LogOut size={18} />
            登出系統
          </button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto max-h-screen">
        <h2 className="text-2xl font-bold text-slate-800 mb-6 pb-2 border-b border-slate-200">
          {navItems.find(n => n.id === tab)?.label}
        </h2>
        {renderContent()}
      </main>
    </div>
  );
}

// --- Admin Sub-Components ---

// 新增：公告輪播元件 (Frontend)
function AnnouncementCarousel({ announcements }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!announcements || announcements.length === 0) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % announcements.length);
    }, 5000); // 5秒切換
    return () => clearInterval(interval);
  }, [announcements]);

  if (!announcements || announcements.length === 0) return null;

  const current = announcements[currentIndex];

  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % announcements.length);
  };

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev - 1 + announcements.length) % announcements.length);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden mb-6 relative group">
      <div className="bg-gradient-to-r from-orange-500 to-amber-500 text-white px-4 py-2 flex items-center gap-2 font-bold text-sm">
        <Megaphone size={16} className="animate-pulse" />
        系統公告
      </div>
      
      <div className="relative min-h-[160px] md:min-h-[200px] flex flex-col md:flex-row">
        {/* Image Section */}
        {current.imageUrl && (
          <div className="w-full md:w-1/3 h-48 md:h-auto bg-slate-100 relative">
            <img 
              src={current.imageUrl} 
              alt="公告圖片" 
              className="w-full h-full object-cover"
            />
          </div>
        )}
        
        {/* Content Section */}
        <div className={`p-6 flex-1 flex flex-col justify-center ${!current.imageUrl ? 'w-full' : ''}`}>
          <h3 className="text-xl font-bold text-slate-800 mb-2">{current.title}</h3>
          <div className="text-slate-600 text-sm whitespace-pre-wrap leading-relaxed">
            {current.content}
          </div>
          <div className="mt-4 text-xs text-slate-400">
            發布於：{new Date(current.createdAt?.seconds * 1000).toLocaleDateString()}
          </div>
        </div>

        {/* Navigation Arrows (Show on hover) */}
        {announcements.length > 1 && (
          <>
            <button 
              onClick={handlePrev}
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/20 hover:bg-black/40 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition"
            >
              <ChevronLeft size={20} />
            </button>
            <button 
              onClick={handleNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/20 hover:bg-black/40 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition"
            >
              <ChevronRight size={20} />
            </button>
            
            {/* Dots */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
              {announcements.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentIndex(idx)}
                  className={`w-2 h-2 rounded-full transition-all ${idx === currentIndex ? 'bg-orange-500 w-4' : 'bg-slate-300'}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// 新增：後台公告管理 (Backend)
function AdminAnnouncements({ announcements, showNotify }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [uploading, setUploading] = useState(false);

  const handleEdit = (item) => {
    setEditData(item || { 
      title: '', 
      content: '', 
      imageUrl: '',
      isPublished: false, // Default false for new
      createdAt: serverTimestamp() // Placeholder, real timestamp added on save
    });
    setIsEditing(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!editData.title || !editData.content) {
      return showNotify('error', '標題與內容為必填');
    }

    try {
      if (editData.id) {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'announcements', editData.id), {
          ...editData,
          updatedAt: serverTimestamp()
        });
        showNotify('success', '公告已更新');
      } else {
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'announcements'), {
          ...editData,
          isPublished: false, // Ensure default is unpublished
          createdAt: serverTimestamp()
        });
        showNotify('success', '公告已建立 (未上架)');
      }
      setIsEditing(false);
    } catch (err) {
      console.error(err);
      showNotify('error', '儲存失敗');
    }
  };

  const handleDelete = async (id) => {
    if(!confirm('確定刪除此公告？')) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'announcements', id));
    showNotify('success', '公告已刪除');
  };

  const togglePublish = async (item) => {
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'announcements', item.id), {
        isPublished: !item.isPublished
      });
      showNotify('success', item.isPublished ? '公告已下架' : '公告已上架');
    } catch (err) {
      showNotify('error', '狀態更新失敗');
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return showNotify('error', '檔案需小於 2MB');
    
    setUploading(true);
    try {
      const base64 = await compressImage(file, 640); // Force max dimension to 640px for announcements
      setEditData(prev => ({ ...prev, imageUrl: base64 }));
    } catch (err) {
      showNotify('error', '圖片處理失敗');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {!isEditing ? (
        <>
          <button 
            onClick={() => handleEdit(null)}
            className="w-full md:w-auto px-6 py-2 bg-indigo-600 text-white rounded-lg shadow hover:bg-indigo-700 flex items-center justify-center gap-2"
          >
            <Plus size={18} /> 新增公告
          </button>

          <div className="grid gap-4">
            {announcements.map(item => (
              <div key={item.id} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row gap-4 items-start">
                {/* Thumbnail */}
                <div className="w-full md:w-32 h-32 bg-slate-100 rounded-lg overflow-hidden shrink-0">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300">
                      <ImageIcon size={24} />
                    </div>
                  )}
                </div>
                
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-bold text-lg text-slate-800 mb-1 truncate">{item.title}</h3>
                      {/* Status Badge (Mobile/Desktop visible) */}
                      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium mb-2 md:hidden bg-slate-100 text-slate-500">
                         <div className={`w-1.5 h-1.5 rounded-full ${item.isPublished ? 'bg-red-500' : 'bg-slate-400'}`} />
                         {item.isPublished ? '公告中' : '未上架'}
                      </div>
                    </div>
                    
                    <div className="flex gap-2 shrink-0 ml-2 items-center">
                       {/* Publish Toggle Button */}
                       <button 
                         onClick={() => togglePublish(item)}
                         className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition border shadow-sm ${
                           item.isPublished 
                             ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100' 
                             : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                         }`}
                         title={item.isPublished ? "點擊下架" : "點擊上架"}
                       >
                         <div className={`w-2.5 h-2.5 rounded-full shadow-sm transition-all duration-300 ${item.isPublished ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'bg-slate-300'}`} />
                         {item.isPublished ? '公告中' : '公告上架'} 
                       </button>
                       
                       <div className="h-6 w-px bg-slate-200 mx-1 hidden md:block"></div>

                       <button onClick={() => handleEdit(item)} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded"><Edit size={16} /></button>
                       <button onClick={() => handleDelete(item.id)} className="p-2 text-red-500 hover:bg-red-50 rounded"><Trash2 size={16} /></button>
                    </div>
                  </div>
                  <p className="text-sm text-slate-600 line-clamp-2 mb-2 whitespace-pre-wrap">{item.content}</p>
                  <div className="text-xs text-slate-400">
                    {item.isPublished ? <span className="text-red-600 font-medium mr-2">● 公告中</span> : <span className="text-slate-400 mr-2">○ 未公開</span>}
                    建立於：{item.createdAt ? new Date(item.createdAt.seconds * 1000).toLocaleString() : 'Just now'}
                  </div>
                </div>
              </div>
            ))}
            {announcements.length === 0 && (
              <div className="text-center py-12 text-slate-400 bg-white rounded-xl border border-dashed border-slate-300">
                <Megaphone size={32} className="mx-auto mb-2 opacity-50" />
                尚無系統公告
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="bg-white p-6 rounded-xl shadow-lg border border-slate-200 max-w-2xl mx-auto">
          <h3 className="text-xl font-bold mb-4">{editData.id ? '編輯公告' : '新增公告'}</h3>
          <form onSubmit={handleSave} className="space-y-4">
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">公告標題</label>
              <input 
                required 
                value={editData.title} 
                onChange={e=>setEditData({...editData, title: e.target.value})} 
                className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 outline-none" 
                placeholder="輸入標題..." 
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">公告內容 (支援換行)</label>
              <textarea 
                required 
                rows="6" 
                value={editData.content} 
                onChange={e=>setEditData({...editData, content: e.target.value})} 
                className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 outline-none" 
                placeholder="輸入公告詳細內容..." 
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">配圖 (選填)</label>
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center hover:bg-slate-50 transition relative">
                <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                {uploading ? <p className="text-sm text-indigo-500">處理中...</p> : 
                  editData.imageUrl ? (
                    <div className="relative h-40 mx-auto w-fit">
                       <img src={editData.imageUrl} alt="Preview" className="h-full rounded shadow-sm" />
                       <div className="text-xs text-green-600 mt-1">點擊更換</div>
                       <button 
                         type="button"
                         onClick={(e) => {
                           e.preventDefault();
                           setEditData({...editData, imageUrl: ''});
                         }}
                         className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 z-10"
                       >
                         <X size={12} />
                       </button>
                    </div>
                  ) : (
                    <div className="text-slate-400 text-sm py-4">
                      <Upload className="mx-auto mb-2" />
                      點擊或拖曳上傳圖片 (Max 2MB)
                    </div>
                  )
                }
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t border-slate-100 mt-4">
              <button type="button" onClick={() => setIsEditing(false)} className="flex-1 py-2 border border-slate-300 rounded text-slate-600 hover:bg-slate-50">取消</button>
              <button type="submit" className="flex-1 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 shadow-md">
                {editData.id ? '更新公告' : '建立公告 (預設未上架)'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function AdminOrders({ orders, menuItems, showNotify }) {
  const [filter, setFilter] = useState('today'); // today, yesterday, all
  const todayStr = getTodayStr();
  
  // Filter Logic
  const filteredOrders = useMemo(() => {
    let targetDate = todayStr;
    if (filter === 'yesterday') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      targetDate = d.toISOString().split('T')[0];
    }
    
    if (filter === 'all') return orders;
    return orders.filter(o => o.dateString === targetDate);
  }, [orders, filter, todayStr]);

  const stats = useMemo(() => {
    const total = filteredOrders.reduce((sum, o) => sum + o.totalAmount, 0);
    const count = filteredOrders.length;
    const unpaid = filteredOrders.filter(o => !o.isPaid).length;
    return { total, count, unpaid };
  }, [filteredOrders]);

  const toggleStatus = async (orderId, currentStatus) => {
    const newStatus = currentStatus === '準備中' ? '已出餐' : '準備中';
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'orders', orderId), { status: newStatus });
  };

  const togglePaid = async (orderId, currentPaid) => {
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'orders', orderId), { isPaid: !currentPaid });
  };

  const deleteOrder = async (orderId) => {
    if(!confirm('確定要刪除此訂單嗎？')) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'orders', orderId));
    showNotify('success', '訂單已刪除');
  };

  const exportCSV = () => {
    const headers = ['日期', '姓名', '類別', '品項', '總額', '付款', '狀態'];
    const rows = filteredOrders.map(o => [
      o.dateString,
      o.userName,
      o.orderType,
      o.items.map(i => `${i.name}(${i.qty})`).join('; '),
      o.totalAmount,
      o.isPaid ? 'Yes' : 'No',
      o.status
    ]);
    const csvContent = "\uFEFF" + [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `orders_export_${filter}_${todayStr}.csv`;
    link.click();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex bg-white p-1 rounded-lg shadow-sm border border-slate-200">
          {['today', 'yesterday', 'all'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
                filter === f ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {f === 'today' ? '今日' : f === 'yesterday' ? '昨日' : '全部歷史'}
            </button>
          ))}
        </div>
        <button onClick={exportCSV} className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 font-medium">
          <Download size={16} /> 匯出報表
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div className="text-sm text-slate-500 mb-1">訂單總數</div>
          <div className="text-2xl font-bold text-slate-800">{stats.count} <span className="text-sm font-normal text-slate-400">筆</span></div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div className="text-sm text-slate-500 mb-1">營業總額</div>
          <div className="text-2xl font-bold text-indigo-600">{formatCurrency(stats.total)}</div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div className="text-sm text-slate-500 mb-1">未付款</div>
          <div className="text-2xl font-bold text-red-500">{stats.unpaid} <span className="text-sm font-normal text-slate-400">筆</span></div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-100">
              <tr>
                <th className="p-4">訂購人</th>
                <th className="p-4">內容</th>
                <th className="p-4">金額</th>
                <th className="p-4 text-center">付款</th>
                <th className="p-4 text-center">狀態</th>
                <th className="p-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredOrders.map(o => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <td className="p-4">
                    <div className="font-bold text-slate-700">{o.userName}</div>
                    <div className="text-xs text-slate-400">{o.dateString}</div>
                  </td>
                  <td className="p-4">
                    {o.items.map((i, idx) => (
                      <div key={idx} className="text-slate-600">
                        {i.name} <span className="text-slate-400 text-xs">x{i.qty}</span>
                        {i.note && <span className="text-orange-400 text-xs ml-1">({i.note})</span>}
                      </div>
                    ))}
                  </td>
                  <td className="p-4 font-medium text-slate-700">{formatCurrency(o.totalAmount)}</td>
                  <td className="p-4 text-center">
                    <button 
                      onClick={() => togglePaid(o.id, o.isPaid)}
                      className={`px-3 py-1 rounded-full text-xs font-bold transition ${o.isPaid ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600 hover:bg-red-200'}`}
                    >
                      {o.isPaid ? '已付款' : '未付款'}
                    </button>
                  </td>
                  <td className="p-4 text-center">
                    <button
                      onClick={() => toggleStatus(o.id, o.status)}
                      className={`px-3 py-1 rounded-full text-xs font-bold transition ${o.status === '已出餐' ? 'bg-blue-100 text-blue-600' : 'bg-yellow-100 text-yellow-600 hover:bg-yellow-200'}`}
                    >
                      {o.status}
                    </button>
                  </td>
                  <td className="p-4 text-right">
                    <button onClick={() => deleteOrder(o.id)} className="p-2 text-slate-400 hover:text-red-500 transition">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {filteredOrders.length === 0 && (
                <tr><td colSpan="6" className="p-8 text-center text-slate-400">無符合條件的訂單</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AdminHistory({ orders, usersList, showNotify }) {
  const [viewType, setViewType] = useState('list'); // 'list' or 'stats'
  const [dateRange, setDateRange] = useState(getDateRange('today'));
  const [periodMode, setPeriodMode] = useState('today'); // today, yesterday, week, month, year, custom
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Update range when preset button clicked
  const handlePresetRange = (mode) => {
    setPeriodMode(mode);
    if (mode !== 'custom') {
      setDateRange(getDateRange(mode));
    }
  };

  // Filter Data
  const filteredOrders = useMemo(() => {
    return orders.filter(o => 
      o.dateString >= dateRange.start && o.dateString <= dateRange.end
    ).sort((a, b) => b.dateString.localeCompare(a.dateString)); // Newest first
  }, [orders, dateRange]);

  // Stats Data (Aggregated by Person)
  const personStats = useMemo(() => {
    const map = {};
    filteredOrders.forEach(o => {
      if (!map[o.userName]) map[o.userName] = { name: o.userName, count: 0, total: 0 };
      map[o.userName].count += 1;
      map[o.userName].total += o.totalAmount;
    });
    return Object.values(map).sort((a,b) => b.total - a.total);
  }, [filteredOrders]);

  // Selection Logic
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredOrders.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredOrders.map(o => o.id)));
    }
  };

  const toggleSelect = (id) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  // Export Logic
  const handleExport = () => {
    const targets = viewType === 'list' 
      ? filteredOrders.filter(o => selectedIds.size === 0 || selectedIds.has(o.id)) // Export all visible if none selected, else only selected
      : filteredOrders;

    if (targets.length === 0) return showNotify('error', '無資料可匯出');

    // CSV Header
    const headers = ['訂單日期', '訂單類別', '訂購人', '餐點內容', '備註', '總金額', '付款狀態', '出餐狀態'];
    
    // CSV Rows
    const rows = targets.map(o => {
      const itemsStr = o.items.map(i => `${i.name} x${i.qty}`).join('; ');
      const typeMap = { 'meal': '餐食', 'drink': '飲料', 'group': '團購' };
      return [
        o.dateString,
        typeMap[o.orderType] || '其他',
        o.userName,
        itemsStr,
        o.note || '',
        o.totalAmount,
        o.isPaid ? '已付款' : '未付款',
        o.status
      ];
    });

    // Add BOM for Excel Chinese support
    const csvContent = "\uFEFF" + [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `history_export_${dateRange.start}_to_${dateRange.end}.csv`;
    link.click();
    showNotify('success', '匯出完成');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Toolbar */}
      <div className="flex flex-col xl:flex-row gap-4 justify-between items-start xl:items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        
        {/* Period Selectors */}
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'today', label: '今日' },
            { id: 'yesterday', label: '昨日' },
            { id: 'week', label: '本週' },
            { id: 'month', label: '本月' },
            { id: 'year', label: '今年' },
            { id: 'custom', label: '自訂範圍' },
          ].map(p => (
            <button
              key={p.id}
              onClick={() => handlePresetRange(p.id)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                periodMode === p.id 
                  ? 'bg-indigo-100 text-indigo-700 border border-indigo-200' 
                  : 'text-slate-600 hover:bg-slate-50 border border-transparent'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Date Inputs */}
        <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-200">
          <Calendar size={16} className="text-slate-400 ml-1" />
          <input 
            type="date" 
            value={dateRange.start}
            onChange={(e) => {
              setDateRange(prev => ({ ...prev, start: e.target.value }));
              setPeriodMode('custom');
            }}
            className="bg-transparent border-none text-sm text-slate-700 focus:ring-0 p-0"
          />
          <span className="text-slate-400">to</span>
          <input 
            type="date" 
            value={dateRange.end}
            onChange={(e) => {
              setDateRange(prev => ({ ...prev, end: e.target.value }));
              setPeriodMode('custom');
            }}
            className="bg-transparent border-none text-sm text-slate-700 focus:ring-0 p-0"
          />
        </div>
      </div>

      {/* View Switcher & Actions */}
      <div className="flex justify-between items-center">
        <div className="flex gap-4 border-b border-slate-200">
          <button 
            onClick={() => setViewType('list')} 
            className={`pb-2 px-4 font-bold flex items-center gap-2 transition ${
              viewType === 'list' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <List size={18} /> 詳細清單
          </button>
          <button 
            onClick={() => setViewType('stats')} 
            className={`pb-2 px-4 font-bold flex items-center gap-2 transition ${
              viewType === 'stats' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Users size={18} /> 人員統計
          </button>
        </div>

        <button 
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg shadow hover:bg-green-700 transition text-sm font-bold"
        >
          <FileSpreadsheet size={18} /> 匯出 Excel
        </button>
      </div>

      {/* Detailed List View */}
      {viewType === 'list' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-100">
                <tr>
                  <th className="p-4 w-10">
                    <button onClick={toggleSelectAll} className="flex items-center text-slate-400 hover:text-indigo-600">
                      {selectedIds.size > 0 && selectedIds.size === filteredOrders.length ? <CheckSquare size={20} /> : <Square size={20} />}
                    </button>
                  </th>
                  <th className="p-4">日期</th>
                  <th className="p-4">類別</th>
                  <th className="p-4">姓名</th>
                  <th className="p-4">內容</th>
                  <th className="p-4 text-right">金額</th>
                  <th className="p-4 text-center">狀態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrders.map(o => (
                  <tr key={o.id} className={`hover:bg-slate-50 transition ${selectedIds.has(o.id) ? 'bg-indigo-50/50' : ''}`}>
                    <td className="p-4">
                      <button onClick={() => toggleSelect(o.id)} className={`flex items-center ${selectedIds.has(o.id) ? 'text-indigo-600' : 'text-slate-300 hover:text-slate-500'}`}>
                        {selectedIds.has(o.id) ? <CheckSquare size={20} /> : <Square size={20} />}
                      </button>
                    </td>
                    <td className="p-4 text-slate-500 font-mono">{o.dateString}</td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded text-xs font-bold border ${
                        o.orderType === 'meal' ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 
                        o.orderType === 'drink' ? 'bg-amber-50 text-amber-600 border-amber-100' : 
                        'bg-pink-50 text-pink-600 border-pink-100'
                      }`}>
                        {o.orderType === 'meal' ? '餐食' : o.orderType === 'drink' ? '飲料' : '團購'}
                      </span>
                    </td>
                    <td className="p-4 font-bold text-slate-700">{o.userName}</td>
                    <td className="p-4 text-slate-600 max-w-xs truncate">
                      {o.items.map(i => i.name).join(', ')}
                      {o.note && <span className="text-slate-400 ml-1 text-xs">({o.note})</span>}
                    </td>
                    <td className="p-4 text-right font-mono font-medium text-slate-700">{formatCurrency(o.totalAmount)}</td>
                    <td className="p-4 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs ${o.isPaid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {o.isPaid ? '已付款' : '未付款'}
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredOrders.length === 0 && (
                  <tr><td colSpan="7" className="p-12 text-center text-slate-400">此區間無訂單資料</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex justify-between items-center">
            <span>共 {filteredOrders.length} 筆資料</span>
            {selectedIds.size > 0 && <span className="font-bold text-indigo-600">已選取 {selectedIds.size} 筆</span>}
          </div>
        </div>
      )}

      {/* Person Stats View */}
      {viewType === 'stats' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-500 font-bold">
              <tr>
                <th className="p-4 w-16 text-center">排名</th>
                <th className="p-4">姓名</th>
                <th className="p-4 text-right">訂購次數</th>
                <th className="p-4 text-right">消費總額</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {personStats.map((p, idx) => (
                <tr key={p.name} className="hover:bg-slate-50">
                  <td className="p-4 text-center">
                    {idx < 3 ? (
                      <span className={`w-6 h-6 inline-flex items-center justify-center rounded-full text-white text-xs font-bold ${
                        idx === 0 ? 'bg-yellow-400' : idx === 1 ? 'bg-slate-400' : 'bg-amber-600'
                      }`}>{idx + 1}</span>
                    ) : (
                      <span className="text-slate-400">{idx + 1}</span>
                    )}
                  </td>
                  <td className="p-4 font-bold text-slate-700">{p.name}</td>
                  <td className="p-4 text-right text-slate-600">{p.count} 次</td>
                  <td className="p-4 text-right font-bold text-indigo-600">{formatCurrency(p.total)}</td>
                </tr>
              ))}
              {personStats.length === 0 && (
                <tr><td colSpan="4" className="p-12 text-center text-slate-400">此區間無統計資料</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AdminMenu({ menuItems, showNotify }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [uploading, setUploading] = useState(false);

  // Default next 7 days logic could go here for "Calendar View", 
  // but for simplicity, showing a list sorted by date descending.
  const sortedMenu = useMemo(() => {
    return [...menuItems].sort((a,b) => b.menuDate.localeCompare(a.menuDate));
  }, [menuItems]);

  // Generate time slots from 08:00 to 18:00 with 30 min interval
  const timeSlots = useMemo(() => {
    const slots = [];
    for (let hour = 8; hour <= 18; hour++) {
      const hStr = hour.toString().padStart(2, '0');
      slots.push(`${hStr}:00`);
      if (hour < 18) {
        slots.push(`${hStr}:30`);
      }
    }
    return slots;
  }, []);

  const handleEdit = (item) => {
    setEditData(item || { 
      menuDate: getTodayStr(), 
      type: 'meal', 
      storeName: '', 
      description: '', 
      cutoffTime: '10:00',
      imageUrl: '' 
    });
    setIsEditing(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (editData.id) {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'menuItems', editData.id), editData);
        showNotify('success', '菜單已更新');
      } else {
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'menuItems'), editData);
        showNotify('success', '新菜單已建立');
      }
      setIsEditing(false);
    } catch (err) {
      console.error(err);
      showNotify('error', '儲存失敗');
    }
  };

  const handleDelete = async (id) => {
    if(!confirm('確定刪除此菜單？')) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'menuItems', id));
    showNotify('success', '菜單已刪除');
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return showNotify('error', '檔案需小於 2MB');
    
    setUploading(true);
    try {
      const base64 = await compressImage(file);
      setEditData(prev => ({ ...prev, imageUrl: base64 }));
    } catch (err) {
      showNotify('error', '圖片處理失敗');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {!isEditing ? (
        <>
          <button 
            onClick={() => handleEdit(null)}
            className="w-full md:w-auto px-6 py-2 bg-indigo-600 text-white rounded-lg shadow hover:bg-indigo-700 flex items-center justify-center gap-2"
          >
            <Plus size={18} /> 新增菜單
          </button>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedMenu.map(m => (
              <div key={m.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden group">
                <div className="h-32 bg-slate-100 relative overflow-hidden">
                  {m.imageUrl ? (
                    <img src={m.imageUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300">
                      <ImageIcon size={32} />
                    </div>
                  )}
                  <div className="absolute top-2 right-2 flex gap-1">
                     <button onClick={() => handleEdit(m)} className="p-1.5 bg-white/90 rounded-full hover:bg-white text-indigo-600 shadow-sm"><Edit size={14} /></button>
                     <button onClick={() => handleDelete(m.id)} className="p-1.5 bg-white/90 rounded-full hover:bg-white text-red-500 shadow-sm"><Trash2 size={14} /></button>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3">
                    <div className="text-white font-bold">{m.menuDate}</div>
                  </div>
                </div>
                <div className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-bold text-slate-800">{m.storeName}</h3>
                    <span className={`text-xs px-2 py-1 rounded border ${m.type === 'meal' ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : m.type === 'drink' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-pink-50 text-pink-600 border-pink-100'}`}>
                      {m.type === 'meal' ? '餐食' : m.type === 'drink' ? '飲料' : '團購'}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 line-clamp-2">{m.description}</p>
                  <div className="mt-3 text-xs text-slate-400 flex items-center gap-1">
                    <Clock size={12} /> 截止: {m.cutoffTime || '無限制'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="bg-white p-6 rounded-xl shadow-lg border border-slate-200 max-w-2xl mx-auto">
          <h3 className="text-xl font-bold mb-4">{editData.id ? '編輯菜單' : '新增菜單'}</h3>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">日期</label>
                <input type="date" required value={editData.menuDate} onChange={e=>setEditData({...editData, menuDate: e.target.value})} className="w-full p-2 border rounded" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">類別</label>
                <select value={editData.type} onChange={e=>setEditData({...editData, type: e.target.value})} className="w-full p-2 border rounded">
                  <option value="meal">訂餐食</option>
                  <option value="drink">訂飲料</option>
                  <option value="group">揪團購</option>
                </select>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">店名</label>
              <input required value={editData.storeName} onChange={e=>setEditData({...editData, storeName: e.target.value})} className="w-full p-2 border rounded" placeholder="例如：八方雲集" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">截止時間</label>
              <select value={editData.cutoffTime} onChange={e=>setEditData({...editData, cutoffTime: e.target.value})} className="w-full p-2 border rounded">
                <option value="">無限制</option>
                {timeSlots.map(time => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">說明 / 菜單內容</label>
              <textarea rows="3" value={editData.description} onChange={e=>setEditData({...editData, description: e.target.value})} className="w-full p-2 border rounded" placeholder="優惠資訊或備註..." />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">菜單圖片</label>
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center hover:bg-slate-50 transition relative">
                <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                {uploading ? <p className="text-sm text-indigo-500">處理中...</p> : 
                  editData.imageUrl ? (
                    <div className="relative h-32 mx-auto w-fit">
                       <img src={editData.imageUrl} alt="Preview" className="h-full rounded shadow-sm" />
                       <div className="text-xs text-green-600 mt-1">點擊更換</div>
                    </div>
                  ) : (
                    <div className="text-slate-400 text-sm">
                      <Upload className="mx-auto mb-1" />
                      點擊或拖曳上傳圖片 (Max 2MB)
                    </div>
                  )
                }
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button type="button" onClick={() => setIsEditing(false)} className="flex-1 py-2 border border-slate-300 rounded text-slate-600 hover:bg-slate-50">取消</button>
              <button type="submit" className="flex-1 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 shadow-md">儲存</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function AdminUsers({ usersList, showNotify }) {
  const [newName, setNewName] = useState('');
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [layout, setLayout] = useState('grid'); // 'grid' | 'list'
  const [editingUser, setEditingUser] = useState(null);

  const addUser = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'usersList'), { name: newName.trim() });
      setNewName('');
      showNotify('success', '已新增同事');
    } catch (err) { showNotify('error', '新增失敗'); }
  };

  const removeUser = async (id) => {
    if(!confirm('移除此同事？')) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'usersList', id));
  };
  
  const handleUpdateUser = async (e) => {
    e.preventDefault();
    if (!editingUser.name.trim()) return;
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'usersList', editingUser.id), {
        name: editingUser.name.trim()
      });
      showNotify('success', '同事資料已更新');
      setEditingUser(null);
    } catch (err) {
      showNotify('error', '更新失敗');
    }
  };

  const handleBatchImport = async () => {
    const names = batchText.split(/[\n,]+/).map(n => n.trim()).filter(Boolean);
    if (names.length === 0) return;
    
    // In a real app, use Batch Writes. Here simple loop for brevity in single file.
    let count = 0;
    for (const name of names) {
      // Check duplicate loosely
      if (!usersList.find(u => u.name === name)) {
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'usersList'), { name });
        count++;
      }
    }
    showNotify('success', `已匯入 ${count} 位新同事`);
    setBatchText('');
    setIsBatchMode(false);
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div className="flex flex-col md:flex-row gap-6">
        {/* Add / Import */}
        <div className="w-full md:w-1/3 space-y-4">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <h3 className="font-bold text-slate-700 mb-3">新增同事</h3>
            {!isBatchMode ? (
              <form onSubmit={addUser} className="flex gap-2">
                <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="姓名" className="flex-1 p-2 border rounded text-sm" />
                <button type="submit" className="bg-indigo-600 text-white p-2 rounded hover:bg-indigo-700"><Plus size={20}/></button>
              </form>
            ) : (
              <div className="space-y-2">
                <textarea 
                  value={batchText} 
                  onChange={e=>setBatchText(e.target.value)} 
                  placeholder="請輸入姓名，用逗號或換行分隔..."
                  className="w-full p-2 border rounded text-sm h-32"
                />
                <button onClick={handleBatchImport} className="w-full py-2 bg-indigo-600 text-white rounded text-sm">開始匯入</button>
              </div>
            )}
            <button 
              onClick={() => setIsBatchMode(!isBatchMode)}
              className="mt-3 text-xs text-indigo-600 hover:underline w-full text-center"
            >
              {isBatchMode ? '切換回單筆新增' : '切換至批次匯入'}
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col max-h-[600px]">
          <div className="p-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <div className="font-bold text-slate-700">
              同事清單 ({usersList.length})
            </div>
            <div className="flex bg-slate-100 rounded-lg p-0.5 border border-slate-200">
              <button 
                onClick={() => setLayout('grid')}
                className={`p-1.5 rounded-md transition ${layout === 'grid' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                title="格狀顯示"
              >
                <LayoutGrid size={16} />
              </button>
              <button 
                onClick={() => setLayout('list')}
                className={`p-1.5 rounded-md transition ${layout === 'list' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                title="列表顯示"
              >
                <List size={16} />
              </button>
            </div>
          </div>
          
          <div className="overflow-y-auto p-4">
            {layout === 'grid' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {usersList.map(u => (
                  <div key={u.id} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-100 group hover:border-indigo-100 hover:shadow-sm transition">
                    <span className="text-slate-700 font-medium">{u.name}</span>
                    <div className="flex gap-1">
                      <button onClick={() => setEditingUser(u)} className="text-slate-300 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition p-1">
                        <Edit size={16} />
                      </button>
                      <button onClick={() => removeUser(u.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition p-1">
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {usersList.map((u, idx) => (
                  <div key={u.id} className="flex justify-between items-center py-3 px-2 hover:bg-slate-50 transition group">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 bg-slate-200 rounded-full flex items-center justify-center text-xs text-slate-500 font-mono">
                        {idx + 1}
                      </span>
                      <span className="text-slate-700 font-medium">{u.name}</span>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setEditingUser(u)} className="text-slate-300 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition p-2 bg-transparent hover:bg-indigo-50 rounded">
                        <Edit size={16} />
                      </button>
                      <button onClick={() => removeUser(u.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition p-2 bg-transparent hover:bg-red-50 rounded">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {usersList.length === 0 && (
              <div className="text-center text-slate-400 py-12 flex flex-col items-center">
                <Users size={32} className="mb-2 opacity-20" />
                <p>暫無同事資料</p>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6">
            <h3 className="text-xl font-bold mb-4 text-slate-800">編輯同事資料</h3>
            <form onSubmit={handleUpdateUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">姓名</label>
                <input 
                  type="text" 
                  required 
                  value={editingUser.name}
                  onChange={(e) => setEditingUser({...editingUser, name: e.target.value})}
                  className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  placeholder="姓名"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button 
                  type="button" 
                  onClick={() => setEditingUser(null)}
                  className="flex-1 py-2 text-slate-600 hover:bg-slate-50 rounded transition font-medium"
                >
                  取消
                </button>
                <button 
                  type="submit" 
                  className="flex-1 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded shadow-md transition font-medium"
                >
                  儲存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminSettings({ admins, adminUser, orders, menuItems, usersList, showNotify }) {
  const [editingAdmin, setEditingAdmin] = useState(null); // The admin object being edited (or empty obj for new)
  const [showEditModal, setShowEditModal] = useState(false);

  // Backup Data Logic
  const handleBackupData = async () => {
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    
    zip.file("users.json", JSON.stringify(usersList, null, 2));
    zip.file("menu.json", JSON.stringify(menuItems, null, 2));
    zip.file("orders.json", JSON.stringify(orders, null, 2));
    zip.file("admins.json", JSON.stringify(admins.map(a => ({...a, pin: '***'})), null, 2)); // Redact PIN
    zip.file("README.txt", "YJ Order System Backup\nDate: " + new Date().toLocaleString());

    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = `yj_system_backup_${getTodayStr()}.zip`;
    link.click();
  };

  // Mock Backup Source Logic (Since we can't easily get the JSX source at runtime in this env)
  const handleBackupSource = () => {
     const htmlContent = document.documentElement.outerHTML;
     const blob = new Blob([htmlContent], {type: "text/html;charset=utf-8"});
     const link = document.createElement("a");
     link.href = URL.createObjectURL(blob);
     link.download = `yj_order_app_snapshot_${getTodayStr()}.html`;
     link.click();
     showNotify('success', '已下載目前頁面快照');
  };

  // --- Admin Management Logic ---
  const handleEditAdmin = (admin = null) => {
    if (admin) {
      setEditingAdmin({ ...admin });
    } else {
      // New Admin
      setEditingAdmin({ username: '', name: '', pin: '', role: 'normal' });
    }
    setShowEditModal(true);
  };

  const handleDeleteAdmin = async (id) => {
    if (!confirm('確定要刪除此管理員帳號嗎？')) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'adminUsers', id));
      showNotify('success', '已刪除管理員');
    } catch (e) {
      showNotify('error', '刪除失敗');
    }
  };

  const handleSaveAdmin = async (e) => {
    e.preventDefault();
    if (!editingAdmin.username || !editingAdmin.name || !editingAdmin.pin) {
      return showNotify('error', '請填寫完整資訊');
    }
    
    try {
      if (editingAdmin.id) {
        // Update
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'adminUsers', editingAdmin.id), editingAdmin);
        showNotify('success', '已更新管理員資訊');
      } else {
        // Create (Check unique username locally first)
        if (admins.find(a => a.username === editingAdmin.username)) {
          return showNotify('error', '此帳號已存在');
        }
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'adminUsers'), editingAdmin);
        showNotify('success', '已新增管理員');
      }
      setShowEditModal(false);
      setEditingAdmin(null);
    } catch (e) {
      console.error(e);
      showNotify('error', '儲存失敗');
    }
  };

  return (
    <div className="space-y-8 max-w-4xl animate-fade-in">
      
      {/* Admin List */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="font-bold text-slate-700 flex items-center gap-2">
            <Shield size={18} /> 管理員帳號
          </div>
          <button 
            onClick={() => handleEditAdmin(null)}
            className="flex items-center gap-1 text-xs bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700 transition"
          >
            <Plus size={14} /> 新增管理員
          </button>
        </div>

        {/* Header Row */}
        <div className="grid grid-cols-12 gap-4 p-4 bg-slate-50/50 text-xs font-bold text-slate-500 border-b border-slate-100 hidden md:grid">
          <div className="col-span-3">帳號 (Login ID)</div>
          <div className="col-span-3">姓名 (別名)</div>
          <div className="col-span-3">權限</div>
          <div className="col-span-3 text-right">操作</div>
        </div>

        <div className="divide-y divide-slate-100">
          {admins.map(a => (
            <div key={a.id} className="p-4 flex flex-col md:grid md:grid-cols-12 gap-4 items-center hover:bg-slate-50 transition">
              
              {/* Username */}
              <div className="col-span-3 w-full flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold shrink-0">
                  {a.username[0].toUpperCase()}
                </div>
                <div>
                  <div className="md:hidden text-xs text-slate-400 mb-0.5">帳號</div>
                  <div className="font-mono font-medium text-slate-700">{a.username}</div>
                </div>
              </div>

              {/* Name */}
              <div className="col-span-3 w-full">
                <div className="md:hidden text-xs text-slate-400 mb-0.5">姓名</div>
                <div className="font-bold text-slate-800">{a.name}</div>
              </div>

              {/* Role */}
              <div className="col-span-3 w-full">
                <div className="md:hidden text-xs text-slate-400 mb-0.5">權限</div>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  a.role === 'super' ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-800'
                }`}>
                  {a.role === 'super' ? '最高權限' : '一般管理員'}
                </span>
              </div>

              {/* Actions */}
              <div className="col-span-3 w-full flex justify-end gap-2">
                <button 
                  onClick={() => handleEditAdmin(a)}
                  className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition"
                  title="編輯"
                >
                  <Edit size={16} />
                </button>
                
                {/* Allow delete if current user is super admin AND not deleting self */}
                {adminUser.role === 'super' && a.id !== adminUser.id && (
                   <button 
                     onClick={() => handleDeleteAdmin(a.id)}
                     className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                     title="刪除"
                   >
                     <Trash2 size={16} />
                   </button>
                )}
              </div>
            </div>
          ))}
          {admins.length === 0 && (
            <div className="p-8 text-center text-slate-400 text-sm">暫無管理員資料</div>
          )}
        </div>
      </div>

      {/* Backup Section */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-slate-700 flex items-center gap-2">
          <Save size={18} /> 系統備份與還原
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <button 
            onClick={handleBackupData}
            className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-indigo-200 rounded-xl hover:bg-indigo-50 hover:border-indigo-400 transition group"
          >
            <Download size={32} className="text-indigo-400 mb-3 group-hover:scale-110 transition" />
            <span className="font-bold text-slate-700">下載資料備份</span>
            <span className="text-xs text-slate-500 mt-1">JSON 格式 (訂單/菜單/人員)</span>
          </button>

          <button 
            onClick={handleBackupSource}
            className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-400 transition group"
          >
            <Settings size={32} className="text-slate-400 mb-3 group-hover:scale-110 transition group-hover:rotate-90" />
            <span className="font-bold text-slate-700">下載原始碼快照</span>
            <span className="text-xs text-slate-500 mt-1">目前運行的 HTML 結構</span>
          </button>
        </div>
      </div>

      <div className="text-center text-slate-400 text-xs mt-8">
        YJ-Order System v1.1.0
      </div>

      {/* Edit Admin Modal */}
      {showEditModal && editingAdmin && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6">
            <h3 className="text-xl font-bold mb-4 text-slate-800">
              {editingAdmin.id ? '編輯管理員' : '新增管理員'}
            </h3>
            <form onSubmit={handleSaveAdmin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">帳號 (Login ID)</label>
                <input 
                  type="text" 
                  required 
                  value={editingAdmin.username}
                  onChange={e => setEditingAdmin({...editingAdmin, username: e.target.value})}
                  className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="英數字組合"
                  disabled={!!editingAdmin.id} // Disable username edit if updating
                />
                {editingAdmin.id && <p className="text-xs text-slate-400 mt-1">帳號建立後無法修改</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">姓名 (別名)</label>
                <input 
                  type="text" 
                  required 
                  value={editingAdmin.name}
                  onChange={e => setEditingAdmin({...editingAdmin, name: e.target.value})}
                  className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="顯示名稱"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">PIN 碼 (密碼)</label>
                <div className="relative">
                  <input 
                    type="text" 
                    required 
                    value={editingAdmin.pin}
                    onChange={e => setEditingAdmin({...editingAdmin, pin: e.target.value})}
                    className="w-full p-2 pl-10 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                    placeholder="6位數密碼"
                  />
                  <Key size={16} className="absolute left-3 top-2.5 text-slate-400" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">權限</label>
                <select 
                  value={editingAdmin.role}
                  onChange={e => setEditingAdmin({...editingAdmin, role: e.target.value})}
                  className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="normal">一般管理員</option>
                  <option value="super">最高權限管理員</option>
                </select>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-100 mt-6">
                <button 
                  type="button" 
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 py-2 text-slate-600 hover:bg-slate-50 rounded transition font-medium"
                >
                  取消
                </button>
                <button 
                  type="submit" 
                  className="flex-1 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded shadow-md transition font-medium"
                >
                  確認儲存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

// --- Login Modal ---
function LoginModal({ admins, onLogin, onCancel }) {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [keepLoggedIn, setKeepLoggedIn] = useState(false);
  const [error, setError] = useState('');
  const [initializing, setInitializing] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    const admin = admins.find(a => a.username === username);
    if (admin && admin.pin === pin) {
      onLogin(admin, keepLoggedIn);
    } else {
      setError('帳號或 PIN 碼錯誤');
      setPin('');
    }
  };

  // Quick Initialize for empty system
  const handleInitDefaults = async () => {
    setInitializing(true);
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'adminUsers'), {
        username: 'admin',
        name: 'System Admin',
        pin: '123456',
        role: 'super'
      });
      // Pre-fill the form for convenience
      setUsername('admin');
      setPin('123456');
      setError('');
    } catch (e) {
      console.error(e);
      setError('初始化失敗，請檢查網路');
    } finally {
      setInitializing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-8 transform transition-all scale-100">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield size={32} />
          </div>
          <h2 className="text-2xl font-bold text-slate-800">管理員登入</h2>
          <p className="text-slate-500 text-sm mt-1">請輸入帳號與安全碼</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">帳號</label>
            <input 
              type="text" 
              required 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition"
              placeholder="admin"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">PIN 碼</label>
            <input 
              type="password" 
              required 
              maxLength="6"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition tracking-widest text-center text-lg"
              placeholder="••••"
            />
          </div>

          <div className="flex items-center gap-2 px-1">
            <input 
              type="checkbox" 
              id="keepLoggedIn"
              checked={keepLoggedIn}
              onChange={(e) => setKeepLoggedIn(e.target.checked)}
              className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
            />
            <label htmlFor="keepLoggedIn" className="text-sm text-slate-600 cursor-pointer select-none">
              保持登入狀態
            </label>
          </div>
          
          {error && <div className="text-red-500 text-sm text-center font-medium bg-red-50 p-2 rounded">{error}</div>}

          <button type="submit" className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-lg shadow-indigo-200 transition transform active:scale-95">
            進入系統
          </button>
        </form>

        {/* Auto-Init Button if no admins exist */}
        {admins.length === 0 && (
          <div className="mt-6 pt-6 border-t border-slate-100 text-center animate-pulse">
            <p className="text-xs text-slate-500 mb-2">系統偵測到尚無管理員</p>
            <button 
              onClick={handleInitDefaults}
              disabled={initializing}
              className="text-sm text-indigo-600 hover:text-indigo-800 font-bold underline disabled:opacity-50"
            >
              {initializing ? '建立中...' : '按此初始化預設帳號 (admin / 123456)'}
            </button>
          </div>
        )}

        <button onClick={onCancel} className="w-full mt-4 py-2 text-slate-400 hover:text-slate-600 text-sm font-medium">
          返回前台
        </button>
      </div>
    </div>
  );
}