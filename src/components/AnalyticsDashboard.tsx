import React, { useState, useMemo } from 'react';
import { Employee, AttendanceLog, PayrollAdjustment, Shift } from '../types';
import { 
  BarChart2, PieChart, TrendingUp, Users, Clock, CircleDollarSign, 
  Award, AlertTriangle, ArrowUpDown, Calendar, ChevronRight, HelpCircle 
} from 'lucide-react';
import { playClick } from '../lib/audio';
import { formatLateMinutes } from '../utils/shiftPenalty';

// Helper to format currency
const formatVND = (amount: number) => {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
};

interface AnalyticsDashboardProps {
  employees: Employee[];
  attendance: AttendanceLog[];
  adjustments: PayrollAdjustment[];
  shifts: Shift[];
  dismissedAutoBonuses: any[];
  selectedMonth: string;
}

export default function AnalyticsDashboard({
  employees,
  attendance,
  adjustments,
  shifts,
  dismissedAutoBonuses,
  selectedMonth
}: AnalyticsDashboardProps) {
  const [activeChartTab, setActiveChartTab] = useState<'salary' | 'shifts' | 'daily'>('salary');
  const [salarySortOrder, setSalarySortOrder] = useState<'desc' | 'asc'>('desc');
  const [hoveredBar, setHoveredBar] = useState<string | null>(null);
  const [hoveredSlice, setHoveredSlice] = useState<string | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);

  // Helper to calculate details for a log
  const getDailyDetails = (log: AttendanceLog, emp: Employee | undefined) => {
    if (!emp) {
      return { totalHours: log.hoursWorked, totalSalary: log.hoursWorked * log.rateMultiplier * 20000 };
    }
    // Check-in calculation logic (after July 2026)
    const isAfterJuly2026 = log.date >= '2026-07-01';
    if (!isAfterJuly2026) {
      return { totalHours: log.hoursWorked, totalSalary: log.hoursWorked * emp.hourlyRate * log.rateMultiplier };
    }

    const shiftStartTime = emp.shiftStartTime || '18:00';
    const shiftEndTime = emp.shiftEndTime || '01:00';
    const overtimeStart = emp.overtimeStart || '01:00';
    const overtimeHourlyRate = emp.overtimeHourlyRate || (emp.hourlyRate * (emp.overtimeMultiplier ?? 1.5));

    // Simple fallback hour calculation for logs that might not have regularHours or overtimeHours set
    let regHours = log.regularHours ?? 0;
    let otHours = log.overtimeHours ?? 0;
    
    if (regHours === 0 && otHours === 0 && log.inTime && log.outTime) {
      const parseTimeToDecimal = (t: string) => {
        const parts = t.split(':');
        const h = parseInt(parts[0], 10) || 0;
        const m = parseInt(parts[1], 10) || 0;
        return h + m / 60;
      };
      const tIn = parseTimeToDecimal(log.inTime);
      const tOut = parseTimeToDecimal(log.outTime);
      const diff = tOut < tIn ? (24 - tIn) + tOut : tOut - tIn;
      const total = Math.round(diff * 100) / 100;
      regHours = Math.min(8, total);
      otHours = Math.max(0, total - 8);
    } else if (regHours === 0 && otHours === 0 && log.hoursWorked) {
      regHours = Math.min(8, log.hoursWorked);
      otHours = Math.max(0, log.hoursWorked - 8);
    }

    const regSalary = regHours * emp.hourlyRate * log.rateMultiplier;
    const otSalary = otHours * overtimeHourlyRate * log.rateMultiplier;

    return {
      totalHours: regHours + otHours,
      totalSalary: regSalary + otSalary,
      regularHours: regHours,
      overtimeHours: otHours
    };
  };

  // Helper to determine automatic bonus for a month
  const getAutoBonus = (emp: Employee, monthStr: string) => {
    const personalAttendance = attendance.filter(
      log => log.employeeId === emp.id && log.date.substring(0, 7) === monthStr
    );
    const presentCount = personalAttendance.filter(l => l.status !== 'absent').length;
    
    const parts = monthStr.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const daysInMonth = new Date(year, month, 0).getDate();
    const reqDays = daysInMonth === 30 ? 28 : (daysInMonth === 31 ? 29 : daysInMonth - 2);

    const isDismissed = dismissedAutoBonuses.some(
      item => item.id === `${emp.id}_${monthStr}_autobonus`
    );

    if (presentCount >= reqDays && !isDismissed) {
      const start = emp.shiftStartTime || '18:00';
      const end = emp.shiftEndTime || '01:00';
      const partsStart = start.split(':');
      const hStart = parseInt(partsStart[0], 10) || 0;
      const mStart = partsStart[1] ? parseInt(partsStart[1], 10) : 0;
      const partsEnd = end.split(':');
      const hEnd = parseInt(partsEnd[0], 10) || 0;
      const mEnd = partsEnd[1] ? parseInt(partsEnd[1], 10) : 0;
      
      const duration = hEnd < hStart ? (24 - hStart) + hEnd : hEnd - hStart;
      const roundedDur = Math.round((duration + (mEnd - mStart) / 60) * 100) / 100;
      const bonusAmount = 2 * roundedDur * emp.hourlyRate;

      return {
        id: `${emp.id}_${monthStr}_autobonus`,
        employeeId: emp.id,
        date: `${monthStr}-28`,
        type: 'bonus' as const,
        amount: bonusAmount,
        reason: `Thưởng chuyên cần tự động (${presentCount}/${daysInMonth} ngày công)`
      };
    }
    return null;
  };

  // Compile real payroll calculations for ALL employees for the selected month
  const payrollDataset = useMemo(() => {
    return employees.map(emp => {
      const personalAttendance = attendance.filter(
        log => log.employeeId === emp.id && log.date.substring(0, 7) === selectedMonth
      );

      let totalHours = 0;
      let regularHours = 0;
      let overtimeHours = 0;
      let baseEarned = 0;

      personalAttendance.forEach(log => {
        const details = getDailyDetails(log, emp);
        totalHours += details.totalHours;
        baseEarned += details.totalSalary;
        regularHours += details.regularHours ?? 0;
        overtimeHours += details.overtimeHours ?? 0;
      });

      const personalAdjustments = adjustments.filter(
        adj => adj.employeeId === emp.id && adj.date.substring(0, 7) === selectedMonth
      );

      const auto = getAutoBonus(emp, selectedMonth);
      const allAdjustments = [...personalAdjustments];
      if (auto && !personalAdjustments.some(a => a.id === auto.id)) {
        allAdjustments.push(auto);
      }

      const totalBonuses = allAdjustments
        .filter(adj => adj.type === 'bonus')
        .reduce((acc, curr) => acc + curr.amount, 0);

      const totalPenalties = allAdjustments
        .filter(adj => adj.type === 'penalty')
        .reduce((acc, curr) => acc + curr.amount, 0);

      const finalSalary = Math.max(0, baseEarned + totalBonuses - totalPenalties);
      const workingDays = personalAttendance.filter(l => l.status !== 'absent').length;

      return {
        employee: emp,
        totalHours,
        regularHours,
        overtimeHours,
        baseEarned,
        totalBonuses,
        totalPenalties,
        finalSalary,
        workingDays
      };
    });
  }, [employees, attendance, adjustments, selectedMonth, dismissedAutoBonuses]);

  // Overall statistics
  const totalPayrollFund = useMemo(() => {
    return payrollDataset.reduce((sum, item) => sum + item.finalSalary, 0);
  }, [payrollDataset]);

  const totalHoursWorked = useMemo(() => {
    return payrollDataset.reduce((sum, item) => sum + item.totalHours, 0);
  }, [payrollDataset]);

  const totalOvertimeHours = useMemo(() => {
    return payrollDataset.reduce((sum, item) => sum + item.overtimeHours, 0);
  }, [payrollDataset]);

  const totalLateMinutes = useMemo(() => {
    return attendance
      .filter(l => l.date.substring(0, 7) === selectedMonth && (l.lateMinutes ?? 0) > 0)
      .reduce((sum, l) => sum + (l.lateMinutes || 0), 0);
  }, [attendance, selectedMonth]);

  const totalLateCount = useMemo(() => {
    return attendance
      .filter(l => l.date.substring(0, 7) === selectedMonth && ((l.lateMinutes ?? 0) > 0 || l.status === 'late'))
      .length;
  }, [attendance, selectedMonth]);

  const averageAttendanceRate = useMemo(() => {
    if (employees.length === 0) return 0;
    const parts = selectedMonth.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const daysInMonth = new Date(year, month, 0).getDate();
    
    const sumDays = payrollDataset.reduce((sum, item) => sum + item.workingDays, 0);
    const maxPossibleDays = employees.length * daysInMonth;
    return maxPossibleDays > 0 ? (sumDays / maxPossibleDays) * 100 : 0;
  }, [payrollDataset, employees, selectedMonth]);

  // Insights
  const topEarner = useMemo(() => {
    if (payrollDataset.length === 0) return null;
    return [...payrollDataset].sort((a, b) => b.finalSalary - a.finalSalary)[0];
  }, [payrollDataset]);

  const mostDiligent = useMemo(() => {
    if (payrollDataset.length === 0) return null;
    return [...payrollDataset].sort((a, b) => b.workingDays - a.workingDays)[0];
  }, [payrollDataset]);

  // 1. Chart Data 1: Sorted Salary Distribution
  const salaryChartData = useMemo(() => {
    const data = payrollDataset.map(item => ({
      name: item.employee.name,
      finalSalary: item.finalSalary,
      baseEarned: item.baseEarned,
      bonuses: item.totalBonuses,
      role: item.employee.role
    }));
    return data.sort((a, b) => {
      return salarySortOrder === 'desc' 
        ? b.finalSalary - a.finalSalary 
        : a.finalSalary - b.finalSalary;
    });
  }, [payrollDataset, salarySortOrder]);

  // 2. Chart Data 2: Shifts Hours Distribution
  const shiftChartData = useMemo(() => {
    const hoursByShift: { [key: string]: { hours: number, count: number } } = {};
    shifts.forEach(s => {
      hoursByShift[s.id] = { hours: 0, count: 0 };
    });
    // Fallback for default shifts
    if (!hoursByShift['CA-CHIEU']) hoursByShift['CA-CHIEU'] = { hours: 0, count: 0 };
    if (!hoursByShift['CA-TOI']) hoursByShift['CA-TOI'] = { hours: 0, count: 0 };

    attendance.forEach(log => {
      if (log.date.substring(0, 7) !== selectedMonth) return;
      const shiftId = log.shiftId || 'CA-TOI';
      const hours = log.hoursWorked || 0;
      if (!hoursByShift[shiftId]) {
        hoursByShift[shiftId] = { hours: 0, count: 0 };
      }
      hoursByShift[shiftId].hours += hours;
      hoursByShift[shiftId].count += 1;
    });

    return Object.keys(hoursByShift).map(id => {
      const matched = shifts.find(s => s.id === id);
      return {
        id,
        name: matched ? `${matched.name} (${matched.startTime} - ${matched.endTime})` : id,
        hours: Math.round(hoursByShift[id].hours * 10) / 10,
        logsCount: hoursByShift[id].count
      };
    }).filter(item => item.hours > 0);
  }, [attendance, shifts, selectedMonth]);

  // Total shift hours for percentage computation
  const totalShiftHours = useMemo(() => {
    return shiftChartData.reduce((sum, item) => sum + item.hours, 0);
  }, [shiftChartData]);

  // 3. Chart Data 3: Daily Active Attendance Trend Line
  const dailyTrendData = useMemo(() => {
    const parts = selectedMonth.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const daysInMonth = new Date(year, month, 0).getDate();

    const stats: { date: string, present: number, hours: number }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${selectedMonth}-${String(d).padStart(2, '0')}`;
      const logsToday = attendance.filter(log => log.date === dateStr && log.status !== 'absent');
      const hoursToday = logsToday.reduce((sum, l) => sum + (l.hoursWorked || 0), 0);
      
      stats.push({
        date: `${d}/${month}`,
        present: logsToday.length,
        hours: Math.round(hoursToday * 10) / 10
      });
    }
    return stats;
  }, [attendance, selectedMonth]);

  // Max value in daily trends for scaling
  const maxDailyPresent = useMemo(() => {
    const maxVal = Math.max(...dailyTrendData.map(d => d.present), 1);
    return Math.ceil(maxVal / 5) * 5; // round up to multiple of 5
  }, [dailyTrendData]);

  return (
    <div className="space-y-6">
      
      {/* KPI Overview Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        
        {/* KPI 1 */}
        <div className="p-5 bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-mono font-medium text-[#8c8c80] uppercase tracking-wider">Tổng Quỹ Lương</span>
            <p className="text-xl font-bold font-mono text-[#1c1c1a] dark:text-white">{formatVND(totalPayrollFund)}</p>
            <p className="text-[10px] text-[#5c5c54] dark:text-[#acaca0]">Chi trả cho {employees.length} nhân sự</p>
          </div>
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 rounded-xl border border-emerald-100 dark:border-emerald-900/30">
            <CircleDollarSign className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 2 */}
        <div className="p-5 bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-mono font-medium text-[#8c8c80] uppercase tracking-wider">Tổng Giờ Đã Làm</span>
            <p className="text-xl font-bold font-mono text-[#1c1c1a] dark:text-white">{Math.round(totalHoursWorked)} h</p>
            <p className="text-[10px] text-[#5c5c54] dark:text-[#acaca0]">
              Tăng ca: <strong className="font-mono text-amber-600">{Math.round(totalOvertimeHours)}h</strong> ({Math.round(totalHoursWorked ? (totalOvertimeHours/totalHoursWorked)*100 : 0)}%)
            </p>
          </div>
          <div className="p-3 bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 rounded-xl border border-blue-100 dark:border-blue-900/30">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 3: Late arrival metric */}
        <div className="p-5 bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-mono font-medium text-[#8c8c80] uppercase tracking-wider">Tổng Thời Gian Đi Trễ</span>
            <p className="text-xl font-bold font-mono text-amber-700 dark:text-amber-400">{formatLateMinutes(totalLateMinutes)}</p>
            <p className="text-[10px] text-[#5c5c54] dark:text-[#acaca0]">{totalLateCount} lượt đi trễ trong tháng</p>
          </div>
          <div className="p-3 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 rounded-xl border border-amber-100 dark:border-amber-900/30">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 4 */}
        <div className="p-5 bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-mono font-medium text-[#8c8c80] uppercase tracking-wider">Tỷ Lệ Chuyên Cần</span>
            <p className="text-xl font-bold font-mono text-[#1c1c1a] dark:text-white">{averageAttendanceRate.toFixed(1)}%</p>
            <p className="text-[10px] text-[#5c5c54] dark:text-[#acaca0]">Trung bình toàn hệ thống</p>
          </div>
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
            <Users className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 5 */}
        <div className="p-5 bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-mono font-medium text-[#8c8c80] uppercase tracking-wider">Lương Giờ TB</span>
            <p className="text-xl font-bold font-mono text-[#1c1c1a] dark:text-white">
              {formatVND(totalHoursWorked ? Math.round(totalPayrollFund / totalHoursWorked) : 0)}
            </p>
            <p className="text-[10px] text-[#5c5c54] dark:text-[#acaca0]">Chi phí bình quân / 1 giờ công</p>
          </div>
          <div className="p-3 bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400 rounded-xl border border-purple-100 dark:border-purple-900/30">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

      </div>

      {/* Main Charts & Analytics Hub */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Interactive Chart Panel (SVG-based high quality custom) */}
        <div className="lg:col-span-8 p-5 bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#f2f2ee] dark:border-[#2c2c28] pb-3">
            <div>
              <h3 className="text-sm font-semibold tracking-wider text-[#1c1c1a] dark:text-white uppercase flex items-center gap-1.5">
                <BarChart2 className="w-4 h-4 text-amber-500" />
                Biểu Đồ Phân Tích Thực Tế
              </h3>
              <p className="text-[11px] text-[#8c8c80] mt-0.5">Phân tích trực quan quỹ lương & thời gian tháng {selectedMonth}</p>
            </div>

            {/* Sub Tabs to toggle Chart */}
            <div className="flex bg-[#fbfbfa] dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] p-1 rounded-xl text-[10px] font-mono font-bold uppercase tracking-wider">
              <button
                onClick={() => { playClick(); setActiveChartTab('salary'); }}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${activeChartTab === 'salary' ? 'bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] shadow-xs' : 'text-[#8c8c80] hover:text-[#5c5c54]'}`}
              >
                Lương Nhân Sự
              </button>
              <button
                onClick={() => { playClick(); setActiveChartTab('shifts'); }}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${activeChartTab === 'shifts' ? 'bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] shadow-xs' : 'text-[#8c8c80] hover:text-[#5c5c54]'}`}
              >
                Giờ Theo Ca
              </button>
              <button
                onClick={() => { playClick(); setActiveChartTab('daily'); }}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${activeChartTab === 'daily' ? 'bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] shadow-xs' : 'text-[#8c8c80] hover:text-[#5c5c54]'}`}
              >
                Nhân Lực Hàng Ngày
              </button>
            </div>
          </div>

          {/* Render Area */}
          <div className="min-h-76 flex items-center justify-center relative">
            
            {/* Chart 1: Salary Distribution Bar Chart */}
            {activeChartTab === 'salary' && (
              <div className="w-full space-y-4">
                <div className="flex items-center justify-between text-xs text-[#5c5c54] dark:text-[#8c8c80]">
                  <span>Danh sách sắp xếp theo lương thực lĩnh</span>
                  <button
                    onClick={() => { playClick(); setSalarySortOrder(prev => prev === 'desc' ? 'asc' : 'desc'); }}
                    className="flex items-center gap-1 hover:text-[#1c1c1a] dark:hover:text-white transition-colors cursor-pointer font-bold font-mono"
                  >
                    <ArrowUpDown className="w-3.5 h-3.5" />
                    {salarySortOrder === 'desc' ? 'Cao nhất trước' : 'Thấp nhất trước'}
                  </button>
                </div>

                {salaryChartData.length === 0 ? (
                  <p className="text-xs text-[#8c8c80] italic text-center py-10">Không có dữ liệu nhân sự để hiển thị.</p>
                ) : (
                  <div className="space-y-3.5">
                    {salaryChartData.map((item, idx) => {
                      const maxSalary = Math.max(...salaryChartData.map(s => s.finalSalary), 1);
                      const pct = (item.finalSalary / maxSalary) * 100;
                      
                      return (
                        <div 
                          key={item.name} 
                          className="space-y-1 group"
                          onMouseEnter={() => setHoveredBar(item.name)}
                          onMouseLeave={() => setHoveredBar(null)}
                        >
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-semibold text-[#1c1c1a] dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                              {idx + 1}. {item.name} <span className="text-[10px] text-[#8c8c80] font-mono">({item.role})</span>
                            </span>
                            <span className="font-bold font-mono text-[#1c1c1a] dark:text-white">
                              {formatVND(item.finalSalary)}
                            </span>
                          </div>
                          
                          {/* Progress Bar Container */}
                          <div className="relative w-full h-4 bg-[#f2f2ee] dark:bg-[#2c2c28] rounded-md overflow-hidden border border-[#e4e4db] dark:border-[#3c3c38]/40">
                            <div 
                              className="h-full bg-gradient-to-r from-amber-500 to-amber-600 transition-all duration-500 rounded-r-sm"
                              style={{ width: `${Math.max(3, pct)}%` }}
                            />
                            {/* Hover tooltip inline indicator */}
                            {hoveredBar === item.name && (
                              <div className="absolute inset-y-0 right-3 flex items-center text-[9px] font-mono font-bold text-[#5c5c54] dark:text-[#acaca0] animate-in fade-in duration-150">
                                Cơ bản: {formatVND(item.baseEarned)} • Thưởng: +{formatVND(item.bonuses)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Chart 2: Shift Hour Donut Pie Chart (High precision SVG) */}
            {activeChartTab === 'shifts' && (
              <div className="w-full grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                
                {/* SVG Visual Pie */}
                <div className="md:col-span-6 flex justify-center">
                  {shiftChartData.length === 0 ? (
                    <div className="text-center p-6 text-xs text-[#8c8c80] italic">Không có giờ làm việc nào được lưu cho tháng này.</div>
                  ) : (
                    <svg className="w-52 h-52 transform -rotate-90" viewBox="0 0 100 100">
                      {/* Donut Circle */}
                      <circle cx="50" cy="50" r="38" fill="none" stroke="#f2f2ee" strokeWidth="12" />
                      
                      {(() => {
                        let accumulatedPercent = 0;
                        const colors = [
                          'stroke-amber-500', 
                          'stroke-indigo-500', 
                          'stroke-emerald-500', 
                          'stroke-pink-500', 
                          'stroke-sky-500'
                        ];

                        return shiftChartData.map((item, idx) => {
                          const pct = (item.hours / totalShiftHours) * 100;
                          const strokeDasharray = `${pct} ${100 - pct}`;
                          const strokeDashoffset = -accumulatedPercent;
                          accumulatedPercent += pct;
                          const strokeColor = colors[idx % colors.length];
                          const isHovered = hoveredSlice === item.id;

                          return (
                            <circle
                              key={item.id}
                              cx="50"
                              cy="50"
                              r="38"
                              fill="none"
                              className={`${strokeColor} transition-all duration-300 cursor-pointer ${isHovered ? 'stroke-[15]' : 'stroke-[10]'}`}
                              strokeDasharray={strokeDasharray}
                              strokeDashoffset={strokeDashoffset}
                              pathLength="100"
                              onMouseEnter={() => setHoveredSlice(item.id)}
                              onMouseLeave={() => setHoveredSlice(null)}
                            />
                          );
                        });
                      })()}
                      
                      {/* Center circle for Donut effect */}
                      <circle cx="50" cy="50" r="28" className="fill-white dark:fill-[#1c1c1a]" />
                      
                      {/* Text in center */}
                      <text x="50" y="47" textAnchor="middle" className="fill-[#8c8c80] text-[6px] font-mono uppercase font-bold tracking-wider">Tổng giờ ca</text>
                      <text x="50" y="58" textAnchor="middle" className="fill-[#1c1c1a] dark:fill-white text-[10px] font-mono font-black">{Math.round(totalShiftHours)}h</text>
                    </svg>
                  )}
                </div>

                {/* Legend & Details */}
                <div className="md:col-span-6 space-y-3">
                  <p className="text-xs font-semibold text-[#1c1c1a] dark:text-white font-mono uppercase">Cơ cấu đóng góp của Ca làm việc</p>
                  
                  <div className="space-y-2.5">
                    {shiftChartData.map((item, idx) => {
                      const pct = totalShiftHours ? (item.hours / totalShiftHours) * 100 : 0;
                      const colorsBg = ['bg-amber-500', 'bg-indigo-500', 'bg-emerald-500', 'bg-pink-500', 'bg-sky-500'];
                      const isHovered = hoveredSlice === item.id;

                      return (
                        <div 
                          key={item.id} 
                          className={`p-2.5 rounded-xl border transition-all ${isHovered ? 'bg-[#fbfbfa] dark:bg-[#121211] border-amber-300 scale-[1.02]' : 'border-[#f2f2ee] dark:border-[#2c2c28] border-transparent'}`}
                          onMouseEnter={() => setHoveredSlice(item.id)}
                          onMouseLeave={() => setHoveredSlice(null)}
                        >
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center space-x-2">
                              <span className={`w-2.5 h-2.5 rounded-full ${colorsBg[idx % colorsBg.length]}`} />
                              <span className="font-medium text-[#1c1c1a] dark:text-white text-[11px]">{item.name}</span>
                            </div>
                            <span className="font-mono font-bold text-[#1c1c1a] dark:text-white">{item.hours}h ({Math.round(pct)}%)</span>
                          </div>
                          <p className="text-[10px] text-[#8c8c80] mt-0.5 ml-4.5">Tổng số {item.logsCount} lượt nhân sự check-in ca này</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            )}

            {/* Chart 3: Daily Active Attendance Trend Line (Full precision custom SVG) */}
            {activeChartTab === 'daily' && (
              <div className="w-full space-y-3">
                <div className="flex justify-between text-[11px] text-[#8c8c80] font-mono">
                  <span>Trục đứng: Số nhân sự có mặt</span>
                  <span>Trục ngang: Ngày trong tháng</span>
                </div>

                {/* SVG Area */}
                <div className="w-full overflow-x-auto">
                  <svg className="w-full min-w-[500px] h-52 bg-[#fbfbfa] dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl" viewBox="0 0 500 150">
                    
                    {/* Grid lines */}
                    <line x1="30" y1="20" x2="480" y2="20" stroke="#f2f2ee" strokeWidth="1" strokeDasharray="3,3" />
                    <line x1="30" y1="60" x2="480" y2="60" stroke="#f2f2ee" strokeWidth="1" strokeDasharray="3,3" />
                    <line x1="30" y1="100" x2="480" y2="100" stroke="#f2f2ee" strokeWidth="1" strokeDasharray="3,3" />
                    <line x1="30" y1="130" x2="480" y2="130" stroke="#e4e4db" strokeWidth="1" />

                    {/* Y-axis helper text labels */}
                    <text x="12" y="24" className="fill-[#8c8c80] text-[8px] font-mono">{maxDailyPresent}p</text>
                    <text x="12" y="64" className="fill-[#8c8c80] text-[8px] font-mono">{Math.round(maxDailyPresent / 2)}p</text>
                    <text x="12" y="104" className="fill-[#8c8c80] text-[8px] font-mono">2p</text>
                    <text x="12" y="134" className="fill-[#8c8c80] text-[8px] font-mono">0p</text>

                    {/* Plot Line & Points */}
                    {(() => {
                      const totalPoints = dailyTrendData.length;
                      const xSpacing = 450 / (totalPoints - 1 || 1);
                      const pointsStr = dailyTrendData.map((d, idx) => {
                        const x = 30 + idx * xSpacing;
                        const pctOfMax = d.present / maxDailyPresent;
                        const y = 130 - pctOfMax * 110; // scale to fit 110px vertical space
                        return `${x},${y}`;
                      }).join(' ');

                      return (
                        <>
                          {/* Gradient under the line for luxury aesthetic */}
                          <path
                            d={`M 30 130 L ${pointsStr} L 480 130 Z`}
                            fill="url(#daily-gradient)"
                            opacity="0.1"
                          />
                          <defs>
                            <linearGradient id="daily-gradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#f59e0b" />
                              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
                            </linearGradient>
                          </defs>

                          {/* Line */}
                          <polyline
                            fill="none"
                            stroke="#f59e0b"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={pointsStr}
                          />

                          {/* Interactive Points circles */}
                          {dailyTrendData.map((d, idx) => {
                            const x = 30 + idx * xSpacing;
                            const pctOfMax = d.present / maxDailyPresent;
                            const y = 130 - pctOfMax * 110;
                            const isHovered = hoveredPoint === idx;

                            return (
                              <circle
                                key={idx}
                                cx={x}
                                cy={y}
                                r={isHovered ? 5 : 3}
                                className="fill-white stroke-amber-500 cursor-pointer stroke-2 transition-all"
                                onMouseEnter={() => setHoveredPoint(idx)}
                                onMouseLeave={() => setHoveredPoint(null)}
                              />
                            );
                          })}
                        </>
                      );
                    })()}

                    {/* Draw selected tick dates at the bottom */}
                    {(() => {
                      const totalPoints = dailyTrendData.length;
                      const xSpacing = 450 / (totalPoints - 1 || 1);
                      // Draw every 5 days for clean spacing
                      return dailyTrendData.map((d, idx) => {
                        if (idx % 5 !== 0 && idx !== totalPoints - 1) return null;
                        const x = 30 + idx * xSpacing;
                        return (
                          <text key={idx} x={x} y="145" textAnchor="middle" className="fill-[#8c8c80] text-[8px] font-mono">
                            {d.date}
                          </text>
                        );
                      });
                    })()}
                  </svg>
                </div>

                {/* Selected point popup */}
                <div className="bg-[#fbfbfa] dark:bg-[#121211] p-3 rounded-xl border border-[#f2f2ee] dark:border-[#2c2c28] text-xs flex justify-between items-center font-mono">
                  <span>
                    Chi tiết điểm: {hoveredPoint !== null ? (
                      <>
                        Ngày <strong>{dailyTrendData[hoveredPoint].date}</strong> có{' '}
                        <strong className="text-amber-600">{dailyTrendData[hoveredPoint].present} nhân viên</strong> chấm công ({dailyTrendData[hoveredPoint].hours} giờ làm)
                      </>
                    ) : (
                      'Rê chuột vào điểm tròn trên đồ thị để xem chi tiết'
                    )}
                  </span>
                  <span className="text-[10px] text-gray-400">Đồ thị xu thế</span>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Operational Intelligence & Top Diligent */}
        <div className="lg:col-span-4 p-5 bg-[#fbfbfa] dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl h-fit space-y-4">
          <div className="border-b border-[#f2f2ee] dark:border-[#2c2c28] pb-3">
            <h3 className="text-xs font-semibold tracking-wider font-mono text-[#5c5c54] dark:text-[#acaca0] uppercase">
              Bình Luận Phân Tích & Điểm Sáng
            </h3>
          </div>

          <div className="space-y-4">
            
            {/* Top Earner Card */}
            {topEarner && (
              <div className="p-3 bg-white dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl flex items-start space-x-3">
                <div className="p-2 bg-amber-50 dark:bg-amber-950/20 text-amber-500 rounded-lg">
                  <Award className="w-4 h-4 fill-amber-400" />
                </div>
                <div>
                  <p className="text-[10px] font-mono font-medium text-[#8c8c80] uppercase">Doanh Thu Cao Nhất</p>
                  <p className="text-xs font-bold text-[#1c1c1a] dark:text-white mt-0.5">{topEarner.employee.name}</p>
                  <p className="text-[11px] font-mono text-emerald-700 font-bold mt-0.5">{formatVND(topEarner.finalSalary)}</p>
                  <p className="text-[10px] text-[#8c8c80] mt-0.5">Làm việc tổng cộng {topEarner.totalHours} giờ</p>
                </div>
              </div>
            )}

            {/* Most Diligent Card */}
            {mostDiligent && (
              <div className="p-3 bg-white dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl flex items-start space-x-3">
                <div className="p-2 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-500 rounded-lg">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[10px] font-mono font-medium text-[#8c8c80] uppercase">Chăm Chỉ Nhất</p>
                  <p className="text-xs font-bold text-[#1c1c1a] dark:text-white mt-0.5">{mostDiligent.employee.name}</p>
                  <p className="text-[11px] font-mono text-indigo-700 font-bold mt-0.5">{mostDiligent.workingDays} ngày công</p>
                  <p className="text-[10px] text-[#8c8c80] mt-0.5">Không vắng ca nào trong kỳ chấm công</p>
                </div>
              </div>
            )}

            {/* Dynamic AI-Style Insight */}
            <div className="p-4 bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-950/10 dark:to-purple-950/10 border border-indigo-100/40 dark:border-indigo-900/20 rounded-xl space-y-2">
              <span className="text-[10px] font-mono font-bold tracking-widest text-indigo-600 dark:text-indigo-400 uppercase flex items-center gap-1">
                🤖 Nhận Định Hệ Thống
              </span>
              <p className="text-xs text-[#5c5c54] dark:text-gray-300 leading-relaxed">
                Quỹ lương chi trả thực tế của tháng {selectedMonth} chiếm{' '}
                <strong>{formatVND(totalPayrollFund)}</strong>. Hiệu suất tăng ca (Overtime Rate) hiện ở mức{' '}
                <strong className="text-indigo-600">{Math.round(totalHoursWorked ? (totalOvertimeHours/totalHoursWorked)*100 : 0)}%</strong>. 
                Tỉ lệ chuyên cần đạt <strong>{averageAttendanceRate.toFixed(1)}%</strong> cho thấy đội ngũ hoạt động cực kỳ kỷ luật và ổn định.
              </p>
            </div>

            {/* Warning Advice */}
            <div className="p-3 bg-amber-50/60 dark:bg-amber-950/10 border border-amber-100 dark:border-amber-900/30 rounded-xl flex items-start space-x-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[10px] text-[#5c5c54] dark:text-[#acaca0] leading-relaxed">
                <strong>Gợi ý quản trị:</strong> Đảm bảo các điều chỉnh (Thưởng chuyên cần, Phạt đi muộn) đã được đồng bộ hoàn toàn trước ngày 28 hàng tháng để tránh sai lệch dữ liệu kết toán cuối kỳ.
              </p>
            </div>

          </div>
        </div>

      </div>

    </div>
  );
}
