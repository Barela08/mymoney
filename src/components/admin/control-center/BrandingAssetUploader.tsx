import React, { useRef, useState } from 'react';
import {
  Upload,
  RotateCcw,
  Trash2,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Image as ImageIcon,
  Link as LinkIcon,
  XCircle,
  Monitor,
  Smartphone,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { validateBrandingImageInput } from '../../../lib/svgSanitizer';
import {
  MAX_ADMIN_LOGO_BYTES,
  sanitizeUploadFilename,
} from '../../../lib/uploadSecurityCore';
import { sanitizePublicUrl } from '../../../lib/siteConfigDefaults';
import { useToast } from '../../../context/ToastContext';

export type BrandingAssetSlot =
  | 'logo'
  | 'sidebar_logo'
  | 'favicon'
  | 'pwa_icon'
  | 'notification_icon'
  | 'og_image'
  | 'hero_image'
  | 'banner'
  | 'splash';

interface BrandingAssetUploaderProps {
  label: string;
  helperText?: string;
  recommendedDimensions?: string;
  scope: 'user_app' | 'admin_app' | 'staff_app' | 'website' | 'general';
  slot: BrandingAssetSlot;
  value: string;
  defaultValue: string;
  previewAspect?: 'square' | 'wide';
  maxSizeBytes?: number;
  allowSvgToggle?: boolean;
  showDevicePreviews?: boolean;
  generateAllVariants?: boolean;
  onChange: (nextUrl: string) => void;
  onVariantsGenerated?: (variants: Record<string, string>) => void;
  onOriginalMeta?: (meta: {
    assetId?: string;
    byteSize?: number;
    width?: number;
    height?: number;
    mimeType?: string;
  }) => void;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function slotMaxDimension(slot: BrandingAssetSlot): number {
  switch (slot) {
    case 'favicon':
      return 64;
    case 'sidebar_logo':
    case 'notification_icon':
      return 192;
    case 'pwa_icon':
    case 'logo':
      return 512;
    case 'og_image':
    case 'hero_image':
    case 'banner':
    case 'splash':
      return 1280;
    default:
      return 512;
  }
}

async function renderResizedDataUrl(
  img: HTMLImageElement,
  maxDim: number,
  preferPng: boolean
): Promise<string> {
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (!natW || !natH) return '';

  const scale = Math.min(1, maxDim / Math.max(natW, natH));
  const targetW = Math.max(1, Math.round(natW * scale));
  const targetH = Math.max(1, Math.round(natH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.clearRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, targetW, targetH);

  // Preserve transparency via WebP/PNG (WebP supports alpha + small 3G payloads)
  if (!preferPng) {
    const webp = canvas.toDataURL('image/webp', 0.88);
    if (webp.startsWith('data:image/webp')) {
      return webp;
    }
  }
  return canvas.toDataURL('image/png');
}

async function createOptimizedDisplayAssets(
  sourceDataUrl: string,
  slot: BrandingAssetSlot,
  buildAllVariants: boolean
): Promise<{
  optimizedDataUrl?: string;
  variants?: Record<string, string>;
  width?: number;
  height?: number;
}> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return {};
  }
  // Keep sanitized SVGs crisp as-is
  if (sourceDataUrl.startsWith('data:image/svg+xml')) {
    return {};
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      try {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        const targetDim = slotMaxDimension(slot);
        // PWA & Favicon icons should use PNG for maximum OS/browser manifest compatibility
        const preferPng = slot === 'pwa_icon' || slot === 'favicon' || slot === 'notification_icon';
        const optimizedDataUrl = await renderResizedDataUrl(img, targetDim, preferPng);

        let variants: Record<string, string> | undefined;
        if (buildAllVariants) {
          variants = {
            logo: await renderResizedDataUrl(img, 512, false),
            sidebar_logo: await renderResizedDataUrl(img, 192, false),
            pwa_icon: await renderResizedDataUrl(img, 512, true),
            favicon: await renderResizedDataUrl(img, 64, true),
            notification_icon: await renderResizedDataUrl(img, 192, true),
          };
        }

        resolve({
          optimizedDataUrl: optimizedDataUrl || undefined,
          variants,
          width,
          height,
        });
      } catch {
        resolve({});
      }
    };
    img.onerror = () => resolve({});
    img.src = sourceDataUrl;
  });
}

