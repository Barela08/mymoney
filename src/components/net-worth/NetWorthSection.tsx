import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Landmark,
  Plus,
  Trash2,
  Edit3,
  Archive,
  Camera,
  TrendingUp,
  TrendingDown,
  Wallet,
  CreditCard,
  X,
  Info,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import { aiFinanceApi } from '../../lib/aiFinanceApi';
import {
  AssetCategory,
  calculateNetWorth,
  LiabilityCategory,
  NetWorthAsset,
  NetWorthLiability,
  NetWorthSettings,
  NetWorthSnapshot,
} from '../../lib/financialIntelligenceEngine';
import { formatINR, getCurrentISTDate, formatDisplayDate } from '../../lib/dateUtils';
import { ConfirmModal } from '../common/ConfirmModal';

const ASSET_CATEGORIES: Array<{ id: AssetCategory; label: string }> = [
  { id: 'cash', label: 'Cash' },
  { id: 'bank_account', label: 'Bank Account' },
  { id: 'savings', label: 'Savings' },
  { id: 'fixed_deposit', label: 'Fixed Deposit (FD)' },
  { id: 'investments', label: 'Investments' },
  { id: 'stocks', label: 'Stocks' },
  { id: 'mutual_funds', label: 'Mutual Funds' },
  { id: 'gold', label: 'Gold' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'property', label: 'Property' },
  { id: 'other', label: 'Other Asset' },
];

const LIABILITY_CATEGORIES: Array<{ id: LiabilityCategory; label: string }> = [
  { id: 'personal_loan', label: 'Personal Loan' },
  { id: 'home_loan', label: 'Home Loan' },
  { id: 'vehicle_loan', label: 'Vehicle Loan' },
  { id: 'credit_card', label: 'Credit Card Outstanding' },
  { id: 'emi', label: 'EMI Outstanding' },
  { id: 'borrowed_money', label: 'Borrowed Money' },
  { id: 'other', label: 'Other Liability' },
];

