import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  QrCode,
  ShieldCheck,
  Check,
  Minus,
  ChevronDown,
  ChevronUp,
  Cloud,
  Cpu,
  Users,
  BarChart3,
  SlidersHorizontal,
  Megaphone,
  Lock,
  FileText,
  AlertCircle,
  RefreshCw,
  Loader2,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  OPTIONAL_CONSENT_CATEGORIES,
  OPTIONAL_CONSENT_DEFINITIONS,
  PRIVACY_POLICY_VERSION,
  PRIVACY_UI_COPY,
  buildConsentSavePayload,
  countSelectedOptional,
  createEmptyOptionalChoices,
  deselectAllOptional,
  getSelectAllState,
  toggleSelectAllOptional,
  type ConsentLanguage,
  type ConsentStatusValue,
  type OptionalConsentCategory,
  type OptionalConsentChoices,
} from '../../lib/privacyConsent';
import {
  generateConsentIdempotencyKey,
  getCachedUserPrivacyState,
  privacyConsentApi,
} from '../../lib/privacyConsentApi';
import { PrivacyNoticeModal } from './PrivacyNoticeModal';

const CATEGORY_ICONS: Record<OptionalConsentCategory, React.ComponentType<{ className?: string }>> = {
  cloud_sync: Cloud,
  ai_processing: Cpu,
  udhar_sharing: Users,
  upi_qr: QrCode,
  analytics: BarChart3,
  personalization: SlidersHorizontal,
  marketing_updates: Megaphone,
};

const LANGUAGES: Array<{ code: ConsentLanguage; label: string }> = [
  { code: 'en', label: 'EN' },
  { code: 'hi', label: 'हिंदी' },
  { code: 'mr', label: 'मराठी' },
];

export interface PrivacyChoicesModalProps {
  /** If provided, controls visibility explicitly. When omitted, auto-opens only for authenticated users with no saved consent choices yet. */
  isOpen?: boolean;
  /** Optional close handler (closing NEVER saves implicit consent). */
  onClose?: () => void;
  /** Callback invoked ONLY after server/Supabase save succeeds. */
  onSave?: (choices: OptionalConsentChoices) => void;
  /** Optional handler to navigate to full Legal Center. */
  onOpenPrivacyPolicy?: () => void;
  /** Source identifier stored in consent audit metadata. */
  source?: string;
}

