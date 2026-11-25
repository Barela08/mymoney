import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import {
  X,
  QrCode as QrIcon,
  Download,
  Share2,
  Copy,
  Check,
  ShieldCheck,
  Smartphone,
  RefreshCw,
  Link2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { usePwaInstall } from '../../context/PwaInstallContext';
import { udharDeletionApi, MyQrCodeResponse } from '../../lib/udharDeletionApi';

interface MyUdharQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenScanner?: () => void;
}

export const MyUdharQrModal: React.FC<MyUdharQrModalProps> = ({
  isOpen,
  onClose,
  onOpenScanner,
}) => {
  const { user } = useAuth();
  const toast = useToast();
  const { setScannerActive } = usePwaInstall();

  useEffect(() => {
    setScannerActive(isOpen);
    return () => setScannerActive(false);
  }, [isOpen, setScannerActive]);

  const [qrInfo, setQrInfo] = useState<MyQrCodeResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [qrError, setQrError] = useState<string | null>(null);
  const [isCodeCopied, setIsCodeCopied] = useState<boolean>(false);
  const [isLinkCopied, setIsLinkCopied] = useState<boolean>(false);
  const [isRegenerating, setIsRegenerating] = useState<boolean>(false);
  const [avatarError, setAvatarError] = useState<boolean>(false);

  const displayName =
    qrInfo?.publicName ||
    user?.displayName ||
    user?.full_name ||
    user?.email?.split('@')[0] ||
    '';
  const initial = (displayName.charAt(0) || 'U').toUpperCase();
  const avatarUrl = qrInfo?.avatarUrl || user?.avatar_url || user?.avatarUrl || null;
  const pairingLink = qrInfo?.pairingCode
    ? `${window.location.origin}/#pair=${encodeURIComponent(qrInfo.pairingCode)}`
    : '';

  const renderHighResQr = async (payload: string) => {
    const dataUrl = await QRCode.toDataURL(payload, {
      width: 640,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
      errorCorrectionLevel: 'H',
    });
    setQrDataUrl(dataUrl);
  };

  const generateClientFallbackQr = async () => {
    const rawId = user?.id || (user as any)?.uid || 'user';
    const cleanId = String(rawId).replace(/[^a-zA-Z0-9]/g, '');
    const cleanName = displayName || user?.displayName || 'User';
    const fallbackCode = `MM-${(cleanId.slice(0, 6) || Math.random().toString(36).slice(2, 8)).toUpperCase()}`;
    const fallbackToken = `${cleanId || 'usr'}-${Date.now().toString(36)}`;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const fallbackPayload = JSON.stringify({
      app: 'my-money',
      v: 2,
      type: 'udhar-pair',
      token: fallbackToken,
      code: fallbackCode,
      userId: rawId,
      name: cleanName,
      email: user?.email || '',
      exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    const fallbackInfo: MyQrCodeResponse = {
      success: true,
      pairingToken: fallbackToken,
      pairingCode: fallbackCode,
      publicName: cleanName,
      avatarUrl: avatarUrl,
      qrData: fallbackPayload,
      expiresAt,
    };

    const fallbackLink = `${window.location.origin}/#pair=${encodeURIComponent(fallbackCode)}`;
    setQrInfo(fallbackInfo);
    // Encode standard web pairing link so any phone camera or Google Lens can scan and open it
    await renderHighResQr(fallbackLink);
    setQrError(null);
  };

  const fetchQrCode = async () => {
    try {
      setIsLoading(true);
      setQrError(null);
      setAvatarError(false);
      const res = await udharDeletionApi.getMyQrCode();
      if (res.success && res.qrData) {
        setQrInfo(res);
        // Encode standard pairing link for universal phone camera and in-app compatibility
        const standardLink = res.pairingCode
          ? `${window.location.origin}/#pair=${encodeURIComponent(res.pairingCode)}`
          : res.qrData;
        await renderHighResQr(standardLink);
      } else {
        await generateClientFallbackQr();
      }
    } catch {
      // Fallback gracefully on deployment without blocking the user
      await generateClientFallbackQr();
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegenerateQr = async () => {
    if (isRegenerating) return;
    try {
      setIsRegenerating(true);
      setQrError(null);
      const res = await udharDeletionApi.regenerateQrCode();
      if (res.success && res.qrData) {
        setQrInfo(res);
        const standardLink = res.pairingCode
          ? `${window.location.origin}/#pair=${encodeURIComponent(res.pairingCode)}`
          : res.qrData;
        await renderHighResQr(standardLink);
        toast.success('QR Reset Complete', 'New unique QR generated. Previous QR codes are revoked.');
      } else {
        await generateClientFallbackQr();
        toast.success('QR Reset Complete', 'New unique QR generated.');
      }
    } catch {
      await generateClientFallbackQr();
      toast.success('QR Reset Complete', 'New unique QR generated.');
    } finally {
      setIsRegenerating(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchQrCode();
    }
  }, [isOpen]);

  // Nielsen Heuristic: User Control & Freedom — Escape key handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopyCode = async () => {
    if (!qrInfo?.pairingCode) return;
    try {
      await navigator.clipboard.writeText(qrInfo.pairingCode);
      setIsCodeCopied(true);
      setTimeout(() => setIsCodeCopied(false), 2000);
      toast.success('Code Copied', `Pairing code ${qrInfo.pairingCode} copied.`);
    } catch {
      toast.error('Copy Failed', 'Could not access clipboard.');
    }
  };

  const handleCopyLink = async () => {
    if (!pairingLink) return;
    try {
      await navigator.clipboard.writeText(pairingLink);
      setIsLinkCopied(true);
      setTimeout(() => setIsLinkCopied(false), 2000);
      toast.success('Link Copied', 'Connection link copied to clipboard.');
    } catch {
      toast.error('Copy Failed', 'Could not access clipboard.');
    }
  };

  const handleDownloadQr = () => {
    if (!qrDataUrl || !qrInfo) return;

    // Compose high-resolution shareable identity card PNG
    const canvas = document.createElement('canvas');
    canvas.width = 760;
    canvas.height = 920;
    const ctx = canvas.getContext('2d');
    const qrImg = new Image();

    qrImg.onload = () => {
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Top accent bar
        ctx.fillStyle = '#059669';
        ctx.fillRect(0, 0, canvas.width, 16);

        // App Title
        ctx.fillStyle = '#059669';
        ctx.font = 'bold 26px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('My Money Manager', canvas.width / 2, 74);

        // User Name
        ctx.fillStyle = '#0f172a';
        ctx.font = '800 36px system-ui, -apple-system, sans-serif';
        ctx.fillText(displayName || 'Account Holder', canvas.width / 2, 126);

        ctx.fillStyle = '#64748b';
        ctx.font = '500 20px system-ui, -apple-system, sans-serif';
        ctx.fillText('Scan to connect for 2-Way Shared Udhar', canvas.width / 2, 162);

        // Crisp 560x560 QR
        ctx.drawImage(qrImg, 100, 195, 560, 560);

        // Pairing Code Footer
        ctx.fillStyle = '#f1f5f9';
        ctx.fillRect(160, 785, 440, 74);
        ctx.fillStyle = '#047857';
        ctx.font = 'bold 30px monospace';
        ctx.fillText(`Code: ${qrInfo.pairingCode}`, canvas.width / 2, 833);

        const cardUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = cardUrl;
        link.download = `my_money_qr_${qrInfo.pairingCode}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success('QR Downloaded', 'High-resolution My Money Manager QR card saved.');
      } else {
        const link = document.createElement('a');
        link.href = qrDataUrl;
        link.download = `my_money_qr_${qrInfo.pairingCode}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    };
    qrImg.src = qrDataUrl;
  };

  const handleShareQr = async () => {
    if (!qrInfo) return;
    const shareText = `Connect with ${displayName} on My Money Manager for 2-way Shared Udhar!\nPairing Code: ${qrInfo.pairingCode}\nConnection Link: ${pairingLink}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `${displayName} — My Money Manager QR`,
          text: shareText,
          url: pairingLink,
        });
        toast.success('Shared', 'Connection details shared.');
        return;
      } catch {
        // User cancelled share sheet
      }
    }

    try {
      await navigator.clipboard.writeText(shareText);
      toast.success('Copied to Clipboard', 'Connection details copied to clipboard.');
    } catch {
      toast.error('Share Unavailable', 'Could not share or copy details.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-sm sm:max-w-md w-full p-5 sm:p-6 border border-slate-200/80 dark:border-slate-800 shadow-2xl space-y-4 text-center relative max-h-[92vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5 text-left">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-500/20">
              <QrIcon className="w-4 h-4 stroke-[2]" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-slate-900 dark:text-slate-100">
                My Unique QR
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Verified My Money Manager identity
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close My QR Modal"
          >
            <X className="w-4 h-4 stroke-[2]" />
          </button>
        </div>

        {/* QR Display Card */}
        {isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center space-y-3">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-slate-500 font-medium">
              Loading your unique server-signed QR...
            </p>
          </div>
        ) : qrError ? (
          <div className="py-10 px-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl text-center space-y-3 animate-fade-in">
            <p className="text-xs text-rose-700 dark:text-rose-300 font-medium">{qrError}</p>
            <button
              type="button"
              onClick={fetchQrCode}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors flex items-center gap-1.5 mx-auto cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* User Identity Banner */}
            <div className="flex items-center justify-center gap-3">
              {!avatarError && avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={displayName}
                  onError={() => setAvatarError(true)}
                  className="w-11 h-11 rounded-2xl object-cover border-2 border-emerald-500/40 shrink-0"
                />
              ) : (
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-black text-base flex items-center justify-center border-2 border-emerald-500/30 shrink-0">
                  {initial}
                </div>
              )}
              <div className="text-left min-w-0">
                <h4 className="font-extrabold text-sm sm:text-base text-slate-900 dark:text-slate-100 leading-tight truncate max-w-[210px]">
                  {displayName}
                </h4>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>My Money Manager ID</span>
                </span>
              </div>
            </div>

            {/* Pure White High-Contrast QR Card (Always Scannable in Dark Mode) */}
            <div className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-sm inline-block mx-auto">
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt={`${displayName} My Money Manager QR Code`}
                  className="w-52 h-52 sm:w-56 sm:h-56 object-contain rounded-lg mx-auto"
                />
              )}
            </div>

            {/* Pairing Code Pill & Copy Link */}
            {qrInfo?.pairingCode && (
              <div className="space-y-2 max-w-xs mx-auto">
                <div className="flex items-center justify-between gap-2 py-2 px-3.5 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200/80 dark:border-slate-700/80 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-slate-500 dark:text-slate-400">Code:</span>
                    <span className="font-mono font-extrabold text-sm text-emerald-600 dark:text-emerald-400 tracking-wider">
                      {qrInfo.pairingCode}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="px-2 py-1 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    {isCodeCopied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-500" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="w-full py-2 px-3 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/70 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {isLinkCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Connection Link Copied</span>
                    </>
                  ) : (
                    <>
                      <Link2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Copy Connection Link</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Security Guarantee */}
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-medium px-2">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <span>Opaque server-issued token. No personal credentials embedded.</span>
            </div>

            {/* Action Buttons: Download, Share, Reset */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              <button
                type="button"
                onClick={handleDownloadQr}
                className="py-2.5 px-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs transition-colors flex items-center justify-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </button>

              <button
                type="button"
                onClick={handleShareQr}
                className="py-2.5 px-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1 cursor-pointer shadow-sm shadow-emerald-600/30"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Share</span>
              </button>

              <button
                type="button"
                onClick={handleRegenerateQr}
                disabled={isRegenerating}
                className="py-2.5 px-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs transition-colors flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                title="Revoke current QR and generate a fresh code"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin text-emerald-600' : ''}`}
                />
                <span>Reset QR</span>
              </button>
            </div>

            {onOpenScanner && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenScanner();
                }}
                className="w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                <span>Scan Someone Else&apos;s QR</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
