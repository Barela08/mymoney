import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Sparkles,
  Send,
  Plus,
  Trash2,
  MessageSquare,
  RefreshCw,
  AlertCircle,
  Lock,
  Pencil,
  Check,
  X,
  PanelLeftOpen,
  PanelLeftClose,
  Bot,
  User as UserIcon,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Radio,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import { budgetApi, recurringBillsApi, savingsGoalsApi, UserBudget, RecurringBill, SavingsGoal } from '../../lib/financialFeaturesApi';
import { aiFinanceApi, AiConversation, AiStatusResponse, ApiClientError } from '../../lib/aiFinanceApi';
import {
  buildAiFinancialContext,
  calculateNetWorth,
  calculateSafeToSpend,
  DEFAULT_SAFE_TO_SPEND_PREFS,
  NetWorthAsset,
  NetWorthLiability,
  NetWorthSettings,
  SafeToSpendPreferences,
} from '../../lib/financialIntelligenceEngine';
import { formatINR } from '../../lib/dateUtils';
import { ConfirmModal } from '../common/ConfirmModal';
import { AiCompanionMark } from './AiCompanionMark';
import {
  PRIVACY_CHANGED_EVENT,
  hasOptionalConsent,
  privacyConsentApi,
} from '../../lib/privacyConsentApi';

const SUGGESTED_QUESTIONS: string[] = [
  'How much did I spend this month?',
  'Where did most of my money go this month?',
  'Compare this month vs last month spending',
  'What is my biggest expense this month?',
  'How much can I safely spend today?',
  'Which bills are due soon?',
  'How are my monthly budgets doing?',
  'How close am I to my savings goals?',
  'What is my current Net Worth breakdown?',
  'Summarize my Udhar receivables and payables',
  'Give me 3 practical ways to cut my expenses based on my data',
  'How has my income vs spending trended over the last 6 months?',
];

interface AiAssistantSectionProps {
  initialPrompt?: string | null;
  onClearInitialPrompt?: () => void;
}