export const BrandingAssetUploader: React.FC<BrandingAssetUploaderProps> = ({
  label,
  helperText,
  recommendedDimensions,
  scope,
  slot,
  value,
  defaultValue,
  previewAspect = 'square',
  maxSizeBytes = MAX_ADMIN_LOGO_BYTES,
  allowSvgToggle = true,
  showDevicePreviews = false,
  generateAllVariants = false,
  onChange,
  onVariantsGenerated,
  onOriginalMeta,
}) => {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [allowSvg, setAllowSvg] = useState(false);
  const [statusBadge, setStatusBadge] = useState<string | null>(null);
  const [assetSummary, setAssetSummary] = useState<{
    originalBytes?: number;
    optimizedBytes?: number;
    width?: number;
    height?: number;
    scannerEngine?: string;
  } | null>(null);

  const displaySrc = sanitizePublicUrl(value, defaultValue);
  const maxMbLabel = Math.round((maxSizeBytes / (1024 * 1024)) * 10) / 10;

  const handleCancelUpload = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsUploading(false);
    setUploadProgress(0);
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMsg(null);
    setStatusBadge(null);

    // 1. Validate filename & dangerous/double extensions
    const nameCheck = sanitizeUploadFilename(file.name);
    if (!nameCheck.valid) {
      const msg = nameCheck.error || 'Unsafe filename rejected.';
      setErrorMsg(msg);
      toast.error('Unsafe Filename Blocked', msg);
      return;
    }

    const isSvg =
      file.type === 'image/svg+xml' || nameCheck.extension === 'svg' || nameCheck.extension === 'svgz';

    if (isSvg && !allowSvg) {
      const msg =
        'SVG uploads are OFF by default for security. Upload PNG, JPG, or WebP — or enable SVG Strict Sanitization below.';
      setErrorMsg(msg);
      toast.error('SVG Disabled by Default', msg);
      return;
    }

    if (file.size <= 0) {
      const msg = 'Selected file is empty.';
      setErrorMsg(msg);
      toast.error('Invalid File', msg);
      return;
    }

    if (file.size > maxSizeBytes) {
      const msg = `File exceeds maximum allowed ${maxMbLabel} MB limit (selected: ${formatBytes(file.size)}).`;
      setErrorMsg(msg);
      toast.error('File Too Large', msg);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsUploading(true);
    setUploadProgress(8);

    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        if (controller.signal.aborted) {
          reject(new Error('Upload cancelled.'));
          return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read the selected file.'));
        reader.onabort = () => reject(new Error('Upload cancelled.'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
      });

      if (controller.signal.aborted) throw new Error('Upload cancelled.');

      setUploadProgress(22);
      const localCheck = validateBrandingImageInput(dataUrl, {
        maxBytes: maxSizeBytes,
        allowSvg,
        allowGif: false,
        filename: nameCheck.sanitizedName,
      });

      if (!localCheck.valid || !localCheck.sanitizedDataUrl) {
        throw new Error(localCheck.error || 'Unsupported or unsafe image asset.');
      }

      setUploadProgress(35);
      const optimized = await createOptimizedDisplayAssets(
        localCheck.sanitizedDataUrl,
        slot,
        generateAllVariants
      );

      if (controller.signal.aborted) throw new Error('Upload cancelled.');

      const res = await adminClient.uploadBrandingAsset(
        {
          scope,
          slot,
          dataUrl: localCheck.sanitizedDataUrl,
          filename: nameCheck.sanitizedName,
          allowSvg,
          optimizedDataUrl: optimized.optimizedDataUrl,
          variants: optimized.variants,
          width: optimized.width || localCheck.width,
          height: optimized.height || localCheck.height,
        },
        {
          signal: controller.signal,
          onProgress: (pct) => setUploadProgress(pct),
        }
      );

      if (!res?.success || !res?.assetUrl) {
        throw new Error(res?.message || 'Failed to persist branding asset.');
      }

      setUploadProgress(100);
      setStatusBadge(isSvg ? 'SVG Sanitized' : 'Scanned & Optimized');
      setAssetSummary({
        originalBytes: res.originalAsset?.byteSize || localCheck.byteSize || file.size,
        optimizedBytes: res.asset?.byteSize,
        width: res.originalAsset?.width || optimized.width || localCheck.width,
        height: res.originalAsset?.height || optimized.height || localCheck.height,
        scannerEngine: res.scannerEngine,
      });

      if (onOriginalMeta && res.originalAsset) {
        onOriginalMeta({
          assetId: res.originalAsset.quarantineId,
          byteSize: res.originalAsset.byteSize,
          width: res.originalAsset.width || optimized.width || localCheck.width,
          height: res.originalAsset.height || optimized.height || localCheck.height,
          mimeType: localCheck.mimeType,
        });
      }

      if (onVariantsGenerated && res.variants && Object.keys(res.variants).length > 0) {
        onVariantsGenerated(res.variants);
      }

      onChange(res.assetUrl);
      toast.success(
        `${label} Updated`,
        `Original (${formatBytes(file.size)}) archived securely; optimized display asset ready (${formatBytes(res.asset?.byteSize)}).`
      );
    } catch (err: any) {
      const msg = err?.message || 'Asset upload failed.';
      setErrorMsg(msg);
      if (!msg.toLowerCase().includes('cancelled')) {
        toast.error('Upload Rejected', msg);
      } else {
        toast.info('Upload Cancelled', `${label} upload was cancelled cleanly.`);
      }
    } finally {
      abortControllerRef.current = null;
      setIsUploading(false);
      window.setTimeout(() => setUploadProgress(0), 600);
    }
  };

  return (
    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/70 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-900 dark:text-slate-100">{label}</p>
          {helperText && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{helperText}</p>
          )}
          <p className="text-[10px] font-medium text-slate-400 mt-0.5">
            PNG, JPG, WebP (transparent PNG supported · max {maxMbLabel} MB
            {recommendedDimensions ? ` · ${recommendedDimensions}` : ''})
          </p>
        </div>
        {statusBadge && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold shrink-0">
            <ShieldCheck className="w-3 h-3" />
            {statusBadge}
          </span>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start gap-3.5">
        <div
          className={`shrink-0 rounded-2xl border border-slate-200 dark:border-slate-700 bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#ffffff_0%_50%)] dark:bg-[repeating-conic-gradient(#0f172a_0%_25%,#1e293b_0%_50%)] bg-[length:12px_12px] overflow-hidden flex items-center justify-center shadow-xs ${
            previewAspect === 'wide' ? 'w-28 h-16' : 'w-16 h-16'
          }`}
          title="Checkered background shows transparent PNG alpha cleanly"
        >
          {displaySrc ? (
            <img
              src={displaySrc}
              alt={label}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = defaultValue || '/logo.jpg';
              }}
              className="w-full h-full object-contain p-1"
            />
          ) : (
            <ImageIcon className="w-6 h-6 text-slate-400" />
          )}
        </div>

        <div className="flex-1 space-y-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={
                allowSvg
                  ? 'image/png,image/jpeg,image/webp,image/svg+xml,.svg'
                  : 'image/png,image/jpeg,image/webp'
              }
              onChange={handleFileSelected}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold transition-colors cursor-pointer"
            >
              {isUploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              <span>{value && value !== defaultValue ? 'Replace Logo' : 'Upload Logo'}</span>
            </button>

            {isUploading && (
              <button
                type="button"
                onClick={handleCancelUpload}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>Cancel Upload</span>
              </button>
            )}

            {value !== defaultValue && !isUploading && (
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setStatusBadge(null);
                  setAssetSummary(null);
                  onChange(defaultValue);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Restore Default</span>
              </button>
            )}

            {value && !isUploading && (
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setStatusBadge(null);
                  setAssetSummary(null);
                  onChange(defaultValue);
                }}
                title="Remove custom logo"
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove</span>
              </button>
            )}
          </div>

          {allowSvgToggle && (
            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allowSvg}
                onChange={(e) => setAllowSvg(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>Allow SVG upload (OFF by default · strict script/event sanitization)</span>
            </label>
          )}

          {uploadProgress > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500">
                <span>Validating, scanning &amp; optimizing…</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {assetSummary && (
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-500 dark:text-slate-400">
              {assetSummary.width && assetSummary.height && (
                <span>
                  {assetSummary.width}×{assetSummary.height}px
                </span>
              )}
              {assetSummary.originalBytes && (
                <span>Original: {formatBytes(assetSummary.originalBytes)}</span>
              )}
              {assetSummary.optimizedBytes && (
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                  Served: {formatBytes(assetSummary.optimizedBytes)}
                </span>
              )}
            </div>
          )}

          {showDevicePreviews && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                <Monitor className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <img
                  src={displaySrc}
                  alt="Desktop Logo Preview"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = defaultValue || '/logo.jpg';
                  }}
                  className="w-6 h-6 rounded-lg object-contain shrink-0"
                />
                <span className="text-[10px] font-semibold text-slate-500 truncate">Desktop</span>
              </div>
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                <Smartphone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <img
                  src={displaySrc}
                  alt="Mobile Logo Preview"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = defaultValue || '/logo.jpg';
                  }}
                  className="w-5 h-5 rounded-md object-contain shrink-0"
                />
                <span className="text-[10px] font-semibold text-slate-500 truncate">Mobile</span>
              </div>
            </div>
          )}

          <div className="relative">
            <LinkIcon className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={value}
              onChange={(e) => {
                setErrorMsg(null);
                onChange(e.target.value);
              }}
              placeholder={defaultValue}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-[11px] text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
};
