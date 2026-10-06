import React, { useState } from 'react';
import { Calendar as CalendarIcon, X, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getLunarDate, LunarDate } from '../utils/lunar';

export default function LunarCalendarPopup() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth(); // 0-indexed

  // Months of year in Vietnamese
  const vietMonths = [
    'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4',
    'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8',
    'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'
  ];

  // Days of week header
  const daysOfWeek = ['Hai', 'Ba', 'Tư', 'Năm', 'Sáu', 'Bảy', 'CN'];

  // Handle month changes
  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const handleGoToday = () => {
    setCurrentDate(new Date());
  };

  // Generate 42 calendar grid dates
  const generateGridDates = () => {
    const startOfMonth = new Date(year, month, 1);
    const startDayOfWeek = startOfMonth.getDay(); // 0: Sun, 1: Mon, ...
    
    // Number of padding days from previous month (we want Monday as start of week)
    const prevDaysCount = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;
    
    const dates: Date[] = [];
    const gridStartDate = new Date(year, month, 1 - prevDaysCount);
    
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStartDate);
      d.setDate(gridStartDate.getDate() + i);
      dates.push(d);
    }
    return dates;
  };

  const gridDates = generateGridDates();
  const today = new Date();

  const isToday = (date: Date) => {
    return date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();
  };

  const isSameMonth = (date: Date) => {
    return date.getMonth() === month && date.getFullYear() === year;
  };

  return (
    <>
      {/* Floating fixed button at bottom right */}
      <button
        id="lunar-calendar-floating-btn"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center justify-center w-12 h-12 bg-[#1c1c1a] dark:bg-[#fbfbfa] text-white dark:text-[#1c1c1a] hover:scale-105 active:scale-95 rounded-full shadow-lg transition-all border border-[#e4e4db] dark:border-[#2c2c28] cursor-pointer group"
        title="Xem Lịch Âm Dương"
        aria-label="Xem Lịch Âm Dương"
      >
        <CalendarIcon className="w-5 h-5 group-hover:rotate-6 transition-transform" />
      </button>

      {/* Modal Popup Overlay */}
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            {/* Click outside to close */}
            <div className="absolute inset-0" onClick={() => setIsOpen(false)} />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="relative w-full max-w-lg bg-white dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl shadow-2xl overflow-hidden z-10 flex flex-col"
            >
              {/* Header section */}
              <div className="flex items-center justify-between p-4 border-b border-[#f2f2ee] dark:border-[#2a2a28] bg-[#fbfbfa] dark:bg-[#181817]">
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-semibold tracking-wide text-[#5c5c54] dark:text-[#acaca0] uppercase font-mono">
                    Lịch Âm Dương 2026
                  </span>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 hover:bg-[#e4e4db] dark:hover:bg-[#2c2c28] rounded-full transition-colors text-[#8c8c80] hover:text-[#1c1c1a] dark:hover:text-[#fbfbfa] cursor-pointer"
                  aria-label="Đóng lịch"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Month Selection and Quick Nav */}
              <div className="flex items-center justify-between px-6 py-4">
                <h3 className="text-lg font-bold text-[#1c1c1a] dark:text-[#fbfbfa]">
                  {vietMonths[month]}, {year}
                </h3>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleGoToday}
                    className="px-3 py-1 bg-[#f2f2ee] dark:bg-[#2c2c28] hover:bg-[#e4e4db] dark:hover:bg-[#3c3c38] text-xs font-semibold rounded-lg transition-colors text-[#5c5c54] dark:text-[#acaca0] cursor-pointer"
                  >
                    Hôm nay
                  </button>
                  <button
                    onClick={handlePrevMonth}
                    className="p-1.5 bg-[#f2f2ee] dark:bg-[#2c2c28] hover:bg-[#e4e4db] dark:hover:bg-[#3c3c38] rounded-lg transition-colors text-[#5c5c54] dark:text-[#acaca0] cursor-pointer"
                    aria-label="Tháng trước"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleNextMonth}
                    className="p-1.5 bg-[#f2f2ee] dark:bg-[#2c2c28] hover:bg-[#e4e4db] dark:hover:bg-[#3c3c38] rounded-lg transition-colors text-[#5c5c54] dark:text-[#acaca0] cursor-pointer"
                    aria-label="Tháng sau"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Days of Week Headers */}
              <div className="grid grid-cols-7 gap-1 px-6 text-center text-xs font-mono font-semibold text-[#8c8c80] dark:text-[#6c6c64] uppercase border-b border-[#f2f2ee] dark:border-[#2a2a28] pb-2">
                {daysOfWeek.map((day) => (
                  <div key={day}>{day}</div>
                ))}
              </div>

              {/* Grid Cells */}
              <div className="grid grid-cols-7 gap-1 p-6 bg-[#fbfbfa] dark:bg-[#141413]">
                {gridDates.map((date, idx) => {
                  const sDay = date.getDate();
                  const lunar = getLunarDate(date);
                  const isCurrent = isSameMonth(date);
                  const isTodayCell = isToday(date);
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;

                  // Format lunar date string for cell
                  // If lunar day is 1, show day/month e.g. "1/5"
                  let lunarDisplay = lunar.day.toString();
                  if (lunar.day === 1) {
                    lunarDisplay = `1/${lunar.month}${lunar.isLeap ? 'n' : ''}`;
                  }

                  return (
                    <div
                      key={idx}
                      className={`relative min-h-[56px] sm:min-h-[64px] p-1 border rounded-xl flex flex-col justify-between transition-all select-none ${
                        isTodayCell
                          ? 'bg-[#1c1c1a] dark:bg-[#fbfbfa] border-[#1c1c1a] dark:border-[#fbfbfa] text-white dark:text-[#1c1c1a]'
                          : isCurrent
                          ? 'bg-white dark:bg-[#1c1c1a] border-[#e4e4db] dark:border-[#2c2c28] text-[#1c1c1a] dark:text-[#fbfbfa]'
                          : 'bg-[#f2f2ee]/50 dark:bg-[#2c2c28]/20 border-transparent text-[#acaca0] dark:text-[#5c5c54]'
                      }`}
                    >
                      {/* Solar Day (top right) */}
                      <div className="flex justify-between items-start">
                        {/* Lunar holiday/event dot indicator if day is 1 or 15 */}
                        {(lunar.day === 1 || lunar.day === 15) && isCurrent && (
                          <span
                            className={`w-1.5 h-1.5 rounded-full mt-1 ml-1 ${
                              isTodayCell ? 'bg-amber-400' : 'bg-rose-500'
                            }`}
                            title={lunar.day === 1 ? 'Mùng một đầu tháng' : 'Ngày rằm Trăng tròn'}
                          />
                        )}
                        <span className="ml-auto text-sm sm:text-base font-bold font-mono">
                          {sDay}
                        </span>
                      </div>

                      {/* Lunar Day (bottom left) */}
                      <div className="flex justify-between items-end mt-1">
                        <span
                          className={`text-[9px] sm:text-xs font-semibold font-mono tracking-tighter ${
                            isTodayCell
                              ? 'text-amber-400 dark:text-amber-600'
                              : isCurrent
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-amber-700/50 dark:text-amber-400/30'
                          }`}
                        >
                          {lunarDisplay}
                        </span>
                        
                        {isWeekend && isCurrent && !isTodayCell && (
                          <span className="text-[8px] font-mono text-red-500 font-bold uppercase leading-none opacity-80">
                            T7/CN
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Legend Footer */}
              <div className="p-4 bg-[#fbfbfa] dark:bg-[#181817] border-t border-[#f2f2ee] dark:border-[#2a2a28] flex justify-between text-[10px] sm:text-xs text-[#8c8c80] dark:text-[#acaca0]">
                <div className="flex items-center space-x-1.5">
                  <span className="w-2.5 h-2.5 rounded bg-white dark:bg-[#1c1c1a] border border-[#e4e4db] dark:border-[#2c2c28]" />
                  <span>Dương lịch</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-amber-700 dark:text-amber-400 font-bold">1/5</span>
                  <span>Mùng 1 (Âm lịch)</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                  <span>Mùng 1 / Ngày Rằm</span>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
