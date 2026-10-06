import { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Flame } from 'lucide-react';
import { playChime, playTick, playClick } from '../lib/audio';

type TimerPreset = {
  label: string;
  minutes: number;
};

const PRESETS: TimerPreset[] = [
  { label: 'Thư giãn', minutes: 5 },
  { label: 'Tập trung', minutes: 25 },
  { label: 'Sâu sắc', minutes: 45 },
  { label: 'Bền bỉ', minutes: 60 },
];

export default function FocusTimer() {
  const [selectedMinutes, setSelectedMinutes] = useState(25);
  const [secondsRemaining, setSecondsRemaining] = useState(25 * 60);
  const [isActive, setIsActive] = useState(false);
  const [sessionsCompleted, setSessionsCompleted] = useState(() => {
    return Number(localStorage.getItem('ambient_sessions_completed')) || 0;
  });

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Re-initialize timer if the user selects a different preset while inactive
  useEffect(() => {
    if (!isActive) {
      setSecondsRemaining(selectedMinutes * 60);
    }
  }, [selectedMinutes, isActive]);

  useEffect(() => {
    if (isActive) {
      intervalRef.current = setInterval(() => {
        setSecondsRemaining((prev) => {
          if (prev <= 1) {
            // Reached completion
            setIsActive(false);
            if (intervalRef.current) clearInterval(intervalRef.current);
            playChime();
            setSessionsCompleted((current) => {
              const updated = current + 1;
              localStorage.setItem('ambient_sessions_completed', String(updated));
              return updated;
            });
            return selectedMinutes * 60;
          }
          
          // Play a delicate tick in the last 3 seconds
          if (prev <= 4) {
            playTick();
          }

          return prev - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive, selectedMinutes]);

  const toggleTimer = () => {
    playClick();
    setIsActive(!isActive);
  };

  const resetTimer = () => {
    playClick();
    setIsActive(false);
    setSecondsRemaining(selectedMinutes * 60);
  };

  const selectPreset = (mins: number) => {
    if (isActive) {
      if (confirm('Bạn có muốn hủy lượt đếm hiện tại để chuyển sang chế độ mới?')) {
        setIsActive(false);
        setSelectedMinutes(mins);
        setSecondsRemaining(mins * 60);
      }
    } else {
      setSelectedMinutes(mins);
      setSecondsRemaining(mins * 60);
    }
  };

  // Calculations for SVGs
  const totalSeconds = selectedMinutes * 60;
  const progressPercent = ((totalSeconds - secondsRemaining) / totalSeconds) * 100;
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

  const formatTime = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div id="focus-timer" className="p-6 rounded-2xl bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] shadow-xs flex flex-col items-center">
      <div className="w-full flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold tracking-wider text-[#8c8c80] uppercase">Đồng hồ Tập trung</h3>
        <div className="flex items-center space-x-1 px-2.5 py-1 bg-[#fbfbfa] dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] rounded-full text-xs font-mono font-medium text-[#5c5c54] dark:text-[#acaca0]">
          <Flame className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
          <span>{sessionsCompleted} Chu kỳ</span>
        </div>
      </div>

      {/* Preset Selectors */}
      <div className="flex w-full justify-between gap-1.5 mb-6">
        {PRESETS.map((p) => {
          const isSelected = selectedMinutes === p.minutes;
          return (
            <button
              key={p.minutes}
              onClick={() => selectPreset(p.minutes)}
              className={`flex-1 py-1.5 px-1 rounded-lg text-xs font-medium transition-all ${
                isSelected
                  ? 'bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] shadow-xs'
                  : 'bg-[#fbfbfa] dark:bg-[#121211] text-[#5c5c54] dark:text-[#acaca0] border border-[#e4e4db] dark:border-[#2c2c28] hover:bg-[#f2f2ee] dark:hover:bg-[#2c2c28]'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Visual Circle & Time */}
      <div className="relative flex items-center justify-center w-48 h-48 mb-6">
        {/* Progress Circle SVG */}
        <svg className="w-full h-full transform -rotate-90">
          {/* Track Circle */}
          <circle
            cx="96"
            cy="96"
            r={radius}
            className="stroke-[#f2f2ee] dark:stroke-[#2c2c28]"
            strokeWidth="6"
            fill="transparent"
          />
          {/* Animated Progress Circle */}
          <circle
            cx="96"
            cy="96"
            r={radius}
            className="stroke-[#1c1c1a] dark:stroke-white transition-all duration-300 ease-out"
            strokeWidth="6"
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        </svg>

        {/* Floating Digital Countdown */}
        <div className="absolute flex flex-col items-center justify-center">
          <span className="text-4xl font-mono font-light text-[#1c1c1a] dark:text-white tracking-tight">
            {formatTime(secondsRemaining)}
          </span>
          <span className="text-[10px] uppercase font-mono tracking-widest text-[#8c8c80] mt-1">
            {isActive ? 'đang chạy' : 'tạm dừng'}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center space-x-4">
        <button
          onClick={resetTimer}
          title="Đặt lại"
          className="p-3 bg-[#fbfbfa] dark:bg-[#121211] text-[#5c5c54] dark:text-[#acaca0] border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl hover:bg-[#f2f2ee] dark:hover:bg-[#2c2c28] transition-all hover:scale-102 active:scale-98"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <button
          onClick={toggleTimer}
          className={`flex items-center space-x-2 px-6 py-3 rounded-xl font-medium transition-all hover:scale-102 active:scale-98 shadow-sm ${
            isActive
              ? 'bg-[#c2410c] text-white hover:bg-[#ea580c]'
              : 'bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] hover:bg-[#2c2c28] dark:hover:bg-gray-100'
          }`}
        >
          {isActive ? (
            <>
              <Pause className="w-4 h-4 fill-white" />
              <span>Tạm dừng</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-white" />
              <span>Bắt đầu</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
