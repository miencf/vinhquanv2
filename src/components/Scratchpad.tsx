import { useState, useEffect } from 'react';
import { FileText, Trash2, CheckSquare, ListPlus, Copy, Sparkles } from 'lucide-react';

export default function Scratchpad() {
  const [text, setText] = useState(() => {
    return localStorage.getItem('ambient_scratchpad_text') || '';
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    localStorage.setItem('ambient_scratchpad_text', text);
  }, [text]);

  const handleClear = () => {
    if (text.trim() === '') return;
    if (confirm('Bạn có chắc chắn muốn xóa toàn bộ nội dung ghi chú này?')) {
      setText('');
    }
  };

  const insertFormat = (formatType: 'bullet' | 'todo') => {
    const textarea = document.getElementById('scratchpad-textarea') as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentText = text;

    let insertion = '';
    if (formatType === 'bullet') {
      insertion = '\n- ';
    } else if (formatType === 'todo') {
      insertion = '\n[ ] ';
    }

    const newText = currentText.substring(0, start) + insertion + currentText.substring(end);
    setText(newText);

    // Set focus back and adjust cursor position
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + insertion.length, start + insertion.length);
    }, 0);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const wordCount = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
  const charCount = text.length;

  return (
    <div id="scratchpad-widget" className="p-6 rounded-2xl bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] shadow-xs flex flex-col h-full min-h-[380px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 bg-[#fbfbfa] dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] rounded-lg text-[#5c5c54] dark:text-[#acaca0]">
            <FileText className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-semibold tracking-wider text-[#8c8c80] uppercase">Ghi chú nhanh</h3>
        </div>
        
        {/* Actions */}
        <div className="flex items-center space-x-1">
          <button
            onClick={() => insertFormat('bullet')}
            title="Thêm danh sách"
            className="p-2 hover:bg-[#f2f2ee] dark:hover:bg-[#2c2c28] rounded-lg transition-colors text-[#5c5c54] dark:text-[#acaca0]"
          >
            <ListPlus className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertFormat('todo')}
            title="Thêm công việc cần làm"
            className="p-2 hover:bg-[#f2f2ee] dark:hover:bg-[#2c2c28] rounded-lg transition-colors text-[#5c5c54] dark:text-[#acaca0]"
          >
            <CheckSquare className="w-4 h-4" />
          </button>
          <button
            onClick={handleCopy}
            title="Sao chép tất cả"
            className="p-2 hover:bg-[#f2f2ee] dark:hover:bg-[#2c2c28] rounded-lg transition-colors text-[#5c5c54] dark:text-[#acaca0] relative"
          >
            <Copy className={`w-4 h-4 transition-transform ${copied ? 'scale-110 text-emerald-600' : ''}`} />
            {copied && (
              <span className="absolute -top-8 right-0 bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] text-[10px] px-1.5 py-0.5 rounded-sm whitespace-nowrap">
                Đã sao chép!
              </span>
            )}
          </button>
          <button
            onClick={handleClear}
            disabled={text.trim() === ''}
            title="Xóa hết"
            className="p-2 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-600 rounded-lg transition-colors text-[#8c8c80] disabled:opacity-40"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Textarea Area */}
      <div className="flex-1 relative mb-3">
        <textarea
          id="scratchpad-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Viết một ý tưởng, danh sách công việc, hay bất kỳ suy nghĩ nào tại đây..."
          className="w-full h-full min-h-[220px] bg-transparent border-0 outline-none resize-none text-[#1c1c1a] dark:text-[#fbfbfa] placeholder-[#acaca0] leading-relaxed text-[15px] focus:ring-0 p-0 font-sans"
        />
      </div>

      {/* Footer Metrics */}
      <div className="flex items-center justify-between pt-3 border-t border-[#f2f2ee] dark:border-[#2c2c28] text-xs font-mono text-[#8c8c80]">
        <div className="flex items-center space-x-3">
          <span>{wordCount} từ</span>
          <span>•</span>
          <span>{charCount} ký tự</span>
        </div>
        <div className="flex items-center space-x-1 text-amber-600/80">
          <Sparkles className="w-3 h-3 animate-spin duration-3000" />
          <span className="text-[10px] uppercase tracking-wider">Tự động lưu</span>
        </div>
      </div>
    </div>
  );
}
