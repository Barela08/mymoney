import React from 'react';
import { Search, Mic, MicOff, X } from 'lucide-react';
import { useVoiceInput } from '../../lib/useVoiceInput';

interface SearchVoiceBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export const SearchVoiceBar: React.FC<SearchVoiceBarProps> = ({
  value,
  onChange,
  onSearch,
  placeholder = 'Search records, categories, descriptions...',
  className = '',
  autoFocus = false,
}) => {
  const {
    isListening,
    startListening,
    stopListening,
    language,
  } = useVoiceInput({
    onResult: (spokenText) => {
      onChange(spokenText);
      onSearch(spokenText);
    },
  });

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSearch(value);
    }
  };

  const handleClear = () => {
    onChange('');
    onSearch('');
  };

  return (
    <div className={`flex items-center gap-1.5 sm:gap-2 w-full ${className}`}>
      <div className="relative flex-1 min-w-0">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
          <Search className="w-4 h-4" />
        </div>

        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus={autoFocus}
          placeholder={
            isListening ? 'Listening (सुन रहे हैं)...' : placeholder
          }
          className={`w-full pl-9 pr-8 py-2 text-xs sm:text-sm rounded-xl border transition-all focus:outline-none focus:ring-2 ${
            isListening
              ? 'border-rose-400 bg-rose-50/50 dark:bg-rose-950/30 text-rose-900 dark:text-rose-100 placeholder:text-rose-400 focus:ring-rose-500'
              : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:ring-emerald-500'
          }`}
        />

        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            title="Clear search"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Voice Mic Button */}
      <button
        type="button"
        onClick={() => {
          if (isListening) stopListening();
          else void startListening();
        }}
        className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 transition-all cursor-pointer ${
          isListening
            ? 'bg-rose-500 text-white animate-pulse ring-2 ring-rose-400 shadow-md shadow-rose-500/30'
            : 'bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 shadow-2xs'
        }`}
        title={isListening ? 'Click to stop listening' : `Voice search (${language === 'hi-IN' ? 'Hindi' : 'English'})`}
        aria-label="Voice search"
      >
        {isListening ? (
          <MicOff className="w-4 h-4 text-white" />
        ) : (
          <Mic className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        )}
      </button>

      {/* Search Button */}
      <button
        type="button"
        onClick={() => onSearch(value)}
        className="h-9 px-3 sm:px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-1.5 shrink-0 transition-colors shadow-xs cursor-pointer whitespace-nowrap"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Search</span>
      </button>
    </div>
  );
};
