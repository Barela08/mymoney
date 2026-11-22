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
  Sparkles,
  Smartphone,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
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

  const [qrInfo, setQrInfo] = useState<MyQrCodeResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const fetchQrCode = async () => {
    try {
      setIsLoading(true);
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
      toast.error('QR Error', err.message || 'Unable to generate Udhar QR code.');
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
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-sm sm:max-w-md w-full p-6 sm:p-7 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5 text-center relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5 text-left">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-200 dark:border-emerald-800">
              <QrIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-slate-100">
                My Udhar QR Code
              </h3>
              <p className="text-[11px] text-slate-500">Secure One-Time User Pairing</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* QR Display Card */}
        {isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center space-y-3">
            <div className="w-9 h-9 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-slate-500 font-semibold">Generating secure QR code...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* White QR Card Container */}
            <div className="p-4 bg-white rounded-3xl border-2 border-slate-100 shadow-md inline-block mx-auto max-w-[260px]">
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt="My Udhar QR Code"
                  className="w-56 h-56 object-contain rounded-2xl mx-auto"
                />
              )}
            </div>

            {/* User Identity Banner */}
            <div className="flex items-center justify-center gap-2.5">
              {user?.avatar_url || user?.avatarUrl ? (
                <img
                  src={user?.avatar_url || user?.avatarUrl || ''}
                  alt={qrInfo?.publicName || user?.displayName || 'User'}
                  className="w-8 h-8 rounded-full object-cover border-2 border-emerald-500/40 shadow-sm"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-emerald-600 text-white font-bold text-xs flex items-center justify-center">
                  {(qrInfo?.publicName || user?.displayName || 'U').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="text-left">
                <h4 className="font-extrabold text-sm text-slate-900 dark:text-slate-100 leading-tight">
                  {qrInfo?.publicName || user?.displayName}
                </h4>
                <p className="text-[11px] text-slate-400">
                  Scan with My Money Manager to link
                </p>
              </div>
            </div>

            {/* Pairing Code Pill */}
            {qrInfo?.pairingCode && (
              <div className="flex items-center justify-center gap-2 p-2.5 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 max-w-xs mx-auto">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                  Pairing Code:
                </span>
                <span className="font-mono font-black text-sm text-emerald-600 dark:text-emerald-400 tracking-wider">
                  {qrInfo.pairingCode}
                </span>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer ml-1"
                  title="Copy Pairing Code"
                >
                  {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            )}

            {/* Security Guarantee */}
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500 font-medium">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>Contains secure pairing reference. No sensitive passwords or financial records embedded.</span>
            </div>

            {/* Action Buttons: Download, Share, Scan */}
            <div className="grid grid-cols-2 gap-2.5 pt-2">
              <button
                type="button"
                onClick={handleDownloadQr}
                className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download QR</span>
              </button>

              <button
                type="button"
                onClick={handleShareQr}
                className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Share QR</span>
              </button>
            </div>

            {onOpenScanner && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenScanner();
                }}
                className="w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Smartphone className="w-3.5 h-3.5 text-blue-500" />
                <span>Switch to Scan Someone Else's QR &rarr;</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
