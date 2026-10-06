import { LateDeductionSettings } from '../types';

export interface ShiftLatePolicy {
  earlyGraceMinutes: number; // Du di đi sớm (phút) - mặc định 10p, đi sớm không bị phạt
  lateGraceMinutes: number;  // Du di đi trễ đầu ca (phút) - mặc định 10p
  tier1ThresholdMinutes: number; // Mốc Bậc 1: <= 30 phút
  tier1RatePerMinute: number;    // Phạt Bậc 1: 1.000đ/phút
  tier2ThresholdMinutes: number; // Mốc Bậc 2: 31 - 60 phút (dưới 1 tiếng)
  tier2RatePerMinute: number;    // Phạt Bậc 2: 2.000đ/phút
  tier3RatePerMinute: number;    // Phạt Bậc 3: 1 tiếng trở lên (5.000đ/phút)
}

export const DEFAULT_SHIFT_POLICY: ShiftLatePolicy = {
  earlyGraceMinutes: 10,
  lateGraceMinutes: 10,
  tier1ThresholdMinutes: 30,
  tier1RatePerMinute: 1000,
  tier2ThresholdMinutes: 60,
  tier2RatePerMinute: 2000,
  tier3RatePerMinute: 5000,
};

export const DEFAULT_LATE_SETTINGS: LateDeductionSettings = {
  ...DEFAULT_SHIFT_POLICY,
  periodMode: 'all',
  specificMonth: '',
  rangeStartMonth: '',
  rangeEndMonth: '',
  globalEnabled: true,
  disabledEmployeeIds: []
};

/**
 * Checks whether late penalties should be deducted for a given month and employee,
 * taking into account:
 * 1. Global toggle
 * 2. Per-employee toggle
 * 3. Configured period mode (all / specific month / month range from year X to year Y)
 */
export function isLatePenaltyApplicable(
  monthStr: string, // YYYY-MM
  empId: string,
  settings: LateDeductionSettings
): boolean {
  if (!settings.globalEnabled) return false;
  if (settings.disabledEmployeeIds && settings.disabledEmployeeIds.includes(empId)) {
    return false;
  }
  if (settings.periodMode === 'specific_month') {
    if (settings.specificMonth && monthStr !== settings.specificMonth) {
      return false;
    }
  } else if (settings.periodMode === 'date_range') {
    if (settings.rangeStartMonth && monthStr < settings.rangeStartMonth) {
      return false;
    }
    if (settings.rangeEndMonth && monthStr > settings.rangeEndMonth) {
      return false;
    }
  }
  return true;
}

export interface PenaltyBreakdownItem {
  tierName: string;
  range: string;
  minutes: number;
  ratePerMinute: number;
  amount: number;
  label: string;
}

export interface ShiftLateResult {
  isEarly: boolean;
  earlyMinutes: number;
  isWithinGrace: boolean;
  lateMinutes: number;
  totalPenalty: number;
  breakdown: PenaltyBreakdownItem[];
  formulaString: string;
  summaryText: string;
  status: 'early' | 'on_time' | 'grace' | 'late';
}

/**
 * Calculates the difference in minutes between checkInTime and shiftStartTime.
 * Returns > 0 if late, < 0 if early, 0 if exact.
 */
export function getMinutesDifference(checkInTime: string, shiftStartTime: string): number {
  if (!checkInTime || !shiftStartTime) return 0;
  const inParts = checkInTime.split(':');
  const startParts = shiftStartTime.split(':');

  const inH = parseInt(inParts[0], 10);
  const inM = inParts[1] ? parseInt(inParts[1], 10) : 0;
  const startH = parseInt(startParts[0], 10);
  const startM = startParts[1] ? parseInt(startParts[1], 10) : 0;

  if (isNaN(inH) || isNaN(inM) || isNaN(startH) || isNaN(startM)) return 0;

  let diff = (inH * 60 + inM) - (startH * 60 + startM);

  // Overnight shift wrap-around support
  if (diff < -720) diff += 1440;
  if (diff > 720) diff -= 1440;

  return diff;
}

/**
 * Formats an amount into Vietnamese standard compact format (e.g., 20k or 20.000đ)
 */
export function formatCompactVND(amount: number): string {
  if (amount >= 1000 && amount % 1000 === 0) {
    return `${amount / 1000}k`;
  }
  return new Intl.NumberFormat('vi-VN').format(amount) + 'đ';
}

/**
 * Formats late minutes into human readable string, e.g. "45 phút", "1h 15p", or "0 phút"
 */
