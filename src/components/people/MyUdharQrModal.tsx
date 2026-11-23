import React, { useState, useEffect, useRef } from 'react';
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
    if (isOpen) {
      setScannerActive(true);
    } else {
      setScannerActive(false);
    }
    return () => setScannerActive(false);
  }, [isOpen, setScannerActive]);

  const [qrInfo, setQrInfo] = useState<MyQrCodeResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [qrError, setQrError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isRegenerating, setIsRegenerating] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleRegenerateQr = async () => {
    try {
      setIsRegenerating(true);
      setQrError(null);
      const res = await udharDeletionApi.regenerateQrCode();
      if (res.success) {
        setQrInfo(res);
        const dataUrl = await QRCode.toDataURL(res.qrData, {
          width: 320,
          margin: 2,
          color: { dark: '#0f172a', light: '#ffffff' },
          errorCorrectionLevel: 'H',
        });
        setQrDataUrl(dataUrl);
        toast.success('Regenerated', 'Fresh QR code generated. Previous codes expired.');
      }
    } catch (err: any) {
      toast.error('Error', err.message || 'Could not regenerate QR code.');
    } finally {
      setIsRegenerating(false);
    }
  };

  const fetchQrCode = async () => {
    try {
      setIsLoading(true);
      setQrError(null);
      const res = await udharDeletionApi.getMyQrCode();
      if (res.success) {
        setQrInfo(res);
        // Generate QR code data URL using qrcode package
        const dataUrl = await QRCode.toDataURL(res.qrData, {
          width: 320,
          margin: 2,
          color: {
            dark: '#0f172a',
            light: '#ffffff',
          },
          errorCorrectionLevel: 'H',
        });
        setQrDataUrl(dataUrl);
      }
    } catch (err: any) {
      const msg = err.message || 'Unable to generate Udhar QR code. Please ensure you are logged in and connected.';
      setQrError(msg);
      toast.error('QR Error', msg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchQrCode();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyCode = () => {
    if (!qrInfo?.pairingCode) return;
    navigator.clipboard.writeText(qrInfo.pairingCode);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
    toast.success('Copied', `Pairing code ${qrInfo.pairingCode} copied.`);
  };

  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `my_money_qr_${qrInfo?.pairingCode || 'user'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Downloaded', 'Udhar QR image saved to downloads.');
  };

  const handleShareQr = async () => {
    if (!qrInfo) return;
    const shareText = `Connect with me on My Money Manager for 2-way Udhar tracking!\nMy Pairing Code: ${qrInfo.pairingCode}\nPairing Link: ${window.location.origin}/#pair=${qrInfo.pairingCode}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'My Udhar QR - My Money Manager',
          text: shareText,
          url: `${window.location.origin}/#pair=${qrInfo.pairingCode}`,
        });
        toast.success('Shared', 'Pairing details shared.');
      } catch (e) {
        // User cancelled share
      }
    } else {
      navigator.clipboard.writeText(shareText);
      toast.success('Copied to Clipboard', 'Share text copied to clipboard.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-sm sm:max-w-md w-full p-6 border border-slate-200/80 dark:border-slate-800 shadow-xl space-y-4 text-center relative overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5 text-left">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-500/20">
              <QrIcon className="w-4 h-4 stroke-[1.75]" />
            </div>
            <div>
              <h3 className="font-semibold text-sm sm:text-base text-slate-900 dark:text-slate-100">
                My Udhar QR
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">One-time user pairing code</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4 stroke-[1.75]" />
          </button>
        </div>

        {/* QR Display Card */}
        {isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center space-y-3">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-slate-500 font-medium">Generating official pairing QR...</p>
          </div>
        ) : qrError ? (
          <div className="py-10 px-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl text-center space-y-3 animate-fade-in">
            <p className="text-xs text-rose-700 dark:text-rose-300 font-medium">{qrError}</p>
            <button
              onClick={fetchQrCode}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors flex items-center gap-1.5 mx-auto cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Generation</span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* White QR Card Container */}
            <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-xs inline-block mx-auto max-w-[240px]">
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt="My Udhar QR Code"
                  className="w-48 h-48 sm:w-52 sm:h-52 object-contain rounded-lg mx-auto"
                />
              )}
            </div>

            {/* User Identity Banner */}
            <div className="flex items-center justify-center gap-2.5">
              {user?.avatar_url || user?.avatarUrl ? (
                <img
                  src={user?.avatar_url || user?.avatarUrl || ''}
                  alt={qrInfo?.publicName || user?.displayName || 'User'}
                  className="w-8 h-8 rounded-full object-cover border border-slate-200 dark:border-slate-700"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-emerald-600 text-white font-medium text-xs flex items-center justify-center">
                  {(qrInfo?.publicName || user?.displayName || 'U').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="text-left">
                <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100 leading-tight">
                  {qrInfo?.publicName || user?.displayName}
                </h4>
                <p className="text-[11px] text-slate-400">
                  Scan with My Money Manager to link
                </p>
              </div>
            </div>

            {/* Pairing Code Pill */}
            {qrInfo?.pairingCode && (
              <div className="flex items-center justify-center gap-2 py-2 px-3 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200/80 dark:border-slate-700/80 max-w-xs mx-auto text-xs">
                <span className="font-medium text-slate-500 dark:text-slate-400">
                  Pairing code:
                </span>
                <span className="font-mono font-semibold text-sm text-emerald-600 dark:text-emerald-400 tracking-wider">
                  {qrInfo.pairingCode}
                </span>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer ml-1"
                  title="Copy Pairing Code"
                >
                  {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 stroke-[1.75]" />}
                </button>
              </div>
            )}

            {/* Security Guarantee */}
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-medium px-2">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 stroke-[1.75] shrink-0" />
              <span>Contains secure pairing reference. No sensitive passwords embedded.</span>
            </div>

            {/* Action Buttons: Download, Share, Regenerate */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              <button
                type="button"
                onClick={handleDownloadQr}
                className="py-2 px-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium text-xs transition-colors flex items-center justify-center gap-1 cursor-pointer active:scale-[0.99]"
              >
                <Download className="w-3.5 h-3.5 stroke-[1.75]" />
                <span>Download</span>
              </button>

              <button
                type="button"
                onClick={handleShareQr}
                className="py-2 px-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs transition-colors flex items-center justify-center gap-1 cursor-pointer active:scale-[0.99]"
              >
                <Share2 className="w-3.5 h-3.5 stroke-[1.75]" />
                <span>Share</span>
              </button>

              <button
                type="button"
                onClick={handleRegenerateQr}
                disabled={isRegenerating}
                className="py-2 px-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium text-xs transition-colors flex items-center justify-center gap-1 cursor-pointer active:scale-[0.99]"
                title="Regenerate pairing QR code"
              >
                <RefreshCw className={`w-3.5 h-3.5 stroke-[1.75] ${isRegenerating ? 'animate-spin text-emerald-600' : ''}`} />
                <span>Reset</span>
              </button>
            </div>

            {onOpenScanner && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenScanner();
                }}
                className="w-full py-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-400 transition-colors flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.99]"
              >
                <Smartphone className="w-3.5 h-3.5 text-slate-500 stroke-[1.75]" />
                <span>Scan someone else's QR</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