export const PrivacyChoicesModal: React.FC<PrivacyChoicesModalProps> = ({
  isOpen: forcedIsOpen,
  onClose,
  onSave,
  onOpenPrivacyPolicy,
  source = 'privacy_choices_modal',
}) => {
  const { user, logout } = useAuth();
  const toast = useToast();

  const [isVisible, setIsVisible] = useState<boolean>(Boolean(forcedIsOpen));
  const [isLoadingInitial, setIsLoadingInitial] = useState<boolean>(false);
  const [language, setLanguage] = useState<ConsentLanguage>('en');

  // CRITICAL: Every optional checkbox starts UNCHECKED (false) for new users.
  const [choices, setChoices] = useState<OptionalConsentChoices>(() => createEmptyOptionalChoices());
  const [previousSavedStatus, setPreviousSavedStatus] = useState<
    Partial<Record<OptionalConsentCategory, ConsentStatusValue>> | null
  >(null);
  const [usedSelectAll, setUsedSelectAll] = useState<boolean>(false);

  // Progressive disclosure ("Learn more") state
  const [expandedCategory, setExpandedCategory] = useState<OptionalConsentCategory | null>(null);
  const [isNoticeOpen, setIsNoticeOpen] = useState<boolean>(false);

  // Save state & idempotency guard (prevents duplicate DB rows on double-click / retry)
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveRequiresReauth, setSaveRequiresReauth] = useState<boolean>(false);
  const isSavingRef = useRef<boolean>(false);
  const saveIdempotencyKeyRef = useRef<string>(generateConsentIdempotencyKey('privacy_save'));
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);

  const userId = user?.id || user?.uid || null;

  // Load real persisted consent state for the authenticated user.
  // New users see all optional categories unchecked; returning users see their saved valid choices.
  const loadUserConsentState = useCallback(async () => {
    if (!userId) {
      setIsVisible(false);
      return;
    }

    // Immediate non-blocking check of user-scoped cache only for returning users
    const cached = getCachedUserPrivacyState(userId);
    if (cached?.hasSavedChoices) {
      setChoices({ ...cached.choices });
      if (forcedIsOpen === undefined) {
        setIsVisible(false);
      }
    } else {
      // Strictly empty / unchecked for new users
      setChoices(createEmptyOptionalChoices());
    }

    setIsLoadingInitial(true);
    try {
      const res = await privacyConsentApi.fetchConsents();
      if (res.hasSavedChoices) {
        setChoices({ ...res.choices });
        const statusMap: Partial<Record<OptionalConsentCategory, ConsentStatusValue>> = {};
        for (const cat of OPTIONAL_CONSENT_CATEGORIES) {
          statusMap[cat] = res.consents?.[cat]?.status ?? (res.choices[cat] ? 'granted' : 'withdrawn');
        }
        setPreviousSavedStatus(statusMap);
        if (forcedIsOpen === undefined) {
          setIsVisible(false);
        }
      } else {
        // Brand-new user: all optional categories strictly unchecked, no implicit save
        setChoices(createEmptyOptionalChoices());
        setPreviousSavedStatus(null);
        if (forcedIsOpen === undefined) {
          setIsVisible(true);
        }
      }
    } catch {
      // If server fetch fails for a user with no cached saved choice, show modal with all unchecked
      // rather than silently assuming any consent.
      if (!cached?.hasSavedChoices) {
        setChoices(createEmptyOptionalChoices());
        setPreviousSavedStatus(null);
        if (forcedIsOpen === undefined) {
          setIsVisible(true);
        }
      }
    } finally {
      setIsLoadingInitial(false);
    }
  }, [userId, forcedIsOpen]);

  useEffect(() => {
    if (forcedIsOpen !== undefined) {
      setIsVisible(forcedIsOpen);
      if (forcedIsOpen) {
        setSaveError(null);
        saveIdempotencyKeyRef.current = generateConsentIdempotencyKey('privacy_save');
        loadUserConsentState();
      }
    } else {
      loadUserConsentState();
    }
  }, [forcedIsOpen, loadUserConsentState]);

  const selectAllState = getSelectAllState(choices);
  const selectedCount = countSelectedOptional(choices);

  // Sync native HTML checkbox indeterminate DOM property
  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = selectAllState === 'indeterminate';
    }
  }, [selectAllState, isVisible]);

  // Escape key closes ONLY if an explicit onClose handler was passed (never saves implicit consent!)
  useEffect(() => {
    if (!isVisible || !onClose) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving && !isNoticeOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isVisible, onClose, isSaving, isNoticeOpen]);

  if (!isVisible) return null;

  const copy = PRIVACY_UI_COPY[language];

  const handleToggleCategory = (key: OptionalConsentCategory) => {
    setSaveError(null);
    setUsedSelectAll(false);
    saveIdempotencyKeyRef.current = generateConsentIdempotencyKey('privacy_save');
    setChoices((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleToggleSelectAll = () => {
    setSaveError(null);
    saveIdempotencyKeyRef.current = generateConsentIdempotencyKey('privacy_save');
    setChoices((prev) => {
      const next = toggleSelectAllOptional(prev);
      setUsedSelectAll(getSelectAllState(next) === 'checked');
      return next;
    });
  };

  const handleDeselectAll = () => {
    setSaveError(null);
    setUsedSelectAll(false);
    saveIdempotencyKeyRef.current = generateConsentIdempotencyKey('privacy_save');
    setChoices(deselectAllOptional());
  };

  const handleSave = async () => {
    if (isSavingRef.current) return;

    // 1. Validate authentication before attempting save
    if (!userId) {
      setSaveError('You must be signed in to save your privacy choices.');
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setSaveError(null);
    setSaveRequiresReauth(false);

    try {
      // 2. Collect ONLY the explicit optional choices (separate entry per category)
      const entries = buildConsentSavePayload(choices, previousSavedStatus);
      const entriesToPersist =
        entries.length > 0
          ? entries
          : OPTIONAL_CONSENT_CATEGORIES.map((purpose) => ({
              purpose,
              status: choices[purpose] ? ('granted' as const) : ('withdrawn' as const),
            }));

      // 3. Persist each category separately to server / Supabase with policy version, timestamp, user_id & idempotency key
      const res = await privacyConsentApi.saveChoicesBatch({
        entries: entriesToPersist,
        source,
        language,
        idempotencyKey: saveIdempotencyKeyRef.current,
        viaSelectAll: usedSelectAll,
      });

      // 4. Only close & show success AFTER real persistence succeeds
      toast.success('Privacy choices saved', 'Your category-by-category preferences have been recorded.');
      setIsVisible(false);
      if (onSave) {
        onSave(res.choices);
      }
      if (onClose) {
        onClose();
      }
    } catch (err: any) {
      // 5. Never display success if Supabase save fails — keep modal open with retry option
      const isAuthErr = err?.status === 401 || err?.code === 'UNAUTHORIZED';
      setSaveRequiresReauth(isAuthErr);
      const msg = isAuthErr
        ? 'Your session has expired. Please sign in again to save your privacy choices.'
        : err?.message || 'Unable to save your privacy choices right now. Please check your connection and retry.';
      setSaveError(msg);
      toast.error('Save failed', msg);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/75 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-choices-heading"
        data-testid="privacy-choices-modal"
      >
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh] sm:max-h-[90vh]">
          {/* PART 1: HEADER */}
          <div className="px-5 pt-5 pb-4 sm:px-6 sm:pt-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800/60 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
                  <ShieldCheck className="w-5 h-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 text-left">
                  <p className="text-[11px] font-bold tracking-wider text-emerald-700 dark:text-emerald-400">
                    {copy.headerBadge}
                  </p>
                  <h2
                    id="privacy-choices-heading"
                    className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 leading-snug mt-0.5"
                  >
                    {copy.headerTitle}
                  </h2>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {/* Language Toggle: English / Hindi / Marathi */}
                <div
                  className="inline-flex items-center p-0.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700"
                  role="group"
                  aria-label="Choose language"
                >
                  {LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => setLanguage(lang.code)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                        language === lang.code
                          ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      {lang.label}
                    </button>
                  ))}
                </div>

                {onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isSaving}
                    aria-label="Close without saving"
                    title="Close without saving"
                    className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-40"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2.5 leading-relaxed text-left">
              {copy.headerSubtitle}
            </p>
          </div>

          {/* SCROLLABLE CONTENT AREA */}
          <div className="px-5 py-4 sm:px-6 overflow-y-auto space-y-4 flex-1 text-left">
            {isLoadingInitial && (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                <span>Loading your saved privacy preferences...</span>
              </div>
            )}

            {/* PART 3: INDIVIDUAL OPTIONAL CONSENT CATEGORIES */}
            <div className="space-y-2.5" role="group" aria-label="Optional privacy categories">
              {OPTIONAL_CONSENT_DEFINITIONS.map((def) => {
                const Icon = CATEGORY_ICONS[def.key];
                const content = def.translations[language];
                const isChecked = Boolean(choices[def.key]);
                const isExpanded = expandedCategory === def.key;

                return (
                  <div
                    key={def.key}
                    data-testid={`consent-card-${def.key}`}
                    className={`rounded-2xl border transition-colors ${
                      isChecked
                        ? 'border-emerald-500/60 bg-emerald-50/30 dark:bg-emerald-950/15'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="p-3.5 sm:p-4">
                      <div className="flex items-start gap-3">
                        <label className="relative flex items-center justify-center mt-0.5 shrink-0 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleCategory(def.key)}
                            aria-label={content.title}
                            data-testid={`consent-checkbox-${def.key}`}
                            className="peer sr-only"
                          />
                          <span
                            aria-hidden="true"
                            className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-600 peer-focus-visible:ring-offset-2 dark:peer-focus-visible:ring-offset-slate-900 ${
                              isChecked
                                ? 'bg-emerald-600 border-emerald-600 text-white'
                                : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600'
                            }`}
                          >
                            {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </span>
                        </label>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div
                              onClick={() => handleToggleCategory(def.key)}
                              className="cursor-pointer min-w-0"
                            >
                              <div className="flex items-center gap-2 flex-wrap">
                                <Icon className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                  {content.title}
                                </span>
                                <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                                  · {copy.optionalBadge}
                                </span>
                              </div>
                              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                                {content.shortDescription}
                              </p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                <span className="font-medium text-slate-600 dark:text-slate-300">
                                  {copy.dataInvolvedLabel}:
                                </span>{' '}
                                {content.dataSummary}
                              </p>
                            </div>
                          </div>

                          {/* PART 6: LEARN MORE / PROGRESSIVE DISCLOSURE */}
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedCategory(isExpanded ? null : def.key)
                              }
                              aria-expanded={isExpanded}
                              aria-controls={`consent-details-${def.key}`}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 rounded"
                            >
                              <span>{isExpanded ? copy.hideDetails : copy.learnMore}</span>
                              {isExpanded ? (
                                <ChevronUp className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div
                          id={`consent-details-${def.key}`}
                          className="mt-3 pt-3 pl-8 border-t border-slate-100 dark:border-slate-800 space-y-2.5 text-xs text-slate-600 dark:text-slate-300"
                        >
                          <div>
                            <p className="font-semibold text-slate-800 dark:text-slate-200">
                              {copy.detailPurpose}
                            </p>
                            <p className="mt-0.5 leading-relaxed">{content.purposeDetail}</p>
                          </div>

                          <div>
                            <p className="font-semibold text-slate-800 dark:text-slate-200">
                              {copy.detailDataCategories}
                            </p>
                            <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                              {content.dataCategories.map((cat, idx) => (
                                <li key={idx}>{cat}</li>
                              ))}
                            </ul>
                          </div>

                          <div>
                            <p className="font-semibold text-slate-800 dark:text-slate-200">
                              {copy.detailHowUsed}
                            </p>
                            <p className="mt-0.5 leading-relaxed">{content.howUsed}</p>
                          </div>

                          <div>
                            <p className="font-semibold text-slate-800 dark:text-slate-200">
                              {copy.detailProcessors}
                            </p>
                            <p className="mt-0.5 leading-relaxed">{content.externalProcessors}</p>
                          </div>

                          <div>
                            <p className="font-semibold text-slate-800 dark:text-slate-200">
                              {copy.detailRetention}
                            </p>
                            <p className="mt-0.5 leading-relaxed">{content.retention}</p>
                          </div>

                          <div>
                            <p className="font-semibold text-slate-800 dark:text-slate-200">
                              {copy.detailWithdrawal}
                            </p>
                            <p className="mt-0.5 leading-relaxed">{content.withdrawalProcedure}</p>
                          </div>

                          {content.importantNote && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                              {content.importantNote}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* PART 4: ESSENTIAL FINANCIAL DATA PROCESSING (SEPARATE INFORMATIONAL SECTION — NO CHECKBOX) */}
            <section
              aria-labelledby="essential-processing-title"
              data-testid="essential-processing-section"
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-4 space-y-2.5"
            >
              <div className="flex items-start gap-2.5">
                <Lock
                  className="w-4 h-4 text-slate-600 dark:text-slate-400 mt-0.5 shrink-0"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <h3
                      id="essential-processing-title"
                      className="text-sm font-bold text-slate-900 dark:text-slate-100"
                    >
                      {copy.essentialTitle}
                    </h3>
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      · {copy.essentialBadge}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                    {copy.essentialIntro}
                  </p>
                </div>
              </div>

              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 pl-6 text-xs text-slate-700 dark:text-slate-300 list-disc">
                {copy.essentialItems.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>

              <div className="pt-2 border-t border-slate-200/80 dark:border-slate-700/70 space-y-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                <p>{copy.essentialLawfulBasis}</p>
                <p className="font-medium text-slate-600 dark:text-slate-300">
                  {copy.essentialNotOptionalNote}
                </p>
              </div>
            </section>

            {selectedCount === 0 && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 px-1 leading-relaxed">
                {copy.allOffInfoNote}
              </p>
            )}
          </div>

          {/* PART 7: FIXED BOTTOM ACTION AREA */}
          <div className="px-5 py-4 sm:px-6 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 shrink-0">
            {saveError && (
              <div
                role="alert"
                className="flex items-start justify-between gap-3 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-800 dark:text-rose-200"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-semibold">{copy.saveErrorTitle}</p>
                    <p className="text-[11px] text-rose-700 dark:text-rose-300 mt-0.5">
                      {saveError}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {saveRequiresReauth ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsVisible(false);
                        logout();
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold shrink-0 cursor-pointer whitespace-nowrap"
                    >
                      <span>Sign In Again</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={isSaving}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold shrink-0 cursor-pointer whitespace-nowrap"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>{copy.retrySave}</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* PART 2 + PART 7: SELECT ALL OPTIONAL BESIDE SAVE MY CHOICES */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              {/* Select All Optional control directly beside Save My Choices */}
              <div
                className={`flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl border transition-colors flex-1 min-w-0 ${
                  selectAllState === 'checked'
                    ? 'border-emerald-500/60 bg-emerald-50/60 dark:bg-emerald-950/25'
                    : selectAllState === 'indeterminate'
                    ? 'border-emerald-400/50 bg-slate-50 dark:bg-slate-800/60'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40'
                }`}
              >
                <label className="flex items-center gap-2.5 cursor-pointer select-none min-w-0 flex-1">
                  <span className="relative flex items-center justify-center shrink-0">
                    <input
                      ref={selectAllCheckboxRef}
                      type="checkbox"
                      checked={selectAllState === 'checked'}
                      aria-checked={
                        selectAllState === 'indeterminate'
                          ? 'mixed'
                          : selectAllState === 'checked'
                      }
                      onChange={handleToggleSelectAll}
                      data-testid="select-all-optional-checkbox"
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-600 peer-focus-visible:ring-offset-2 dark:peer-focus-visible:ring-offset-slate-900 ${
                        selectAllState === 'checked' || selectAllState === 'indeterminate'
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
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 leading-tight">
                        {copy.selectAllTitle}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        ({selectedCount}/{OPTIONAL_CONSENT_CATEGORIES.length})
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {selectAllState === 'indeterminate'
                        ? copy.selectAllPartial
                        : selectAllState === 'checked'
                        ? copy.selectAllSelected
                        : copy.selectAllHint}
                    </p>
                  </div>
                </label>

                {selectedCount > 0 && (
                  <button
                    type="button"
                    onClick={handleDeselectAll}
                    data-testid="deselect-all-optional-btn"
                    className="px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-700 transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                  >
                    {copy.deselectAll}
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                data-testid="save-privacy-choices-btn"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white text-sm font-semibold transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{copy.savingLabel}</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 stroke-[2.5]" />
                    <span>{copy.saveMyChoices}</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/80">
              <button
                type="button"
                onClick={() => setIsNoticeOpen(true)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 rounded"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{copy.privacyNoticeLink}</span>
              </button>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {copy.footerMeta} · {PRIVACY_POLICY_VERSION}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Standalone Trilingual Privacy Notice Modal */}
      <PrivacyNoticeModal
        isOpen={isNoticeOpen}
        onClose={() => setIsNoticeOpen(false)}
        language={language}
        onChangeLanguage={setLanguage}
        onOpenFullLegalCenter={onOpenPrivacyPolicy}
      />
    </>
  );
};
