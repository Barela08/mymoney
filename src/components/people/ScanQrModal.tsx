import React, { useState, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { udharDeletionApi, ResolveQrResponse } from '../../lib/udharDeletionApi';

interface ScanQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected?: (person: { id: string; name: string }) => void;
}

export const ScanQrModal: React.FC<ScanQrModalProps> = ({
  isOpen,
  onClose,
  onConnected,
}) => {
  const { user } = useAuth();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<'camera' | 'upload' | 'code'>('camera');
  const [isResolving, setIsResolving] = useState<boolean>(false);
  const [resolvedOwner, setResolvedOwner] = useState<ResolveQrResponse | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Manual code form
  const [manualCode, setManualCode] = useState<string>('');
  const [relationshipType, setRelationshipType] = useState<string>('Friend');

  // Video & Canvas refs for scanner
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const isScanningActiveRef = useRef<boolean>(false);

  // Stop media stream helper
  const stopCamera = () => {
    isScanningActiveRef.current = false;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  // Start media stream for live QR scan
  const startCamera = async () => {
    stopCamera();
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        isScanningActiveRef.current = true;
        scanFrame();
      }
    } catch (err: any) {
      console.warn('Camera error:', err.message);
      setCameraError('Camera access unavailable or permission denied. You can upload an image or enter the pairing code manually.');
    }
  };

  // Scan frame loop
  const scanFrame = () => {
    if (!isScanningActiveRef.current || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });

      if (code && code.data) {
        // Detected a QR code!
        stopCamera();
        handleQrPayloadDetected(code.data);
        return;
      }
    }

    animFrameRef.current = requestAnimationFrame(scanFrame);
  };

  useEffect(() => {
    if (isOpen) {
      setResolvedOwner(null);
      setCameraError(null);
      if (activeTab === 'camera') {
        startCamera();
      }
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isOpen, activeTab]);

  // Handle detected QR data string
  const handleQrPayloadDetected = async (rawQrData: string) => {
    try {
      setIsResolving(true);
      const res = await udharDeletionApi.resolveQrCode({ qrData: rawQrData });
      if (res.success && res.owner) {
        setResolvedOwner(res);
        toast.info('QR Recognized', `Found user: ${res.owner.displayName}`);
      } else {
        toast.error('Invalid QR', res.message || 'Could not verify user pairing token.');
        if (activeTab === 'camera') startCamera();
      }
    } catch (err: any) {
      toast.error('QR Error', err.message || 'Failed to resolve QR token.');
      if (activeTab === 'camera') startCamera();
    } finally {
      setIsResolving(false);
    }
  };

  // Image Upload Handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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
          handleQrPayloadDetected(code.data);
        } else {
          toast.error('QR Not Detected', 'Could not find a valid QR code in this image. Try another photo or enter code manually.');
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Manual Code Submit
  const handleManualCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = manualCode.trim();
    if (!clean) return;

    try {
      setIsResolving(true);
      const res = await udharDeletionApi.resolveQrCode({ pairingCode: clean });
      if (res.success && res.owner) {
        setResolvedOwner(res);
        toast.info('Code Verified', `Found user: ${res.owner.displayName}`);
      } else {
        toast.error('Invalid Code', res.message || 'Invalid or expired code.');
      }
    } catch (err: any) {
      toast.error('Error', err.message || 'Failed to verify pairing code.');
    } finally {
      setIsResolving(false);
    }
  };

  // Confirm Linking
  const handleConfirmConnect = async () => {
    if (!resolvedOwner) return;

    try {
      setIsConnecting(true);
      const res = await udharDeletionApi.connectViaQr({
        pairingToken: resolvedOwner.pairingToken,
        pairingCode: resolvedOwner.pairingCode,
        relationshipType,
      });

      if (res.success) {
        toast.success(
          'Connected Successfully!',
          `You and ${res.connectedUser.displayName} are now linked for 2-way Udhar tracking.`
        );
        if (onConnected) {
          onConnected({
            id: res.connectedUser.id,
            name: res.connectedUser.displayName,
          });
        }
        onClose();
      } else {
        toast.error('Connection Failed', res.message);
      }
    } catch (err: any) {
      toast.error('Error', err.message || 'Could not create connection.');
    } finally {
      setIsConnecting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-sm sm:max-w-md w-full p-6 sm:p-7 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5 relative">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-200 dark:border-blue-800">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-slate-100">
                Scan Udhar QR Code
              </h3>
              <p className="text-[11px] text-slate-500">Connect Person & 2-Way Ledger Sync</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* View 1: When a User is Detected and Ready to Connect */}
        {resolvedOwner?.owner ? (
          <div className="space-y-5 animate-fade-in">
            <div className="p-5 bg-gradient-to-br from-emerald-50 via-teal-50/50 to-blue-50/40 dark:from-emerald-950/40 dark:via-slate-800 dark:to-slate-900 rounded-3xl border border-emerald-200 dark:border-emerald-800 text-center space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-black text-2xl flex items-center justify-center shadow-lg shadow-emerald-600/30 mx-auto">
                {resolvedOwner.owner.displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                  Verified My Money Manager User
                </span>
                <h4 className="text-lg font-black text-slate-900 dark:text-slate-100 mt-1">
                  {resolvedOwner.owner.displayName}
                </h4>
                <p className="text-xs text-slate-500 font-mono">
                  {resolvedOwner.owner.emailMasked}
                </p>
              </div>

              {resolvedOwner.isAlreadyConnected ? (
                <div className="p-2.5 rounded-xl bg-blue-100/60 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 text-xs font-semibold flex items-center justify-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-blue-600" />
                  <span>Already in your connected Saved People!</span>
                </div>
              ) : (
                <div className="p-2.5 rounded-xl bg-emerald-100/60 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center justify-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-600" />
                  <span>Ready to link for 2-sided Udhar transactions</span>
                </div>
              )}
            </div>

            {/* Relationship selector */}
            <div className="space-y-1.5 text-left">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Relationship Tag:
              </label>
              <select
                value={relationshipType}
                onChange={(e) => setRelationshipType(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium focus:ring-2 focus:ring-emerald-500"
              >
                <option value="Friend">Friend (दोस्त)</option>
                <option value="Roommate">Roommate (कमरेदार)</option>
                <option value="Colleague">Colleague (सहकर्मी)</option>
                <option value="Family">Family (परिवार)</option>
                <option value="Business">Business (व्यापार)</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setResolvedOwner(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer"
              >
                Scan Another
              </button>
              <button
                type="button"
                onClick={handleConfirmConnect}
                disabled={isConnecting}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold shadow-md shadow-emerald-600/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isConnecting ? (
                  <span>Linking...</span>
                ) : (
                  <>
                    <Users className="w-3.5 h-3.5" />
                    <span>Connect Person</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* View 2: Scan Methods (Camera, Upload, Code) */
          <div className="space-y-4">
            {/* Mode Tabs */}
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl text-xs font-bold">
              <button
                type="button"
                onClick={() => setActiveTab('camera')}
                className={`py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeTab === 'camera'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Camera</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('upload')}
                className={`py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeTab === 'upload'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('code')}
                className={`py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeTab === 'code'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
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

                  {/* QR Aim Reticle Overlay */}
                  <div className="absolute inset-8 border-2 border-emerald-400/80 rounded-2xl pointer-events-none animate-pulse-subtle flex items-center justify-center">
                    <div className="w-full h-0.5 bg-emerald-400 shadow-[0_0_8px_#34d399] animate-bounce" />
                  </div>

                  {isResolving && (
                    <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm flex flex-col items-center justify-center text-white space-y-2">
                      <div className="w-7 h-7 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs font-bold">Verifying pairing reference...</span>
                    </div>
                  )}
                </div>

                {cameraError ? (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-800 dark:text-amber-300">
                    {cameraError}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 text-center">
                    Point camera steadily at another user's My Money Manager QR code
                  </p>
                )}
              </div>
            )}

            {/* Tab B: Upload Image */}
            {activeTab === 'upload' && (
              <div className="space-y-4 py-4">
                <label className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 rounded-3xl cursor-pointer bg-slate-50 dark:bg-slate-800/40 transition-colors">
                  <Upload className="w-8 h-8 text-slate-400 mb-2" />
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Click to select a QR code screenshot or photo
                  </span>
                  <span className="text-[10px] text-slate-400 mt-1">PNG, JPG, JPEG</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            )}

            {/* Tab C: Enter Pairing Code Manually */}
            {activeTab === 'code' && (
              <form onSubmit={handleManualCodeSubmit} className="space-y-4 py-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 text-left">
                    Enter 8-Character Pairing Code:
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. MM-A7X9-2K4P"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                    className="w-full px-3.5 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-base font-mono font-bold text-center tracking-widest focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isResolving}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold shadow-md shadow-emerald-600/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {isResolving ? (
                    <span>Verifying Code...</span>
                  ) : (
                    <>
                      <span>Find & Verify User</span>
                      <ArrowRight className="w-3.5 h-3.5" />
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
