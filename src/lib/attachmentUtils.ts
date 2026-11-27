import {
  validateReceiptUpload,
  validateReceiptFileSignature,
} from './financialIntelligenceEngine';

export interface ProcessedAttachmentResult {
  valid: boolean;
  dataUrl?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  error?: string;
}

const SAFE_IMAGE_DATA_URL_RE = /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i;

/**
 * Validates that an attachment URL/DataURL uses a strictly safe image or HTTP(S) scheme.
 * Blocks SVG, HTML, javascript:, vbscript:, or arbitrary inline scripts.
 */
export function isSafeAttachmentUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (SAFE_IMAGE_DATA_URL_RE.test(trimmed)) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read selected image.'));
    };
    reader.onerror = () => reject(new Error('Failed to read selected file.'));
    reader.readAsDataURL(file);
  });
}

function compressImageDataUrl(dataUrl: string, maxDim = 1280, quality = 0.82): Promise<string> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return Promise.resolve(dataUrl);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) {
          resolve(dataUrl);
          return;
        }
        const scale = Math.min(1, maxDim / Math.max(w, h));
        const targetW = Math.max(1, Math.round(w * scale));
        const targetH = Math.max(1, Math.round(h * scale));

        // If image is already compact (< 320 KB base64) and within max dimension, keep original
        if (scale === 1 && dataUrl.length < 320 * 1024) {
          resolve(dataUrl);
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const compressed = canvas.toDataURL('image/jpeg', quality);
        resolve(compressed.length < dataUrl.length ? compressed : dataUrl);
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Sanitizes filename and validates MIME, file size (<= 5 MB), and binary magic bytes
 * before compressing large camera/gallery photos for safe ledger storage.
 */
export async function processImageAttachment(file: File): Promise<ProcessedAttachmentResult> {
  if (!file) {
    return { valid: false, error: 'No file selected.' };
  }

  const mimeCheck = validateReceiptUpload(file.type, file.size);
  if (!mimeCheck.valid) {
    return { valid: false, error: mimeCheck.error };
  }

  try {
    const rawDataUrl = await readFileAsDataUrl(file);
    const commaIdx = rawDataUrl.indexOf(',');
    const header = commaIdx > 0 ? rawDataUrl.slice(0, commaIdx) : '';
    const base64Body = commaIdx > 0 ? rawDataUrl.slice(commaIdx + 1) : '';
    const declaredMime = header.replace(/^data:/i, '').replace(/;base64$/i, '').toLowerCase() || file.type;

    const sigCheck = validateReceiptFileSignature(base64Body, declaredMime);
    if (!sigCheck.valid) {
      return { valid: false, error: sigCheck.error };
    }

    const optimizedDataUrl = await compressImageDataUrl(rawDataUrl);
    if (!isSafeAttachmentUrl(optimizedDataUrl)) {
      return { valid: false, error: 'Attachment failed safety verification.' };
    }

    // Ensure post-compression size stays reasonable for ledger persistence (< 1.2 MB encoded)
    if (optimizedDataUrl.length > 1.2 * 1024 * 1024) {
      const tightCompressed = await compressImageDataUrl(rawDataUrl, 960, 0.68);
      if (tightCompressed.length > 1.2 * 1024 * 1024) {
        return { valid: false, error: 'Image is too large even after compression. Please choose a smaller photo.' };
      }
      const cleanName = (file.name || 'receipt.jpg').replace(/[^\w.\- ()]/g, '_').slice(0, 80);
      return {
        valid: true,
        dataUrl: tightCompressed,
        fileName: cleanName,
        mimeType: 'image/jpeg',
        sizeBytes: Math.round((tightCompressed.length * 3) / 4),
      };
    }

    const cleanName = (file.name || 'receipt.jpg').replace(/[^\w.\- ()]/g, '_').slice(0, 80);
    return {
      valid: true,
      dataUrl: optimizedDataUrl,
      fileName: cleanName,
      mimeType: optimizedDataUrl.startsWith('data:image/jpeg') ? 'image/jpeg' : declaredMime,
      sizeBytes: Math.round((optimizedDataUrl.length * 3) / 4),
    };
  } catch (err: any) {
    return {
      valid: false,
      error: err?.message || 'Unable to process image attachment.',
    };
  }
}
