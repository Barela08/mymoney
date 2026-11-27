import React, { useState, useEffect, useRef, useCallback } from 'react';
import jsQR from 'jsqr';
import {
  X,
  Camera,
  CameraOff,
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
  // Explicit camera lifecycle. A live preview is never reported as an error.
  const [cameraStatus, setCameraStatus] = useState<
    'idle' | 'starting' | 'active' | 'denied' | 'unavailable' | 'error'
  >('idle');
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
  const streamGenerationRef = useRef<number>(0);
  const lastDecodeAtRef = useRef<number>(0);

  useEffect(() => {
    setScannerActive(isOpen);
    return () => setScannerActive(false);
  }, [isOpen, setScannerActive]);

  // Strict media stream & torch cleanup
  const stopCamera = useCallback(() => {
    streamGenerationRef.current += 1;
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
    setCameraStatus('idle');
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
    } else if (code === 'ACCOUNT_UNAVAILABLE' || code === 'BLOCKED') {
      title = 'Account Unavailable';
      message = 'This user account is currently deactivated, blocked, or unavailable for connections.';
    } else if (code === 'RATE_LIMITED') {
      title = 'Please Wait';
      message = 'Too many attempts. Wait a minute and try the code again.';
    } else if (code === 'PAIRING_UNAVAILABLE' || err?.isNonJson || err?.status >= 500) {
      title = 'Server Temporarily Unavailable';
      message = 'We could not verify this code right now. Your data has not been changed. Please retry in a moment.';
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

        // Server-side verification only. A QR payload is never trusted on its own.
        const res = await udharDeletionApi.resolveQrCode({
          qrData: parsed.kind === 'json' ? rawInput.trim() : undefined,
          pairingToken: parsed.token,
          pairingCode: parsed.code,
        });

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
  const scanFrame = useCallback(function tick() {
    if (!isScanningActiveRef.current || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (ctx && video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const now = performance.now();
      if (now - lastDecodeAtRef.current < 140) {
        animFrameRef.current = requestAnimationFrame(tick);
        return;
      }
      lastDecodeAtRef.current = now;

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // Try standard orientation first
      let code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });
      // Fallback for high-contrast / inverted QR codes
      if (!code || !code.data) {
        code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'onlyInvert',
        });
      }

      if (code && code.data) {
        stopCamera();
        void resolveRawInput(code.data);
        return;
      }
    }

    animFrameRef.current = requestAnimationFrame(tick);
  }, [stopCamera, resolveRawInput]);

  // Start camera with progressive fallback and race protection.
  // Only a real getUserMedia failure is reported as a camera problem.
  const startCamera = useCallback(
    async (deviceIdOverride?: string | null) => {
      stopCamera();
      const generation = streamGenerationRef.current;
      setCameraError(null);
      setScanError(null);
      setCameraStatus('starting');

      const isLocalHost =
        window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (typeof window !== 'undefined' && window.location.protocol !== 'https:' && !isLocalHost) {
        setCameraStatus('error');
        setCameraError(
          'Live camera requires a secure HTTPS connection. Open the site over HTTPS, or use "Upload" / "Pair Code" below.'
        );
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraStatus('unavailable');
        setCameraError(
          'Live camera scanning is not supported in this browser. Use "Upload" or "Pair Code" below.'
        );
        return;
      }

      const targetDeviceId = deviceIdOverride !== undefined ? deviceIdOverride : currentDeviceId;

      try {
        let stream: MediaStream | null = null;

        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: targetDeviceId
              ? { deviceId: { exact: targetDeviceId }, width: { ideal: 720 }, height: { ideal: 720 } }
              : { facingMode: { ideal: 'environment' }, width: { ideal: 720 }, height: { ideal: 720 } },
          });
        } catch {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } });
          } catch {
            stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
          }
        }

        // A newer start (or a close) happened while we waited for permission.
        if (generation !== streamGenerationRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack?.getSettings?.().deviceId && !targetDeviceId) {
          setCurrentDeviceId(videoTrack.getSettings().deviceId || null);
        }
        setSupportsTorch(Boolean(videoTrack?.getCapabilities && "torch" in (videoTrack.getCapabilities() as any)));

        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          setCameraStatus('idle');
          return;
        }

        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        video.setAttribute('webkit-playsinline', 'true');
        video.muted = true;

        // Wait for real frame dimensions before decoding anything.
        await new Promise<void>((resolve) => {
          if (video.readyState >= 1) return resolve();
          const done = () => resolve();
          video.addEventListener('loadedmetadata', done, { once: true });
          setTimeout(done, 2500);
        });

        await video.play().catch(() => {});

        if (generation !== streamGenerationRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        // The stream is live: this is success even if no QR is visible yet.
        setCameraStatus('active');
        setCameraError(null);
        isScanningActiveRef.current = true;
        setIsScanningPaused(false);
        scanFrame();

        await refreshDevices();
      } catch (err: any) {
        if (generation !== streamGenerationRef.current) return;
        const isPermissionDenied =
          err?.name === 'NotAllowedError' ||
          err?.name === 'PermissionDeniedError' ||
          err?.name === 'SecurityError' ||
          String(err?.message || '').toLowerCase().includes('permission') ||
          String(err?.message || '').toLowerCase().includes('denied') ||
          String(err?.message || '').toLowerCase().includes('dismissed');

        const isNotFound =
          err?.name === 'NotFoundError' ||
          err?.name === 'DevicesNotFoundError' ||
          String(err?.message || '').toLowerCase().includes('not found');

        const isBusy =
          err?.name === 'NotReadableError' ||
          err?.name === 'TrackStartError' ||
          String(err?.message || '').toLowerCase().includes('busy') ||
          String(err?.message || '').toLowerCase().includes('in use');

        setCameraError(
          isPermissionDenied
            ? 'Camera access was blocked or dismissed. Tap the lock/tune icon 🔒 in your browser address bar to allow Camera, then tap Retry Camera below.'
            : isNotFound
              ? 'No camera was detected on this device. Use "Upload" or "Pair Code" instead.'
              : isBusy
                ? 'The camera is in use by another app or browser tab. Please close it and tap Retry Camera.'
                : 'Camera could not be started. Check permissions or use "Upload" or "Pair Code" below.'
        );
        setCameraStatus(isPermissionDenied ? 'denied' : isNotFound ? 'unavailable' : 'error');
      }
    },
    [currentDeviceId, stopCamera, refreshDevices, scanFrame]
  );

  const togglePauseScanning = useCallback(() => {
    if (isScanningPaused) {
      isScanningActiveRef.current = true;
      setIsScanningPaused(false);
      videoRef.current?.play().catch(() => {});
      scanFrame();
    } else {
      isScanningActiveRef.current = false;
      setIsScanningPaused(true);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      videoRef.current?.pause();
    }
  }, [isScanningPaused, scanFrame]);

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
      // Server-side only: creates a pending request that the QR owner must approve.
      const res = await udharDeletionApi.connectViaQr({
        pairingToken: resolvedOwner.pairingToken,
        pairingCode: resolvedOwner.pairingCode,
        relationshipType,
      });

      if (res.status === 'connected') {
        toast.success(
          'Connected!',
          res.message || `You are now connected with ${resolvedOwner.owner?.displayName || 'this user'}.`
        );
        if (onConnected && res.connection) {
          onConnected({
            id: res.connection.id,
            name: res.connection.displayName,
            emailMasked: res.connection.emailMasked,
            avatarUrl: res.connection.avatarUrl || null,
          });
        }
      } else {
        toast.success(
          'Request Sent',
          res.message ||
            'Your connection request was sent. It becomes active only after they accept it.'
        );
      }

      setResolvedOwner(null);
      onClose();
    } catch (err: any) {
      const mapped = mapResolveError(err);
      toast.error(mapped.title, mapped.message);
      setScanError(mapped);
      setResolvedOwner(null);
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
                  <span>Send a connection request? They must approve it before any profile details are shared.</span>
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
                  <span>Sending...</span>
                ) : resolvedOwner.isAlreadyConnected ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Open Profile</span>
                  </>
                ) : (
                  <>
                    <Users className="w-3.5 h-3.5" />
                    <span>Send Request</span>
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
                    className={`w-full h-full object-cover ${cameraStatus === 'active' ? 'block' : 'hidden'}`}
                    muted
                    playsInline
                  />
                  <canvas ref={canvasRef} className="hidden" />

                  {/* Fallback Viewport when camera is not streaming */}
                  {cameraStatus !== 'active' && (
                    <div className="flex flex-col items-center justify-center text-center p-6 space-y-2">
                      {cameraStatus === 'starting' ? (
                        <>
                          <div className="w-12 h-12 rounded-2xl bg-emerald-950/60 border border-emerald-500/30 flex items-center justify-center text-emerald-400 animate-pulse">
                            <Camera className="w-6 h-6" />
                          </div>
                          <p className="text-xs font-semibold text-slate-300">Connecting camera...</p>
                        </>
                      ) : (
                        <>
                          <div className="w-12 h-12 rounded-2xl bg-amber-950/60 border border-amber-500/30 flex items-center justify-center text-amber-400">
                            <CameraOff className="w-6 h-6" />
                          </div>
                          <p className="text-xs font-semibold text-slate-300">Camera not active</p>
                          <p className="text-[11px] text-slate-500">Allow permissions or use Upload / Pair Code below</p>
                        </>
                      )}
                    </div>
                  )}

                  {cameraStatus === 'active' && !isScanningPaused && (
                    <div className="absolute inset-8 border-2 border-emerald-400/80 rounded-2xl pointer-events-none flex items-center justify-center">
                      <div className="w-full h-0.5 bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />
                    </div>
                  )}

                  {/* Camera Controls: Torch, Switch Camera & Pause/Resume (Only when camera is active) */}
                  {cameraStatus === 'active' && (
                    <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
                      {/* Pause / Resume Button */}
                      <button
                        type="button"
                        onClick={togglePauseScanning}
                        className={`p-2 rounded-xl backdrop-blur-md transition-all cursor-pointer ${
                          isScanningPaused
                            ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                            : 'bg-slate-900/70 text-white hover:bg-slate-900'
                        }`}
                        title={isScanningPaused ? 'Resume Scanning' : 'Pause Scanning'}
                        aria-label={isScanningPaused ? 'Resume Scanning' : 'Pause Scanning'}
                      >
                        {isScanningPaused ? (
                          <Play className="w-4 h-4 fill-current" />
                        ) : (
                          <Pause className="w-4 h-4" />
                        )}
                      </button>

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
                  )}

                  {isScanningPaused && (
                    <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs flex flex-col items-center justify-center text-white space-y-2">
                      <Pause className="w-8 h-8 text-amber-400" />
                      <span className="text-xs font-bold">Scanning Paused</span>
                      <button
                        type="button"
                        onClick={togglePauseScanning}
                        className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold cursor-pointer"
                      >
                        Tap to Resume
                      </button>
                    </div>
                  )}

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

                {!cameraError && cameraStatus === 'active' && (
                  <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Camera ready. Scan your friend&apos;s Udhar QR code.</span>
                  </div>
                )}

                {!cameraError && cameraStatus === 'starting' && (
                  <p className="text-[11px] text-slate-500 text-center animate-pulse">
                    Starting camera...
                  </p>
                )}

                {!cameraError && cameraStatus === 'idle' && (
                  <div className="text-center space-y-2">
                    <p className="text-[11px] text-slate-500">Camera is off.</p>
                    <button
                      type="button"
                      onClick={() => void startCamera()}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] cursor-pointer"
                    >
                      Start Camera
                    </button>
                  </div>
                )}

                {cameraError ? (
                  <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl text-xs text-amber-800 dark:text-amber-300 space-y-3">
                    <p className="leading-relaxed">{cameraError}</p>
                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      <button
                        type="button"
                        onClick={() => void startCamera()}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition-colors cursor-pointer"
                      >
                        Retry Camera
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab('upload')}
                        className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-semibold text-[11px] transition-colors cursor-pointer"
                      >
                        Upload QR Image
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab('code')}
                        className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-semibold text-[11px] transition-colors cursor-pointer"
                      >
                        Enter Code Manually
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-[11px] text-slate-500 max-w-[280px] mx-auto pt-1">
                    <span>Camera ready. Place a QR code inside the scanning frame.</span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('upload')}
                      className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline cursor-pointer"
                    >
                      Upload photo instead
                    </button>
                  </div>
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
