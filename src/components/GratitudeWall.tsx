import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { collection, addDoc, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { Heart, Send, User, Sparkles, AlertCircle } from 'lucide-react';
import { playClick, playChime } from '../lib/audio';
import { Employee, GratitudeMessage } from '../types';

interface GratitudeWallProps {
  employees?: Employee[];
  currentUserId?: string;
  currentUserName?: string;
}

const PALETTES = [
  { id: 'sunset', label: 'Ấm Áp (Sunset)', bg: 'bg-amber-50 dark:bg-amber-950/20', border: 'border-amber-200 dark:border-amber-900/30', text: 'text-amber-800 dark:text-amber-200', dot: 'bg-amber-500' },
  { id: 'rose', label: 'Ngọt Ngào (Rose)', bg: 'bg-rose-50 dark:bg-rose-950/20', border: 'border-rose-200 dark:border-rose-900/30', text: 'text-rose-800 dark:text-rose-200', dot: 'bg-rose-500' },
  { id: 'forest', label: 'Tươi Mát (Mint)', bg: 'bg-emerald-50 dark:bg-emerald-950/20', border: 'border-emerald-200 dark:border-emerald-900/30', text: 'text-emerald-800 dark:text-emerald-200', dot: 'bg-emerald-500' },
  { id: 'sky', label: 'Thanh Thản (Sky)', bg: 'bg-sky-50 dark:bg-sky-950/20', border: 'border-sky-200 dark:border-sky-900/30', text: 'text-sky-800 dark:text-sky-200', dot: 'bg-sky-500' },
];

export default function GratitudeWall({ employees: propEmployees, currentUserId: propUserId, currentUserName: propUserName }: GratitudeWallProps) {
  const [messages, setMessages] = useState<GratitudeMessage[]>([]);
  const [localEmployees, setLocalEmployees] = useState<Employee[]>([]);
  const [receiverName, setReceiverName] = useState('');
  const [customReceiver, setCustomReceiver] = useState('');
  const [text, setText] = useState('');
  const [paletteId, setPaletteId] = useState('sunset');
  const [isSending, setIsSending] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);

  const [activeUserId, setActiveUserId] = useState('unknown');
  const [activeUserName, setActiveUserName] = useState('Đồng nghiệp ẩn danh 🌸');

  const finalEmployees = propEmployees || localEmployees;

  useEffect(() => {
    // If employees prop is not provided, load from Firestore in real-time
    if (!propEmployees) {
      const unsub = onSnapshot(collection(db, 'employees'), (snapshot) => {
        const emps: Employee[] = [];
        snapshot.forEach((doc) => {
          emps.push({ id: doc.id, ...doc.data() } as Employee);
        });
        setLocalEmployees(emps);
      });
      return () => unsub();
    }
  }, [propEmployees]);

  useEffect(() => {
    // Resolve session
    try {
      const saved = localStorage.getItem('payroll_session');
      if (saved) {
        const session = JSON.parse(saved);
        if (session.role === 'admin') {
          setActiveUserId('admin');
          setActiveUserName(propUserName || 'Quản trị viên 👑');
        } else if (session.role === 'manager') {
          setActiveUserId('manager');
          setActiveUserName(propUserName || 'Quản lý hệ thống 👔');
        } else if (session.role === 'employee' && session.employeeId) {
          setActiveUserId(session.employeeId);
          // Find their name
          const match = finalEmployees.find(e => e.id === session.employeeId);
          if (match) {
            setActiveUserName(match.name);
          } else {
            setActiveUserName(`Nhân viên (${session.employeeId})`);
          }
        }
      }
    } catch (e) {
      console.warn("Error reading session for gratitude wall:", e);
    }
  }, [finalEmployees, propUserName]);

  useEffect(() => {
    // Real-time listener for the gratitude wall collection
    const q = query(collection(db, 'gratitude_wall'), orderBy('createdAt', 'desc'), limit(50));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs: GratitudeMessage[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        msgs.push({
          id: doc.id,
          senderId: data.senderId || '',
          senderName: data.senderName || 'Ẩn danh',
          receiverName: data.receiverName || '',
          message: data.message || '',
          createdAt: data.createdAt || '',
          // Store palette inside message or map based on index for variety
          ...(data.paletteId ? { paletteId: data.paletteId } : {})
        } as any);
      });
      setMessages(msgs);
    }, (error) => {
      console.error("Error fetching gratitude wall:", error);
    });

    return () => unsubscribe();
  }, []);

  const handlePostMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    const finalReceiver = receiverName === 'custom' ? customReceiver.trim() : receiverName;
    if (!finalReceiver) {
      alert('Vui lòng chọn hoặc nhập tên đồng nghiệp cần gửi lời cảm ơn!');
      return;
    }

    setIsSending(true);
    playClick();

    const newMessage = {
      senderId: isAnonymous ? 'anonymous' : activeUserId,
      senderName: isAnonymous ? 'Đồng nghiệp ẩn danh 🌸' : activeUserName,
      receiverName: finalReceiver,
      message: text.trim(),
      paletteId: paletteId,
      createdAt: new Date().toISOString()
    };

    try {
      await addDoc(collection(db, 'gratitude_wall'), newMessage);
      setText('');
      setCustomReceiver('');
      playChime();
    } catch (err) {
      console.error("Failed to share gratitude message:", err);
      alert("Đã xảy ra lỗi khi gửi lời chúc. Vui lòng thử lại!");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div id="gratitude-wall" className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      
      {/* Input section */}
      <div className="lg:col-span-5 p-5 bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl h-fit space-y-4">
        <div className="flex items-center space-x-2 border-b border-[#f2f2ee] dark:border-[#2c2c28] pb-2">
          <Heart className="w-4.5 h-4.5 text-rose-500 fill-rose-500" />
          <h3 className="text-xs font-semibold font-mono text-[#1c1c1a] dark:text-[#fbfbfa] uppercase tracking-wider">
            Gửi Lời Cảm Ơn & Trân Trọng
          </h3>
        </div>

        <form onSubmit={handlePostMessage} className="space-y-4">
          
          {/* Receiver Choice */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold font-mono text-[#5c5c54] uppercase">Gửi Tới *</label>
            <select
              value={receiverName}
              onChange={(e) => {
                setReceiverName(e.target.value);
                playClick();
              }}
              className="w-full bg-white dark:bg-[#121211] border border-[#c8c8c0] dark:border-[#2c2c28] px-3 py-2 rounded-xl text-sm focus:outline-none text-[#1c1c1a] dark:text-white cursor-pointer"
              required
            >
              <option value="">-- Chọn đồng nghiệp --</option>
              {finalEmployees.map((emp) => (
                <option key={emp.id} value={emp.name}>
                  {emp.name} ({emp.role})
                </option>
              ))}
              <option value="Cả nhóm">Cả Đội Ngũ (Team)</option>
              <option value="custom">Nhập tên khác...</option>
            </select>
          </div>

          {receiverName === 'custom' && (
            <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-200">
              <label className="text-[11px] font-semibold font-mono text-[#5c5c54] uppercase">Tên Người Nhận *</label>
              <input
                type="text"
                placeholder="Ví dụ: Anh bếp trưởng, Chị quản ca..."
                value={customReceiver}
                onChange={(e) => setCustomReceiver(e.target.value)}
                className="w-full bg-white dark:bg-[#121211] border border-[#c8c8c0] dark:border-[#2c2c28] px-3 py-2 rounded-xl text-sm focus:outline-none text-[#1c1c1a] dark:text-white"
                required
              />
            </div>
          )}

          {/* Message text */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold font-mono text-[#5c5c54] uppercase">Lời cảm ơn của bạn *</label>
            <textarea
              rows={4}
              placeholder="Chia sẻ một khoảnh khắc bạn trân trọng sự giúp đỡ của họ, hoặc một lời khích lệ tích cực..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full bg-white dark:bg-[#121211] border border-[#c8c8c0] dark:border-[#2c2c28] px-3 py-2 rounded-xl text-sm focus:outline-none text-[#1c1c1a] dark:text-white placeholder-[#8c8c80]"
              maxLength={200}
              required
            />
            <span className="text-[10px] text-[#8c8c80] font-mono block text-right">{text.length}/200 ký tự</span>
          </div>

          {/* Background Palette */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold font-mono text-[#5c5c54] uppercase block">Chủ đề thiệp</label>
            <div className="grid grid-cols-4 gap-2">
              {PALETTES.map((p) => {
                const isSelected = paletteId === p.id;
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => {
                      setPaletteId(p.id);
                      playClick();
                    }}
                    className={`p-2 border rounded-xl text-[10px] font-medium transition-all cursor-pointer flex flex-col items-center justify-center space-y-1 ${
                      isSelected 
                        ? 'border-[#1c1c1a] dark:border-white ring-2 ring-amber-500/20' 
                        : 'border-[#e4e4db] dark:border-[#2c2c28] hover:bg-[#f2f2ee] dark:hover:bg-[#121211]'
                    }`}
                  >
                    <span className={`w-3 h-3 rounded-full ${p.dot}`} />
                    <span className="text-[9px] truncate text-[#5c5c54] dark:text-[#8c8c80]">{p.label.split(' ')[0]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Anonymous toggle */}
          <label className="flex items-center space-x-2 py-1 cursor-pointer">
            <input
              type="checkbox"
              checked={isAnonymous}
              onChange={(e) => {
                setIsAnonymous(e.target.checked);
                playClick();
              }}
              className="rounded-lg border-[#c8c8c0] dark:border-[#2c2c28] text-amber-600 focus:ring-amber-500 cursor-pointer"
            />
            <span className="text-xs text-[#5c5c54] dark:text-[#8c8c80] font-mono">Gửi ẩn danh (Người đồng nghiệp dễ mến)</span>
          </label>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSending}
            className="w-full bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] hover:bg-black dark:hover:bg-gray-100 py-2.5 rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer flex items-center justify-center space-x-1.5 disabled:opacity-55"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isSending ? 'Đang gửi...' : 'Gửi đi trân trọng'}</span>
          </button>
        </form>
      </div>

      {/* Masonry display wall */}
      <div className="lg:col-span-7 space-y-4">
        <div className="flex items-center justify-between border-b border-[#f2f2ee] dark:border-[#2c2c28] pb-2">
          <h3 className="text-xs font-semibold font-mono text-[#1c1c1a] dark:text-[#fbfbfa] uppercase tracking-wider">
            Bức Tường Biết Ơn ({messages.length})
          </h3>
          <div className="flex items-center space-x-1 text-[11px] text-amber-600 font-mono">
            <Sparkles className="w-3 h-3 animate-bounce" />
            <span>Đồng bộ thời gian thực</span>
          </div>
        </div>

        {messages.length === 0 ? (
          <div className="p-12 text-center bg-[#fbfbfa] dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl space-y-2">
            <AlertCircle className="w-8 h-8 text-[#8c8c80] mx-auto animate-pulse" />
            <p className="text-xs text-[#5c5c54] dark:text-[#8c8c80] font-mono font-medium">Bức tường hiện tại đang trống.</p>
            <p className="text-[11px] text-[#8c8c80]">Hãy là người đầu tiên trao gửi sự tử tế và biết ơn ngày hôm nay!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[500px] overflow-y-auto pr-1">
            {messages.map((msg) => {
              const palette = PALETTES.find((p) => p.id === (msg as any).paletteId) || PALETTES[0];
              const dateObj = msg.createdAt ? new Date(msg.createdAt) : new Date();
              const formattedDate = dateObj.toLocaleDateString('vi-VN', {
                hour: '2-digit',
                minute: '2-digit',
                day: 'numeric',
                month: 'numeric'
              });

              return (
                <div
                  key={msg.id}
                  className={`p-4 border rounded-2xl flex flex-col justify-between space-y-3 shadow-xs hover:shadow-md transition-all duration-300 ${palette.bg} ${palette.border} ${palette.text}`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase tracking-widest bg-white/60 dark:bg-black/20 px-2 py-0.5 rounded-full font-bold">
                        Gửi: {msg.receiverName}
                      </span>
                      <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
                    </div>
                    
                    <p className="text-xs italic leading-relaxed whitespace-pre-wrap font-medium">
                      "{msg.message}"
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-[#1c1c1a]/5 dark:border-white/5 text-[10px] font-mono opacity-80">
                    <div className="flex items-center space-x-1">
                      <User className="w-3 h-3" />
                      <span>{msg.senderName}</span>
                    </div>
                    <span>{formattedDate}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
