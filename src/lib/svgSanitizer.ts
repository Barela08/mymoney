/**
 * Strict SVG & Image Upload Validator / Sanitizer.
 * Shared across frontend preview & server API persistence.
 * Never allows executable scripts, event handlers, foreignObject, or external URI references inside SVGs.
 */

export const MAX_SVG_BYTES = 512 * 1024; // 512 KB
export const MAX_RASTER_BYTES = 2 * 1024 * 1024; // 2 MB
export const ALLOWED_BRANDING_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

export interface SanitizedImageValidationResult {
  valid: boolean;
  mimeType?: string;
  sanitizedDataUrl?: string;
  sanitizedSvg?: string;
  byteSize?: number;
  width?: number;
  height?: number;
  error?: string;
}

const DISALLOWED_SVG_TAGS = [
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'applet',
  'meta',
  'link',
  'base',
  'animate',
  'animatemotion',
  'animatetransform',
  'set',
  'handler',
  'listener',
];

function decodeSvgBase64OrUtf8(raw: string): { isDataUrl: boolean; svgText: string } {
  const trimmed = String(raw || '').trim();
  const base64Prefix = /^data:image\/svg\+xml;base64,/i;
  if (base64Prefix.test(trimmed)) {
    const b64 = trimmed.replace(base64Prefix, '');
    if (typeof Buffer !== 'undefined') {
      return { isDataUrl: true, svgText: Buffer.from(b64, 'base64').toString('utf8') };
    }
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return { isDataUrl: true, svgText: new TextDecoder('utf-8').decode(bytes) };
  }

  const utf8Prefix = /^data:image\/svg\+xml[^,]*,/i;
  if (utf8Prefix.test(trimmed)) {
    const body = trimmed.replace(utf8Prefix, '');
    try {
      return { isDataUrl: true, svgText: decodeURIComponent(body) };
    } catch {
      return { isDataUrl: true, svgText: body };
    }
  }

  return { isDataUrl: false, svgText: trimmed };
}

function encodeUtf8ToBase64(text: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(text, 'utf8').toString('base64');
  }
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

/**
 * Inspects, validates, and sanitizes raw SVG markup.
 * Rejects actively malicious payloads (e.g. `<script>`, `javascript:` URIs, event handlers, `<foreignObject>`)
 * and removes unsafe comments/entities while verifying well-formed `<svg ...>...</svg>` root structure.
 */
