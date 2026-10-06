export interface Employee {
  id: string; // e.g., EMP001
  name: string;
  role: string;
  hourlyRate: number; // in VND
  createdAt: string;
  shiftStartTime?: string;      // e.g. "18:00"
  shiftEndTime?: string;        // e.g. "01:00"
  overtimeStart?: string;       // e.g. "01:00"
  overtimeMultiplier?: number;  // e.g. 1.5
  overtimeHourlyRate?: number;  // e.g. 27000
  password?: string;
  syncPassword?: string;
}

export interface AttendanceLog {
  id: string;
  employeeId: string;
  date: string; // YYYY-MM-DD
  hoursWorked: number;
  status: 'present' | 'late' | 'absent';
  notes?: string;
  rateMultiplier: number; // 0.5 for tv, 0.0 for off, 1.5 for ot, 1.0 for normal
  inTime?: string;
  outTime?: string;
  regularHours?: number;
  overtimeHours?: number;
  regularSalary?: number;
  overtimeSalary?: number;
  shiftId?: string;
  lateMinutes?: number;
  latePenalty?: number;
}

export interface PayrollAdjustment {
  id: string;
  employeeId: string;
  date: string; // YYYY-MM-DD
  amount: number; // in VND
  type: 'bonus' | 'penalty';
  reason: string;
}

export interface UserSession {
  role: 'admin' | 'manager' | 'employee';
  employeeId?: string; // If role is employee
}

export interface ShiftLatePolicy {
  earlyGraceMinutes: number; // e.g. 10 (du di đi sớm)
  lateGraceMinutes: number;  // e.g. 10 (du di đi trễ)
  tier1ThresholdMinutes: number; // 30
  tier1RatePerMinute: number;    // 1000
  tier2ThresholdMinutes: number; // 60
  tier2RatePerMinute: number;    // 2000
  tier3RatePerMinute: number;    // 5000
}

export type LatePenaltyPeriodMode = 'all' | 'specific_month' | 'date_range';

export interface LateDeductionSettings extends ShiftLatePolicy {
  periodMode: LatePenaltyPeriodMode;
  specificMonth?: string;     // YYYY-MM e.g. "2026-10"
  rangeStartMonth?: string;   // YYYY-MM e.g. "2026-09"
  rangeEndMonth?: string;     // YYYY-MM e.g. "2027-03"
  globalEnabled: boolean;     // Bật/tắt khấu trừ đi trễ toàn bộ nhân viên
  disabledEmployeeIds?: string[]; // Danh sách mã nhân viên bị tắt khấu trừ đi trễ
}

export interface Shift {
  id: string; // e.g., SHIFT01
  name: string; // e.g., Ca Sáng
  startTime: string; // e.g. "15:00"
  endTime: string; // e.g. "01:00"
  multiplier: number; // e.g., 1.0
  earlyGraceMinutes?: number; // Tùy chỉnh du di đi sớm (phút)
  lateGraceMinutes?: number;  // Tùy chỉnh du di đi trễ (phút)
  lateRate1?: number; // Phạt Bậc 1 (VND/phút)
  lateRate2?: number; // Phạt Bậc 2 (VND/phút)
  lateRate3?: number; // Phạt Bậc 3 (VND/phút)
}


export interface ActivityLog {
  id: string;
  timestamp: string;
  action: string;
  details: string;
}

export interface GratitudeMessage {
  id: string;
  senderId: string;
  senderName: string;
  receiverName: string;
  message: string;
  createdAt: string;
}

