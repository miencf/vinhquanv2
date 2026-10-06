import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Edit2, Check } from 'lucide-react';
import { getLunarDateString } from '../utils/lunar';

export default function Clock() {
  const [time, setTime] = useState(new Date());
  const [name, setName] = useState(() => {
    return localStorage.getItem('ambient_user_name') || '';
  });
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(name);

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const getGreeting = () => {
    const hours = time.getHours();
    if (hours >= 5 && hours < 12) return 'Chào buổi sáng';
    if (hours >= 12 && hours < 18) return 'Chào buổi chiều';
    if (hours >= 18 && hours < 22) return 'Chào buổi tối';
    return 'Chúc bạn đêm muộn an lành';
  };

  const getFormattedDate = () => {
    const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    const dayName = days[time.getDay()];
    const date = time.getDate();
    const month = time.getMonth() + 1;
    const year = time.getFullYear();
    return `${dayName}, ngày ${date} tháng ${month}, ${year}`;
  };

  const handleSaveName = () => {
    const trimmed = tempName.trim();
    setName(trimmed);
    localStorage.setItem('ambient_user_name', trimmed);
    setIsEditingName(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveName();
    } else if (e.key === 'Escape') {
      setTempName(name);
      setIsEditingName(false);
    }
  };

  // Pad time helpers for elegant monospace spacing
  const formatTimeToken = (num: number) => num.toString().padStart(2, '0');

  return (
    <div id="clock-widget" className="flex flex-col items-center md:items-start space-y-4">
      {/* Time Display */}
      <div className="flex items-baseline space-x-1 font-mono text-6xl sm:text-7xl md:text-8xl font-light tracking-tight text-[#1c1c1a] dark:text-white">
        <span>{formatTimeToken(time.getHours())}</span>
        <span className="animate-pulse opacity-80 text-[#8c8c80]">:</span>
        <span>{formatTimeToken(time.getMinutes())}</span>
        <span className="text-2xl sm:text-3xl md:text-4xl text-[#8c8c80] font-normal ml-2">
          {formatTimeToken(time.getSeconds())}
        </span>
      </div>

      {/* Greeting and Editable Name */}
      <div className="flex flex-col items-center md:items-start space-y-1">
        <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 text-lg sm:text-xl md:text-2xl text-[#5c5c54] dark:text-[#acaca0]">
          <span>{getGreeting()}</span>
          
          <AnimatePresence mode="wait">
            {isEditingName ? (
              <motion.div
                key="edit-name"
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 5 }}
                className="inline-flex items-center space-x-1"
              >
                <input
                  type="text"
                  maxLength={16}
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="bg-[#f2f2ee] dark:bg-[#2c2c28] border-b border-[#c8c8c0] dark:border-[#5c5c54] px-1 font-medium text-[#1c1c1a] dark:text-white focus:outline-none focus:border-[#5c5c54] rounded-sm text-base py-0.5 max-w-[120px] md:max-w-[160px]"
                  placeholder="tên của bạn..."
                  autoFocus
                />
                <button
                  onClick={handleSaveName}
                  aria-label="Lưu tên"
                  className="p-1 hover:bg-[#e4e4db] dark:hover:bg-[#2c2c28] rounded-full transition-colors text-emerald-600"
                >
                  <Check className="w-4 h-4" />
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="view-name"
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 5 }}
                className="inline-flex items-center space-x-1 group"
              >
                <span className="font-semibold text-[#1c1c1a] dark:text-white border-b border-transparent group-hover:border-[#c8c8c0] transition-colors cursor-pointer" onClick={() => setIsEditingName(true)}>
                  {name || 'bạn'}
                </span>
                <button
                  onClick={() => setIsEditingName(true)}
                  aria-label="Đổi tên"
                  className="p-1 hover:bg-[#e4e4db] dark:hover:bg-[#2c2c28] rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-[#8c8c80]"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          
          <Sparkles className="w-5 h-5 text-amber-500/80 animate-pulse inline ml-0.5" />
        </div>

        {/* Calendar formatted date */}
        <p className="text-sm font-medium text-[#8c8c80]">{getFormattedDate()}</p>
        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mt-1">{getLunarDateString(time)}</p>
      </div>
    </div>
  );
}