export function formatLateMinutes(minutes: number): string {
  if (!minutes || minutes <= 0) return '0 phút';
  if (minutes < 60) return `${minutes} phút`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}p` : `${h} giờ`;
}

/**
 * Calculates late penalty according to the exact progressive tier rules:
 * - If early (diff <= 0): 0 VND penalty.
 * - If within lateGraceMinutes (e.g., <= 10 mins): 0 VND penalty.
 * - If late > lateGraceMinutes:
 *   + Tier 1: minutes from grace up to 30 mins: rate1 (default 1k/min)
 *   + Tier 2: minutes from 31 to 60 mins: rate2 (default 2k/min)
 *   + Tier 3: minutes > 60 mins: rate3 (default 5k/min)
 */
export function calculateShiftLatePenalty(
  checkInTime: string,
  shiftStartTime: string,
  customPolicy?: Partial<ShiftLatePolicy>
): ShiftLateResult {
  const policy: ShiftLatePolicy = {
    ...DEFAULT_SHIFT_POLICY,
    ...customPolicy
  };

  const diff = getMinutesDifference(checkInTime, shiftStartTime);

  // 1. Arrived on time or early
  if (diff <= 0) {
    const earlyMins = Math.abs(diff);
    return {
      isEarly: earlyMins > 0,
      earlyMinutes: earlyMins,
      isWithinGrace: false,
      lateMinutes: 0,
      totalPenalty: 0,
      breakdown: [],
      formulaString: '0đ (Đúng giờ / Đi sớm)',
      summaryText: earlyMins > 0 
        ? `Đi sớm ${earlyMins} phút (Được phép, không bị trừ lương)`
        : 'Đến đúng giờ bắt đầu ca',
      status: earlyMins > 0 ? 'early' : 'on_time'
    };
  }

  // 2. Arrived within late grace period (e.g. <= 10 mins)
  if (diff <= policy.lateGraceMinutes) {
    return {
      isEarly: false,
      earlyMinutes: 0,
      isWithinGrace: true,
      lateMinutes: diff,
      totalPenalty: 0,
      breakdown: [],
      formulaString: `0đ (Trong thời gian du di ${policy.lateGraceMinutes} phút)`,
      summaryText: `Đi trễ ${diff} phút (Trong hạn du di ${policy.lateGraceMinutes}p đầu ca - Không bị trừ lương)`,
      status: 'grace'
    };
  }

  // 3. Late beyond grace period
  const totalLateMins = diff;
  const grace = policy.lateGraceMinutes;
  const breakdown: PenaltyBreakdownItem[] = [];

  // Tier 1: From grace to min(totalLateMins, 30)
  const tier1Mins = Math.max(0, Math.min(totalLateMins, policy.tier1ThresholdMinutes) - grace);
  const tier1Amt = tier1Mins * policy.tier1RatePerMinute;
  if (tier1Mins > 0) {
    breakdown.push({
      tierName: 'Bậc 1 (≤ 30 phút)',
      range: `Từ phút ${grace} đến ${Math.min(totalLateMins, policy.tier1ThresholdMinutes)}`,
      minutes: tier1Mins,
      ratePerMinute: policy.tier1RatePerMinute,
      amount: tier1Amt,
      label: `${tier1Mins}p × ${formatCompactVND(policy.tier1RatePerMinute)} = ${formatCompactVND(tier1Amt)}`
    });
  }

  // Tier 2: From 30 to min(totalLateMins, 60)
  const tier2Mins = Math.max(0, Math.min(totalLateMins, policy.tier2ThresholdMinutes) - policy.tier1ThresholdMinutes);
  const tier2Amt = tier2Mins * policy.tier2RatePerMinute;
  if (tier2Mins > 0) {
    breakdown.push({
      tierName: 'Bậc 2 (31 - 60 phút)',
      range: `Từ phút 31 đến ${Math.min(totalLateMins, policy.tier2ThresholdMinutes)}`,
      minutes: tier2Mins,
      ratePerMinute: policy.tier2RatePerMinute,
      amount: tier2Amt,
      label: `${tier2Mins}p × ${formatCompactVND(policy.tier2RatePerMinute)} = ${formatCompactVND(tier2Amt)}`
    });
  }

  // Tier 3: From 60 onwards (>= 1 hour late)
  const tier3Mins = Math.max(0, totalLateMins - policy.tier2ThresholdMinutes);
  const tier3Amt = tier3Mins * policy.tier3RatePerMinute;
  if (tier3Mins > 0) {
    breakdown.push({
      tierName: 'Bậc 3 (≥ 1 tiếng)',
      range: `Từ phút 61 đến ${totalLateMins}`,
      minutes: tier3Mins,
      ratePerMinute: policy.tier3RatePerMinute,
      amount: tier3Amt,
      label: `${tier3Mins}p × ${formatCompactVND(policy.tier3RatePerMinute)} = ${formatCompactVND(tier3Amt)}`
    });
  }

  const totalPenalty = tier1Amt + tier2Amt + tier3Amt;
  const formulaString = breakdown.map(b => formatCompactVND(b.amount)).join(' + ') + 
    (breakdown.length > 1 ? ` = ${formatCompactVND(totalPenalty)}` : '');

  return {
    isEarly: false,
    earlyMinutes: 0,
    isWithinGrace: false,
    lateMinutes: totalLateMins,
    totalPenalty,
    breakdown,
    formulaString: formulaString || `${formatCompactVND(totalPenalty)}`,
    summaryText: `Đi trễ ${totalLateMins} phút (Trừ lương: ${formulaString})`,
    status: 'late'
  };
}
