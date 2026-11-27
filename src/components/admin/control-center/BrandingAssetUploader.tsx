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
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { validateBrandingImageInput } from '../../../lib/svgSanitizer';
import { sanitizePublicUrl } from '../../../lib/siteConfigDefaults';
import { useToast } from '../../../context/ToastContext';

interface BrandingAssetUploaderProps {
  label: string;
  helperText?: string;
  scope: 'user_app' | 'admin_app' | 'staff_app' | 'website' | 'general';
  slot: 'logo' | 'favicon' | 'pwa_icon' | 'og_image' | 'hero_image' | 'banner' | 'splash';
  value: string;
  defaultValue: string;
  previewAspect?: 'square' | 'wide';
  onChange: (nextUrl: string) => void;
}

export const BrandingAssetUploader: React.FC<BrandingAssetUploaderProps> = ({
  label,
  helperText,
  scope,
  slot,
  value,
  defaultValue,
  previewAspect = 'square',
  onChange,
}) => {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSvgVerified, setIsSvgVerified] = useState(false);

  const displaySrc = sanitizePublicUrl(value, defaultValue);

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMsg(null);
    setIsSvgVerified(false);
    setIsUploading(true);
    setUploadProgress(15);

    try {
      const isSvg =
        file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');

      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read the selected file.'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
      });

      setUploadProgress(45);
      const localCheck = validateBrandingImageInput(dataUrl);
      if (!localCheck.valid || !localCheck.sanitizedDataUrl) {
        throw new Error(localCheck.error || 'Unsupported or unsafe image asset.');
      }

      setUploadProgress(75);
      const res = await adminClient.uploadBrandingAsset({
        scope,
        slot,
        dataUrl: localCheck.sanitizedDataUrl,
        width: localCheck.width,
        height: localCheck.height,
      });

      if (!res?.success || !res?.assetUrl) {
        throw new Error(res?.message || 'Failed to persist branding asset.');
      }

      setUploadProgress(100);
      setIsSvgVerified(isSvg);
      onChange(res.assetUrl);
      toast.success(
        `${label} Uploaded`,
        isSvg
          ? 'SVG sanitized cleanly (XSS/script-free) and stored.'
          : 'Asset uploaded and ready to preview or publish.'
      );
    } catch (err: any) {
      const msg = err?.message || 'Asset upload failed.';
      setErrorMsg(msg);
      toast.error('Upload Rejected', msg);
    } finally {
      setIsUploading(false);
      window.setTimeout(() => setUploadProgress(0), 600);
    }
  };

  return (
    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/70 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-slate-900 dark:text-slate-100">{label}</p>
          {helperText && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{helperText}</p>
          )}
        </div>
        {isSvgVerified && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold shrink-0">
            <ShieldCheck className="w-3 h-3" />
            SVG Sanitized
          </span>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3.5">
        <div
          className={`shrink-0 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden flex items-center justify-center shadow-xs ${
            previewAspect === 'wide' ? 'w-28 h-16' : 'w-16 h-16'
          }`}
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
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
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
              <span>{value && value !== defaultValue ? 'Replace Image' : 'Upload PNG / JPG / SVG'}</span>
            </button>

            {value !== defaultValue && (
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setIsSvgVerified(false);
                  onChange(defaultValue);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Default</span>
              </button>
            )}

            {value && (
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setIsSvgVerified(false);
                  onChange(defaultValue);
                }}
                title="Clear custom asset"
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove</span>
              </button>
            )}
          </div>

          {uploadProgress > 0 && (
            <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-200"
                style={{ width: `${uploadProgress}%` }}
              />
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
