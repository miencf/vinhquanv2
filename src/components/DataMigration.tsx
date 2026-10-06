import React, { useState } from 'react';
import { db } from '../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { 
  Download, Upload, FileText, CheckCircle2, AlertTriangle, 
  RefreshCw, Info, Database, Layers, Check, Trash 
} from 'lucide-react';
import { playClick, playChime } from '../lib/audio';
import { Employee, AttendanceLog, PayrollAdjustment, Shift } from '../types';

// Helper to format currency
const formatVND = (amount: number) => {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
};

interface DataMigrationProps {
  employees: Employee[];
  attendance: AttendanceLog[];
  adjustments: PayrollAdjustment[];
  shifts: Shift[];
  selectedMonth: string;
  onRefresh?: () => void;
}

export default function DataMigration({
  employees,
  attendance,
  adjustments,
  shifts,
  selectedMonth,
  onRefresh
}: DataMigrationProps) {
  const [dragActive, setDragActive] = useState(false);
  const [importType, setImportType] = useState<'employees' | 'attendance'>('employees');
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileName, setFileName] = useState('');

  // 1. Export Entire Database Snapshot (Backup)
  const handleExportFullJSON = () => {
    playClick();
    const backupObj = {
      employees,
      attendance,
      adjustments,
      shifts,
      exportedAt: new Date().toISOString(),
      version: '1.2.0'
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupObj, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `Serene_Payroll_Backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // 2. Export selected Month Payroll Sheet to CSV
  const handleExportPayrollCSV = () => {
    playClick();
    let csvContent = 'data:text/csv;charset=utf-8,\uFEFF'; // Add BOM for Excel UTF-8 Vietnamese parsing
    csvContent += 'Mã Nhân Viên,Họ và Tên,Chức Vụ,Tổng Giờ Làm,Số Ngày Công,Thực Lĩnh Lương\r\n';

    // Helper calculate final salary (mirror)
    employees.forEach(emp => {
      const personalAttendance = attendance.filter(
        log => log.employeeId === emp.id && log.date.substring(0, 7) === selectedMonth
      );

      let totalHours = 0;
      let baseEarned = 0;

      personalAttendance.forEach(log => {
        // Simple mock calculations
        const rateMult = log.rateMultiplier || 1.0;
        const total = (log.hoursWorked || 0) * emp.hourlyRate * rateMult;
        totalHours += log.hoursWorked || 0;
        baseEarned += total;
      });

      const personalAdjustments = adjustments.filter(
        adj => adj.employeeId === emp.id && adj.date.substring(0, 7) === selectedMonth
      );

      const totalBonuses = personalAdjustments
        .filter(adj => adj.type === 'bonus')
        .reduce((acc, curr) => acc + curr.amount, 0);

      const totalPenalties = personalAdjustments
        .filter(adj => adj.type === 'penalty')
        .reduce((acc, curr) => acc + curr.amount, 0);

      const finalSalary = Math.max(0, baseEarned + totalBonuses - totalPenalties);
      const workingDays = personalAttendance.filter(l => l.status !== 'absent').length;

      // Clean comma out of names just in case
      const cleanName = emp.name.replace(/,/g, '');
      const cleanRole = emp.role.replace(/,/g, '');

      csvContent += `${emp.id},${cleanName},${cleanRole},${totalHours},${workingDays},${finalSalary}\r\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", encodedUri);
    downloadAnchor.setAttribute("download", `Bảng_Lương_Tháng_${selectedMonth}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // 3. Download CSV Templates for Users
  const downloadTemplate = (type: 'employees' | 'attendance') => {
    playClick();
    let csvContent = 'data:text/csv;charset=utf-8,\uFEFF';
    
    if (type === 'employees') {
      csvContent += 'id,name,role,hourlyRate,password,shiftStartTime,shiftEndTime\r\n';
      csvContent += 'emp-99,Nguyễn Văn A,Nhân viên trà sữa,25000,123,15:00,23:00\r\n';
      csvContent += 'emp-100,Trần Thị B,Quản lý ca,35000,abc,18:00,01:00\r\n';
    } else {
      csvContent += 'id,employeeId,date,hoursWorked,status,rateMultiplier,notes,inTime,outTime,shiftId\r\n';
      csvContent += `att-99,emp-01,2026-07-02,8,present,1.0,Chấm công mẫu,15:00,23:00,CA-CHIEU\r\n`;
      csvContent += `att-100,emp-02,2026-07-02,0,absent,0,Nghỉ phép,,,\r\n`;
    }

    const encodedUri = encodeURI(csvContent);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", encodedUri);
    downloadAnchor.setAttribute("download", `Mẫu_${type === 'employees' ? 'Nhân_Sự' : 'Chấm_Công'}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Drag & drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      processFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      processFile(file);
    }
  };

  // Process and parse CSV / JSON files
  const processFile = (file: File) => {
    setFileName(file.name);
    setPreviewData([]);
    setValidationErrors([]);
    playClick();

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        
        // Handle JSON format
        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(text);
          let listToVerify: any[] = [];
          if (Array.isArray(parsed)) {
            listToVerify = parsed;
          } else if (importType === 'employees' && parsed.employees) {
            listToVerify = parsed.employees;
          } else if (importType === 'attendance' && parsed.attendance) {
            listToVerify = parsed.attendance;
          } else {
            listToVerify = [parsed];
          }
          validateAndSetPreview(listToVerify);
        } 
        // Handle CSV format
        else {
          const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
          if (lines.length < 2) {
            setValidationErrors(['Tập tin CSV rỗng hoặc không có dữ liệu hàng mẫu.']);
            return;
          }

          const headers = lines[0].replace(/^\uFEFF/, '').split(',').map(h => h.trim());
          const parsedList: any[] = [];

          for (let i = 1; i < lines.length; i++) {
            const columns = lines[i].split(',').map(col => col.trim());
            if (columns.length < headers.length) continue;

            const rowObject: any = {};
            headers.forEach((header, index) => {
              rowObject[header] = columns[index];
            });
            parsedList.push(rowObject);
          }
          validateAndSetPreview(parsedList);
        }
      } catch (err) {
        console.error(err);
        setValidationErrors([`Không thể đọc tập tin: ${err instanceof Error ? err.message : 'Lỗi định dạng'}`]);
      }
    };
    reader.readAsText(file);
  };

  // Verify fields meet types
  const validateAndSetPreview = (rawList: any[]) => {
    const errors: string[] = [];
    const verifiedList: any[] = [];

    if (importType === 'employees') {
      rawList.forEach((item, index) => {
        const rowNum = index + 1;
        if (!item.id || item.id === '') {
          errors.push(`Dòng ${rowNum}: Thiếu mã ID nhân sự ('id')`);
        }
        if (!item.name || item.name === '') {
          errors.push(`Dòng ${rowNum}: Thiếu tên nhân viên ('name')`);
        }
        
        const rate = Number(item.hourlyRate || 0);
        if (isNaN(rate) || rate <= 0) {
          errors.push(`Dòng ${rowNum}: Lương giờ ('hourlyRate') phải là số dương`);
        }

        verifiedList.push({
          id: item.id || `emp-auto-${Math.floor(Math.random() * 1000)}`,
          name: item.name || 'N/A',
          role: item.role || 'Nhân viên',
          hourlyRate: isNaN(rate) ? 25000 : rate,
          password: item.password || '123',
          shiftStartTime: item.shiftStartTime || '15:00',
          shiftEndTime: item.shiftEndTime || '01:00',
          createdAt: item.createdAt || new Date().toISOString().split('T')[0]
        });
      });
    } else {
      // Attendance logs verification
      rawList.forEach((item, index) => {
        const rowNum = index + 1;
        if (!item.id) {
          errors.push(`Dòng ${rowNum}: Thiếu mã chấm công ('id')`);
        }
        if (!item.employeeId) {
          errors.push(`Dòng ${rowNum}: Thiếu mã nhân viên liên kết ('employeeId')`);
        }
        if (!item.date || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
          errors.push(`Dòng ${rowNum}: Ngày ('date') phải đúng định dạng YYYY-MM-DD`);
        }

        const hrs = Number(item.hoursWorked || 0);
        const mult = Number(item.rateMultiplier || 1.0);

        verifiedList.push({
          id: item.id || `att-auto-${Math.floor(Math.random() * 10000)}`,
          employeeId: item.employeeId || '',
          date: item.date || '',
          hoursWorked: isNaN(hrs) ? 8 : hrs,
          status: item.status || 'present',
          rateMultiplier: isNaN(mult) ? 1.0 : mult,
          notes: item.notes || '',
          inTime: item.inTime || '15:00',
          outTime: item.outTime || '23:00',
          shiftId: item.shiftId || 'CA-CHIEU'
        });
      });
    }

    setValidationErrors(errors);
    setPreviewData(verifiedList);
  };

  // Commit verified preview rows to Firebase Firestore
  const handleImportCommit = async () => {
    if (previewData.length === 0 || validationErrors.length > 0) return;

    playClick();
    setIsProcessing(true);

    try {
      const collectionName = importType === 'employees' ? 'employees' : 'attendance';
      
      const promises = previewData.map(item => {
        return setDoc(doc(db, collectionName, item.id), item);
      });

      await Promise.all(promises);
      playChime();
      alert(`Nhập thành công ${previewData.length} bản ghi vào cơ sở dữ liệu!`);
      
      // Cleanup
      setPreviewData([]);
      setFileName('');
      
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error(err);
      alert(`Đã xảy ra lỗi khi lưu vào Firestore: ${err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div id="data-migration-panel" className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      
      {/* EXPORT SIDE PANEL */}
      <div className="lg:col-span-5 p-5 bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl h-fit space-y-4">
        <div className="flex items-center space-x-2 border-b border-[#f2f2ee] dark:border-[#2c2c28] pb-2">
          <Database className="w-4.5 h-4.5 text-amber-500" />
          <h3 className="text-xs font-semibold font-mono text-[#1c1c1a] dark:text-[#fbfbfa] uppercase tracking-wider">
            Trung Tâm Xuất Bản & Sao Lưu (Export Center)
          </h3>
        </div>

        <p className="text-xs text-[#5c5c54] dark:text-[#acaca0] leading-relaxed">
          Tải xuống báo cáo hoặc sao lưu toàn bộ dữ liệu cấu trúc cửa hàng để lưu trữ ngoại tuyến hoặc di trú hệ thống.
        </p>

        <div className="space-y-3 pt-2">
          
          {/* Action 1 */}
          <div className="p-3.5 bg-[#fbfbfa] dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-[#1c1c1a] dark:text-white">Bảng Lương CSV (Tháng {selectedMonth})</p>
              <p className="text-[10px] text-[#8c8c80] mt-0.5">Xuất bảng lương chi tiết của tháng được chọn</p>
            </div>
            <button
              onClick={handleExportPayrollCSV}
              className="p-2 bg-[#1c1c1a] hover:bg-black text-white dark:bg-white dark:text-[#1c1c1a] rounded-lg cursor-pointer transition-all shrink-0"
              title="Xuất bảng lương CSV"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>

          {/* Action 2 */}
          <div className="p-3.5 bg-[#fbfbfa] dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-[#1c1c1a] dark:text-white">Sao Lưu Toàn Bộ Dữ Liệu (JSON)</p>
              <p className="text-[10px] text-[#8c8c80] mt-0.5">Gồm: Nhân sự, Chấm công, Ca kíp, Thưởng phạt</p>
            </div>
            <button
              onClick={handleExportFullJSON}
              className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg cursor-pointer transition-all shrink-0"
              title="Sao lưu hệ thống JSON"
            >
              <Database className="w-4 h-4" />
            </button>
          </div>

        </div>

        <div className="pt-3 border-t border-[#f2f2ee] dark:border-[#2c2c28]">
          <span className="text-[10px] font-mono font-semibold text-[#8c8c80] uppercase">Mẫu Tệp Tin Để Nhập Dữ Liệu:</span>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button
              onClick={() => downloadTemplate('employees')}
              className="flex items-center justify-center gap-1.5 p-2 bg-white dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl text-[10px] font-bold text-[#5c5c54] dark:text-[#acaca0] hover:bg-gray-50 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Mẫu Nhân Sự</span>
            </button>
            <button
              onClick={() => downloadTemplate('attendance')}
              className="flex items-center justify-center gap-1.5 p-2 bg-white dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl text-[10px] font-bold text-[#5c5c54] dark:text-[#acaca0] hover:bg-gray-50 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Mẫu Chấm Công</span>
            </button>
          </div>
        </div>

      </div>

      {/* IMPORT CENTER PANEL */}
      <div className="lg:col-span-7 p-5 bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-[#f2f2ee] dark:border-[#2c2c28] pb-2">
          <div className="flex items-center space-x-2">
            <Upload className="w-4.5 h-4.5 text-indigo-500" />
            <h3 className="text-xs font-semibold font-mono text-[#1c1c1a] dark:text-[#fbfbfa] uppercase tracking-wider">
              Nhập Dữ Liệu Đồng Bộ Linh Hoạt (Import Center)
            </h3>
          </div>

          <div className="flex bg-[#fbfbfa] dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] p-0.5 rounded-lg text-[9px] font-mono font-bold uppercase">
            <button
              onClick={() => { playClick(); setImportType('employees'); setPreviewData([]); setFileName(''); }}
              className={`px-2 py-1 rounded transition-all cursor-pointer ${importType === 'employees' ? 'bg-[#1c1c1a] text-white' : 'text-[#8c8c80]'}`}
            >
              Nhân Sự
            </button>
            <button
              onClick={() => { playClick(); setImportType('attendance'); setPreviewData([]); setFileName(''); }}
              className={`px-2 py-1 rounded transition-all cursor-pointer ${importType === 'attendance' ? 'bg-[#1c1c1a] text-white' : 'text-[#8c8c80]'}`}
            >
              Chấm Công
            </button>
          </div>
        </div>

        {/* File Drag-and-Drop Area */}
        <div
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center text-center transition-all min-h-36 relative cursor-pointer ${
            dragActive 
              ? 'border-indigo-500 bg-indigo-50/20' 
              : 'border-[#c8c8c0] dark:border-[#2c2c28] hover:border-[#1c1c1a] dark:hover:border-white'
          }`}
        >
          <input
            id="file-upload-input"
            type="file"
            accept=".csv,.json"
            onChange={handleFileChange}
            className="hidden"
          />
          <label htmlFor="file-upload-input" className="absolute inset-0 cursor-pointer" />

          <div className="space-y-1.5 pointer-events-none">
            <Upload className="w-8 h-8 text-[#8c8c80] mx-auto animate-bounce" />
            <p className="text-xs font-bold text-[#1c1c1a] dark:text-white">
              {fileName ? `Đã nạp: ${fileName}` : `Kéo & Thả hoặc Click để tải tệp .CSV hoặc .JSON`}
            </p>
            <p className="text-[10px] text-[#8c8c80]">
              Đang chọn chế độ nhập: <strong>{importType === 'employees' ? 'Danh Sách Nhân Sự' : 'Bảng Công Lịch Sử'}</strong>
            </p>
          </div>
        </div>

        {/* Validation and Preview Block */}
        {validationErrors.length > 0 && (
          <div className="p-3.5 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 rounded-xl space-y-1.5 text-[11px] text-red-700 dark:text-red-400">
            <div className="flex items-center gap-1.5 font-bold">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span>Phát hiện lỗi định dạng dữ liệu ({validationErrors.length} lỗi):</span>
            </div>
            <ul className="list-disc list-inside max-h-24 overflow-y-auto space-y-0.5">
              {validationErrors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {previewData.length > 0 && validationErrors.length === 0 && (
          <div className="space-y-3 animate-in slide-in-from-bottom-2 duration-200">
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 rounded-xl flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-400">
              <span className="flex items-center gap-1.5 font-bold">
                <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500" />
                Dữ liệu hoàn toàn hợp lệ! Sẵn sàng đồng bộ ({previewData.length} bản ghi).
              </span>
              <button
                onClick={() => { playClick(); setPreviewData([]); setFileName(''); }}
                className="text-[10px] text-gray-400 hover:text-red-600 font-semibold font-mono"
              >
                HỦY BỎ
              </button>
            </div>

            {/* Table Preview */}
            <div className="border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl overflow-hidden max-h-48 overflow-y-auto bg-[#fbfbfa] dark:bg-[#121211]">
              <table className="w-full text-left text-[11px] font-mono">
                <thead className="bg-[#f2f2ee] dark:bg-[#1c1c1a] border-b border-[#e4e4db] dark:border-[#2c2c28] text-[#5c5c54] dark:text-[#acaca0] sticky top-0">
                  {importType === 'employees' ? (
                    <tr>
                      <th className="px-3 py-2">ID</th>
                      <th className="px-3 py-2">Tên</th>
                      <th className="px-3 py-2">Chức Vụ</th>
                      <th className="px-3 py-2">Mức Lương/h</th>
                    </tr>
                  ) : (
                    <tr>
                      <th className="px-3 py-2">Mã Công</th>
                      <th className="px-3 py-2">Nhân Viên</th>
                      <th className="px-3 py-2">Ngày</th>
                      <th className="px-3 py-2">Giờ Làm</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {previewData.slice(0, 50).map((row, idx) => (
                    <tr key={idx} className="border-b border-[#f2f2ee] dark:border-[#2c2c28] text-[#1c1c1a] dark:text-gray-300">
                      {importType === 'employees' ? (
                        <>
                          <td className="px-3 py-1.5 font-bold">{row.id}</td>
                          <td className="px-3 py-1.5">{row.name}</td>
                          <td className="px-3 py-1.5">{row.role}</td>
                          <td className="px-3 py-1.5">{formatVND(row.hourlyRate)}</td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-1.5 font-bold">{row.id}</td>
                          <td className="px-3 py-1.5">{row.employeeId}</td>
                          <td className="px-3 py-1.5">{row.date}</td>
                          <td className="px-3 py-1.5">{row.hoursWorked} giờ</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewData.length > 50 && (
                <p className="text-center p-2 text-[10px] text-gray-400 italic">... Và {previewData.length - 50} bản ghi khác được ẩn.</p>
              )}
            </div>

            <button
              onClick={handleImportCommit}
              disabled={isProcessing}
              className="w-full bg-[#1c1c1a] hover:bg-black text-white dark:bg-white dark:text-[#1c1c1a] font-bold text-xs py-3 rounded-xl transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isProcessing ? 'animate-spin' : ''}`} />
              {isProcessing ? 'Đang cập nhật lên đám mây...' : `Tiến Hành Nhập & Lưu ${previewData.length} Bản Ghi Lên Hệ Thống`}
            </button>
          </div>
        )}

      </div>

    </div>
  );
}
