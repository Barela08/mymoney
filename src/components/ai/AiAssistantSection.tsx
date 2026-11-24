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
  const [lastError, setLastError] = useState<{ message: string; code?: string; retryQuestion?: string } | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

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
          return { conversations: [], status: st || { configured: false, provider: 'gemini' as const, model: 'gemini-4-hydrogen', ocrSupported: false } };
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

  const handleSend = useCallback(
    async (questionOverride?: string) => {
      const q = (questionOverride ?? inputText).trim();
      if (!q || isSending) return;

      setLastError(null);
      if (!questionOverride) setInputText('');
      setIsSending(true);

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

        const code = err instanceof ApiClientError ? err.code : undefined;
        setLastError({
          message: err?.message || 'Unable to get a response from AI Money Assistant.',
          code,
          retryQuestion: q,
        });
      } finally {
        setIsSending(false);
      }
    },
    [inputText, isSending, activeConvId, financialContext]
  );

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
            <Sparkles className="w-5 h-5" />
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

      {/* Honest Provider Status Banner if GEMINI_API_KEY not configured */}
      {aiStatus && !aiStatus.configured && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 text-xs">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">AI provider is not configured on the server</p>
            <p className="text-amber-800/80 dark:text-amber-300/80 mt-0.5">
              Live conversational analysis requires server-side AI credentials to be configured by the administrator. We never fabricate mock AI answers.
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
                      <div
                        className={`max-w-[85%] sm:max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                          isUser
                            ? 'bg-emerald-600 text-white rounded-br-md'
                            : 'bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/70 text-slate-800 dark:text-slate-100 rounded-bl-md'
                        }`}
                      >
                        {msg.content}
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

          {/* Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/80 flex items-center gap-2"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Ask about your spending, budgets, bills, savings, Udhar, or Net Worth..."
              maxLength={1500}
              disabled={isSending}
              className="flex-1 min-w-0 h-11 px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
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
