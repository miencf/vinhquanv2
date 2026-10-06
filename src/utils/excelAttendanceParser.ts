import * as XLSX from 'xlsx';
import { AttendanceLog, Employee, ShiftLatePolicy } from '../types';
import { calculateShiftLatePenalty } from './shiftPenalty';

export interface ParsedExcelResult {
  detectedEmployeeName?: string;
  detectedMonth?: string; // YYYY-MM
  matchedEmployeeId?: string;
  logs: AttendanceLog[];
  errors: string[];
}

/**
 * Parses Vietnamese duration strings like "10 giờ 59 phút", "8 giờ", "45 phút", "10h 30p" into decimal hours.
 */
export function parseDurationToHours(durStr: string): number {
  if (!durStr) return 0;
  const str = durStr.toLowerCase().trim();

  // Pattern "X giờ Y phút" or "Xh Yp"
  const hMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:giờ|h)/);
  const mMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:phút|p)/);

  let hours = 0;
  let minutes = 0;

  if (hMatch) {
    hours = parseFloat(hMatch[1]) || 0;
  }
  if (mMatch) {
    minutes = parseFloat(mMatch[1]) || 0;
  }

  if (!hMatch && !mMatch) {
    const num = parseFloat(str.replace(',', '.'));
    if (!isNaN(num)) return num;
  }

  return Math.round((hours + minutes / 60) * 100) / 100;
}

/**
 * Standardizes time strings like "14:00", "0:59", "00:59:00", or Excel fractional day numbers into "HH:mm".
 */
