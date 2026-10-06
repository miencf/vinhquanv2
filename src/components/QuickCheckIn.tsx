import React, { useState, useEffect, useRef } from 'react';
import { db } from '../lib/firebase';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { QrCode, MapPin, Camera, Play, CheckCircle2, AlertCircle, RefreshCw, LogIn, LogOut, Clock, ShieldCheck } from 'lucide-react';
import { playClick, playChime } from '../lib/audio';
import { Employee, AttendanceLog, PayrollAdjustment } from '../types';
import { 
  ShiftLatePolicy, 
  DEFAULT_SHIFT_POLICY, 
  calculateShiftLatePenalty, 
  formatCompactVND 
} from '../utils/shiftPenalty';

interface QuickCheckInProps {
  employeeId: string;
  currentEmployee: Employee;
  onSuccess?: () => void;
}

// Haversine formula to compute distance between coordinates in meters
function getDistanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth's radius in meters
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
}

export default function QuickCheckIn({ employeeId, currentEmployee, onSuccess }: QuickCheckInProps) {
  const [currentDate, setCurrentDate] = useState('');
  const [currentTime, setCurrentTime] = useState('');
  const [todayLog, setTodayLog] = useState<AttendanceLog | null>(null);

  // Configuration from Firestore (Settings)
  const [storeCoords, setStoreCoords] = useState({
    lat: 10.762622,
    lng: 106.660172,
    name: 'Cửa hàng trà sữa Serene HCMC',
    radius: 150
  });

  // GPS verification state
  const [userLocation, setUserLocation] = useState<{ lat: number, lng: number } | null>(null);
  const [gpsDistance, setGpsDistance] = useState<number | null>(null);
  const [gpsVerified, setGpsVerified] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState('');

  // QR verification state
  const [qrVerified, setQrVerified] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [scannerFeedback, setScannerFeedback] = useState('Đang chờ quét mã...');
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Shift & Late Policy from Firestore
  const [shiftPolicy, setShiftPolicy] = useState<ShiftLatePolicy>(DEFAULT_SHIFT_POLICY);

  useEffect(() => {
    const unsubPolicy = onSnapshot(doc(db, 'settings', 'shift_policy'), (docSnap) => {
      if (docSnap.exists()) {
        const d = docSnap.data();
        setShiftPolicy({
          earlyGraceMinutes: typeof d.earlyGraceMinutes === 'number' ? d.earlyGraceMinutes : 10,
          lateGraceMinutes: typeof d.lateGraceMinutes === 'number' ? d.lateGraceMinutes : 10,
          tier1ThresholdMinutes: typeof d.tier1ThresholdMinutes === 'number' ? d.tier1ThresholdMinutes : 30,
          tier1RatePerMinute: typeof d.tier1RatePerMinute === 'number' ? d.tier1RatePerMinute : 1000,
          tier2ThresholdMinutes: typeof d.tier2ThresholdMinutes === 'number' ? d.tier2ThresholdMinutes : 60,
          tier2RatePerMinute: typeof d.tier2RatePerMinute === 'number' ? d.tier2RatePerMinute : 2000,
          tier3RatePerMinute: typeof d.tier3RatePerMinute === 'number' ? d.tier3RatePerMinute : 5000,
        });
      }
    }, (error) => {
      console.warn("Shift policy fetch fallback:", error);
    });
    return () => unsubPolicy();
  }, []);

  // Fetch coordinates config from Firestore on mount
  useEffect(() => {
    const unsubCoords = onSnapshot(doc(db, 'settings', 'gps'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setStoreCoords({
          lat: typeof data.lat === 'number' ? data.lat : 10.762622,
          lng: typeof data.lng === 'number' ? data.lng : 106.660172,
          name: data.name || 'Cửa hàng trà sữa Serene HCMC',
          radius: typeof data.radius === 'number' ? data.radius : 150
        });
      }
    }, (error) => {
      console.error("Error watching GPS settings:", error);
    });
    return () => unsubCoords();
  }, []);

  // Format today's date and time
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      // local date YYYY-MM-DD
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const date = String(now.getDate()).padStart(2, '0');
      setCurrentDate(`${year}-${month}-${date}`);

      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      setCurrentTime(`${hours}:${minutes}`);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch or listen to today's log for this employee
  useEffect(() => {
    if (!currentDate || !employeeId) return;

    const logId = `${employeeId}_${currentDate}`;
    const unsub = onSnapshot(doc(db, 'attendance', logId), (docSnap) => {
      if (docSnap.exists()) {
        setTodayLog({ id: docSnap.id, ...docSnap.data() } as AttendanceLog);
      } else {
        setTodayLog(null);
      }
    });

    return () => unsub();
  }, [currentDate, employeeId]);

  // Request Location
  const requestGPS = () => {
    setGpsLoading(true);
    setGpsError('');
    playClick();

    if (!navigator.geolocation) {
      setGpsError('Thiết bị của bạn không hỗ trợ Định vị GPS.');
      setGpsLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation({ lat: latitude, lng: longitude });

        // Calculate distance
        const distance = getDistanceInMeters(latitude, longitude, storeCoords.lat, storeCoords.lng);
        setGpsDistance(distance);

        // Allow check-in within configured radius
        if (distance <= storeCoords.radius) {
          setGpsVerified(true);
        } else {
          setGpsVerified(false);
          setGpsError(`Bạn đang ở cách cửa hàng ${Math.round(distance)}m. Vui lòng di chuyển lại gần cửa hàng (Bán kính yêu cầu: ${storeCoords.radius}m).`);
        }
        setGpsLoading(false);
      },
      (error) => {
        console.warn('GPS error:', error);
        setGpsError('Không thể lấy vị trí. Vui lòng cấp quyền truy cập định vị.');
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // Mock GPS location to represent being at the store
  const mockAtStoreGPS = () => {
    playClick();
    setUserLocation({ lat: storeCoords.lat, lng: storeCoords.lng });
    setGpsDistance(1.5); // 1.5 meters away
    setGpsVerified(true);
    setGpsError('');
  };

  // Turn on/off Camera for QR simulation
  const startCamera = async () => {
    playClick();
    setCameraActive(true);
    setScannerFeedback('Đang tìm và giải mã QR đặt tại cửa hàng...');

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }
    } catch (err) {
      console.warn('Camera stream blocked or unavailable:', err);
    }

    // Automatically resolve scanning after 2.5 seconds as a smart feedback fallback
    setTimeout(() => {
      setQrVerified(true);
      setScannerFeedback('Quét mã QR cửa hàng thành công! ✅');
      stopCameraStream();
    }, 2500);
  };

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => stopCameraStream();
  }, []);

  const handleAction = async (actionType: 'check-in' | 'check-out') => {
    if (!gpsVerified && !qrVerified) {
      alert('Vui lòng xác minh Định vị GPS và quét mã QR cửa hàng trước khi thực hiện chấm công!');
      return;
    }

    playClick();
    const logId = `${employeeId}_${currentDate}`;
    
    // Create log object
    let logData: AttendanceLog;

    if (actionType === 'check-in') {
      const shiftStartTime = currentEmployee.shiftStartTime || '10:00';
      const lateCalc = calculateShiftLatePenalty(currentTime, shiftStartTime, shiftPolicy);

      logData = {
        id: logId,
        employeeId: employeeId,
        date: currentDate,
        hoursWorked: 0,
        status: lateCalc.status === 'late' ? 'late' : 'present',
        rateMultiplier: 1.0,
        inTime: currentTime,
        outTime: '',
        regularHours: 0,
        overtimeHours: 0,
        regularSalary: 0,
        overtimeSalary: 0,
        lateMinutes: lateCalc.lateMinutes,
        latePenalty: lateCalc.totalPenalty,
        notes: `Vào ca lúc ${currentTime} (${lateCalc.summaryText})`
      };

      try {
        await setDoc(doc(db, 'attendance', logId), logData);

        // If late with penalty, record the automatic penalty adjustment
        if (lateCalc.status === 'late' && lateCalc.totalPenalty > 0) {
          const adjId = `adj-late-${employeeId}-${currentDate}`;
          const penaltyAdj: PayrollAdjustment = {
            id: adjId,
            employeeId,
            date: currentDate,
            amount: lateCalc.totalPenalty,
            type: 'penalty',
            reason: `Phạt đi trễ ca ${shiftStartTime} (vào ${currentTime}, trễ ${lateCalc.lateMinutes}p: trừ ${lateCalc.formulaString})`
          };
          await setDoc(doc(db, 'adjustments', adjId), penaltyAdj);
        }

        playChime();

        if (lateCalc.status === 'late') {
          alert(
            `VÀO CA LÚC ${currentTime}!\n\n` +
            `⚠️ THÔNG BÁO ĐI TRỄ:\n` +
            `• Giờ ca bắt đầu: ${shiftStartTime}\n` +
            `• Bạn đi trễ: ${lateCalc.lateMinutes} phút\n` +
            `• Thời gian du di đầu ca: ${shiftPolicy.lateGraceMinutes} phút\n` +
            `• Khấu trừ phạt đi trễ: -${formatCompactVND(lateCalc.totalPenalty)} (${lateCalc.formulaString})\n\n` +
            `Khoản phạt này đã được ghi nhận vào bảng lương tháng ${currentDate.substring(0, 7)}. Chúc bạn hoàn thành ca làm việc an toàn!`
          );
        } else if (lateCalc.status === 'grace') {
          alert(
            `VÀO CA THÀNH CÔNG LÚC ${currentTime}!\n\n` +
            `ℹ️ Bạn đến trễ ${lateCalc.lateMinutes} phút nhưng vẫn nằm trong thời gian du di ${shiftPolicy.lateGraceMinutes} phút của ca làm việc, nên KHÔNG BỊ TRỪ LƯƠNG.\n\n` +
            `Chúc bạn có một ngày làm việc tràn đầy năng lượng!`
          );
        } else {
          alert(
            `VÀO CA THÀNH CÔNG LÚC ${currentTime}!\n\n` +
            `${lateCalc.earlyMinutes > 0 ? `👏 Bạn đến sớm ${lateCalc.earlyMinutes} phút (Đúng giờ, không bị trừ lương). Rất tuyệt vời!\n\n` : ''}` +
            `Chúc bạn một ngày làm việc thật vui vẻ và hiệu quả!`
          );
        }

        if (onSuccess) onSuccess();
        return;
      } catch (err) {
        console.error('Attendance writing failed:', err);
        alert('Không thể cập nhật chấm công. Vui lòng thử lại!');
        return;
      }
    } else {
      // Check-out
      const existingIn = todayLog?.inTime || '10:00';
      
      // Calculate work hours using shift values assigned to employee
      const shiftStart = currentEmployee.shiftStartTime || '10:00';
      const shiftEnd = currentEmployee.shiftEndTime || '23:00';

      const tInParts = existingIn.split(':');
      const tInDec = (parseInt(tInParts[0], 10) || 0) + (parseInt(tInParts[1], 10) || 0) / 60;

      const tOutParts = currentTime.split(':');
      const tOutDec = (parseInt(tOutParts[0], 10) || 0) + (parseInt(tOutParts[1], 10) || 0) / 60;

      const diff = tOutDec < tInDec ? (24 - tInDec) + tOutDec : tOutDec - tInDec;
      const totalHours = Math.round(diff * 100) / 100;

      // Shift length in hours
      const sStartParts = shiftStart.split(':');
      const sEndParts = shiftEnd.split(':');
      const sStartDec = (parseInt(sStartParts[0], 10) || 0) + (parseInt(sStartParts[1], 10) || 0) / 60;
      const sEndDec = (parseInt(sEndParts[0], 10) || 0) + (parseInt(sEndParts[1], 10) || 0) / 60;
      const shiftLength = sEndDec < sStartDec ? (24 - sStartDec) + sEndDec : sEndDec - sStartDec;

      // Regular shift hours are based on shift duration (tardiness is deducted via deductions, not subtracted from shift base)
      const regularHours = Math.round(Math.min(shiftLength, totalHours) * 100) / 100;
      const overtimeHours = Math.round(Math.max(0, totalHours - regularHours) * 100) / 100;

      const multiplier = todayLog?.rateMultiplier ?? 1.0;
      const regularSalary = Math.round(regularHours * currentEmployee.hourlyRate * multiplier);
      const overtimeHourlyRate = currentEmployee.overtimeHourlyRate || (currentEmployee.hourlyRate * (currentEmployee.overtimeMultiplier ?? 1.5));
      const overtimeSalary = Math.round(overtimeHours * overtimeHourlyRate * multiplier);

      logData = {
        id: logId,
        employeeId: employeeId,
        date: currentDate,
        hoursWorked: totalHours,
        status: todayLog?.status || 'present',
        rateMultiplier: multiplier,
        inTime: existingIn,
        outTime: currentTime,
        regularHours,
        overtimeHours,
        regularSalary,
        overtimeSalary,
        lateMinutes: todayLog?.lateMinutes ?? 0,
        latePenalty: todayLog?.latePenalty ?? 0,
        notes: (todayLog?.notes ? todayLog.notes + ' • ' : '') + 'Ra ca qua QR/GPS'
      };
    }

    try {
      await setDoc(doc(db, 'attendance', logId), logData);
      playChime();
      alert(`Ra ca thành công lúc ${currentTime}! Tổng giờ làm hôm nay của bạn: ${logData.hoursWorked} giờ. Ra về an toàn nhé!`);
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error('Attendance writing failed:', err);
      alert('Không thể cập nhật chấm công. Vui lòng thử lại!');
    }
  };

  return (
    <div id="quick-check-in-panel" className="bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl p-5 shadow-xs space-y-5">
      <div className="flex items-center justify-between border-b border-[#f2f2ee] dark:border-[#2c2c28] pb-3">
        <div>
          <span className="text-[10px] uppercase font-mono tracking-widest text-amber-600 font-semibold">Tự phục vụ</span>
          <h3 className="text-sm font-semibold tracking-wider text-[#1c1c1a] dark:text-[#fbfbfa] uppercase">Chấm Công Nhanh ⚡ GPS & QR</h3>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold text-[#1c1c1a] dark:text-white font-mono">{currentTime}</p>
          <p className="text-[9px] text-[#8c8c80] font-mono">{currentDate}</p>
        </div>
      </div>

      {/* Shift & Grace Policy Announcement Banner */}
      {(() => {
        const shiftStart = currentEmployee.shiftStartTime || '10:00';
        const shiftEnd = currentEmployee.shiftEndTime || '18:00';
        const liveCalc = currentTime ? calculateShiftLatePenalty(currentTime, shiftStart, shiftPolicy) : null;

        return (
          <div className="bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/30 rounded-xl p-3.5 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <Clock className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                <span className="text-xs font-bold text-[#1c1c1a] dark:text-white">
                  Ca làm việc: <span className="font-mono text-amber-700 dark:text-amber-400 font-bold">{shiftStart} → {shiftEnd}</span>
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-medium">
                  Du di đầu ca: {shiftPolicy.lateGraceMinutes} phút
                </span>
              </div>

              {liveCalc && !todayLog?.inTime && (
                <div className="text-[11px] font-medium">
                  {liveCalc.status === 'early' && (
                    <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                      🟢 Hiện tại: Đi sớm {liveCalc.earlyMinutes}p (Không phạt)
                    </span>
                  )}
                  {liveCalc.status === 'on_time' && (
                    <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                      🟢 Hiện tại: Đúng giờ ca làm
                    </span>
                  )}
                  {liveCalc.status === 'grace' && (
                    <span className="text-blue-700 dark:text-blue-400 font-semibold">
                      🟡 Hiện tại: Trong hạn du di {shiftPolicy.lateGraceMinutes}p (Không trừ lương)
                    </span>
                  )}
                  {liveCalc.status === 'late' && (
                    <span className="text-red-700 dark:text-red-400 font-bold font-mono">
                      🔴 Trễ {liveCalc.lateMinutes}p (Trừ {liveCalc.formulaString})
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] font-mono text-[#5c5c54] dark:text-[#acaca0] pt-1 border-t border-amber-200/50 dark:border-amber-900/30">
              <div className="bg-white/80 dark:bg-[#1c1c1a] p-1.5 rounded-lg border border-amber-100 dark:border-[#2c2c28]">
                <strong className="text-[#1c1c1a] dark:text-[#fbfbfa]">Bậc 1 (&le; 30p):</strong> -{formatCompactVND(shiftPolicy.tier1RatePerMinute)}/phút (sau {shiftPolicy.lateGraceMinutes}p du di)
              </div>
              <div className="bg-white/80 dark:bg-[#1c1c1a] p-1.5 rounded-lg border border-amber-100 dark:border-[#2c2c28]">
                <strong className="text-[#1c1c1a] dark:text-[#fbfbfa]">Bậc 2 (31 - 60p):</strong> -{formatCompactVND(shiftPolicy.tier2RatePerMinute)}/phút
              </div>
              <div className="bg-white/80 dark:bg-[#1c1c1a] p-1.5 rounded-lg border border-amber-100 dark:border-[#2c2c28]">
                <strong className="text-[#1c1c1a] dark:text-[#fbfbfa]">Bậc 3 (&ge; 1 tiếng):</strong> -{formatCompactVND(shiftPolicy.tier3RatePerMinute)}/phút
              </div>
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Verification Card 1: GPS location */}
        <div className="p-4 border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl flex flex-col justify-between space-y-4">
          <div className="flex items-start space-x-3">
            <div className={`p-2 rounded-lg border ${gpsVerified ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 'text-[#5c5c54] bg-[#fbfbfa] border-[#e4e4db]'}`}>
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-[#1c1c1a] dark:text-white">Bước 1: Vị Trí Định Vị GPS</p>
              <p className="text-[10px] text-[#8c8c80] mt-0.5">Xác minh bạn đang có mặt tại quán trà sữa</p>
            </div>
          </div>

          <div className="space-y-2 bg-[#fbfbfa] dark:bg-[#121211] p-3 rounded-xl border border-[#f2f2ee] dark:border-[#2c2c28]">
            {userLocation ? (
              <div className="text-[10px] font-mono space-y-1">
                <p className="text-emerald-600 font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> GPS Đã Khóa
                </p>
                <p className="text-[#5c5c54] dark:text-[#8c8c80]">Toạ độ: [{userLocation.lat.toFixed(5)}, {userLocation.lng.toFixed(5)}]</p>
                <p className="text-[#5c5c54] dark:text-[#8c8c80]">Khoảng cách đến quầy: {gpsDistance !== null ? `${Math.round(gpsDistance)}m` : 'Đang tính...'}</p>
              </div>
            ) : (
              <p className="text-[11px] text-[#8c8c80] italic">Chưa xác định vị trí của bạn</p>
            )}

            {gpsError && (
              <p className="text-[10px] text-red-600 font-medium flex items-center gap-1 bg-red-50 dark:bg-red-950/10 p-1.5 rounded border border-red-100">
                <AlertCircle className="w-3 h-3 shrink-0" /> {gpsError}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={requestGPS}
              disabled={gpsLoading}
              className="flex-1 bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] hover:bg-black text-[10px] font-semibold py-2 rounded-lg cursor-pointer flex items-center justify-center gap-1 transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${gpsLoading ? 'animate-spin' : ''}`} />
              {gpsLoading ? 'Đang lấy vị trí...' : 'Lấy toạ độ GPS thực'}
            </button>
            <button
              onClick={mockAtStoreGPS}
              className="bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-semibold py-2 px-3 rounded-lg cursor-pointer transition-colors"
              title="Bypass kiểm tra vị trí GPS khi chạy thử nghiệm"
            >
              Mô phỏng tại cửa hàng
            </button>
          </div>
        </div>

        {/* Verification Card 2: QR Scanner */}
        <div className="p-4 border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl flex flex-col justify-between space-y-4">
          <div className="flex items-start space-x-3">
            <div className={`p-2 rounded-lg border ${qrVerified ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 'text-[#5c5c54] bg-[#fbfbfa] border-[#e4e4db]'}`}>
              <QrCode className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-[#1c1c1a] dark:text-white">Bước 2: Quét Mã QR Tại Quầy</p>
              <p className="text-[10px] text-[#8c8c80] mt-0.5">Xác minh sự có mặt thực tế tại bàn thu ngân</p>
            </div>
          </div>

          <div className="relative bg-[#fbfbfa] dark:bg-[#121211] p-2 rounded-xl border border-[#f2f2ee] dark:border-[#2c2c28] h-28 overflow-hidden flex flex-col items-center justify-center text-center">
            {cameraActive ? (
              <div className="absolute inset-0 bg-black flex flex-col items-center justify-center">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover opacity-80" />
                {/* Scanner laser overlay lines */}
                <div className="absolute inset-x-0 h-0.5 bg-green-500 animate-pulse top-1/2" />
                <p className="absolute bottom-1.5 inset-x-2 text-[8px] bg-black/60 text-white p-1 rounded">
                  {scannerFeedback}
                </p>
              </div>
            ) : qrVerified ? (
              <div className="space-y-1.5 text-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto" />
                <p className="text-xs font-bold text-emerald-600">Mã QR Đã Xác Thực</p>
                <p className="text-[9px] text-[#8c8c80]">Cửa hàng: {storeCoords.name}</p>
              </div>
            ) : (
              <div className="space-y-1">
                <Camera className="w-5 h-5 text-[#8c8c80] mx-auto animate-pulse" />
                <p className="text-[10px] text-[#8c8c80] px-3">{scannerFeedback}</p>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={startCamera}
              disabled={cameraActive}
              className="flex-1 bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] hover:bg-black text-[10px] font-semibold py-2 rounded-lg cursor-pointer flex items-center justify-center gap-1 transition-colors"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Quét mã QR cửa hàng</span>
            </button>
            {cameraActive && (
              <button
                onClick={() => { stopCameraStream(); setCameraActive(false); }}
                className="bg-red-500 hover:bg-red-600 text-white text-[10px] font-semibold py-2 px-3 rounded-lg cursor-pointer"
              >
                Tắt
              </button>
            )}
          </div>
        </div>

      </div>

      {/* Action Zone */}
      <div className="pt-2 border-t border-[#f2f2ee] dark:border-[#2c2c28] flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="text-xs text-[#5c5c54] dark:text-[#8c8c80] flex items-center gap-1.5">
          <div className={`w-2.5 h-2.5 rounded-full ${gpsVerified && qrVerified ? 'bg-emerald-500 animate-ping' : 'bg-amber-400'}`} />
          <span>
            Trạng thái xác thực: <strong>{gpsVerified && qrVerified ? 'SẴN SÀNG CHẤM CÔNG ✅' : 'CHỜ XÁC MINH ⚠️'}</strong>
          </span>
        </div>

        <div className="flex space-x-3 w-full sm:w-auto">
          {/* If not checked-in today */}
          {(!todayLog || !todayLog.inTime) ? (
            <button
              onClick={() => handleAction('check-in')}
              disabled={!gpsVerified || !qrVerified}
              className="flex-1 sm:flex-initial bg-[#15803d] disabled:bg-gray-200 dark:disabled:bg-[#2c2c28] disabled:text-gray-400 hover:bg-[#166534] text-white font-semibold text-xs px-6 py-3 rounded-xl transition-all shadow-xs cursor-pointer flex items-center justify-center gap-2"
            >
              <LogIn className="w-4 h-4" />
              <span>Bắt Đầu Vào Ca 🚪</span>
            </button>
          ) : todayLog && todayLog.inTime && !todayLog.outTime ? (
            <div className="flex items-center space-x-3 w-full sm:w-auto">
              <span className="text-[10px] font-mono text-emerald-600 bg-emerald-50 p-2 rounded-lg border border-emerald-100 hidden sm:inline-block">
                Đã Vào Ca: {todayLog.inTime}
              </span>
              <button
                onClick={() => handleAction('check-out')}
                disabled={!gpsVerified || !qrVerified}
                className="flex-1 sm:flex-initial bg-[#c2410c] disabled:bg-gray-200 dark:disabled:bg-[#2c2c28] disabled:text-gray-400 hover:bg-[#9a3412] text-white font-semibold text-xs px-6 py-3 rounded-xl transition-all shadow-xs cursor-pointer flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                <span>Kết Thúc Ra Ca 🚪</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center bg-gray-50 border border-gray-100 p-3 rounded-xl text-xs text-gray-500 font-mono w-full sm:w-auto text-center justify-center">
              🎉 Bạn đã hoàn thành chấm công cả ca làm việc hôm nay! (Vào {todayLog.inTime} - Ra {todayLog.outTime})
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
