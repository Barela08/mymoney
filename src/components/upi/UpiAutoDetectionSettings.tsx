import React, { useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  Settings,
  RefreshCw,
  FlaskConical,
  Clock,
  Smartphone,
  Edit3,
  Check,
  X,
  Info,
  RotateCcw,
} from 'lucide-react';
import { useUpiDetection } from '../../context/UpiDetectionContext';
import {
  SUPPORTED_UPI_APPS,
  SANITIZED_PARSER_TEST_SAMPLES,
  UPI_EXPENSE_CATEGORIES,
  PARSER_VERSION,
  type DetectedTransaction,
  type NotificationAccessStatus,
  type UpiExpenseCategoryId,
} from '../../lib/upiDetectionEngine';
import { getPlatformCapabilitySummary } from '../../lib/upiNativeBridge';
import { formatINR } from '../../lib/dateUtils';
import { ConfirmModal } from '../common/ConfirmModal';
import { useToast } from '../../context/ToastContext';

function getPermissionDisplay(status: NotificationAccessStatus) {
  switch (status) {
    case 'granted':
      return {
        label: 'Granted',
        className: 'text-emerald-700 dark:text-emerald-400',
        icon: <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />,
      };
    case 'disabled':
      return {
        label: 'Disabled',
        className: 'text-slate-700 dark:text-slate-300',
        icon: <Clock className="w-4 h-4 text-slate-500" />,
      };
    case 'restricted':
      return {
        label: 'Restricted',
        className: 'text-amber-700 dark:text-amber-400',
        icon: <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
      };
    case 'not_supported':
      return {
        label: 'Not Supported',
        className: 'text-amber-700 dark:text-amber-400',
        icon: <Info className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
      };
    default:
      return {
        label: 'Not Granted',
        className: 'text-rose-700 dark:text-rose-400',
        icon: <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />,
      };
  }
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'No detections recorded yet';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

interface UpiAutoDetectionSettingsProps {
  onOpenPrivacyPolicy?: () => void;
}

export const UpiAutoDetectionSettings: React.FC<UpiAutoDetectionSettingsProps> = ({
  onOpenPrivacyPolicy,
}) => {
  const {
    platform,
    permissionStatus,
    serviceStatus,
    settings,
    pendingTransactions,
    categorizedTransactions,
    offlineQueueCount,
    openOnboarding,
    refreshPermissionStatus,
    openNotificationSettings,
    toggleDetectionEnabled,
    toggleSupportedApp,
    toggleAutoPopup,
    runSanitizedParserTest,
    openPopupForDetected,
    dismissDetectedTransaction,
    editDetectedTransaction,
    resetDetectionConfiguration,
    flushOfflineQueue,
  } = useUpiDetection();
  const toast = useToast();

  const [selectedSampleId, setSelectedSampleId] = useState(SANITIZED_PARSER_TEST_SAMPLES[0].id);
  const [testOutcome, setTestOutcome] = useState<{
    accepted: boolean;
    deduplicated: boolean;
    message: string;
  } | null>(null);
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Inline editing state for already-categorized detected expenses
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState<UpiExpenseCategoryId>('Other');
  const [editDescription, setEditDescription] = useState('');

  const permUi = getPermissionDisplay(permissionStatus);
  const capability = getPlatformCapabilitySummary(platform);

  const handleOpenSettingsClick = () => {
    const res = openNotificationSettings();
    if (res.opened) {
      toast.info(
        'Android Settings Opened',
        'Enable Notification Access for My Money Manager, then return to verify status.'
      );
    } else {
      toast.warning(
        'Native Android Required',
        res.reason || 'Notification Access Settings can only be opened inside the Android app.'
      );
    }
  };

  const handleRunParserTest = async () => {
    const sample = SANITIZED_PARSER_TEST_SAMPLES.find((s) => s.id === selectedSampleId);
    if (!sample) return;
    try {
      setIsRunningTest(true);
      const res = await runSanitizedParserTest(sample.input);
      if (res.accepted && res.transaction) {
        setTestOutcome({
          accepted: true,
          deduplicated: res.deduplicated,
          message: res.deduplicated
            ? `Deduplicated existing record (${formatINR(res.transaction.amountRupees)} via ${res.transaction.sourceApp}). No duplicate created.`
            : `Parsed ₹${res.transaction.amountRupees} (${res.transaction.sourceApp}${res.transaction.merchantName ? ` · ${res.transaction.merchantName}` : ''}) via ${res.transaction.parserUsed}. Instant popup opened.`,
        });
      } else {
        setTestOutcome({
          accepted: false,
          deduplicated: false,
          message: `Correctly rejected notification (reason: ${res.rejectionReason || 'filtered_out'}). No popup shown.`,
        });
      }
    } finally {
      setIsRunningTest(false);
    }
  };

  const startEditDetected = (tx: DetectedTransaction) => {
    setEditingTxId(tx.id);
    setEditCategory(tx.selectedCategory || 'Other');
    setEditDescription(tx.description || '');
  };

  const saveEditDetected = async (tx: DetectedTransaction) => {
    await editDetectedTransaction(tx, editCategory, editDescription);
    setEditingTxId(null);
  };

  const handleConfirmReset = async () => {
    try {
      setIsResetting(true);
      await resetDetectionConfiguration(true);
      setTestOutcome(null);
      setIsResetModalOpen(false);
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Master Status & Controls */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <BellRing className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Automatic Expense Detection
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Detect outgoing UPI payment notifications from supported apps and prompt instant categorization.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={openOnboarding}
            className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline self-start cursor-pointer whitespace-nowrap"
          >
            Setup Guide
          </button>
        </div>

        {/* Platform Capability Banner */}
        <div className="rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 p-4 flex items-start gap-3">
          <Smartphone className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" />
          <div className="text-xs space-y-0.5">
            <p className="font-semibold text-slate-900 dark:text-slate-100">{capability.title}</p>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              {capability.description}
            </p>
          </div>
        </div>

        {/* Structured Status Grid (Single-Elevation, Zero-Pill Metadata) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Notification Access
            </p>
            <div className="flex items-center gap-1.5">
              {permUi.icon}
              <span className={`text-sm font-semibold ${permUi.className}`}>{permUi.label}</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Detection Service
            </p>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 capitalize">
              {serviceStatus}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Last Detection
            </p>
            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatTimestamp(settings.lastDetectionAt)}
            </p>
          </div>
        </div>

        {/* Primary Toggles */}
        <div className="divide-y divide-slate-200 dark:divide-slate-800 border-y border-slate-200 dark:border-slate-800">
          <div className="py-3.5 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Enable Automatic Detection
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Disabling immediately stops processing new UPI notifications and pauses the listener service.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.enabled}
              onClick={() => toggleDetectionEnabled(!settings.enabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer ${
                settings.enabled ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                  settings.enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="py-3.5 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Instant Categorization Popup
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Show the 1-tap category popup immediately after an outgoing UPI payment is detected.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoPopupEnabled}
              onClick={() => toggleAutoPopup(!settings.autoPopupEnabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer ${
                settings.autoPopupEnabled ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                  settings.autoPopupEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Permission Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleOpenSettingsClick}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 transition-colors cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Open Notification Permission Settings</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const status = refreshPermissionStatus();
              toast.info('Permission Checked', `Notification Access status: ${status.replace('_', ' ')}`);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Re-check Status</span>
          </button>

          {offlineQueueCount > 0 && (
            <button
              type="button"
              onClick={async () => {
                const synced = await flushOfflineQueue();
                toast.success('Offline Queue Synced', `${synced} queued detection(s) processed.`);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 cursor-pointer"
            >
              <span>Sync Offline Queue ({offlineQueueCount})</span>
            </button>
          )}
        </div>
      </section>

      {/* 2. Supported Payment Apps */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Supported Payment Apps
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Only notifications from enabled UPI packages are parsed. Parser engine v{PARSER_VERSION}.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {SUPPORTED_UPI_APPS.map((app) => {
            const isEnabled = settings.supportedApps[app.id] !== false;
            return (
              <div
                key={app.id}
                className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl border border-slate-200 dark:border-slate-800"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {app.name}
                  </p>
                  <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                    {app.packageNames[0]}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isEnabled}
                  aria-label={`Toggle ${app.name}`}
                  onClick={() => toggleSupportedApp(app.id, !isEnabled)}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer ${
                    isEnabled ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                      isEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. Pending Expense Notifications & Recently Categorized */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Pending Expense Notifications ({pendingTransactions.length})
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Uncategorized or snoozed UPI payments waiting to be saved to your ledger.
            </p>
          </div>
        </div>

        {pendingTransactions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-5 text-center space-y-1">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
              No pending UPI notifications
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Any detected outgoing payment you dismiss with &ldquo;Remind Me Later&rdquo; will appear here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            {pendingTransactions.map((tx) => (
              <div
                key={tx.id}
                className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold font-mono tabular-nums text-slate-950 dark:text-white">
                      {formatINR(tx.amountRupees, tx.amountPaise % 100 !== 0)}
                    </span>
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      {tx.merchantName || 'Merchant not listed'}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      · {tx.sourceApp}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                    {formatTimestamp(tx.transactionTimestamp)}
                    {tx.utrNumber ? ` · UTR ${tx.utrNumber}` : ''}
                    {tx.rrn ? ` · RRN ${tx.rrn}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openPopupForDetected(tx)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                  >
                    Categorize
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissDetectedTransaction(tx.id)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Recently Categorized Detected Expenses (Editable without losing original UPI metadata) */}
        {categorizedTransactions.length > 0 && (
          <div className="pt-3 space-y-2.5">
            <h5 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Recently Categorized UPI Expenses ({categorizedTransactions.length})
            </h5>
            <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              {categorizedTransactions.slice(0, 8).map((tx) => {
                const isEditing = editingTxId === tx.id;
                return (
                  <div key={tx.id} className="p-3.5 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                            {formatINR(tx.amountRupees, tx.amountPaise % 100 !== 0)}
                          </span>
                          <span className="text-xs text-slate-700 dark:text-slate-300">
                            {tx.merchantName || tx.sourceApp}
                          </span>
                          <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                            · {tx.selectedCategory || 'Other'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {tx.description || `Via ${tx.sourceApp}`}
                          {tx.utrNumber ? ` · UTR ${tx.utrNumber}` : ''}
                        </p>
                      </div>

                      {!isEditing && (
                        <button
                          type="button"
                          onClick={() => startEditDetected(tx)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>
                      )}
                    </div>

                    {isEditing && (
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                        <select
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value as UpiExpenseCategoryId)}
                          className="sm:col-span-4 px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                        >
                          {UPI_EXPENSE_CATEGORIES.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          placeholder="Update description"
                          className="sm:col-span-5 px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                        />
                        <div className="sm:col-span-3 flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => saveEditDetected(tx)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Save</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingTxId(null)}
                            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* 4. Test Detection (Explicit Sanitized Parser Verification Sandbox) */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300 shrink-0">
            <FlaskConical className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Test Detection (Sanitized Parser Verification)
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Verify how the parser extracts fields, rejects failed/incoming alerts, and triggers the instant categorization popup using sanitized sample notifications.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <select
            value={selectedSampleId}
            onChange={(e) => setSelectedSampleId(e.target.value)}
            aria-label="Select sanitized sample notification"
            className="flex-1 px-3 py-2 rounded-lg text-xs font-medium bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
          >
            {SANITIZED_PARSER_TEST_SAMPLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleRunParserTest}
            disabled={isRunningTest}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white transition-colors cursor-pointer whitespace-nowrap"
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span>{isRunningTest ? 'Running...' : 'Test Detection'}</span>
          </button>
        </div>

        {testOutcome && (
          <div
            className={`rounded-lg px-3.5 py-2.5 text-xs border ${
              testOutcome.accepted
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200'
                : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
            }`}
          >
            {testOutcome.message}
          </div>
        )}
      </section>

      {/* 5. Privacy Information & Reset Configuration */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Privacy &amp; Data Protection
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              My Money Manager by HackifyPro processes only supported outgoing UPI payment notifications
              to prefill expense details. We never read or store UPI PINs, OTPs, CVVs, banking passwords,
              or personal chat messages. Raw notification payloads are hashed and minimized; detection
              history is isolated per account via PostgreSQL Row Level Security (RLS) and retained for{' '}
              <span className="font-semibold tabular-nums">{settings.retentionDays}</span> days unless
              you delete or reset it earlier.
            </p>
            {onOpenPrivacyPolicy && (
              <button
                type="button"
                onClick={onOpenPrivacyPolicy}
                className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer pt-1"
              >
                Read Full Privacy Policy &rarr;
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <div>
            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Reset Detection Configuration
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Restores default app toggles, turns off automatic detection, and clears pending detection logs.
              Saved ledger transactions are not deleted.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsResetModalOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Configuration</span>
          </button>
        </div>
      </section>

      <ConfirmModal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        onConfirm={handleConfirmReset}
        title="Reset Automatic UPI Detection?"
        message="This resets all UPI detection toggles to defaults and clears pending notification logs. Your already saved expenses remain untouched."
        confirmText="Reset Configuration"
        isDestructive
        isLoading={isResetting}
      />
    </div>
  );
};