export function validateAndSanitizeSvg(rawInput: string): SanitizedImageValidationResult {
  const { svgText } = decodeSvgBase64OrUtf8(rawInput);
  const cleanedRaw = svgText.replace(/^\uFEFF/, '').trim();

  if (!cleanedRaw) {
    return { valid: false, error: 'SVG content is empty.' };
  }

  const byteSize =
    typeof Buffer !== 'undefined'
      ? Buffer.byteLength(cleanedRaw, 'utf8')
      : new TextEncoder().encode(cleanedRaw).byteLength;

  if (byteSize > MAX_SVG_BYTES) {
    return { valid: false, error: 'SVG file exceeds maximum allowed size (512 KB).' };
  }

  // Strip XML declaration, DOCTYPE, and comments first so hidden payloads cannot slip through
  const stripped = cleanedRaw
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!ENTITY[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();

  if (!/^<svg[\s>]/i.test(stripped) || !/<\/svg>\s*$/i.test(stripped)) {
    return { valid: false, error: 'Invalid SVG markup: root <svg> element is required.' };
  }

  // Block dangerous elements outright
  for (const tag of DISALLOWED_SVG_TAGS) {
    const tagRe = new RegExp(`<\\s*\\/?\\s*(?:[a-z0-9_-]+:)?${tag}\\b`, 'i');
    if (tagRe.test(stripped)) {
      return {
        valid: false,
        error: `SVG rejected for security: disallowed <${tag}> element detected.`,
      };
    }
  }

  // Block inline event handlers (onload=, onclick=, onerror=, etc.)
  if (/[\s\/]on[a-z0-9_-]+\s*=/i.test(stripped)) {
    return {
      valid: false,
      error: 'SVG rejected for security: inline event handler attributes (on*) are not allowed.',
    };
  }

  // Block executable URI schemes anywhere in attributes or CSS
  if (/(?:javascript|vbscript)\s*:|data\s*:\s*(?:text\/html|application\/|text\/javascript)/i.test(stripped)) {
    return {
      valid: false,
      error: 'SVG rejected for security: executable javascript:/data: URI scheme detected.',
    };
  }

  // Block external resource fetching inside SVG (<use href="https://...">, <image xlink:href="...">, @import, CSS url(http...))
  if (/@import\b|expression\s*\(|url\s*\(\s*['"]?\s*(?:https?:|\/\/)/i.test(stripped)) {
    return {
      valid: false,
      error: 'SVG rejected for security: external stylesheet/URL references inside SVG are blocked.',
    };
  }
  if (/(?:href|xlink:href|src)\s*=\s*['"]\s*(?:https?:|\/\/)/i.test(stripped)) {
    return {
      valid: false,
      error: 'SVG rejected for security: external href/src attributes inside SVG are blocked.',
    };
  }

  // Also strip any <style> tags that contain suspicious constructs; keep benign fill/stroke styles only
  const safeStyleStripped = stripped.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_match, css) => {
    const cleanCss = String(css || '');
    if (/url\s*\(|@import|expression|behavior|-moz-binding|javascript/i.test(cleanCss)) {
      return '';
    }
    return `<style>${cleanCss}</style>`;
  });

  // Extract optional width / height / viewBox dimensions
  let width: number | undefined;
  let height: number | undefined;
  const openTagMatch = safeStyleStripped.match(/^<svg\b([^>]*)>/i);
  if (openTagMatch) {
    const attrs = openTagMatch[1] || '';
    const wMatch = attrs.match(/\bwidth\s*=\s*['"](\d+(?:\.\d+)?)(?:px)?['"]/i);
    const hMatch = attrs.match(/\bheight\s*=\s*['"](\d+(?:\.\d+)?)(?:px)?['"]/i);
    if (wMatch) width = Math.round(Number(wMatch[1]));
    if (hMatch) height = Math.round(Number(hMatch[1]));
    if ((!width || !height)) {
      const vbMatch = attrs.match(/\bviewBox\s*=\s*['"]\s*[-\d.]+\s+[-\d.]+\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*['"]/i);
      if (vbMatch) {
        width = width || Math.round(Number(vbMatch[1]));
        height = height || Math.round(Number(vbMatch[2]));
      }
    }
  }

  const finalSvg = safeStyleStripped.trim();
  const base64 = encodeUtf8ToBase64(finalSvg);

  return {
    valid: true,
    mimeType: 'image/svg+xml',
    sanitizedSvg: finalSvg,
    sanitizedDataUrl: `data:image/svg+xml;base64,${base64}`,
    byteSize:
      typeof Buffer !== 'undefined'
        ? Buffer.byteLength(finalSvg, 'utf8')
        : new TextEncoder().encode(finalSvg).byteLength,
    width: width || 256,
    height: height || 256,
  };
}

/**
 * Validates either a raster image data URL (PNG/JPEG/WebP/GIF), an SVG data URL / raw SVG,
 * or a safe local relative asset path (`/logo.jpg`, `/api/branding/assets/...`).
 */
export function validateBrandingImageInput(
  rawDataOrUrl: string,
  options?: { width?: number; height?: number }
): SanitizedImageValidationResult {
  const input = String(rawDataOrUrl || '').trim();
  if (!input) {
    return { valid: false, error: 'Image payload is required.' };
  }

  if (input.startsWith('/') && !input.startsWith('//')) {
    if (/^\/[a-zA-Z0-9._\-\/?=&]+$/.test(input)) {
      return {
        valid: true,
        mimeType: input.endsWith('.svg') ? 'image/svg+xml' : 'image/png',
        sanitizedDataUrl: input,
        width: options?.width,
        height: options?.height,
      };
    }
    return { valid: false, error: 'Invalid relative asset URL.' };
  }

  if (/^data:image\/svg\+xml/i.test(input) || /^<\?xml/i.test(input) || /^<svg[\s>]/i.test(input)) {
    return validateAndSanitizeSvg(input);
  }

  const rasterMatch = input.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i);
  if (!rasterMatch) {
    return {
      valid: false,
      error: 'Unsupported format. Please upload PNG, JPG/JPEG, WebP, GIF, or sanitized SVG.',
    };
  }

  const mime = rasterMatch[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : rasterMatch[1].toLowerCase();
  const b64 = rasterMatch[2];
  const approxBytes = Math.floor((b64.length * 3) / 4);

  if (approxBytes > MAX_RASTER_BYTES) {
    return { valid: false, error: 'Image file size must be 2 MB or smaller.' };
  }

  if (options?.width && (options.width < 16 || options.width > 4096)) {
    return { valid: false, error: 'Image width must be between 16px and 4096px.' };
  }
  if (options?.height && (options.height < 16 || options.height > 4096)) {
    return { valid: false, error: 'Image height must be between 16px and 4096px.' };
  }

  return {
    valid: true,
    mimeType: mime,
    sanitizedDataUrl: `data:${mime};base64,${b64}`,
    byteSize: approxBytes,
    width: options?.width,
    height: options?.height,
  };
}

export function sanitizeHexColor(input: unknown, fallback: string): string {
  const val = String(input || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(val)) return val.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(val)) {
    const r = val[1];
    const g = val[2];
    const b = val[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}