export const AiAssistantSection: React.FC<AiAssistantSectionProps> = ({
  initialPrompt,
  onClearInitialPrompt,
}) => {
  const { transactions, summary, peopleSummaries } = useExpense();
  const toast = useToast();

  const [aiStatus, setAiStatus] = useState<AiStatusResponse | null>(null);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [autoSpeakReplies, setAutoSpeakReplies] = useState(true);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const voiceTranscriptRef = useRef<string>('');
  const voiceSubmittedRef = useRef<boolean>(false);
  const speakTextRef = useRef<(text: string, msgId?: string) => void>(() => {});
  const handleSendRef = useRef<(q?: string, opts?: { fromVoice?: boolean }) => Promise<void>>(async () => {});
  const [speechLang, setSpeechLang] = useState<'hi-IN' | 'en-IN'>('hi-IN');
  const inputRef = useRef<HTMLInputElement>(null);
  const [lastError, setLastError] = useState<{ message: string; code?: string; retryQuestion?: string } | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [hasAiConsent, setHasAiConsent] = useState<boolean>(() => hasOptionalConsent('ai_processing'));
  const [isGrantingAiConsent, setIsGrantingAiConsent] = useState<boolean>(false);

  useEffect(() => {
    const syncConsent = () => setHasAiConsent(hasOptionalConsent('ai_processing'));
    window.addEventListener(PRIVACY_CHANGED_EVENT, syncConsent);
    // Sync authoritative server status once on mount
    privacyConsentApi
      .fetchConsents()
      .then((res) => setHasAiConsent(Boolean(res.choices.ai_processing)))
      .catch(() => {});
    return () => window.removeEventListener(PRIVACY_CHANGED_EVENT, syncConsent);
  }, []);

  const handleEnableAiConsent = async () => {
    if (isGrantingAiConsent) return;
    setIsGrantingAiConsent(true);
    try {
      await privacyConsentApi.saveSingleConsent({
        purpose: 'ai_processing',
        status: 'granted',
        source: 'ai_assistant_prompt',
        language: 'en',
      });
      setHasAiConsent(true);
      setLastError(null);
      toast.success(
        'AI External Processing enabled',
        'You can withdraw this optional consent anytime in Settings → Privacy → Manage Consent.'
      );
    } catch (err: any) {
      toast.error(
        'Could not save consent',
        err?.message || 'Please check your connection and try again.'
      );
    } finally {
      setIsGrantingAiConsent(false);
    }
  };

  // Rename state
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  // Real financial data from companion modules
  const [budgets, setBudgets] = useState<UserBudget[]>([]);
  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [nwAssets, setNwAssets] = useState<NetWorthAsset[]>([]);
  const [nwLiabilities, setNwLiabilities] = useState<NetWorthLiability[]>([]);
  const [nwSettings, setNwSettings] = useState<NetWorthSettings>({
    includeLiquidBalance: true,
    includeUdharReceivables: true,
    includeUdharPayables: true,
  });
  const [stsPrefs, setStsPrefs] = useState<SafeToSpendPreferences>(DEFAULT_SAFE_TO_SPEND_PREFS);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initialPromptHandledRef = useRef<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoadingInitial(true);
    try {
      const [convRes, budRes, billRes, goalRes, nwRes, stsRes] = await Promise.all([
        aiFinanceApi.getConversations().catch(async () => {
          const st = await aiFinanceApi.getAiStatus().catch(() => null);
          return { conversations: [], status: st || { configured: false, provider: 'gemini' as const, model: 'gemini-3.5-flash-lite', ocrSupported: false } };
        }),
        budgetApi.getBudgets().catch(() => ({ success: true, budgets: [] })),
        recurringBillsApi.getBills().catch(() => ({ success: true, bills: [] })),
        savingsGoalsApi.getGoals().catch(() => ({ success: true, goals: [] })),
        aiFinanceApi.getNetWorthData().catch(() => null),
        aiFinanceApi.getSafeToSpendPreferences().catch(() => DEFAULT_SAFE_TO_SPEND_PREFS),
      ]);

      setAiStatus(convRes.status);
      setConversations(convRes.conversations || []);
      if (convRes.conversations && convRes.conversations.length > 0) {
        setActiveConvId((prev) => prev || convRes.conversations[0].id);
      }
      setBudgets(budRes.budgets || []);
      setBills(billRes.bills || []);
      setGoals(goalRes.goals || []);
      if (nwRes) {
        setNwAssets(nwRes.assets || []);
        setNwLiabilities(nwRes.liabilities || []);
        if (nwRes.settings) setNwSettings(nwRes.settings);
      }
      if (stsRes) setStsPrefs(stsRes);
    } finally {
      setIsLoadingInitial(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConvId) || null,
    [conversations, activeConvId]
  );

  // Build real, accounting-accurate financial context snapshot for ONLY the authenticated user
  const financialContext = useMemo(() => {
    const udharReceivable = peopleSummaries
      .filter((p) => p.outstandingBalance > 0)
      .reduce((s, p) => s + p.outstandingBalance, 0);
    const udharPayable = peopleSummaries
      .filter((p) => p.outstandingBalance < 0)
      .reduce((s, p) => s + Math.abs(p.outstandingBalance), 0);

    const netWorth = calculateNetWorth({
      assets: nwAssets,
      liabilities: nwLiabilities,
      availableBalance: summary.availableBalance,
      udharReceivable,
      udharPayable,
      settings: nwSettings,
    });

    const safeToSpend = calculateSafeToSpend({
      availableBalance: summary.availableBalance,
      transactions,
      recurringBills: bills,
      budgets,
      savingsGoals: goals,
      preferences: stsPrefs,
    });

    return buildAiFinancialContext({
      transactions,
      availableBalance: summary.availableBalance,
      budgets,
      recurringBills: bills,
      savingsGoals: goals,
      udharReceivable,
      udharPayable,
      activePeopleCount: peopleSummaries.length,
      netWorth,
      safeToSpend,
    });
  }, [transactions, summary.availableBalance, budgets, bills, goals, peopleSummaries, nwAssets, nwLiabilities, nwSettings, stsPrefs]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversation?.messages.length, isSending]);

  const stripMarkdownForSpeech = useCallback((text: string): string => {
    return text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[*_`#>~]/g, '')
      .replace(/₹\s?/g, 'rupees ')
      .replace(/\s+/g, ' ')
      .trim();
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    setSpeakingMsgId(null);
    setVoiceState((prev) => (prev === 'speaking' ? 'idle' : prev));
  }, []);

  const speakText = useCallback(
    (text: string, msgId?: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      const clean = stripMarkdownForSpeech(text);
      if (!clean) return;

      try {
        window.speechSynthesis.cancel();
      } catch {}

      const utterance = new SpeechSynthesisUtterance(clean);
      const hasDevanagari = /[\u0900-\u097F]/.test(clean);
      const targetLang = hasDevanagari ? 'hi-IN' : speechLang;
      utterance.lang = targetLang;
      utterance.rate = 1.0;

      const voices = window.speechSynthesis.getVoices?.() || [];
      const matchingVoice =
        voices.find((v) => v.lang?.toLowerCase() === targetLang.toLowerCase()) ||
        voices.find((v) => v.lang?.toLowerCase().startsWith(targetLang.split('-')[0].toLowerCase()));
      if (matchingVoice) {
        utterance.voice = matchingVoice;
      }

      utterance.onstart = () => {
        setSpeakingMsgId(msgId || 'voice_reply');
        setVoiceState('speaking');
      };
      utterance.onend = () => {
        setSpeakingMsgId(null);
        setVoiceState((prev) => (prev === 'speaking' ? 'idle' : prev));
      };
      utterance.onerror = () => {
        setSpeakingMsgId(null);
        setVoiceState((prev) => (prev === 'speaking' ? 'idle' : prev));
      };

      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        setSpeakingMsgId(null);
        setVoiceState('idle');
      }
    },
    [speechLang, stripMarkdownForSpeech]
  );

  useEffect(() => {
    speakTextRef.current = speakText;
  }, [speakText]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {}
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {}
      }
    };
  }, []);

  const handleSend = useCallback(
    async (questionOverride?: string, options?: { fromVoice?: boolean }) => {
      const q = (questionOverride ?? inputText).trim();
      if (!q || isSending) return;
      const fromVoice = Boolean(options?.fromVoice);

      if (!hasAiConsent) {
        setVoiceState('idle');
        setLastError({
          code: 'AI_CONSENT_REQUIRED',
          message:
            'AI External Processing consent is currently off. No financial data was sent externally. Enable AI External Processing above or in Settings → Privacy → Manage Consent to ask the AI assistant.',
          retryQuestion: q,
        });
        return;
      }

      setLastError(null);
      if (!questionOverride && !fromVoice) setInputText('');
      setIsSending(true);
      if (fromVoice) {
        setVoiceState('thinking');
      }

      // Optimistic temporary message display
      const tempConvId = activeConvId || `temp_${Date.now()}`;
      const tempMsgId = `temp_u_${Date.now()}`;
      const nowIso = new Date().toISOString();

      setConversations((prev) => {
        const exists = prev.find((c) => c.id === tempConvId);
        if (exists) {
          return prev.map((c) =>
            c.id === tempConvId
              ? { ...c, messages: [...c.messages, { id: tempMsgId, role: 'user', content: q, created_at: nowIso }] }
              : c
          );
        }
        return [
          {
            id: tempConvId,
            title: q.slice(0, 64),
            created_at: nowIso,
            updated_at: nowIso,
            messages: [{ id: tempMsgId, role: 'user', content: q, created_at: nowIso }],
          },
          ...prev,
        ];
      });
      if (!activeConvId) setActiveConvId(tempConvId);

      try {
        const res = await aiFinanceApi.sendAssistantMessage({
          conversationId: activeConvId && !activeConvId.startsWith('temp_') ? activeConvId : undefined,
          question: q,
          financialContext,
          mode: fromVoice ? 'voice' : 'chat',
        });

        setConversations((prev) => {
          const withoutTemp = prev.filter((c) => c.id !== tempConvId && c.id !== res.conversationId);
          const existingReal = prev.find((c) => c.id === res.conversationId || c.id === tempConvId);
          const baseMessages = (existingReal?.messages || []).filter((m) => m.id !== tempMsgId);
          const updatedConv: AiConversation = {
            id: res.conversationId,
            title: res.conversationTitle,
            created_at: existingReal?.created_at || res.userMessage.created_at,
            updated_at: res.assistantMessage.created_at,
            messages: [...baseMessages, res.userMessage, res.assistantMessage],
          };
          return [updatedConv, ...withoutTemp];
        });
        setActiveConvId(res.conversationId);

        if (fromVoice || autoSpeakReplies) {
          setLiveTranscript('');
          if (res.assistantMessage?.content) {
            speakTextRef.current(res.assistantMessage.content, res.assistantMessage.id);
          } else {
            setVoiceState('idle');
          }
        }
      } catch (err: any) {
        // Rollback optimistic message so user can cleanly retry
        setConversations((prev) =>
          prev
            .map((c) =>
              c.id === tempConvId
                ? { ...c, messages: c.messages.filter((m) => m.id !== tempMsgId) }
                : c
            )
            .filter((c) => !(c.id.startsWith('temp_') && c.messages.length === 0))
        );
        if (tempConvId.startsWith('temp_')) setActiveConvId(null);
        setVoiceState('idle');

        const code = err instanceof ApiClientError ? err.code : undefined;
        const errMsg = err?.message || 'Unable to get a response from AI Money Assistant.';
        setLastError({
          message: errMsg,
          code,
          retryQuestion: q,
        });
        if (fromVoice) {
          speakTextRef.current(errMsg);
        }
      } finally {
        setIsSending(false);
      }
    },
    [inputText, isSending, activeConvId, financialContext, hasAiConsent, autoSpeakReplies]
  );

  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  // Trigger initialPrompt if navigated from Dashboard Quick Ask
  useEffect(() => {
    if (
      initialPrompt &&
      !isLoadingInitial &&
      initialPromptHandledRef.current !== initialPrompt
    ) {
      initialPromptHandledRef.current = initialPrompt;
      handleSend(initialPrompt);
      onClearInitialPrompt?.();
    }
  }, [initialPrompt, isLoadingInitial, handleSend, onClearInitialPrompt]);

  const stopVoiceAgent = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {}
    stopSpeaking();
    setIsListening(false);
    setLiveTranscript('');
    setVoiceState('idle');
  }, [stopSpeaking]);

  // Direct Voice Agent (Speaks question -> auto-submits strictly app-scoped query -> speaks reply aloud)
  const toggleListening = useCallback(async () => {
    if (isListening || voiceState === 'speaking') {
      stopVoiceAgent();
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      toast.error(
        'Voice Agent Unavailable',
        'Aapka browser voice recognition support nahi karta. Google Chrome ya Edge use karein.'
      );
      return;
    }

    stopSpeaking();

    // Step 1: Explicitly request audio permission via getUserMedia
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch (err: any) {
        console.warn('Microphone permission check failed:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          toast.warning(
            'Microphone Blocked',
            'Microphone access is blocked. Click the lock icon in your browser address bar, set Microphone to Allow, and try again.'
          );
          return;
        }
      }
    }

    try {
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.lang = speechLang;
      recognition.continuous = false;
      recognition.interimResults = true;

      voiceTranscriptRef.current = '';
      voiceSubmittedRef.current = false;
      setLiveTranscript('');

      const submitVoiceTranscript = () => {
        if (voiceSubmittedRef.current) return;
        const spoken = voiceTranscriptRef.current.trim();
        if (!spoken) return;
        voiceSubmittedRef.current = true;
        setIsListening(false);
        void handleSendRef.current(spoken, { fromVoice: true });
      };

      recognition.onstart = () => {
        setIsListening(true);
        setVoiceState('listening');
      };

      recognition.onresult = (event: any) => {
        const results = Array.from(event.results || []);
        const transcript = results
          .map((result: any) => result?.[0]?.transcript || '')
          .join('')
          .trim();
        if (transcript) {
          voiceTranscriptRef.current = transcript;
          setLiveTranscript(transcript);
        }
        const hasFinal = results.some((result: any) => Boolean(result?.isFinal));
        if (hasFinal && transcript) {
          try {
            recognition.stop();
          } catch {}
          submitVoiceTranscript();
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event?.error);
        setIsListening(false);
        if (!voiceSubmittedRef.current) {
          setVoiceState('idle');
          setLiveTranscript('');
        }
        if (event?.error === 'not-allowed') {
          toast.warning(
            'Microphone Blocked',
            'Microphone access is blocked. Click the lock icon in your browser address bar, set Microphone to Allow, and try again.'
          );
        } else if (event?.error !== 'no-speech' && event?.error !== 'aborted') {
          toast.error('Voice Agent Error', `Speech error: ${event?.error || 'Unknown error'}`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        if (!voiceSubmittedRef.current && voiceTranscriptRef.current.trim()) {
          submitVoiceTranscript();
        } else if (!voiceSubmittedRef.current) {
          setVoiceState('idle');
          setLiveTranscript('');
        }
      };

      recognition.start();
    } catch (err: any) {
      setIsListening(false);
      setVoiceState('idle');
      toast.error('Microphone Error', err?.message || 'Could not start microphone.');
    }
  }, [isListening, voiceState, speechLang, stopSpeaking, stopVoiceAgent, toast]);

  // Listen for speed-dial custom events from floating AI menu (Voice AI or Chat AI)
  useEffect(() => {
    const handleVoiceTrigger = () => {
      setTimeout(() => {
        toggleListening();
      }, 300);
    };
    const handleChatTrigger = () => {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 300);
    };

    window.addEventListener('start-ai-voice', handleVoiceTrigger);
    window.addEventListener('focus-ai-chat', handleChatTrigger);
    return () => {
      window.removeEventListener('start-ai-voice', handleVoiceTrigger);
      window.removeEventListener('focus-ai-chat', handleChatTrigger);
    };
  }, [toggleListening]);

  const handleNewConversation = () => {
    setActiveConvId(null);
    setLastError(null);
    setIsSidebarOpen(false);
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      await aiFinanceApi.deleteConversation(id);
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (activeConvId === id) {
          setActiveConvId(next[0]?.id || null);
        }
        return next;
      });
      toast.success('Conversation deleted', 'Chat history item removed.');
    } catch (err: any) {
      toast.error('Delete failed', err.message || 'Could not delete conversation.');
    }
  };

  const handleSaveRename = async (id: string) => {
    const clean = editingTitle.trim();
    if (!clean) {
      setEditingConvId(null);
      return;
    }
    try {
      await aiFinanceApi.renameConversation(id, clean);
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: clean } : c)));
      setEditingConvId(null);
    } catch (err: any) {
      toast.error('Rename failed', err.message || 'Could not rename conversation.');
    }
  };

  const handleClearAll = async () => {
    try {
      await aiFinanceApi.clearAllConversations();
      setConversations([]);
      setActiveConvId(null);
      setConfirmClearAll(false);
      toast.success('History cleared', 'All AI conversations have been cleared.');
    } catch (err: any) {
      toast.error('Error', err.message || 'Could not clear history.');
    }
  };

  return (
    <div className="space-y-4 pb-8">
      {/* Compact Grounded Context Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
            <AiCompanionMark size={22} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                AI Money Assistant
              </h1>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-md border border-emerald-200/60 dark:border-emerald-800/50">
                <Lock className="w-3 h-3" />
                Read-only · Your Data Only
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Grounded in {financialContext.totals.totalTransactionCount} records · Available Balance{' '}
              <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                {formatINR(financialContext.totals.availableBalance)}
              </span>{' '}
              · This Month Spend{' '}
              <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                {formatINR(financialContext.totals.thisMonthExpenses)}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsSidebarOpen((v) => !v)}
            className="lg:hidden inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
          >
            {isSidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            <span>History ({conversations.length})</span>
          </button>
          <button
            type="button"
            onClick={handleNewConversation}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Chat</span>
          </button>
        </div>
      </div>

      {/* Explicit Optional Consent Gate for AI External Processing */}
      {!hasAiConsent && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-slate-100/90 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs">
          <div className="flex items-start gap-2.5">
            <Lock className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-slate-900 dark:text-slate-100">
                AI External Processing is turned off
              </p>
              <p className="text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                No financial summaries or prompts are sent to Google Gemini API without your explicit optional consent. Local dashboards, reports, budgets and ledger features keep working normally.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isGrantingAiConsent}
              onClick={() => void handleEnableAiConsent()}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              {isGrantingAiConsent ? 'Saving...' : 'Enable AI Processing'}
            </button>
            <a
              href="#manage-consent"
              className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 font-semibold text-xs"
            >
              Manage Consent
            </a>
          </div>
        </div>
      )}

      {/* Honest Provider Status Banner if GEMINI_API_KEY not configured or paused */}
      {aiStatus && (!aiStatus.configured || aiStatus.enabled === false) && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 text-xs">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">
              {aiStatus.enabled === false
                ? 'AI Money Assistant is currently paused by the administrator'
                : 'AI provider is not configured on the server'}
            </p>
            <p className="text-amber-800/80 dark:text-amber-300/80 mt-0.5">
              {aiStatus.enabled === false
                ? 'Enable the AI Engine from Admin Panel → AI Management to resume Chat & Voice Agent responses.'
                : 'Live conversational analysis requires GEMINI_API_KEY to be configured in server Settings → Secrets. We never fabricate mock AI answers.'}
            </p>
          </div>
        </div>
      )}

      {/* Main Split Chat Container */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[560px]">
        {/* Conversation History Sidebar */}
        <aside
          className={`${
            isSidebarOpen ? 'block' : 'hidden'
          } lg:block lg:col-span-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 flex flex-col max-h-[640px]`}
        >
          <div className="flex items-center justify-between px-1 pb-2.5 border-b border-slate-100 dark:border-slate-800">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Conversations ({conversations.length})
            </span>
            {conversations.length > 0 && (
              <button
                type="button"
                onClick={() => setConfirmClearAll(true)}
                className="text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
              >
                Clear All
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto mt-2 space-y-1">
            {isLoadingInitial ? (
              <div className="space-y-2 p-2">
                <div className="h-9 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
                <div className="h-9 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="text-center py-8 px-3">
                <MessageSquare className="w-7 h-7 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No conversations yet. Ask any question about your finances to start.
                </p>
              </div>
            ) : (
              conversations.map((conv) => {
                const isActive = conv.id === activeConvId;
                const isEditing = editingConvId === conv.id;
                return (
                  <div
                    key={conv.id}
                    className={`group flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs transition-colors ${
                      isActive
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 font-semibold'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    {isEditing ? (
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <input
                          type="text"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveRename(conv.id);
                            if (e.key === 'Escape') setEditingConvId(null);
                          }}
                          autoFocus
                          className="flex-1 min-w-0 px-2 py-1 text-xs rounded-lg border border-emerald-400 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveRename(conv.id)}
                          className="p-1 text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 rounded"
                          aria-label="Save title"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingConvId(null)}
                          className="p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"
                          aria-label="Cancel rename"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveConvId(conv.id);
                            setLastError(null);
                            setIsSidebarOpen(false);
                          }}
                          className="flex-1 min-w-0 text-left truncate cursor-pointer"
                          title={conv.title}
                        >
                          {conv.title}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingConvId(conv.id);
                            setEditingTitle(conv.title);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded cursor-pointer"
                          title="Rename chat"
                          aria-label="Rename conversation"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteConversation(conv.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
                          title="Delete chat"
                          aria-label="Delete conversation"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Active Conversation Panel */}
        <section className="lg:col-span-9 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col h-[640px] max-h-[75vh] overflow-hidden">
          {/* Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            {!activeConversation || activeConversation.messages.length === 0 ? (
              <div className="max-w-2xl mx-auto py-4 sm:py-8 space-y-6">
                <div className="text-center space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mx-auto">
                    <Bot className="w-6 h-6" />
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    Ask anything about your finances
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                    Answers are computed strictly from your real transactions, budgets, recurring bills, savings goals, Udhar balances, Net Worth, and Safe-to-Spend reserves.
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2.5">
                    Suggested questions
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {SUGGESTED_QUESTIONS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        disabled={isSending}
                        onClick={() => handleSend(q)}
                        className="text-left p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 hover:border-emerald-400 dark:hover:border-emerald-700 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
                {activeConversation.messages.map((msg) => {
                  const isUser = msg.role === 'user';
                  const isThisSpeaking = speakingMsgId === msg.id;
                  return (
                    <div
                      key={msg.id}
                      className={`flex items-start gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      {!isUser && (
                        <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">
                          <Bot className="w-4 h-4" />
                        </div>
                      )}
                      <div className={`max-w-[85%] sm:max-w-[78%] space-y-1.5`}>
                        <div
                          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                            isUser
                              ? 'bg-emerald-600 text-white rounded-br-md'
                              : 'bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/70 text-slate-800 dark:text-slate-100 rounded-bl-md'
                          }`}
                        >
                          {msg.content}
                        </div>
                        {!isUser && (
                          <div className="flex items-center gap-2 px-1">
                            <button
                              type="button"
                              onClick={() => (isThisSpeaking ? stopSpeaking() : speakText(msg.content, msg.id))}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 cursor-pointer transition-colors"
                            >
                              {isThisSpeaking ? (
                                <>
                                  <VolumeX className="w-3.5 h-3.5 text-rose-500" />
                                  <span className="text-rose-500">Stop Audio</span>
                                </>
                              ) : (
                                <>
                                  <Volume2 className="w-3.5 h-3.5" />
                                  <span>Listen</span>
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                      {isUser && (
                        <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0 mt-0.5">
                          <UserIcon className="w-4 h-4" />
                        </div>
                      )}
                    </div>
                  );
                })}

                {isSending && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/70 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                      <span>Analyzing your financial records...</span>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Error State with Retry */}
            {lastError && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-800 dark:text-rose-200">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <span>{lastError.message}</span>
                </div>
                {lastError.retryQuestion && lastError.code !== 'AI_PROVIDER_NOT_CONFIGURED' && (
                  <button
                    type="button"
                    onClick={() => handleSend(lastError.retryQuestion)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold shrink-0 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry</span>
                  </button>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Follow-Up Chips when inside a conversation */}
          {activeConversation && activeConversation.messages.length > 0 && (
            <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center gap-1.5 overflow-x-auto">
              {SUGGESTED_QUESTIONS.slice(0, 5).map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={isSending}
                  onClick={() => handleSend(q)}
                  className="shrink-0 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Live Voice Agent HUD */}
          {voiceState !== 'idle' && (
            <div className="px-4 py-2.5 border-t border-emerald-200/80 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/30 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    voiceState === 'listening'
                      ? 'bg-rose-500 animate-ping'
                      : voiceState === 'thinking'
                      ? 'bg-amber-500 animate-pulse'
                      : 'bg-emerald-500 animate-pulse'
                  }`}
                />
                <div className="min-w-0 text-xs">
                  <p className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>
                      {voiceState === 'listening'
                        ? speechLang === 'hi-IN'
                          ? 'Voice Agent सुन रहा है — सवाल बोलते ही सीधा जवाब मिलेगा'
                          : 'Voice Agent listening — speak your app finance question'
                        : voiceState === 'thinking'
                        ? 'Checking your My Money Manager data...'
                        : 'Voice Agent speaking reply aloud...'}
                    </span>
                  </p>
                  {liveTranscript && (
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 truncate mt-0.5">
                      "{liveTranscript}"
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={stopVoiceAgent}
                className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold shrink-0 cursor-pointer"
              >
                Stop
              </button>
            </div>
          )}

          {/* Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/80 flex items-center gap-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={
                isListening
                  ? 'Voice Agent listening... direct reply will speak automatically'
                  : 'Ask strictly about your My Money Manager spending, budgets, bills, Udhar, or Net Worth...'
              }
              maxLength={1500}
              disabled={isSending}
              className={`flex-1 min-w-0 h-11 px-4 rounded-xl border text-sm transition-all focus:outline-none focus:ring-2 ${
                isListening
                  ? 'border-rose-400 bg-rose-50/40 dark:bg-rose-950/20 text-rose-900 dark:text-rose-100 placeholder:text-rose-400 focus:ring-rose-500'
                  : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:ring-emerald-500'
              }`}
            />
            {/* Auto-Voice Reply toggle */}
            <button
              type="button"
              onClick={() => {
                if (autoSpeakReplies) stopSpeaking();
                setAutoSpeakReplies((prev) => !prev);
              }}
              className={`h-11 px-2.5 rounded-xl border text-xs font-semibold shrink-0 cursor-pointer transition-colors inline-flex items-center gap-1 ${
                autoSpeakReplies
                  ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                  : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400'
              }`}
              title={autoSpeakReplies ? 'Auto-Voice Reply On (Click to mute)' : 'Auto-Voice Reply Off'}
            >
              {autoSpeakReplies ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              <span className="hidden md:inline">{autoSpeakReplies ? 'Voice On' : 'Muted'}</span>
            </button>
            {/* Language toggle: Hindi or English */}
            <button
              type="button"
              onClick={() => setSpeechLang((prev) => (prev === 'hi-IN' ? 'en-IN' : 'hi-IN'))}
              className="h-11 px-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold shrink-0 cursor-pointer transition-colors"
              title="Click to toggle Voice Language (Hindi / English)"
            >
              {speechLang === 'hi-IN' ? '🇮🇳 HI' : '🌐 EN'}
            </button>
            {/* Direct Voice Agent Mic Button */}
            <button
              type="button"
              onClick={toggleListening}
              disabled={isSending}
              className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 transition-all cursor-pointer ${
                isListening || voiceState === 'speaking'
                  ? 'bg-rose-500 text-white animate-pulse ring-4 ring-rose-500/30 shadow-lg shadow-rose-500/20'
                  : 'bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 shadow-xs'
              }`}
              aria-label={isListening ? 'Stop Voice Agent' : 'Talk to Voice Agent'}
              title={isListening ? 'Listening... tap to stop' : 'Talk directly to AI Voice Agent (answers aloud)'}
            >
              {isListening ? (
                <MicOff className="w-4 h-4 text-white" />
              ) : (
                <Mic className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              )}
            </button>
            <button
              type="submit"
              disabled={isSending || !inputText.trim()}
              className="h-11 px-4 sm:px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors shrink-0 cursor-pointer"
              aria-label="Send message"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Send</span>
            </button>
          </form>
        </section>
      </div>

      <ConfirmModal
        isOpen={confirmClearAll}
        onCancel={() => setConfirmClearAll(false)}
        onConfirm={handleClearAll}
        title="Clear all AI conversations?"
        message="This permanently removes your saved AI Money Assistant chat history. Your financial transactions will not be affected."
        confirmLabel="Clear History"
        isDestructive
      />
    </div>
  );
};
