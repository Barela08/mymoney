import React, { useState, useRef } from 'react';
import {
  Camera,
  Upload,
  Trash2,
  X,
  Check,
  User,
  Sparkles,
  RefreshCw,
  Image as ImageIcon,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

interface ProfilePhotoUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAvatarUrl?: string | null;
  onPhotoUpdated?: (url: string | null) => void;
}

export const ProfilePhotoUploadModal: React.FC<ProfilePhotoUploadModalProps> = ({
  isOpen,
  onClose,
  currentAvatarUrl,
  onPhotoUpdated,
}) => {
  const { user, updateUserProfile } = useAuth();
  const toast = useToast();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentAvatarUrl || user?.avatarUrl || null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  if (!isOpen) return null;

  // Compress and resize image using HTML5 Canvas (max 512x512, high quality)
  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 480;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxDim) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            }
          } else {
            if (height > maxDim) {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(img.src);
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve(compressedDataUrl);
        };
        img.onerror = (err) => reject(err);
      };
      reader.onerror = (err) => reject(err);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate type
    if (!file.type.startsWith('image/')) {
      toast.error('Invalid File', 'Please select a valid image file (JPEG, PNG, WEBP).');
      return;
    }

    // Validate size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File Too Large', 'Please select an image smaller than 5 MB.');
      return;
    }

    try {
      setIsProcessing(true);
      const compressed = await compressImage(file);
      setPreviewUrl(compressed);
      setSelectedFile(file);
    } catch (err: any) {
      toast.error('Image Processing Failed', err.message || 'Could not process image.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSavePhoto = async () => {
    if (!previewUrl) return;

    try {
      setIsProcessing(true);
      const res = await updateUserProfile({ avatarUrl: previewUrl });
      if (res.success) {
        toast.success('Photo Updated', 'Your profile picture has been updated successfully.');
        if (onPhotoUpdated) onPhotoUpdated(previewUrl);
        onClose();
      } else {
        toast.error('Failed to update', res.message);
      }
    } catch (err: any) {
      toast.error('Upload Error', err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!confirm('Are you sure you want to remove your profile photo? Default avatar will be used.')) return;

    try {
      setIsProcessing(true);
      const res = await updateUserProfile({ avatarUrl: '' });
      if (res.success) {
        toast.success('Photo Removed', 'Your profile photo was removed.');
        setPreviewUrl(null);
        if (onPhotoUpdated) onPhotoUpdated(null);
        onClose();
      } else {
        toast.error('Failed to remove', res.message);
      }
    } catch (err: any) {
      toast.error('Error removing photo', err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5 text-center">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Camera className="w-4 h-4 text-emerald-600" />
            <span>Profile Photo</span>
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Avatar Preview */}
        <div className="relative w-32 h-32 mx-auto">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={user?.displayName || 'Profile Photo'}
              className="w-32 h-32 rounded-full object-cover border-4 border-emerald-500/30 shadow-xl mx-auto"
            />
          ) : (
            <div className="w-32 h-32 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-black text-4xl flex items-center justify-center border-4 border-emerald-500/20 shadow-xl mx-auto">
              {user?.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
            </div>
          )}

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="absolute bottom-0 right-0 p-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/40 border-2 border-white dark:border-slate-900 transition-transform active:scale-90 cursor-pointer"
            title="Upload from Mobile Gallery or Desktop"
          >
            <Camera className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Upload from your mobile Gallery or computer. Images are compressed automatically for fast loading.
        </p>

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Action Buttons */}
        <div className="space-y-2 pt-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <ImageIcon className="w-4 h-4 text-emerald-500" />
              <span>Choose Photo</span>
            </button>

            {previewUrl && (
              <button
                type="button"
                onClick={handleRemovePhoto}
                disabled={isProcessing}
                className="py-2.5 px-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                <span>Remove</span>
              </button>
            )}
          </div>

          {selectedFile && (
            <button
              type="button"
              onClick={handleSavePhoto}
              disabled={isProcessing}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-2xl text-xs font-bold shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              <Check className="w-4 h-4 stroke-[2.5]" />
              <span>{isProcessing ? 'Saving Photo...' : 'Save & Set as Profile Picture'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
