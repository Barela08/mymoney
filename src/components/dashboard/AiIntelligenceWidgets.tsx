import React, { useState, useEffect, useMemo } from 'react';
import {
  Sparkles,
  ShieldCheck,
  Landmark,
  Bell,
  Calendar,
  ScanLine,
  ArrowRight,
  Send,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Mic,
  MicOff,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { budgetApi, recurringBillsApi, savingsGoalsApi, UserBudget, RecurringBill, SavingsGoal } from '../../lib/financialFeaturesApi';
import { aiFinanceApi } from '../../lib/aiFinanceApi';
import {
  buildExpenseCalendarMonth,
  calculateNetWorth,
  calculateSafeToSpend,
  DEFAULT_SAFE_TO_SPEND_PREFS,
  DEFAULT_SMART_ALERT_PREFS,
  evaluateSmartAlerts,
  NetWorthAsset,
  NetWorthLiability,
  NetWorthSettings,
  SafeToSpendPreferences,
  SmartAlertEventState,
  SmartAlertPreferences,
} from '../../lib/financialIntelligenceEngine';
import { formatINR } from '../../lib/dateUtils';
import { NavTab } from '../common/Sidebar';

interface AiIntelligenceWidgetsProps {
  onNavigate: (tab: NavTab) => void;
  onAskAiPrompt: (prompt: string) => void;
}

export const AiIntelligenceWidgets: React.FC<AiIntelligenceWidgetsProps> = ({
  onNavigate,
  onAskAiPrompt,
}) => {
  const { transactions, summary, peopleSummaries } = useExpense();
  const [quickQuestion, setQuickQuestion] = useState('');
  const [isListening, setIsListening] = useState(false);

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
  const [alertPrefs, setAlertPrefs] = useState<SmartAlertPreferences>(DEFAULT_SMART_ALERT_PREFS);
  const [alertState, setAlertState] = useState<SmartAlertEventState>({ readKeys: [], dismissedKeys: [] });

  useEffect(() => {
    Promise.all([
      budgetApi.getBudgets().catch(() => ({ success: true, budgets: [] })),
      recurringBillsApi.getBills().catch(() => ({ success: true, bills: [] })),
      savingsGoalsApi.getGoals().catch(() => ({ success: true, goals: [] })),
      aiFinanceApi.getNetWorthData().catch(() => null),
      aiFinanceApi.getSafeToSpendPreferences().catch(() => DEFAULT_SAFE_TO_SPEND_PREFS),
      aiFinanceApi.getSmartAlertsState().catch(() => null),
    ]).then(([bRes, billRes, gRes, nwRes, stsRes, alRes]) => {
      setBudgets(bRes.budgets || []);
      setBills(billRes.bills || []);
      setGoals(gRes.goals || []);
      if (nwRes) {
        setNwAssets(nwRes.assets || []);
        setNwLiabilities(nwRes.liabilities || []);
        if (nwRes.settings) setNwSettings(nwRes.settings);
      }
      if (stsRes) setStsPrefs(stsRes);
      if (alRes) {
        setAlertPrefs(alRes.preferences);
        setAlertState(alRes.eventState);
      }
    });
  }, []);

  const udharReceivable = useMemo(
    () =>
      peopleSummaries
        .filter((p) => p.outstandingBalance > 0)
        .reduce((s, p) => s + p.outstandingBalance, 0),
    [peopleSummaries]
  );
  const udharPayable = useMemo(
    () =>
      peopleSummaries
        .filter((p) => p.outstandingBalance < 0)
        .reduce((s, p) => s + Math.abs(p.outstandingBalance), 0),
    [peopleSummaries]
  );

  const safeToSpend = useMemo(
    () =>
      calculateSafeToSpend({
        availableBalance: summary.availableBalance,
        transactions,
        recurringBills: bills,
        budgets,
        savingsGoals: goals,
        preferences: stsPrefs,
      }),
    [summary.availableBalance, transactions, bills, budgets, goals, stsPrefs]
  );

  const netWorth = useMemo(
    () =>
      calculateNetWorth({
        assets: nwAssets,
        liabilities: nwLiabilities,
        availableBalance: summary.availableBalance,
        udharReceivable,
        udharPayable,
        settings: nwSettings,
      }),
    [nwAssets, nwLiabilities, summary.availableBalance, udharReceivable, udharPayable, nwSettings]
  );

  const smartAlerts = useMemo(
    () =>
      evaluateSmartAlerts({
        transactions,
        availableBalance: summary.availableBalance,
        budgets,
        recurringBills: bills,
        savingsGoals: goals,
        preferences: alertPrefs,
        eventState: alertState,
      }),
    [transactions, summary.availableBalance, budgets, bills, goals, alertPrefs, alertState]
  );

  const now = new Date();
  const calendarPreview = useMemo(
    () => buildExpenseCalendarMonth(transactions, now.getFullYear(), now.getMonth() + 1),
    [transactions]
  );

  const unreadAlertsCount = smartAlerts.filter((a) => !a.isRead).length;

  const toggleListening = async () => {
    if (isListening) {
      setIsListening(false);
      return;
    }
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        return;
      }
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'hi-IN';
      recognition.continuous = false;
      recognition.interimResults = true;

      recognition.onstart = () => setIsListening(true);
      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0]?.transcript || '')
          .join('');
        if (transcript) setQuickQuestion(transcript);
      };
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  const handleSubmitQuickAsk = (e: React.FormEvent) => {
    e.preventDefault();
    const q = quickQuestion.trim();
    if (!q) {
      onNavigate('ai_assistant');
      return;
    }
    setQuickQuestion('');
    onAskAiPrompt(q);
  };

  return (
    <div className="space-y-4">
      {/* Row 1: Safe-to-Spend + Net Worth + Receipt Scanner Quick Action */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Safe-to-Spend Compact Card */}
        <div
          onClick={() => onNavigate('safe_to_spend')}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-400 dark:hover:border-emerald-700 rounded-2xl p-4 cursor-pointer transition-colors flex flex-col justify-between"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Safe-to-Spend Today</span>
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
          </div>
          {safeToSpend.hasSufficientData ? (
            <div className="mt-3">
              <p
                className={`text-2xl font-bold tabular-nums ${
                  safeToSpend.safeToSpendToday > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {formatINR(safeToSpend.safeToSpendToday)}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                Month pool: {formatINR(safeToSpend.safeToSpendThisMonth)} · Bills protected:{' '}
                {formatINR(safeToSpend.upcomingBillsCommitment)}
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
              Add transactions or bills to compute your daily safe spending allowance.
            </p>
          )}
        </div>

        {/* Net Worth Compact Card */}
        <div
          onClick={() => onNavigate('net_worth')}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-400 dark:hover:border-emerald-700 rounded-2xl p-4 cursor-pointer transition-colors flex flex-col justify-between"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Landmark className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Net Worth</span>
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="mt-3">
            <p
              className={`text-2xl font-bold tabular-nums ${
                netWorth.netWorth >= 0
                  ? 'text-slate-900 dark:text-slate-100'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {formatINR(netWorth.netWorth)}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
              Assets {formatINR(netWorth.totalAssets)} · Liabilities {formatINR(netWorth.totalLiabilities)}
            </p>
          </div>
        </div>

        {/* Receipt Scanner & Expense Calendar Quick Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>This Month Spend</span>
            </span>
            <button
              type="button"
              onClick={() => onNavigate('expense_calendar')}
              className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
            >
              Calendar &rarr;
            </button>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {formatINR(calendarPreview.analytics.totalExpenses)}
            </p>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              Avg {formatINR(calendarPreview.analytics.averageDailySpending)}/day
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('receipt_scanner')}
            className="w-full py-2 px-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <ScanLine className="w-3.5 h-3.5" />
            <span>Scan Receipt with OCR</span>
          </button>
        </div>
      </div>

      {/* Row 2: AI Money Assistant Quick-Ask + Smart Alerts Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* AI Money Assistant Card */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">AI Money Assistant</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Ask read-only questions grounded in your real financial data
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('ai_assistant')}
              className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer shrink-0"
            >
              Open Full Chat &rarr;
            </button>
          </div>

          <form onSubmit={handleSubmitQuickAsk} className="flex items-center gap-2">
            <input
              type="text"
              value={quickQuestion}
              onChange={(e) => setQuickQuestion(e.target.value)}
              placeholder={isListening ? 'Listening... speak now' : 'e.g. Where did most of my money go this month?'}
              className={`flex-1 min-w-0 h-10 px-3.5 rounded-xl border text-xs sm:text-sm transition-all focus:outline-none focus:ring-2 ${
                isListening
                  ? 'border-rose-400 bg-rose-50/40 dark:bg-rose-950/20 text-rose-900 dark:text-rose-100 placeholder:text-rose-400 focus:ring-rose-500'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-emerald-500'
              }`}
            />
            <button
              type="button"
              onClick={toggleListening}
              className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition-all cursor-pointer ${
                isListening
                  ? 'bg-rose-500 text-white animate-pulse ring-4 ring-rose-500/30'
                  : 'bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-emerald-600'
              }`}
              title={isListening ? 'Listening... click to stop' : 'Tap to speak (Voice input)'}
            >
              {isListening ? <MicOff className="w-3.5 h-3.5 text-white" /> : <Mic className="w-3.5 h-3.5" />}
            </button>
            <button
              type="submit"
              className="h-10 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Ask</span>
            </button>
          </form>

          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              'How much did I spend this month?',
              'How much can I safely spend today?',
              'Which bills are due soon?',
            ].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onAskAiPrompt(q)}
                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Smart Alerts Preview Card */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <Bell className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Smart Alerts {unreadAlertsCount > 0 ? `(${unreadAlertsCount})` : ''}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Budgets, bills, balance & milestones
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('smart_alerts')}
              className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer shrink-0"
            >
              View All &rarr;
            </button>
          </div>

          {smartAlerts.length === 0 ? (
            <div className="flex items-center gap-2.5 py-3 text-xs text-slate-500 dark:text-slate-400">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>No active warnings right now. Budgets, bills, and balance look healthy.</span>
            </div>
          ) : (
            <div className="space-y-2">
              {smartAlerts.slice(0, 3).map((al) => (
                <button
                  key={al.id}
                  type="button"
                  onClick={() => onNavigate('smart_alerts')}
                  className="w-full text-left flex items-start gap-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  {al.severity === 'critical' ? (
                    <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                  ) : al.severity === 'warning' ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                      {al.title}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{al.message}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
