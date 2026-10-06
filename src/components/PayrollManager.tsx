import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { 
  Users, Calendar, CircleDollarSign, TrendingUp, AlertTriangle, 
  Download, Plus, Trash2, FileText, Check, Edit2, 
  UserCheck, ShieldAlert, Award, LogOut, Key, Search,
  Filter, HelpCircle, History, Landmark, Save, RefreshCw, Clock as ClockIcon,
  Eye, X, Crown, Home, BarChart2, Database, MapPin, Calculator, Sliders, CheckCircle2, ShieldCheck, Play,
  FileSpreadsheet, Upload, ToggleLeft, ToggleRight, CheckSquare, Square
} from 'lucide-react';
import { Employee, AttendanceLog, PayrollAdjustment, UserSession, ActivityLog, Shift, LateDeductionSettings } from '../types';
import { db } from '../lib/firebase';
import { collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';
import QuickCheckIn from './QuickCheckIn';
import AnalyticsDashboard from './AnalyticsDashboard';
import DataMigration from './DataMigration';
import { playClick, playChime } from '../lib/audio';
import { 
  ShiftLatePolicy, 
  DEFAULT_SHIFT_POLICY, 
  DEFAULT_LATE_SETTINGS,
  calculateShiftLatePenalty, 
  getMinutesDifference, 
  formatCompactVND,
  formatLateMinutes,
  isLatePenaltyApplicable
} from '../utils/shiftPenalty';
import { parseAttendanceExcel } from '../utils/excelAttendanceParser';

// Formatting helper for VND
const formatVND = (amount: number) => {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
};

const getTodayString = () => {
  const d = new Date();
  return d.toISOString().split('T')[0];
};

const getCurrentMonthStr = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

const getMonthYearString = (dateStr: string) => {
  return dateStr.substring(0, 7); // YYYY-MM
};

const getDaysInMonth = (monthStr: string) => {
  const parts = monthStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  return new Date(year, month, 0).getDate();
};

const getEmployeeShiftDuration = (emp: Employee) => {
  const start = emp.shiftStartTime || '18:00';
  const end = emp.shiftEndTime || '01:00';
  
  const partsStart = start.split(':');
  const hStart = parseInt(partsStart[0], 10) || 0;
  const mStart = partsStart[1] ? parseInt(partsStart[1], 10) : 0;
  
  const partsEnd = end.split(':');
  const hEnd = parseInt(partsEnd[0], 10) || 0;
  const mEnd = partsEnd[1] ? parseInt(partsEnd[1], 10) : 0;
  
  const startDec = hStart + mStart / 60;
  const endDec = hEnd + mEnd / 60;
  
  if (endDec < startDec) {
    return (24 - startDec) + endDec;
  } else {
    return endDec - startDec;
  }
};

const getAutoBonusForEmployee = (
  emp: Employee,
  monthStr: string,
  attendanceLogs: AttendanceLog[],
  dismissedMap: Record<string, boolean>
): PayrollAdjustment | null => {
  const bonusId = `adj-auto-bonus-${emp.id}-${monthStr}`;
  if (dismissedMap[bonusId]) {
    return null;
  }

  const empAttendance = attendanceLogs.filter(
    log => log.employeeId === emp.id && log.date.substring(0, 7) === monthStr
  );
  
  const workingDaysCount = empAttendance.filter(log => log.status !== 'absent').length;
  const daysInMonth = getDaysInMonth(monthStr);

  let qualifies = false;
  if (daysInMonth === 30 && workingDaysCount >= 28) {
    qualifies = true;
  } else if (daysInMonth === 31 && workingDaysCount >= 29) {
    qualifies = true;
  } else if (daysInMonth < 30 && workingDaysCount >= daysInMonth - 2) {
    qualifies = true;
  }

  if (qualifies) {
    const lastDayStr = `${monthStr}-${daysInMonth.toString().padStart(2, '0')}`;
    const shiftLength = getEmployeeShiftDuration(emp);
    const amount = 2 * shiftLength * emp.hourlyRate;
    return {
      id: bonusId,
      employeeId: emp.id,
      date: lastDayStr,
      amount,
      type: 'bonus',
      reason: 'Thưởng chuyên cần (Thưởng 2 ngày công)'
    };
  }

  return null;
};

const normalizeTime = (timeStr: string, referenceMinutes: number) => {
  const parts = timeStr.split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  let minutes = h * 60 + m;
  
  while (minutes < referenceMinutes) {
    minutes += 1440;
  }
  while (minutes >= referenceMinutes + 1440) {
    minutes -= 1440;
  }
  return minutes;
};

const calculateShiftHours = (
  inTime: string | undefined,
  outTime: string | undefined,
  shiftStartTime: string = '10:00',
  shiftEndTime: string = '23:00',
  overtimeStart: string = '23:00',
  hoursWorkedTotal: number,
  logDate: string
) => {
  const parseTimeToDecimal = (t: string) => {
    const parts = t.split(':');
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    return h + m / 60;
  };
  const startDec = parseTimeToDecimal(shiftStartTime);
  const endDec = parseTimeToDecimal(shiftEndTime);
  const shiftLength = endDec < startDec ? (24 - startDec) + endDec : endDec - startDec;

  if (!inTime || !outTime) {
    const regularHours = Math.min(hoursWorkedTotal, shiftLength);
    const overtimeHours = Math.max(0, hoursWorkedTotal - regularHours);
    return { regularHours, overtimeHours };
  }

  const partsShiftStart = shiftStartTime.split(':');
  const hShiftStart = parseInt(partsShiftStart[0], 10) || 10;
  const mShiftStart = partsShiftStart[1] ? parseInt(partsShiftStart[1], 10) : 0;
  const referenceMinutes = hShiftStart * 60 + mShiftStart - 360; // 6 hours before shift start

  const tShiftStart = normalizeTime(shiftStartTime, referenceMinutes);
  const tIn = normalizeTime(inTime, referenceMinutes);
  const tOut = normalizeTime(outTime, tIn); // Ensure outTime is normalized relative to check-in
  const tOt = normalizeTime(overtimeStart, referenceMinutes);
  const tShiftEnd = normalizeTime(shiftEndTime, referenceMinutes);

  // Since employee is assigned to this shift, their regular shift hours are calculated according to the scheduled shift:
  // Late arrival is penalized through deductions (khấu trừ đi trễ), so work hours are calculated for the shift.
  // If outTime reaches or passes shiftEnd / overtimeStart, regular hours = shiftLength.
  // If outTime is earlier than shiftEnd, regular time is from tShiftStart to tOut.
  const regEnd = Math.min(tOut, tOt, tShiftEnd);
  const regMinutes = Math.max(0, regEnd - tShiftStart);
  const regularHours = Math.round(Math.min(shiftLength, regMinutes / 60) * 100) / 100;

  // Overtime starts after the shift's regular hours / overtimeStart
  const otStartPoint = Math.min(tOt, tShiftEnd);
  const otMinutes = Math.max(0, tOut - Math.max(tIn, otStartPoint));
  const overtimeHours = Math.round((otMinutes / 60) * 100) / 100;

  return { regularHours, overtimeHours };
};

const getDailyAttendanceDetails = (
  log: AttendanceLog,
  emp: Employee | undefined,
  policy: ShiftLatePolicy = DEFAULT_SHIFT_POLICY
) => {
  if (!emp) {
    const defaultTotal = log.hoursWorked * log.rateMultiplier;
    return {
      regularHours: log.hoursWorked,
      overtimeHours: 0,
      regularSalary: defaultTotal,
      overtimeSalary: 0,
      totalHours: log.hoursWorked,
      totalSalary: defaultTotal,
      lateMinutes: log.lateMinutes || 0,
      latePenalty: log.latePenalty || 0,
      isLate: (log.latePenalty || 0) > 0 || log.status === 'late'
    };
  }

  const shiftStartTime = emp.shiftStartTime || '10:00';
  const shiftEndTime = emp.shiftEndTime || '23:00';
  const overtimeStart = emp.overtimeStart || shiftEndTime || '23:00';
  const overtimeHourlyRate = emp.overtimeHourlyRate || (emp.hourlyRate * (emp.overtimeMultiplier ?? 1.5));

  const { regularHours, overtimeHours } = calculateShiftHours(
    log.inTime,
    log.outTime,
    shiftStartTime,
    shiftEndTime,
    overtimeStart,
    log.hoursWorked,
    log.date
  );

  const regularSalary = regularHours * emp.hourlyRate * log.rateMultiplier;
  const overtimeSalary = overtimeHours * overtimeHourlyRate * log.rateMultiplier;

  // Calculate late arrival minutes and penalty if inTime is available
  let lateMinutes = log.lateMinutes ?? 0;
  let latePenalty = log.latePenalty ?? 0;

  if (log.inTime) {
    const lateCalc = calculateShiftLatePenalty(log.inTime, shiftStartTime, policy);
    lateMinutes = lateCalc.lateMinutes;
    latePenalty = lateCalc.totalPenalty;
  }

  return {
    regularHours,
    overtimeHours,
    regularSalary,
    overtimeSalary,
    totalHours: regularHours + overtimeHours,
    totalSalary: regularSalary + overtimeSalary,
    lateMinutes,
    latePenalty,
    isLate: latePenalty > 0 || lateMinutes > 0
  };
};

// Initial realistic seed data matching exactly what the user requested
const DEFAULT_EMPLOYEES: Employee[] = [
  { id: 'EMP-001', name: 'Naot', role: 'Nhân viên', hourlyRate: 25000, createdAt: '2026-07-01', shiftStartTime: '10:00', shiftEndTime: '23:00', overtimeStart: '23:00', overtimeHourlyRate: 27000, password: '123', syncPassword: 'admin123' },
];

const DEFAULT_ATTENDANCE: AttendanceLog[] = [
  { id: 'att-1', employeeId: 'EMP-001', date: '2026-10-01', inTime: '10:00', outTime: '23:00', hoursWorked: 13, regularHours: 13, overtimeHours: 0, status: 'present', rateMultiplier: 1.0, lateMinutes: 0, latePenalty: 0 },
  { id: 'att-2', employeeId: 'EMP-001', date: '2026-10-02', inTime: '10:00', outTime: '01:00', hoursWorked: 15, regularHours: 13, overtimeHours: 2, status: 'present', rateMultiplier: 1.0, lateMinutes: 0, latePenalty: 0 },
  { id: 'att-3', employeeId: 'EMP-001', date: '2026-10-03', inTime: '10:00', outTime: '23:00', hoursWorked: 13, regularHours: 13, overtimeHours: 0, status: 'present', rateMultiplier: 1.0, lateMinutes: 0, latePenalty: 0 },
  { id: 'att-4', employeeId: 'EMP-001', date: '2026-10-04', inTime: '10:00', outTime: '01:00', hoursWorked: 15, regularHours: 13, overtimeHours: 2, status: 'present', rateMultiplier: 1.0, lateMinutes: 0, latePenalty: 0 },
];

const DEFAULT_ADJUSTMENTS: PayrollAdjustment[] = [];

const DEFAULT_SHIFTS: Shift[] = [
  { id: 'shift-01', name: 'Ca Trưa - Tối (10h - 23h)', startTime: '10:00', endTime: '23:00', multiplier: 1.0, earlyGraceMinutes: 10, lateGraceMinutes: 10, lateRate1: 1000, lateRate2: 2000, lateRate3: 5000 },
  { id: 'shift-02', name: 'Ca Xuyên Đêm (10h - 01h)', startTime: '10:00', endTime: '01:00', multiplier: 1.0, earlyGraceMinutes: 10, lateGraceMinutes: 10, lateRate1: 1000, lateRate2: 2000, lateRate3: 5000 },
  { id: 'shift-03', name: 'Ca Chiều Tối (15h - 23h)', startTime: '15:00', endTime: '23:00', multiplier: 1.0, earlyGraceMinutes: 10, lateGraceMinutes: 10, lateRate1: 1000, lateRate2: 2000, lateRate3: 5000 },
  { id: 'shift-04', name: 'Ca Đêm (18h - 02h)', startTime: '18:00', endTime: '02:00', multiplier: 1.0, earlyGraceMinutes: 10, lateGraceMinutes: 10, lateRate1: 1000, lateRate2: 2000, lateRate3: 5000 },
  { id: 'shift-05', name: 'Tăng Ca (02h - 10h)', startTime: '02:00', endTime: '10:00', multiplier: 1.5, earlyGraceMinutes: 10, lateGraceMinutes: 10, lateRate1: 1000, lateRate2: 2000, lateRate3: 5000 }
];

const DEFAULT_ACTIVITIES: ActivityLog[] = [
  { id: 'act-1', timestamp: '2026-10-01 09:00:00', action: 'Khởi tạo hệ thống', details: 'Bản đồ dữ liệu nhân sự & chấm công ca 10:00-23:00 được tải mặc định' }
];


export default function PayrollManager() {
  // Authentication & Session State
  const [session, setSession] = useState<UserSession | null>(() => {
    const saved = localStorage.getItem('payroll_session');
    return saved ? JSON.parse(saved) : null;
  });

  const [loginRole, setLoginRole] = useState<'admin' | 'employee'>('admin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [selectedEmployeeLogin, setSelectedEmployeeLogin] = useState('');
  const [loginError, setLoginError] = useState('');

  // Primary Workspace States with Real-time Sync & seeding fallback
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<AttendanceLog[]>([]);
  const [adjustments, setAdjustments] = useState<PayrollAdjustment[]>([]);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [dismissedAutoBonuses, setDismissedAutoBonuses] = useState<Record<string, boolean>>({});

  // Navigation & General UI filters
  const [activeTab, setActiveTab] = useState<'reports' | 'bulk-attendance' | 'daily-attendance' | 'adjustments' | 'employees' | 'shifts' | 'late-settings' | 'activities' | 'analytics' | 'migration' | 'settings'>('reports');
  const [employeeTab, setEmployeeTab] = useState<'checkin' | 'payroll'>('payroll');
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthStr);
  const [searchTerm, setSearchTerm] = useState('');

  // GPS Settings states
  const [gpsLat, setGpsLat] = useState('10.762622');
  const [gpsLng, setGpsLng] = useState('106.660172');
  const [gpsName, setGpsName] = useState('Cửa hàng trà sữa Serene HCMC');
  const [gpsRadius, setGpsRadius] = useState(150);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsSaving, setGpsSaving] = useState(false);

  // Shift Policy & Late Penalty Master Settings
  const [shiftPolicy, setShiftPolicy] = useState<ShiftLatePolicy>(DEFAULT_SHIFT_POLICY);
  const [lateSettings, setLateSettings] = useState<LateDeductionSettings>(DEFAULT_LATE_SETTINGS);
  const [savingShiftPolicy, setSavingShiftPolicy] = useState(false);

  // Simulator States for Testing Late Penalties
  const [simShiftStartTime, setSimShiftStartTime] = useState('10:00');
  const [simCheckInTime, setSimCheckInTime] = useState('10:30');
  const [simSelectedShiftId, setSimSelectedShiftId] = useState('');

  // Sync Shift Policy & Late Deduction Master Settings on mount
  useEffect(() => {
    const unsubLate = onSnapshot(doc(db, 'settings', 'late_deduction'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const merged: LateDeductionSettings = {
          ...DEFAULT_LATE_SETTINGS,
          ...data,
          disabledEmployeeIds: Array.isArray(data.disabledEmployeeIds) ? data.disabledEmployeeIds : []
        };
        setLateSettings(merged);
        setShiftPolicy(merged);
      }
    }, (error) => {
      console.error("Error loading late deduction settings in PayrollManager:", error);
    });

    const unsubPolicy = onSnapshot(doc(db, 'settings', 'shift_policy'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const policyData: ShiftLatePolicy = {
          earlyGraceMinutes: typeof data.earlyGraceMinutes === 'number' ? data.earlyGraceMinutes : 10,
          lateGraceMinutes: typeof data.lateGraceMinutes === 'number' ? data.lateGraceMinutes : 10,
          tier1ThresholdMinutes: typeof data.tier1ThresholdMinutes === 'number' ? data.tier1ThresholdMinutes : 30,
          tier1RatePerMinute: typeof data.tier1RatePerMinute === 'number' ? data.tier1RatePerMinute : 1000,
          tier2ThresholdMinutes: typeof data.tier2ThresholdMinutes === 'number' ? data.tier2ThresholdMinutes : 60,
          tier2RatePerMinute: typeof data.tier2RatePerMinute === 'number' ? data.tier2RatePerMinute : 2000,
          tier3RatePerMinute: typeof data.tier3RatePerMinute === 'number' ? data.tier3RatePerMinute : 5000,
        };
        setShiftPolicy(prev => ({ ...prev, ...policyData }));
        setLateSettings(prev => ({ ...prev, ...policyData }));
      }
    }, (error) => {
      console.error("Error loading shift policy in PayrollManager:", error);
    });

    return () => {
      unsubLate();
      unsubPolicy();
    };
  }, []);

  // Global & Per-Employee Late Deduction Handlers
  const handleToggleGlobalLate = async (newVal: boolean) => {
    playClick();
    try {
      const updated: LateDeductionSettings = { ...lateSettings, globalEnabled: newVal };
      setLateSettings(updated);
      setShiftPolicy(updated);
      await setDoc(doc(db, 'settings', 'late_deduction'), updated, { merge: true });
      await setDoc(doc(db, 'settings', 'shift_policy'), updated, { merge: true });
      addLog('Cài đặt khấu trừ đi trễ', `${newVal ? 'Bật' : 'Tắt'} khấu trừ đi trễ cho toàn bộ nhân viên`);
    } catch (err) {
      console.error("Error toggling global late:", err);
      showAlert('Lỗi', `Không thể cập nhật: ${err}`);
    }
  };

  const handleToggleEmployeeLate = async (targetEmpId: string, currentEnabled: boolean) => {
    playClick();
    try {
      let updatedDisabled = [...(lateSettings.disabledEmployeeIds || [])];
      if (currentEnabled) {
        if (!updatedDisabled.includes(targetEmpId)) {
          updatedDisabled.push(targetEmpId);
        }
      } else {
        updatedDisabled = updatedDisabled.filter(id => id !== targetEmpId);
      }
      const updated: LateDeductionSettings = { ...lateSettings, disabledEmployeeIds: updatedDisabled };
      setLateSettings(updated);
      setShiftPolicy(updated);
      await setDoc(doc(db, 'settings', 'late_deduction'), updated, { merge: true });
      await setDoc(doc(db, 'settings', 'shift_policy'), updated, { merge: true });
      const empObj = employees.find(e => e.id === targetEmpId);
      addLog('Cài đặt khấu trừ đi trễ', `${currentEnabled ? 'Tắt' : 'Bật'} khấu trừ đi trễ cho ${empObj?.name || targetEmpId}`);
    } catch (err) {
      console.error("Error toggling employee late:", err);
      showAlert('Lỗi', `Không thể cập nhật: ${err}`);
    }
  };

  const handleSaveLateSettings = async (customSettings?: Partial<LateDeductionSettings>) => {
    setSavingShiftPolicy(true);
    playClick();
    try {
      const toSave: LateDeductionSettings = {
        ...lateSettings,
        ...(customSettings || {})
      };
      await setDoc(doc(db, 'settings', 'late_deduction'), toSave);
      await setDoc(doc(db, 'settings', 'shift_policy'), toSave);
      setLateSettings(toSave);
      setShiftPolicy(toSave);
      playChime();
      showAlert('Thành công', 'Đã lưu cài đặt khấu trừ đi trễ và thang bậc phạt thành công!');
      addLog('Cài đặt khấu trừ đi trễ', 'Cập nhật thời gian áp dụng và quy tắc khấu trừ đi trễ');
    } catch (err) {
      console.error("Error saving late settings:", err);
      showAlert('Lỗi', `Không thể lưu cài đặt: ${err}`);
    } finally {
      setSavingShiftPolicy(false);
    }
  };

  // Sync GPS Settings on mount
  useEffect(() => {
    const unsubGps = onSnapshot(doc(db, 'settings', 'gps'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setGpsLat(String(data.lat ?? 10.762622));
        setGpsLng(String(data.lng ?? 106.660172));
        setGpsName(data.name ?? 'Cửa hàng trà sữa Serene HCMC');
        setGpsRadius(data.radius ?? 150);
      }
    }, (error) => {
      console.error("Error loading GPS settings in PayrollManager:", error);
    });
    return () => unsubGps();
  }, []);

  // Admin viewing employee history detail
  const [viewingHistoryEmployee, setViewingHistoryEmployee] = useState<Employee | null>(null);
  const [historySelectedMonth, setHistorySelectedMonth] = useState(getCurrentMonthStr);

  // Inline detailed log editing states for history modal
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editLogInTime, setEditLogInTime] = useState('');
  const [editLogOutTime, setEditLogOutTime] = useState('');
  const [editLogHours, setEditLogHours] = useState(8);
  const [editLogMultiplier, setEditLogMultiplier] = useState(1.0);
  const [editLogNotes, setEditLogNotes] = useState('');
  const [editLogStatus, setEditLogStatus] = useState<'present' | 'late' | 'absent'>('present');

  // Non-blocking in-app confirmation & alert states for Iframe support
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  }>({
    isOpen: false,
    title: '',
    message: ''
  });

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({ isOpen: true, title, message, onConfirm });
  };

  const showAlert = (title: string, message: string) => {
    setAlertModal({ isOpen: true, title, message });
  };

  const handleGetCurrentLocation = () => {
    setGpsLoading(true);
    playClick();
    if (!navigator.geolocation) {
      showAlert('Không hỗ trợ', 'Trình duyệt hoặc thiết bị của bạn không hỗ trợ định vị GPS.');
      setGpsLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGpsLat(String(position.coords.latitude));
        setGpsLng(String(position.coords.longitude));
        setGpsLoading(false);
        playChime();
        showAlert('Đã lấy tọa độ', `Lấy thành công tọa độ hiện tại từ thiết bị:\nVĩ độ: ${position.coords.latitude}\nKinh độ: ${position.coords.longitude}`);
      },
      (error) => {
        console.error("GPS retrieval error:", error);
        showAlert('Lỗi định vị', 'Không thể lấy tọa độ hiện tại. Vui lòng kiểm tra quyền truy cập định vị trên trình duyệt hoặc thiết bị.');
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSaveGpsSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setGpsSaving(true);
    playClick();

    const latNum = parseFloat(gpsLat);
    const lngNum = parseFloat(gpsLng);

    if (isNaN(latNum) || isNaN(lngNum)) {
      showAlert('Lỗi tọa độ', 'Tọa độ Vĩ độ và Kinh độ phải là chữ số hợp lệ.');
      setGpsSaving(false);
      return;
    }

    try {
      await setDoc(doc(db, 'settings', 'gps'), {
        lat: latNum,
        lng: lngNum,
        name: gpsName,
        radius: gpsRadius,
        updatedAt: new Date().toISOString()
      });

      // Add to system activity logs
      const actId = `act_gps_${Date.now()}`;
      await setDoc(doc(db, 'activities', actId), {
        id: actId,
        timestamp: new Date().toISOString(),
        action: 'Cài đặt GPS',
        details: `Cập nhật tọa độ chấm công thành công: ${gpsName} (${latNum}, ${lngNum}), bán kính ${gpsRadius}m.`
      });

      showAlert('Thành công', 'Cài đặt tọa độ chấm công đã được cập nhật thành công và áp dụng cho toàn bộ thiết bị.');
    } catch (error) {
      console.error("Error saving GPS settings:", error);
      showAlert('Lỗi', 'Không thể lưu cài đặt tọa độ. Chi tiết: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setGpsSaving(false);
    }
  };

  useEffect(() => {
    setHistorySelectedMonth(selectedMonth);
  }, [selectedMonth]);

  // Realtime Sync Subscription with Seeding Fallback
  useEffect(() => {
    const unsubEmps = onSnapshot(collection(db, 'employees'), (snapshot) => {
      const list: Employee[] = [];
      snapshot.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() } as Employee);
      });
      if (list.length === 0) {
        // Seed employees
        DEFAULT_EMPLOYEES.forEach(async (emp) => {
          await setDoc(doc(db, 'employees', emp.id), {
            id: emp.id,
            name: emp.name,
            role: emp.role,
            hourlyRate: emp.hourlyRate,
            createdAt: emp.createdAt || getTodayString(),
            shiftStartTime: emp.shiftStartTime || '15:00',
            shiftEndTime: emp.shiftEndTime || '01:00',
            overtimeStart: emp.overtimeStart || '01:00',
            overtimeMultiplier: emp.overtimeMultiplier || 1.5,
            overtimeHourlyRate: emp.overtimeHourlyRate || 27000,
            password: emp.password || '123',
            syncPassword: emp.syncPassword || 'admin123'
          });
        });
      } else {
        list.sort((a, b) => a.id.localeCompare(b.id));
        setEmployees(list);
      }
    });

    const unsubAtt = onSnapshot(collection(db, 'attendance'), (snapshot) => {
      const list: AttendanceLog[] = [];
      snapshot.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() } as AttendanceLog);
      });
      if (list.length === 0) {
        // Seed attendance logs
        DEFAULT_ATTENDANCE.forEach(async (att) => {
          await setDoc(doc(db, 'attendance', att.id), {
            employeeId: att.employeeId,
            date: att.date,
            hoursWorked: att.hoursWorked,
            status: att.status,
            rateMultiplier: att.rateMultiplier,
            notes: att.notes || ''
          });
        });
      } else {
        setAttendance(list);
      }
    });

    const unsubAdj = onSnapshot(collection(db, 'adjustments'), (snapshot) => {
      const list: PayrollAdjustment[] = [];
      snapshot.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() } as PayrollAdjustment);
      });
      if (list.length === 0) {
        DEFAULT_ADJUSTMENTS.forEach(async (adj) => {
          await setDoc(doc(db, 'adjustments', adj.id), {
            employeeId: adj.employeeId,
            date: adj.date,
            amount: adj.amount,
            type: adj.type,
            reason: adj.reason
          });
        });
      } else {
        setAdjustments(list);
      }
    });

    const unsubShifts = onSnapshot(collection(db, 'shifts'), (snapshot) => {
      const list: Shift[] = [];
      snapshot.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() } as Shift);
      });
      if (list.length === 0) {
        DEFAULT_SHIFTS.forEach(async (shift) => {
          await setDoc(doc(db, 'shifts', shift.id), {
            name: shift.name,
            startTime: shift.startTime,
            endTime: shift.endTime,
            multiplier: shift.multiplier
          });
        });
      } else {
        list.sort((a, b) => a.id.localeCompare(b.id));
        setShifts(list);
      }
    });

    const unsubAct = onSnapshot(collection(db, 'activities'), (snapshot) => {
      const list: ActivityLog[] = [];
      snapshot.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() } as ActivityLog);
      });
      if (list.length === 0) {
        DEFAULT_ACTIVITIES.forEach(async (act) => {
          await setDoc(doc(db, 'activities', act.id), {
            timestamp: act.timestamp,
            action: act.action,
            details: act.details
          });
        });
      } else {
        list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        setActivities(list);
      }
    });

    const unsubDismissed = onSnapshot(collection(db, 'dismissed_auto_bonuses'), (snapshot) => {
      const map: Record<string, boolean> = {};
      snapshot.forEach(doc => {
        map[doc.id] = true;
      });
      setDismissedAutoBonuses(map);
    });

    return () => {
      unsubEmps();
      unsubAtt();
      unsubAdj();
      unsubShifts();
      unsubAct();
      unsubDismissed();
    };
  }, []);

  useEffect(() => {
    if (session) {
      localStorage.setItem('payroll_session', JSON.stringify(session));
    } else {
      localStorage.removeItem('payroll_session');
    }
  }, [session]);


  // Auto Attendance Bonus Generator
  useEffect(() => {
    if (employees.length === 0 || attendance.length === 0) return;

    const daysInMonth = getDaysInMonth(selectedMonth);
    const lastDayStr = `${selectedMonth}-${daysInMonth.toString().padStart(2, '0')}`;

    employees.forEach(async (emp) => {
      const empAttendance = attendance.filter(
        log => log.employeeId === emp.id && getMonthYearString(log.date) === selectedMonth
      );
      // count valid working days (where status is present or late)
      const workingDaysCount = empAttendance.filter(log => log.status !== 'absent').length;

      let bonusDays = 0;
      if (daysInMonth === 30 && workingDaysCount >= 28) {
        bonusDays = 2;
      } else if (daysInMonth === 31 && workingDaysCount >= 29) {
        bonusDays = 2;
      } else if (daysInMonth < 30 && workingDaysCount >= daysInMonth - 2) {
        bonusDays = 2;
      }

      const bonusId = `adj-auto-bonus-${emp.id}-${selectedMonth}`;

      // Check if this bonus was dismissed (deleted by admin)
      if (dismissedAutoBonuses[bonusId]) {
        return;
      }

      // Check if an adjustment with this ID already exists
      const alreadyExists = adjustments.some(adj => adj.id === bonusId);

      if (bonusDays > 0) {
        if (!alreadyExists) {
          // Create the auto bonus adjustment
          const shiftLength = getEmployeeShiftDuration(emp);
          const amount = bonusDays * shiftLength * emp.hourlyRate;
          const reason = `Thưởng ${bonusDays} ngày công`;

          const newAdj: PayrollAdjustment = {
            id: bonusId,
            employeeId: emp.id,
            date: lastDayStr,
            amount,
            type: 'bonus',
            reason
          };

          try {
            await setDoc(doc(db, 'adjustments', bonusId), newAdj);
            addLog('Thưởng chuyên cần tự động', `Quy đổi tự động ${reason} (${formatVND(amount)}) cho ${emp.name}`);
          } catch (e) {
            console.error('Error creating auto bonus:', e);
          }
        }
      } else {
        // If they no longer qualify (e.g., admin changed attendance logs) but the bonus exists, delete it
        if (alreadyExists) {
          try {
            await deleteDoc(doc(db, 'adjustments', bonusId));
            addLog('Thu hồi thưởng chuyên cần', `Thu hồi thưởng chuyên cần tự động của ${emp.name} do không đủ ngày công`);
          } catch (e) {
            console.error('Error removing unqualified auto bonus:', e);
          }
        }
      }
    });
  }, [employees, attendance, adjustments, selectedMonth, dismissedAutoBonuses]);

  // Logging Helper
  const addLog = (action: string, details: string) => {
    const now = new Date();
    const timeStr = now.toISOString().replace('T', ' ').substring(0, 19);
    const newLog: ActivityLog = {
      id: `act-${Date.now()}`,
      timestamp: timeStr,
      action,
      details
    };
    setActivities(prev => [newLog, ...prev]);
  };

  // Login handler
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    if (loginRole === 'admin') {
      const u = username.trim().toLowerCase();
      if (u === 'admin' && password === 'admin123') {
        const adminSession: UserSession = { role: 'admin' };
        setSession(adminSession);
        addLog('Đăng nhập', 'Quản trị viên đăng nhập hệ thống');
        setUsername('');
        setPassword('');
      } else if ((u === 'manager' && password === 'manager123') || (u === 'quanly' && password === 'quanly123')) {
        const managerSession: UserSession = { role: 'manager' };
        setSession(managerSession);
        addLog('Đăng nhập', 'Quản lý đăng nhập hệ thống');
        setUsername('');
        setPassword('');
      } else {
        setLoginError('Thông tin đăng nhập không chính xác (admin hoặc quản lý).');
      }
    } else {
      if (!selectedEmployeeLogin) {
        setLoginError('Vui lòng chọn nhân viên từ danh sách.');
        return;
      }
      const emp = employees.find(e => e.id === selectedEmployeeLogin);
      if (emp) {
        const expectedEmpPassword = emp.password || '123';
        const expectedSyncPassword = emp.syncPassword || 'admin123';
        if (password === expectedEmpPassword || password === expectedSyncPassword) {
          const empSession: UserSession = { role: 'employee', employeeId: emp.id };
          setSession(empSession);
          setSelectedMonth(getCurrentMonthStr()); // Mặc định tra cứu tháng là tháng hiện tại
          setEmployeeTab('payroll');
          addLog('Đăng nhập', `Nhân viên ${emp.name} đăng nhập`);
          setPassword('');
        } else {
          setLoginError('Mật khẩu không chính xác.');
        }
      }
    }
  };

  const handleLogout = () => {
    addLog('Đăng xuất', session?.role === 'admin' ? 'Quản trị viên đăng xuất' : 'Nhân viên đăng xuất');
    setSession(null);
    setSelectedEmployeeLogin('');
    setIsEditingSelf(false);
  };

  // Helper to generate next EMP-XXX ID (e.g. EMP-003, EMP-010)
  const getNextEmployeeId = (emps: Employee[]): string => {
    let maxNum = 0;
    emps.forEach(e => {
      const match = e.id.match(/EMP-?(\d+)/i);
      if (match) {
        const n = parseInt(match[1], 10);
        if (!isNaN(n) && n > maxNum) {
          maxNum = n;
        }
      }
    });
    const nextNum = Math.max(emps.length + 1, maxNum + 1);
    return `EMP-${String(nextNum).padStart(3, '0')}`;
  };

  // Employee CRUD Forms and actions - default to Ca Full (10:00 - 23:00, OT: 23:00)
  const [empId, setEmpId] = useState('');
  const [empName, setEmpName] = useState('');
  const [empRole, setEmpRole] = useState('Nhân viên');
  const [empRate, setEmpRate] = useState(25000); // 25k default matching requested default rate
  const [empShiftStartTime, setEmpShiftStartTime] = useState('10:00');
  const [empShiftEndTime, setEmpShiftEndTime] = useState('23:00');
  const [empOvertimeStart, setEmpOvertimeStart] = useState('23:00');
  const [empOvertimeMultiplier, setEmpOvertimeMultiplier] = useState(1.5);
  const [empOvertimeHourlyRate, setEmpOvertimeHourlyRate] = useState(27000);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [empPassword, setEmpPassword] = useState('123');
  const [empSyncPassword, setEmpSyncPassword] = useState('admin123');
  const [adminGlobalSyncPassword, setAdminGlobalSyncPassword] = useState('admin123');

  useEffect(() => {
    if (!editingEmployeeId) {
      setEmpId(getNextEmployeeId(employees));
    }
  }, [employees, editingEmployeeId]);

  useEffect(() => {
    const activeSync = employees.find(e => e.syncPassword)?.syncPassword || 'admin123';
    setAdminGlobalSyncPassword(activeSync);
    if (!editingEmployeeId) {
      setEmpSyncPassword(activeSync);
    }
  }, [employees, editingEmployeeId]);

  // Self-service portal editing states
  const [isEditingSelf, setIsEditingSelf] = useState(false);
  const [selfName, setSelfName] = useState('');
  const [selfPassword, setSelfPassword] = useState('');

  // Shift CRUD States
  const [shiftId, setShiftId] = useState('');
  const [shiftName, setShiftName] = useState('');
  const [shiftStartTime, setShiftStartTime] = useState('10:00');
  const [shiftEndTime, setShiftEndTime] = useState('18:00');
  const [shiftMultiplier, setShiftMultiplier] = useState(1.0);
  const [shiftCustomGrace, setShiftCustomGrace] = useState(false);
  const [shiftEarlyGrace, setShiftEarlyGrace] = useState(10);
  const [shiftLateGrace, setShiftLateGrace] = useState(10);
  const [shiftLateRate1, setShiftLateRate1] = useState(1000);
  const [shiftLateRate2, setShiftLateRate2] = useState(2000);
  const [shiftLateRate3, setShiftLateRate3] = useState(5000);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);

  const updateAllSyncPasswords = async (newSync: string) => {
    const trimmedSync = newSync.trim();
    if (!trimmedSync) return;
    const updatePromises = employees.map(emp => {
      return setDoc(doc(db, 'employees', emp.id), {
        ...emp,
        syncPassword: trimmedSync
      });
    });
    await Promise.all(updatePromises);
  };

  const handleSaveEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (session?.role === 'manager') {
      showAlert('Thông báo', 'Tài khoản Quản lý chỉ có quyền xem, không thể thay đổi dữ liệu.');
      return;
    }
    if (!empId.trim() || !empName.trim() || !empRole.trim()) {
      showAlert('Thông báo', 'Vui lòng điền đầy đủ thông tin nhân sự.');
      return;
    }

    const trimmedId = empId.trim().toUpperCase();

    if (editingEmployeeId) {
      // Update
      showConfirm(
        'Cập nhật nhân viên',
        `Bạn có chắc chắn muốn cập nhật thông tin nhân viên "${empName}" (${trimmedId}) không?`,
        async () => {
          try {
            const updatedEmp: Employee = {
              id: trimmedId,
              name: empName.trim(),
              role: empRole.trim(),
              hourlyRate: Number(empRate),
              createdAt: employees.find(emp => emp.id === editingEmployeeId)?.createdAt || getTodayString(),
              shiftStartTime: empShiftStartTime,
              shiftEndTime: empShiftEndTime,
              overtimeStart: empOvertimeStart,
              overtimeMultiplier: Number(empOvertimeMultiplier),
              overtimeHourlyRate: Number(empOvertimeHourlyRate),
              password: empPassword.trim(),
              syncPassword: empSyncPassword.trim()
            };

            await setDoc(doc(db, 'employees', editingEmployeeId), updatedEmp);

            // Check if the sync password has changed and update everyone if so
            const currentSync = employees.find(e => e.id === editingEmployeeId)?.syncPassword || 'admin123';
            if (empSyncPassword.trim() !== currentSync) {
              await updateAllSyncPasswords(empSyncPassword.trim());
            }

            // Find all attendance records of this employee and update their calculated salaries
            const empAttendanceToUpdate = attendance.filter(log => log.employeeId === editingEmployeeId);
            if (empAttendanceToUpdate.length > 0) {
              await Promise.all(
                empAttendanceToUpdate.map(async (log) => {
                  const details = getDailyAttendanceDetails(log, updatedEmp);
                  const updatedLog: AttendanceLog = {
                    ...log,
                    hoursWorked: details.totalHours,
                    regularHours: details.regularHours,
                    overtimeHours: details.overtimeHours,
                    regularSalary: details.regularSalary,
                    overtimeSalary: details.overtimeSalary
                  };
                  await setDoc(doc(db, 'attendance', log.id), updatedLog);
                })
              );
            }

            addLog('Cập nhật nhân viên', `Chỉnh sửa thông tin nhân sự ${empName} (${trimmedId})`);
            setEditingEmployeeId(null);
            setEmpId(getNextEmployeeId(employees));
            setEmpName('');
            setEmpRole('Nhân viên');
            setEmpRate(25000);
            setEmpShiftStartTime('10:00');
            setEmpShiftEndTime('23:00');
            setEmpOvertimeStart('23:00');
            setEmpOvertimeMultiplier(1.5);
            setEmpOvertimeHourlyRate(27000);
            setEmpPassword('123');
            setEmpSyncPassword(employees.find(e => e.syncPassword)?.syncPassword || 'admin123');
          } catch (error) {
            showAlert('Lỗi', `Không thể cập nhật thông tin nhân viên: ${error}`);
          }
        }
      );
    } else {
      // Create
      if (employees.some(emp => emp.id.toUpperCase() === trimmedId)) {
        showAlert('Thông báo', 'Mã nhân viên này đã tồn tại trong hệ thống!');
        return;
      }

      showConfirm(
        'Thêm nhân viên',
        `Bạn có chắc chắn muốn thêm nhân viên mới "${empName}" (${trimmedId}) không?`,
        async () => {
          try {
            const newEmp: Employee = {
              id: trimmedId,
              name: empName.trim(),
              role: empRole.trim(),
              hourlyRate: Number(empRate),
              createdAt: getTodayString(),
              shiftStartTime: empShiftStartTime,
              shiftEndTime: empShiftEndTime,
              overtimeStart: empOvertimeStart,
              overtimeMultiplier: Number(empOvertimeMultiplier),
              overtimeHourlyRate: Number(empOvertimeHourlyRate),
              password: empPassword.trim(),
              syncPassword: empSyncPassword.trim()
            };
            await setDoc(doc(db, 'employees', trimmedId), newEmp);

            // Sync all other employees as well
            await updateAllSyncPasswords(empSyncPassword.trim());

            addLog('Thêm nhân viên', `Tạo nhân sự mới ${empName} (${trimmedId})`);
            const updatedList = [...employees, newEmp];
            setEmpId(getNextEmployeeId(updatedList));
            setEmpName('');
            setEmpRole('Nhân viên');
            setEmpRate(25000);
            setEmpShiftStartTime('10:00');
            setEmpShiftEndTime('23:00');
            setEmpOvertimeStart('23:00');
            setEmpOvertimeMultiplier(1.5);
            setEmpOvertimeHourlyRate(27000);
            setEmpPassword('123');
            setEmpSyncPassword(employees.find(e => e.syncPassword)?.syncPassword || 'admin123');
          } catch (error) {
            showAlert('Lỗi', `Không thể thêm nhân viên mới: ${error}`);
          }
        }
      );
    }
  };

  const handleStartEditEmployee = (emp: Employee) => {
    setEditingEmployeeId(emp.id);
    setEmpId(emp.id);
    setEmpName(emp.name);
    setEmpRole(emp.role);
    setEmpRate(emp.hourlyRate);
    setEmpShiftStartTime(emp.shiftStartTime || '10:00');
    setEmpShiftEndTime(emp.shiftEndTime || '23:00');
    setEmpOvertimeStart(emp.overtimeStart || '23:00');
    setEmpOvertimeMultiplier(emp.overtimeMultiplier || 1.5);
    setEmpOvertimeHourlyRate(emp.overtimeHourlyRate || emp.hourlyRate * 1.5 || 27000);
    setEmpPassword(emp.password || '123');
    setEmpSyncPassword(emp.syncPassword || 'admin123');
  };

  const handleCancelEdit = () => {
    setEditingEmployeeId(null);
    setEmpId(getNextEmployeeId(employees));
    setEmpName('');
    setEmpRole('Nhân viên');
    setEmpRate(25000);
    setEmpShiftStartTime('10:00');
    setEmpShiftEndTime('23:00');
    setEmpOvertimeStart('23:00');
    setEmpOvertimeMultiplier(1.5);
    setEmpOvertimeHourlyRate(27000);
    setEmpPassword('123');
    setEmpSyncPassword(employees.find(e => e.syncPassword)?.syncPassword || 'admin123');
  };

  const handleRemoveEmployee = (id: string, name: string) => {
    if (session?.role === 'manager') {
      showAlert('Thông báo', 'Tài khoản Quản lý chỉ có quyền xem, không thể thay đổi dữ liệu.');
      return;
    }
    showConfirm(
      'Xóa nhân viên',
      `Bạn có chắc chắn muốn xóa nhân viên "${name}" (${id}) khỏi hệ thống? Dữ liệu lịch sử sẽ được bảo lưu.`,
      async () => {
        try {
          await deleteDoc(doc(db, 'employees', id));
          addLog('Xóa nhân viên', `Xóa nhân sự ${name} (${id})`);
        } catch (error) {
          showAlert('Lỗi', `Không thể xóa nhân viên: ${error}`);
        }
      }
    );
  };

  const handleSaveShiftPolicy = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (session?.role === 'manager') {
      showAlert('Thông báo', 'Tài khoản Quản lý chỉ có quyền xem, không thể thay đổi dữ liệu.');
      return;
    }
    setSavingShiftPolicy(true);
    playClick();
    try {
      await setDoc(doc(db, 'settings', 'shift_policy'), {
        ...shiftPolicy,
        updatedAt: new Date().toISOString()
      });
      addLog('Cài đặt ca làm việc', `Cập nhật quy định du di (sớm: ${shiftPolicy.earlyGraceMinutes}p, trễ: ${shiftPolicy.lateGraceMinutes}p) & phạt đi trễ (${formatCompactVND(shiftPolicy.tier1RatePerMinute)} / ${formatCompactVND(shiftPolicy.tier2RatePerMinute)} / ${formatCompactVND(shiftPolicy.tier3RatePerMinute)})`);
      playChime();
      showAlert('Thành công', 'Đã lưu cấu hình quy định ca làm việc & mức phạt đi trễ thành công!');
    } catch (error) {
      console.error('Error saving shift policy:', error);
      showAlert('Lỗi', `Không thể lưu quy định ca: ${error}`);
    } finally {
      setSavingShiftPolicy(false);
    }
  };

  const handleResetShiftPolicy = () => {
    if (session?.role === 'manager') {
      showAlert('Thông báo', 'Tài khoản Quản lý chỉ có quyền xem, không thể thay đổi dữ liệu.');
      return;
    }
    showConfirm(
      'Khôi phục quy định chuẩn',
      'Bạn có chắc chắn muốn đặt lại quy định ca về mặc định không?\n• Du di đi sớm: 10 phút (Không phạt)\n• Du di đi trễ: 10 phút (Không phạt)\n• Bậc 1 (≤30p): 1.000đ/phút\n• Bậc 2 (31-60p): 2.000đ/phút\n• Bậc 3 (≥1h): 5.000đ/phút',
      async () => {
        try {
          await setDoc(doc(db, 'settings', 'shift_policy'), {
            ...DEFAULT_SHIFT_POLICY,
            updatedAt: new Date().toISOString()
          });
          setShiftPolicy(DEFAULT_SHIFT_POLICY);
          addLog('Cài đặt ca làm việc', 'Khôi phục quy định du di & phạt đi trễ về chuẩn (10p, 1k-2k-5k)');
          showAlert('Thành công', 'Đã khôi phục quy định ca về chuẩn thành công!');
        } catch (error) {
          showAlert('Lỗi', `Không thể khôi phục quy định: ${error}`);
        }
      }
    );
  };

  const handleSaveShift = (e: React.FormEvent) => {
    e.preventDefault();
    if (session?.role === 'manager') {
      showAlert('Thông báo', 'Tài khoản Quản lý chỉ có quyền xem, không thể thay đổi dữ liệu.');
      return;
    }
    if (!shiftId.trim() || !shiftName.trim()) {
      showAlert('Thông báo', 'Vui lòng điền đầy đủ thông tin ca làm việc.');
      return;
    }

    const uppercaseId = shiftId.trim().toUpperCase();

    const shiftData: Shift = {
      id: editingShiftId || uppercaseId,
      name: shiftName.trim(),
      startTime: shiftStartTime,
      endTime: shiftEndTime,
      multiplier: Number(shiftMultiplier),
      earlyGraceMinutes: shiftCustomGrace ? Number(shiftEarlyGrace) : undefined,
      lateGraceMinutes: shiftCustomGrace ? Number(shiftLateGrace) : undefined,
      lateRate1: shiftCustomGrace ? Number(shiftLateRate1) : undefined,
      lateRate2: shiftCustomGrace ? Number(shiftLateRate2) : undefined,
      lateRate3: shiftCustomGrace ? Number(shiftLateRate3) : undefined,
    };

    if (editingShiftId) {
      // Update
      showConfirm(
        'Cập nhật ca làm việc',
        `Bạn có chắc chắn muốn cập nhật thông tin ca làm việc "${shiftName}" không?`,
        async () => {
          try {
            await setDoc(doc(db, 'shifts', editingShiftId), shiftData);
            addLog('Cập nhật ca làm việc', `Chỉnh sửa thông tin ca làm việc ${shiftName} (${editingShiftId})`);
            setEditingShiftId(null);
            setShiftId('');
            setShiftName('');
            setShiftStartTime('10:00');
            setShiftEndTime('18:00');
            setShiftMultiplier(1.0);
            setShiftCustomGrace(false);
            setShiftEarlyGrace(shiftPolicy.earlyGraceMinutes);
            setShiftLateGrace(shiftPolicy.lateGraceMinutes);
            setShiftLateRate1(shiftPolicy.tier1RatePerMinute);
            setShiftLateRate2(shiftPolicy.tier2RatePerMinute);
            setShiftLateRate3(shiftPolicy.tier3RatePerMinute);
            showAlert('Thành công', `Đã cập nhật ca làm việc "${shiftName}" thành công!`);
          } catch (error) {
            showAlert('Lỗi', `Không thể cập nhật ca làm việc: ${error}`);
          }
        }
      );
    } else {
      // Create
      if (shifts.some(s => s.id.toUpperCase() === uppercaseId)) {
        showAlert('Thông báo', 'Mã ca làm việc này đã tồn tại!');
        return;
      }

      showConfirm(
        'Thêm ca làm việc',
        `Bạn có chắc chắn muốn thêm ca làm việc mới "${shiftName}" (${uppercaseId}) không?`,
        async () => {
          try {
            await setDoc(doc(db, 'shifts', uppercaseId), shiftData);
            addLog('Thêm ca làm việc', `Tạo ca làm việc mới ${shiftName} (${uppercaseId})`);
            setShiftId('');
            setShiftName('');
            setShiftStartTime('10:00');
            setShiftEndTime('18:00');
            setShiftMultiplier(1.0);
            setShiftCustomGrace(false);
            setShiftEarlyGrace(shiftPolicy.earlyGraceMinutes);
            setShiftLateGrace(shiftPolicy.lateGraceMinutes);
            setShiftLateRate1(shiftPolicy.tier1RatePerMinute);
            setShiftLateRate2(shiftPolicy.tier2RatePerMinute);
            setShiftLateRate3(shiftPolicy.tier3RatePerMinute);
            showAlert('Thành công', `Đã tạo ca làm việc "${shiftName}" thành công!`);
          } catch (error) {
            showAlert('Lỗi', `Không thể thêm ca làm việc: ${error}`);
          }
        }
      );
    }
  };

  const handleStartEditShift = (shift: Shift) => {
    setEditingShiftId(shift.id);
    setShiftId(shift.id);
    setShiftName(shift.name);
    setShiftStartTime(shift.startTime || '10:00');
    setShiftEndTime(shift.endTime || '18:00');
    setShiftMultiplier(shift.multiplier);
    if (shift.lateGraceMinutes !== undefined || shift.lateRate1 !== undefined) {
      setShiftCustomGrace(true);
      setShiftEarlyGrace(shift.earlyGraceMinutes ?? shiftPolicy.earlyGraceMinutes);
      setShiftLateGrace(shift.lateGraceMinutes ?? shiftPolicy.lateGraceMinutes);
      setShiftLateRate1(shift.lateRate1 ?? shiftPolicy.tier1RatePerMinute);
      setShiftLateRate2(shift.lateRate2 ?? shiftPolicy.tier2RatePerMinute);
      setShiftLateRate3(shift.lateRate3 ?? shiftPolicy.tier3RatePerMinute);
    } else {
      setShiftCustomGrace(false);
      setShiftEarlyGrace(shiftPolicy.earlyGraceMinutes);
      setShiftLateGrace(shiftPolicy.lateGraceMinutes);
      setShiftLateRate1(shiftPolicy.tier1RatePerMinute);
      setShiftLateRate2(shiftPolicy.tier2RatePerMinute);
      setShiftLateRate3(shiftPolicy.tier3RatePerMinute);
    }
  };

  const handleCancelEditShift = () => {
    setEditingShiftId(null);
    setShiftId('');
    setShiftName('');
    setShiftStartTime('10:00');
    setShiftEndTime('18:00');
    setShiftMultiplier(1.0);
    setShiftCustomGrace(false);
    setShiftEarlyGrace(shiftPolicy.earlyGraceMinutes);
    setShiftLateGrace(shiftPolicy.lateGraceMinutes);
    setShiftLateRate1(shiftPolicy.tier1RatePerMinute);
    setShiftLateRate2(shiftPolicy.tier2RatePerMinute);
    setShiftLateRate3(shiftPolicy.tier3RatePerMinute);
  };

  const handleRemoveShift = (id: string, name: string) => {
    if (session?.role === 'manager') {
      showAlert('Thông báo', 'Tài khoản Quản lý chỉ có quyền xem, không thể thay đổi dữ liệu.');
      return;
    }
    showConfirm(
      'Xóa ca làm việc',
      `Bạn có chắc chắn muốn xóa ca làm việc "${name}" (${id}) khỏi hệ thống?`,
      async () => {
        try {
          await deleteDoc(doc(db, 'shifts', id));
          addLog('Xóa ca làm việc', `Xóa ca làm việc ${name} (${id})`);
        } catch (error) {
          showAlert('Lỗi', `Không thể xóa ca làm việc: ${error}`);
        }
      }
    );
  };


  // Bulk Attendance State
  const [bulkEmpId, setBulkEmpId] = useState('');
  const [bulkYearMonth, setBulkYearMonth] = useState(getCurrentMonthStr);
  const [bulkText, setBulkText] = useState('');
  const [bulkPreviewLogs, setBulkPreviewLogs] = useState<AttendanceLog[]>([]);
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);
  const [bulkInputMode, setBulkInputMode] = useState<'excel' | 'text'>('excel');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Editable row in preview
  const [editingPreviewIdx, setEditingPreviewIdx] = useState<number | null>(null);
  const [previewEditDate, setPreviewEditDate] = useState('');
  const [previewEditInTime, setPreviewEditInTime] = useState('');
  const [previewEditOutTime, setPreviewEditOutTime] = useState('');
  const [previewEditHours, setPreviewEditHours] = useState(8);
  const [previewEditMultiplier, setPreviewEditMultiplier] = useState(1.0);
  const [previewEditStatus, setPreviewEditStatus] = useState<'present' | 'late' | 'absent'>('present');
  const [previewEditNotes, setPreviewEditNotes] = useState('');

  // Excel File Upload & Parser Handler
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    playClick();
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const buffer = evt.target?.result as ArrayBuffer;
        const result = parseAttendanceExcel(buffer, employees, bulkEmpId, bulkYearMonth, shiftPolicy);
        if (result.matchedEmployeeId) {
          setBulkEmpId(result.matchedEmployeeId);
        }
        if (result.detectedMonth) {
          setBulkYearMonth(result.detectedMonth);
        }
        if (result.logs.length > 0) {
          setBulkPreviewLogs(result.logs);
          setBulkErrors(result.errors || []);
          playChime();
          showAlert(
            'Trích xuất Excel thành công',
            `Đã phân tích thành công ${result.logs.length} ngày chấm công từ file Excel "${file.name}"!\n` +
            (result.detectedEmployeeName ? `• Nhân viên phát hiện: ${result.detectedEmployeeName}\n` : '') +
            (result.detectedMonth ? `• Tháng phát hiện: ${result.detectedMonth}\n` : '') +
            `Bạn có thể xem trước và chỉnh sửa kết quả phân tích trong bảng bên phải trước khi bấm lưu.`
          );
        } else {
          setBulkErrors(result.errors.length > 0 ? result.errors : ['Không trích xuất được dữ liệu chấm công từ file Excel.']);
          showAlert('Lỗi đọc Excel', result.errors.join('\n') || 'Không tìm thấy dữ liệu chấm công hợp lệ.');
        }
      } catch (err) {
        console.error("Excel parse error:", err);
        showAlert('Lỗi đọc file', `Không thể đọc file Excel: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleDownloadExcelTemplate = () => {
    try {
      const wb = XLSX.utils.book_new();
      const wsData = [
        ['THỜI GIAN CHẤM CÔNG - NHÂN VIÊN MẪU'],
        ['Từ 01/10/2026 đến 31/10/2026'],
        [''],
        ['Ngày', 'Thời gian', 'Địa điểm', 'Loại', 'Hình thức', 'Tổng thời gian', 'Hệ số', 'Ghi chú'],
        ['01/10/2026', '10:00', 'Serene Store', 'Vào', 'Vân tay', '13 giờ 00 phút', 1.0, 'Ca Full'],
        ['', '23:00', 'Serene Store', 'Ra', 'Vân tay', '', '', ''],
        ['02/10/2026', '10:00', 'Serene Store', 'Vào', 'Vân tay', '15 giờ 00 phút', 1.0, 'Tăng ca 2h'],
        ['', '01:00', 'Serene Store', 'Ra', 'Vân tay', '', '', ''],
        ['03/10/2026', '10:30', 'Serene Store', 'Vào', 'Vân tay', '12 giờ 30 phút', 1.0, 'Trễ 30p'],
        ['', '23:00', 'Serene Store', 'Ra', 'Vân tay', '', '', ''],
        ['04/10/2026', '', '', '', 'Nghỉ', '0', 0, 'Nghỉ phép (off)']
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, 'Chấm Công');
      XLSX.writeFile(wb, 'Mau_Cham_Cong_Serene.xlsx');
      playChime();
    } catch (err) {
      console.error("Error downloading Excel template:", err);
      showAlert('Lỗi', `Không thể tạo file mẫu: ${err}`);
    }
  };

  const handleStartEditPreviewRow = (idx: number) => {
    const log = bulkPreviewLogs[idx];
    setEditingPreviewIdx(idx);
    setPreviewEditDate(log.date);
    setPreviewEditInTime(log.inTime || '');
    setPreviewEditOutTime(log.outTime || '');
    setPreviewEditHours(log.hoursWorked);
    setPreviewEditMultiplier(log.rateMultiplier);
    setPreviewEditStatus(log.status);
    setPreviewEditNotes(log.notes || '');
  };

  const handleSaveEditPreviewRow = () => {
    if (editingPreviewIdx === null) return;
    showConfirm(
      'Xác nhận chỉnh sửa kết quả phân tích',
      `Bạn có chắc chắn muốn cập nhật thông tin dòng chấm công ngày ${previewEditDate} không?`,
      () => {
        const updated = [...bulkPreviewLogs];
        const targetEmp = employees.find(e => e.id === bulkEmpId);
        const shiftStart = targetEmp?.shiftStartTime || '10:00';

        let lateMinutes = 0;
        let latePenalty = 0;
        let status = previewEditStatus;

        if (previewEditInTime && status !== 'absent') {
          const lateCalc = calculateShiftLatePenalty(previewEditInTime, shiftStart, shiftPolicy);
          lateMinutes = lateCalc.lateMinutes;
          latePenalty = lateCalc.totalPenalty;
          if (lateCalc.status === 'late') {
            status = 'late';
          }
        }

        const tempLog: AttendanceLog = {
          ...updated[editingPreviewIdx],
          date: previewEditDate,
          inTime: previewEditInTime,
          outTime: previewEditOutTime,
          hoursWorked: previewEditHours,
          rateMultiplier: previewEditMultiplier,
          status,
          notes: previewEditNotes,
          lateMinutes,
          latePenalty
        };

        const details = getDailyAttendanceDetails(tempLog, targetEmp, shiftPolicy);
        updated[editingPreviewIdx] = {
          ...tempLog,
          hoursWorked: details.totalHours,
          regularHours: details.regularHours,
          overtimeHours: details.overtimeHours,
          regularSalary: details.regularSalary,
          overtimeSalary: details.overtimeSalary,
          lateMinutes: details.lateMinutes,
          latePenalty: details.latePenalty
        };

        setBulkPreviewLogs(updated);
        setEditingPreviewIdx(null);
        showAlert('Thành công', `Đã cập nhật dữ liệu ngày ${previewEditDate} trong bảng xem trước!`);
      }
    );
  };

  const handleDeletePreviewRow = (idx: number) => {
    const row = bulkPreviewLogs[idx];
    showConfirm(
      'Xác nhận xóa dòng xem trước',
      `Bạn có chắc chắn muốn xóa dòng chấm công ngày ${row.date} khỏi bảng xem trước không?`,
      () => {
        setBulkPreviewLogs(prev => prev.filter((_, i) => i !== idx));
        if (editingPreviewIdx === idx) {
          setEditingPreviewIdx(null);
        }
      }
    );
  };

  // Parser function for Bulk Text
  const parseBulkText = () => {
    if (!bulkEmpId) {
      setBulkPreviewLogs([]);
      setBulkErrors(['Vui lòng chọn nhân viên trước khi phân tích cú pháp.']);
      return;
    }
    if (!bulkText.trim()) {
      setBulkPreviewLogs([]);
      setBulkErrors([]);
      return;
    }

    const targetEmp = employees.find(e => e.id === bulkEmpId);
    const shiftStartTime = targetEmp?.shiftStartTime || '10:00';
    const lines = bulkText.split('\n');
    const parsedLogs: AttendanceLog[] = [];
    const errors: string[] = [];

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // Standardize spaces around hyphens/tildes so "10:00 - 23:20" becomes "10:00-23:20"
      const standardizedLine = trimmed.replace(/\s*([-~])\s*/g, '$1');
      const tokens = standardizedLine.split(/\s+/);
      const dayStr = tokens[0];

      let formattedDate = '';
      if (dayStr.includes('/')) {
        const slashParts = dayStr.split('/');
        const dayNum = parseInt(slashParts[0], 10);
        const monthNum = parseInt(slashParts[1], 10);
        const yearPart = slashParts[2] ? parseInt(slashParts[2], 10) : parseInt(bulkYearMonth.split('-')[0], 10);
        if (isNaN(dayNum) || dayNum < 1 || dayNum > 31 || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
          errors.push(`Dòng ${idx + 1}: Ngày không hợp lệ ("${dayStr}")`);
          return;
        }
        formattedDate = `${yearPart}-${monthNum.toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}`;
      } else {
        const dayNum = parseInt(dayStr, 10);
        if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
          errors.push(`Dòng ${idx + 1}: Ngày không hợp lệ ("${dayStr}")`);
          return;
        }
        formattedDate = `${bulkYearMonth}-${dayNum.toString().padStart(2, '0')}`;
      }

      const remainingTokens = tokens.slice(1);

      let hoursWorked = 8; // Default
      let multiplier = 1.0;
      let status: AttendanceLog['status'] = 'present';
      let isAbsent = false;
      let inTime = '';
      let outTime = '';
      const notesParts: string[] = [];

      remainingTokens.forEach(token => {
        const lowerTok = token.toLowerCase();

        // 1. Detect Special Multipliers
        if (lowerTok === 'tv' || lowerTok === 'thửviệc' || lowerTok === 'thửvc' || lowerTok === 'thuviec') {
          multiplier = 0.5;
          notesParts.push('Thử việc (50% lương)');
        } else if (lowerTok === 'nghỉ' || lowerTok === 'off' || lowerTok === 'vắng') {
          multiplier = 0.0;
          status = 'absent';
          isAbsent = true;
          hoursWorked = 0;
          notesParts.push('Nghỉ công');
        } else if (lowerTok === 'ot' || lowerTok === 'tăngca' || lowerTok === 'tc') {
          multiplier = 1.5;
          notesParts.push('Tăng ca (150% lương)');
        } 
        // 2. Detect Time Range, e.g. "10:00-23:00" or "10:00-01:00" or "8:00-17:30"
        else if (lowerTok.includes('-') || lowerTok.includes('~')) {
          const parts = lowerTok.split(/[-~]/);
          if (parts.length === 2) {
            const startStr = parts[0];
            const endStr = parts[1];

            const convertToHours = (timeStr: string) => {
              const tParts = timeStr.split(':');
              let hh = parseInt(tParts[0], 10);
              let mm = tParts[1] ? parseInt(tParts[1], 10) : 0;
              if (isNaN(hh)) hh = 8;
              if (isNaN(mm)) mm = 0;
              return hh + mm / 60;
            };

            const startDecimal = convertToHours(startStr);
            const endDecimal = convertToHours(endStr);
            inTime = startStr;
            outTime = endStr;

            if (endDecimal < startDecimal) {
              // Overnight crossover
              hoursWorked = Math.round(((24 - startDecimal) + endDecimal) * 100) / 100;
            } else {
              hoursWorked = Math.round((endDecimal - startDecimal) * 100) / 100;
            }
          }
        } 
        // 3. Detect raw numeric hours
        else {
          const numericHours = parseFloat(token);
          if (!isNaN(numericHours)) {
            hoursWorked = numericHours;
          } else {
            notesParts.push(token); // Arbitrary text becomes a note token
          }
        }
      });

      // Calculate late arrival penalty and minutes
      let lateMinutes = 0;
      let latePenalty = 0;
      if (inTime && !isAbsent) {
        const lateCalc = calculateShiftLatePenalty(inTime, shiftStartTime, shiftPolicy);
        lateMinutes = lateCalc.lateMinutes;
        latePenalty = lateCalc.totalPenalty;
        if (lateCalc.status === 'late') {
          status = 'late';
        }
      }

      const tempLog: AttendanceLog = {
        id: `att-bulk-${Date.now()}-${idx}`,
        employeeId: bulkEmpId,
        date: formattedDate,
        hoursWorked,
        status: status,
        rateMultiplier: multiplier,
        notes: notesParts.join(' • ') || '',
        inTime: inTime || '',
        outTime: outTime || '',
        lateMinutes,
        latePenalty
      };

      const details = getDailyAttendanceDetails(tempLog, targetEmp, shiftPolicy);

      parsedLogs.push({
        ...tempLog,
        hoursWorked: details.totalHours,
        regularHours: details.regularHours,
        overtimeHours: details.overtimeHours,
        regularSalary: details.regularSalary,
        overtimeSalary: details.overtimeSalary,
        lateMinutes: details.lateMinutes,
        latePenalty: details.latePenalty
      });
    });

    setBulkPreviewLogs(parsedLogs);
    setBulkErrors(errors);
  };

  // Run preview parser when inputs change (only in text paste mode)
  useEffect(() => {
    if (bulkInputMode === 'text') {
      parseBulkText();
    }
  }, [bulkText, bulkEmpId, bulkYearMonth, shiftPolicy, bulkInputMode]);

  const handleSaveBulkAttendance = (e: React.FormEvent) => {
    e.preventDefault();
    if (session?.role === 'manager') {
      showAlert('Thông báo', 'Tài khoản Quản lý chỉ có quyền xem, không thể thay đổi dữ liệu.');
      return;
    }
    if (bulkPreviewLogs.length === 0) return;

    showConfirm(
      'Lưu chấm công hàng loạt',
      `Bạn có chắc chắn muốn lưu ${bulkPreviewLogs.length} ca làm việc (chấm công hàng loạt) này không? Hệ thống sẽ tự động đồng bộ hóa các khoản khấu trừ đi trễ vào bảng lương.`,
      async () => {
        try {
          // Find any existing logs of this employee for the dates in preview to delete/overwrite
          const previewDates = bulkPreviewLogs.map(log => log.date);
          const existingLogsToDelete = attendance.filter(
            log => log.employeeId === bulkEmpId && previewDates.includes(log.date)
          );

          // Delete existing ones
          await Promise.all(existingLogsToDelete.map(log => deleteDoc(doc(db, 'attendance', log.id))));

          // Set new ones
          await Promise.all(bulkPreviewLogs.map(log => setDoc(doc(db, 'attendance', log.id), log)));

          // Synchronize late penalty adjustments for these dates
          await Promise.all(
            bulkPreviewLogs.map(async (log) => {
              const adjId = `adj-late-${bulkEmpId}-${log.date}`;
              if (log.latePenalty && log.latePenalty > 0) {
                const lateAdj: PayrollAdjustment = {
                  id: adjId,
                  employeeId: bulkEmpId,
                  date: log.date,
                  amount: log.latePenalty,
                  type: 'penalty',
                  reason: `Khấu trừ đi trễ ngày ${log.date} (${log.lateMinutes}p: -${formatCompactVND(log.latePenalty)})`
                };
                await setDoc(doc(db, 'adjustments', adjId), lateAdj);
              } else {
                // If on time or excused, delete old late penalty adjustment if present
                await deleteDoc(doc(db, 'adjustments', adjId)).catch(() => {});
              }
            })
          );

          const targetEmp = employees.find(e => e.id === bulkEmpId);
          const totalLatePenaltySum = bulkPreviewLogs.reduce((acc, log) => acc + (log.latePenalty || 0), 0);
          addLog('Nhập công hàng loạt', `Đã lưu ${bulkPreviewLogs.length} ngày chấm công cho ${targetEmp?.name || bulkEmpId}${totalLatePenaltySum > 0 ? ` (Tự động khấu trừ đi trễ: -${formatVND(totalLatePenaltySum)})` : ''}`);
          
          showAlert('Thành công', `Đã nhập thành công ${bulkPreviewLogs.length} ngày chấm công cho nhân sự! Các khoản khấu trừ đi trễ đã được tự động áp dụng vào bảng lương.`);
          setBulkText('');
          setBulkPreviewLogs([]);
        } catch (error) {
          showAlert('Lỗi', `Không thể lưu chấm công hàng loạt: ${error}`);
        }
      }
    );
  };

  // Single Day Quick Attendance state
  const [attDate, setAttDate] = useState(getTodayString());
  const [attHours, setAttHours] = useState<Record<string, number>>({});
  const [attStatus, setAttStatus] = useState<Record<string, 'present' | 'late' | 'absent'>>({});
  const [attNotes, setAttNotes] = useState<Record<string, string>>({});
  const [attMultiplier, setAttMultiplier] = useState<Record<string, number>>({});
  const [attShiftId, setAttShiftId] = useState<Record<string, string>>({});
  const [attInTime, setAttInTime] = useState<Record<string, string>>({});
  const [attOutTime, setAttOutTime] = useState<Record<string, string>>({});

  useEffect(() => {
    const initialHours: Record<string, number> = {};
    const initialStatus: Record<string, 'present' | 'late' | 'absent'> = {};
    const initialNotes: Record<string, string> = {};
    const initialMultiplier: Record<string, number> = {};
    const initialShiftId: Record<string, string> = {};
    const initialInTime: Record<string, string> = {};
    const initialOutTime: Record<string, string> = {};

    employees.forEach(emp => {
      const existing = attendance.find(log => log.employeeId === emp.id && log.date === attDate);
      if (existing) {
        initialHours[emp.id] = existing.hoursWorked;
        initialStatus[emp.id] = existing.status;
        initialNotes[emp.id] = existing.notes || '';
        initialMultiplier[emp.id] = existing.rateMultiplier;
        initialShiftId[emp.id] = existing.shiftId || '';
        initialInTime[emp.id] = existing.inTime || '';
        initialOutTime[emp.id] = existing.outTime || '';
      } else {
        initialHours[emp.id] = 8;
        initialStatus[emp.id] = 'present';
        initialNotes[emp.id] = '';
        initialMultiplier[emp.id] = 1.0;
        initialShiftId[emp.id] = '';
        initialInTime[emp.id] = '';
        initialOutTime[emp.id] = '';
      }
    });

    setAttHours(initialHours);
    setAttStatus(initialStatus);
    setAttNotes(initialNotes);
    setAttMultiplier(initialMultiplier);
    setAttShiftId(initialShiftId);
    setAttInTime(initialInTime);
    setAttOutTime(initialOutTime);
  }, [attDate, employees, attendance]);

  const handleSaveDailyAttendance = (e: React.FormEvent) => {
    e.preventDefault();

    if (session?.role === 'manager') {
      showAlert('Thông báo', 'Tài khoản Quản lý chỉ có quyền xem, không thể thay đổi dữ liệu.');
      return;
    }

    showConfirm(
      'Lưu bảng chấm công',
      `Bạn có chắc chắn muốn lưu/cập nhật bảng chấm công ngày ${attDate} cho toàn bộ nhân viên không?`,
      async () => {
        try {
          const logsToSave: AttendanceLog[] = [];
          for (const emp of employees) {
            const existing = attendance.find(log => log.employeeId === emp.id && log.date === attDate);
            const logId = existing ? existing.id : `att-${Date.now()}-${emp.id}`;
            const isPresent = (attStatus[emp.id] || 'present') !== 'absent';
            const logInTime = isPresent ? (attInTime[emp.id] || '') : '';
            const logOutTime = isPresent ? (attOutTime[emp.id] || '') : '';
            const shiftIdVal = attShiftId[emp.id] || '';

            const tempLog: AttendanceLog = {
              id: logId,
              employeeId: emp.id,
              date: attDate,
              hoursWorked: isPresent ? 8 : 0,
              status: attStatus[emp.id] || 'present',
              rateMultiplier: isPresent ? Number(attMultiplier[emp.id] ?? 1.0) : 0.0,
              notes: attNotes[emp.id] || '',
              inTime: logInTime,
              outTime: logOutTime,
              shiftId: shiftIdVal
            };

            const details = getDailyAttendanceDetails(tempLog, emp, shiftPolicy);

            const logData: AttendanceLog = {
              ...tempLog,
              hoursWorked: details.totalHours,
              regularHours: details.regularHours,
              overtimeHours: details.overtimeHours,
              regularSalary: details.regularSalary,
              overtimeSalary: details.overtimeSalary,
              lateMinutes: details.lateMinutes,
              latePenalty: details.latePenalty,
              status: details.isLate ? 'late' : tempLog.status
            };
            logsToSave.push(logData);

            const adjId = `adj-late-${emp.id}-${attDate}`;
            if (details.latePenalty > 0) {
              await setDoc(doc(db, 'adjustments', adjId), {
                id: adjId,
                employeeId: emp.id,
                date: attDate,
                amount: details.latePenalty,
                type: 'penalty',
                reason: `Khấu trừ đi trễ ngày ${attDate} (${details.lateMinutes}p: -${formatCompactVND(details.latePenalty)})`
              });
            } else {
              await deleteDoc(doc(db, 'adjustments', adjId)).catch(() => {});
            }
          }

          await Promise.all(logsToSave.map(log => setDoc(doc(db, 'attendance', log.id), log)));
          addLog('Chấm công ngày', `Cập nhật chấm công ngày ${attDate} cho toàn bộ nhân sự`);
          showAlert('Thành công', `Đã lưu bảng chấm công ngày ${attDate} thành công!`);
        } catch (error) {
          showAlert('Lỗi', `Không thể lưu bảng chấm công: ${error}`);
        }
      }
    );
  };

  const handleSaveIndividualAttendance = (empId: string) => {
    if (session?.role === 'manager') {
      showAlert('Thông báo', 'Tài khoản Quản lý chỉ có quyền xem, không thể thay đổi dữ liệu.');
      return;
    }

    const emp = employees.find(e => e.id === empId);
    if (!emp) return;

    showConfirm(
      'Lưu chấm công cá nhân',
      `Bạn có chắc chắn muốn lưu bản chấm công ngày ${attDate} cho nhân viên ${emp.name} không?`,
      async () => {
        try {
          const existing = attendance.find(log => log.employeeId === empId && log.date === attDate);
          const logId = existing ? existing.id : `att-${Date.now()}-${empId}`;
          const isPresent = (attStatus[empId] || 'present') !== 'absent';
          const logInTime = isPresent ? (attInTime[empId] || '') : '';
          const logOutTime = isPresent ? (attOutTime[empId] || '') : '';
          const shiftIdVal = attShiftId[empId] || '';

          const tempLog: AttendanceLog = {
            id: logId,
            employeeId: empId,
            date: attDate,
            hoursWorked: isPresent ? 8 : 0,
            status: attStatus[empId] || 'present',
            rateMultiplier: isPresent ? Number(attMultiplier[empId] ?? 1.0) : 0.0,
            notes: attNotes[empId] || '',
            inTime: logInTime,
            outTime: logOutTime,
            shiftId: shiftIdVal
          };

          const details = getDailyAttendanceDetails(tempLog, emp, shiftPolicy);

          const logData: AttendanceLog = {
            ...tempLog,
            hoursWorked: details.totalHours,
            regularHours: details.regularHours,
            overtimeHours: details.overtimeHours,
            regularSalary: details.regularSalary,
            overtimeSalary: details.overtimeSalary,
            lateMinutes: details.lateMinutes,
            latePenalty: details.latePenalty,
            status: details.isLate ? 'late' : tempLog.status
          };

          await setDoc(doc(db, 'attendance', logId), logData);

          const adjId = `adj-late-${empId}-${attDate}`;
          if (details.latePenalty > 0) {
            await setDoc(doc(db, 'adjustments', adjId), {
              id: adjId,
              employeeId: empId,
              date: attDate,
              amount: details.latePenalty,
              type: 'penalty',
              reason: `Khấu trừ đi trễ ngày ${attDate} (${details.lateMinutes}p: -${formatCompactVND(details.latePenalty)})`
            });
          } else {
            await deleteDoc(doc(db, 'adjustments', adjId)).catch(() => {});
          }

          addLog('Chấm công ngày', `Cập nhật chấm công ngày ${attDate} cho nhân viên ${emp.name}`);
          showAlert('Thành công', `Đã lưu bản chấm công cho nhân viên ${emp.name} thành công!`);
        } catch (error) {
          showAlert('Lỗi', `Không thể lưu bản chấm công: ${error}`);
        }
      }
    );
  };

  const handleAutoCalculateHours = (inStr: string, outStr: string) => {
    if (!inStr || !outStr) return;
    const partsIn = inStr.split(':');
    const hIn = parseInt(partsIn[0], 10);
    const mIn = partsIn[1] ? parseInt(partsIn[1], 10) : 0;
    
    const partsOut = outStr.split(':');
    const hOut = parseInt(partsOut[0], 10);
    const mOut = partsOut[1] ? parseInt(partsOut[1], 10) : 0;
    
    if (isNaN(hIn) || isNaN(hOut)) return;
    
    let inMin = hIn * 60 + mIn;
    let outMin = hOut * 60 + mOut;
    if (outMin < inMin) {
      outMin += 1440;
    }
    const diffHours = Math.round(((outMin - inMin) / 60) * 100) / 100;
    setEditLogHours(diffHours);
  };

  const handleSaveEditedLog = async (logId: string, logDate: string) => {
    if (session?.role === 'manager') {
      showAlert('Thông báo', 'Tài khoản Quản lý chỉ có quyền xem, không thể thay đổi dữ liệu.');
      return;
    }
    if (!viewingHistoryEmployee) return;
    try {
      const ref = doc(db, 'attendance', logId);
      
      const tempLog: AttendanceLog = {
        id: logId,
        employeeId: viewingHistoryEmployee.id,
        date: logDate,
        hoursWorked: Number(editLogHours),
        status: editLogStatus,
        rateMultiplier: Number(editLogMultiplier),
        notes: editLogNotes,
        inTime: editLogInTime,
        outTime: editLogOutTime
      };

      const details = getDailyAttendanceDetails(tempLog, viewingHistoryEmployee, shiftPolicy);

      const logData: AttendanceLog = {
        ...tempLog,
        hoursWorked: details.totalHours,
        regularHours: details.regularHours,
        overtimeHours: details.overtimeHours,
        regularSalary: details.regularSalary,
        overtimeSalary: details.overtimeSalary,
        lateMinutes: details.lateMinutes,
        latePenalty: details.latePenalty,
        status: details.isLate ? 'late' : tempLog.status
      };

      await setDoc(ref, logData);

      const adjId = `adj-late-${viewingHistoryEmployee.id}-${logDate}`;
      if (details.latePenalty > 0) {
        await setDoc(doc(db, 'adjustments', adjId), {
          id: adjId,
          employeeId: viewingHistoryEmployee.id,
          date: logDate,
          amount: details.latePenalty,
          type: 'penalty',
          reason: `Khấu trừ đi trễ ngày ${logDate} (${details.lateMinutes}p: -${formatCompactVND(details.latePenalty)})`
        });
      } else {
        await deleteDoc(doc(db, 'adjustments', adjId)).catch(() => {});
      }

      addLog('Chỉnh sửa công', `Cập nhật ngày công ${logDate} của ${viewingHistoryEmployee.name}`);
      setEditingLogId(null);
    } catch (error) {
      showAlert('Lỗi', `Không thể lưu chỉnh sửa ngày công: ${error}`);
    }
  };

  const handleClearMonthPayroll = () => {
    if (session?.role === 'manager') {
      showAlert('Thông báo', 'Tài khoản Quản lý chỉ có quyền xem, không thể thay đổi dữ liệu.');
      return;
    }
    showConfirm(
      'XÓA BẢNG LƯƠNG THÁNG',
      `CẢNH BÁO: Bạn có chắc chắn muốn xóa TOÀN BỘ dữ liệu chấm công và thưởng phạt của tất cả nhân viên trong tháng ${selectedMonth} không? Toàn bộ bảng lương tháng này sẽ bị xóa sạch để làm lại. Thao tác này không thể hoàn tác!`,
      async () => {
        try {
          const attInMonth = attendance.filter(log => getMonthYearString(log.date) === selectedMonth);
          const adjInMonth = adjustments.filter(adj => getMonthYearString(adj.date) === selectedMonth);

          await Promise.all([
            ...attInMonth.map(log => deleteDoc(doc(db, 'attendance', log.id))),
            ...adjInMonth.map(adj => deleteDoc(doc(db, 'adjustments', adj.id)))
          ]);

          addLog('Xóa bảng lương', `Xóa toàn bộ dữ liệu lương tháng ${selectedMonth}`);
          showAlert('Thành công', `Đã xóa sạch dữ liệu bảng lương tháng ${selectedMonth}! Bạn có thể tiến hành chấm công lại.`);
        } catch (error) {
          showAlert('Lỗi', `Không thể xóa bảng lương tháng: ${error}`);
        }
      }
    );
  };

  const handleResetDatabaseToDefaults = () => {
    if (session?.role === 'manager') {
      showAlert('Thông báo', 'Tài khoản Quản lý chỉ có quyền xem, không thể thay đổi dữ liệu.');
      return;
    }
    showConfirm(
      'Khôi phục dữ liệu mặc định',
      'Bạn có chắc chắn muốn KHÔI PHỤC TOÀN BỘ dữ liệu mặc định từ mã nguồn không? Toàn bộ nhân viên, chấm công, ca làm việc hiện tại trong cơ sở dữ liệu sẽ bị xóa sạch và nạp lại từ dữ liệu mẫu mặc định trong code.',
      async () => {
        try {
          // Delete everything
          await Promise.all([
            ...employees.map(emp => deleteDoc(doc(db, 'employees', emp.id))),
            ...attendance.map(log => deleteDoc(doc(db, 'attendance', log.id))),
            ...adjustments.map(adj => deleteDoc(doc(db, 'adjustments', adj.id))),
            ...shifts.map(shift => deleteDoc(doc(db, 'shifts', shift.id))),
            ...activities.map(act => deleteDoc(doc(db, 'activities', act.id)))
          ]);

          // Set employees
          await Promise.all(
            DEFAULT_EMPLOYEES.map(emp =>
              setDoc(doc(db, 'employees', emp.id), {
                id: emp.id,
                name: emp.name,
                role: emp.role,
                hourlyRate: emp.hourlyRate,
                createdAt: emp.createdAt || getTodayString(),
                shiftStartTime: emp.shiftStartTime || '15:00',
                shiftEndTime: emp.shiftEndTime || '01:00',
                overtimeStart: emp.overtimeStart || '01:00',
                overtimeMultiplier: emp.overtimeMultiplier || 1.5,
                overtimeHourlyRate: emp.overtimeHourlyRate || 27000,
                password: emp.password || '123',
                syncPassword: emp.syncPassword || 'admin123'
              })
            )
          );

          // Set attendance
          await Promise.all(
            DEFAULT_ATTENDANCE.map(att =>
              setDoc(doc(db, 'attendance', att.id), {
                employeeId: att.employeeId,
                date: att.date,
                hoursWorked: att.hoursWorked,
                status: att.status,
                rateMultiplier: att.rateMultiplier,
                notes: att.notes || '',
                inTime: att.inTime || '15:00',
                outTime: att.outTime || '01:00',
                shiftId: att.shiftId || '',
                regularHours: att.regularHours ?? 8,
                overtimeHours: att.overtimeHours ?? 0,
                regularSalary: att.regularSalary ?? (8 * 25000),
                overtimeSalary: att.overtimeSalary ?? 0
              })
            )
          );

          // Set shifts
          await Promise.all(
            DEFAULT_SHIFTS.map(shift =>
              setDoc(doc(db, 'shifts', shift.id), {
                id: shift.id,
                name: shift.name,
                startTime: shift.startTime,
                endTime: shift.endTime,
                multiplier: shift.multiplier
              })
            )
          );

          // Set activities
          await Promise.all(
            DEFAULT_ACTIVITIES.map(act =>
              setDoc(doc(db, 'activities', act.id), {
                id: act.id,
                timestamp: act.timestamp,
                action: act.action,
                details: act.details
              })
            )
          );

          addLog('Khôi phục mặc định', 'Khôi phục toàn bộ dữ liệu mặc định từ code mẫu');
          showAlert('Thành công', 'Đã khôi phục thành công toàn bộ dữ liệu mặc định từ mã nguồn!');
        } catch (error) {
          showAlert('Lỗi', `Không thể khôi phục dữ liệu mặc định: ${error}`);
        }
      }
    );
  };

  const handleSaveSelfInfo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selfName.trim() || !selfPassword.trim()) {
      showAlert('Thông báo', 'Vui lòng điền đầy đủ thông tin.');
      return;
    }

    showConfirm(
      'Xác nhận cập nhật mật khẩu',
      'Bạn có chắc chắn muốn thay đổi mật khẩu cá nhân không? Hệ thống sẽ tự động đồng bộ hóa mật khẩu mới lên cơ sở dữ liệu.',
      async () => {
        try {
          const empId = session?.employeeId;
          if (!empId) return;

          const currentEmp = employees.find(e => e.id === empId);
          if (!currentEmp) return;

          const updatedEmp: Employee = {
            ...currentEmp,
            name: selfName.trim(),
            password: selfPassword.trim()
          };

          await setDoc(doc(db, 'employees', empId), updatedEmp);

          // Find all attendance records of this employee and update their calculated salaries based on the new name
          const empAttendanceToUpdate = attendance.filter(log => log.employeeId === empId);
          if (empAttendanceToUpdate.length > 0) {
            await Promise.all(
              empAttendanceToUpdate.map(async (log) => {
                const details = getDailyAttendanceDetails(log, updatedEmp);
                const updatedLog: AttendanceLog = {
                  ...log,
                  hoursWorked: details.totalHours,
                  regularHours: details.regularHours,
                  overtimeHours: details.overtimeHours,
                  regularSalary: details.regularSalary,
                  overtimeSalary: details.overtimeSalary
                };
                await setDoc(doc(db, 'attendance', log.id), updatedLog);
              })
            );
          }

          addLog('Cập nhật cá nhân', `Nhân viên ${currentEmp.name} tự thay đổi tên/mật khẩu`);
          showAlert('Thành công', 'Thay đổi mật khẩu thành công và tự động đồng bộ lên hệ thống!');
          setIsEditingSelf(false);
        } catch (error) {
          showAlert('Lỗi', `Không thể cập nhật thông tin: ${error}`);
        }
      }
    );
  };

  // Adjustment (Thưởng/Phạt) states
  const [adjEmpId, setAdjEmpId] = useState('');
  const [adjType, setAdjType] = useState<'bonus' | 'penalty'>('bonus');
  const [adjAmount, setAdjAmount] = useState(100000);
  const [adjReason, setAdjReason] = useState('');
  const [adjDate, setAdjDate] = useState(getTodayString());
  const [editingAdjustmentId, setEditingAdjustmentId] = useState<string | null>(null);

  const handleAddAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (session?.role === 'manager') {
      showAlert('Thông báo', 'Tài khoản Quản lý chỉ có quyền xem, không thể thay đổi dữ liệu.');
      return;
    }
    if (!adjEmpId || !adjReason.trim()) {
      showAlert('Thông báo', 'Vui lòng điền đủ thông tin để ghi nhận.');
      return;
    }

    const id = editingAdjustmentId || `adj-${Date.now()}`;
    const newAdj: PayrollAdjustment = {
      id,
      employeeId: adjEmpId,
      date: adjDate,
      amount: Number(adjAmount),
      type: adjType,
      reason: adjReason.trim()
    };

    try {
      await setDoc(doc(db, 'adjustments', id), newAdj);
      const emp = employees.find(e => e.id === adjEmpId);
      addLog('Điều chỉnh lương', `${editingAdjustmentId ? 'Cập nhật' : 'Ghi nhận'} ${adjType === 'bonus' ? 'Thưởng' : 'Phạt'} ${formatVND(adjAmount)} cho ${emp?.name || adjEmpId}`);
      
      // Reset Form
      setAdjReason('');
      setAdjAmount(100000);
      setEditingAdjustmentId(null);
      setAdjEmpId('');
      showAlert('Thành công', `${editingAdjustmentId ? 'Cập nhật' : 'Ghi nhận'} khoản thưởng/phạt thành công!`);
    } catch (error) {
      showAlert('Lỗi', `Không thể ghi nhận điều chỉnh: ${error}`);
    }
  };

  const handleStartEditAdjustment = (adj: PayrollAdjustment) => {
    setEditingAdjustmentId(adj.id);
    setAdjEmpId(adj.employeeId);
    setAdjType(adj.type);
    setAdjAmount(adj.amount);
    setAdjDate(adj.date);
    setAdjReason(adj.reason);
  };

  const handleStartEditFromModal = (adj: PayrollAdjustment) => {
    setViewingHistoryEmployee(null);
    setActiveTab('adjustments');
    handleStartEditAdjustment(adj);
  };

  const handleCancelEditAdjustment = () => {
    setEditingAdjustmentId(null);
    setAdjEmpId('');
    setAdjType('bonus');
    setAdjAmount(100000);
    setAdjDate(getTodayString());
    setAdjReason('');
  };

  const handleRemoveAdjustment = (id: string, empName: string, amount: number, type: 'bonus' | 'penalty') => {
    if (session?.role === 'manager') {
      showAlert('Thông báo', 'Tài khoản Quản lý chỉ có quyền xem, không thể thay đổi dữ liệu.');
      return;
    }
    showConfirm(
      'Hủy điều chỉnh lương',
      `Bạn có chắc chắn muốn hủy bỏ khoản ${type === 'bonus' ? 'Thưởng' : 'Phạt'} trị giá ${formatVND(amount)} của ${empName}?`,
      async () => {
        try {
          if (id.startsWith('adj-auto-bonus-')) {
            setDismissedAutoBonuses(prev => ({ ...prev, [id]: true }));
            await setDoc(doc(db, 'dismissed_auto_bonuses', id), { dismissed: true });
          }
          await deleteDoc(doc(db, 'adjustments', id));
          addLog('Xóa điều chỉnh', `Hủy bỏ ${type === 'bonus' ? 'Thưởng' : 'Phạt'} của ${empName}`);
          if (editingAdjustmentId === id) {
            handleCancelEditAdjustment();
          }
        } catch (error) {
          showAlert('Lỗi', `Không thể xóa điều chỉnh: ${error}`);
        }
      }
    );
  };

  // Calculations for report
  const reportData = useMemo(() => {
    return employees
      .filter(emp => {
        const matchesSearch = emp.name.toLowerCase().includes(searchTerm.toLowerCase()) || emp.id.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesSearch;
      })
      .map(emp => {
        // Attendance filter
        const empAttendance = attendance.filter(
          log => log.employeeId === emp.id && getMonthYearString(log.date) === selectedMonth
        );

        // Advanced calculation (Hours * Rate * Multiplier)
        let baseEarned = 0;
        let totalHours = 0;
        let regularHoursTotal = 0;
        let overtimeHoursTotal = 0;
        let regularSalaryTotal = 0;
        let overtimeSalaryTotal = 0;
        let totalLateMinutes = 0;
        let totalLatePenalties = 0;
        let lateCount = 0;

        empAttendance.forEach(log => {
          const details = getDailyAttendanceDetails(log, emp, shiftPolicy);
          totalHours += details.totalHours;
          baseEarned += details.totalSalary;
          regularHoursTotal += details.regularHours;
          overtimeHoursTotal += details.overtimeHours;
          regularSalaryTotal += details.regularSalary;
          overtimeSalaryTotal += details.overtimeSalary;

          if (details.lateMinutes > 0) {
            totalLateMinutes += details.lateMinutes;
          }
          if (details.latePenalty > 0) {
            totalLatePenalties += details.latePenalty;
            lateCount += 1;
          }
        });

        // Meal Allowance is removed completely (always 0)
        const workingDaysCount = empAttendance.filter(log => log.status !== 'absent').length;
        const mealAllowance = 0;

        // Adjustments filter
        const empAdjustments = adjustments.filter(
          adj => adj.employeeId === emp.id && getMonthYearString(adj.date) === selectedMonth
        );

        // Dynamic auto bonus injection
        const autoBonus = getAutoBonusForEmployee(emp, selectedMonth, attendance, dismissedAutoBonuses);
        const empAdjustmentsWithAuto = [...empAdjustments];
        if (autoBonus && !empAdjustments.some(adj => adj.id === autoBonus.id)) {
          empAdjustmentsWithAuto.push(autoBonus);
        }

        const totalBonuses = empAdjustmentsWithAuto
          .filter(adj => adj.type === 'bonus')
          .reduce((acc, curr) => acc + curr.amount, 0);

        // Explicit penalties excluding any auto late adjustments to avoid double counting
        const explicitPenalties = empAdjustmentsWithAuto
          .filter(adj => adj.type === 'penalty' && !adj.id.startsWith('adj-late-'))
          .reduce((acc, curr) => acc + curr.amount, 0);

        const recordedLatePenalties = empAdjustmentsWithAuto
          .filter(adj => adj.type === 'penalty' && adj.id.startsWith('adj-late-'))
          .reduce((acc, curr) => acc + curr.amount, 0);

        // Effective late deduction: if already in adjustments, use recorded; otherwise use totalLatePenalties from logs
        const isPenaltyApplicable = isLatePenaltyApplicable(selectedMonth, emp.id, lateSettings);
        const rawLatePenalties = Math.max(recordedLatePenalties, totalLatePenalties);
        const effectiveLatePenalties = isPenaltyApplicable ? rawLatePenalties : 0;
        const totalPenalties = explicitPenalties + effectiveLatePenalties;
        const totalDeductions = totalPenalties;

        const finalSalary = Math.max(0, baseEarned + totalBonuses - totalDeductions);

        return {
          employee: emp,
          attendance: empAttendance,
          adjustments: empAdjustmentsWithAuto,
          totalHours,
          workingDaysCount,
          baseEarned,
          mealAllowance,
          totalBonuses,
          insuranceDeduction: 0,
          totalPenalties,
          totalDeductions,
          finalSalary,
          hasAttendanceBonus: !!autoBonus,
          attendanceBonusAmount: autoBonus ? autoBonus.amount : 0,
          regularHoursTotal,
          overtimeHoursTotal,
          regularSalaryTotal,
          overtimeSalaryTotal,
          totalLateMinutes,
          totalLatePenalties: effectiveLatePenalties,
          rawLatePenalties,
          isPenaltyApplicable,
          lateCount
        };
      });
  }, [employees, attendance, adjustments, selectedMonth, searchTerm, dismissedAutoBonuses, shiftPolicy, lateSettings]);

  // Overall sums
  const totalHoursAll = reportData.reduce((acc, curr) => acc + curr.totalHours, 0);
  const totalBonusAll = reportData.reduce((acc, curr) => acc + curr.totalBonuses, 0);
  const totalPenaltyAll = reportData.reduce((acc, curr) => acc + curr.totalDeductions, 0);
  const totalPayrollCost = reportData.reduce((acc, curr) => acc + curr.finalSalary, 0);
  const totalLateMinutesAll = reportData.reduce((acc, curr) => acc + curr.totalLateMinutes, 0);
  const totalLateCountAll = reportData.reduce((acc, curr) => acc + curr.lateCount, 0);

  // Memos for viewing specific employee history details in modal
  const modalEmpAttendance = useMemo(() => {
    if (!viewingHistoryEmployee) return [];
    return attendance.filter(
      log => log.employeeId === viewingHistoryEmployee.id && getMonthYearString(log.date) === historySelectedMonth
    );
  }, [attendance, viewingHistoryEmployee, historySelectedMonth]);

  const modalEmpAdjustments = useMemo(() => {
    if (!viewingHistoryEmployee) return [];
    const baseAdjs = adjustments.filter(
      adj => adj.employeeId === viewingHistoryEmployee.id && getMonthYearString(adj.date) === historySelectedMonth
    );
    const autoBonus = getAutoBonusForEmployee(viewingHistoryEmployee, historySelectedMonth, attendance, dismissedAutoBonuses);
    if (autoBonus && !baseAdjs.some(adj => adj.id === autoBonus.id)) {
      return [...baseAdjs, autoBonus];
    }
    return baseAdjs;
  }, [adjustments, viewingHistoryEmployee, historySelectedMonth, attendance, dismissedAutoBonuses]);

  const modalStats = useMemo(() => {
    if (!viewingHistoryEmployee) return { baseEarned: 0, totalHours: 0, totalBonuses: 0, totalDeductions: 0, finalSalary: 0, hasAttendanceBonus: false, attendanceBonusAmount: 0, regularHoursTotal: 0, overtimeHoursTotal: 0, regularSalaryTotal: 0, overtimeSalaryTotal: 0, workingDaysCount: 0, totalLateMinutes: 0, totalLatePenalties: 0, lateCount: 0 };
    
    let totalHours = 0;
    let baseEarned = 0;
    let regularHoursTotal = 0;
    let overtimeHoursTotal = 0;
    let regularSalaryTotal = 0;
    let overtimeSalaryTotal = 0;
    let totalLateMinutes = 0;
    let totalLatePenalties = 0;
    let lateCount = 0;

    modalEmpAttendance.forEach(log => {
      const details = getDailyAttendanceDetails(log, viewingHistoryEmployee, shiftPolicy);
      totalHours += details.totalHours;
      baseEarned += details.totalSalary;
      regularHoursTotal += details.regularHours;
      overtimeHoursTotal += details.overtimeHours;
      regularSalaryTotal += details.regularSalary;
      overtimeSalaryTotal += details.overtimeSalary;

      if (details.lateMinutes > 0) {
        totalLateMinutes += details.lateMinutes;
      }
      if (details.latePenalty > 0) {
        totalLatePenalties += details.latePenalty;
        lateCount += 1;
      }
    });

    const totalBonuses = modalEmpAdjustments
      .filter(adj => adj.type === 'bonus')
      .reduce((acc, curr) => acc + curr.amount, 0);

    const workingDaysCount = modalEmpAttendance.filter(log => log.status !== 'absent').length;

    const explicitPenalties = modalEmpAdjustments
      .filter(adj => adj.type === 'penalty' && !adj.id.startsWith('adj-late-'))
      .reduce((acc, curr) => acc + curr.amount, 0);

    const recordedLatePenalties = modalEmpAdjustments
      .filter(adj => adj.type === 'penalty' && adj.id.startsWith('adj-late-'))
      .reduce((acc, curr) => acc + curr.amount, 0);

    const isPenaltyApplicable = isLatePenaltyApplicable(historySelectedMonth, viewingHistoryEmployee.id, lateSettings);
    const rawLatePenalties = Math.max(recordedLatePenalties, totalLatePenalties);
    const effectiveLatePenalties = isPenaltyApplicable ? rawLatePenalties : 0;
    const totalDeductions = explicitPenalties + effectiveLatePenalties;

    const finalSalary = Math.max(0, baseEarned + totalBonuses - totalDeductions);

    const autoBonus = modalEmpAdjustments.find(adj => adj.id === `adj-auto-bonus-${viewingHistoryEmployee.id}-${historySelectedMonth}`);

    return { 
      baseEarned, 
      totalHours, 
      totalBonuses, 
      totalDeductions, 
      finalSalary,
      hasAttendanceBonus: !!autoBonus,
      attendanceBonusAmount: autoBonus ? autoBonus.amount : 0,
      regularHoursTotal,
      overtimeHoursTotal,
      regularSalaryTotal,
      overtimeSalaryTotal,
      workingDaysCount,
      totalLateMinutes,
      totalLatePenalties: effectiveLatePenalties,
      rawLatePenalties,
      isPenaltyApplicable,
      lateCount
    };
  }, [viewingHistoryEmployee, modalEmpAttendance, modalEmpAdjustments, historySelectedMonth, shiftPolicy, lateSettings]);

  // Exporters
  const downloadTextFile = (filename: string, text: string) => {
    const element = document.createElement('a');
    const file = new Blob([text], {type: 'text/plain;charset=utf-8'});
    element.href = URL.createObjectURL(file);
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleExportAll = () => {
    let content = `========================================================\n`;
    content += `BÁO CÁO TỔNG HỢP LƯƠNG & CHẤM CÔNG - THÁNG ${selectedMonth}\n`;
    content += `Thời gian xuất: ${new Date().toLocaleString('vi-VN')}\n`;
    content += `Hệ thống: Tĩnh Lặng Ambient Space Management\n`;
    content += `========================================================\n\n`;

    content += `TỔNG QUAN DOANH NGHIỆP:\n`;
    content += `- Tổng số nhân sự hiển thị: ${reportData.length} người\n`;
    content += `- Tổng số giờ làm việc: ${totalHoursAll} giờ\n`;
    content += `- Tổng thời gian đi trễ: ${formatLateMinutes(totalLateMinutesAll)} (${totalLateCountAll} lượt trễ)\n`;
    content += `- Tổng các khoản thưởng thêm: ${formatVND(totalBonusAll)}\n`;
    content += `- Tổng các khoản phạt/khấu trừ: ${formatVND(totalPenaltyAll)}\n`;
    content += `- TỔNG QUỸ LƯƠNG PHẢI CHI TRẢ: ${formatVND(totalPayrollCost)}\n\n`;

    content += `BẢNG LƯƠNG CHI TIẾT TỪNG NHÂN VIÊN:\n`;
    content += `----------------------------------------------------------------------------------------------------------------------\n`;
    content += `STT | Mã NV | Họ và Tên | Vai Trò | Tổng Giờ | Đi Trễ | Lương Cơ Bản | Thưởng Thêm | Khấu Trừ | Thực Nhận\n`;
    content += `----------------------------------------------------------------------------------------------------------------------\n`;
    
    reportData.forEach((row, idx) => {
      content += `${(idx + 1).toString().padEnd(3)} | ${row.employee.id.padEnd(5)} | ${row.employee.name.padEnd(16)} | ${row.employee.role.padEnd(14)} | ${row.totalHours.toString().padStart(4)}h | ${formatLateMinutes(row.totalLateMinutes).padStart(8)} | ${formatVND(row.baseEarned).padStart(12)} | ${formatVND(row.totalBonuses).padStart(11)} | ${formatVND(row.totalDeductions).padStart(9)} | ${formatVND(row.finalSalary).padStart(12)}\n`;
    });

    content += `\n----------------------------------------------------------------------------------------------------------------------\n`;
    content += `Người lập bảng                                              Giám đốc phê duyệt\n\n\n\n`;
    content += `(Bộ phận Kế toán)                                           (Ký & ghi rõ họ tên)`;

    downloadTextFile(`Bao-Cao-Luong-Tong-Hop-${selectedMonth}.txt`, content);
    addLog('Xuất báo cáo', `Xuất file lương tổng hợp tháng ${selectedMonth}`);
  };

  const handleExportSingle = (empReport: typeof reportData[0]) => {
    const emp = empReport.employee;
    let content = `========================================================\n`;
    content += `PHIẾU CHI LƯƠNG NHÂN VIÊN - THÁNG ${selectedMonth}\n`;
    content += `Tên nhân viên: ${emp.name}\n`;
    content += `Mã nhân viên: ${emp.id}\n`;
    content += `Chức vụ: ${emp.role}\n`;
    content += `Đơn giá lương giờ: ${formatVND(emp.hourlyRate)}\n`;
    content += `Thời gian lập phiếu: ${new Date().toLocaleString('vi-VN')}\n`;
    content += `========================================================\n\n`;

    content += `CHI TIẾT THU NHẬP THÁNG:\n`;
    content += `- Tổng giờ công thực tế: ${empReport.totalHours} giờ\n`;
    content += `- Tổng thời gian đi trễ: ${formatLateMinutes(empReport.totalLateMinutes)} (${empReport.lateCount} lượt trễ)\n`;
    content += `- Thành tiền lương căn bản (áp hệ số): ${formatVND(empReport.baseEarned)}\n`;
    content += `- Thưởng thêm (hiệu suất/OT): +${formatVND(empReport.totalBonuses)}\n`;
    if (empReport.totalLatePenalties > 0) {
      content += `- Khấu trừ phạt đi trễ: -${formatVND(empReport.totalLatePenalties)}\n`;
    }
    const otherPenalties = Math.max(0, empReport.totalDeductions - empReport.totalLatePenalties);
    if (otherPenalties > 0) {
      content += `- Các khoản phạt/khấu trừ khác: -${formatVND(otherPenalties)}\n`;
    }
    content += `- TỔNG CỘNG KHẤU TRỪ: -${formatVND(empReport.totalDeductions)}\n`;
    content += `--------------------------------------------------------\n`;
    content += `=> SỐ TIỀN THỰC LĨNH CUỐI THÁNG: ${formatVND(empReport.finalSalary)}\n\n`;

    content += `LỊCH SỬ CHẤM CÔNG CHI TIẾT TRONG THÁNG:\n`;
    content += `--------------------------------------------------------\n`;
    if (empReport.attendance.length === 0) {
      content += `(Không có dữ liệu chấm công cho nhân viên này trong tháng)\n`;
    } else {
      empReport.attendance.sort((a,b)=>a.date.localeCompare(b.date)).forEach(log => {
        const statusMap = { present: 'Đủ công', late: 'Trễ giờ', absent: 'Vắng mặt' };
        content += `- Ngày ${log.date}: ${log.hoursWorked} giờ [${statusMap[log.status]} - Hệ số: ${log.rateMultiplier}x] ${log.notes ? `(${log.notes})` : ''}\n`;
      });
    }

    content += `\nLỊCH SỬ THƯỞNG PHẠT PHÁT SINH:\n`;
    content += `--------------------------------------------------------\n`;
    if (empReport.adjustments.length === 0) {
      content += `(Không có điều chỉnh thưởng phạt phát sinh ngoài lương)\n`;
    } else {
      empReport.adjustments.sort((a,b)=>a.date.localeCompare(b.date)).forEach(adj => {
        const typeLabel = adj.type === 'bonus' ? 'THƯỞNG' : 'PHẠT';
        content += `- Ngày ${adj.date}: ${typeLabel} ${formatVND(adj.amount)} | Lý do: ${adj.reason}\n`;
      });
    }

    content += `\n========================================================\n`;
    content += `Nhân viên nhận lương                                     Thủ quỹ thanh toán\n\n\n\n`;
    content += `(Ký và ghi rõ họ tên)                                    (Ký và ghi rõ họ tên)`;

    downloadTextFile(`Phieu-Luong-${emp.name.replace(/\s+/g, '-')}-${selectedMonth}.txt`, content);
    addLog('Xuất phiếu lương', `Xuất phiếu lương cá nhân cho ${emp.name}`);
  };

  // IF NOT LOGGED IN: Render Ambient login page
  if (!session) {
    return (
      <div className="max-w-md mx-auto p-8 rounded-2xl bg-white border border-[#e4e4db] shadow-xs flex flex-col items-center">
        <div className="w-12 h-12 rounded-xl bg-[#fbfbfa] border border-[#e4e4db] flex items-center justify-center text-amber-600 mb-4 animate-pulse">
          <Key className="w-5 h-5" />
        </div>
        <h2 className="text-lg font-bold text-[#1c1c1a] tracking-tight">Hệ Thống Phân Quyền</h2>
        <p className="text-xs text-[#8c8c80] font-mono mt-1 mb-6 text-center">Vui lòng lựa chọn tư cách truy cập không gian lương</p>

        {/* Auth Mode Tabs */}
        <div className="flex bg-[#f2f2ee] p-1 rounded-xl border border-[#e4e4db] w-full mb-6">
          <button
            type="button"
            onClick={() => { setLoginRole('admin'); setLoginError(''); }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              loginRole === 'admin' ? 'bg-[#1c1c1a] text-white shadow-xs' : 'text-[#5c5c54] hover:bg-[#e4e4db]'
            }`}
          >
            Quản trị viên (Admin)
          </button>
          <button
            type="button"
            onClick={() => { setLoginRole('employee'); setLoginError(''); }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              loginRole === 'employee' ? 'bg-[#1c1c1a] text-white shadow-xs' : 'text-[#5c5c54] hover:bg-[#e4e4db]'
            }`}
          >
            Nhân viên (Employee)
          </button>
        </div>

        {/* Dynamic Auth Forms */}
        <form onSubmit={handleLogin} className="w-full space-y-4">
          {loginRole === 'admin' ? (
            <>
              <div>
                <label className="block text-xs font-medium text-[#5c5c54] mb-1">Tên đăng nhập admin</label>
                <input
                  type="text"
                  placeholder="Nhập tên đăng nhập..."
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-transparent border border-[#c8c8c0] rounded-xl px-3 py-2 text-sm text-[#1c1c1a] focus:outline-none focus:border-[#1c1c1a]"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#5c5c54] mb-1">Mật khẩu bảo mật</label>
                <input
                  type="password"
                  placeholder="Nhập mật khẩu..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-transparent border border-[#c8c8c0] rounded-xl px-3 py-2 text-sm text-[#1c1c1a] focus:outline-none focus:border-[#1c1c1a]"
                  required
                />
              </div>

            </>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#5c5c54] mb-1.5">Lựa chọn họ và tên của bạn</label>
                <select
                  value={selectedEmployeeLogin}
                  onChange={(e) => {
                    setSelectedEmployeeLogin(e.target.value);
                    setPassword('');
                  }}
                  className="w-full bg-white border border-[#c8c8c0] rounded-xl px-3 py-2 text-sm text-[#1c1c1a] focus:outline-none"
                  required
                >
                  <option value="">-- Chọn tên từ danh sách --</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name} ({emp.id})</option>
                  ))}
                </select>
              </div>

              {selectedEmployeeLogin && (
                <div>
                  <label className="block text-xs font-medium text-[#5c5c54] mb-1.5">Nhập mật khẩu để đăng nhập *</label>
                  <input
                    type="password"
                    placeholder="Nhập mật khẩu..."
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-transparent border border-[#c8c8c0] rounded-xl px-3 py-2 text-sm text-[#1c1c1a] focus:outline-none focus:border-[#1c1c1a]"
                    required
                  />
                </div>
              )}
            </div>
          )}

          {loginError && (
            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 p-2.5 rounded-lg text-center font-medium">
              {loginError}
            </p>
          )}

          <button
            type="submit"
            className="w-full bg-[#1c1c1a] hover:bg-[#2c2c28] text-white text-xs font-semibold py-2.5 rounded-xl transition-all shadow-xs cursor-pointer"
          >
            Đăng Nhập Không Gian Lương
          </button>
        </form>
      </div>
    );
  }

  // RENDER FOR LOGGED-IN EMPLOYEE (Self-service Paystub and history view)
  if (session.role === 'employee') {
    const empId = session.employeeId!;
    const currentEmployee = employees.find(e => e.id === empId);

    if (isEditingSelf) {
      return (
        <div className="space-y-6">
          {/* Header with back button */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-[#f2f2ee] pb-4 gap-4">
            <div>
              <span className="text-[10px] uppercase font-mono tracking-widest text-[#8c8c80] font-semibold">Cổng thông tin nhân viên</span>
              <h2 className="text-xl font-bold text-[#1c1c1a] tracking-tight">Thay Đổi Thông Tin Cá Nhân</h2>
              <p className="text-xs text-[#8c8c80] font-mono mt-0.5">Cập nhật tên hiển thị và mật khẩu của bạn</p>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={() => setIsEditingSelf(false)}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#fbfbfa] hover:bg-[#f2f2ee] border border-[#e4e4db] text-[#1c1c1a] text-xs font-semibold rounded-xl transition-all cursor-pointer"
              >
                <Home className="w-3.5 h-3.5" />
                <span>Trở về cổng thông tin</span>
              </button>
              
              <button
                onClick={handleLogout}
                className="flex items-center space-x-1 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold rounded-xl transition-all cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Đăng xuất</span>
              </button>
            </div>
          </div>

          {/* Info Update Form */}
          <div className="max-w-md mx-auto p-6 bg-white border border-[#e4e4db] rounded-2xl shadow-xs space-y-5">
            <div className="flex items-center space-x-3 pb-3 border-b border-[#f2f2ee]">
              <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-mono text-[#8c8c80]">Mã nhân viên: {empId}</p>
                <p className="text-sm font-semibold text-[#1c1c1a]">Chức vụ: {currentEmployee?.role}</p>
              </div>
            </div>

            <form onSubmit={handleSaveSelfInfo} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#5c5c54] mb-1.5">Tên hiển thị của bạn *</label>
                <input
                  type="text"
                  value={selfName}
                  onChange={(e) => setSelfName(e.target.value)}
                  className="w-full bg-white border border-[#c8c8c0] rounded-xl px-3 py-2 text-sm text-[#1c1c1a] focus:outline-none focus:border-[#1c1c1a]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#5c5c54] mb-1.5">Mật khẩu mới *</label>
                <input
                  type="text"
                  value={selfPassword}
                  onChange={(e) => setSelfPassword(e.target.value)}
                  className="w-full bg-white border border-[#c8c8c0] rounded-xl px-3 py-2 text-sm text-[#1c1c1a] focus:outline-none focus:border-[#1c1c1a]"
                  required
                />
              </div>

              <div className="flex space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditingSelf(false)}
                  className="flex-1 border border-[#e4e4db] hover:bg-[#f2f2ee] text-[#1c1c1a] font-semibold text-xs py-2.5 rounded-xl transition-all cursor-pointer text-center"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-[#1c1c1a] hover:bg-[#2c2c28] text-white font-semibold text-xs py-2.5 rounded-xl transition-all shadow-xs cursor-pointer"
                >
                  Lưu Thay Đổi
                </button>
              </div>
            </form>
          </div>

          {/* Alert Modal */}
          {alertModal.isOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
              <div className="bg-white border border-[#e4e4db] rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4 animate-in fade-in duration-200">
                <div className="flex items-center justify-between pb-2 border-b border-[#f2f2ee]">
                  <h3 className="text-sm font-bold text-[#1c1c1a]">{alertModal.title}</h3>
                </div>
                <p className="text-sm text-[#5c5c54] whitespace-pre-line leading-relaxed">{alertModal.message}</p>
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
                    className="bg-[#1c1c1a] hover:bg-black text-white px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
                  >
                    Đóng
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Confirm Modal */}
          {confirmModal.isOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
              <div className="bg-white border border-[#e4e4db] rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4 animate-in fade-in duration-200">
                <div className="flex items-center justify-between pb-2 border-b border-[#f2f2ee]">
                  <h3 className="text-sm font-bold text-[#1c1c1a]">{confirmModal.title}</h3>
                </div>
                <p className="text-sm text-[#5c5c54] whitespace-pre-line leading-relaxed">{confirmModal.message}</p>
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                    className="bg-white hover:bg-gray-50 border border-[#c8c8c0] text-[#1c1c1a] px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmModal(prev => ({ ...prev, isOpen: false }));
                      confirmModal.onConfirm();
                    }}
                    className="bg-[#1c1c1a] hover:bg-black text-white px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
                  >
                    Xác nhận
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      );
    }

    // Filter personal report details for current month
    const personalAttendance = attendance.filter(
      log => log.employeeId === empId && getMonthYearString(log.date) === selectedMonth
    );

    let baseEarned = 0;
    let totalHours = 0;
    let regularHoursTotal = 0;
    let overtimeHoursTotal = 0;
    let regularSalaryTotal = 0;
    let overtimeSalaryTotal = 0;
    let totalLateMinutes = 0;
    let totalLatePenalties = 0;
    let lateCount = 0;

    personalAttendance.forEach(log => {
      const details = getDailyAttendanceDetails(log, currentEmployee, shiftPolicy);
      totalHours += details.totalHours;
      baseEarned += details.totalSalary;
      regularHoursTotal += details.regularHours;
      overtimeHoursTotal += details.overtimeHours;
      regularSalaryTotal += details.regularSalary;
      overtimeSalaryTotal += details.overtimeSalary;

      if (details.lateMinutes > 0) {
        totalLateMinutes += details.lateMinutes;
      }
      if (details.latePenalty > 0) {
        totalLatePenalties += details.latePenalty;
        lateCount += 1;
      }
    });

    const workingDaysCount = personalAttendance.filter(log => log.status !== 'absent').length;
    const mealAllowance = 0;

    const personalAdjustments = adjustments.filter(
      adj => adj.employeeId === empId && getMonthYearString(adj.date) === selectedMonth
    );

    const autoBonus = currentEmployee ? getAutoBonusForEmployee(currentEmployee, selectedMonth, attendance, dismissedAutoBonuses) : null;
    const personalAdjustmentsWithAuto = [...personalAdjustments];
    if (autoBonus && !personalAdjustments.some(adj => adj.id === autoBonus.id)) {
      personalAdjustmentsWithAuto.push(autoBonus);
    }

    const totalBonuses = personalAdjustmentsWithAuto
      .filter(adj => adj.type === 'bonus')
      .reduce((acc, curr) => acc + curr.amount, 0);

    const explicitPenalties = personalAdjustmentsWithAuto
      .filter(adj => adj.type === 'penalty' && !adj.id.startsWith('adj-late-'))
      .reduce((acc, curr) => acc + curr.amount, 0);

    const recordedLatePenalties = personalAdjustmentsWithAuto
      .filter(adj => adj.type === 'penalty' && adj.id.startsWith('adj-late-'))
      .reduce((acc, curr) => acc + curr.amount, 0);

    const isPenaltyOn = currentEmployee ? isLatePenaltyApplicable(selectedMonth, currentEmployee.id, lateSettings) : true;
    const rawLatePenalties = Math.max(recordedLatePenalties, totalLatePenalties);
    const effectiveLatePenalties = isPenaltyOn ? rawLatePenalties : 0;
    const insuranceDeduction = 0;
    const totalDeductions = explicitPenalties + effectiveLatePenalties;

    const finalSalary = Math.max(0, baseEarned + totalBonuses - totalDeductions);

    // Mock structured report object for single exporter reuse
    const singleReportInstance = {
      employee: currentEmployee || { id: empId, name: 'Nhân viên', role: 'N/A', hourlyRate: 0, createdAt: '' },
      attendance: personalAttendance,
      adjustments: personalAdjustmentsWithAuto,
      totalHours,
      workingDaysCount,
      baseEarned,
      mealAllowance,
      totalBonuses,
      insuranceDeduction,
      totalPenalties: totalDeductions,
      totalDeductions,
      finalSalary,
      totalLateMinutes,
      totalLatePenalties: effectiveLatePenalties,
      rawLatePenalties,
      isPenaltyApplicable: isPenaltyOn,
      lateCount
    };

    return (
      <div className="space-y-6">
        {/* Header with quick details and logout */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between border-b border-[#f2f2ee] dark:border-[#2c2c28] pb-4 gap-4">
          <div>
            <span className="text-[10px] uppercase font-mono tracking-widest text-[#8c8c80] dark:text-[#acaca0] font-semibold">Cổng thông tin nhân viên</span>
            <h2 
              onClick={() => {
                if (currentEmployee) {
                  setSelfName(currentEmployee.name);
                  setSelfPassword(currentEmployee.password || '123');
                  setIsEditingSelf(true);
                }
              }}
              className="text-xl font-bold text-[#1c1c1a] dark:text-white tracking-tight hover:text-[#5c5c54] dark:hover:text-[#acaca0] transition-colors cursor-pointer flex items-center gap-1.5"
              title="Nhấp để thay đổi thông tin nhân viên"
            >
              {currentEmployee?.name || 'Nhân Viên'}
              <Edit2 className="w-3.5 h-3.5 text-[#acaca0]" />
            </h2>
            <p className="text-xs text-[#8c8c80] dark:text-[#acaca0] font-mono mt-0.5">{currentEmployee?.role}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* View badge - Chấm công nhanh is hidden for logged-in employee */}
            <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] shadow-xs">
              <CircleDollarSign className="w-3.5 h-3.5" />
              <span>Phiếu lương & Lịch sử cá nhân</span>
            </div>

            {/* Separator line */}
            <span className="text-gray-300 dark:text-[#2c2c28] hidden sm:inline">|</span>

            {/* Badge Mã Nhân Viên */}
            <div 
              onClick={() => {
                if (currentEmployee) {
                  setSelfName(currentEmployee.name);
                  setSelfPassword(currentEmployee.password || '123');
                  setIsEditingSelf(true);
                }
              }}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#fbfbfa] dark:bg-[#1c1c1a] hover:bg-[#f2f2ee] dark:hover:bg-[#2c2c28] border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl text-xs transition-all cursor-pointer"
              title="Nhấp để thay đổi thông tin nhân viên"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-mono text-[#5c5c54] dark:text-[#acaca0]">Mã: {empId}</span>
            </div>
            
            <button
              onClick={handleLogout}
              className="flex items-center space-x-1 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold rounded-xl transition-all cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Đăng xuất</span>
            </button>
          </div>
        </div>

        <div className="space-y-6">
          {/* Option Bar: Select month & export */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-[#fbfbfa] dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl">
            <div className="flex items-center space-x-3">
              <label htmlFor="personal-month" className="text-xs font-semibold font-mono text-[#5c5c54] dark:text-[#acaca0] uppercase">Tra cứu tháng:</label>
              <input
                id="personal-month"
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-white dark:bg-[#1c1c1a] border border-[#c8c8c0] dark:border-[#2c2c28] px-3 py-1.5 rounded-lg text-sm text-[#1c1c1a] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#1c1c1a] dark:focus:ring-white"
              />
              <span className="text-[11px] font-mono text-[#8c8c80] hidden sm:inline">(Mặc định: Tháng hiện tại)</span>
            </div>

            <button
              onClick={() => handleExportSingle(singleReportInstance)}
              className="flex items-center space-x-2 bg-[#1c1c1a] hover:bg-[#2c2c28] text-white dark:bg-white dark:text-[#1c1c1a] dark:hover:bg-gray-100 font-semibold text-xs px-4 py-2.5 rounded-xl transition-all shadow-xs cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Tải Phiếu Lương Chi Tiết (TXT)</span>
            </button>
          </div>

            {/* Grid Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="p-4 bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl flex items-center justify-between shadow-xs">
                <div>
                  <p className="text-[10px] font-mono font-medium text-[#8c8c80] uppercase">Thực lĩnh cuối tháng</p>
                  <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400 font-mono mt-1">{formatVND(finalSalary)}</p>
                </div>
                <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 rounded-lg">
                  <CircleDollarSign className="w-5 h-5" />
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl flex items-center justify-between shadow-xs">
                <div>
                  <p className="text-[10px] font-mono font-medium text-[#8c8c80] uppercase">Tổng giờ đã làm</p>
                  <p className="text-lg font-bold text-[#1c1c1a] dark:text-white font-mono mt-1">{totalHours} giờ</p>
                </div>
                <div className="p-2.5 bg-[#fbfbfa] dark:bg-[#121211] text-[#5c5c54] dark:text-[#acaca0] rounded-lg">
                  <Calendar className="w-5 h-5" />
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl flex items-center justify-between shadow-xs">
                <div>
                  <p className="text-[10px] font-mono font-medium text-[#8c8c80] uppercase">Thời gian đi trễ</p>
                  <p className="text-lg font-bold text-amber-700 dark:text-amber-400 font-mono mt-1">{formatLateMinutes(totalLateMinutes)}</p>
                  <p className="text-[10px] text-[#8c8c80] font-mono mt-0.5">{lateCount} lần đi trễ</p>
                </div>
                <div className="p-2.5 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 rounded-lg">
                  <ClockIcon className="w-5 h-5" />
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl flex items-center justify-between shadow-xs">
                <div>
                  <p className="text-[10px] font-mono font-medium text-[#8c8c80] uppercase">Tổng các khoản Thưởng</p>
                  <p className="text-lg font-bold text-blue-700 dark:text-blue-400 font-mono mt-1">+{formatVND(totalBonuses)}</p>
                </div>
                <div className="p-2.5 bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 rounded-lg">
                  <TrendingUp className="w-5 h-5" />
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl flex items-center justify-between shadow-xs">
                <div>
                  <p className="text-[10px] font-mono font-medium text-[#8c8c80] uppercase">Các khoản khấu trừ</p>
                  <p className="text-lg font-bold text-amber-700 dark:text-amber-400 font-mono mt-1">-{formatVND(totalDeductions)}</p>
                  {effectiveLatePenalties > 0 && (
                    <p className="text-[10px] text-rose-600 font-mono mt-0.5">Trừ trễ: -{formatCompactVND(effectiveLatePenalties)}</p>
                  )}
                </div>
                <div className="p-2.5 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 rounded-lg">
                  <AlertTriangle className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* Attendance Bonus Status Banner */}
            {(() => {
              const daysInMonth = getDaysInMonth(selectedMonth);
              const reqDays = daysInMonth === 30 ? 28 : (daysInMonth === 31 ? 29 : daysInMonth - 2);
              const qualifies = workingDaysCount >= reqDays;
              const bonusAmount = currentEmployee ? 2 * getEmployeeShiftDuration(currentEmployee) * currentEmployee.hourlyRate : 0;

              return (
                <div className={`p-4 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs font-medium ${
                  qualifies 
                    ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/30 text-emerald-800 dark:text-emerald-400' 
                    : 'bg-[#fbfbfa] dark:bg-[#121211] border-[#e4e4db] dark:border-[#2c2c28] text-[#5c5c54] dark:text-[#acaca0]'
                }`}>
                  <div className="flex items-center space-x-2.5">
                    <Crown className={`w-4 h-4 shrink-0 ${qualifies ? 'text-amber-500 fill-amber-400' : 'text-gray-400 dark:text-gray-500'}`} />
                    <span>
                      Chuyên cần tháng {selectedMonth}: <strong className="font-mono">{workingDaysCount}/{daysInMonth}</strong> ngày công (Yêu cầu &ge; {reqDays} ngày để nhận thưởng 2 ngày công).
                    </span>
                  </div>
                  <div>
                    {qualifies ? (
                      <span className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase">
                        Đạt thưởng: +{formatVND(bonusAmount)}
                      </span>
                    ) : (
                      <span className="bg-gray-100 dark:bg-[#1c1c1a] text-gray-600 dark:text-gray-400 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase">
                        Còn thiếu {reqDays - workingDaysCount} ngày công
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}

        {/* Detailed Breakdown Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Detailed Attendance history table */}
          <div className="lg:col-span-12 flex flex-col space-y-3">
            <h3 className="text-xs font-semibold font-mono text-[#8c8c80] uppercase tracking-wider">Chi tiết chấm công tháng {selectedMonth}</h3>
            <div className="border border-[#e4e4db] rounded-xl overflow-hidden bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-[#1c1c1a]">
                  <thead className="text-[11px] font-mono text-[#5c5c54] bg-[#fbfbfa] uppercase border-b border-[#e4e4db]">
                    <tr>
                      <th className="px-4 py-3">Ngày</th>
                      <th className="px-4 py-3">Tổng giờ</th>
                      <th className="px-4 py-3">Giờ trong ca</th>
                      <th className="px-4 py-3">Giờ tăng ca</th>
                      <th className="px-4 py-3">Khoảng giờ (Vào - Ra)</th>
                      <th className="px-4 py-3">Hệ số</th>
                      <th className="px-4 py-3">Khen thưởng</th>
                      <th className="px-4 py-3">Khấu trừ</th>
                      <th className="px-4 py-3">Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f2f2ee]">
                    {personalAttendance.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-[#8c8c80] font-medium">
                          Không có lịch sử chấm công nào được lưu trữ cho tháng {selectedMonth}
                        </td>
                      </tr>
                    ) : (
                      personalAttendance.sort((a,b)=>a.date.localeCompare(b.date)).map((log) => {
                        const dailyBonuses = personalAdjustments.filter(adj => adj.date === log.date && adj.type === 'bonus');
                        const dailyPenalties = personalAdjustments.filter(adj => adj.date === log.date && adj.type === 'penalty');
                        const details = getDailyAttendanceDetails(log, currentEmployee);

                        return (
                          <tr key={log.id} className="hover:bg-[#fbfbfa] transition-colors">
                            <td className="px-4 py-3 font-mono font-medium text-xs whitespace-nowrap">{log.date}</td>
                            <td className="px-4 py-3 font-mono text-xs font-semibold whitespace-nowrap">{log.hoursWorked} giờ</td>
                            <td className="px-4 py-3 font-mono text-xs text-[#5c5c54] whitespace-nowrap">
                              {details.regularHours} giờ
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-amber-600 whitespace-nowrap">
                              {details.overtimeHours} giờ
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-[#5c5c54] whitespace-nowrap">
                              {log.inTime || log.outTime ? (
                                <span className="bg-[#f2f2ee] px-2 py-1 rounded text-[#1c1c1a] font-medium">
                                  {log.inTime || '—'} → {log.outTime || '—'}
                                </span>
                              ) : '—'}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className={`inline-block text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                                log.rateMultiplier === 1.5 ? 'bg-blue-50 text-blue-700' : (log.rateMultiplier === 0.5 ? 'bg-amber-50 text-amber-700' : 'bg-[#fbfbfa] text-[#5c5c54]')
                              }`}>
                                {log.rateMultiplier}x
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-blue-600 font-mono font-semibold whitespace-nowrap">
                              {dailyBonuses.length > 0 ? (
                                <div className="space-y-0.5">
                                  {dailyBonuses.map(b => (
                                    <div key={b.id} title={b.reason}>
                                      +{formatVND(b.amount)} <span className="text-[10px] text-gray-400 font-sans">({b.reason})</span>
                                    </div>
                                  ))}
                                </div>
                              ) : '—'}
                            </td>
                            <td className="px-4 py-3 text-xs text-amber-600 font-mono font-semibold whitespace-nowrap">
                              {(() => {
                                const hasLateAdj = dailyPenalties.some(p => p.id.startsWith('adj-late-'));
                                const showUnrecordedLate = details.latePenalty > 0 && !hasLateAdj;
                                if (dailyPenalties.length === 0 && !showUnrecordedLate) return '—';
                                return (
                                  <div className="space-y-0.5">
                                    {dailyPenalties.map(p => (
                                      <div key={p.id} title={p.reason}>
                                        -{formatVND(p.amount)} <span className="text-[10px] text-gray-400 font-sans">({p.reason})</span>
                                      </div>
                                    ))}
                                    {showUnrecordedLate && (
                                      <div title={`Đi trễ ${details.lateMinutes} phút`}>
                                        -{formatVND(details.latePenalty)} <span className="text-[10px] text-rose-500 font-sans font-medium">(Trừ trễ {details.lateMinutes}p)</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="px-4 py-3 text-xs text-[#5c5c54] font-medium max-w-[200px] truncate" title={log.notes}>
                              {log.notes || '—'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Adjustments (Bonus/Penalty) Details */}
          <div className="lg:col-span-12 flex flex-col space-y-3">
            <h3 className="text-xs font-semibold font-mono text-[#8c8c80] uppercase tracking-wider">Danh sách thưởng phạt bổ sung tháng {selectedMonth}</h3>
            <div className="p-5 border border-[#e4e4db] rounded-xl bg-white space-y-4">

              {personalAdjustmentsWithAuto.length === 0 ? (
                <p className="text-xs text-[#8c8c80] text-center py-4 font-medium">Không phát sinh khoản thưởng phạt bổ sung khác trong tháng.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {personalAdjustmentsWithAuto.map((adj) => (
                    <div key={adj.id} className="p-3 bg-[#fbfbfa] border border-[#e4e4db] rounded-xl flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-[#1c1c1a]">{adj.reason}</p>
                        <p className="text-[10px] text-[#8c8c80] font-mono mt-0.5">{adj.date}</p>
                      </div>
                      <span className={`text-xs font-bold ${adj.type === 'bonus' ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {adj.type === 'bonus' ? '+' : '-'}{formatVND(adj.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        </div>

        {/* Alert Modal */}
          {alertModal.isOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
              <div className="bg-white border border-[#e4e4db] rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4 animate-in fade-in duration-200">
                <div className="flex items-center justify-between pb-2 border-b border-[#f2f2ee]">
                  <h3 className="text-sm font-bold text-[#1c1c1a]">{alertModal.title}</h3>
                </div>
                <p className="text-sm text-[#5c5c54] whitespace-pre-line leading-relaxed">{alertModal.message}</p>
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
                    className="bg-[#1c1c1a] hover:bg-black text-white px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
                  >
                    Đóng
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Confirm Modal */}
          {confirmModal.isOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
              <div className="bg-white border border-[#e4e4db] rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4 animate-in fade-in duration-200">
                <div className="flex items-center justify-between pb-2 border-b border-[#f2f2ee]">
                  <h3 className="text-sm font-bold text-[#1c1c1a]">{confirmModal.title}</h3>
                </div>
                <p className="text-sm text-[#5c5c54] whitespace-pre-line leading-relaxed">{confirmModal.message}</p>
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                    className="bg-white hover:bg-gray-50 border border-[#c8c8c0] text-[#1c1c1a] px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmModal(prev => ({ ...prev, isOpen: false }));
                      confirmModal.onConfirm();
                    }}
                    className="bg-[#1c1c1a] hover:bg-black text-white px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
                  >
                    Xác nhận
                  </button>
                </div>
              </div>
            </div>
          )}

      </div>
    );
  }

  // RENDER FOR LOGGED-IN ADMIN (Full suite)
  return (
    <div className="space-y-6">
      
      {session?.role === 'manager' && (
        <div className="p-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-medium flex items-center gap-2">
          <ShieldAlert className="w-4.5 h-4.5 shrink-0 text-amber-600" />
          <span>
            <strong>Chế độ Quản lý (Chỉ Xem):</strong> Bạn đang truy cập hệ thống với tư cách Quản lý. Mọi quyền thêm, sửa, xóa dữ liệu đã bị vô hiệu hóa.
          </span>
        </div>
      )}

      {/* Header controls & Quick overview */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-[#f2f2ee] pb-4 gap-4">
        <div>
          <span className="text-[10px] uppercase font-mono tracking-widest text-[#8c8c80] font-semibold">
            {session?.role === 'manager' ? 'Chế độ quản lý (Chỉ xem)' : 'Chế độ quản trị viên'}
          </span>
          <h2 className="text-xl font-bold text-[#1c1c1a] tracking-tight">Hệ Thống Quản Lý Lương & Chấm Công</h2>
          <p className="text-xs text-[#8c8c80] font-mono mt-0.5">Chấm công hàng loạt • Tính toán chi tiết • Lưu trữ bảo mật</p>
        </div>

        <button
          onClick={handleLogout}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold rounded-xl transition-all cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Đăng xuất</span>
        </button>
      </div>

      {/* Tabs list bar */}
      <div className="flex bg-[#fbfbfa] dark:bg-[#121211] p-1 border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl overflow-x-auto w-full">
        <button
          onClick={() => setActiveTab('reports')}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
            activeTab === 'reports'
              ? 'bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] shadow-xs font-bold'
              : 'text-[#5c5c54] dark:text-[#acaca0] hover:bg-[#f2f2ee] dark:hover:bg-[#2c2c28] hover:text-[#1c1c1a] dark:hover:text-white'
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
          <span>Thống kê & Báo cáo</span>
        </button>
        {session?.role !== 'manager' && (
          <button
            onClick={() => setActiveTab('bulk-attendance')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'bulk-attendance'
                ? 'bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] shadow-xs font-bold'
                : 'text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="font-bold">Nhập Công Hàng Loạt</span>
          </button>
        )}
        {session?.role !== 'manager' && (
          <button
            onClick={() => setActiveTab('daily-attendance')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'daily-attendance'
                ? 'bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] shadow-xs font-bold'
                : 'text-[#5c5c54] dark:text-[#acaca0] hover:bg-[#f2f2ee] dark:hover:bg-[#2c2c28] hover:text-[#1c1c1a] dark:hover:text-white'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Chấm công ngày</span>
          </button>
        )}
        <button
          onClick={() => setActiveTab('adjustments')}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
            activeTab === 'adjustments'
              ? 'bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] shadow-xs font-bold'
              : 'text-[#5c5c54] dark:text-[#acaca0] hover:bg-[#f2f2ee] dark:hover:bg-[#2c2c28] hover:text-[#1c1c1a] dark:hover:text-white'
          }`}
        >
          <Award className="w-3.5 h-3.5" />
          <span>Thưởng & Phạt</span>
        </button>
        <button
          onClick={() => setActiveTab('employees')}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
            activeTab === 'employees'
              ? 'bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] shadow-xs font-bold'
              : 'text-[#5c5c54] dark:text-[#acaca0] hover:bg-[#f2f2ee] dark:hover:bg-[#2c2c28] hover:text-[#1c1c1a] dark:hover:text-white'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Nhân sự ({employees.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('shifts')}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
            activeTab === 'shifts'
              ? 'bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] shadow-xs font-bold'
              : 'text-[#5c5c54] dark:text-[#acaca0] hover:bg-[#f2f2ee] dark:hover:bg-[#2c2c28] hover:text-[#1c1c1a] dark:hover:text-white'
          }`}
        >
          <ClockIcon className="w-3.5 h-3.5" />
          <span>Setup Ca Làm Việc ({shifts.length})</span>
        </button>
        <button
          onClick={() => { playClick(); setActiveTab('late-settings'); }}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
            activeTab === 'late-settings'
              ? 'bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] shadow-xs font-bold'
              : 'text-amber-800 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Setup Khấu Trừ Trễ</span>
        </button>
        <button
          onClick={() => setActiveTab('activities')}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
            activeTab === 'activities'
              ? 'bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] shadow-xs font-bold'
              : 'text-[#5c5c54] dark:text-[#acaca0] hover:bg-[#f2f2ee] dark:hover:bg-[#2c2c28] hover:text-[#1c1c1a] dark:hover:text-white'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>Nhật ký hoạt động</span>
        </button>
        <button
          onClick={() => { playClick(); setActiveTab('analytics'); }}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
            activeTab === 'analytics'
              ? 'bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] shadow-xs font-bold'
              : 'text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20'
          }`}
        >
          <BarChart2 className="w-3.5 h-3.5" />
          <span>Báo Cáo & Phân Tích</span>
        </button>
        <button
          onClick={() => { playClick(); setActiveTab('migration'); }}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
            activeTab === 'migration'
              ? 'bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] shadow-xs font-bold'
              : 'text-indigo-700 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/20'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>Xuất / Nhập Dữ Liệu</span>
        </button>
        {session?.role !== 'manager' && (
          <button
            onClick={() => { playClick(); setActiveTab('settings'); }}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'settings'
                ? 'bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] shadow-xs font-bold'
                : 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>Cài đặt tọa độ</span>
          </button>
        )}
      </div>

      {/* ACTIVE ADMIN TAB VIEWS */}

      {/* 1. REPORTS TAB */}
      {activeTab === 'reports' && (
        <div className="space-y-6">
          {/* Controls Bar */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 p-4 bg-[#fbfbfa] border border-[#e4e4db] rounded-xl">
            
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center space-x-2">
                <label htmlFor="rep-month" className="text-xs font-semibold font-mono text-[#5c5c54] uppercase">Chọn tháng:</label>
                <input
                  id="rep-month"
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="bg-white border border-[#c8c8c0] px-3 py-1.5 rounded-lg text-sm text-[#1c1c1a] focus:outline-none"
                />
              </div>

              {/* Global toggle for late deductions across all employees */}
              <div className="flex items-center space-x-2 bg-white px-3 py-1.5 rounded-lg border border-[#e4e4db]">
                <span className="text-xs font-semibold text-[#5c5c54]">Khấu trừ đi trễ toàn bộ:</span>
                <button
                  type="button"
                  onClick={() => handleToggleGlobalLate(!lateSettings.globalEnabled)}
                  className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                    lateSettings.globalEnabled
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                      : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'
                  }`}
                  title={lateSettings.globalEnabled ? 'Nhấp để TẮT khấu trừ trễ toàn bộ nhân viên' : 'Nhấp để BẬT khấu trừ trễ toàn bộ nhân viên'}
                >
                  {lateSettings.globalEnabled ? (
                    <>
                      <ToggleRight className="w-4 h-4 text-emerald-600" />
                      <span>Đang BẬT</span>
                    </>
                  ) : (
                    <>
                      <ToggleLeft className="w-4 h-4 text-gray-400" />
                      <span>Đang TẮT (Miễn trừ)</span>
                    </>
                  )}
                </button>
              </div>

            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleExportAll}
                className="flex items-center justify-center space-x-2 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs px-4 py-2 rounded-xl transition-all shadow-sm cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Xuất Báo Cáo Tổng Hợp (TXT)</span>
              </button>

              <button
                onClick={handleClearMonthPayroll}
                className="flex items-center justify-center space-x-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-semibold text-xs px-4 py-2 rounded-xl transition-all cursor-pointer"
                title="Xóa toàn bộ dữ liệu chấm công và thưởng phạt của tháng hiện tại"
              >
                <Trash2 className="w-4 h-4" />
                <span>Xóa Bảng Lương Tháng</span>
              </button>
            </div>
          </div>

          {/* Quick search input */}
          <div className="relative">
            <Search className="w-4 h-4 text-[#8c8c80] absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Tìm kiếm nhanh nhân sự theo họ tên hoặc mã nhân viên..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white border border-[#e4e4db] rounded-xl pl-9 pr-4 py-2.5 text-sm text-[#1c1c1a] focus:outline-none"
            />
          </div>

          {/* Top Sum Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="p-4 bg-white border border-[#e4e4db] rounded-xl flex items-center justify-between">
              <div>
                <p className="text-[11px] font-mono font-medium text-[#8c8c80] uppercase">Tổng quỹ lương thực nhận</p>
                <p className="text-lg font-bold text-emerald-700 font-mono mt-1">{formatVND(totalPayrollCost)}</p>
              </div>
              <div className="p-2.5 bg-emerald-50 text-emerald-700 rounded-lg">
                <CircleDollarSign className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 bg-white border border-[#e4e4db] rounded-xl flex items-center justify-between">
              <div>
                <p className="text-[11px] font-mono font-medium text-[#8c8c80] uppercase">Tổng số giờ công</p>
                <p className="text-lg font-bold text-[#1c1c1a] font-mono mt-1">{totalHoursAll} giờ</p>
              </div>
              <div className="p-2.5 bg-[#fbfbfa] text-[#5c5c54] rounded-lg">
                <Calendar className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 bg-white border border-[#e4e4db] rounded-xl flex items-center justify-between">
              <div>
                <p className="text-[11px] font-mono font-medium text-[#8c8c80] uppercase">Tổng thời gian đi trễ</p>
                <p className="text-lg font-bold text-amber-700 font-mono mt-1">{formatLateMinutes(totalLateMinutesAll)}</p>
                <p className="text-[10px] text-[#8c8c80] font-mono mt-0.5">{totalLateCountAll} lượt trễ ca</p>
              </div>
              <div className="p-2.5 bg-amber-50 text-amber-700 rounded-lg">
                <ClockIcon className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 bg-white border border-[#e4e4db] rounded-xl flex items-center justify-between">
              <div>
                <p className="text-[11px] font-mono font-medium text-[#8c8c80] uppercase">Tổng các khoản Thưởng</p>
                <p className="text-lg font-bold text-blue-700 font-mono mt-1">+{formatVND(totalBonusAll)}</p>
              </div>
              <div className="p-2.5 bg-blue-50 text-blue-700 rounded-lg">
                <TrendingUp className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 bg-white border border-[#e4e4db] rounded-xl flex items-center justify-between">
              <div>
                <p className="text-[11px] font-mono font-medium text-[#8c8c80] uppercase">Tổng các khoản Phạt</p>
                <p className="text-lg font-bold text-amber-700 font-mono mt-1">-{formatVND(totalPenaltyAll)}</p>
              </div>
              <div className="p-2.5 bg-amber-50 text-amber-700 rounded-lg">
                <AlertTriangle className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Main Table view */}
          <div className="border border-[#e4e4db] rounded-xl overflow-hidden bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-[#1c1c1a]">
                <thead className="text-[11px] font-mono text-[#5c5c54] bg-[#fbfbfa] uppercase border-b border-[#e4e4db]">
                  <tr>
                    <th scope="col" className="px-4 py-3">Mã NV</th>
                    <th scope="col" className="px-4 py-3">Nhân Viên</th>
                    <th scope="col" className="px-4 py-3 text-center">Tổng giờ</th>
                    <th scope="col" className="px-4 py-3 text-center">Thời gian đi trễ</th>
                    <th scope="col" className="px-4 py-3">Lương cơ bản</th>
                    <th scope="col" className="px-4 py-3">Thưởng thêm</th>
                    <th scope="col" className="px-4 py-3">Khấu trừ (Phạt)</th>
                    <th scope="col" className="px-4 py-3 font-bold text-[#1c1c1a]">Thực Nhận</th>
                    <th scope="col" className="px-4 py-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f2f2ee]">
                  {reportData.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-[#8c8c80] font-medium">
                        Không tìm thấy dữ liệu phù hợp với tìm kiếm hoặc bộ lọc hiện tại.
                      </td>
                    </tr>
                  ) : (
                    reportData.map((row) => (
                      <tr key={row.employee.id} className="hover:bg-[#fbfbfa] transition-colors">
                        <td className="px-4 py-3.5 font-mono text-xs font-semibold text-[#5c5c54]">
                          <div className="flex items-center space-x-1">
                            <span>{row.employee.id}</span>
                            {(() => {
                              const empAttendance = attendance.filter(
                                log => log.employeeId === row.employee.id && getMonthYearString(log.date) === selectedMonth
                              );
                              const workingDaysCount = empAttendance.filter(log => log.status !== 'absent').length;
                              const daysInMonth = getDaysInMonth(selectedMonth);
                              const isCrownEligible = (daysInMonth === 30 && workingDaysCount >= 28) ||
                                                      (daysInMonth === 31 && workingDaysCount >= 29) ||
                                                      (daysInMonth < 30 && workingDaysCount >= daysInMonth - 2);
                              return isCrownEligible ? (
                                <Crown className="w-3.5 h-3.5 text-amber-500 fill-amber-400 inline-block" title={`Xuất sắc chuyên cần: làm ${workingDaysCount}/${daysInMonth} ngày công!`} />
                              ) : null;
                            })()}
                          </div>
                        </td>
                        <td 
                          className="px-4 py-3.5 cursor-pointer group"
                          onClick={() => {
                            setViewingHistoryEmployee(row.employee);
                            setHistorySelectedMonth(selectedMonth);
                          }}
                          title="Bấm để xem lịch sử chấm công chi tiết"
                        >
                          <p className="font-semibold text-sm text-[#1c1c1a] group-hover:text-blue-600 transition-colors flex items-center gap-1">
                            {row.employee.name}
                            <Eye className="w-3.5 h-3.5 text-gray-400 group-hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </p>
                          <div className="flex items-center space-x-1.5 mt-0.5 text-[11px] text-[#8c8c80]">
                            <span>{row.employee.role}</span>
                            <span>•</span>
                            <span className={row.hasAttendanceBonus ? "text-emerald-700 font-semibold font-mono" : "font-mono"}>
                              {row.workingDaysCount}/{getDaysInMonth(selectedMonth)} công
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-center font-mono text-xs font-semibold">{row.totalHours}h</td>
                        <td className="px-4 py-3.5 text-center whitespace-nowrap">
                          {row.totalLateMinutes > 0 ? (
                            <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200" title={`Đi trễ ${row.totalLateMinutes} phút (${row.lateCount} lần trong tháng)`}>
                              <ClockIcon className="w-3.5 h-3.5 text-amber-600 inline mr-0.5" />
                              <span>{formatLateMinutes(row.totalLateMinutes)}</span>
                              {row.lateCount > 0 && <span className="text-[10px] text-amber-600 font-normal">({row.lateCount} lần)</span>}
                            </span>
                          ) : (
                            <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600 inline mr-0.5" />
                              <span>0 phút</span>
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs">{formatVND(row.baseEarned)}</td>
                        <td className="px-4 py-3.5 font-mono text-xs text-blue-600">+{formatVND(row.totalBonuses)}</td>
                        <td className="px-4 py-3.5 text-xs whitespace-nowrap">
                          <div>
                            <span className="font-mono text-amber-600 font-semibold">-{formatVND(row.totalDeductions)}</span>
                            <div className="mt-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleEmployeeLate(row.employee.id, row.isPenaltyApplicable);
                                }}
                                className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                                  row.isPenaltyApplicable
                                    ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                                    : 'bg-gray-100 hover:bg-gray-200 text-gray-500 border border-gray-200'
                                }`}
                                title={row.isPenaltyApplicable ? 'Nhấp để TẮT khấu trừ trễ cho nhân sự này' : 'Nhấp để BẬT khấu trừ trễ cho nhân sự này'}
                              >
                                {row.isPenaltyApplicable ? (
                                  <>
                                    <ToggleRight className="w-3 h-3 text-rose-600" />
                                    <span>Trừ trễ: {row.totalLatePenalties > 0 ? `-${formatCompactVND(row.totalLatePenalties)}` : '0đ'}</span>
                                  </>
                                ) : (
                                  <>
                                    <ToggleLeft className="w-3 h-3 text-gray-400" />
                                    <span>Miễn trừ trễ</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 font-mono font-bold text-emerald-700 text-sm">{formatVND(row.finalSalary)}</td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          <button
                            onClick={() => {
                              setViewingHistoryEmployee(row.employee);
                              setHistorySelectedMonth(selectedMonth);
                            }}
                            className="inline-flex items-center space-x-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-[11px] px-2.5 py-1.5 rounded-lg transition-all mr-2"
                            title="Xem lịch sử chấm công chi tiết theo tháng"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Lịch sử</span>
                          </button>
                          <button
                            onClick={() => handleExportSingle(row)}
                            className="inline-flex items-center space-x-1 bg-[#1c1c1a] hover:bg-[#2c2c28] text-white font-semibold text-[11px] px-2.5 py-1.5 rounded-lg transition-all"
                            title="Tải phiếu lương cá nhân dạng TXT"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>Phát lương</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 2. BULK ATTENDANCE IMPORT (Hỗ trợ File Excel & Text có xem trước và chỉnh sửa) */}
      {activeTab === 'bulk-attendance' && (
        <div className="space-y-6">
          {/* Subheader Switcher */}
          <div className="bg-white dark:bg-[#1c1c1a] border border-[#e4e4db] dark:border-[#2c2c28] p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-[#1c1c1a] dark:text-white flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <span>Nhập Công Hàng Loạt (Hỗ Trợ File Excel Chấm Công & Văn Bản)</span>
              </h3>
              <p className="text-xs text-[#5c5c54] dark:text-[#acaca0] mt-0.5">
                Tải lên file Excel chấm công của nhân viên để hệ thống tự động trích xuất, hoặc dán dữ liệu dạng text. Xem trước và chỉnh sửa trực tiếp.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadExcelTemplate}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold rounded-xl transition-all cursor-pointer"
                title="Tải tệp mẫu Excel mẫu chuẩn để điền dữ liệu"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Tải Mẫu Excel Chuẩn (.xlsx)</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Parser Input Form Panel */}
            <div className="lg:col-span-5 p-5 bg-[#fbfbfa] dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl space-y-4">
              
              {/* Method Switcher */}
              <div className="flex items-center bg-[#f2f2ee] dark:bg-[#2c2c28] p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setBulkInputMode('excel')}
                  className={`flex-1 flex items-center justify-center space-x-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    bulkInputMode === 'excel'
                      ? 'bg-white dark:bg-[#1c1c1a] text-emerald-800 dark:text-emerald-400 shadow-xs border border-[#e4e4db] dark:border-[#3c3c38]'
                      : 'text-[#5c5c54] dark:text-[#acaca0] hover:text-[#1c1c1a]'
                  }`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>File Excel (.xlsx, .xls)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBulkInputMode('text')}
                  className={`flex-1 flex items-center justify-center space-x-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    bulkInputMode === 'text'
                      ? 'bg-white dark:bg-[#1c1c1a] text-amber-800 dark:text-amber-400 shadow-xs border border-[#e4e4db] dark:border-[#3c3c38]'
                      : 'text-[#5c5c54] dark:text-[#acaca0] hover:text-[#1c1c1a]'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Dán Text Thủ Công</span>
                </button>
              </div>

              <form onSubmit={handleSaveBulkAttendance} className="space-y-4">
                <div>
                  <label htmlFor="bulk-emp" className="block text-xs font-medium text-[#5c5c54] mb-1.5">1. Chọn nhân sự nhập công *</label>
                  <select
                    id="bulk-emp"
                    value={bulkEmpId}
                    onChange={(e) => setBulkEmpId(e.target.value)}
                    className="w-full bg-white border border-[#c8c8c0] px-3 py-2 rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:ring-1 focus:ring-[#1c1c1a]"
                    required
                  >
                    <option value="">-- Chọn nhân viên từ danh sách --</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name} ({emp.id})</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="bulk-ym" className="block text-xs font-medium text-[#5c5c54] mb-1.5">2. Chọn tháng & năm *</label>
                    <input
                      id="bulk-ym"
                      type="month"
                      value={bulkYearMonth}
                      onChange={(e) => setBulkYearMonth(e.target.value)}
                      className="w-full bg-white border border-[#c8c8c0] px-3 py-2 rounded-lg text-sm text-[#1c1c1a] focus:outline-none"
                      required
                    />
                  </div>
                  <div className="flex flex-col justify-end">
                    <div className="text-[10px] text-[#8c8c80] leading-relaxed pb-1 font-medium italic">
                      * Dữ liệu chấm công sẽ được gán vào tháng này.
                    </div>
                  </div>
                </div>

                {bulkInputMode === 'excel' ? (
                  <div className="space-y-3">
                    <label className="block text-xs font-medium text-[#5c5c54]">
                      3. Tải lên tệp Excel chấm công (.xlsx, .xls) *
                    </label>

                    <input
                      type="file"
                      ref={fileInputRef}
                      accept=".xlsx, .xls"
                      onChange={handleExcelUpload}
                      className="hidden"
                    />

                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/40 hover:bg-emerald-50/70 rounded-2xl p-6 text-center cursor-pointer transition-all space-y-2.5"
                    >
                      <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700">
                        <Upload className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-emerald-950">Nhấp vào đây để chọn tệp Excel chấm công</p>
                        <p className="text-[11px] text-emerald-700 mt-0.5">Hỗ trợ các định dạng .xlsx, .xls của máy chấm công / mẫu Excel Serene</p>
                      </div>
                      <span className="inline-block text-[10px] bg-white border border-emerald-200 text-emerald-800 font-semibold px-2.5 py-1 rounded-full">
                        Hỗ trợ tự nhận diện Họ tên, Tháng & Giờ vào/ra
                      </span>
                    </div>

                    <div className="bg-amber-50/70 border border-amber-200/80 p-3 rounded-xl space-y-1 text-[11px] text-[#5c5c54]">
                      <p className="font-bold text-amber-900 flex items-center gap-1.5">
                        <span>💡 Định dạng file Excel hỗ trợ:</span>
                      </p>
                      <ul className="list-disc pl-4 space-y-0.5 leading-relaxed text-[10px]">
                        <li>Tiêu đề có chứa tên nhân viên (ví dụ: &ldquo;Thời Gian Chấm Công - Quyên&rdquo;).</li>
                        <li>Cột Ngày (DD/MM/YYYY), Thời gian (HH:mm), Tổng thời gian (X giờ Y phút).</li>
                        <li>Sau khi trích xuất, kết quả phân tích sẽ hiển thị ở bảng bên phải để kiểm tra và chỉnh sửa.</li>
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label htmlFor="bulk-text-area" className="block text-xs font-medium text-[#5c5c54] mb-1.5">
                        3. Dán văn bản chấm công * (Mỗi dòng một ngày)
                      </label>
                      <textarea
                        id="bulk-text-area"
                        rows={8}
                        value={bulkText}
                        onChange={(e) => setBulkText(e.target.value)}
                        placeholder="[ngày] [giờ hoặc khoảng giờ] [tùy chọn: tv/ot/off] [ghi chú]&#13;Ví dụ:&#13;25 10:00-23:00 (ca full)&#13;26 10:00-01:00 ot (tăng ca 2h)&#13;27 10:35-23:00 đi trễ 35p&#13;28 off nghỉ phép"
                        className="w-full bg-white border border-[#c8c8c0] rounded-xl p-3 text-xs font-mono text-[#1c1c1a] placeholder-[#acaca0] leading-relaxed focus:outline-none focus:border-[#1c1c1a]"
                      />
                    </div>

                    <div className="bg-[#fbfbfa] border border-[#e4e4db] p-3 rounded-lg space-y-1 text-[10px] text-[#5c5c54]">
                      <p className="font-semibold font-mono uppercase tracking-wider text-[#8c8c80]">Mẹo cú pháp:</p>
                      <ul className="list-disc pl-3.5 space-y-0.5">
                        <li><span className="font-bold font-mono">tv</span> → Hệ số 50%</li>
                        <li><span className="font-bold font-mono">ot</span> → Hệ số 150%</li>
                        <li><span className="font-bold font-mono">off</span> → Hệ số 0% (vắng)</li>
                      </ul>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={bulkPreviewLogs.length === 0}
                  className="w-full flex items-center justify-center space-x-2 bg-[#1c1c1a] hover:bg-[#2c2c28] text-white font-semibold text-xs py-3 rounded-xl transition-all shadow-xs disabled:opacity-40 cursor-pointer"
                >
                  <Check className="w-4 h-4 text-white" />
                  <span>Lưu toàn bộ dữ liệu phân tích ({bulkPreviewLogs.length} ngày)</span>
                </button>
              </form>
            </div>

            {/* Interactive Live Preview & Edit Panel */}
            <div className="lg:col-span-7 flex flex-col space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold font-mono text-[#8c8c80] uppercase tracking-wider">
                    Xem trước kết quả phân tích ({bulkPreviewLogs.length} ngày)
                  </h3>
                  <p className="text-[11px] text-[#5c5c54] mt-0.5">
                    Bạn có thể bấm <strong>Sửa</strong> từng dòng để chỉnh sửa dữ liệu trước khi lưu (có popup xác nhận).
                  </p>
                </div>
                
                {bulkPreviewLogs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      showConfirm('Xóa dữ liệu xem trước', 'Bạn có chắc muốn xóa sạch bảng xem trước hiện tại?', () => {
                        setBulkPreviewLogs([]);
                        setBulkErrors([]);
                      });
                    }}
                    className="text-xs text-rose-600 hover:underline font-semibold"
                  >
                    Xóa bảng xem trước
                  </button>
                )}
              </div>

              {bulkErrors.length > 0 && (
                <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl space-y-1">
                  <p className="text-xs font-bold text-rose-800">Thông báo từ bộ phân tích:</p>
                  <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-rose-700 font-medium">
                    {bulkErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="border border-[#e4e4db] rounded-xl overflow-hidden bg-white flex-1 min-h-[350px]">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-[#1c1c1a]">
                    <thead className="text-[11px] font-mono text-[#5c5c54] bg-[#fbfbfa] uppercase border-b border-[#e4e4db]">
                      <tr>
                        <th className="px-3.5 py-3">Ngày</th>
                        <th className="px-3.5 py-3 text-center">Số giờ</th>
                        <th className="px-3.5 py-3">Khoảng giờ</th>
                        <th className="px-3.5 py-3">Khấu trừ trễ</th>
                        <th className="px-3.5 py-3">Hệ số</th>
                        <th className="px-3.5 py-3">Ghi chú</th>
                        <th className="px-3.5 py-3 text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f2f2ee]">
                      {bulkPreviewLogs.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-16 text-center text-[#acaca0] font-medium text-xs leading-relaxed">
                            Chưa có dữ liệu xem trước.<br />
                            Vui lòng tải file Excel hoặc dán văn bản chấm công ở cột bên trái để trích xuất.
                          </td>
                        </tr>
                      ) : (
                        bulkPreviewLogs.map((log, i) => {
                          const targetEmp = employees.find(e => e.id === bulkEmpId);
                          const shiftStart = targetEmp?.shiftStartTime || '10:00';
                          const lateCalc = log.inTime ? calculateShiftLatePenalty(log.inTime, shiftStart, shiftPolicy) : null;

                          return (
                            <tr key={i} className="hover:bg-[#fbfbfa] transition-colors text-xs font-medium">
                              <td className="px-3.5 py-3 font-mono font-bold text-[#1c1c1a] whitespace-nowrap">{log.date}</td>
                              <td className="px-3.5 py-3 text-center font-mono font-bold text-sm text-[#5c5c54]">{log.hoursWorked}h</td>
                              <td className="px-3.5 py-3 font-mono text-xs text-[#5c5c54] whitespace-nowrap">
                                {log.inTime || log.outTime ? (
                                  <span className="bg-[#f2f2ee] px-2 py-0.5 rounded text-[#1c1c1a]">
                                    {log.inTime || '—'} → {log.outTime || '—'}
                                  </span>
                                ) : '—'}
                              </td>
                              <td className="px-3.5 py-3 whitespace-nowrap">
                                {(() => {
                                  if (!lateCalc || log.status === 'absent') return <span className="text-[#8c8c80]">—</span>;
                                  if (lateCalc.totalPenalty > 0) {
                                    return (
                                      <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                        <span>-{formatCompactVND(lateCalc.totalPenalty)}</span>
                                        <span className="font-normal text-[10px] text-rose-600">({lateCalc.lateMinutes}p)</span>
                                      </span>
                                    );
                                  }
                                  if (lateCalc.status === 'grace') {
                                    return (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                                        0đ (Du di {lateCalc.lateMinutes}p)
                                      </span>
                                    );
                                  }
                                  return (
                                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      <Check className="w-3 h-3 text-emerald-600 inline" />
                                      <span>0đ (Đúng giờ)</span>
                                    </span>
                                  );
                                })()}
                              </td>
                              <td className="px-3.5 py-3">
                                <span className={`inline-block font-mono font-bold px-2 py-0.5 rounded-full ${
                                  log.rateMultiplier === 1.5 ? 'bg-blue-50 text-blue-700' : (log.rateMultiplier === 0.5 ? 'bg-amber-50 text-amber-700' : 'bg-[#fbfbfa] text-[#5c5c54]')
                                }`}>
                                  {log.rateMultiplier}x
                                </span>
                              </td>
                              <td className="px-3.5 py-3 text-[#5c5c54] truncate max-w-[140px]" title={log.notes}>
                                {log.notes || (log.status === 'absent' ? 'Vắng mặt (off)' : 'Công thường')}
                              </td>
                              <td className="px-3.5 py-3 text-right whitespace-nowrap">
                                <div className="flex items-center justify-end space-x-1">
                                  <button
                                    type="button"
                                    onClick={() => handleStartEditPreviewRow(i)}
                                    className="p-1 text-blue-600 hover:bg-blue-50 rounded-md transition-all cursor-pointer"
                                    title="Chỉnh sửa dòng phân tích này"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeletePreviewRow(i)}
                                    className="p-1 text-red-500 hover:bg-red-50 rounded-md transition-all cursor-pointer"
                                    title="Xóa dòng phân tích này"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

          </div>

          {/* Edit Preview Row Modal with Popup Confirm */}
          {editingPreviewIdx !== null && (
            <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
              <div className="bg-white border border-[#e4e4db] rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-in fade-in duration-200">
                <div className="flex items-center justify-between pb-3 border-b border-[#f2f2ee]">
                  <div className="flex items-center space-x-2">
                    <Edit2 className="w-4 h-4 text-blue-600" />
                    <h3 className="text-sm font-bold text-[#1c1c1a]">
                      Chỉnh Sửa Dòng Chấm Công Xem Trước (Ngày {previewEditDate})
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingPreviewIdx(null)}
                    className="p-1 text-gray-400 hover:text-gray-600 rounded-lg cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-3.5 text-xs">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-[#5c5c54] mb-1">Ngày làm việc *</label>
                      <input
                        type="date"
                        value={previewEditDate}
                        onChange={(e) => setPreviewEditDate(e.target.value)}
                        className="w-full bg-[#fbfbfa] border border-[#c8c8c0] px-3 py-2 rounded-xl font-mono text-sm focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#5c5c54] mb-1">Trạng thái công *</label>
                      <select
                        value={previewEditStatus}
                        onChange={(e) => setPreviewEditStatus(e.target.value as any)}
                        className="w-full bg-[#fbfbfa] border border-[#c8c8c0] px-3 py-2 rounded-xl text-sm focus:outline-none"
                      >
                        <option value="present">Đủ công (Present)</option>
                        <option value="late">Đi trễ (Late)</option>
                        <option value="absent">Nghỉ phép / Vắng (Absent)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-[#5c5c54] mb-1">Giờ vào (HH:mm) *</label>
                      <input
                        type="time"
                        value={previewEditInTime}
                        onChange={(e) => {
                          const v = e.target.value;
                          setPreviewEditInTime(v);
                          if (v && previewEditOutTime) {
                            const [inH, inM] = v.split(':').map(Number);
                            const [outH, outM] = previewEditOutTime.split(':').map(Number);
                            let mins = (outH * 60 + outM) - (inH * 60 + inM);
                            if (mins < 0) mins += 1440;
                            setPreviewEditHours(Math.round((mins / 60) * 10) / 10);
                          }
                        }}
                        className="w-full bg-[#fbfbfa] border border-[#c8c8c0] px-3 py-2 rounded-xl font-mono text-sm focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#5c5c54] mb-1">Giờ ra (HH:mm) *</label>
                      <input
                        type="time"
                        value={previewEditOutTime}
                        onChange={(e) => {
                          const v = e.target.value;
                          setPreviewEditOutTime(v);
                          if (previewEditInTime && v) {
                            const [inH, inM] = previewEditInTime.split(':').map(Number);
                            const [outH, outM] = v.split(':').map(Number);
                            let mins = (outH * 60 + outM) - (inH * 60 + inM);
                            if (mins < 0) mins += 1440;
                            setPreviewEditHours(Math.round((mins / 60) * 10) / 10);
                          }
                        }}
                        className="w-full bg-[#fbfbfa] border border-[#c8c8c0] px-3 py-2 rounded-xl font-mono text-sm focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-[#5c5c54] mb-1">Số giờ làm việc (h) *</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="24"
                        value={previewEditHours}
                        onChange={(e) => setPreviewEditHours(parseFloat(e.target.value) || 0)}
                        className="w-full bg-[#fbfbfa] border border-[#c8c8c0] px-3 py-2 rounded-xl font-mono text-sm focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#5c5c54] mb-1">Hệ số tính lương *</label>
                      <select
                        value={previewEditMultiplier}
                        onChange={(e) => setPreviewEditMultiplier(parseFloat(e.target.value) || 1.0)}
                        className="w-full bg-[#fbfbfa] border border-[#c8c8c0] px-3 py-2 rounded-xl text-sm focus:outline-none"
                      >
                        <option value="1.0">1.0x (Ca thường)</option>
                        <option value="1.5">1.5x (Tăng ca OT)</option>
                        <option value="0.5">0.5x (Thử việc tv)</option>
                        <option value="2.0">2.0x (Chủ nhật)</option>
                        <option value="0.0">0.0x (Nghỉ off)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#5c5c54] mb-1">Ghi chú ngày làm</label>
                    <input
                      type="text"
                      placeholder="Ví dụ: Đi trễ họp, Ca Full..."
                      value={previewEditNotes}
                      onChange={(e) => setPreviewEditNotes(e.target.value)}
                      className="w-full bg-[#fbfbfa] border border-[#c8c8c0] px-3 py-2 rounded-xl text-sm focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-3 border-t border-[#f2f2ee]">
                  <button
                    type="button"
                    onClick={() => setEditingPreviewIdx(null)}
                    className="px-4 py-2 border border-[#c8c8c0] text-[#5c5c54] hover:bg-gray-50 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEditPreviewRow}
                    className="px-5 py-2 bg-[#1c1c1a] hover:bg-black text-white rounded-xl text-xs font-semibold cursor-pointer shadow-xs transition-colors"
                  >
                    Lưu Thay Đổi (Xác nhận)
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      )}

      {/* 3. DAILY ATTENDANCE TAB */}
      {activeTab === 'daily-attendance' && (
        <form onSubmit={handleSaveDailyAttendance} className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-[#fbfbfa] border border-[#e4e4db] rounded-xl">
            <div className="flex items-center space-x-2">
              <label htmlFor="attendance-day" className="text-xs font-semibold font-mono text-[#5c5c54] uppercase">Chọn ngày chấm công:</label>
              <input
                id="attendance-day"
                type="date"
                value={attDate}
                onChange={(e) => setAttDate(e.target.value)}
                className="bg-white border border-[#c8c8c0] px-3 py-1.5 rounded-lg text-sm text-[#1c1c1a] focus:outline-none"
              />
            </div>
            
            <p className="text-xs text-[#8c8c80] font-medium">
              Chấm công nhanh cho toàn bộ nhân sự hiện tại trong ngày đã chọn.
            </p>
          </div>

          <div className="border border-[#e4e4db] rounded-xl overflow-hidden bg-white">
            <table className="w-full text-left text-sm text-[#1c1c1a]">
              <thead className="text-[11px] font-mono text-[#5c5c54] bg-[#fbfbfa] uppercase border-b border-[#e4e4db]">
                <tr>
                  <th scope="col" className="px-4 py-3">Nhân Viên</th>
                  <th scope="col" className="px-4 py-3">Chọn ca</th>
                  <th scope="col" className="px-4 py-3">Trạng thái</th>
                  <th scope="col" className="px-4 py-3">Giờ vào thực tế</th>
                  <th scope="col" className="px-4 py-3">Giờ kết thực tế</th>
                  <th scope="col" className="px-4 py-3">Hệ số lương</th>
                  <th scope="col" className="px-4 py-3">Ghi chú nhanh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f2f2ee]">
                {employees.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-[#8c8c80] font-medium">
                      Chưa có nhân viên trong danh sách. Vui lòng thêm tại tab "Nhân sự" trước.
                    </td>
                  </tr>
                ) : (
                  employees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-[#fbfbfa] transition-colors">
                      <td className="px-4 py-3.5">
                        <p className="font-semibold">{emp.name}</p>
                        <p className="text-xs text-[#8c8c80] mt-0.5">{emp.role}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <select
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val) {
                              const selectedShift = shifts.find(s => s.id === val);
                              if (selectedShift) {
                                setAttShiftId(prev => ({ ...prev, [emp.id]: selectedShift.id }));
                                setAttInTime(prev => ({ ...prev, [emp.id]: selectedShift.startTime }));
                                setAttOutTime(prev => ({ ...prev, [emp.id]: selectedShift.endTime }));
                                setAttMultiplier(prev => ({ ...prev, [emp.id]: selectedShift.multiplier }));
                                setAttNotes(prev => ({ ...prev, [emp.id]: selectedShift.name }));
                                setAttStatus(prev => ({ ...prev, [emp.id]: 'present' }));
                              }
                            }
                          }}
                          disabled={attStatus[emp.id] === 'absent'}
                          className="bg-white border border-[#c8c8c0] px-2 py-1 rounded-lg text-xs text-[#1c1c1a] focus:outline-none cursor-pointer w-full max-w-[150px] disabled:opacity-40"
                          value={attShiftId[emp.id] || ''}
                        >
                          <option value="">-- Chọn ca --</option>
                          {shifts.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.startTime}-{s.endTime}, x{s.multiplier})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex space-x-1.5">
                          {(['present', 'late', 'absent'] as const).map((status) => {
                            const labels = { present: 'Đủ công', late: 'Trễ giờ', absent: 'Vắng' };
                            const colors = {
                              present: attStatus[emp.id] === 'present' ? 'bg-emerald-600 text-white border-transparent' : 'bg-transparent text-emerald-700 border-emerald-200 hover:bg-emerald-50',
                              late: attStatus[emp.id] === 'late' ? 'bg-amber-500 text-white border-transparent' : 'bg-transparent text-amber-700 border-amber-200 hover:bg-amber-50',
                              absent: attStatus[emp.id] === 'absent' ? 'bg-rose-600 text-white border-transparent' : 'bg-transparent text-rose-700 border-rose-200 hover:bg-rose-50',
                            };
                            return (
                              <button
                                key={status}
                                type="button"
                                onClick={() => {
                                  setAttStatus(prev => ({ ...prev, [emp.id]: status }));
                                  if (status === 'absent') {
                                    setAttMultiplier(prev => ({ ...prev, [emp.id]: 0.0 }));
                                  } else if (status === 'present' && (attMultiplier[emp.id] || 0) === 0) {
                                    setAttMultiplier(prev => ({ ...prev, [emp.id]: 1.0 }));
                                  }
                                }}
                                className={`text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-all cursor-pointer ${colors[status]}`}
                              >
                                {labels[status]}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <input
                          type="text"
                          placeholder="15:00"
                          value={attInTime[emp.id] || ''}
                          disabled={attStatus[emp.id] === 'absent'}
                          onChange={(e) => setAttInTime(prev => ({ ...prev, [emp.id]: e.target.value }))}
                          className="bg-[#fbfbfa] border border-[#c8c8c0] px-2 py-1 rounded-lg w-20 text-center text-xs font-mono focus:outline-none focus:border-[#1c1c1a] disabled:opacity-40"
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <input
                          type="text"
                          placeholder="01:00"
                          value={attOutTime[emp.id] || ''}
                          disabled={attStatus[emp.id] === 'absent'}
                          onChange={(e) => setAttOutTime(prev => ({ ...prev, [emp.id]: e.target.value }))}
                          className="bg-[#fbfbfa] border border-[#c8c8c0] px-2 py-1 rounded-lg w-20 text-center text-xs font-mono focus:outline-none focus:border-[#1c1c1a] disabled:opacity-40"
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <select
                          value={attMultiplier[emp.id] ?? 1.0}
                          disabled={attStatus[emp.id] === 'absent'}
                          onChange={(e) => setAttMultiplier(prev => ({ ...prev, [emp.id]: Number(e.target.value) }))}
                          className="bg-[#fbfbfa] border border-[#c8c8c0] px-1 py-1 rounded-lg text-xs font-mono focus:outline-none disabled:opacity-40"
                        >
                          <option value="1.0">1.0x (Thường)</option>
                          <option value="1.5">1.5x (Tăng ca OT)</option>
                          <option value="2.0">2.0x (Chủ nhật)</option>
                          <option value="3.0">3.0x (Ngày Lễ)</option>
                          <option value="0.5">0.5x (Thử việc)</option>
                          <option value="0.0">0.0x (Nghỉ)</option>
                        </select>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center space-x-2">
                          <input
                            type="text"
                            value={attNotes[emp.id] || ''}
                            onChange={(e) => setAttNotes(prev => ({ ...prev, [emp.id]: e.target.value }))}
                            placeholder="Ghi chú nhanh..."
                            className="bg-transparent border-b border-transparent hover:border-[#e4e4db] focus:border-[#1c1c1a] focus:outline-none text-xs text-[#5c5c54] flex-1 py-1 transition-all min-w-[120px]"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveIndividualAttendance(emp.id)}
                            className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-semibold text-[10px] rounded-lg transition-all cursor-pointer whitespace-nowrap flex items-center space-x-1 shrink-0"
                            title="Lưu chấm công cho nhân viên này"
                          >
                            <Save className="w-3 h-3" />
                            <span>Lưu</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={employees.length === 0}
              className="flex items-center space-x-2 bg-[#1c1c1a] hover:bg-[#2c2c28] disabled:opacity-40 text-white font-semibold text-xs px-5 py-2.5 rounded-xl transition-all shadow-xs cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Lưu bảng chấm công ngày này</span>
            </button>
          </div>
        </form>
      )}

      {/* 4. ADJUSTMENTS (BONUS & PENALTIES) TAB */}
      {activeTab === 'adjustments' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* New adjustment form */}
          {session?.role !== 'manager' && (
            <div className="lg:col-span-4 p-5 bg-[#fbfbfa] border border-[#e4e4db] rounded-2xl h-fit">
              <h3 className="text-xs font-semibold font-mono text-[#8c8c80] uppercase tracking-wider mb-4">
                {editingAdjustmentId ? 'Cập Nhật Thưởng / Phạt' : 'Ghi nhận thưởng / phạt'}
              </h3>
              <form onSubmit={handleAddAdjustment} className="space-y-4">
                <div>
                  <label htmlFor="adj-emp" className="block text-xs font-medium text-[#5c5c54] mb-1.5">Chọn nhân viên *</label>
                  <select
                    id="adj-emp"
                    value={adjEmpId}
                    onChange={(e) => setAdjEmpId(e.target.value)}
                    className="w-full bg-white border border-[#c8c8c0] px-3 py-2 rounded-lg text-sm text-[#1c1c1a] focus:outline-none"
                    required
                  >
                    <option value="">-- Chọn nhân viên --</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name} ({emp.id})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#5c5c54] mb-1.5">Phân loại *</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setAdjType('bonus')}
                      className={`py-1.5 px-3 rounded-lg text-xs font-semibold border text-center cursor-pointer transition-all ${
                        adjType === 'bonus'
                          ? 'bg-blue-600 text-white border-transparent shadow-xs'
                          : 'bg-white text-blue-700 border-blue-200 hover:bg-blue-50'
                      }`}
                    >
                      Khen Thưởng (+)
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdjType('penalty')}
                      className={`py-1.5 px-3 rounded-lg text-xs font-semibold border text-center cursor-pointer transition-all ${
                        adjType === 'penalty'
                          ? 'bg-amber-600 text-white border-transparent shadow-xs'
                          : 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50'
                      }`}
                    >
                      Khấu Trừ / Phạt (-)
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="adj-amount" className="block text-xs font-medium text-[#5c5c54] mb-1">Số tiền (VND) *</label>
                  <input
                    id="adj-amount"
                    type="number"
                    min="1000"
                    step="1000"
                    value={adjAmount}
                    onChange={(e) => setAdjAmount(Number(e.target.value))}
                    className="w-full bg-white border border-[#c8c8c0] px-3 py-2 rounded-lg text-sm font-mono text-[#1c1c1a] focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="adj-date" className="block text-xs font-medium text-[#5c5c54] mb-1">Ngày ghi nhận *</label>
                  <input
                    id="adj-date"
                    type="date"
                    value={adjDate}
                    onChange={(e) => setAdjDate(e.target.value)}
                    className="w-full bg-white border border-[#c8c8c0] px-3 py-2 rounded-lg text-sm text-[#1c1c1a] focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="adj-reason" className="block text-xs font-medium text-[#5c5c54] mb-1">Lý do điều chỉnh *</label>
                  <input
                    id="adj-reason"
                    type="text"
                    placeholder="Ví dụ: Tăng ca dự án, Đi muộn họp..."
                    value={adjReason}
                    onChange={(e) => setAdjReason(e.target.value)}
                    className="w-full bg-white border border-[#c8c8c0] px-3 py-2 rounded-lg text-sm text-[#1c1c1a] focus:outline-none"
                    required
                  />
                </div>

                <div className="flex space-x-2 pt-2">
                  {editingAdjustmentId && (
                    <button
                      type="button"
                      onClick={handleCancelEditAdjustment}
                      className="flex-1 flex items-center justify-center space-x-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-xs py-2.5 rounded-xl transition-all cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                      <span>Hủy</span>
                    </button>
                  )}
                  <button
                    type="submit"
                    className={`${editingAdjustmentId ? 'flex-1' : 'w-full'} flex items-center justify-center space-x-2 bg-[#1c1c1a] hover:bg-[#2c2c28] text-white font-semibold text-xs py-2.5 rounded-xl transition-all shadow-xs cursor-pointer`}
                  >
                    {editingAdjustmentId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    <span>{editingAdjustmentId ? 'Cập nhật' : 'Ghi nhận điều chỉnh'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Adjustment list table */}
          <div className={`${session?.role === 'manager' ? 'lg:col-span-12' : 'lg:col-span-8'} flex flex-col space-y-4`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#f2f2ee] pb-2">
              <h3 className="text-xs font-semibold font-mono text-[#8c8c80] uppercase tracking-wider">
                Lịch sử thưởng phạt tháng {selectedMonth.substring(5, 7)}/{selectedMonth.substring(0, 4)}
              </h3>
              <div className="flex items-center space-x-2">
                <label htmlFor="adj-filter-month" className="text-xs font-semibold font-mono text-[#5c5c54] uppercase">Bộ lọc tháng:</label>
                <input
                  id="adj-filter-month"
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="bg-white border border-[#e4e4db] px-2.5 py-1 rounded-lg text-xs font-medium text-[#1c1c1a] focus:outline-none focus:ring-1 focus:ring-[#1c1c1a]"
                />
              </div>
            </div>
            <div className="border border-[#e4e4db] rounded-xl overflow-hidden bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-[#1c1c1a]">
                  <thead className="text-[11px] font-mono text-[#5c5c54] bg-[#fbfbfa] uppercase border-b border-[#e4e4db]">
                    <tr>
                      <th scope="col" className="px-4 py-3">Nhân Viên</th>
                      <th scope="col" className="px-4 py-3">Phân loại</th>
                      <th scope="col" className="px-4 py-3">Lý do</th>
                      <th scope="col" className="px-4 py-3">Số tiền</th>
                      {session?.role !== 'manager' && <th scope="col" className="px-4 py-3 text-right">Thao tác</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f2f2ee]">
                    {(() => {
                      const autoBonuses: PayrollAdjustment[] = [];
                      employees.forEach(emp => {
                        const autoBonus = getAutoBonusForEmployee(emp, selectedMonth, attendance, dismissedAutoBonuses);
                        if (autoBonus && !adjustments.some(adj => adj.id === autoBonus.id)) {
                          autoBonuses.push(autoBonus);
                        }
                      });

                      const filteredAdjustments = [...adjustments, ...autoBonuses]
                        .filter(adj => getMonthYearString(adj.date) === selectedMonth)
                        .sort((a, b) => b.date.localeCompare(a.date));

                      if (filteredAdjustments.length === 0) {
                        return (
                          <tr>
                            <td colSpan={session?.role === 'manager' ? 4 : 5} className="px-4 py-8 text-center text-[#8c8c80] font-medium">
                              Không có ghi nhận thưởng / phạt nào trong tháng {selectedMonth.substring(5, 7)}/{selectedMonth.substring(0, 4)}.
                            </td>
                          </tr>
                        );
                      }

                      return filteredAdjustments.map((adj) => {
                        const emp = employees.find(e => e.id === adj.employeeId);
                        const empName = emp ? emp.name : 'Nhân viên đã xóa';
                        return (
                          <tr key={adj.id} className="hover:bg-[#fbfbfa] transition-colors">
                            <td className="px-4 py-3">
                              <p className="font-semibold">{empName}</p>
                              <p className="text-[10px] text-[#8c8c80] font-mono">{adj.date}</p>
                            </td>
                            <td className="px-4 py-3">
                              {adj.type === 'bonus' ? (
                                <span className="inline-flex items-center space-x-1 text-xs text-blue-700 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full font-medium">
                                  <TrendingUp className="w-3 h-3" />
                                  <span>Khen thưởng</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center space-x-1 text-xs text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full font-medium">
                                  <AlertTriangle className="w-3 h-3" />
                                  <span>Khấu trừ</span>
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs font-medium text-[#5c5c54] max-w-[180px] truncate" title={adj.reason}>
                              {adj.reason}
                            </td>
                            <td className={`px-4 py-3 font-mono font-bold text-xs ${adj.type === 'bonus' ? 'text-blue-600' : 'text-amber-600'}`}>
                              {adj.type === 'bonus' ? '+' : '-'}{formatVND(adj.amount)}
                            </td>
                            {session?.role !== 'manager' && (
                              <td className="px-4 py-3 text-right flex items-center justify-end space-x-1">
                                <button
                                  onClick={() => handleStartEditAdjustment(adj)}
                                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                  title="Chỉnh sửa ghi nhận này"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleRemoveAdjustment(adj.id, empName, adj.amount, adj.type)}
                                  className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                  title="Hủy bỏ ghi nhận này"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. EMPLOYEES TAB (Full Admin CRM) */}
      {activeTab === 'employees' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Add / Edit employee form and Sync Password */}
          {session?.role !== 'manager' && (
            <div className="lg:col-span-4 space-y-6">
              <div className="p-5 bg-amber-50/40 border border-[#e4e4db] rounded-2xl">
                <h3 className="text-xs font-semibold font-mono text-amber-900 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-amber-600" />
                  Thay Đổi Mật Khẩu Đồng Bộ Hệ Thống
                </h3>
                <p className="text-[11px] text-[#5c5c54] leading-normal mb-3">
                  Đặt lại mật khẩu đồng bộ (dùng chung cho toàn bộ nhân sự để đăng nhập nhanh).
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Nhập mật khẩu đồng bộ mới..."
                    value={adminGlobalSyncPassword}
                    onChange={(e) => setAdminGlobalSyncPassword(e.target.value)}
                    className="flex-1 bg-white border border-[#c8c8c0] px-3 py-1.5 rounded-lg text-xs text-[#1c1c1a] focus:outline-none focus:border-[#1c1c1a]"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!adminGlobalSyncPassword.trim()) {
                        showAlert('Thông báo', 'Mật khẩu đồng bộ không được để trống.');
                        return;
                      }
                      showConfirm(
                        'Cập nhật mật khẩu đồng bộ',
                        'Bạn có chắc chắn muốn thay đổi mật khẩu đồng bộ cho TOÀN BỘ nhân viên không? Mật khẩu đồng bộ của tất cả nhân viên khác sẽ được cập nhật đồng nhất.',
                        async () => {
                          try {
                            await updateAllSyncPasswords(adminGlobalSyncPassword);
                            showAlert('Thành công', 'Đã cập nhật mật khẩu đồng bộ thành công!');
                          } catch (err) {
                            showAlert('Lỗi', `Lỗi cập nhật mật khẩu đồng bộ: ${err}`);
                          }
                        }
                      );
                    }}
                    className="px-3 py-1.5 bg-[#1c1c1a] hover:bg-[#2c2c28] text-white text-[11px] font-semibold rounded-lg transition-all cursor-pointer whitespace-nowrap"
                  >
                    Cập Nhật
                  </button>
                </div>
              </div>

              <div className="p-5 bg-[#fbfbfa] border border-[#e4e4db] rounded-2xl">
                <h3 className="text-xs font-semibold font-mono text-[#8c8c80] uppercase tracking-wider mb-4">
                  {editingEmployeeId ? 'Cập Nhật Nhân Sự' : 'Thêm Nhân Sự Mới'}
                </h3>
                <form onSubmit={handleSaveEmployee} className="space-y-4">
                  <div>
                    <label htmlFor="emp-id" className="block text-xs font-medium text-[#5c5c54] mb-1">Mã nhân viên (ID) *</label>
                    <input
                      id="emp-id"
                      type="text"
                      placeholder="Ví dụ: EMP-001"
                      value={empId}
                      onChange={(e) => setEmpId(e.target.value)}
                      className="w-full bg-white border border-[#c8c8c0] px-3 py-2 rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#1c1c1a]"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="emp-name" className="block text-xs font-medium text-[#5c5c54] mb-1">Họ và Tên *</label>
                    <input
                      id="emp-name"
                      type="text"
                      placeholder="Ví dụ: Nguyễn Văn A"
                      value={empName}
                      onChange={(e) => setEmpName(e.target.value)}
                      className="w-full bg-white border border-[#c8c8c0] px-3 py-2 rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#1c1c1a]"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="emp-password" className="block text-xs font-medium text-[#5c5c54] mb-1">Mật khẩu nhân viên (Riêng) *</label>
                    <input
                      id="emp-password"
                      type="text"
                      placeholder="Nhập mật khẩu..."
                      value={empPassword}
                      onChange={(e) => setEmpPassword(e.target.value)}
                      className="w-full bg-white border border-[#c8c8c0] px-3 py-2 rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#1c1c1a]"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="emp-sync-password" className="block text-xs font-medium text-[#5c5c54] mb-1">Mật khẩu đồng bộ (Dùng chung) *</label>
                    <input
                      id="emp-sync-password"
                      type="text"
                      placeholder="Nhập mật khẩu đồng bộ..."
                      value={empSyncPassword}
                      onChange={(e) => setEmpSyncPassword(e.target.value)}
                      className="w-full bg-white border border-[#c8c8c0] px-3 py-2 rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#1c1c1a]"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="emp-role" className="block text-xs font-medium text-[#5c5c54] mb-1">Chức vụ *</label>
                    <select
                      id="emp-role"
                      value={empRole}
                      onChange={(e) => setEmpRole(e.target.value)}
                      className="w-full bg-white border border-[#c8c8c0] px-3 py-2 rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#1c1c1a]"
                      required
                    >
                      <option value="Nhân viên">Nhân viên</option>
                      <option value="Quản lý">Quản lý</option>
                      <option value="Bếp">Bếp</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="emp-rate" className="block text-xs font-medium text-[#5c5c54] mb-1">Đơn giá lương / Giờ (VND) * (15,000 - 100,000)</label>
                    <input
                      id="emp-rate"
                      type="number"
                      min="15000"
                      max="100000"
                      step="1000"
                      value={empRate}
                      onChange={(e) => setEmpRate(Number(e.target.value))}
                      className="w-full bg-white border border-[#c8c8c0] px-3 py-2 rounded-lg text-sm font-mono text-[#1c1c1a] focus:outline-none"
                      required
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] font-bold font-mono text-[#5c5c54]">Khung ca mặc định:</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEmpShiftStartTime('10:00');
                        setEmpShiftEndTime('23:00');
                        setEmpOvertimeStart('23:00');
                      }}
                      className="text-[10px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 rounded cursor-pointer transition-all"
                    >
                      ✓ Ca Full (10h - 23h, OT: 23h)
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label htmlFor="emp-shift-start" className="block text-[10px] font-semibold text-[#5c5c54] uppercase tracking-wider mb-1">Giờ vào ca *</label>
                      <input
                        id="emp-shift-start"
                        type="text"
                        placeholder="10:00"
                        value={empShiftStartTime}
                        onChange={(e) => setEmpShiftStartTime(e.target.value)}
                        className="w-full bg-white border border-[#c8c8c0] px-3 py-2 rounded-lg text-xs font-mono text-[#1c1c1a] focus:outline-none focus:border-[#1c1c1a]"
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="emp-shift-end" className="block text-[10px] font-semibold text-[#5c5c54] uppercase tracking-wider mb-1">Giờ ra ca *</label>
                      <input
                        id="emp-shift-end"
                        type="text"
                        placeholder="23:00"
                        value={empShiftEndTime}
                        onChange={(e) => setEmpShiftEndTime(e.target.value)}
                        className="w-full bg-white border border-[#c8c8c0] px-3 py-2 rounded-lg text-xs font-mono text-[#1c1c1a] focus:outline-none focus:border-[#1c1c1a]"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="emp-ot-start" className="block text-[10px] font-semibold text-[#5c5c54] uppercase tracking-wider mb-1">Giờ tính tăng ca *</label>
                      <input
                        id="emp-ot-start"
                        type="text"
                        placeholder="23:00"
                        value={empOvertimeStart}
                        onChange={(e) => setEmpOvertimeStart(e.target.value)}
                        className="w-full bg-white border border-[#c8c8c0] px-3 py-2 rounded-lg text-xs font-mono text-[#1c1c1a] focus:outline-none focus:border-[#1c1c1a]"
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="emp-ot-rate" className="block text-[10px] font-semibold text-[#5c5c54] uppercase tracking-wider mb-1">Lương tăng ca / Giờ *</label>
                      <input
                        id="emp-ot-rate"
                        type="number"
                        min="15000"
                        max="100000"
                        step="1000"
                        value={empOvertimeHourlyRate}
                        onChange={(e) => setEmpOvertimeHourlyRate(Number(e.target.value))}
                        className="w-full bg-white border border-[#c8c8c0] px-3 py-2 rounded-lg text-xs font-mono text-[#1c1c1a] focus:outline-none focus:border-[#1c1c1a]"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex space-x-2 pt-2">
                    {editingEmployeeId && (
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="flex-1 border border-[#e4e4db] hover:bg-[#f2f2ee] text-[#1c1c1a] font-semibold text-xs py-2.5 rounded-xl transition-all cursor-pointer text-center"
                      >
                        Hủy sửa
                      </button>
                    )}
                    <button
                      type="submit"
                      className="flex-1 flex items-center justify-center space-x-2 bg-[#1c1c1a] hover:bg-[#2c2c28] text-white font-semibold text-xs py-2.5 rounded-xl transition-all shadow-xs cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>{editingEmployeeId ? 'Cập nhật nhân viên' : 'Thêm nhân viên'}</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Employee list */}
          <div className={`${session?.role === 'manager' ? 'lg:col-span-12' : 'lg:col-span-8'} flex flex-col space-y-4`}>
            <h3 className="text-xs font-semibold font-mono text-[#8c8c80] uppercase tracking-wider">Danh sách nhân viên hiện tại ({employees.length})</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {employees.length === 0 ? (
                <div className="col-span-2 border border-[#e4e4db] rounded-xl p-8 text-center text-[#8c8c80] bg-white font-medium">
                  {session?.role === 'manager' ? 'Không có nhân viên nào trong danh sách.' : 'Chưa có nhân viên nào được thiết lập. Hãy thêm nhân sự ở bên cạnh.'}
                </div>
              ) : (
                employees.map((emp) => (
                  <div key={emp.id} className="p-4 bg-white border border-[#e4e4db] rounded-xl flex justify-between items-start hover:shadow-xs transition-shadow">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-xs font-bold bg-[#fbfbfa] px-1.5 py-0.5 rounded border border-[#e4e4db] text-[#5c5c54]">
                          {emp.id}
                        </span>
                        <p className="font-semibold text-sm text-[#1c1c1a]">{emp.name}</p>
                      </div>
                      <p className="text-xs font-medium text-[#5c5c54]">{emp.role}</p>
                      <p className="text-[11px] font-mono text-[#8c8c80] pt-1">
                        Lương giờ: <span className="font-semibold text-[#1c1c1a]">{formatVND(emp.hourlyRate)}</span>
                      </p>
                      {emp.shiftStartTime && (
                        <p className="text-[10px] font-mono text-[#8c8c80]">
                          Ca làm: <span className="font-semibold text-[#1c1c1a]">{emp.shiftStartTime} - {emp.shiftEndTime}</span>
                        </p>
                      )}
                      {emp.overtimeHourlyRate && (
                        <p className="text-[10px] font-mono text-[#8c8c80]">
                          Lương tăng ca: <span className="font-semibold text-[#1c1c1a]">{formatVND(emp.overtimeHourlyRate)}</span>
                        </p>
                      )}
                      <p className="text-[10px] font-mono text-[#8c8c80]">
                        Mật khẩu riêng: <span className="font-semibold text-emerald-700">{emp.password || '123'}</span>
                      </p>
                      <p className="text-[10px] font-mono text-[#8c8c80]">
                        Mật khẩu đồng bộ: <span className="font-semibold text-amber-700">{emp.syncPassword || 'admin123'}</span>
                      </p>
                      <p className="text-[9px] font-mono text-[#acaca0]">Gia nhập: {emp.createdAt}</p>
                    </div>

                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => {
                          setViewingHistoryEmployee(emp);
                          setHistorySelectedMonth(selectedMonth);
                        }}
                        className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                        title="Xem lịch sử chấm công"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      {session?.role !== 'manager' && (
                        <>
                          <button
                            onClick={() => handleStartEditEmployee(emp)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                            title="Chỉnh sửa nhân viên"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleRemoveEmployee(emp.id, emp.name)}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-all"
                            title="Xóa nhân sự"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 5. SHIFTS & LATE PENALTY POLICY SETUP TAB */}
      {activeTab === 'shifts' && (
        <div className="space-y-6">
          {/* Header announcement */}
          <div className="bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] p-5 rounded-2xl shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start space-x-3">
                <div className="p-2.5 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 rounded-xl border border-amber-100 dark:border-amber-900/30 shrink-0">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#1c1c1a] dark:text-[#fbfbfa] uppercase tracking-wider">
                    Thiết Lập Ca Làm Việc & Quy Định Đi Trễ / Đi Sớm
                  </h3>
                  <p className="text-xs text-[#5c5c54] dark:text-[#acaca0] mt-0.5">
                    Quản trị viên có thể tùy chỉnh thời gian du di đầu ca, quy định lũy tiến trừ lương theo từng bậc và quản lý danh sách các ca làm việc.
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                <span className="inline-flex items-center space-x-1.5 px-3 py-1 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/30 rounded-full text-xs font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Du di đầu ca: {shiftPolicy.lateGraceMinutes} phút</span>
                </span>
              </div>
            </div>
          </div>

          {/* Top Grid: Shift Policy Configuration + Interactive Simulator */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Card 1: Setup Quy Định Du Di & Phạt Đi Trễ */}
            <div className="lg:col-span-6 p-5 bg-[#fbfbfa] dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#f2f2ee] dark:border-[#2c2c28]">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <h4 className="text-xs font-bold font-mono text-[#1c1c1a] dark:text-[#fbfbfa] uppercase tracking-wider">
                    1. Cấu Hình Quy Định Đi Trễ & Du Di Đầu Ca
                  </h4>
                </div>
                <span className="text-[10px] text-[#8c8c80] font-mono">Toàn hệ thống</span>
              </div>

              <form onSubmit={handleSaveShiftPolicy} className="space-y-4">
                {/* Grace periods */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5 bg-white dark:bg-[#121211] p-3 rounded-xl border border-[#e4e4db] dark:border-[#2c2c28]">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold font-mono text-[#1c1c1a] dark:text-[#fbfbfa] uppercase">
                        Du Di Đi Sớm
                      </label>
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 rounded">
                        Không phạt
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        min="0"
                        max="120"
                        value={shiftPolicy.earlyGraceMinutes}
                        onChange={(e) => setShiftPolicy(prev => ({ ...prev, earlyGraceMinutes: Math.max(0, parseInt(e.target.value) || 0) }))}
                        disabled={session?.role === 'manager'}
                        className="w-full bg-[#fbfbfa] dark:bg-[#1c1c1a] border border-[#c8c8c0] dark:border-[#2c2c28] px-3 py-1.5 rounded-lg text-sm font-mono text-[#1c1c1a] dark:text-white focus:outline-none"
                        required
                      />
                      <span className="text-xs text-[#5c5c54] dark:text-[#8c8c80] shrink-0 font-medium">phút</span>
                    </div>
                    <p className="text-[10px] text-[#8c8c80] leading-tight">
                      Nếu nhân viên đi sớm hơn ca làm thì không sao.
                    </p>
                  </div>

                  <div className="space-y-1.5 bg-white dark:bg-[#121211] p-3 rounded-xl border border-[#e4e4db] dark:border-[#2c2c28]">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold font-mono text-[#1c1c1a] dark:text-[#fbfbfa] uppercase">
                        Du Di Đi Trễ Đầu Ca *
                      </label>
                      <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded">
                        Miễn trừ phạt
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        min="0"
                        max="60"
                        value={shiftPolicy.lateGraceMinutes}
                        onChange={(e) => setShiftPolicy(prev => ({ ...prev, lateGraceMinutes: Math.max(0, parseInt(e.target.value) || 0) }))}
                        disabled={session?.role === 'manager'}
                        className="w-full bg-[#fbfbfa] dark:bg-[#1c1c1a] border border-[#c8c8c0] dark:border-[#2c2c28] px-3 py-1.5 rounded-lg text-sm font-mono font-bold text-[#1c1c1a] dark:text-white focus:outline-none"
                        required
                      />
                      <span className="text-xs text-[#5c5c54] dark:text-[#8c8c80] shrink-0 font-medium">phút</span>
                    </div>
                    <p className="text-[10px] text-[#8c8c80] leading-tight">
                      Đến trong hạn này không bị trừ tiền. Quá hạn sẽ trừ theo bậc.
                    </p>
                  </div>
                </div>

                {/* Progressive tiers */}
                <div className="space-y-2.5 bg-white dark:bg-[#121211] p-3.5 rounded-xl border border-[#e4e4db] dark:border-[#2c2c28]">
                  <p className="text-[11px] font-bold font-mono text-[#1c1c1a] dark:text-[#fbfbfa] uppercase">
                    Mức Phạt Lũy Tiến Theo Từng Bậc (Trừ Lương):
                  </p>

                  {/* Tier 1 */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-[#fbfbfa] dark:bg-[#1c1c1a] p-2.5 rounded-lg border border-[#f2f2ee] dark:border-[#2c2c28]">
                    <div className="sm:col-span-6">
                      <p className="text-xs font-bold text-[#1c1c1a] dark:text-white">Bậc 1: &le; 30 phút</p>
                      <p className="text-[10px] text-[#8c8c80]">Từ sau phút du di ({shiftPolicy.lateGraceMinutes}p) đến phút thứ 30</p>
                    </div>
                    <div className="sm:col-span-6 flex items-center space-x-1.5 justify-end">
                      <span className="text-xs text-[#5c5c54] dark:text-[#acaca0]">Trừ:</span>
                      <input
                        type="number"
                        min="0"
                        step="500"
                        value={shiftPolicy.tier1RatePerMinute}
                        onChange={(e) => setShiftPolicy(prev => ({ ...prev, tier1RatePerMinute: Math.max(0, parseInt(e.target.value) || 0) }))}
                        disabled={session?.role === 'manager'}
                        className="w-24 bg-white dark:bg-[#121211] border border-[#c8c8c0] dark:border-[#2c2c28] px-2 py-1 rounded text-xs font-mono font-bold text-amber-700 dark:text-amber-400 text-right focus:outline-none"
                      />
                      <span className="text-[11px] text-[#5c5c54] dark:text-[#acaca0] font-mono">đ/phút</span>
                    </div>
                  </div>

                  {/* Tier 2 */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-[#fbfbfa] dark:bg-[#1c1c1a] p-2.5 rounded-lg border border-[#f2f2ee] dark:border-[#2c2c28]">
                    <div className="sm:col-span-6">
                      <p className="text-xs font-bold text-[#1c1c1a] dark:text-white">Bậc 2: 31 - 60 phút</p>
                      <p className="text-[10px] text-[#8c8c80]">Từ phút thứ 31 đến 60 phút (dưới 1 tiếng)</p>
                    </div>
                    <div className="sm:col-span-6 flex items-center space-x-1.5 justify-end">
                      <span className="text-xs text-[#5c5c54] dark:text-[#acaca0]">Trừ:</span>
                      <input
                        type="number"
                        min="0"
                        step="500"
                        value={shiftPolicy.tier2RatePerMinute}
                        onChange={(e) => setShiftPolicy(prev => ({ ...prev, tier2RatePerMinute: Math.max(0, parseInt(e.target.value) || 0) }))}
                        disabled={session?.role === 'manager'}
                        className="w-24 bg-white dark:bg-[#121211] border border-[#c8c8c0] dark:border-[#2c2c28] px-2 py-1 rounded text-xs font-mono font-bold text-amber-700 dark:text-amber-400 text-right focus:outline-none"
                      />
                      <span className="text-[11px] text-[#5c5c54] dark:text-[#acaca0] font-mono">đ/phút</span>
                    </div>
                  </div>

                  {/* Tier 3 */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-[#fbfbfa] dark:bg-[#1c1c1a] p-2.5 rounded-lg border border-[#f2f2ee] dark:border-[#2c2c28]">
                    <div className="sm:col-span-6">
                      <p className="text-xs font-bold text-[#1c1c1a] dark:text-white">Bậc 3: &ge; 1 tiếng trở lên</p>
                      <p className="text-[10px] text-[#8c8c80]">Từ phút thứ 61 trở đi</p>
                    </div>
                    <div className="sm:col-span-6 flex items-center space-x-1.5 justify-end">
                      <span className="text-xs text-[#5c5c54] dark:text-[#acaca0]">Trừ:</span>
                      <input
                        type="number"
                        min="0"
                        step="500"
                        value={shiftPolicy.tier3RatePerMinute}
                        onChange={(e) => setShiftPolicy(prev => ({ ...prev, tier3RatePerMinute: Math.max(0, parseInt(e.target.value) || 0) }))}
                        disabled={session?.role === 'manager'}
                        className="w-24 bg-white dark:bg-[#121211] border border-[#c8c8c0] dark:border-[#2c2c28] px-2 py-1 rounded text-xs font-mono font-bold text-red-600 dark:text-red-400 text-right focus:outline-none"
                      />
                      <span className="text-[11px] text-[#5c5c54] dark:text-[#acaca0] font-mono">đ/phút</span>
                    </div>
                  </div>
                </div>

                {/* Example Explanatory Box */}
                <div className="p-3 bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/30 rounded-xl space-y-1.5 text-xs text-[#5c5c54] dark:text-[#acaca0]">
                  <p className="font-semibold text-amber-900 dark:text-amber-300 flex items-center gap-1.5 text-[11px] uppercase">
                    <span>💡 Logic tính mẫu chuẩn (Ca 10:00 sáng):</span>
                  </p>
                  <ul className="list-disc pl-4 space-y-1 text-[11px] leading-relaxed">
                    <li>Vào lúc <strong>10h10</strong> (&le; 10p du di): <strong className="text-emerald-700 dark:text-emerald-400">0đ (Không phạt)</strong>.</li>
                    <li>Vào lúc <strong>10h30</strong> (sau du di 10p, trễ 20p bậc 1): <strong className="text-amber-700 dark:text-amber-400">Trừ 20k</strong> (20p &times; 1k).</li>
                    <li>Vào lúc <strong>10h50</strong>: <strong className="text-amber-700 dark:text-amber-400">Trừ 20k + 40k = 60k</strong> (20p bậc 1 + 20p bậc 2).</li>
                    <li>Vào lúc <strong>11h20</strong>: <strong className="text-red-700 dark:text-red-400">Trừ 20k + 60k + 100k = 180k</strong> (20p bậc 1 + 30p bậc 2 + 20p bậc 3).</li>
                  </ul>
                </div>

                {session?.role !== 'manager' && (
                  <div className="flex gap-2.5 pt-1">
                    <button
                      type="submit"
                      disabled={savingShiftPolicy}
                      className="flex-1 bg-[#1c1c1a] hover:bg-black text-white py-2 rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer flex items-center justify-center space-x-1.5"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{savingShiftPolicy ? 'Đang lưu...' : 'Lưu Cấu Hình Quy Định Ca'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleResetShiftPolicy}
                      className="px-3.5 py-2 bg-white dark:bg-[#121211] hover:bg-gray-50 border border-[#c8c8c0] dark:border-[#2c2c28] text-[#5c5c54] dark:text-[#acaca0] rounded-xl text-xs font-semibold transition-all cursor-pointer"
                    >
                      Khôi phục chuẩn
                    </button>
                  </div>
                )}
              </form>
            </div>

            {/* Card 2: Interactive Simulator (Bộ Giả Lập & Kiểm Tra) */}
            <div className="lg:col-span-6 p-5 bg-[#fbfbfa] dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#f2f2ee] dark:border-[#2c2c28]">
                <div className="flex items-center space-x-2">
                  <Calculator className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <h4 className="text-xs font-bold font-mono text-[#1c1c1a] dark:text-[#fbfbfa] uppercase tracking-wider">
                    2. Bộ Thử Nghiệm & Mô Phỏng Phạt Đi Trễ
                  </h4>
                </div>
                <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-mono bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded-full font-bold">
                  Kiểm tra tức thì
                </span>
              </div>

              <div className="space-y-4">
                {/* Inputs for test */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold font-mono text-[#5c5c54] dark:text-[#acaca0] uppercase">
                      Giờ Bắt Đầu Ca Làm
                    </label>
                    <input
                      type="text"
                      value={simShiftStartTime}
                      onChange={(e) => setSimShiftStartTime(e.target.value)}
                      placeholder="10:00"
                      className="w-full bg-white dark:bg-[#121211] border border-[#c8c8c0] dark:border-[#2c2c28] px-3 py-1.5 rounded-lg text-sm font-mono font-bold text-[#1c1c1a] dark:text-white focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold font-mono text-[#5c5c54] dark:text-[#acaca0] uppercase">
                      Giờ Nhân Viên Đến Làm
                    </label>
                    <input
                      type="text"
                      value={simCheckInTime}
                      onChange={(e) => setSimCheckInTime(e.target.value)}
                      placeholder="10:30"
                      className="w-full bg-white dark:bg-[#121211] border border-[#c8c8c0] dark:border-[#2c2c28] px-3 py-1.5 rounded-lg text-sm font-mono font-bold text-[#1c1c1a] dark:text-white focus:outline-none"
                    />
                  </div>
                </div>

                {/* Quick preset buttons from prompt examples */}
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold font-mono text-[#8c8c80] uppercase">
                    Thử nhanh các tình huống thực tế:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => { setSimShiftStartTime('10:00'); setSimCheckInTime('09:45'); }}
                      className="px-2.5 py-1 text-[11px] font-mono rounded-lg bg-white dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] hover:border-emerald-500 hover:text-emerald-700 text-[#5c5c54] dark:text-[#acaca0] cursor-pointer transition-all"
                    >
                      09:45 (Đi sớm 15p)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSimShiftStartTime('10:00'); setSimCheckInTime('10:10'); }}
                      className="px-2.5 py-1 text-[11px] font-mono rounded-lg bg-white dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] hover:border-emerald-500 hover:text-emerald-700 text-[#5c5c54] dark:text-[#acaca0] cursor-pointer transition-all"
                    >
                      10:10 (Trong du di 10p)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSimShiftStartTime('10:00'); setSimCheckInTime('10:30'); }}
                      className="px-2.5 py-1 text-[11px] font-mono rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 text-amber-800 dark:text-amber-300 font-bold cursor-pointer transition-all"
                    >
                      10:30 (Trừ 20k)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSimShiftStartTime('10:00'); setSimCheckInTime('10:50'); }}
                      className="px-2.5 py-1 text-[11px] font-mono rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 text-amber-800 dark:text-amber-300 font-bold cursor-pointer transition-all"
                    >
                      10:50 (Trừ 20k + 40k)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSimShiftStartTime('10:00'); setSimCheckInTime('11:20'); }}
                      className="px-2.5 py-1 text-[11px] font-mono rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-800 dark:text-red-300 font-bold cursor-pointer transition-all"
                    >
                      11:20 (Trừ 20k+60k+100k)
                    </button>
                  </div>
                </div>

                {/* Live Simulation Calculation Output */}
                {(() => {
                  const result = calculateShiftLatePenalty(simCheckInTime, simShiftStartTime, shiftPolicy);

                  return (
                    <div className="bg-white dark:bg-[#121211] p-4 rounded-xl border border-[#e4e4db] dark:border-[#2c2c28] space-y-3">
                      <div className="flex items-center justify-between pb-2 border-b border-[#f2f2ee] dark:border-[#2c2c28]">
                        <span className="text-xs font-bold text-[#5c5c54] dark:text-[#acaca0] uppercase font-mono">
                          Kết quả mô phỏng:
                        </span>
                        {result.status === 'early' && (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                            Đi sớm {result.earlyMinutes} phút (Không phạt)
                          </span>
                        )}
                        {result.status === 'on_time' && (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                            Đúng giờ ca làm (0đ)
                          </span>
                        )}
                        {result.status === 'grace' && (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                            Trong hạn du di {shiftPolicy.lateGraceMinutes}p (0đ)
                          </span>
                        )}
                        {result.status === 'late' && (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300">
                            Đi trễ {result.lateMinutes} phút
                          </span>
                        )}
                      </div>

                      {/* Breakdown Cards */}
                      {result.breakdown.length > 0 ? (
                        <div className="space-y-1.5">
                          <p className="text-[10px] font-mono text-[#8c8c80] uppercase">Chi tiết các bậc trừ tiền:</p>
                          {result.breakdown.map((item, idx) => (
                            <div key={idx} className="flex items-center justify-between text-xs p-2 bg-[#fbfbfa] dark:bg-[#1c1c1a] rounded-lg border border-[#f2f2ee] dark:border-[#2c2c28]">
                              <div>
                                <span className="font-bold text-[#1c1c1a] dark:text-white">{item.tierName}</span>
                                <span className="text-[10px] text-[#8c8c80] ml-2 font-mono">({item.range})</span>
                              </div>
                              <span className="font-mono font-bold text-amber-700 dark:text-amber-400">
                                {item.label}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-3 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          {result.summaryText}
                        </div>
                      )}

                      {/* Total Penalty Box */}
                      <div className="p-3 bg-amber-50/50 dark:bg-amber-950/30 rounded-xl border border-amber-200/80 dark:border-amber-900/40 flex items-center justify-between">
                        <div>
                          <p className="text-[10px] uppercase font-mono font-bold text-[#5c5c54] dark:text-[#acaca0]">
                            Công thức & Tổng khấu trừ
                          </p>
                          <p className="text-xs font-mono font-bold text-[#1c1c1a] dark:text-white mt-0.5">
                            {result.formulaString}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className={`text-lg font-mono font-bold ${result.totalPenalty > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                            {result.totalPenalty > 0 ? `-${formatVND(result.totalPenalty)}` : '0 đ'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Section 2: Shifts List & Shift Creation/Edit */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
            {/* Add / Edit Shift Form */}
            {session?.role !== 'manager' && (
              <div className="lg:col-span-5 p-5 bg-[#fbfbfa] dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl h-fit space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-[#f2f2ee] dark:border-[#2c2c28]">
                  <h3 className="text-xs font-bold font-mono text-[#5c5c54] dark:text-[#acaca0] uppercase tracking-wider">
                    {editingShiftId ? 'Cập Nhật Ca Làm Việc' : 'Tạo Ca Làm Việc Mới'}
                  </h3>
                  {editingShiftId && (
                    <span className="text-[10px] font-mono px-2 py-0.5 bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 rounded font-bold">
                      Đang sửa: {editingShiftId}
                    </span>
                  )}
                </div>

                <form onSubmit={handleSaveShift} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold font-mono text-[#5c5c54] dark:text-[#acaca0] uppercase">Mã Ca Làm Việc *</label>
                    <input
                      type="text"
                      placeholder="Ví dụ: CA-10H, CA-SANG"
                      value={shiftId}
                      onChange={(e) => setShiftId(e.target.value)}
                      disabled={!!editingShiftId}
                      className="w-full bg-white dark:bg-[#121211] border border-[#c8c8c0] dark:border-[#2c2c28] px-3 py-2 rounded-xl text-sm focus:outline-none disabled:bg-[#f2f2ee] dark:disabled:bg-[#2c2c28] disabled:text-[#8c8c80] text-[#1c1c1a] dark:text-white"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold font-mono text-[#5c5c54] dark:text-[#acaca0] uppercase">Tên Ca Làm Việc *</label>
                    <input
                      type="text"
                      placeholder="Ví dụ: Ca Sáng (10h - 18h)"
                      value={shiftName}
                      onChange={(e) => setShiftName(e.target.value)}
                      className="w-full bg-white dark:bg-[#121211] border border-[#c8c8c0] dark:border-[#2c2c28] px-3 py-2 rounded-xl text-sm focus:outline-none text-[#1c1c1a] dark:text-white"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold font-mono text-[#5c5c54] dark:text-[#acaca0] uppercase">Giờ Vào Ca *</label>
                      <input
                        type="text"
                        placeholder="10:00"
                        value={shiftStartTime}
                        onChange={(e) => setShiftStartTime(e.target.value)}
                        className="w-full bg-white dark:bg-[#121211] border border-[#c8c8c0] dark:border-[#2c2c28] px-3 py-2 rounded-xl text-sm font-mono focus:outline-none text-[#1c1c1a] dark:text-white"
                        required
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold font-mono text-[#5c5c54] dark:text-[#acaca0] uppercase">Giờ Kết Ca *</label>
                      <input
                        type="text"
                        placeholder="18:00"
                        value={shiftEndTime}
                        onChange={(e) => setShiftEndTime(e.target.value)}
                        className="w-full bg-white dark:bg-[#121211] border border-[#c8c8c0] dark:border-[#2c2c28] px-3 py-2 rounded-xl text-sm font-mono focus:outline-none text-[#1c1c1a] dark:text-white"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold font-mono text-[#5c5c54] dark:text-[#acaca0] uppercase">Hệ Số Lương *</label>
                    <select
                      value={shiftMultiplier}
                      onChange={(e) => setShiftMultiplier(Number(e.target.value))}
                      className="w-full bg-white dark:bg-[#121211] border border-[#c8c8c0] dark:border-[#2c2c28] px-3 py-2 rounded-xl text-sm focus:outline-none cursor-pointer text-[#1c1c1a] dark:text-white"
                    >
                      <option value="1.0">1.0 (Bình thường)</option>
                      <option value="1.5">1.5 (Tăng ca)</option>
                      <option value="2.0">2.0 (Chủ nhật)</option>
                      <option value="3.0">3.0 (Ngày Lễ)</option>
                      <option value="0.5">0.5 (Thử việc)</option>
                    </select>
                  </div>

                  {/* Toggle Custom Grace & Penalty for this shift */}
                  <div className="pt-2 border-t border-[#f2f2ee] dark:border-[#2c2c28] space-y-3">
                    <label className="flex items-center space-x-2 text-xs font-semibold text-[#1c1c1a] dark:text-[#fbfbfa] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={shiftCustomGrace}
                        onChange={(e) => setShiftCustomGrace(e.target.checked)}
                        className="rounded accent-amber-600 cursor-pointer"
                      />
                      <span>Tùy chỉnh quy định đi trễ & du di riêng cho ca này</span>
                    </label>

                    {shiftCustomGrace ? (
                      <div className="p-3 bg-white dark:bg-[#121211] rounded-xl border border-amber-200 dark:border-amber-900/40 space-y-3 animate-in fade-in duration-200">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <label className="text-[10px] font-mono text-[#8c8c80]">Du di sớm (phút)</label>
                            <input
                              type="number"
                              min="0"
                              value={shiftEarlyGrace}
                              onChange={(e) => setShiftEarlyGrace(parseInt(e.target.value) || 0)}
                              className="w-full bg-[#fbfbfa] dark:bg-[#1c1c1a] border border-[#c8c8c0] dark:border-[#2c2c28] px-2 py-1 rounded text-xs font-mono"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-mono text-[#8c8c80]">Du di trễ (phút)</label>
                            <input
                              type="number"
                              min="0"
                              value={shiftLateGrace}
                              onChange={(e) => setShiftLateGrace(parseInt(e.target.value) || 0)}
                              className="w-full bg-[#fbfbfa] dark:bg-[#1c1c1a] border border-[#c8c8c0] dark:border-[#2c2c28] px-2 py-1 rounded text-xs font-mono font-bold text-amber-700"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <label className="text-[9px] font-mono text-[#8c8c80]">&le;30p (đ/p)</label>
                            <input
                              type="number"
                              min="0"
                              step="500"
                              value={shiftLateRate1}
                              onChange={(e) => setShiftLateRate1(parseInt(e.target.value) || 0)}
                              className="w-full bg-[#fbfbfa] dark:bg-[#1c1c1a] border border-[#c8c8c0] dark:border-[#2c2c28] px-2 py-1 rounded text-xs font-mono font-bold"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] font-mono text-[#8c8c80]">31-60p (đ/p)</label>
                            <input
                              type="number"
                              min="0"
                              step="500"
                              value={shiftLateRate2}
                              onChange={(e) => setShiftLateRate2(parseInt(e.target.value) || 0)}
                              className="w-full bg-[#fbfbfa] dark:bg-[#1c1c1a] border border-[#c8c8c0] dark:border-[#2c2c28] px-2 py-1 rounded text-xs font-mono font-bold"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] font-mono text-[#8c8c80]">&ge;1h (đ/p)</label>
                            <input
                              type="number"
                              min="0"
                              step="500"
                              value={shiftLateRate3}
                              onChange={(e) => setShiftLateRate3(parseInt(e.target.value) || 0)}
                              className="w-full bg-[#fbfbfa] dark:bg-[#1c1c1a] border border-[#c8c8c0] dark:border-[#2c2c28] px-2 py-1 rounded text-xs font-mono font-bold text-red-600"
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[10px] text-[#8c8c80] italic">
                        Đang kế thừa quy định chung: Du di {shiftPolicy.lateGraceMinutes} phút, phạt {formatCompactVND(shiftPolicy.tier1RatePerMinute)}/{formatCompactVND(shiftPolicy.tier2RatePerMinute)}/{formatCompactVND(shiftPolicy.tier3RatePerMinute)}.
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2.5 pt-2">
                    <button
                      type="submit"
                      className="flex-1 bg-[#1c1c1a] hover:bg-black text-white py-2 rounded-xl text-xs font-semibold shadow-xs hover:shadow-md transition-all cursor-pointer flex items-center justify-center space-x-1.5"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{editingShiftId ? 'Cập nhật' : 'Tạo ca'}</span>
                    </button>
                    {editingShiftId && (
                      <button
                        type="button"
                        onClick={handleCancelEditShift}
                        className="flex-1 bg-white hover:bg-gray-50 border border-[#c8c8c0] text-[#1c1c1a] py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer"
                      >
                        Hủy bỏ
                      </button>
                    )}
                  </div>
                </form>
              </div>
            )}

            {/* Shift List Panel */}
            <div className={`${session?.role === 'manager' ? 'lg:col-span-12' : 'lg:col-span-7'} space-y-4`}>
              <div className="flex items-center justify-between pb-2 border-b border-[#f2f2ee] dark:border-[#2c2c28]">
                <h3 className="text-xs font-semibold font-mono text-[#5c5c54] dark:text-[#acaca0] uppercase tracking-wider">
                  Danh Sách Ca Làm Việc Trong Hệ Thống ({shifts.length})
                </h3>
                <span className="text-[10px] text-[#8c8c80] font-mono">Bấm &quot;Thử tính phạt&quot; để nạp vào bộ giả lập</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {shifts.length === 0 ? (
                  <div className="sm:col-span-2 text-center py-12 text-[#8c8c80] font-medium bg-white dark:bg-[#1c1c1a] border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl">
                    Chưa có ca làm việc nào được định nghĩa.
                  </div>
                ) : (
                  shifts.map((shift) => {
                    const shiftGrace = shift.lateGraceMinutes ?? shiftPolicy.lateGraceMinutes;
                    const r1 = shift.lateRate1 ?? shiftPolicy.tier1RatePerMinute;
                    const r2 = shift.lateRate2 ?? shiftPolicy.tier2RatePerMinute;
                    const r3 = shift.lateRate3 ?? shiftPolicy.tier3RatePerMinute;

                    return (
                      <div key={shift.id} className="bg-white dark:bg-[#1c1c1a] border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl p-4 flex flex-col justify-between hover:shadow-xs transition-shadow space-y-3">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold font-mono text-[#8c8c80] uppercase bg-[#f2f2ee] dark:bg-[#2c2c28] px-2 py-0.5 rounded-md">
                              {shift.id}
                            </span>
                            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                              Hệ số: x{shift.multiplier}
                            </span>
                          </div>

                          <h4 className="text-sm font-bold text-[#1c1c1a] dark:text-white">{shift.name}</h4>

                          <div className="text-xs font-mono text-[#5c5c54] dark:text-[#acaca0] space-y-1 bg-[#fbfbfa] dark:bg-[#121211] p-2.5 rounded-xl border border-[#f2f2ee] dark:border-[#2c2c28]">
                            <p className="flex justify-between">
                              <span>Khung giờ:</span>
                              <strong className="text-[#1c1c1a] dark:text-white">{shift.startTime} → {shift.endTime}</strong>
                            </p>
                            <p className="flex justify-between">
                              <span>Du di đầu ca:</span>
                              <span className="font-bold text-amber-700 dark:text-amber-400">{shiftGrace} phút</span>
                            </p>
                            <p className="flex justify-between">
                              <span>Mức phạt trễ:</span>
                              <span className="font-bold text-red-600 dark:text-red-400">
                                {formatCompactVND(r1)} / {formatCompactVND(r2)} / {formatCompactVND(r3)}
                              </span>
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-[#f2f2ee] dark:border-[#2c2c28]">
                          <button
                            type="button"
                            onClick={() => {
                              setSimShiftStartTime(shift.startTime);
                              // Calculate a sample 30 mins late arrival
                              const [h, m] = shift.startTime.split(':').map(Number);
                              const targetM = (m + 30) % 60;
                              const targetH = (h + Math.floor((m + 30) / 60)) % 24;
                              const targetStr = `${String(targetH).padStart(2, '0')}:${String(targetM).padStart(2, '0')}`;
                              setSimCheckInTime(targetStr);
                              playClick();
                              window.scrollTo({ top: 300, behavior: 'smooth' });
                            }}
                            className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 flex items-center space-x-1 cursor-pointer"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            <span>Thử tính phạt</span>
                          </button>

                          {session?.role !== 'manager' && (
                            <div className="flex items-center space-x-1">
                              <button
                                onClick={() => handleStartEditShift(shift)}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-all cursor-pointer"
                                title="Sửa ca làm việc"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleRemoveShift(shift.id, shift.name)}
                                className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-all cursor-pointer"
                                title="Xóa ca làm việc"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5.2 LATE PENALTY MASTER SETUP TAB */}
      {activeTab === 'late-settings' && (
        <div className="space-y-6">
          {/* Header announcement */}
          <div className="bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] p-5 rounded-2xl shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start space-x-3">
                <div className="p-2.5 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 rounded-xl border border-amber-100 dark:border-amber-900/30 shrink-0">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#1c1c1a] dark:text-[#fbfbfa] uppercase tracking-wider">
                    Thiết Lập Khấu Trừ Đi Trễ & Thời Gian Áp Dụng
                  </h3>
                  <p className="text-xs text-[#5c5c54] dark:text-[#acaca0] mt-0.5">
                    Quản lý thời gian áp dụng khấu trừ trong năm, công tắc bật/tắt toàn bộ nhân viên hoặc từng nhân viên, và định mức phạt lũy tiến.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center space-x-1.5 px-3 py-1 border rounded-full text-xs font-semibold ${
                  lateSettings.globalEnabled
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-gray-100 text-gray-600 border-gray-200'
                }`}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Trạng thái toàn bộ: {lateSettings.globalEnabled ? 'Đang BẬT' : 'Đang TẮT (Miễn trừ)'}</span>
                </span>
                <span className="inline-flex items-center space-x-1 px-3 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-full text-xs font-semibold">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>
                    {lateSettings.periodMode === 'all' && 'Áp dụng: Quanh năm'}
                    {lateSettings.periodMode === 'specific_month' && `Áp dụng: Tháng ${lateSettings.specificMonth || '(chưa chọn)'}`}
                    {lateSettings.periodMode === 'date_range' && `Áp dụng: ${lateSettings.rangeStartMonth || '—'} đến ${lateSettings.rangeEndMonth || '—'}`}
                  </span>
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* CARD 1: Cấu hình thời gian áp dụng & Bật/Tắt toàn bộ */}
            <div className="lg:col-span-6 p-5 bg-[#fbfbfa] dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-[#f2f2ee] dark:border-[#2c2c28]">
                <div className="flex items-center space-x-2">
                  <Calendar className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <h4 className="text-xs font-bold font-mono text-[#1c1c1a] dark:text-[#fbfbfa] uppercase tracking-wider">
                    1. Thời Gian Áp Dụng Khấu Trừ Đi Trễ
                  </h4>
                </div>
                <span className="text-[10px] text-[#8c8c80] font-mono">Cấu hình thời gian</span>
              </div>

              {/* Global toggle button switch */}
              <div className="p-3.5 bg-white dark:bg-[#121211] rounded-xl border border-[#e4e4db] dark:border-[#2c2c28] flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-[#1c1c1a] dark:text-white">Khấu trừ đi trễ TOÀN BỘ nhân viên</p>
                  <p className="text-[11px] text-[#8c8c80]">Bật để áp dụng khấu trừ, hoặc tắt để miễn trừ toàn công ty</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleGlobalLate(!lateSettings.globalEnabled)}
                  className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    lateSettings.globalEnabled
                      ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-500 border border-gray-300'
                  }`}
                >
                  {lateSettings.globalEnabled ? (
                    <>
                      <ToggleRight className="w-4 h-4 text-emerald-600" />
                      <span>ĐANG BẬT</span>
                    </>
                  ) : (
                    <>
                      <ToggleLeft className="w-4 h-4 text-gray-400" />
                      <span>ĐANG TẮT</span>
                    </>
                  )}
                </button>
              </div>

              {/* Period Mode Selector */}
              <div className="space-y-3">
                <label className="block text-xs font-bold font-mono text-[#5c5c54] dark:text-[#acaca0] uppercase">
                  Chọn Khoảng Thời Gian Áp Dụng Trong Năm:
                </label>

                {/* Mode 1: All Year */}
                <div
                  onClick={() => handleSaveLateSettings({ periodMode: 'all' })}
                  className={`flex items-start space-x-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                    lateSettings.periodMode === 'all'
                      ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700 text-[#1c1c1a] dark:text-white'
                      : 'bg-white dark:bg-[#121211] border-[#e4e4db] dark:border-[#2c2c28] text-[#5c5c54] hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="periodMode"
                    checked={lateSettings.periodMode === 'all'}
                    onChange={() => handleSaveLateSettings({ periodMode: 'all' })}
                    className="mt-0.5 accent-amber-600 cursor-pointer"
                  />
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold">Áp dụng quanh năm (Tất cả các tháng)</p>
                    <p className="text-[11px] text-[#8c8c80]">Khấu trừ đi trễ được áp dụng cho mọi tháng trong năm theo cấu hình nhân viên.</p>
                  </div>
                </div>

                {/* Mode 2: Specific Month */}
                <div
                  className={`p-3.5 rounded-xl border transition-all ${
                    lateSettings.periodMode === 'specific_month'
                      ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700'
                      : 'bg-white dark:bg-[#121211] border-[#e4e4db] dark:border-[#2c2c28]'
                  }`}
                >
                  <label
                    onClick={() => handleSaveLateSettings({ periodMode: 'specific_month', specificMonth: lateSettings.specificMonth || getCurrentMonthStr() })}
                    className="flex items-start space-x-3 cursor-pointer mb-2.5"
                  >
                    <input
                      type="radio"
                      name="periodMode"
                      checked={lateSettings.periodMode === 'specific_month'}
                      onChange={() => handleSaveLateSettings({ periodMode: 'specific_month', specificMonth: lateSettings.specificMonth || getCurrentMonthStr() })}
                      className="mt-0.5 accent-amber-600 cursor-pointer"
                    />
                    <div className="space-y-0.5">
                      <p className="text-xs font-bold text-[#1c1c1a] dark:text-white">Áp dụng tháng cụ thể trong năm</p>
                      <p className="text-[11px] text-[#8c8c80]">Chỉ áp dụng khấu trừ đi trễ cho một tháng được chỉ định trong năm.</p>
                    </div>
                  </label>

                  {lateSettings.periodMode === 'specific_month' && (
                    <div className="pl-6 pt-1 flex items-center space-x-3">
                      <label className="text-xs font-semibold text-[#5c5c54]">Chọn tháng áp dụng:</label>
                      <input
                        type="month"
                        value={lateSettings.specificMonth || getCurrentMonthStr()}
                        onChange={(e) => handleSaveLateSettings({ specificMonth: e.target.value })}
                        className="bg-white border border-[#c8c8c0] px-3 py-1.5 rounded-lg text-xs font-semibold text-[#1c1c1a] focus:outline-none"
                      />
                    </div>
                  )}
                </div>

                {/* Mode 3: Date Range across months/years */}
                <div
                  className={`p-3.5 rounded-xl border transition-all ${
                    lateSettings.periodMode === 'date_range'
                      ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700'
                      : 'bg-white dark:bg-[#121211] border-[#e4e4db] dark:border-[#2c2c28]'
                  }`}
                >
                  <label
                    onClick={() => handleSaveLateSettings({
                      periodMode: 'date_range',
                      rangeStartMonth: lateSettings.rangeStartMonth || getCurrentMonthStr(),
                      rangeEndMonth: lateSettings.rangeEndMonth || getCurrentMonthStr()
                    })}
                    className="flex items-start space-x-3 cursor-pointer mb-2.5"
                  >
                    <input
                      type="radio"
                      name="periodMode"
                      checked={lateSettings.periodMode === 'date_range'}
                      onChange={() => handleSaveLateSettings({
                        periodMode: 'date_range',
                        rangeStartMonth: lateSettings.rangeStartMonth || getCurrentMonthStr(),
                        rangeEndMonth: lateSettings.rangeEndMonth || getCurrentMonthStr()
                      })}
                      className="mt-0.5 accent-amber-600 cursor-pointer"
                    />
                    <div className="space-y-0.5">
                      <p className="text-xs font-bold text-[#1c1c1a] dark:text-white">
                        Áp dụng trong khoảng thời gian từ tháng mấy của năm này đến tháng mấy của năm sau
                      </p>
                      <p className="text-[11px] text-[#8c8c80]">
                        Ví dụ: Từ tháng 09/2026 đến tháng 03/2027. Các tháng nằm ngoài khoảng này sẽ tự động được miễn trừ.
                      </p>
                    </div>
                  </label>

                  {lateSettings.periodMode === 'date_range' && (
                    <div className="pl-6 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-[#5c5c54] mb-1">Từ tháng / năm *</label>
                        <input
                          type="month"
                          value={lateSettings.rangeStartMonth || getCurrentMonthStr()}
                          onChange={(e) => handleSaveLateSettings({ rangeStartMonth: e.target.value })}
                          className="w-full bg-white border border-[#c8c8c0] px-3 py-1.5 rounded-lg text-xs font-semibold text-[#1c1c1a] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-[#5c5c54] mb-1">Đến tháng / năm *</label>
                        <input
                          type="month"
                          value={lateSettings.rangeEndMonth || getCurrentMonthStr()}
                          onChange={(e) => handleSaveLateSettings({ rangeEndMonth: e.target.value })}
                          className="w-full bg-white border border-[#c8c8c0] px-3 py-1.5 rounded-lg text-xs font-semibold text-[#1c1c1a] focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Explanatory Info Box */}
              <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-[11px] text-[#5c5c54] space-y-1">
                <p className="font-bold text-amber-900 flex items-center gap-1.5">
                  <span>ℹ️ Nguyên tắc hoạt động:</span>
                </p>
                <p className="leading-relaxed">
                  Khi đến tháng không thuộc phạm vi cài đặt ở trên, hệ thống sẽ tự động <strong>MIỄN TRỪ 0đ</strong> cho tất cả nhân sự. Cột thống kê, phiếu lương và lịch sử chi tiết sẽ hiển thị rõ trạng thái miễn trừ đi trễ.
                </p>
              </div>
            </div>

            {/* CARD 2: Quản lý bật/tắt khấu trừ cho từng nhân viên */}
            <div className="lg:col-span-6 p-5 bg-[#fbfbfa] dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#f2f2ee] dark:border-[#2c2c28]">
                <div className="flex items-center space-x-2">
                  <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <h4 className="text-xs font-bold font-mono text-[#1c1c1a] dark:text-[#fbfbfa] uppercase tracking-wider">
                    2. Bật / Tắt Khấu Trừ Cho Từng Nhân Viên ({employees.length})
                  </h4>
                </div>
                <span className="text-[10px] text-[#8c8c80] font-mono">Tùy biến riêng</span>
              </div>

              <p className="text-xs text-[#5c5c54] leading-relaxed">
                Quản trị viên có thể bật hoặc tắt khấu trừ đi trễ riêng biệt cho từng người. Bấm công tắc bên dưới để áp dụng hoặc miễn trừ:
              </p>

              <div className="border border-[#e4e4db] rounded-xl overflow-hidden bg-white max-h-[420px] overflow-y-auto">
                <table className="w-full text-left text-xs text-[#1c1c1a]">
                  <thead className="text-[10px] font-mono text-[#5c5c54] bg-[#fbfbfa] uppercase border-b border-[#e4e4db] sticky top-0 z-10">
                    <tr>
                      <th className="px-3.5 py-2.5">Mã NV</th>
                      <th className="px-3.5 py-2.5">Họ và Tên</th>
                      <th className="px-3.5 py-2.5">Ca Mặc Định</th>
                      <th className="px-3.5 py-2.5 text-right">Khấu Trừ Đi Trễ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f2f2ee]">
                    {employees.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-[#8c8c80]">
                          Chưa có nhân viên nào trong hệ thống.
                        </td>
                      </tr>
                    ) : (
                      employees.map((emp) => {
                        const isExempt = (lateSettings.disabledEmployeeIds || []).includes(emp.id);
                        const isApplicable = lateSettings.globalEnabled && !isExempt;

                        return (
                          <tr key={emp.id} className="hover:bg-[#fbfbfa] transition-colors">
                            <td className="px-3.5 py-3 font-mono font-bold text-[#5c5c54]">{emp.id}</td>
                            <td className="px-3.5 py-3">
                              <p className="font-semibold text-[#1c1c1a]">{emp.name}</p>
                              <p className="text-[10px] text-[#8c8c80]">{emp.role}</p>
                            </td>
                            <td className="px-3.5 py-3 font-mono text-[11px] text-[#5c5c54]">
                              {emp.shiftStartTime || '10:00'} → {emp.shiftEndTime || '23:00'}
                            </td>
                            <td className="px-3.5 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleToggleEmployeeLate(emp.id, isApplicable)}
                                className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer transition-all ${
                                  isApplicable
                                    ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'
                                }`}
                                title={isApplicable ? 'Bấm để TẮT khấu trừ trễ cho nhân sự này' : 'Bấm để BẬT khấu trừ trễ cho nhân sự này'}
                              >
                                {isApplicable ? (
                                  <>
                                    <ToggleRight className="w-3.5 h-3.5 text-rose-600" />
                                    <span>Đang BẬT (Trừ phạt)</span>
                                  </>
                                ) : (
                                  <>
                                    <ToggleLeft className="w-3.5 h-3.5 text-emerald-600" />
                                    <span>ĐANG TẮT (Miễn trừ)</span>
                                  </>
                                )}
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* CARD 3: Cấu hình quy định du di & thang bậc phạt */}
            <div className="lg:col-span-6 p-5 bg-[#fbfbfa] dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#f2f2ee] dark:border-[#2c2c28]">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <h4 className="text-xs font-bold font-mono text-[#1c1c1a] dark:text-[#fbfbfa] uppercase tracking-wider">
                    3. Quy Định Du Di & Thang Bậc Phạt Lũy Tiến
                  </h4>
                </div>
                <span className="text-[10px] text-[#8c8c80] font-mono">Mức trừ lương</span>
              </div>

              <form onSubmit={handleSaveShiftPolicy} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5 bg-white p-3 rounded-xl border border-[#e4e4db]">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold font-mono text-[#1c1c1a] uppercase">Du Di Đi Sớm</label>
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">Không phạt</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        min="0"
                        max="120"
                        value={shiftPolicy.earlyGraceMinutes}
                        onChange={(e) => setShiftPolicy(prev => ({ ...prev, earlyGraceMinutes: Math.max(0, parseInt(e.target.value) || 0) }))}
                        className="w-full bg-[#fbfbfa] border border-[#c8c8c0] px-3 py-1.5 rounded-lg text-sm font-mono text-[#1c1c1a] focus:outline-none"
                        required
                      />
                      <span className="text-xs text-[#5c5c54] shrink-0 font-medium">phút</span>
                    </div>
                  </div>

                  <div className="space-y-1.5 bg-white p-3 rounded-xl border border-[#e4e4db]">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold font-mono text-[#1c1c1a] uppercase">Du Di Đi Trễ Đầu Ca *</label>
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Miễn trừ phạt</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        min="0"
                        max="60"
                        value={shiftPolicy.lateGraceMinutes}
                        onChange={(e) => setShiftPolicy(prev => ({ ...prev, lateGraceMinutes: Math.max(0, parseInt(e.target.value) || 0) }))}
                        className="w-full bg-[#fbfbfa] border border-[#c8c8c0] px-3 py-1.5 rounded-lg text-sm font-mono font-bold text-[#1c1c1a] focus:outline-none"
                        required
                      />
                      <span className="text-xs text-[#5c5c54] shrink-0 font-medium">phút</span>
                    </div>
                  </div>
                </div>

                {/* Progressive tiers */}
                <div className="space-y-2.5 bg-white p-3.5 rounded-xl border border-[#e4e4db]">
                  <p className="text-[11px] font-bold font-mono text-[#1c1c1a] uppercase">Mức Phạt Lũy Tiến Theo Từng Bậc (Trừ Lương):</p>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-[#fbfbfa] p-2.5 rounded-lg border border-[#f2f2ee]">
                    <div className="sm:col-span-6">
                      <p className="text-xs font-bold text-[#1c1c1a]">Bậc 1: &le; 30 phút</p>
                      <p className="text-[10px] text-[#8c8c80]">Từ sau phút du di ({shiftPolicy.lateGraceMinutes}p) đến phút thứ 30</p>
                    </div>
                    <div className="sm:col-span-6 flex items-center space-x-1.5 justify-end">
                      <span className="text-xs text-[#5c5c54]">Trừ:</span>
                      <input
                        type="number"
                        min="0"
                        step="500"
                        value={shiftPolicy.tier1RatePerMinute}
                        onChange={(e) => setShiftPolicy(prev => ({ ...prev, tier1RatePerMinute: Math.max(0, parseInt(e.target.value) || 0) }))}
                        className="w-24 bg-white border border-[#c8c8c0] px-2 py-1 rounded text-xs font-mono font-bold text-amber-700 text-right focus:outline-none"
                      />
                      <span className="text-[11px] text-[#5c5c54] font-mono">đ/phút</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-[#fbfbfa] p-2.5 rounded-lg border border-[#f2f2ee]">
                    <div className="sm:col-span-6">
                      <p className="text-xs font-bold text-[#1c1c1a]">Bậc 2: 31 - 60 phút</p>
                      <p className="text-[10px] text-[#8c8c80]">Từ phút thứ 31 đến 60 phút (dưới 1 tiếng)</p>
                    </div>
                    <div className="sm:col-span-6 flex items-center space-x-1.5 justify-end">
                      <span className="text-xs text-[#5c5c54]">Trừ:</span>
                      <input
                        type="number"
                        min="0"
                        step="500"
                        value={shiftPolicy.tier2RatePerMinute}
                        onChange={(e) => setShiftPolicy(prev => ({ ...prev, tier2RatePerMinute: Math.max(0, parseInt(e.target.value) || 0) }))}
                        className="w-24 bg-white border border-[#c8c8c0] px-2 py-1 rounded text-xs font-mono font-bold text-amber-700 text-right focus:outline-none"
                      />
                      <span className="text-[11px] text-[#5c5c54] font-mono">đ/phút</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-[#fbfbfa] p-2.5 rounded-lg border border-[#f2f2ee]">
                    <div className="sm:col-span-6">
                      <p className="text-xs font-bold text-[#1c1c1a]">Bậc 3: &ge; 1 tiếng trở lên</p>
                      <p className="text-[10px] text-[#8c8c80]">Từ phút thứ 61 trở đi</p>
                    </div>
                    <div className="sm:col-span-6 flex items-center space-x-1.5 justify-end">
                      <span className="text-xs text-[#5c5c54]">Trừ:</span>
                      <input
                        type="number"
                        min="0"
                        step="500"
                        value={shiftPolicy.tier3RatePerMinute}
                        onChange={(e) => setShiftPolicy(prev => ({ ...prev, tier3RatePerMinute: Math.max(0, parseInt(e.target.value) || 0) }))}
                        className="w-24 bg-white border border-[#c8c8c0] px-2 py-1 rounded text-xs font-mono font-bold text-red-600 text-right focus:outline-none"
                      />
                      <span className="text-[11px] text-[#5c5c54] font-mono">đ/phút</span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2.5 pt-1">
                  <button
                    type="submit"
                    disabled={savingShiftPolicy}
                    className="flex-1 bg-[#1c1c1a] hover:bg-black text-white py-2 rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer flex items-center justify-center space-x-1.5"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{savingShiftPolicy ? 'Đang lưu...' : 'Lưu Cấu Hình Khấu Trừ Trễ'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleResetShiftPolicy}
                    className="px-3.5 py-2 bg-white hover:bg-gray-50 border border-[#c8c8c0] text-[#5c5c54] rounded-xl text-xs font-semibold transition-all cursor-pointer"
                  >
                    Khôi phục chuẩn
                  </button>
                </div>
              </form>
            </div>

            {/* CARD 4: Bộ thử nghiệm & Mô phỏng phạt đi trễ */}
            <div className="lg:col-span-6 p-5 bg-[#fbfbfa] dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#f2f2ee] dark:border-[#2c2c28]">
                <div className="flex items-center space-x-2">
                  <Calculator className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <h4 className="text-xs font-bold font-mono text-[#1c1c1a] dark:text-[#fbfbfa] uppercase tracking-wider">
                    4. Bộ Thử Nghiệm & Mô Phỏng Phạt Đi Trễ
                  </h4>
                </div>
                <span className="text-[10px] text-emerald-700 font-mono bg-emerald-50 px-2 py-0.5 rounded-full font-bold">Kiểm tra tức thì</span>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold font-mono text-[#5c5c54] uppercase">Giờ Bắt Đầu Ca Làm</label>
                    <input
                      type="text"
                      value={simShiftStartTime}
                      onChange={(e) => setSimShiftStartTime(e.target.value)}
                      placeholder="10:00"
                      className="w-full bg-white border border-[#c8c8c0] px-3 py-1.5 rounded-lg text-sm font-mono font-bold text-[#1c1c1a] focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold font-mono text-[#5c5c54] uppercase">Giờ Nhân Viên Đến Làm</label>
                    <input
                      type="text"
                      value={simCheckInTime}
                      onChange={(e) => setSimCheckInTime(e.target.value)}
                      placeholder="10:30"
                      className="w-full bg-white border border-[#c8c8c0] px-3 py-1.5 rounded-lg text-sm font-mono font-bold text-[#1c1c1a] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold font-mono text-[#8c8c80] uppercase">Thử nhanh các tình huống thực tế:</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => { setSimShiftStartTime('10:00'); setSimCheckInTime('09:45'); }}
                      className="px-2.5 py-1 text-[11px] font-mono rounded-lg bg-white border border-[#e4e4db] hover:border-emerald-500 hover:text-emerald-700 text-[#5c5c54] cursor-pointer transition-all"
                    >
                      Đi sớm 15p (0đ)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSimShiftStartTime('10:00'); setSimCheckInTime('10:08'); }}
                      className="px-2.5 py-1 text-[11px] font-mono rounded-lg bg-white border border-[#e4e4db] hover:border-amber-500 hover:text-amber-700 text-[#5c5c54] cursor-pointer transition-all"
                    >
                      Du di 8p (0đ)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSimShiftStartTime('10:00'); setSimCheckInTime('10:30'); }}
                      className="px-2.5 py-1 text-[11px] font-mono rounded-lg bg-white border border-[#e4e4db] hover:border-amber-500 hover:text-amber-700 text-[#5c5c54] cursor-pointer transition-all"
                    >
                      Trễ 30p (-20k)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSimShiftStartTime('10:00'); setSimCheckInTime('10:50'); }}
                      className="px-2.5 py-1 text-[11px] font-mono rounded-lg bg-white border border-[#e4e4db] hover:border-amber-500 hover:text-amber-700 text-[#5c5c54] cursor-pointer transition-all"
                    >
                      Trễ 50p (-60k)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSimShiftStartTime('10:00'); setSimCheckInTime('11:20'); }}
                      className="px-2.5 py-1 text-[11px] font-mono rounded-lg bg-white border border-[#e4e4db] hover:border-red-500 hover:text-red-700 text-[#5c5c54] cursor-pointer transition-all"
                    >
                      Trễ 1h20p (-180k)
                    </button>
                  </div>
                </div>

                {/* Calculation simulation result card */}
                {(() => {
                  const simResult = calculateShiftLatePenalty(simCheckInTime, simShiftStartTime, shiftPolicy);
                  return (
                    <div className="p-4 bg-white border border-[#e4e4db] rounded-xl space-y-3 shadow-xs">
                      <div className="flex items-center justify-between pb-2 border-b border-[#f2f2ee]">
                        <span className="text-xs font-semibold text-[#5c5c54]">Kết quả tính toán:</span>
                        <span className={`text-xs font-bold font-mono px-2.5 py-0.5 rounded-full ${
                          simResult.totalPenalty > 0
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : (simResult.status === 'grace' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200')
                        }`}>
                          {simResult.totalPenalty > 0 ? `Trừ ${formatVND(simResult.totalPenalty)}` : 'Không trừ lương (0đ)'}
                        </span>
                      </div>

                      <div className="text-xs space-y-1.5 font-mono">
                        <p className="text-[#1c1c1a]">
                          Trạng thái: <strong>{simResult.summaryText}</strong>
                        </p>
                        {simResult.breakdown.length > 0 && (
                          <div className="pt-1 space-y-1">
                            <p className="text-[11px] text-[#8c8c80] uppercase font-bold">Chi tiết công thức lũy tiến:</p>
                            {simResult.breakdown.map((item, idx) => (
                              <div key={idx} className="flex justify-between text-[11px] text-[#5c5c54] bg-[#fbfbfa] p-1.5 rounded">
                                <span>{item.tierName}:</span>
                                <span className="font-bold text-amber-700">{item.label}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* 6. ACTIVITIES LOG TAB */}
      {activeTab === 'activities' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold font-mono text-[#8c8c80] uppercase tracking-wider">Nhật ký hoạt động hệ thống</h3>
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={handleResetDatabaseToDefaults}
                className="text-xs text-blue-600 hover:underline font-semibold cursor-pointer"
              >
                Khôi phục dữ liệu mặc định từ code
              </button>
              <span className="text-gray-300 text-xs">|</span>
              <button
                type="button"
                onClick={() => {
                  showConfirm(
                    'Xóa lịch sử nhật ký',
                    'Bạn có chắc chắn muốn xóa sạch toàn bộ lịch sử nhật ký hoạt động không?',
                    async () => {
                      try {
                        await Promise.all(activities.map(act => deleteDoc(doc(db, 'activities', act.id))));
                        addLog('Xóa nhật ký', 'Quản trị viên xóa toàn bộ dữ liệu log lịch sử');
                      } catch (error) {
                        showAlert('Lỗi', `Không thể xóa nhật ký: ${error}`);
                      }
                    }
                  );
                }}
                className="text-xs text-red-600 hover:underline font-semibold cursor-pointer"
              >
                Xóa lịch sử
              </button>
            </div>
          </div>

          <div className="border border-[#e4e4db] rounded-xl overflow-hidden bg-white max-h-[500px] overflow-y-auto divide-y divide-[#f2f2ee]">
            {activities.length === 0 ? (
              <p className="text-sm text-[#8c8c80] text-center py-12 font-medium">Chưa có hoạt động nào được lưu trữ.</p>
            ) : (
              activities.map((act) => (
                <div key={act.id} className="p-4 hover:bg-[#fbfbfa] transition-colors flex items-start space-x-3 text-xs">
                  <span className="font-mono text-[#8c8c80] shrink-0 mt-0.5">{act.timestamp}</span>
                  <div className="space-y-0.5">
                    <p className="font-semibold text-[#1c1c1a]">{act.action}</p>
                    <p className="text-[#5c5c54]">{act.details}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 7. ANALYTICS DASHBOARD TAB */}
      {activeTab === 'analytics' && (
        <AnalyticsDashboard
          employees={employees}
          attendance={attendance}
          adjustments={adjustments}
          shifts={shifts}
          dismissedAutoBonuses={Object.keys(dismissedAutoBonuses).map(id => ({ id }))}
          selectedMonth={selectedMonth}
        />
      )}

      {/* 8. DATA MIGRATION IMPORT EXPORT TAB */}
      {activeTab === 'migration' && (
        <DataMigration
          employees={employees}
          attendance={attendance}
          adjustments={adjustments}
          shifts={shifts}
          selectedMonth={selectedMonth}
          onRefresh={() => {
            addLog('Đồng bộ tệp', 'Dữ liệu được đồng bộ thành công qua trung tâm nhập tệp tin');
          }}
        />
      )}

      {/* 9. GPS SETTINGS TAB */}
      {activeTab === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 p-5 bg-[#fbfbfa] dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl h-fit space-y-4">
            <h3 className="text-xs font-semibold font-mono text-[#5c5c54] dark:text-[#acaca0] uppercase tracking-wider pb-2 border-b border-[#f2f2ee] dark:border-[#2c2c28] flex items-center gap-2">
              <MapPin className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Cấu hình tọa độ chấm công</span>
            </h3>
            
            <form onSubmit={handleSaveGpsSettings} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold font-mono text-[#5c5c54] dark:text-[#acaca0] uppercase">Tên Vị Trí / Cửa Hàng *</label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: Cửa hàng trà sữa Serene HCMC"
                  value={gpsName}
                  onChange={(e) => setGpsName(e.target.value)}
                  className="w-full bg-white dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] text-[#1c1c1a] dark:text-[#f5f5f0] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold font-mono text-[#5c5c54] dark:text-[#acaca0] uppercase">Vĩ độ (Latitude) *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ví dụ: 10.762622"
                    value={gpsLat}
                    onChange={(e) => setGpsLat(e.target.value)}
                    className="w-full bg-white dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] text-[#1c1c1a] dark:text-[#f5f5f0] rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold font-mono text-[#5c5c54] dark:text-[#acaca0] uppercase">Kinh độ (Longitude) *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ví dụ: 106.660172"
                    value={gpsLng}
                    onChange={(e) => setGpsLng(e.target.value)}
                    className="w-full bg-white dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] text-[#1c1c1a] dark:text-[#f5f5f0] rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold font-mono text-[#5c5c54] dark:text-[#acaca0] uppercase flex justify-between">
                  <span>Bán kính cho phép chấm công (Mét) *</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">{gpsRadius}m</span>
                </label>
                <input
                  type="range"
                  min="20"
                  max="1000"
                  step="10"
                  value={gpsRadius}
                  onChange={(e) => setGpsRadius(parseInt(e.target.value))}
                  className="w-full accent-emerald-600 dark:accent-emerald-400 bg-gray-200 dark:bg-[#2c2c28] rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#8c8c80] font-mono">
                  <span>20m (Cực kỳ chính xác)</span>
                  <span>500m</span>
                  <span>1000m (Khuyên dùng ~150m)</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleGetCurrentLocation}
                  disabled={gpsLoading}
                  className="flex-1 bg-[#1c1c1a] dark:bg-[#2c2c28] hover:bg-black dark:hover:bg-[#3c3c38] text-white px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors flex items-center justify-center gap-2 border border-transparent dark:border-[#4c4c48]"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${gpsLoading ? 'animate-spin' : ''}`} />
                  <span>{gpsLoading ? 'Đang lấy tọa độ...' : 'Lấy vị trí hiện tại'}</span>
                </button>
                <button
                  type="submit"
                  disabled={gpsSaving}
                  className="flex-1 bg-[#15803d] hover:bg-[#166534] text-white px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors flex items-center justify-center gap-2"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{gpsSaving ? 'Đang lưu cài đặt...' : 'Lưu cấu hình GPS'}</span>
                </button>
              </div>
            </form>
          </div>

          <div className="lg:col-span-5 p-5 bg-[#fbfbfa] dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl space-y-4">
            <h3 className="text-xs font-semibold font-mono text-[#5c5c54] dark:text-[#acaca0] uppercase tracking-wider pb-2 border-b border-[#f2f2ee] dark:border-[#2c2c28]">
              Hướng dẫn & Trạng thái hoạt động
            </h3>
            
            <div className="space-y-3.5 text-xs text-[#5c5c54] dark:text-[#acaca0] leading-relaxed">
              <p>
                Hệ thống chấm công nhanh <strong>Serene GPS & QR</strong> so sánh tọa độ GPS thực của thiết bị nhân viên với tọa độ cấu hình ở bên trái.
              </p>

              <div className="p-3 bg-[#f2f2ee] dark:bg-[#121211] rounded-xl border border-[#e4e4db] dark:border-[#2c2c28]">
                <h4 className="font-semibold text-[#1c1c1a] dark:text-white mb-1">Cơ chế hoạt động:</h4>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Xác minh khoảng cách thực qua công thức <strong>Haversine</strong>.</li>
                  <li>Nếu khoảng cách ≤ <strong>{gpsRadius}m</strong>, cho phép chấm công.</li>
                  <li>Đồng bộ tức thời trên tất cả điện thoại nhân viên khi lưu.</li>
                </ul>
              </div>

              {gpsLat && gpsLng && (
                <div className="pt-2">
                  <a
                    href={`https://www.google.com/maps?q=${gpsLat},${gpsLng}`}
                    target="_blank"
                    rel="noreferrer referrer"
                    className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:underline font-semibold"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    Xem vị trí này trên Google Maps ↗
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Alert Modal */}
      {alertModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white border border-[#e4e4db] rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#f2f2ee]">
              <h3 className="text-sm font-bold text-[#1c1c1a]">{alertModal.title}</h3>
            </div>
            <p className="text-sm text-[#5c5c54] whitespace-pre-line leading-relaxed">{alertModal.message}</p>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
                className="bg-[#1c1c1a] hover:bg-black text-white px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white border border-[#e4e4db] rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#f2f2ee]">
              <h3 className="text-sm font-bold text-[#1c1c1a]">{confirmModal.title}</h3>
            </div>
            <p className="text-sm text-[#5c5c54] whitespace-pre-line leading-relaxed">{confirmModal.message}</p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="bg-white hover:bg-gray-50 border border-[#c8c8c0] text-[#1c1c1a] px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmModal(prev => ({ ...prev, isOpen: false }));
                  confirmModal.onConfirm();
                }}
                className="bg-[#1c1c1a] hover:bg-black text-white px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
              >
                Xác nhận
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Employee History Modal */}
      {viewingHistoryEmployee && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white border border-[#e4e4db] rounded-2xl max-w-5xl w-full p-6 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden space-y-4 animate-in fade-in duration-200">
            
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#f2f2ee] pb-4 gap-4">
              <div className="flex items-start space-x-3">
                <div className="p-2 bg-blue-50 text-blue-700 rounded-xl mt-1">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] uppercase font-mono tracking-widest text-[#8c8c80] font-semibold">Lịch sử chi tiết nhân sự</span>
                  <h3 className="text-base font-bold text-[#1c1c1a] tracking-tight">
                    {viewingHistoryEmployee.name} <span className="font-mono text-xs font-semibold text-gray-400">({viewingHistoryEmployee.id})</span>
                  </h3>
                  <p className="text-xs text-[#8c8c80] font-mono mt-0.5">Chức vụ: {viewingHistoryEmployee.role} • Đơn giá: {formatVND(viewingHistoryEmployee.hourlyRate)}/giờ</p>
                </div>
              </div>

              {/* Month Switcher, Late Penalty Toggle & Close button */}
              <div className="flex flex-wrap items-center gap-3 self-end sm:self-auto">
                <div className="flex items-center space-x-2">
                  <label htmlFor="history-month" className="text-xs font-semibold font-mono text-[#5c5c54] uppercase">Chọn tháng:</label>
                  <input
                    id="history-month"
                    type="month"
                    value={historySelectedMonth}
                    onChange={(e) => setHistorySelectedMonth(e.target.value)}
                    className="bg-white border border-[#c8c8c0] px-3 py-1.5 rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:ring-1 focus:ring-[#1c1c1a]"
                  />
                </div>

                {/* Per-employee late deduction toggle button */}
                <div className="flex items-center space-x-2 bg-gray-50 border border-[#e4e4db] px-2.5 py-1.5 rounded-lg">
                  <span className="text-[11px] font-semibold text-[#5c5c54]">Khấu trừ đi trễ:</span>
                  <button
                    type="button"
                    onClick={() => handleToggleEmployeeLate(viewingHistoryEmployee.id, modalStats.isPenaltyApplicable)}
                    className={`inline-flex items-center space-x-1.5 px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition-all ${
                      modalStats.isPenaltyApplicable
                        ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                        : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'
                    }`}
                    title={modalStats.isPenaltyApplicable ? 'Bấm để TẮT khấu trừ trễ cho nhân sự này' : 'Bấm để BẬT khấu trừ trễ cho nhân sự này'}
                  >
                    {modalStats.isPenaltyApplicable ? (
                      <>
                        <ToggleRight className="w-3.5 h-3.5 text-rose-600" />
                        <span>Đang BẬT</span>
                      </>
                    ) : (
                      <>
                        <ToggleLeft className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Đang TẮT (Miễn trừ)</span>
                      </>
                    )}
                  </button>
                </div>

                <button
                  onClick={() => setViewingHistoryEmployee(null)}
                  className="p-1.5 hover:bg-gray-100 rounded-xl text-gray-500 hover:text-gray-700 transition-colors cursor-pointer"
                  title="Đóng cửa sổ"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Quick stats for selected month */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 bg-gray-50/50 p-3 border border-[#f2f2ee] rounded-xl">
              <div className="p-2 bg-white border border-[#e4e4db] rounded-lg text-center sm:text-left">
                <p className="text-[10px] font-mono text-[#8c8c80] uppercase">Tổng giờ làm</p>
                <p className="text-sm font-bold text-[#1c1c1a] font-mono mt-0.5">{modalStats.totalHours} giờ</p>
              </div>
              <div className="p-2 bg-white border border-[#e4e4db] rounded-lg text-center sm:text-left">
                <p className="text-[10px] font-mono text-amber-700 uppercase">Thời gian đi trễ</p>
                <p className="text-sm font-bold text-amber-700 font-mono mt-0.5">{formatLateMinutes(modalStats.totalLateMinutes)}</p>
                <p className="text-[9px] text-[#8c8c80] font-mono mt-0.5">
                  {modalStats.lateCount} lần trễ • {modalStats.isPenaltyApplicable ? `-${formatCompactVND(modalStats.totalLatePenalties)}` : <span className="text-emerald-600 font-semibold">0đ (Miễn trừ)</span>}
                </p>
              </div>
              <div className="p-2 bg-white border border-[#e4e4db] rounded-lg text-center sm:text-left">
                <p className="text-[10px] font-mono text-[#8c8c80] uppercase">Lương giờ cơ bản</p>
                <p className="text-sm font-bold text-[#1c1c1a] font-mono mt-0.5">{formatVND(modalStats.baseEarned)}</p>
              </div>
              <div className="p-2 bg-white border border-[#e4e4db] rounded-lg text-center sm:text-left">
                <p className="text-[10px] font-mono text-blue-700 uppercase">Khen thưởng tháng</p>
                <p className="text-sm font-bold text-blue-700 font-mono mt-0.5">+{formatVND(modalStats.totalBonuses)}</p>
              </div>
              <div className="p-2 bg-white border border-[#e4e4db] rounded-lg text-center sm:text-left">
                <p className="text-[10px] font-mono text-amber-700 uppercase">Khấu trừ tháng</p>
                <p className="text-sm font-bold text-amber-700 font-mono mt-0.5">-{formatVND(modalStats.totalDeductions)}</p>
              </div>
            </div>

            {/* Attendance Bonus Status Banner */}
            {(() => {
              const daysInMonth = getDaysInMonth(historySelectedMonth);
              const reqDays = daysInMonth === 30 ? 28 : (daysInMonth === 31 ? 29 : daysInMonth - 2);
              const count = modalStats.workingDaysCount;
              const qualifies = count >= reqDays;

              return (
                <div className={`p-3 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs font-medium ${
                  qualifies 
                    ? 'bg-emerald-50 border-emerald-100 text-emerald-800' 
                    : 'bg-[#fbfbfa] border-[#e4e4db] text-[#5c5c54]'
                }`}>
                  <div className="flex items-center space-x-2">
                    <Crown className={`w-4 h-4 shrink-0 ${qualifies ? 'text-amber-500 fill-amber-400' : 'text-gray-400'}`} />
                    <span>
                      Chuyên cần tháng {historySelectedMonth}: <strong className="font-mono">{count}/{daysInMonth}</strong> ngày công (Yêu cầu &ge; {reqDays} ngày để nhận thưởng 2 ngày công).
                    </span>
                  </div>
                  <div>
                    {qualifies ? (
                      <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                        Đạt thưởng: +{formatVND(modalStats.attendanceBonusAmount)}
                      </span>
                    ) : (
                      <span className="bg-gray-100 text-gray-600 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                        Còn thiếu {reqDays - count} ngày công
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Scrollable Table of detailed attendance */}
            <div className="flex-1 overflow-y-auto border border-[#e4e4db] rounded-xl bg-white">
              <table className="w-full text-left text-sm text-[#1c1c1a] relative">
                <thead className="text-[10px] font-mono text-[#5c5c54] bg-[#fbfbfa] uppercase border-b border-[#e4e4db] sticky top-0 z-10 shadow-xs">
                  <tr>
                    <th className="px-4 py-2.5">Ngày</th>
                    <th className="px-4 py-2.5 text-center">Tổng giờ</th>
                    <th className="px-4 py-2.5 text-center">Giờ trong ca</th>
                    <th className="px-4 py-2.5">Lương trong ca</th>
                    <th className="px-4 py-2.5 text-center">Giờ tăng ca</th>
                    <th className="px-4 py-2.5">Lương tăng ca</th>
                    <th className="px-4 py-2.5">Khoảng giờ (Vào - Ra)</th>
                    <th className="px-4 py-2.5">Trạng thái</th>
                    <th className="px-4 py-2.5">Hệ số</th>
                    <th className="px-4 py-2.5">Khen thưởng</th>
                    <th className="px-4 py-2.5">Khấu trừ</th>
                    <th className="px-4 py-2.5">Ghi chú</th>
                    {session?.role !== 'manager' && <th className="px-4 py-2.5 text-center">Sửa</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f2f2ee]">
                  {modalEmpAttendance.length === 0 ? (
                    <tr>
                      <td colSpan={session?.role === 'manager' ? 12 : 13} className="px-4 py-12 text-center text-[#8c8c80] font-medium">
                        Không có lịch sử chấm công nào được lưu trữ cho tháng {historySelectedMonth}
                      </td>
                    </tr>
                  ) : (
                    modalEmpAttendance.sort((a,b)=>a.date.localeCompare(b.date)).map((log) => {
                      const dailyBonuses = modalEmpAdjustments.filter(adj => adj.date === log.date && adj.type === 'bonus');
                      const dailyPenalties = modalEmpAdjustments.filter(adj => adj.date === log.date && adj.type === 'penalty');
                      const details = getDailyAttendanceDetails(log, viewingHistoryEmployee);
                      const isEditing = editingLogId === log.id;

                      return (
                        <tr key={log.id} className="hover:bg-[#fbfbfa] transition-colors">
                          <td className="px-4 py-2.5 font-mono font-medium text-xs whitespace-nowrap">{log.date}</td>
                          
                          <td className="px-4 py-2.5 font-mono text-xs font-semibold text-center whitespace-nowrap">
                            {isEditing ? (
                              <input
                                type="number"
                                step="0.1"
                                value={editLogHours}
                                onChange={(e) => setEditLogHours(Number(e.target.value))}
                                className="border border-[#c8c8c0] px-1.5 py-1 rounded text-xs focus:outline-none w-16 font-mono text-center"
                              />
                            ) : (
                              `${details.totalHours} giờ`
                            )}
                          </td>

                          <td className="px-4 py-2.5 font-mono text-xs text-center whitespace-nowrap text-[#5c5c54]">
                            {isEditing ? (
                              <span className="text-[10px] text-gray-400 font-sans italic">Tự tính</span>
                            ) : (
                              `${details.regularHours}h`
                            )}
                          </td>

                          <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-[#5c5c54]">
                            {isEditing ? (
                              <span className="text-[10px] text-gray-400 font-sans italic">Tự tính</span>
                            ) : (
                              formatVND(details.regularSalary)
                            )}
                          </td>

                          <td className="px-4 py-2.5 font-mono text-xs text-center whitespace-nowrap text-amber-700">
                            {isEditing ? (
                              <span className="text-[10px] text-gray-400 font-sans italic">Tự tính</span>
                            ) : (
                              `${details.overtimeHours}h`
                            )}
                          </td>

                          <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-amber-700 font-medium">
                            {isEditing ? (
                              <span className="text-[10px] text-gray-400 font-sans italic">Tự tính</span>
                            ) : (
                              formatVND(details.overtimeSalary)
                            )}
                          </td>

                          <td className="px-4 py-2.5 font-mono text-xs text-[#5c5c54] whitespace-nowrap">
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="time"
                                  value={editLogInTime}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setEditLogInTime(v);
                                    handleAutoCalculateHours(v, editLogOutTime);
                                  }}
                                  className="border border-[#c8c8c0] px-1 py-0.5 rounded text-[11px] focus:outline-none w-16 font-mono"
                                />
                                <span>→</span>
                                <input
                                  type="time"
                                  value={editLogOutTime}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setEditLogOutTime(v);
                                    handleAutoCalculateHours(editLogInTime, v);
                                  }}
                                  className="border border-[#c8c8c0] px-1 py-0.5 rounded text-[11px] focus:outline-none w-16 font-mono"
                                />
                              </div>
                            ) : (
                              log.inTime || log.outTime ? (
                                <span className="bg-[#f2f2ee] px-2 py-0.5 rounded text-[#1c1c1a] font-medium">
                                  {log.inTime || '—'} → {log.outTime || '—'}
                                </span>
                              ) : '—'
                            )}
                          </td>

                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {isEditing ? (
                              <select
                                value={editLogStatus}
                                onChange={(e) => setEditLogStatus(e.target.value as any)}
                                className="border border-[#c8c8c0] px-1 py-0.5 rounded text-xs focus:outline-none w-20 bg-white"
                              >
                                <option value="present">Đủ công</option>
                                <option value="late">Trễ giờ</option>
                                <option value="absent">Vắng mặt</option>
                              </select>
                            ) : (
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                log.status === 'present' ? 'bg-emerald-50 text-emerald-700' : (log.status === 'late' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700')
                              }`}>
                                {log.status === 'present' ? 'Đủ công' : (log.status === 'late' ? 'Trễ' : 'Vắng')}
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {isEditing ? (
                              <select
                                value={editLogMultiplier}
                                onChange={(e) => setEditLogMultiplier(Number(e.target.value))}
                                className="border border-[#c8c8c0] px-1 py-0.5 rounded text-[11px] focus:outline-none w-16 bg-white font-mono"
                              >
                                <option value="0.5">0.5x</option>
                                <option value="1.0">1.0x</option>
                                <option value="1.5">1.5x</option>
                                <option value="2.0">2.0x</option>
                              </select>
                            ) : (
                              <span className={`inline-block text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                                log.rateMultiplier === 1.5 ? 'bg-blue-50 text-blue-700' : (log.rateMultiplier === 0.5 ? 'bg-amber-50 text-amber-700' : 'bg-[#fbfbfa] text-[#5c5c54]')
                              }`}>
                                {log.rateMultiplier}x
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-2.5 text-xs text-blue-600 font-mono font-semibold whitespace-nowrap">
                            {dailyBonuses.length > 0 ? (
                              <div className="space-y-0.5">
                                {dailyBonuses.map(b => (
                                  <div key={b.id} title={b.reason}>
                                    +{formatVND(b.amount)} <span className="text-[10px] text-gray-400 font-sans">({b.reason})</span>
                                  </div>
                                ))}
                              </div>
                            ) : '—'}
                          </td>

                          <td className="px-4 py-2.5 text-xs text-amber-600 font-mono font-semibold whitespace-nowrap">
                            {(() => {
                              const hasLateAdj = dailyPenalties.some(p => p.id.startsWith('adj-late-'));
                              const isLatePenOn = modalStats.isPenaltyApplicable;
                              const showUnrecordedLate = details.latePenalty > 0 && !hasLateAdj;
                              if (dailyPenalties.length === 0 && !showUnrecordedLate) return '—';
                              return (
                                <div className="space-y-0.5">
                                  {dailyPenalties.map(p => {
                                    const isLateItem = p.id.startsWith('adj-late-');
                                    if (isLateItem && !isLatePenOn) {
                                      return (
                                        <div key={p.id} title={p.reason} className="text-emerald-600">
                                          0đ <span className="text-[10px] text-emerald-600 font-sans font-medium">({p.reason} - Miễn trừ)</span>
                                        </div>
                                      );
                                    }
                                    return (
                                      <div key={p.id} title={p.reason}>
                                        -{formatVND(p.amount)} <span className="text-[10px] text-gray-400 font-sans">({p.reason})</span>
                                      </div>
                                    );
                                  })}
                                  {showUnrecordedLate && (
                                    isLatePenOn ? (
                                      <div title={`Đi trễ ${details.lateMinutes} phút`}>
                                        -{formatVND(details.latePenalty)} <span className="text-[10px] text-rose-500 font-sans font-medium">(Trừ trễ {details.lateMinutes}p)</span>
                                      </div>
                                    ) : (
                                      <div title={`Đi trễ ${details.lateMinutes} phút - Đã tắt khấu trừ`}>
                                        <span className="text-emerald-600 font-medium">0đ</span> <span className="text-[10px] text-emerald-600 font-sans font-medium">(Miễn trừ {details.lateMinutes}p)</span>
                                      </div>
                                    )
                                  )}
                                </div>
                              );
                            })()}
                          </td>

                          <td className="px-4 py-2.5 text-xs text-[#5c5c54] font-medium max-w-[200px] truncate" title={log.notes}>
                            {isEditing ? (
                              <input
                                type="text"
                                value={editLogNotes}
                                onChange={(e) => setEditLogNotes(e.target.value)}
                                className="border border-[#c8c8c0] px-1.5 py-0.5 rounded text-xs focus:outline-none w-full min-w-[100px]"
                                placeholder="Ghi chú..."
                              />
                            ) : (
                              log.notes || '—'
                            )}
                          </td>

                          {session?.role !== 'manager' && (
                            <td className="px-4 py-2.5 text-center whitespace-nowrap">
                              {isEditing ? (
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEditedLog(log.id, log.date)}
                                    className="p-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg transition-colors cursor-pointer"
                                    title="Lưu ngày công"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingLogId(null)}
                                    className="p-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors cursor-pointer"
                                    title="Hủy"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingLogId(log.id);
                                    setEditLogInTime(log.inTime || '');
                                    setEditLogOutTime(log.outTime || '');
                                    setEditLogHours(log.hoursWorked || 0);
                                    setEditLogMultiplier(log.rateMultiplier || 1.0);
                                    setEditLogNotes(log.notes || '');
                                    setEditLogStatus(log.status || 'present');
                                  }}
                                  className="p-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition-colors cursor-pointer"
                                  title="Chỉnh sửa công ngày này"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Monthly adjustments list */}
            <div className="space-y-2">
              <h4 className="text-[11px] font-bold font-mono text-[#8c8c80] uppercase">Danh sách thưởng / phạt trong tháng</h4>
              <div className="border border-[#e4e4db] rounded-xl p-3 bg-[#fbfbfa] max-h-[120px] overflow-y-auto">
                {modalEmpAdjustments.length === 0 ? (
                  <p className="text-xs text-[#8c8c80] text-center py-2 font-medium">Không có khoản thưởng phạt phát sinh trong tháng.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {modalEmpAdjustments.map((adj) => (
                      <div key={adj.id} className="p-2 bg-white border border-[#e4e4db] rounded-lg flex items-center justify-between text-xs">
                        <div className="truncate pr-2">
                          <p className="font-semibold text-[#1c1c1a] truncate" title={adj.reason}>{adj.reason}</p>
                          <p className="text-[10px] text-[#8c8c80] font-mono">{adj.date}</p>
                        </div>
                        <div className="flex items-center space-x-2 shrink-0">
                          <span className={`font-bold ${adj.type === 'bonus' ? 'text-blue-600' : 'text-amber-600'}`}>
                            {adj.type === 'bonus' ? '+' : '-'}{formatVND(adj.amount)}
                          </span>
                          {session?.role !== 'manager' && (
                            <div className="flex items-center space-x-0.5">
                              <button
                                type="button"
                                onClick={() => handleStartEditFromModal(adj)}
                                className="p-1 text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                title="Chỉnh sửa ghi nhận này"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveAdjustment(adj.id, viewingHistoryEmployee.name, adj.amount, adj.type)}
                                className="p-1 text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                title="Hủy bỏ ghi nhận này"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer / Total Net Pay */}
            <div className="border-t border-[#f2f2ee] pt-4 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <span className="text-[11px] font-mono text-[#8c8c80] uppercase">Thực lĩnh cuối tháng {historySelectedMonth}:</span>
                <span className="text-lg font-bold text-emerald-700 font-mono ml-2">{formatVND(modalStats.finalSalary)}</span>
              </div>
              <button
                type="button"
                onClick={() => setViewingHistoryEmployee(null)}
                className="w-full sm:w-auto bg-[#1c1c1a] hover:bg-black text-white px-5 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors text-center"
              >
                Đóng
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
