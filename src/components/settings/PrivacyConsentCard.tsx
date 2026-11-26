import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ShieldCheck,
  Cloud,
  Cpu,
  Users,
  BarChart3,
  SlidersHorizontal,
  Megaphone,
  Lock,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  History,
  Sliders,
  FileText,
  Download,
  UserCog,
  Trash2,
  Mail,
  Phone,
  AlertCircle,
  RefreshCw,
  Loader2,
  Check,
  Minus,
  QrCode,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { SUPPORT_CONTACT } from '../../config/contact';
import {
  OPTIONAL_CONSENT_CATEGORIES,
  OPTIONAL_CONSENT_DEFINITIONS,
  PRIVACY_POLICY_LAST_UPDATED,
  PRIVACY_POLICY_VERSION,
  PRIVACY_UI_COPY,
  countSelectedOptional,
  createEmptyOptionalChoices,
  getSelectAllState,
  toggleSelectAllOptional,
  type ConsentCategoryState,
  type ConsentHistoryEntry,
  type ConsentLanguage,
  type OptionalConsentCategory,
  type OptionalConsentChoices,
} from '../../lib/privacyConsent';
import {
  PRIVACY_CHANGED_EVENT,
  generateConsentIdempotencyKey,
  getCachedUserPrivacyState,
  privacyConsentApi,
} from '../../lib/privacyConsentApi';
import { PrivacyNoticeModal } from '../privacy/PrivacyNoticeModal';

const CATEGORY_DEF_MAP = Object.fromEntries(
  OPTIONAL_CONSENT_DEFINITIONS.map((def) => [def.key, def])
) as Record<OptionalConsentCategory, (typeof OPTIONAL_CONSENT_DEFINITIONS)[number]>;

const CATEGORY_ICONS: Record<OptionalConsentCategory, React.ComponentType<{ className?: string }>> = {
  cloud_sync: Cloud,
  ai_processing: Cpu,
  udhar_sharing: Users,
  analytics: BarChart3,
  personalization: SlidersHorizontal,
  marketing_updates: Megaphone,
};

const LANGUAGES: Array<{ code: ConsentLanguage; label: string }> = [
  { code: 'en', label: 'EN' },
  { code: 'hi', label: 'हिंदी' },
  { code: 'mr', label: 'मराठी' },
];

export interface PrivacyConsentCardProps {
  onOpenPrivacyPolicy?: () => void;
  onExportBackup?: () => void;
  onNavigateToProfile?: () => void;
  onNavigateToDeletion?: () => void;
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Settings → Privacy → Manage Consent
 *
 * Allows authenticated users to:
 * - View active optional consents (and policy version + last updated date)
 * - Grant or withdraw individual optional categories (persisted to Supabase/server)
 * - Use Select All Optional (checked / unchecked / indeterminate) or Withdraw All Optional
 * - Inspect the full append-only Consent History log
 * - Review Essential Financial Data Processing separately (no checkbox)
 * - Open the Standalone Trilingual Privacy Notice & exercise Data Principal rights
 */
export const PrivacyConsentCard: React.FC<PrivacyConsentCardProps> = ({
  onOpenPrivacyPolicy,
  onExportBackup,
  onNavigateToProfile,
  onNavigateToDeletion,
}) => {
  const { user } = useAuth();
  const toast = useToast();

  const [language, setLanguage] = useState<ConsentLanguage>('en');
  const [subTab, setSubTab] = useState<'controls' | 'history'>('controls');
  const [choices, setChoices] = useState<OptionalConsentChoices>(() => {
    const cached = getCachedUserPrivacyState(user?.id || user?.uid || null);
    return cached ? { ...cached.choices } : createEmptyOptionalChoices();
  });
  const [categoryStates, setCategoryStates] = useState<
    Partial<Record<OptionalConsentCategory, ConsentCategoryState>>
  >({});
  const [history, setHistory] = useState<ConsentHistoryEntry[]>([]);
  const [policyVersion, setPolicyVersion] = useState<string>(PRIVACY_POLICY_VERSION);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingCategory, setSavingCategory] = useState<OptionalConsentCategory | 'upi_qr_storage' | 'all' | null>(null);
  const [actionError, setActionError] = useState<{
    message: string;
    retryAction: () => void;
  } | null>(null);

