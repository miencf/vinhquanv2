import { Solar } from 'lunar-javascript';

const LUNAR_CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
const LUNAR_CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];

export interface LunarDate {
  day: number;
  month: number;
  year: number;
  isLeap: boolean;
  yearCanChi: string;
}

export function getLunarDate(date: Date): LunarDate {
  try {
    const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const lunar = solar.getLunar();
    
    const day = lunar.getDay();
    const rawMonth = lunar.getMonth();
    const year = lunar.getYear();
    
    const isLeap = rawMonth < 0;
    const month = Math.abs(rawMonth);
    
    // Calculate Vietnamese Can Chi for Year
    let canIdx = (year - 4) % 10;
    if (canIdx < 0) canIdx += 10;
    
    let chiIdx = (year - 4) % 12;
    if (chiIdx < 0) chiIdx += 12;
    
    const yearCanChi = `${LUNAR_CAN[canIdx]} ${LUNAR_CHI[chiIdx]}`;
    
    return {
      day,
      month,
      year,
      isLeap,
      yearCanChi
    };
  } catch (err) {
    console.error('Error converting solar to lunar:', err);
    // Fallback safe calculation if error occurs
    return {
      day: date.getDate(),
      month: date.getMonth() + 1,
      year: date.getFullYear(),
      isLeap: false,
      yearCanChi: ''
    };
  }
}

export function getLunarDateString(date: Date): string {
  const lunar = getLunarDate(date);
  if (!lunar.yearCanChi) return '';
  return `Ngày ${lunar.day} tháng ${lunar.month}${lunar.isLeap ? ' (nhuận)' : ''}, năm ${lunar.yearCanChi} (Âm lịch)`;
}