export function formatTimeString(val: any): string {
  if (val === undefined || val === null || val === '') return '';
  if (typeof val === 'number') {
    // Excel time is fraction of 24h
    const totalMinutes = Math.round(val * 24 * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const s = String(val).trim();
  const match = s.match(/(\d{1,2})[:h](\d{2})/i);
  if (match) {
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return s;
}

/**
 * Standardizes date strings into YYYY-MM-DD.
 */
export function formatDateString(val: any, fallbackYearMonth: string): string {
  if (!val) return '';
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof val === 'number') {
    // Excel serial date number
    const dateObj = XLSX.SSF.parse_date_code(val);
    if (dateObj) {
      return `${dateObj.y}-${String(dateObj.m).padStart(2, '0')}-${String(dateObj.d).padStart(2, '0')}`;
    }
  }

  const s = String(val).trim();
  // Format DD/MM/YYYY
  const slashParts = s.split(/[\/\-.]/);
  if (slashParts.length === 3) {
    const d = parseInt(slashParts[0], 10);
    const m = parseInt(slashParts[1], 10);
    let y = parseInt(slashParts[2], 10);
    if (y < 100) y += 2000;
    if (!isNaN(d) && !isNaN(m) && !isNaN(y) && d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // Format only day number e.g. "1" or "25"
  const dayNum = parseInt(s, 10);
  if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
    return `${fallbackYearMonth}-${String(dayNum).padStart(2, '0')}`;
  }

  return '';
}

/**
 * Robust parser for attendance Excel files matching the format shown in the user's screenshot
 * (e.g., "Thời Gian Chấm Công - Quyên", 2 rows per day with check-in & check-out times, locations, total hours).
 */
export function parseAttendanceExcel(
  fileBuffer: ArrayBuffer,
  employees: Employee[],
  selectedEmpId: string,
  selectedYearMonth: string,
  shiftPolicy: ShiftLatePolicy
): ParsedExcelResult {
  const errors: string[] = [];
  const workbook = XLSX.read(fileBuffer, { type: 'array', cellDates: true });
  
  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    return { logs: [], errors: ['File Excel không có sheet nào hợp lệ.'] };
  }

  // Read first sheet
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  let detectedEmployeeName: string | undefined;
  let detectedMonth: string | undefined;

  // 1. Scan top header rows (first 10 rows) for title metadata
  for (let r = 0; r < Math.min(rawRows.length, 10); r++) {
    const row = rawRows[r] || [];
    const rowText = row.map(c => String(c || '').trim()).join(' ');

    // Scan for employee name like "Thời Gian Chấm Công - Quyên"
    const nameMatch = rowText.match(/thời\s*gian\s*chấm\s*công\s*[-–:]\s*([^\r\n\-–,]+)/i);
    if (nameMatch && !detectedEmployeeName) {
      detectedEmployeeName = nameMatch[1].trim();
    }

    // Scan for date range like "Từ 01/09/2026 đến 30/09/2026"
    const rangeMatch = rowText.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (rangeMatch && !detectedMonth) {
      const m = String(rangeMatch[2]).padStart(2, '0');
      const y = rangeMatch[3];
      detectedMonth = `${y}-${m}`;
    }
  }

  // Match employee ID from detected name if possible
  let matchedEmployeeId = selectedEmpId;
  if (!matchedEmployeeId && detectedEmployeeName) {
    const cleanDet = detectedEmployeeName.toLowerCase();
    const foundEmp = employees.find(e => 
      e.name.toLowerCase().includes(cleanDet) || cleanDet.includes(e.name.toLowerCase())
    );
    if (foundEmp) {
      matchedEmployeeId = foundEmp.id;
    }
  }

  const targetEmp = employees.find(e => e.id === matchedEmployeeId);
  const shiftStartTime = targetEmp?.shiftStartTime || '10:00';
  const effectiveYearMonth = detectedMonth || selectedYearMonth;

  // 2. Find header row (e.g. contains "Ngày", "Thời gian")
  let headerRowIndex = -1;
  let colIndexDate = 0;
  let colIndexTime = 1;
  let colIndexMethod = 2;
  let colIndexTotalHours = 5;
  let colIndexNotes = 7;

  for (let r = 0; r < Math.min(rawRows.length, 15); r++) {
    const row = rawRows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cellText = String(row[c] || '').toLowerCase().trim();
      if (cellText === 'ngày' || cellText === 'ngay' || cellText === 'date') {
        headerRowIndex = r;
        colIndexDate = c;
      }
      if (cellText.includes('thời gian') || cellText.includes('gio') || cellText.includes('time')) {
        colIndexTime = c;
      }
      if (cellText.includes('hình thức') || cellText.includes('dia diem') || cellText.includes('location')) {
        colIndexMethod = c;
      }
      if (cellText.includes('tổng thời gian') || cellText.includes('tong gio') || cellText.includes('total')) {
        colIndexTotalHours = c;
      }
      if (cellText.includes('ghi chú') || cellText.includes('ghi chu') || cellText.includes('note')) {
        colIndexNotes = c;
      }
    }
    if (headerRowIndex !== -1) break;
  }

  // Default start row if no header explicitly found
  const dataStartRow = headerRowIndex !== -1 ? headerRowIndex + 1 : 5;

  // 3. Parse attendance rows
  // The Excel structure in the user's screenshot has 2 rows per day:
  // Row 1: Date (e.g. 01/09/2026), In Time (14:00), Location, Total duration (10 giờ 59 phút)
  // Row 2: (Blank date), Out Time (00:59), Location
  const parsedMap: Map<string, {
    date: string;
    inTime: string;
    outTime: string;
    rawDurationText: string;
    notes: string[];
    isAbsent: boolean;
  }> = new Map();

  let currentDate = '';

  for (let r = dataStartRow; r < rawRows.length; r++) {
    const row = rawRows[r] || [];
    const dateCell = row[colIndexDate];
    const timeCell = row[colIndexTime];
    const methodCell = row[colIndexMethod];
    const durCell = row[colIndexTotalHours];
    const noteCell = row[colIndexNotes];

    const parsedDate = formatDateString(dateCell, effectiveYearMonth);
    if (parsedDate) {
      currentDate = parsedDate;
    }

    if (!currentDate) continue;

    const formattedTime = formatTimeString(timeCell);
    const methodStr = String(methodCell || '').trim();
    const durStr = String(durCell || '').trim();
    const noteStr = String(noteCell || '').trim();

    if (!parsedMap.has(currentDate)) {
      parsedMap.set(currentDate, {
        date: currentDate,
        inTime: '',
        outTime: '',
        rawDurationText: '',
        notes: [],
        isAbsent: false
      });
    }

    const dayEntry = parsedMap.get(currentDate)!;

    if (durStr) {
      dayEntry.rawDurationText = durStr;
    }
    if (methodStr) {
      dayEntry.notes.push(methodStr);
    }
    if (noteStr) {
      dayEntry.notes.push(noteStr);
    }

    if (formattedTime) {
      if (!dayEntry.inTime) {
        dayEntry.inTime = formattedTime;
      } else if (!dayEntry.outTime) {
        dayEntry.outTime = formattedTime;
      }
    }
  }

  // Convert map to AttendanceLog array
  const logs: AttendanceLog[] = [];
  const entries = Array.from(parsedMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  entries.forEach((entry, idx) => {
    let hoursWorked = 0;
    let status: AttendanceLog['status'] = 'present';
    let multiplier = 1.0;

    // Check if day was marked off or had no check-in/out
    if (!entry.inTime && !entry.outTime) {
      status = 'absent';
      hoursWorked = 0;
      multiplier = 0.0;
    } else {
      // Calculate hours
      if (entry.rawDurationText) {
        hoursWorked = parseDurationToHours(entry.rawDurationText);
      } else if (entry.inTime && entry.outTime) {
        const parseDec = (t: string) => {
          const parts = t.split(':');
          return (parseInt(parts[0], 10) || 0) + (parseInt(parts[1], 10) || 0) / 60;
        };
        const tIn = parseDec(entry.inTime);
        const tOut = parseDec(entry.outTime);
        const diff = tOut < tIn ? (24 - tIn) + tOut : tOut - tIn;
        hoursWorked = Math.round(diff * 100) / 100;
      } else {
        hoursWorked = 8; // fallback
      }
    }

    // Evaluate late arrival if inTime is present and employee is not absent
    let lateMinutes = 0;
    let latePenalty = 0;
    if (entry.inTime && status !== 'absent') {
      const lateCalc = calculateShiftLatePenalty(entry.inTime, shiftStartTime, shiftPolicy);
      lateMinutes = lateCalc.lateMinutes;
      latePenalty = lateCalc.totalPenalty;
      if (lateCalc.status === 'late') {
        status = 'late';
      }
    }

    const uniqueNotes = Array.from(new Set(entry.notes)).filter(Boolean).join(' • ');

    const log: AttendanceLog = {
      id: `att-excel-${Date.now()}-${idx}`,
      employeeId: matchedEmployeeId || selectedEmpId,
      date: entry.date,
      hoursWorked,
      status,
      rateMultiplier: multiplier,
      inTime: entry.inTime,
      outTime: entry.outTime,
      notes: uniqueNotes || (status === 'absent' ? 'Nghỉ công' : 'Chấm công Excel'),
      lateMinutes,
      latePenalty
    };

    logs.push(log);
  });

  return {
    detectedEmployeeName,
    detectedMonth,
    matchedEmployeeId,
    logs,
    errors
  };
}
