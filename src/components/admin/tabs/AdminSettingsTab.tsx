import React, { useState, useEffect, useRef } from 'react';
import {
  Save,
  RefreshCw,
  CheckCircle2,
  Lock,
  Wrench,
  Globe,
  Sliders,
  Bell,
  Moon,
  Smartphone,
  Upload,
  RotateCcw,
  Image as ImageIcon,
  Server,
  Sparkles,
  Database,
  Mail,
  AlertCircle,
  KeyRound,
  Eye,
  EyeOff,
  Trash2,
  ShieldCheck,
  Download,
} from 'lucide-react';
import { useExpense, sanitizeLogoUrl } from '../../../context/ExpenseContext';
import { useToast } from '../../../context/ToastContext';
import { adminClient, AdminApiSettings } from '../../../lib/adminApi';
import { MaintenanceSettings, AppDownloadPopupSettings } from '../../../types';
import { MaintenanceScreen } from '../../maintenance/MaintenanceScreen';
import { SUPPORT_CONTACT } from '../../../config/contact';

interface IntegrationStatus {
  geminiConfigured: boolean;
  supabaseConfigured: boolean;
  databaseConfigured: boolean;
  smtpConfigured: boolean;
  webPushConfigured: boolean;
}

const DEFAULT_ALLOWED_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
];

function resizeLogoToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      reject(new Error('Please upload a PNG, JPG, WebP, or GIF image. SVG files are blocked for security.'));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      reject(new Error('Logo image must be 2 MB or smaller.'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected image file.'));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error('Selected file is not a valid image.'));
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Browser canvas unavailable to process logo.'));
          return;
        }
        // Center-crop to square so logo stays sharp in rounded avatars & headers
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        const dataUrl = canvas.toDataURL('image/png', 0.92);
        resolve(dataUrl);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export const AdminSettingsTab: React.FC = () => {
  const toast = useToast();
  const {
    maintenanceSettings,
    updateMaintenanceSettings,
    appPopupSettings,
    updateAppPopupSettings,
    appBranding,
    updateAppBranding,
  } = useExpense();

  const logoInputRef = useRef<HTMLInputElement | null>(null);

  // Maintenance form
  const [maintForm, setMaintForm] = useState<MaintenanceSettings>(maintenanceSettings);
  const [showMaintPreview, setShowMaintPreview] = useState(false);
  const [isSavingMaint, setIsSavingMaint] = useState(false);

  // App Download Popup form
  const [popupForm, setPopupForm] = useState<AppDownloadPopupSettings>(appPopupSettings);
  const [isSavingPopup, setIsSavingPopup] = useState(false);

  // Branding & App Logo Form
  const [appName, setAppName] = useState(appBranding?.appName || appBranding?.brandTitle || 'My Money Manager');
  const [subTitle, setSubTitle] = useState(appBranding?.subTitle || 'by HackifyPro');
  const [logoUrl, setLogoUrl] = useState(appBranding?.logoUrl || '/logo.jpg');
  const [companyName, setCompanyName] = useState(appBranding?.companyName || SUPPORT_CONTACT.companyName);
  const [supportEmail, setSupportEmail] = useState<string>(appBranding?.supportEmail || SUPPORT_CONTACT.email);
  const [supportPhone, setSupportPhone] = useState<string>(appBranding?.supportPhone || SUPPORT_CONTACT.displayPhone);
  const [footerText, setFooterText] = useState(
    appBranding?.footerText || '© 2026 My Money Manager by HackifyPro. All rights reserved.'
  );
  const [allowRegistration, setAllowRegistration] = useState(appBranding?.allowRegistration ?? true);
  const [allowLogin, setAllowLogin] = useState(appBranding?.allowLogin ?? true);
  const [isSavingBrand, setIsSavingBrand] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  // Server-Side API Key & Service Integrations Form
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(null);
  const [apiSettings, setApiSettings] = useState<AdminApiSettings | null>(null);
  const [geminiApiKeyInput, setGeminiApiKeyInput] = useState('');
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [verifyKeyBeforeSave, setVerifyKeyBeforeSave] = useState(true);
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [isTestingApiKey, setIsTestingApiKey] = useState(false);
  const [isRemovingApiKey, setIsRemovingApiKey] = useState(false);
  const [allowedAiModels, setAllowedAiModels] = useState<string[]>(DEFAULT_ALLOWED_MODELS);
  const [aiModel, setAiModel] = useState('gemini-2.5-flash-lite');
  const [aiEnabled, setAiEnabled] = useState(true);
  const [senderName, setSenderName] = useState('My Money Manager by HackifyPro');
  const [siteUrl, setSiteUrl] = useState('https://mymoney.nileshbarela.site');
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(false);
  const [isSavingIntegrations, setIsSavingIntegrations] = useState(false);

  // Admin Notification Preferences Form
  const [alertNewUser, setAlertNewUser] = useState(true);
  const [alertAppInstall, setAlertAppInstall] = useState(true);
  const [alertSupportTicket, setAlertSupportTicket] = useState(true);
  const [alertCriticalSecurity, setAlertCriticalSecurity] = useState(true);
  const [alertPushFailure, setAlertPushFailure] = useState(true);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietHoursStart, setQuietHoursStart] = useState('22:00');
  const [quietHoursEnd, setQuietHoursEnd] = useState('07:00');
  const [deliveryChannel, setDeliveryChannel] = useState<
    'push_and_inapp' | 'push_only' | 'email_only' | 'inapp_only'
  >('push_and_inapp');
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);
  const [isSendingTestPush, setIsSendingTestPush] = useState(false);

  const loadIntegrationsConfig = async () => {
    setIsLoadingIntegrations(true);
    try {
      const [res, apiRes]: [any, any] = await Promise.all([
        adminClient.getIntegrationsConfig().catch(() => null),
        adminClient.getApiSettings().catch(() => null),
      ]);
      if (res?.success) {
        if (res.status) setIntegrationStatus(res.status);
        if (res.config) {
          if (Array.isArray(res.config.allowedAiModels) && res.config.allowedAiModels.length > 0) {
            setAllowedAiModels(res.config.allowedAiModels);
          }
          if (res.config.aiModel) setAiModel(res.config.aiModel);
          if (typeof res.config.aiEnabled === 'boolean') setAiEnabled(res.config.aiEnabled);
          if (res.config.senderName) setSenderName(res.config.senderName);
          if (res.config.siteUrl) setSiteUrl(res.config.siteUrl);
        }
      }
      if (apiRes?.success && apiRes.apiSettings) {
        setApiSettings(apiRes.apiSettings);
        if (apiRes.apiSettings.aiModel) setAiModel(apiRes.apiSettings.aiModel);
        if (typeof apiRes.apiSettings.aiEnabled === 'boolean') setAiEnabled(apiRes.apiSettings.aiEnabled);
      }
    } catch {
      // Keep graceful defaults when backend is unavailable
    } finally {
      setIsLoadingIntegrations(false);
    }
  };

  useEffect(() => {
    loadIntegrationsConfig();
    adminClient
      .getAdminNotificationPreferences()
      .then((res: any) => {
        if (res.success && res.preferences) {
          const p = res.preferences;
          if (p.alert_new_user_registration !== undefined) setAlertNewUser(p.alert_new_user_registration);
          if (p.alert_app_installation !== undefined) setAlertAppInstall(p.alert_app_installation);
          if (p.alert_support_ticket !== undefined) setAlertSupportTicket(p.alert_support_ticket);
          if (p.alert_critical_security !== undefined) setAlertCriticalSecurity(p.alert_critical_security);
          if (p.alert_push_failure !== undefined) setAlertPushFailure(p.alert_push_failure);
          if (p.quiet_hours_enabled !== undefined) setQuietHoursEnabled(p.quiet_hours_enabled);
          if (p.quiet_hours_start) setQuietHoursStart(p.quiet_hours_start);
          if (p.quiet_hours_end) setQuietHoursEnd(p.quiet_hours_end);
          if (p.delivery_channel) setDeliveryChannel(p.delivery_channel);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setMaintForm(maintenanceSettings);
  }, [maintenanceSettings]);

  useEffect(() => {
    setPopupForm(appPopupSettings);
  }, [appPopupSettings]);

  useEffect(() => {
    if (!appBranding) return;
    setAppName(appBranding.appName || appBranding.brandTitle || 'My Money Manager');
    setSubTitle(appBranding.subTitle || 'by HackifyPro');
    setLogoUrl(appBranding.logoUrl || '/logo.jpg');
    setCompanyName(appBranding.companyName || SUPPORT_CONTACT.companyName);
    setSupportEmail(appBranding.supportEmail || SUPPORT_CONTACT.email);
    setSupportPhone(appBranding.supportPhone || SUPPORT_CONTACT.displayPhone);
    setFooterText(appBranding.footerText || '© 2026 My Money Manager by HackifyPro. All rights reserved.');
    setAllowRegistration(appBranding.allowRegistration ?? true);
    setAllowLogin(appBranding.allowLogin ?? true);
  }, [appBranding]);

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingLogo(true);
    try {
      const processedDataUrl = await resizeLogoToDataUrl(file);
      setLogoUrl(processedDataUrl);
      toast.info('Logo Preview Ready', 'Click "Save Branding & App Logo" to apply across the entire app.');
    } catch (err: any) {
      toast.error('Invalid Logo File', err?.message || 'Could not process selected logo image.');
    } finally {
      setIsUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const handleResetLogo = () => {
    setLogoUrl('/logo.jpg');
    toast.info('Default Logo Restored', 'Click "Save Branding & App Logo" to save the default HackifyPro logo.');
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedLogo = logoUrl.trim();
    const safeLogo = sanitizeLogoUrl(trimmedLogo);
    if (trimmedLogo && safeLogo === '/logo.jpg' && trimmedLogo !== '/logo.jpg') {
      toast.error(
        'Unsafe Logo URL',
        'Logo URL must be a relative path (/logo.jpg), an https:// image link, or an uploaded PNG/JPG/WebP image.'
      );
      return;
    }

    setIsSavingBrand(true);
    try {
      await updateAppBranding({
        appName: appName.trim() || 'My Money Manager',
        brandTitle: appName.trim() || 'My Money Manager',
        subTitle: subTitle.trim() || 'by HackifyPro',
        logoUrl: safeLogo,
        companyName: companyName.trim() || SUPPORT_CONTACT.companyName,
        supportEmail: supportEmail.trim() || SUPPORT_CONTACT.email,
        supportPhone: supportPhone.trim() || SUPPORT_CONTACT.displayPhone,
        footerText: footerText.trim(),
        allowRegistration,
        allowLogin,
        showBrandingBadge: true,
      });
      toast.success(
        'Branding & Logo Updated',
        'App logo, title, and favicon are now live across all screens.'
      );
    } catch (err: any) {
      toast.error('Save Error', err?.message || 'Could not save branding settings.');
    } finally {
      setIsSavingBrand(false);
    }
  };

  const handleSaveIntegrations = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingIntegrations(true);
    try {
      const res: any = await adminClient.updateIntegrationsConfig({
        aiModel,
        aiEnabled,
        senderName,
        siteUrl,
        supportEmail,
        supportPhone,
      });
      if (res?.success) {
        toast.success('Integrations Updated', 'Server-side AI model and service configuration saved.');
        await loadIntegrationsConfig();
      }
    } catch (err: any) {
      toast.error('Update Failed', err?.message || 'Could not update integration settings.');
    } finally {
      setIsSavingIntegrations(false);
    }
  };

  const handleSaveApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedKey = geminiApiKeyInput.trim();
    if (!trimmedKey) {
      toast.error('API Key Required', 'Please enter a valid Gemini API key before saving.');
      return;
    }
    if (trimmedKey.length < 20 || /\s/.test(trimmedKey)) {
      toast.error('Invalid API Key Format', 'Gemini API key appears too short or contains spaces.');
      return;
    }

    setIsSavingApiKey(true);
    try {
      const res = await adminClient.saveApiSettings({
        apiKey: trimmedKey,
        aiModel,
        aiEnabled,
        verifyKey: verifyKeyBeforeSave,
      });
      if (res?.apiSettings) {
        setApiSettings(res.apiSettings);
      }
      setGeminiApiKeyInput('');
      setShowGeminiKey(false);
      toast.success(
        'API Key Saved Securely',
        res?.message || 'Gemini API key encrypted and stored server-side.'
      );
      await loadIntegrationsConfig();
    } catch (err: any) {
      toast.error('Failed to Save API Key', err?.message || 'Could not validate or store API key.');
    } finally {
      setIsSavingApiKey(false);
    }
  };

  const handleTestApiKey = async () => {
    const trimmedKey = geminiApiKeyInput.trim();
    setIsTestingApiKey(true);
    try {
      const res = await adminClient.testApiKey(trimmedKey || undefined);
      if (res?.apiSettings) {
        setApiSettings(res.apiSettings);
      }
      if (res?.validation?.valid) {
        toast.success('API Key Verified', res.validation.message || 'Gemini API key responded successfully.');
      } else {
        toast.error('API Key Invalid', res?.validation?.message || 'Gemini API key verification failed.');
      }
    } catch (err: any) {
      toast.error('API Key Test Failed', err?.message || 'Gemini API key could not be verified.');
    } finally {
      setIsTestingApiKey(false);
    }
  };

  const handleRemoveSavedApiKey = async () => {
    setIsRemovingApiKey(true);
    try {
      const res = await adminClient.deleteApiKey();
      if (res?.apiSettings) {
        setApiSettings(res.apiSettings);
      }
      setGeminiApiKeyInput('');
      toast.info('Saved API Key Removed', res?.message || 'Custom Gemini API key deleted.');
      await loadIntegrationsConfig();
    } catch (err: any) {
      toast.error('Remove Failed', err?.message || 'Could not delete saved API key.');
    } finally {
      setIsRemovingApiKey(false);
    }
  };

  const handleSaveMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingMaint(true);
    try {
      await updateMaintenanceSettings(maintForm);
      toast.success(
        maintForm.isEnabled ? 'Maintenance Mode ON' : 'Maintenance Mode OFF',
        maintForm.isEnabled
          ? 'Normal users are now blocked by maintenance splash.'
          : 'Normal user access is restored.'
      );
    } catch (err: any) {
      toast.error('Save Error', err?.message || 'Failed to update maintenance mode settings.');
    } finally {
      setIsSavingMaint(false);
    }
  };

  const handleSaveAppPopup = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawUrl = (popupForm.downloadUrl || '').trim() || '/#install';
    const isValidUrl =
      (rawUrl.startsWith('/') && !rawUrl.startsWith('//')) ||
      /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(rawUrl);

    if (!isValidUrl) {
      toast.error(
        'Invalid Download URL',
        'Please enter a valid https://, http://, or relative (/...) download URL.'
      );
      return;
    }

    setIsSavingPopup(true);
    try {
      await updateAppPopupSettings({
        ...popupForm,
        downloadUrl: rawUrl,
        title: popupForm.title.trim() || 'Get the My Money Manager App',
        description: popupForm.description.trim(),
        buttonLabel: popupForm.buttonLabel.trim() || 'Download App',
      });
      toast.success(
        popupForm.enabled ? 'App Popup Enabled' : 'App Popup Disabled',
        'App download popup settings and download URL updated.'
      );
    } catch (err: any) {
      toast.error('Save Error', err?.message || 'Failed to update app download popup settings.');
    } finally {
      setIsSavingPopup(false);
    }
  };

  const handleSaveNotificationPreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingPrefs(true);
    try {
      const res = await adminClient.saveAdminNotificationPreferences({
        alert_new_user_registration: alertNewUser,
        alert_app_installation: alertAppInstall,
        alert_support_ticket: alertSupportTicket,
        alert_critical_security: alertCriticalSecurity,
        alert_push_failure: alertPushFailure,
        quiet_hours_enabled: quietHoursEnabled,
        quiet_hours_start: quietHoursStart,
        quiet_hours_end: quietHoursEnd,
        delivery_channel: deliveryChannel,
      });
      if (res.success) {
        toast.success('Admin Preferences Saved', 'Notification routing and alert rules updated.');
      }
    } catch (err: any) {
      toast.error('Save Failed', err.message);
    } finally {
      setIsSavingPrefs(false);
    }
  };

  const handleTestAdminAlert = async () => {
    setIsSendingTestPush(true);
    try {
      const res = await adminClient.sendTestNotification({
        title: 'Admin Verification Alert',
        message: 'This confirms your administrative push notification channel is active and functional.',
        deep_link: 'admin',
      });
      if (res.success) {
        toast.success('Test Push Dispatched', res.message);
      } else {
        toast.warning('Push Warning', res.message);
      }
    } catch (err: any) {
      toast.error('Test Push Error', err.message);
    } finally {
      setIsSendingTestPush(false);
    }
  };

  const statusRows = [
    {
      label: 'Google Gemini AI API',
      envHint: 'GEMINI_API_KEY',
      ok: integrationStatus?.geminiConfigured ?? false,
      icon: Sparkles,
    },
    {
      label: 'Supabase Cloud Storage',
      envHint: 'SUPABASE_URL & SERVICE_ROLE_KEY',
      ok: integrationStatus?.supabaseConfigured ?? false,
      icon: Globe,
    },
    {
      label: 'PostgreSQL Database Pool',
      envHint: 'DATABASE_URL',
      ok: integrationStatus?.databaseConfigured ?? false,
      icon: Database,
    },
    {
      label: 'SMTP Transactional Email',
      envHint: 'SMTP_HOST, SMTP_USER, SMTP_PASS',
      ok: integrationStatus?.smtpConfigured ?? false,
      icon: Mail,
    },
    {
      label: 'Web Push Notifications',
      envHint: 'VAPID_PUBLIC_KEY & VAPID_PRIVATE_KEY',
      ok: integrationStatus?.webPushConfigured ?? false,
      icon: Bell,
    },
  ];

  return (
    <div className="space-y-6">
      {/* 1. App Logo, Branding & General Settings */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <ImageIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                App Logo, Platform Branding & Support Details
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Change the app logo, brand title, subtitle, and support info live across all user and admin views
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSaveBranding} className="space-y-5">
          {/* App Logo Uploader & Preview */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/70 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-3.5 shrink-0">
              <img
                src={sanitizeLogoUrl(logoUrl)}
                alt="App Logo Preview"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = '/logo.jpg';
                }}
                className="w-16 h-16 rounded-2xl object-cover border-2 border-emerald-500/40 shadow-sm bg-white"
              />
              <div className="sm:hidden">
                <p className="text-xs font-bold text-slate-900 dark:text-slate-100">Current App Logo</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">PNG, JPG, WebP · Auto-cropped square</p>
              </div>
            </div>

            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={handleLogoFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={isUploadingLogo}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isUploadingLogo ? 'Processing...' : 'Upload New Logo'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetLogo}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-200/80 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-bold cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Default</span>
                </button>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">
                  Or paste a secure Logo URL (/logo.jpg or https://...)
                </label>
                <input
                  type="text"
                  value={logoUrl.startsWith('data:image/') ? '[Uploaded Custom Image]' : logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="/logo.jpg or https://example.com/logo.png"
                  className="w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Application Name</label>
              <input
                type="text"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Brand Subtitle</label>
              <input
                type="text"
                value={subTitle}
                onChange={(e) => setSubTitle(e.target.value)}
                placeholder="by HackifyPro"
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Operating Organization</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Support Email Address</label>
              <input
                type="email"
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Support Helpline Phone</label>
              <input
                type="text"
                value={supportPhone}
                onChange={(e) => setSupportPhone(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">Statutory Footer Copyright</label>
            <input
              type="text"
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            />
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={allowRegistration}
                onChange={(e) => setAllowRegistration(e.target.checked)}
                className="rounded text-emerald-600"
              />
              <span>Public Registration Open (Allow new signups)</span>
            </label>

            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={allowLogin}
                onChange={(e) => setAllowLogin(e.target.checked)}
                className="rounded text-emerald-600"
              />
              <span>Allow Standard User Sign-In</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={isSavingBrand}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSavingBrand ? 'Saving...' : 'Save Branding & App Logo'}</span>
          </button>
        </form>
      </div>

      {/* 2. Server-Side API & Service Integrations Configuration */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                API Services & Server Integrations
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Monitor server environment credentials and manage active AI model & delivery parameters
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={loadIntegrationsConfig}
            disabled={isLoadingIntegrations}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold cursor-pointer self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingIntegrations ? 'animate-spin' : ''}`} />
            <span>Refresh Status</span>
          </button>
        </div>

        {/* Security Notice — Encrypted Server-Only Secret Storage */}
        <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
          <Lock className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            Gemini API keys entered below are encrypted with AES-256-GCM on the server before database storage and are never sent back to browsers or normal users. Other infrastructure secrets (<code className="font-mono text-[11px]">SMTP_PASS</code>,{' '}
            <code className="font-mono text-[11px]">SUPABASE_SERVICE_ROLE_KEY</code>,{' '}
            <code className="font-mono text-[11px]">VAPID_PRIVATE_KEY</code>) remain exclusively in server environment variables.
          </p>
        </div>

        {/* Dedicated API Key Management Panel */}
        <form
          onSubmit={handleSaveApiKey}
          className="p-4 sm:p-5 rounded-2xl bg-slate-50/90 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/80 space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                <KeyRound className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-extrabold text-slate-900 dark:text-slate-100">
                  Gemini API Key Management
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Powers AI Financial Assistant, Smart Categorization &amp; Receipt Scanner OCR
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                  apiSettings?.configured
                    ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
                    : 'bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300'
                }`}
              >
                {apiSettings?.configured ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>
                      Active ({apiSettings.source === 'admin_settings' ? 'Admin Saved' : 'Server Env'})
                    </span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Not Configured</span>
                  </>
                )}
              </span>

              {apiSettings?.lastValidation && (
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                    apiSettings.lastValidation.valid
                      ? 'bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300'
                      : 'bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{apiSettings.lastValidation.valid ? 'Key Verified' : 'Key Invalid'}</span>
                </span>
              )}
            </div>
          </div>

          {apiSettings?.maskedApiKey && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              <div className="text-xs">
                <span className="text-slate-500 dark:text-slate-400 font-semibold mr-2">Current Stored Key:</span>
                <code className="font-mono font-bold text-slate-900 dark:text-slate-100">
                  {apiSettings.maskedApiKey}
                </code>
              </div>
              {apiSettings.updatedAt && (
                <span className="text-[11px] text-slate-400 font-mono">
                  Updated {new Date(apiSettings.updatedAt).toLocaleString()}
                  {apiSettings.updatedBy ? ` by ${apiSettings.updatedBy}` : ''}
                </span>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label
              htmlFor="admin-gemini-api-key"
              className="block text-[11px] font-bold text-slate-600 dark:text-slate-300"
            >
              {apiSettings?.hasSavedKey ? 'Update Gemini API Key' : 'Enter Gemini API Key'}
            </label>
            <div className="relative">
              <input
                id="admin-gemini-api-key"
                type={showGeminiKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                value={geminiApiKeyInput}
                onChange={(e) => setGeminiApiKeyInput(e.target.value)}
                placeholder="Paste new Gemini API key (e.g. AIzaSy...)"
                className="w-full pl-3.5 pr-11 py-2.5 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowGeminiKey((prev) => !prev)}
                aria-label={showGeminiKey ? 'Hide API key' : 'Show API key'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={verifyKeyBeforeSave}
              onChange={(e) => setVerifyKeyBeforeSave(e.target.checked)}
              className="w-4 h-4 rounded text-emerald-600"
            />
            <span className="font-semibold">Verify key with Google Gemini API before saving</span>
          </label>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="submit"
              disabled={isSavingApiKey}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSavingApiKey ? 'Verifying & Saving...' : 'Save API Key'}</span>
            </button>

            <button
              type="button"
              onClick={handleTestApiKey}
              disabled={isTestingApiKey}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isTestingApiKey ? 'Testing Key...' : 'Test API Key'}</span>
            </button>

            {apiSettings?.hasSavedKey && (
              <button
                type="button"
                onClick={handleRemoveSavedApiKey}
                disabled={isRemovingApiKey}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 text-xs font-bold cursor-pointer disabled:opacity-50 ml-auto"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isRemovingApiKey ? 'Removing...' : 'Remove Saved Key'}</span>
              </button>
            )}
          </div>
        </form>

        {/* Live Server Env Readiness Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {statusRows.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 flex items-start justify-between gap-2"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                      {item.label}
                    </p>
                    <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {item.envHint}
                    </p>
                  </div>
                </div>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0 ${
                    item.ok
                      ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
                      : 'bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300'
                  }`}
                >
                  {item.ok ? (
                    <>
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Configured</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-3 h-3" />
                      <span>Not Set</span>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {/* Editable Non-Secret Integration Controls */}
        <form onSubmit={handleSaveIntegrations} className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                Active Gemini AI Model
              </label>
              <select
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono"
              >
                {allowedAiModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                Email Sender Display Name
              </label>
              <input
                type="text"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                Public App URL
              </label>
              <input
                type="url"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                placeholder="https://mymoney.nileshbarela.site"
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono"
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={aiEnabled}
              onChange={(e) => setAiEnabled(e.target.checked)}
              className="w-4 h-4 rounded text-emerald-600"
            />
            <div>
              <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Enable External AI Service (for users who granted AI consent)
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Uncheck to pause all outbound Gemini API calls server-wide while keeping local non-AI features running.
              </p>
            </div>
          </label>

          <button
            type="submit"
            disabled={isSavingIntegrations}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md shadow-indigo-600/20 cursor-pointer disabled:opacity-50"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>{isSavingIntegrations ? 'Saving...' : 'Save Service Configuration'}</span>
          </button>
        </form>
      </div>

      {/* 3. Maintenance Mode Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <Wrench className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Maintenance Mode Configuration
                </h3>
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase ${
                    maintForm.isEnabled
                      ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300'
                      : 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
                  }`}
                >
                  {maintForm.isEnabled ? 'ON' : 'OFF'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                When active, non-admin visitors are intercepted with a customized status splash
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowMaintPreview(true)}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold cursor-pointer"
          >
            Preview Splash
          </button>
        </div>

        <form onSubmit={handleSaveMaintenance} className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl">
            <input
              type="checkbox"
              id="maintEnabled"
              checked={maintForm.isEnabled}
              onChange={(e) => setMaintForm({ ...maintForm, isEnabled: e.target.checked })}
              className="rounded text-amber-600 w-4 h-4"
            />
            <label htmlFor="maintEnabled" className="text-xs font-bold cursor-pointer">
              Enable Maintenance Lockout (Admins retain bypass access)
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Splash Title</label>
              <input
                type="text"
                value={maintForm.title}
                onChange={(e) => setMaintForm({ ...maintForm, title: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                Expected Restoration Window
              </label>
              <input
                type="text"
                value={maintForm.expectedRestoration || ''}
                onChange={(e) => setMaintForm({ ...maintForm, expectedRestoration: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">User Notice Message</label>
            <textarea
              rows={2}
              value={maintForm.message}
              onChange={(e) => setMaintForm({ ...maintForm, message: e.target.value })}
              className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 leading-relaxed"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isSavingMaint}
            className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-md shadow-amber-600/20 cursor-pointer disabled:opacity-50"
          >
            {isSavingMaint ? 'Saving...' : 'Save & Enforce Maintenance Mode'}
          </button>
        </form>
      </div>

      {/* 4. App Download Popup & Download URL Settings */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  App Download Popup &amp; Download Link
                </h3>
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase ${
                    popupForm.enabled
                      ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {popupForm.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Configure the bottom-right App Download prompt shown on the user website &amp; login page
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSaveAppPopup} className="space-y-4">
          <label className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl cursor-pointer">
            <input
              type="checkbox"
              checked={popupForm.enabled}
              onChange={(e) => setPopupForm({ ...popupForm, enabled: e.target.checked })}
              className="rounded text-emerald-600 w-4 h-4"
            />
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
              Show App Download Popup on Website &amp; Normal Login Page (Hidden on /admin)
            </span>
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                App Download URL (https://..., http://..., or /#install)
              </label>
              <input
                type="text"
                value={popupForm.downloadUrl}
                onChange={(e) => setPopupForm({ ...popupForm, downloadUrl: e.target.value })}
                placeholder="https://play.google.com/... or /#install"
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Download Button Label</label>
              <input
                type="text"
                value={popupForm.buttonLabel}
                onChange={(e) => setPopupForm({ ...popupForm, buttonLabel: e.target.value })}
                placeholder="Download App"
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Popup Heading</label>
              <input
                type="text"
                value={popupForm.title}
                onChange={(e) => setPopupForm({ ...popupForm, title: e.target.value })}
                placeholder="Get the My Money Manager App"
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Popup Short Description</label>
              <input
                type="text"
                value={popupForm.description}
                onChange={(e) => setPopupForm({ ...popupForm, description: e.target.value })}
                placeholder="Install our fast, offline-ready app for instant expense tracking & UPI alerts."
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSavingPopup}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSavingPopup ? 'Saving...' : 'Save App Popup & URL Settings'}</span>
          </button>
        </form>
      </div>

      {/* 5. Admin Notification Preferences & Two-Way Routing */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Admin Notification Preferences & Two-Way Alert Routing
              </h3>
              <p className="text-xs text-slate-400">
                Configure real-time event triggers sent from users to the administration center
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleTestAdminAlert}
            disabled={isSendingTestPush}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 text-xs font-bold transition-colors cursor-pointer self-start sm:self-auto disabled:opacity-50"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>{isSendingTestPush ? 'Testing...' : 'Test Admin Push Alert'}</span>
          </button>
        </div>

        <form onSubmit={handleSaveNotificationPreferences} className="space-y-4 text-xs">
          <div>
            <p className="font-bold text-slate-700 dark:text-slate-300 mb-2">
              Event Trigger Subscriptions (User-to-Admin)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <label className="flex items-center justify-between p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 cursor-pointer">
                <div>
                  <p className="font-bold text-slate-800 dark:text-slate-200">New User Registrations</p>
                  <p className="text-[11px] text-slate-400">Alert admin when new accounts are registered</p>
                </div>
                <input
                  type="checkbox"
                  checked={alertNewUser}
                  onChange={(e) => setAlertNewUser(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 cursor-pointer">
                <div>
                  <p className="font-bold text-slate-800 dark:text-slate-200">PWA App Installations</p>
                  <p className="text-[11px] text-slate-400">Alert admin upon confirmed device installations</p>
                </div>
                <input
                  type="checkbox"
                  checked={alertAppInstall}
                  onChange={(e) => setAlertAppInstall(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 cursor-pointer">
                <div>
                  <p className="font-bold text-slate-800 dark:text-slate-200">Support & Feedback Tickets</p>
                  <p className="text-[11px] text-slate-400">Notify admin when users submit support inquiries</p>
                </div>
                <input
                  type="checkbox"
                  checked={alertSupportTicket}
                  onChange={(e) => setAlertSupportTicket(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 cursor-pointer">
                <div>
                  <p className="font-bold text-slate-800 dark:text-slate-200">Critical Security & Error Alerts</p>
                  <p className="text-[11px] text-slate-400">Immediate notice on repeated failed logins or incidents</p>
                </div>
                <input
                  type="checkbox"
                  checked={alertCriticalSecurity}
                  onChange={(e) => setAlertCriticalSecurity(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 cursor-pointer sm:col-span-2">
                <div>
                  <p className="font-bold text-slate-800 dark:text-slate-200">Push Delivery Failure Threshold Alerts</p>
                  <p className="text-[11px] text-slate-400">Alert admin when Web Push delivery failure rates spike</p>
                </div>
                <input
                  type="checkbox"
                  checked={alertPushFailure}
                  onChange={(e) => setAlertPushFailure(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded"
                />
              </label>
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
              Admin Delivery Channel
            </label>
            <select
              value={deliveryChannel}
              onChange={(e: any) => setDeliveryChannel(e.target.value)}
              className="w-full sm:w-80 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-medium"
            >
              <option value="push_and_inapp">Web Push + Admin Notification Center</option>
              <option value="push_only">Web Push Only</option>
              <option value="email_only">Email Alerts Only</option>
              <option value="inapp_only">Admin Notification Center Only</option>
            </select>
          </div>

          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/20 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Moon className="w-4 h-4 text-indigo-500" />
                <div>
                  <p className="font-bold text-slate-900 dark:text-slate-100">Quiet Hours</p>
                  <p className="text-[11px] text-slate-400">
                    Suppress non-critical audible push alerts during rest hours
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={quietHoursEnabled}
                onChange={(e) => setQuietHoursEnabled(e.target.checked)}
                className="w-4 h-4 text-indigo-600 rounded"
              />
            </div>

            {quietHoursEnabled && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-slate-700">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={quietHoursStart}
                    onChange={(e) => setQuietHoursStart(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">End Time</label>
                  <input
                    type="time"
                    value={quietHoursEnd}
                    onChange={(e) => setQuietHoursEnd(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isSavingPrefs}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 cursor-pointer disabled:opacity-50"
          >
            {isSavingPrefs ? 'Saving Preferences...' : 'Save Notification Preferences'}
          </button>
        </form>
      </div>

      {/* Maintenance Preview Modal */}
      {showMaintPreview && (
        <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
          <div className="p-3 bg-amber-500 text-slate-950 text-xs font-bold flex items-center justify-between">
            <span>PREVIEW MODE: This is what normal users will see when Maintenance Mode is ON.</span>
            <button
              onClick={() => setShowMaintPreview(false)}
              className="px-3 py-1 bg-slate-900 text-white rounded-lg text-xs cursor-pointer"
            >
              Close Preview
            </button>
          </div>
          <div className="flex-1">
            <MaintenanceScreen settings={maintForm} onRefresh={() => {}} />
          </div>
        </div>
      )}
    </div>
  );
};
