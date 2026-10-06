import { useState, useEffect } from 'react';
import { Quote, RefreshCw } from 'lucide-react';

type QuoteItem = {
  text: string;
  author: string;
};

const QUOTES: QuoteItem[] = [
  { text: "Hãy sống trọn vẹn trong khoảnh khắc hiện tại.", author: "Thích Nhất Hạnh" },
  { text: "Hành trình vạn dặm bắt đầu từ một bước chân.", author: "Lão Tử" },
  { text: "Sự tập trung là cốt lõi của mọi sức mạnh tinh thần.", author: "Alexandr" },
  { text: "Tĩnh lặng bên trong là khởi nguồn của sáng tạo bên ngoài.", author: "Eckhart Tolle" },
  { text: "Mỗi ngày là một cơ hội mới để học hỏi và bình yên.", author: "Khuyết danh" },
  { text: "Làm việc có tâm, tự khắc mọi sự sẽ an yên.", author: "Cổ nhân" },
  { text: "Đừng lo lắng về tương lai, hãy vun đắp cho hiện tại.", author: "Marcus Aurelius" }
];

export default function QuoteBox() {
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [isChanging, setIsChanging] = useState(false);

  useEffect(() => {
    // Automatically change quote every 60 seconds
    const interval = setInterval(() => {
      triggerNewQuote();
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const triggerNewQuote = () => {
    setIsChanging(true);
    setTimeout(() => {
      setQuoteIndex((prev) => (prev + 1) % QUOTES.length);
      setIsChanging(false);
    }, 4000); // 400ms CSS transition
  };

  const currentQuote = QUOTES[quoteIndex];

  return (
    <div id="quote-box" className="p-5 rounded-2xl bg-white border border-[#e4e4db] dark:border-[#2c2c28] dark:bg-[#1c1c1a]/90 flex items-start gap-4 transition-all duration-300 shadow-xs">
      <div className="p-2 bg-[#f8fafc] dark:bg-[#12131a] rounded-xl border border-[#e4e4db] dark:border-[#2c2c28] text-[#8c8c80] dark:text-[#acaca0] shrink-0 shadow-xs">
        <Quote className="w-4 h-4 fill-current" />
      </div>
      
      <div className="flex-1 min-w-0 self-center">
        <p className={`text-[13.5px] font-medium leading-relaxed text-[#1c1c1a] dark:text-white transition-all duration-400 ${isChanging ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0'}`}>
          "{currentQuote.text}"
        </p>
        <p className={`text-[11px] font-mono tracking-wider text-[#8c8c80] dark:text-[#acaca0] mt-1.5 transition-all duration-400 ${isChanging ? 'opacity-0' : 'opacity-100'}`}>
          — {currentQuote.author}
        </p>
      </div>

      <button
        onClick={triggerNewQuote}
        title="Đổi câu nói"
        className="p-1.5 hover:bg-[#e4e4db] dark:hover:bg-[#2c2c28] rounded-lg text-[#8c8c80] dark:text-[#acaca0] transition-all self-center shrink-0 cursor-pointer"
      >
        <RefreshCw className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
