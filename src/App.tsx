import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Clock from './components/Clock';
import FocusTimer from './components/FocusTimer';
import Scratchpad from './components/Scratchpad';
import BreathingGuide from './components/BreathingGuide';
import QuoteBox from './components/QuoteBox';
import PayrollManager from './components/PayrollManager';
import LunarCalendarPopup from './components/LunarCalendarPopup';
import AmbientSoundscapes from './components/AmbientSoundscapes';
import GratitudeWall from './components/GratitudeWall';
import { Compass, Sparkles, Briefcase, Sun, Moon, Music, Heart, Target } from 'lucide-react';

export default function App() {
  const [currentMode, setCurrentMode] = useState<'ambient' | 'payroll'>('payroll');
  const [ambientSubTab, setAmbientSubTab] = useState<'focus' | 'sounds' | 'gratitude'>('focus');
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark';
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      document.body.style.backgroundColor = '#090a0f';
    } else {
      document.documentElement.classList.remove('dark');
      document.body.style.backgroundColor = '#f8fafc';
    }
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  return (
    <div className="min-h-screen flex flex-col justify-between bg-[#fbfbfa] dark:bg-[#121211] text-[#1c1c1a] dark:text-[#fbfbfa] p-4 sm:p-6 md:p-8">
      {/* Upper Subtle Branding */}
      <header className="max-w-6xl w-full mx-auto flex flex-col sm:flex-row items-stretch sm:items-center justify-between border-b border-[#f2f2ee] dark:border-[#2c2c28] pb-4 mb-6 md:mb-10 gap-4">
        
        {/* Left Logo / Branding */}
        <div className="flex items-center space-x-2 text-[#5c5c54] dark:text-[#acaca0]">
          <Compass className="w-5 h-5 text-amber-600 animate-spin-slow" style={{ animationDuration: '12s' }} />
          <h1 className="text-sm font-semibold tracking-wider uppercase font-mono">Tĩnh Lặng • Ambient</h1>
        </div>

        {/* Center Mode Selection Toggles */}
        <div className="flex bg-[#f2f2ee] dark:bg-[#1c1c1a] p-1 rounded-xl border border-[#e4e4db] dark:border-[#2c2c28]">
          <button
            onClick={() => setCurrentMode('ambient')}
            className={`flex items-center space-x-2 px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${
              currentMode === 'ambient'
                ? 'bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] shadow-xs'
                : 'text-[#5c5c54] dark:text-[#acaca0] hover:bg-[#e4e4db] dark:hover:bg-[#2c2c28] hover:text-[#1c1c1a] dark:hover:text-white'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Không Gian Tĩnh Lặng</span>
          </button>
          <button
            onClick={() => setCurrentMode('payroll')}
            className={`flex items-center space-x-2 px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${
              currentMode === 'payroll'
                ? 'bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] shadow-xs'
                : 'text-[#5c5c54] dark:text-[#acaca0] hover:bg-[#e4e4db] dark:hover:bg-[#2c2c28] hover:text-[#1c1c1a] dark:hover:text-white'
            }`}
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span>Chấm Công & Lương</span>
          </button>
        </div>

        {/* Right Status badge + Dark Mode Switch */}
        <div className="flex items-center justify-between sm:justify-end space-x-3 text-xs text-[#8c8c80] dark:text-[#acaca0] font-mono">
          <div className="hidden md:flex items-center space-x-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
            <span>Hệ Thống Tự Động</span>
          </div>

          <button
            onClick={() => setDarkMode(!darkMode)}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#f2f2ee] dark:bg-[#1c1c1a] hover:bg-[#e4e4db] dark:hover:bg-[#2c2c28] rounded-xl border border-[#e4e4db] dark:border-[#2c2c28] text-[#5c5c54] dark:text-[#acaca0] hover:text-[#1c1c1a] dark:hover:text-white font-semibold transition-all cursor-pointer"
            aria-label="Đổi chế độ sáng tối"
          >
            {darkMode ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-[11px] font-sans">Giao diện: Tối</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-[#5c5c54]" />
                <span className="text-[11px] font-sans">Giao diện: Sáng</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Responsive Grid Container */}
      <AnimatePresence mode="wait">
        {currentMode === 'ambient' ? (
          <motion.div
            key="ambient-mode"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.35, ease: 'easeInOut' }}
            className="max-w-6xl w-full mx-auto flex-1 flex flex-col space-y-6"
          >
            {/* Sub-tabs within Ambient mode */}
            <div className="flex border-b border-[#f2f2ee] dark:border-[#2c2c28] pb-1 gap-6 text-xs font-mono font-bold tracking-wider uppercase">
              <button
                onClick={() => setAmbientSubTab('focus')}
                className={`pb-2.5 transition-all cursor-pointer border-b-2 flex items-center space-x-1.5 ${
                  ambientSubTab === 'focus'
                    ? 'border-[#1c1c1a] dark:border-white text-[#1c1c1a] dark:text-[#fbfbfa]'
                    : 'border-transparent text-[#8c8c80] dark:text-[#acaca0] hover:text-[#1c1c1a] dark:hover:text-white'
                }`}
              >
                <Target className="w-3.5 h-3.5" />
                <span>Phòng Tập Tập Trung</span>
              </button>
              <button
                onClick={() => setAmbientSubTab('sounds')}
                className={`pb-2.5 transition-all cursor-pointer border-b-2 flex items-center space-x-1.5 ${
                  ambientSubTab === 'sounds'
                    ? 'border-[#1c1c1a] dark:border-white text-[#1c1c1a] dark:text-[#fbfbfa]'
                    : 'border-transparent text-[#8c8c80] dark:text-[#acaca0] hover:text-[#1c1c1a] dark:hover:text-white'
                }`}
              >
                <Music className="w-3.5 h-3.5" />
                <span>Âm Thanh Thư Giãn</span>
              </button>
              <button
                onClick={() => setAmbientSubTab('gratitude')}
                className={`pb-2.5 transition-all cursor-pointer border-b-2 flex items-center space-x-1.5 ${
                  ambientSubTab === 'gratitude'
                    ? 'border-[#1c1c1a] dark:border-white text-[#1c1c1a] dark:text-[#fbfbfa]'
                    : 'border-transparent text-[#8c8c80] dark:text-[#acaca0] hover:text-[#1c1c1a] dark:hover:text-white'
                }`}
              >
                <Heart className="w-3.5 h-3.5" />
                <span>Góc Biết Ơn</span>
              </button>
            </div>

            {/* Sub-tab Views */}
            <div className="flex-1">
              {ambientSubTab === 'focus' && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                  {/* Left Column (Clocks, Breathing Guide, Quotes) */}
                  <div className="col-span-1 md:col-span-6 flex flex-col space-y-6">
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5 }}
                      className="p-6 rounded-2xl bg-white border border-[#e4e4db] dark:border-[#2c2c28] dark:bg-[#1c1c1a]/90 shadow-xs"
                    >
                      <Clock />
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.1 }}
                    >
                      <BreathingGuide />
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.2 }}
                    >
                      <QuoteBox />
                    </motion.div>
                  </div>

                  {/* Right Column (Focus Timer, Scratchpad) */}
                  <div className="col-span-1 md:col-span-6 flex flex-col space-y-6">
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.05 }}
                    >
                      <FocusTimer />
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.15 }}
                      className="h-full"
                    >
                      <Scratchpad />
                    </motion.div>
                  </div>
                </div>
              )}

              {ambientSubTab === 'sounds' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  <AmbientSoundscapes />
                </motion.div>
              )}

              {ambientSubTab === 'gratitude' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  <GratitudeWall />
                </motion.div>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.main
            key="payroll-mode"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.35, ease: 'easeInOut' }}
            className="max-w-6xl w-full mx-auto flex-1"
          >
            <PayrollManager />
          </motion.main>
        )}
      </AnimatePresence>

      {/* Footer Details */}
      <footer className="max-w-6xl w-full mx-auto border-t border-[#f2f2ee] dark:border-[#2c2c28] pt-4 mt-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#8c8c80] dark:text-[#acaca0] font-mono">
        <p>© 2026 Không gian Tập trung & Quản lý Toàn diện.</p>
        <div className="flex items-center space-x-3">
          <span>HTML • CSS • JS</span>
          <span>•</span>
          <span>Bảo mật Ngoại tuyến (Offline-First)</span>
        </div>
      </footer>

      {/* Floating Lunar Calendar Popup */}
      <LunarCalendarPopup />
    </div>
  );
}