export const NetWorthSection: React.FC = () => {
  const { summary, peopleSummaries } = useExpense();
  const toast = useToast();

  const [assets, setAssets] = useState<NetWorthAsset[]>([]);
  const [liabilities, setLiabilities] = useState<NetWorthLiability[]>([]);
  const [snapshots, setSnapshots] = useState<NetWorthSnapshot[]>([]);
  const [settings, setSettings] = useState<NetWorthSettings>({
    includeLiquidBalance: true,
    includeUdharReceivables: true,
    includeUdharPayables: true,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  // Modal state
  const [modalMode, setModalMode] = useState<'asset' | 'liability' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemCategory, setItemCategory] = useState<string>('bank_account');
  const [itemAmount, setItemAmount] = useState('');
  const [itemDate, setItemDate] = useState(getCurrentISTDate());
  const [itemNotes, setItemNotes] = useState('');
  const [isSavingItem, setIsSavingItem] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'asset' | 'liability'; id: string; name: string } | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await aiFinanceApi.getNetWorthData();
      setAssets(res.assets || []);
      setLiabilities(res.liabilities || []);
      setSnapshots(res.snapshots || []);
      if (res.settings) setSettings(res.settings);
    } catch (err: any) {
      toast.error('Failed to load Net Worth data', err.message || 'Please retry.');
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

  const calc = useMemo(
    () =>
      calculateNetWorth({
        assets,
        liabilities,
        availableBalance: summary.availableBalance,
        udharReceivable,
        udharPayable,
        settings,
      }),
    [assets, liabilities, summary.availableBalance, udharReceivable, udharPayable, settings]
  );

  const recordTodaySnapshot = async (currentCalc = calc) => {
    try {
      const todayKey = getCurrentISTDate();
      const updated = await aiFinanceApi.saveNetWorthSnapshot({
        snapshot_date: todayKey,
        total_assets: currentCalc.totalAssets,
        total_liabilities: currentCalc.totalLiabilities,
        net_worth: currentCalc.netWorth,
        linked_liquid_balance: currentCalc.linkedLiquidAsset,
        linked_udhar_receivable: currentCalc.linkedUdharReceivableAsset,
        linked_udhar_payable: currentCalc.linkedUdharPayableLiability,
      });
      setSnapshots(updated);
      toast.success('Snapshot recorded', `Real Net Worth snapshot saved for ${formatDisplayDate(todayKey)}.`);
    } catch (err: any) {
      toast.error('Snapshot failed', err.message || 'Could not save snapshot.');
    }
  };

  const handleToggleSetting = async (key: keyof NetWorthSettings) => {
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    try {
      await aiFinanceApi.saveNetWorthSettings(next);
    } catch {
      // ignore
    }
  };

  const openAddModal = (type: 'asset' | 'liability') => {
    setModalMode(type);
    setEditingId(null);
    setItemName('');
    setItemCategory(type === 'asset' ? 'bank_account' : 'credit_card');
    setItemAmount('');
    setItemDate(getCurrentISTDate());
    setItemNotes('');
  };

  const openEditAsset = (a: NetWorthAsset) => {
    setModalMode('asset');
    setEditingId(a.id);
    setItemName(a.name);
    setItemCategory(a.category);
    setItemAmount(String(a.current_value));
    setItemDate(a.valuation_date || getCurrentISTDate());
    setItemNotes(a.notes || '');
  };

  const openEditLiability = (l: NetWorthLiability) => {
    setModalMode('liability');
    setEditingId(l.id);
    setItemName(l.name);
    setItemCategory(l.category);
    setItemAmount(String(l.current_balance));
    setItemDate(l.valuation_date || getCurrentISTDate());
    setItemNotes(l.notes || '');
  };

  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(itemAmount);
    if (!itemName.trim() || !Number.isFinite(val) || val < 0) {
      toast.error('Invalid entry', 'Enter a valid name and non-negative amount.');
      return;
    }

    setIsSavingItem(true);
    try {
      if (modalMode === 'asset') {
        const nextAssets = await aiFinanceApi.saveNetWorthAsset({
          id: editingId || undefined,
          name: itemName.trim(),
          category: itemCategory as AssetCategory,
          current_value: val,
          valuation_date: itemDate,
          notes: itemNotes.trim() || undefined,
        });
        setAssets(nextAssets);
        const nextCalc = calculateNetWorth({
          assets: nextAssets,
          liabilities,
          availableBalance: summary.availableBalance,
          udharReceivable,
          udharPayable,
          settings,
        });
        await aiFinanceApi
          .saveNetWorthSnapshot({
            snapshot_date: getCurrentISTDate(),
            total_assets: nextCalc.totalAssets,
            total_liabilities: nextCalc.totalLiabilities,
            net_worth: nextCalc.netWorth,
            linked_liquid_balance: nextCalc.linkedLiquidAsset,
            linked_udhar_receivable: nextCalc.linkedUdharReceivableAsset,
            linked_udhar_payable: nextCalc.linkedUdharPayableLiability,
          })
          .then(setSnapshots)
          .catch(() => {});
        toast.success(editingId ? 'Asset updated' : 'Asset added', `${itemName.trim()} saved.`);
      } else if (modalMode === 'liability') {
        const nextLiabs = await aiFinanceApi.saveNetWorthLiability({
          id: editingId || undefined,
          name: itemName.trim(),
          category: itemCategory as LiabilityCategory,
          current_balance: val,
          valuation_date: itemDate,
          notes: itemNotes.trim() || undefined,
        });
        setLiabilities(nextLiabs);
        const nextCalc = calculateNetWorth({
          assets,
          liabilities: nextLiabs,
          availableBalance: summary.availableBalance,
          udharReceivable,
          udharPayable,
          settings,
        });
        await aiFinanceApi
          .saveNetWorthSnapshot({
            snapshot_date: getCurrentISTDate(),
            total_assets: nextCalc.totalAssets,
            total_liabilities: nextCalc.totalLiabilities,
            net_worth: nextCalc.netWorth,
            linked_liquid_balance: nextCalc.linkedLiquidAsset,
            linked_udhar_receivable: nextCalc.linkedUdharReceivableAsset,
            linked_udhar_payable: nextCalc.linkedUdharPayableLiability,
          })
          .then(setSnapshots)
          .catch(() => {});
        toast.success(editingId ? 'Liability updated' : 'Liability added', `${itemName.trim()} saved.`);
      }
      setModalMode(null);
    } catch (err: any) {
      toast.error('Save failed', err.message || 'Could not save record.');
    } finally {
      setIsSavingItem(false);
    }
  };

  const handleToggleArchive = async (type: 'asset' | 'liability', item: NetWorthAsset | NetWorthLiability) => {
    try {
      if (type === 'asset') {
        const a = item as NetWorthAsset;
        const next = await aiFinanceApi.saveNetWorthAsset({ ...a, is_archived: !a.is_archived });
        setAssets(next);
      } else {
        const l = item as NetWorthLiability;
        const next = await aiFinanceApi.saveNetWorthLiability({ ...l, is_archived: !l.is_archived });
        setLiabilities(next);
      }
    } catch (err: any) {
      toast.error('Update failed', err.message || 'Could not update archive status.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === 'asset') {
        const next = await aiFinanceApi.deleteNetWorthAsset(deleteTarget.id);
        setAssets(next);
      } else {
        const next = await aiFinanceApi.deleteNetWorthLiability(deleteTarget.id);
        setLiabilities(next);
      }
      toast.success('Deleted', `${deleteTarget.name} removed.`);
      setDeleteTarget(null);
    } catch (err: any) {
      toast.error('Delete failed', err.message || 'Could not delete item.');
    }
  };

  const visibleAssets = assets.filter((a) => (showArchived ? true : !a.is_archived));
  const visibleLiabilities = liabilities.filter((l) => (showArchived ? true : !l.is_archived));
  const debtToAssetRatio =
    calc.totalAssets > 0 ? Math.round((calc.totalLiabilities / calc.totalAssets) * 1000) / 10 : 0;

  return (
    <div className="space-y-5 pb-8">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <Landmark className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              Net Worth Tracker
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Net Worth = Total Assets − Total Liabilities · Real snapshot history only
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => recordTodaySnapshot()}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5 text-emerald-600" />
            <span>Save Today&apos;s Snapshot</span>
          </button>
          <button
            type="button"
            onClick={() => openAddModal('asset')}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Asset</span>
          </button>
          <button
            type="button"
            onClick={() => openAddModal('liability')}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Liability</span>
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Current Net Worth</p>
          <p
            className={`text-2xl sm:text-3xl font-bold tabular-nums mt-1.5 ${
              calc.netWorth >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {formatINR(calc.netWorth)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Assets minus Liabilities</p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Assets</p>
            <TrendingUp className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1.5">
            {formatINR(calc.totalAssets)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            Manual: {formatINR(calc.manualAssetsTotal)}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Liabilities</p>
            <TrendingDown className="w-4 h-4 text-rose-500" />
          </div>
          <p className="text-2xl font-bold tabular-nums text-rose-600 dark:text-rose-400 mt-1.5">
            {formatINR(calc.totalLiabilities)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            Manual: {formatINR(calc.manualLiabilitiesTotal)}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Debt-to-Asset Ratio</p>
          <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1.5">
            {debtToAssetRatio}%
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {debtToAssetRatio === 0 ? 'Debt-free position' : debtToAssetRatio < 35 ? 'Healthy leverage' : 'High debt ratio'}
          </p>
        </div>
      </div>

      {/* Linked Balances Inclusion Controls (Prevents Double Counting) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <Info className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            <strong>Auto-linked balances</strong> (toggle off if you already entered them manually to avoid double counting):
          </span>
        </div>
        <div className="flex items-center gap-4 flex-wrap text-xs">
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={settings.includeLiquidBalance}
              onChange={() => handleToggleSetting('includeLiquidBalance')}
              className="accent-emerald-600"
            />
            <span>
              Available Balance (<strong className="tabular-nums">{formatINR(summary.availableBalance)}</strong>)
            </span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={settings.includeUdharReceivables}
              onChange={() => handleToggleSetting('includeUdharReceivables')}
              className="accent-emerald-600"
            />
            <span>
              Udhar Receivable (<strong className="tabular-nums">{formatINR(udharReceivable)}</strong>)
            </span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={settings.includeUdharPayables}
              onChange={() => handleToggleSetting('includeUdharPayables')}
              className="accent-emerald-600"
            />
            <span>
              Udhar Payable (<strong className="tabular-nums">{formatINR(udharPayable)}</strong>)
            </span>
          </label>
        </div>
      </div>

      {/* Real Net Worth History Chart + Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Net Worth Over Time</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Tracked strictly from saved real snapshots ({snapshots.length} recorded)
              </p>
            </div>
          </div>

          {snapshots.length < 2 ? (
            <div className="h-[220px] flex flex-col items-center justify-center text-center px-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {snapshots.length === 0
                  ? 'No historical snapshots saved yet'
                  : `1 snapshot recorded (${formatDisplayDate(snapshots[0].snapshot_date)}: ${formatINR(snapshots[0].net_worth)})`}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                Save snapshots over multiple dates as your balances evolve. We never fabricate synthetic past history.
              </p>
              <button
                type="button"
                onClick={() => recordTodaySnapshot()}
                className="mt-3 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
              >
                Save Today&apos;s Snapshot
              </button>
            </div>
          ) : (
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={snapshots} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#059669" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#059669" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:opacity-20" />
                  <XAxis dataKey="snapshot_date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(value: any) => formatINR(Number(value))} />
                  <Area type="monotone" dataKey="net_worth" name="Net Worth" stroke="#059669" strokeWidth={2.5} fill="url(#nwGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Asset & Liability Composition */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Asset & Liability Breakdown</h2>
          <div className="space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              Assets Composition
            </p>
            {calc.assetBreakdown.length === 0 ? (
              <p className="text-xs text-slate-500">No active assets yet.</p>
            ) : (
              calc.assetBreakdown.map((row) => (
                <div key={row.category} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-300">{row.label}</span>
                    <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {formatINR(row.amount)} ({row.percent}%)
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, row.percent)}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="space-y-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
              Liabilities Composition
            </p>
            {calc.liabilityBreakdown.length === 0 ? (
              <p className="text-xs text-slate-500">No active liabilities.</p>
            ) : (
              calc.liabilityBreakdown.map((row) => (
                <div key={row.category} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-300">{row.label}</span>
                    <span className="font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                      {formatINR(row.amount)} ({row.percent}%)
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className="h-full bg-rose-500 rounded-full" style={{ width: `${Math.min(100, row.percent)}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Assets & Liabilities Ledgers */}
      <div className="flex items-center justify-end">
        <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="accent-emerald-600"
          />
          <span>Show archived items</span>
        </label>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Assets List */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Wallet className="w-4 h-4 text-emerald-600" />
              <span>Manual Assets ({visibleAssets.length})</span>
            </h3>
            <button
              type="button"
              onClick={() => openAddModal('asset')}
              className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
            >
              + Add Asset
            </button>
          </div>

          {isLoading ? (
            <div className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ) : visibleAssets.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
              Add bank accounts, savings, FDs, stocks, gold, or property to track complete assets.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleAssets.map((a) => (
                <div key={a.id} className={`py-3 flex items-center justify-between gap-2 ${a.is_archived ? 'opacity-55' : ''}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {a.name} {a.is_archived ? '(Archived)' : ''}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {ASSET_CATEGORIES.find((c) => c.id === a.category)?.label || a.category} · Valued {formatDisplayDate(a.valuation_date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400 mr-1">
                      {formatINR(a.current_value)}
                    </span>
                    <button
                      type="button"
                      onClick={() => openEditAsset(a)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      title="Edit value"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleArchive('asset', a)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      title={a.is_archived ? 'Unarchive' : 'Archive'}
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget({ type: 'asset', id: a.id, name: a.name })}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Liabilities List */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-rose-600" />
              <span>Manual Liabilities ({visibleLiabilities.length})</span>
            </h3>
            <button
              type="button"
              onClick={() => openAddModal('liability')}
              className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
            >
              + Add Liability
            </button>
          </div>

          {isLoading ? (
            <div className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ) : visibleLiabilities.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
              No manual liabilities recorded. Add loans, EMIs, or credit card balances if any.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleLiabilities.map((l) => (
                <div key={l.id} className={`py-3 flex items-center justify-between gap-2 ${l.is_archived ? 'opacity-55' : ''}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {l.name} {l.is_archived ? '(Archived)' : ''}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {LIABILITY_CATEGORIES.find((c) => c.id === l.category)?.label || l.category} · Valued {formatDisplayDate(l.valuation_date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400 mr-1">
                      {formatINR(l.current_balance)}
                    </span>
                    <button
                      type="button"
                      onClick={() => openEditLiability(l)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      title="Edit balance"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleArchive('liability', l)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      title={l.is_archived ? 'Unarchive' : 'Archive'}
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget({ type: 'liability', id: l.id, name: l.name })}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Asset or Liability Modal */}
      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {editingId ? 'Update' : 'Add'} {modalMode === 'asset' ? 'Asset' : 'Liability'}
              </h3>
              <button
                type="button"
                onClick={() => setModalMode(null)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveModal} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  placeholder={modalMode === 'asset' ? 'e.g. SBI Savings, Nifty 50 SIP, Gold' : 'e.g. HDFC Credit Card, Bike EMI'}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Category</label>
                  <select
                    value={itemCategory}
                    onChange={(e) => setItemCategory(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                  >
                    {(modalMode === 'asset' ? ASSET_CATEGORIES : LIABILITY_CATEGORIES).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {modalMode === 'asset' ? 'Current Value (₹)' : 'Outstanding (₹)'} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={itemAmount}
                    onChange={(e) => setItemAmount(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Valuation Date</label>
                <input
                  type="date"
                  value={itemDate}
                  onChange={(e) => setItemDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Notes (Optional)</label>
                <input
                  type="text"
                  value={itemNotes}
                  onChange={(e) => setItemNotes(e.target.value)}
                  placeholder="Account hint, maturity date, interest rate..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalMode(null)}
                  className="px-4 py-2 rounded-xl text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingItem}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:opacity-50"
                >
                  {isSavingItem ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={Boolean(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title={`Delete ${deleteTarget?.name || 'item'}?`}
        message="This permanently removes this Net Worth record. Historical snapshots remain intact."
        confirmLabel="Delete"
        isDestructive
      />
    </div>
  );
};
