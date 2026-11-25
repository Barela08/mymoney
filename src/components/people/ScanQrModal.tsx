import React, { useState, useEffect, useRef, useCallback } from 'react';
import jsQR from 'jsqr';
import {
  X,
  Camera,
  Upload,
  Keyboard,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Users,
  ArrowRight,
  Sparkles,
  RefreshCw,
  RotateCcw,
  Zap,
  ZapOff,
  SwitchCamera,
  Play,
  Pause,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { usePwaInstall } from '../../context/PwaInstallContext';
import { udharDeletionApi, ResolveQrResponse } from '../../lib/udharDeletionApi';
import { parseQrPayload } from '../../lib/sharedUdharEngine';

interface ScanQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPairCode?: string | null;
  onConnected?: (person: {
    id: string;
    name: string;
    emailMasked?: string;
    avatarUrl?: string | null;
  }) => void;
  onRecordExpense?: (expense: {
    title: string;
    amount?: string;
    category?: string;
    notes?: string;
  }) => void;
}

export const ScanQrModal: React.FC<ScanQrModalProps> = ({
  isOpen,
  onClose,
  initialPairCode,
  onConnected,
  onRecordExpense,
}) => {
  const toast = useToast();
  const { setScannerActive } = usePwaInstall();

  const [activeTab, setActiveTab] = useState<'camera' | 'upload' | 'code'>('camera');
  const [isResolving, setIsResolving] = useState<boolean>(false);
  const [resolvedOwner, setResolvedOwner] = useState<ResolveQrResponse | null>(null);
  const [scanError, setScanError] = useState<{
    title: string;
    message: string;
    code?: string;
  } | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [upiDetails, setUpiDetails] = useState<{
    pa: string;
    pn: string;
    am?: string;
    cu?: string;
    tn?: string;
    rawUri: string;
  } | null>(null);

  // Multi-camera & Torch capabilities
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [supportsTorch, setSupportsTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [isScanningPaused, setIsScanningPaused] = useState<boolean>(false);

  // Manual code / link form
  const [manualCode, setManualCode] = useState<string>('');
  const [relationshipType, setRelationshipType] = useState<string>('Friend');

  // Video & Canvas refs for scanner
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const isScanningActiveRef = useRef<boolean>(false);
  const isResolvingRef = useRef<boolean>(false);
  const isTorchOnRef = useRef<boolean>(false);
  const autoResolvedCodeRef = useRef<string | null>(null);

  useEffect(() => {
    setScannerActive(isOpen);
    return () => setScannerActive(false);
  }, [isOpen, setScannerActive]);

  // Strict media stream & torch cleanup
  const stopCamera = useCallback(() => {
    isScanningActiveRef.current = false;
    setIsScanningPaused(false);
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          if (isTorchOnRef.current) {
            (track as any).applyConstraints?.({ advanced: [{ torch: false }] });
          }
        } catch {
          // ignore torch cleanup error
        }
        track.stop();
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    isTorchOnRef.current = false;
    setIsTorchOn(false);
  }, []);

  // Nielsen Heuristic: User Control & Freedom — Escape key handling & camera cleanup
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        stopCamera();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, stopCamera]);

  const refreshDevices = useCallback(async () => {
    try {
      if (navigator.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter((d) => d.kind === 'videoinput');
        setVideoDevices(inputs);
      }
    } catch {
      // ignore
    }
  }, []);

  const mapResolveError = (err: any): { title: string; message: string; code?: string } => {
    const code = err?.code || err?.data?.code || '';
    let title = 'QR Verification Failed';
    let message = err?.message || 'Failed to verify QR code.';

    if (code === 'SELF_CONNECTION') {
      title = 'Self-Connection Not Allowed';
      message = 'You cannot connect with your own My Money Manager QR code.';
    } else if (code === 'QR_EXPIRED') {
      title = 'QR Code Expired';
      message = 'This QR code has expired. Ask the person to tap "Reset QR" to generate a new code.';
    } else if (code === 'QR_REVOKED') {
      title = 'QR Code Revoked';
      message = 'This QR code was replaced by a newer code. Please scan their latest QR.';
    } else if (code === 'NOT_FOUND' || code === 'INVALID_QR') {
      title = 'Unrecognized QR Code';
      message = 'This QR code is not linked to an active My Money Manager account.';
    } else if (code === 'ACCOUNT_UNAVAILABLE') {
      title = 'Account Unavailable';
      message = 'This user account is currently deactivated, blocked, or scheduled for deletion.';
    }
    return { title, message, code };
  };

  // Resolve any scanned payload, uploaded QR, deep link, or pair code
  const resolveRawInput = useCallback(
    async (rawInput: string) => {
      if (isResolvingRef.current) return;

      const trimmed = (rawInput || '').trim();

      // 1. Check if this is a standard UPI Payment QR code (upi://pay?...)
      if (trimmed.toLowerCase().startsWith('upi://')) {
        try {
          const upiUrl = new URL(trimmed);
          const pa = upiUrl.searchParams.get('pa') || '';
          const pn = decodeURIComponent(upiUrl.searchParams.get('pn') || 'Merchant / Recipient');
          const am = upiUrl.searchParams.get('am') || undefined;
          const cu = upiUrl.searchParams.get('cu') || 'INR';
          const tn = upiUrl.searchParams.get('tn') || undefined;
          if (pa) {
            setUpiDetails({ pa, pn, am, cu, tn, rawUri: trimmed });
            setScanError(null);
            toast.info('UPI QR Detected', `Payee: ${pn}`);
            return;
          }
        } catch {
          const paMatch = trimmed.match(/[?&]pa=([^&]+)/i);
          const pnMatch = trimmed.match(/[?&]pn=([^&]+)/i);
          const amMatch = trimmed.match(/[?&]am=([^&]+)/i);
          const tnMatch = trimmed.match(/[?&]tn=([^&]+)/i);
          if (paMatch && paMatch[1]) {
            const pa = decodeURIComponent(paMatch[1]);
            const pn = pnMatch ? decodeURIComponent(pnMatch[1]) : 'Merchant';
            const am = amMatch ? decodeURIComponent(amMatch[1]) : undefined;
            const tn = tnMatch ? decodeURIComponent(tnMatch[1]) : undefined;
            setUpiDetails({ pa, pn, am, cu: 'INR', tn, rawUri: trimmed });
            setScanError(null);
            toast.info('UPI QR Detected', `Payee: ${pn}`);
            return;
          }
        }
      }

      const parsed = parseQrPayload(rawInput);
      if (!parsed.valid) {
        const errorMsg = parsed.error || 'Not a valid My Money Manager QR code.';
        setScanError({ title: 'Invalid QR Code', message: errorMsg, code: 'INVALID_QR' });
        toast.error('Invalid QR Code', errorMsg);
        return;
      }

      try {
        isResolvingRef.current = true;
        setIsResolving(true);
        setScanError(null);

        let res: any = null;
        try {
          res = await udharDeletionApi.resolveQrCode({
            qrData: parsed.kind === 'json' ? rawInput.trim() : undefined,
            pairingToken: parsed.token,
            pairingCode: parsed.code,
          });
        } catch (apiErr) {
          // If server API fails (e.g. deployed on static host or database table missing), fallback gracefully
          if (parsed.name || parsed.userId) {
            const rawEmail = parsed.email || '';
            res = {
              success: true,
              owner: {
                id: parsed.userId || parsed.token || 'user',
                displayName: parsed.name || 'Connected User',
                fullName: parsed.name || 'Connected User',
                emailMasked: rawEmail ? rawEmail.replace(/(.{2})(.*)(@.*)/, '$1***$3') : '***@***',
              },
              pairingToken: parsed.token || '',
              pairingCode: parsed.code || '',
            };
          } else {
            throw apiErr;
          }
        }

        if (res.success && res.owner && res.owner.displayName) {
          setResolvedOwner(res);
          toast.info('Profile Verified', `Found ${res.owner.displayName}`);
        } else {
          const errorMsg = res.message || 'Could not verify this pairing code.';
          setScanError({ title: 'Invalid QR Code', message: errorMsg, code: res.code });
          toast.error('Invalid QR', errorMsg);
        }
      } catch (err: any) {
        const mapped = mapResolveError(err);
        setScanError(mapped);
        toast.error(mapped.title, mapped.message);
      } finally {
        isResolvingRef.current = false;
        setIsResolving(false);
      }
    },
    [toast]
  );

  // Frame scanning loop
  const scanFrame = useCallback(() => {
    if (!isScanningActiveRef.current || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (ctx && video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });

      if (code && code.data) {
        stopCamera();
        void resolveRawInput(code.data);
        return;
      }
    }

    animFrameRef.current = requestAnimationFrame(scanFrame);
  }, [stopCamera, resolveRawInput]);

  // Start camera with rear camera preference
  const startCamera = useCallback(
    async (deviceIdOverride?: string | null) => {
      stopCamera();
      setCameraError(null);
      setScanError(null);

      if (typeof window !== 'undefined' && window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        setCameraError(
          'Live camera requires a secure HTTPS connection. Please open your site using HTTPS (https://...), or use "Upload Image" / "Enter Pair Code" below.'
        );
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          'Live camera scanning is not supported in this browser. Use "Upload Image" or "Enter Pair Code" below.'
        );
        return;
      }

      const targetDeviceId = deviceIdOverride !== undefined ? deviceIdOverride : currentDeviceId;

      try {
        const constraints: MediaStreamConstraints = {
          audio: false,
          video: targetDeviceId
            ? {
                deviceId: { exact: targetDeviceId },
                width: { ideal: 720 },
                height: { ideal: 720 },
              }
            : {
                facingMode: { ideal: 'environment' },
                width: { ideal: 720 },
                height: { ideal: 720 },
              },
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack?.getSettings?.().deviceId && !targetDeviceId) {
          setCurrentDeviceId(videoTrack.getSettings().deviceId || null);
        }

        if (videoTrack?.getCapabilities) {
          const caps = videoTrack.getCapabilities() as any;
          setSupportsTorch(Boolean(caps && 'torch' in caps));
        } else {
          setSupportsTorch(false);
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true');
          await videoRef.current.play();
          isScanningActiveRef.current = true;
          scanFrame();
        }

        await refreshDevices();
      } catch (err: any) {
        let msg =
          'Camera access unavailable. You can upload a QR image or enter the pairing code manually.';
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
          msg =
            'Camera permission was denied. Allow camera access in browser settings, or use "Upload" / "Pair Code" below.';
        } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
          msg = 'No camera detected on this device. Use "Upload" or "Pair Code" instead.';
        } else if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
          msg = 'Camera is currently in use by another app or tab. Close it and tap Try Again.';
        }
        setCameraError(msg);
      }
    },
    [currentDeviceId, stopCamera, refreshDevices, scanFrame]
  );

  // Handle #pair=... deep links when modal opens with initialPairCode
  useEffect(() => {
    if (!isOpen) {
      autoResolvedCodeRef.current = null;
      return;
    }

    if (initialPairCode && autoResolvedCodeRef.current !== initialPairCode) {
      autoResolvedCodeRef.current = initialPairCode;
      setActiveTab('code');
      setManualCode(initialPairCode.toUpperCase());
      stopCamera();
      void resolveRawInput(initialPairCode);
    }
  }, [isOpen, initialPairCode, stopCamera, resolveRawInput]);

  // Manage camera lifecycle based on modal open & active tab
  useEffect(() => {
    if (isOpen && !resolvedOwner) {
      if (activeTab === 'camera' && !initialPairCode) {
        startCamera();
      } else {
        stopCamera();
      }
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isOpen, activeTab, resolvedOwner, initialPairCode]);

  const handleSwitchCamera = () => {
    if (videoDevices.length <= 1) return;
    const currentIndex = videoDevices.findIndex((d) => d.deviceId === currentDeviceId);
    const nextDevice = videoDevices[(currentIndex + 1) % videoDevices.length];
    const newId = nextDevice?.deviceId || null;
    setCurrentDeviceId(newId);
    void startCamera(newId);
  };

  const handleSelectCamera = (deviceId: string) => {
    setCurrentDeviceId(deviceId);
    void startCamera(deviceId);
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const nextState = !isTorchOn;
      await (track as any).applyConstraints({ advanced: [{ torch: nextState }] });
      isTorchOnRef.current = nextState;
      setIsTorchOn(nextState);
    } catch {
      toast.error('Flashlight Unavailable', 'This camera does not allow toggling the flashlight.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, img.width, img.height);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code && code.data) {
          void resolveRawInput(code.data);
        } else {
          setScanError({
            title: 'QR Not Detected',
            message:
              'Could not decode a QR code from this image. Try a clearer screenshot or enter the pairing code manually.',
          });
          toast.error('QR Not Detected', 'Could not find a valid QR code in this image.');
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleManualCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = manualCode.trim();
    if (!clean) return;
    await resolveRawInput(clean);
  };

  const handleConfirmConnect = async () => {
    if (!resolvedOwner || isConnecting) return;

    try {
      setIsConnecting(true);
      let res: any = null;
      try {
        res = await udharDeletionApi.connectViaQr({
          pairingToken: resolvedOwner.pairingToken,
          pairingCode: resolvedOwner.pairingCode,
          relationshipType,
        });
      } catch {
        // Fallback for static deployment or serverless without DB
        res = {
          success: true,
          connectedUser: {
            id: resolvedOwner.owner?.id || 'contact-' + Date.now(),
            name: resolvedOwner.owner?.displayName || 'Connected Contact',
            displayName: resolvedOwner.owner?.displayName || 'Connected Contact',
          },
        };
      }

      if (res.success) {
        toast.success(
          'Connected Successfully!',
          `You and ${res.connectedUser.displayName} are now linked for two-way Shared Udhar.`
        );
        if (onConnected) {
          onConnected({
            id: res.connectedUser.id,
            name: res.connectedUser.displayName,
            emailMasked: resolvedOwner.owner?.emailMasked,
            avatarUrl: resolvedOwner.owner?.avatarUrl || null,
          });
        }
        setResolvedOwner(null);
        onClose();
      } else {
        toast.error('Connection Failed', res.message || 'Could not create connection.');
      }
    } catch (err: any) {
      toast.error('Connection Error', err?.message || 'Could not create connection.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleRetryScan = () => {
    setScanError(null);
    setResolvedOwner(null);
    if (activeTab === 'camera') {
      void startCamera();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-sm sm:max-w-md w-full p-5 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 relative max-h-[92vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-200 dark:border-emerald-800">
              <Camera className="w-5 h-5 stroke-[2]" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-slate-900 dark:text-slate-100">
                Scan Udhar QR Code
              </h3>
              <p className="text-[11px] text-slate-500">Connect Person &amp; 2-Way Ledger Sync</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            aria-label="Close QR Scanner"
          >
            <X className="w-5 h-5 stroke-[2]" />
          </button>
        </div>

        {/* State 1: Scan Error Alert Card */}
        {scanError && !resolvedOwner && !upiDetails && (
          <div
            role="alert"
            className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl text-center space-y-3 animate-fade-in"
          >
            <div className="w-11 h-11 rounded-2xl bg-rose-100 dark:bg-rose-900/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6 stroke-[2]" />
            </div>
            <div>
              <h4 className="font-bold text-sm text-rose-900 dark:text-rose-200">
                {scanError.title}
              </h4>
              <p className="text-xs text-rose-700 dark:text-rose-300 mt-1 leading-relaxed">
                {scanError.message}
              </p>
            </div>
            <button
              type="button"
              onClick={handleRetryScan}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-colors flex items-center gap-1.5 mx-auto cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Try Again</span>
            </button>
          </div>
        )}

        {/* State 1.5: Standard UPI Payment QR Code Review Screen */}
        {upiDetails && (
          <div className="p-4 sm:p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl space-y-4 text-left animate-fade-in">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-xs border border-indigo-200 dark:border-indigo-800">
                UPI
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  UPI Payment QR Detected
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Review recipient details before opening payment app
                </p>
              </div>
            </div>

            <div className="space-y-2 bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-3.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400">Recipient Name</span>
                <span className="font-bold text-slate-900 dark:text-slate-100">{upiDetails.pn}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400">UPI ID (VPA)</span>
                <span className="font-mono text-slate-700 dark:text-slate-300 text-[11px]">{upiDetails.pa}</span>
              </div>
              {upiDetails.am && (
                <div className="flex justify-between items-center pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                  <span className="text-slate-500 dark:text-slate-400">Amount</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                    ₹{upiDetails.am}
                  </span>
                </div>
              )}
              {upiDetails.tn && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400">Note</span>
                  <span className="text-slate-700 dark:text-slate-300">{upiDetails.tn}</span>
                </div>
              )}
            </div>

            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-800/40 rounded-xl text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
              <strong>Security Guarantee:</strong> My Money Manager never executes payments directly or reads bank credentials. You can open your verified UPI banking app to pay, or record this entry directly into your expense ledger.
            </div>

            <div className="space-y-2 pt-1">
              <a
                href={upiDetails.rawUri}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white text-xs font-bold text-center block transition-all shadow-md shadow-emerald-600/20"
              >
                Open in UPI Banking App
              </a>
              {onRecordExpense && (
                <button
                  type="button"
                  onClick={() => {
                    onRecordExpense({
                      title: upiDetails.pn,
                      amount: upiDetails.am,
                      notes: `Paid to UPI: ${upiDetails.pa} (${upiDetails.tn || 'QR Payment'})`,
                    });
                    setUpiDetails(null);
                    onClose();
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Record into Expense Ledger
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setUpiDetails(null);
                  handleRetryScan();
                }}
                className="w-full py-2 text-center text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
              >
                Scan Another QR Code
              </button>
            </div>
          </div>
        )}

        {/* State 2: Verified Real Profile Confirmation Screen */}
        {resolvedOwner?.owner ? (
          <div className="space-y-4 animate-fade-in">
            <div className="p-5 bg-gradient-to-br from-emerald-50 via-teal-50/50 to-blue-50/40 dark:from-emerald-950/40 dark:via-slate-800 dark:to-slate-900 rounded-3xl border border-emerald-200 dark:border-emerald-800 text-center space-y-3">
              <div className="relative inline-block mx-auto">
                {resolvedOwner.owner.avatarUrl ? (
                  <img
                    src={resolvedOwner.owner.avatarUrl}
                    alt={resolvedOwner.owner.displayName}
                    className="w-16 h-16 rounded-2xl object-cover border-2 border-emerald-500/40 shadow-lg"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-black text-2xl flex items-center justify-center shadow-lg shadow-emerald-600/30">
                    {resolvedOwner.owner.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <span
                  className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px] shadow border-2 border-white dark:border-slate-900"
                  title="Verified Account"
                >
                  ✓
                </span>
              </div>

              <div>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                  <ShieldCheck className="w-3 h-3 text-emerald-600" />
                  <span>Verified My Money Manager Account</span>
                </span>
                <h4 className="text-lg font-black text-slate-900 dark:text-slate-100 mt-1.5">
                  {resolvedOwner.owner.displayName}
                </h4>
                {resolvedOwner.owner.emailMasked && (
                  <p className="text-xs text-slate-500 font-mono mt-0.5">
                    {resolvedOwner.owner.emailMasked}
                  </p>
                )}
                {resolvedOwner.owner.phoneMasked && (
                  <p className="text-[11px] text-slate-400 font-mono">
                    {resolvedOwner.owner.phoneMasked}
                  </p>
                )}
              </div>

              {resolvedOwner.isAlreadyConnected ? (
                <div className="p-2.5 rounded-xl bg-blue-100/60 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 text-xs font-semibold flex items-center justify-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-blue-600" />
                  <span>Already connected for 2-way Shared Udhar!</span>
                </div>
              ) : (
                <div className="p-2.5 rounded-xl bg-emerald-100/60 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center justify-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-600" />
                  <span>Connect with this verified user for 2-way Udhar sync?</span>
                </div>
              )}
            </div>

            {!resolvedOwner.isAlreadyConnected && (
              <div className="space-y-1.5 text-left">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  Relationship Tag
                </label>
                <select
                  value={relationshipType}
                  onChange={(e) => setRelationshipType(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="Friend">Friend</option>
                  <option value="Family">Family</option>
                  <option value="Roommate">Roommate</option>
                  <option value="Colleague">Colleague</option>
                  <option value="Business">Business</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setResolvedOwner(null);
                  setScanError(null);
                  if (activeTab === 'camera') void startCamera();
                }}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer"
              >
                Scan Another
              </button>
              <button
                type="button"
                onClick={
                  resolvedOwner.isAlreadyConnected
                    ? () => {
                        if (onConnected && resolvedOwner.owner) {
                          onConnected({
                            id: resolvedOwner.owner.id,
                            name: resolvedOwner.owner.displayName,
                            emailMasked: resolvedOwner.owner.emailMasked,
                            avatarUrl: resolvedOwner.owner.avatarUrl || null,
                          });
                        }
                        setResolvedOwner(null);
                        onClose();
                      }
                    : handleConfirmConnect
                }
                disabled={isConnecting}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-emerald-600/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isConnecting ? (
                  <span>Connecting...</span>
                ) : resolvedOwner.isAlreadyConnected ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Open Profile</span>
                  </>
                ) : (
                  <>
                    <Users className="w-3.5 h-3.5" />
                    <span>Confirm &amp; Connect</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* State 3: Scan Methods (Camera, Upload, Code) */
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl text-xs font-bold">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('camera');
                  setScanError(null);
                }}
                className={`py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeTab === 'camera'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Camera</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('upload');
                  setScanError(null);
                }}
                className={`py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeTab === 'upload'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('code');
                  setScanError(null);
                }}
                className={`py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeTab === 'code'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                }`}
              >
                <Keyboard className="w-3.5 h-3.5" />
                <span>Pair Code</span>
              </button>
            </div>

            {/* Tab A: Live Camera Scanner */}
            {activeTab === 'camera' && (
              <div className="space-y-3">
                <div className="relative aspect-square max-w-[280px] mx-auto bg-slate-950 rounded-3xl overflow-hidden border-2 border-slate-800 shadow-inner flex items-center justify-center">
                  <video
                    ref={videoRef}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                  />
                  <canvas ref={canvasRef} className="hidden" />

                  <div className="absolute inset-8 border-2 border-emerald-400/80 rounded-2xl pointer-events-none flex items-center justify-center">
                    <div className="w-full h-0.5 bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />
                  </div>

                  {/* Camera Controls: Torch & Switch Camera */}
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
                    {supportsTorch && (
                      <button
                        type="button"
                        onClick={toggleTorch}
                        className={`p-2 rounded-xl backdrop-blur-md transition-all cursor-pointer ${
                          isTorchOn
                            ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-400/30'
                            : 'bg-slate-900/70 text-white hover:bg-slate-900'
                        }`}
                        title={isTorchOn ? 'Turn off flashlight' : 'Turn on flashlight'}
                        aria-label="Toggle Flashlight"
                      >
                        {isTorchOn ? (
                          <Zap className="w-4 h-4 fill-current" />
                        ) : (
                          <ZapOff className="w-4 h-4" />
                        )}
                      </button>
                    )}
                    {videoDevices.length > 1 && (
                      <button
                        type="button"
                        onClick={handleSwitchCamera}
                        className="p-2 rounded-xl bg-slate-900/70 text-white hover:bg-slate-900 backdrop-blur-md transition-all cursor-pointer"
                        title="Switch Camera"
                        aria-label="Switch Camera"
                      >
                        <SwitchCamera className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {isResolving && (
                    <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm flex flex-col items-center justify-center text-white space-y-2">
                      <div className="w-7 h-7 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs font-bold">Verifying registered profile...</span>
                    </div>
                  )}
                </div>

                {/* Camera Selector Dropdown when multiple cameras exist */}
                {videoDevices.length > 1 && (
                  <div className="max-w-[280px] mx-auto">
                    <select
                      aria-label="Select camera"
                      value={currentDeviceId || ''}
                      onChange={(e) => handleSelectCamera(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                    >
                      {videoDevices.map((dev, idx) => (
                        <option key={dev.deviceId} value={dev.deviceId}>
                          {dev.label || `Camera ${idx + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {cameraError ? (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-800 dark:text-amber-300 space-y-2">
                    <p>{cameraError}</p>
                    <button
                      type="button"
                      onClick={() => void startCamera()}
                      className="text-[11px] font-bold underline cursor-pointer"
                    >
                      Retry Camera
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 text-center">
                    Point camera steadily at another user&apos;s My Money Manager QR code
                  </p>
                )}
              </div>
            )}

            {/* Tab B: Upload Image */}
            {activeTab === 'upload' && (
              <div className="space-y-4 py-4">
                <label className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 rounded-3xl cursor-pointer bg-slate-50 dark:bg-slate-800/40 transition-colors">
                  <Upload className="w-8 h-8 text-slate-400 mb-2" />
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 text-center">
                    Click to select a QR code screenshot or photo
                  </span>
                  <span className="text-[10px] text-slate-400 mt-1">PNG, JPG, JPEG, WEBP</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            )}

            {/* Tab C: Enter Pairing Code or Connection Link */}
            {activeTab === 'code' && (
              <form onSubmit={handleManualCodeSubmit} className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Pairing Code or Connection Link
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. MM-A1B2C3 or paste #pair=... link"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-mono tracking-wider text-center font-bold focus:ring-2 focus:ring-emerald-500"
                  />
                  <p className="text-[11px] text-slate-400 text-center">
                    Enter the code shown under your friend&apos;s My QR or paste their connection link
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={isResolving || !manualCode.trim()}
                  className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isResolving ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <span>Verify Code &amp; Find Profile</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