  const [expandedCategory, setExpandedCategory] = useState<OptionalConsentCategory | null>(null);
  const [isNoticeOpen, setIsNoticeOpen] = useState<boolean>(false);

  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const copy = PRIVACY_UI_COPY[language];

  const loadConsents = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await privacyConsentApi.fetchConsents();
      setChoices({ ...res.choices });
      setCategoryStates(res.consents || {});
      setHistory(res.history || []);
      setPolicyVersion(res.policyVersion || PRIVACY_POLICY_VERSION);
      setLastUpdatedAt(res.lastUpdatedAt || null);
    } catch (err: any) {
      setLoadError(
        err?.message || 'Could not load your saved privacy preferences from the server.'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConsents();
  }, [loadConsents]);

  // Keep synced if PrivacyChoicesModal or another tab updates consent state
  useEffect(() => {
    const handleSync = () => {
      const cached = getCachedUserPrivacyState(user?.id || user?.uid || null);
      if (cached) {
        setChoices({ ...cached.choices });
      }
    };
    window.addEventListener(PRIVACY_CHANGED_EVENT, handleSync);
    return () => window.removeEventListener(PRIVACY_CHANGED_EVENT, handleSync);
  }, [user?.id, user?.uid]);

  const selectAllState = getSelectAllState(choices);
  const selectedCount = countSelectedOptional(choices);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectAllState === 'indeterminate';
    }
  }, [selectAllState]);

  const handleToggleSingle = async (category: OptionalConsentCategory, nextGranted: boolean) => {
    if (savingCategory) return;
    setActionError(null);
    const prevValue = choices[category];
    const idempotencyKey = generateConsentIdempotencyKey(`settings_${category}`);

    // Optimistic visual feedback, strictly reverted if server fails
    setChoices((prev) => ({ ...prev, [category]: nextGranted }));
    setSavingCategory(category);

    try {
      await privacyConsentApi.saveSingleConsent({
        purpose: category,
        status: nextGranted ? 'granted' : 'withdrawn',
        source: 'settings_manage_consent',
        language,
        idempotencyKey,
      });

      const refreshed = await privacyConsentApi.fetchConsents();
      setChoices({ ...refreshed.choices });
      setCategoryStates(refreshed.consents || {});
      setHistory(refreshed.history || []);
      setLastUpdatedAt(refreshed.lastUpdatedAt || new Date().toISOString());

      const catTitle = CATEGORY_DEF_MAP[category].translations[language].title;
      toast.success(
        nextGranted ? `${catTitle} enabled` : `${catTitle} withdrawn`,
        nextGranted
          ? 'Your explicit consent has been recorded.'
          : 'This optional processing is now switched off. Your core financial records remain intact.'
      );
    } catch (err: any) {
      // Revert strictly on failure — NEVER fake success
      setChoices((prev) => ({ ...prev, [category]: prevValue }));
      const msg =
        err?.message || 'Could not save your consent change. Please check your connection and retry.';
      setActionError({
        message: msg,
        retryAction: () => void handleToggleSingle(category, nextGranted),
      });
      toast.error('Save Failed', msg);
    } finally {
      setSavingCategory(null);
    }
  };

  const handleToggleSelectAll = async () => {
    if (savingCategory) return;
    setActionError(null);
    const prevChoices = { ...choices };
    const nextChoices = toggleSelectAllOptional(choices);
    const grantAll = getSelectAllState(nextChoices) === 'checked';
    const idempotencyKey = generateConsentIdempotencyKey(grantAll ? 'select_all' : 'deselect_all');

    setChoices(nextChoices);
    setSavingCategory('all');

    try {
      if (!grantAll) {
        const res = await privacyConsentApi.withdrawAllOptional({
          source: 'settings_manage_consent',
          language,
          idempotencyKey,
        });
        setChoices({ ...res.choices });
        setCategoryStates(res.consents || {});
        setHistory(res.history || []);
        setLastUpdatedAt(res.lastUpdatedAt || new Date().toISOString());
        toast.info(
          'Optional consents withdrawn',
          'All optional categories are now off. Core financial records remain intact.'
        );
      } else {
        const entries = OPTIONAL_CONSENT_CATEGORIES.map((purpose) => ({
          purpose,
          status: 'granted' as const,
        }));
        const res = await privacyConsentApi.saveChoicesBatch({
          entries,
          source: 'settings_manage_consent',
          language,
          idempotencyKey,
          viaSelectAll: true,
        });
        setChoices({ ...res.choices });
        setCategoryStates(res.consents || {});
        setHistory(res.history || []);
        setLastUpdatedAt(res.lastUpdatedAt || new Date().toISOString());
        toast.success(
          'All optional categories enabled',
          'Each optional consent was recorded separately for your account.'
        );
      }
    } catch (err: any) {
      setChoices(prevChoices);
      const msg =
        err?.message || 'Could not update optional consents. Please retry.';
      setActionError({
        message: msg,
        retryAction: () => void handleToggleSelectAll(),
      });
      toast.error('Update Failed', msg);
    } finally {
      setSavingCategory(null);
    }
  };

  const handleWithdrawAllOptional = async () => {
    if (savingCategory) return;
    setActionError(null);
    const prevChoices = { ...choices };
    const idempotencyKey = generateConsentIdempotencyKey('withdraw_all');

    setChoices(createEmptyOptionalChoices());
    setSavingCategory('all');

    try {
      const res = await privacyConsentApi.withdrawAllOptional({
        source: 'settings_manage_consent',
        language,
        idempotencyKey,
      });
      setChoices({ ...res.choices });
      setCategoryStates(res.consents || {});
      setHistory(res.history || []);
      setLastUpdatedAt(res.lastUpdatedAt || new Date().toISOString());
      toast.info(
        'All optional consents withdrawn',
        'Optional processing has been turned off. Your core financial records were not deleted.'
      );
    } catch (err: any) {
      setChoices(prevChoices);
      const msg =
        err?.message || 'Could not withdraw optional consents. Please retry.';
      setActionError({
        message: msg,
        retryAction: () => void handleWithdrawAllOptional(),
      });
      toast.error('Withdrawal Failed', msg);
    } finally {
      setSavingCategory(null);
    }
  };

  const latestUpiConsentEntry = history.find((row) => row.purpose === 'upi_qr_storage') || null;
  const upiConsentStatus: 'granted' | 'withdrawn' | 'not_granted' = latestUpiConsentEntry
    ? (latestUpiConsentEntry.consent_status || latestUpiConsentEntry.status || latestUpiConsentEntry.action) === 'granted'
      ? 'granted'
      : 'withdrawn'
    : 'not_granted';

  const handleWithdrawUpiConsent = async () => {
    if (savingCategory) return;
    setActionError(null);
    setSavingCategory('upi_qr_storage');
    try {
      await privacyConsentApi.saveSingleConsent({
        purpose: 'upi_qr_storage',
        status: 'withdrawn',
        source: 'settings_manage_consent',
        language,
        idempotencyKey: generateConsentIdempotencyKey('withdraw_upi_qr'),
      });
      const refreshed = await privacyConsentApi.fetchConsents();
      setChoices({ ...refreshed.choices });
      setCategoryStates(refreshed.consents || {});
      setHistory(refreshed.history || []);
      setLastUpdatedAt(refreshed.lastUpdatedAt || new Date().toISOString());
      window.dispatchEvent(new CustomEvent('my-money-upi-profile-changed'));
      toast.info(
        'UPI QR Consent Withdrawn',
        'Your UPI QR storage consent was withdrawn and your saved UPI ID has been removed.'
      );
    } catch (err: any) {
      const msg = err?.message || 'Could not withdraw UPI QR storage consent. Please retry.';
      setActionError({
        message: msg,
        retryAction: () => void handleWithdrawUpiConsent(),
      });
      toast.error('Withdrawal Failed', msg);
    } finally {
      setSavingCategory(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Main Manage Consent Card */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200/80 dark:border-emerald-800/70 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  {copy.headerBadge}
                </p>
                <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">
                  {copy.settingsTitle}
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                  {copy.settingsSubtitle}
                </p>
              </div>
            </div>

            {/* Language Switcher (EN / हिंदी / मराठी) */}
            <div
              className="inline-flex items-center rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200 dark:border-slate-700 self-start shrink-0"
              role="group"
              aria-label="Privacy language selector"
            >
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => setLanguage(lang.code)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                    language === lang.code
                      ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>

          {/* Policy metadata + Sub-tab Switcher */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
              <span>
                <strong className="text-slate-700 dark:text-slate-200 font-semibold">
                  {copy.policyVersionLabel}:
                </strong>{' '}
                {policyVersion}
              </span>
              <span className="tabular-nums">
                <strong className="text-slate-700 dark:text-slate-200 font-semibold">
                  {copy.lastUpdatedLabel}:
                </strong>{' '}
                {lastUpdatedAt ? formatDateTime(lastUpdatedAt) : PRIVACY_POLICY_LAST_UPDATED}
              </span>
            </div>

            <div className="inline-flex items-center rounded-xl bg-slate-100 dark:bg-slate-800 p-1 gap-1 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setSubTab('controls')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  subTab === 'controls'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>{copy.preferencesTab}</span>
              </button>
              <button
                type="button"
                onClick={() => setSubTab('history')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  subTab === 'history'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                <span className="tabular-nums">
                  {copy.historyTab} ({history.length})
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 space-y-5">
          {/* Load Error Banner */}
          {loadError && (
            <div
              role="alert"
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/70 text-xs text-rose-800 dark:text-rose-200"
            >
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <span>{loadError}</span>
              </div>
              <button
                type="button"
                onClick={() => void loadConsents()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold shrink-0 cursor-pointer self-start sm:self-auto"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{copy.retrySave}</span>
              </button>
            </div>
          )}

          {/* Action Error Banner */}
          {actionError && (
            <div
              role="alert"
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/70 text-xs text-rose-800 dark:text-rose-200"
            >
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">{copy.saveErrorTitle}</p>
                  <p className="mt-0.5 text-rose-700 dark:text-rose-300">{actionError.message}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={actionError.retryAction}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold shrink-0 cursor-pointer self-start sm:self-auto"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{copy.retrySave}</span>
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-10 gap-2.5 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              <span>Loading your consent preferences...</span>
            </div>
          ) : subTab === 'controls' ? (
            <>
              {/* Select All Optional + Withdraw All Optional Toolbar */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <label className="flex items-start gap-3 cursor-pointer select-none min-w-0">
                  <span className="relative flex items-center justify-center mt-0.5 shrink-0">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={selectAllState === 'checked'}
                      aria-checked={
                        selectAllState === 'indeterminate'
                          ? 'mixed'
                          : selectAllState === 'checked'
                      }
                      disabled={savingCategory !== null}
                      onChange={() => void handleToggleSelectAll()}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                        selectAllState === 'checked'
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : selectAllState === 'indeterminate'
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      {selectAllState === 'checked' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      {selectAllState === 'indeterminate' && (
                        <Minus className="w-3.5 h-3.5 stroke-[3]" />
                      )}
                    </span>
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                        {copy.selectAllTitle}
                      </span>
                      <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                        {copy.selectedCountLabel(selectedCount, OPTIONAL_CONSENT_CATEGORIES.length)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                      {copy.selectAllDescription}
                    </p>
                  </div>
                </label>

                <button
                  type="button"
                  disabled={savingCategory !== null || selectedCount === 0}
                  onClick={() => void handleWithdrawAllOptional()}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border border-rose-200 dark:border-rose-900/70 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-950/70 text-rose-700 dark:text-rose-300 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0 self-start sm:self-center"
                >
                  {savingCategory === 'all' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {savingCategory === 'all' ? copy.withdrawingLabel : copy.withdrawAllOptional}
                  </span>
                </button>
              </div>

              {/* 6 Individual Optional Consent Category Cards */}
              <div className="space-y-3">
                {OPTIONAL_CONSENT_CATEGORIES.map((category) => {
                  const Icon = CATEGORY_ICONS[category];
                  const details = CATEGORY_DEF_MAP[category].translations[language];
                  const state = categoryStates[category];
                  const enabled = Boolean(choices[category]);
                  const isExpanded = expandedCategory === category;
                  const isBusy = savingCategory === category || savingCategory === 'all';

                  const statusLabel = enabled
                    ? copy.statusGranted
                    : state?.status === 'withdrawn'
                    ? copy.statusWithdrawn
                    : copy.statusNotGranted;

                  const timestampLabel = enabled
                    ? state?.grantedAt || state?.updatedAt
                    : state?.withdrawnAt || state?.updatedAt;

                  return (
                    <div
                      key={category}
                      className={`rounded-2xl border transition-colors ${
                        enabled
                          ? 'border-emerald-300 dark:border-emerald-800/80 bg-emerald-50/30 dark:bg-emerald-950/15'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60'
                      }`}
                    >
                      <div className="p-4 flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                                {details.title}
                              </h3>
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                  enabled
                                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                                    : state?.status === 'withdrawn'
                                    ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                }`}
                              >
                                {statusLabel}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                              {details.shortDescription}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
                              <span>
                                <strong className="font-semibold text-slate-700 dark:text-slate-300">
                                  {copy.dataInvolvedLabel}:
                                </strong>{' '}
                                {details.dataSummary}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 pt-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedCategory(isExpanded ? null : category)
                                }
                                aria-expanded={isExpanded}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                              >
                                {isExpanded ? (
                                  <>
                                    <span>{copy.hideDetails}</span>
                                    <ChevronUp className="w-3.5 h-3.5" />
                                  </>
                                ) : (
                                  <>
                                    <span>{copy.learnMore}</span>
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  </>
                                )}
                              </button>
                              {timestampLabel && (
                                <span className="text-[10.5px] text-slate-400 dark:text-slate-500 tabular-nums">
                                  Updated {formatDateTime(timestampLabel)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Individual Grant / Withdraw Toggle Switch */}
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          aria-label={`${details.title} optional consent`}
                          disabled={isBusy}
                          onClick={() => void handleToggleSingle(category, !enabled)}
                          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 cursor-pointer mt-1 disabled:opacity-50 ${
                            enabled ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all flex items-center justify-center ${
                              enabled ? 'left-[22px]' : 'left-0.5'
                            }`}
                          >
                            {savingCategory === category && (
                              <Loader2 className="w-3 h-3 animate-spin text-emerald-600" />
                            )}
                          </span>
                        </button>
                      </div>

                      {/* Progressive Disclosure ("Learn more") */}
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-3 border-t border-slate-200/70 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 rounded-b-2xl grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11.5px] leading-relaxed">
                          <div>
                            <p className="font-bold text-slate-700 dark:text-slate-200">
                              {copy.detailPurpose}
                            </p>
                            <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                              {details.purposeDetail}
                            </p>
                          </div>
                          <div>
                            <p className="font-bold text-slate-700 dark:text-slate-200">
                              {copy.detailDataCategories}
                            </p>
                            <ul className="list-disc pl-4 text-slate-600 dark:text-slate-400 mt-0.5 space-y-0.5">
                              {details.dataCategories.map((dc, idx) => (
                                <li key={idx}>{dc}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <p className="font-bold text-slate-700 dark:text-slate-200">
                              {copy.detailHowUsed}
                            </p>
                            <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                              {details.howUsed}
                            </p>
                          </div>
                          <div>
                            <p className="font-bold text-slate-700 dark:text-slate-200">
                              {copy.detailProcessors}
                            </p>
                            <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                              {details.externalProcessors}
                            </p>
                          </div>
                          <div>
                            <p className="font-bold text-slate-700 dark:text-slate-200">
                              {copy.detailRetention}
                            </p>
                            <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                              {details.retention}
                            </p>
                          </div>
                          <div>
                            <p className="font-bold text-slate-700 dark:text-slate-200">
                              {copy.detailWithdrawal}
                            </p>
                            <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                              {details.withdrawalProcedure}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Feature-Specific Consent: UPI QR Storage */}
              <div
                data-testid="privacy-upi-consent-card"
                className={`rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  upiConsentStatus === 'granted'
                    ? 'border-emerald-300 dark:border-emerald-800/80 bg-emerald-50/30 dark:bg-emerald-950/15'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                    <QrCode className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                        UPI QR Storage
                      </h3>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                          upiConsentStatus === 'granted'
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                            : upiConsentStatus === 'withdrawn'
                            ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {upiConsentStatus === 'granted'
                          ? copy.statusGranted
                          : upiConsentStatus === 'withdrawn'
                          ? copy.statusWithdrawn
                          : copy.statusNotGranted}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      Stores your UPI ID, optional Payee Name, and optional Payment Note only to generate your personal UPI QR codes. Withdrawing removes your saved UPI profile.
                    </p>
                    {latestUpiConsentEntry && (
                      <p className="text-[10.5px] text-slate-400 dark:text-slate-500 tabular-nums">
                        Updated {formatDateTime(latestUpiConsentEntry.granted_at || latestUpiConsentEntry.withdrawn_at || latestUpiConsentEntry.created_at)}
                      </p>
                    )}
                  </div>
                </div>

                {upiConsentStatus === 'granted' ? (
                  <button
                    type="button"
                    disabled={savingCategory !== null}
                    onClick={() => void handleWithdrawUpiConsent()}
                    data-testid="withdraw-upi-consent-btn"
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-rose-200 dark:border-rose-900/70 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-950/70 text-rose-700 dark:text-rose-300 disabled:opacity-50 transition-colors cursor-pointer shrink-0 self-start sm:self-center"
                  >
                    {savingCategory === 'upi_qr_storage' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5" />
                    )}
                    <span>Withdraw UPI Consent</span>
                  </button>
                ) : (
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
                    Granted only when saving a UPI ID
                  </span>
                )}
              </div>

              {/* Separate Informational Section: Essential Financial Data Processing (NO checkbox) */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/35 p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-slate-600 dark:text-slate-300 shrink-0" />
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                      {copy.essentialTitle}
                    </h3>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 bg-slate-200/80 dark:bg-slate-700/80 px-2 py-0.5 rounded-md">
                    {copy.essentialBadge}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {copy.essentialIntro}
                </p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-700 dark:text-slate-300 list-disc pl-5">
                  {copy.essentialItems.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed pt-1">
                  {copy.essentialLawfulBasis} {copy.essentialNotOptionalNote}
                </p>
              </div>
            </>
          ) : (
            /* Append-Only Consent History Audit Log */
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {copy.historySubtitle}
                </p>
                <button
                  type="button"
                  onClick={() => void loadConsents()}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refresh</span>
                </button>
              </div>

              {history.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center">
                  <History className="w-7 h-7 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                    {copy.historyEmpty}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <th className="py-2.5 px-3 font-semibold">Category</th>
                        <th className="py-2.5 px-3 font-semibold">Status</th>
                        <th className="py-2.5 px-3 font-semibold">Timestamp</th>
                        <th className="py-2.5 px-3 font-semibold">Policy Version</th>
                        <th className="py-2.5 px-3 font-semibold">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {history.map((row) => {
                        const def = CATEGORY_DEF_MAP[row.purpose as OptionalConsentCategory];
                        const label =
                          row.purpose === 'upi_qr_storage'
                            ? 'UPI QR Storage'
                            : def
                            ? def.translations[language].title
                            : row.purpose;
                        const statusVal = row.consent_status || row.status || row.action;
                        const isGranted = statusVal === 'granted';
                        return (
                          <tr
                            key={row.id}
                            className="bg-white dark:bg-slate-900 hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                          >
                            <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">
                              {label}
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`inline-block px-2 py-0.5 rounded-md text-[10.5px] font-bold ${
                                  isGranted
                                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                                    : 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300'
                                }`}
                              >
                                {isGranted ? copy.statusGranted : copy.statusWithdrawn}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 tabular-nums whitespace-nowrap">
                              {formatDateTime(row.granted_at || row.withdrawn_at || row.created_at)}
                            </td>
                            <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">
                              {row.policy_version || PRIVACY_POLICY_VERSION}
                            </td>
                            <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">
                              {row.source || 'consent_center'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Data Principal Rights, Standalone Privacy Notice & Grievance Desk */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  {copy.rightsHeading}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                  {copy.rightsDescription}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsNoticeOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-bold transition-colors cursor-pointer shrink-0 self-start sm:self-center"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{copy.privacyNoticeLink}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {onExportBackup && (
                <button
                  type="button"
                  onClick={onExportBackup}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 hover:border-emerald-300 dark:hover:border-emerald-700 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="truncate">{copy.rightsExport}</span>
                </button>
              )}
              {onNavigateToProfile && (
                <button
                  type="button"
                  onClick={onNavigateToProfile}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 hover:border-emerald-300 dark:hover:border-emerald-700 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                >
                  <UserCog className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="truncate">{copy.rightsCorrection}</span>
                </button>
              )}
              {onNavigateToDeletion && (
                <button
                  type="button"
                  onClick={onNavigateToDeletion}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-rose-200/80 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold text-rose-700 dark:text-rose-300 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{copy.rightsErasure}</span>
                </button>
              )}
              <a
                href={`mailto:${SUPPORT_CONTACT.email}?subject=Privacy%20%26%20Consent%20Grievance%20-%20My%20Money%20Manager`}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 hover:border-emerald-300 dark:hover:border-emerald-700 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
              >
                <Mail className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="truncate">{copy.rightsGrievance}</span>
              </a>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 pt-1">
              <p className="flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span>{copy.hardwarePermsSeparation}</span>
              </p>
              <a
                href={SUPPORT_CONTACT.telUrl}
                className="inline-flex items-center gap-1 font-semibold text-slate-600 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-400 shrink-0"
              >
                <Phone className="w-3 h-3" />
                <span>{SUPPORT_CONTACT.displayPhone}</span>
              </a>
            </div>

            <p className="text-[10.5px] text-slate-400 dark:text-slate-500 leading-relaxed">
              {copy.dpdpHonestNote}
            </p>
          </div>
        </div>
      </section>

      <PrivacyNoticeModal
        isOpen={isNoticeOpen}
        language={language}
        onChangeLanguage={setLanguage}
        onClose={() => setIsNoticeOpen(false)}
        onOpenFullLegalCenter={
          onOpenPrivacyPolicy
            ? () => {
                setIsNoticeOpen(false);
                onOpenPrivacyPolicy();
              }
            : undefined
        }
      />
    </div>
  );
};
