import { useState, useEffect, useRef } from 'react';
import { Wind, Play, Square } from 'lucide-react';

type BreathePhase = 'inhale' | 'hold-in' | 'exhale' | 'hold-out';

const PHASES: Record<BreathePhase, { text: string; duration: number; color: string; scale: string }> = {
  'inhale': { text: 'Hít vào chậm rãi...', duration: 4, color: 'bg-teal-100 dark:bg-teal-950/40 border-teal-300 dark:border-teal-850 text-teal-800 dark:text-teal-300', scale: 'scale-135' },
  'hold-in': { text: 'Giữ hơi thở...', duration: 4, color: 'bg-emerald-100 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-850 text-emerald-800 dark:text-emerald-300', scale: 'scale-135' },
  'exhale': { text: 'Thở ra nhẹ nhàng...', duration: 4, color: 'bg-amber-100 dark:bg-amber-950/40 border-amber-300 dark:border-amber-850 text-amber-800 dark:text-amber-300', scale: 'scale-100' },
  'hold-out': { text: 'Tĩnh lặng...', duration: 4, color: 'bg-stone-100 dark:bg-stone-900/60 border-stone-300 dark:border-stone-800 text-stone-800 dark:text-stone-300', scale: 'scale-100' },
};

export default function BreathingGuide() {
  const [isActive, setIsActive] = useState(false);
  const [phase, setPhase] = useState<BreathePhase>('inhale');
  const [secondsLeft, setSecondsLeft] = useState(4);
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isActive) {
      timerRef.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            // Transition to the next phase
            setPhase((currentPhase) => {
              const nextMap: Record<BreathePhase, BreathePhase> = {
                'inhale': 'hold-in',
                'hold-in': 'exhale',
                'exhale': 'hold-out',
                'hold-out': 'inhale'
              };
              const next = nextMap[currentPhase];
              setSecondsLeft(PHASES[next].duration);
              return next;
            });
            return 4; // default reset fallback, actually overriden by setPhase
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setPhase('inhale');
      setSecondsLeft(4);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isActive]);

  const toggleBreathing = () => {
    setIsActive(!isActive);
  };

  const currentPhaseConfig = PHASES[phase];

  return (
    <div id="breathing-guide" className="p-6 rounded-2xl bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] shadow-xs flex flex-col items-center h-full">
      {/* Header */}
      <div className="w-full flex items-center justify-between mb-6">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 bg-[#fbfbfa] dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] rounded-lg text-[#5c5c54] dark:text-[#acaca0]">
            <Wind className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-semibold tracking-wider text-[#8c8c80] uppercase">Thở Thiền Minh Triết</h3>
        </div>
        {isActive && (
          <span className="font-mono text-xs font-medium text-[#8c8c80]">
            {secondsLeft}s còn lại
          </span>
        )}
      </div>

      {/* Breathing Visualizer Stage */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-[160px] w-full relative">
        
        {/* Core Ring Backdrop */}
        <div className="absolute w-32 h-32 rounded-full border border-dashed border-[#e4e4db] dark:border-[#2c2c28]" />

        {/* Dynamic Pulsating Circle */}
        <div
          className={`w-28 h-28 rounded-full border-2 flex items-center justify-center transition-all duration-[4000ms] ease-in-out ${
            isActive ? `${currentPhaseConfig.color} ${currentPhaseConfig.scale} shadow-md` : 'bg-[#fbfbfa] dark:bg-[#121211] border-[#e4e4db] dark:border-[#2c2c28] text-[#8c8c80]'
          }`}
        >
          {isActive ? (
            <div className="flex flex-col items-center justify-center transition-all duration-300">
              <span className="text-xl font-mono font-medium">{secondsLeft}</span>
            </div>
          ) : (
            <Wind className="w-8 h-8 opacity-40" />
          )}
        </div>

        {/* Status Text Guidance */}
        <p className="mt-8 text-sm font-medium text-[#1c1c1a] dark:text-[#fbfbfa] text-center min-h-[20px] transition-all duration-300">
          {isActive ? currentPhaseConfig.text : 'Bắt đầu bài tập thở 4-4-4-4 để giảm căng thẳng'}
        </p>
      </div>

      {/* Toggle Button */}
      <button
        onClick={toggleBreathing}
        className={`w-full mt-4 flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl font-medium text-sm transition-all hover:scale-101 active:scale-99 ${
          isActive
            ? 'bg-[#c2410c] text-white hover:bg-[#ea580c]'
            : 'bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] hover:bg-[#2c2c28] dark:hover:bg-gray-100'
        }`}
      >
        {isActive ? (
          <>
            <Square className="w-4 h-4 fill-white text-white" />
            <span>Dừng bài tập</span>
          </>
        ) : (
          <>
            <Play className="w-4 h-4 fill-white text-white" />
            <span>Bắt đầu thở thiền</span>
          </>
        )}
      </button>
    </div>
  );
}
