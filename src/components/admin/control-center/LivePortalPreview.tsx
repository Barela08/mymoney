import React, { useState } from 'react';
import {
  Monitor,
  Smartphone,
  Shield,
  Headset,
  User,
  Megaphone,
  Wrench,
  Sparkles,
  CheckCircle2,
  Bell,
  Download,
} from 'lucide-react';
import type { SiteControlCenterConfig } from '../../../types';
import { sanitizeHexColorClient, sanitizePublicUrl } from '../../../lib/siteConfigDefaults';

interface LivePortalPreviewProps {
  config: SiteControlCenterConfig;
  isDraftDirty?: boolean;
}

export const LivePortalPreview: React.FC<LivePortalPreviewProps> = ({ config, isDraftDirty }) => {
  const [targetPortal, setTargetPortal] = useState<'user' | 'myadmin' | 'mystaff'>('user');
  const [viewportMode, setViewportMode] = useState<'desktop' | 'mobile'>('desktop');
  const [showMaintenanceView, setShowMaintenanceView] = useState(false);

  const web = config.branding.website;
  const userBrand = config.branding.user_app;
  const adminBrand = config.branding.admin_app;
  const staffBrand = config.branding.staff_app;

  const activeIdentity =
    targetPortal === 'myadmin'
      ? adminBrand
      : targetPortal === 'mystaff'
      ? staffBrand
      : userBrand;

  const primaryColor = sanitizeHexColorClient(activeIdentity.primaryColor, '#10b981');
  const bgColor = sanitizeHexColorClient(
    activeIdentity.backgroundColor,
    targetPortal === 'user' ? '#f8fafc' : '#020617'
  );
  const isDarkPreview = targetPortal !== 'user' || showMaintenanceView;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 space-y-4 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-black text-slate-900 dark:text-white">
              Live Multi-Portal Preview
            </h4>
            {isDraftDirty ? (
              <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 text-[10px] font-bold">
                Previewing Unpublished Draft
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                Matches Live v{config.version}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Inspect branding, homepage, banners, login options, maintenance screen, and footer before publishing globally.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-[11px] font-bold">
            <button
              type="button"
              onClick={() => setTargetPortal('user')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg cursor-pointer ${
                targetPortal === 'user'
                  ? 'bg-white dark:bg-slate-900 text-emerald-600 shadow-xs'
                  : 'text-slate-500'
              }`}
            >
              <User className="w-3 h-3" />
              <span>User / Website</span>
            </button>
            <button
              type="button"
              onClick={() => setTargetPortal('myadmin')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg cursor-pointer ${
                targetPortal === 'myadmin'
                  ? 'bg-white dark:bg-slate-900 text-emerald-600 shadow-xs'
                  : 'text-slate-500'
              }`}
            >
              <Shield className="w-3 h-3" />
              <span>Admin (/myadmin)</span>
            </button>
            <button
              type="button"
              onClick={() => setTargetPortal('mystaff')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg cursor-pointer ${
                targetPortal === 'mystaff'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-xs'
                  : 'text-slate-500'
              }`}
            >
              <Headset className="w-3 h-3" />
              <span>Staff (/mystaff)</span>
            </button>
          </div>

          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setViewportMode('desktop')}
              title="Desktop preview"
              className={`p-1.5 rounded-lg cursor-pointer ${
                viewportMode === 'desktop'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewportMode('mobile')}
              title="Mobile preview"
              className={`p-1.5 rounded-lg cursor-pointer ${
                viewportMode === 'mobile'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
            </button>
          </div>

          {targetPortal === 'user' && (
            <button
              type="button"
              onClick={() => setShowMaintenanceView((v) => !v)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold border cursor-pointer ${
                showMaintenanceView
                  ? 'bg-amber-500 text-slate-950 border-amber-600'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              <Wrench className="w-3 h-3" />
              <span>{showMaintenanceView ? 'Maintenance View' : 'Simulate Maintenance'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Preview Frame */}
      <div className="bg-slate-100 dark:bg-slate-950 rounded-2xl p-3 sm:p-5 flex justify-center overflow-x-auto border border-slate-200/80 dark:border-slate-800">
        <div
          className={`w-full rounded-2xl border overflow-hidden shadow-lg transition-all ${
            viewportMode === 'mobile' ? 'max-w-[360px]' : 'max-w-4xl'
          } ${isDarkPreview ? 'border-slate-800 text-slate-100' : 'border-slate-200 text-slate-900'}`}
          style={{ backgroundColor: bgColor }}
        >
          {/* Simulated Browser Bar */}
          <div className="px-3 py-2 bg-slate-900 text-slate-300 flex items-center justify-between text-[10px] font-mono border-b border-slate-800">
            <span className="truncate">
              https://mymoney.nileshbarela.site
              {targetPortal === 'myadmin' ? '/myadmin' : targetPortal === 'mystaff' ? '/mystaff' : '/'}
            </span>
            <span className="text-emerald-400 font-bold shrink-0">
              {targetPortal === 'myadmin' ? adminBrand.shortName : targetPortal === 'mystaff' ? staffBrand.shortName : web.siteName}
            </span>
          </div>

          {/* Announcement Banner */}
          {config.announcement.enabled && (
            <div
              className="px-4 py-2 text-[11px] font-semibold flex items-center justify-between gap-2 text-white"
              style={{ backgroundColor: primaryColor }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Megaphone className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  <strong>{config.announcement.title}:</strong> {config.announcement.message}
                </span>
              </div>
              {config.announcement.ctaLabel && (
                <span className="px-2 py-0.5 rounded-md bg-white/20 text-[10px] font-bold shrink-0">
                  {config.announcement.ctaLabel}
                </span>
              )}
            </div>
          )}

          {showMaintenanceView || (targetPortal === 'user' && config.maintenance.isEnabled) ? (
            <div className="p-8 text-center space-y-3 bg-slate-950 text-white">
              <Wrench className="w-10 h-10 text-amber-400 mx-auto" />
              <p className="text-xs font-bold uppercase tracking-wider text-amber-300">
                Maintenance Mode Active
              </p>
              <h5 className="text-lg font-black">{config.maintenance.title}</h5>
              <p className="text-xs text-slate-400 max-w-md mx-auto">{config.maintenance.message}</p>
              {config.maintenance.expectedRestoration && (
                <p className="text-[11px] text-emerald-400 font-mono">
                  Expected Return: {config.maintenance.expectedRestoration}
                </p>
              )}
              <p className="text-[10px] text-slate-500 pt-2">
                {config.footer.supportEmail} · {config.footer.supportPhone}
              </p>
            </div>
          ) : (
            <div className="p-4 sm:p-5 space-y-4">
              {/* Portal Header */}
              <div
                className={`flex items-center justify-between gap-2 pb-3 border-b ${
                  isDarkPreview ? 'border-slate-800' : 'border-slate-200'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {config.header.showBrandLogo && (
                    <img
                      src={sanitizePublicUrl(activeIdentity.logoUrl, '/logo.jpg')}
                      alt={activeIdentity.appName}
                      className="w-8 h-8 rounded-xl object-cover border border-slate-300/30 shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    {config.header.showBrandName && (
                      <p className="text-xs font-black truncate">{activeIdentity.appName}</p>
                    )}
                    <p className="text-[10px] opacity-70 truncate">{activeIdentity.tagline}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {targetPortal === 'user' &&
                    config.header.navLinks
                      .filter((l) => l.visible)
                      .slice(0, viewportMode === 'mobile' ? 0 : 4)
                      .map((link) => (
                        <span key={link.id} className="text-[10px] font-semibold opacity-75">
                          {link.label}
                        </span>
                      ))}
                  {config.header.showNotificationBell && (
                    <Bell className="w-3.5 h-3.5 opacity-75" />
                  )}
                  {config.header.showInstallButton && (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold text-white"
                      style={{ backgroundColor: primaryColor }}
                    >
                      <Download className="w-2.5 h-2.5" />
                      Install
                    </span>
                  )}
                </div>
              </div>

              {/* Hero / Portal Card */}
              {targetPortal === 'user' &&
                config.featureVisibility.publicWelcomeHeroEnabled &&
                config.homepage.showHero && (
                  <div className="rounded-2xl p-4 bg-white/80 dark:bg-slate-900/80 border border-slate-200/80 space-y-2 text-slate-900">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
                      style={{ backgroundColor: primaryColor }}
                    >
                      <Sparkles className="w-2.5 h-2.5" />
                      {config.homepage.heroBadge}
                    </span>
                    <h5 className="text-base font-black leading-snug">
                      {config.homepage.heroHeading}
                    </h5>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      {config.homepage.heroSubheading}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <span
                        className="px-3 py-1 rounded-lg text-[10px] font-bold text-white"
                        style={{ backgroundColor: primaryColor }}
                      >
                        {config.homepage.primaryCtaText}
                      </span>
                      <span className="px-3 py-1 rounded-lg text-[10px] font-bold border border-slate-300 text-slate-700">
                        {config.homepage.secondaryCtaText}
                      </span>
                    </div>
                  </div>
                )}

              {/* Login Box Preview */}
              <div
                className={`rounded-2xl p-4 border space-y-2.5 ${
                  isDarkPreview
                    ? 'bg-slate-900/90 border-slate-800 text-white'
                    : 'bg-white border-slate-200 text-slate-900'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-black">{activeIdentity.loginTitle}</p>
                    <p className="text-[10px] opacity-70">{activeIdentity.loginSubtitle}</p>
                  </div>
                  <img
                    src={sanitizePublicUrl(
                      viewportMode === 'mobile'
                        ? activeIdentity.logoUrl
                        : activeIdentity.sidebarLogoUrl || activeIdentity.logoUrl,
                      activeIdentity.logoUrl
                    )}
                    alt="Portal Logo"
                    className="w-8 h-8 rounded-lg object-contain border border-slate-500/30"
                  />
                  <img
                    src={sanitizePublicUrl(activeIdentity.pwaIconUrl, activeIdentity.logoUrl)}
                    alt="PWA Icon"
                    className="w-8 h-8 rounded-lg object-contain border border-slate-500/30"
                  />
                  <img
                    src={sanitizePublicUrl(activeIdentity.notificationIconUrl, activeIdentity.pwaIconUrl || activeIdentity.logoUrl)}
                    alt="Notification Icon"
                    className="w-8 h-8 rounded-lg object-contain border border-slate-500/30"
                  />
                </div>

                {targetPortal === 'user' && (
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    <span
                      className={`px-2 py-0.5 rounded-md font-semibold ${
                        config.loginSettings.allowLogin
                          ? 'bg-emerald-500/15 text-emerald-600'
                          : 'bg-rose-500/15 text-rose-600'
                      }`}
                    >
                      Login: {config.loginSettings.allowLogin ? 'Open' : 'Paused'}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md font-semibold ${
                        config.loginSettings.allowRegistration
                          ? 'bg-emerald-500/15 text-emerald-600'
                          : 'bg-amber-500/15 text-amber-600'
                      }`}
                    >
                      Sign Up: {config.loginSettings.allowRegistration ? 'Enabled' : 'Disabled'}
                    </span>
                    {config.loginSettings.allowGoogleSignIn && (
                      <span className="px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-600 font-semibold">
                        Google Sign-In
                      </span>
                    )}
                    {config.loginSettings.allowPasskeySignIn && (
                      <span className="px-2 py-0.5 rounded-md bg-teal-500/15 text-teal-600 font-semibold">
                        Passkey
                      </span>
                    )}
                  </div>
                )}

                {targetPortal === 'user' && config.homepage.showFeatureSection && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                    {config.homepage.featureCards
                      .filter((f) => f.visible)
                      .slice(0, 3)
                      .map((card) => (
                        <div
                          key={card.id}
                          className="p-2 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-800"
                        >
                          <p className="text-[10px] font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                            <span className="truncate">{card.title}</span>
                          </p>
                          <p className="text-[9px] text-slate-500 line-clamp-2 mt-0.5">
                            {card.description}
                          </p>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Footer Preview */}
              <div
                className={`pt-3 border-t flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] opacity-75 ${
                  isDarkPreview ? 'border-slate-800' : 'border-slate-200'
                }`}
              >
                <span>{config.footer.copyrightText}</span>
                <span>
                  {config.footer.supportEmail} · {config.footer.supportPhone}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
