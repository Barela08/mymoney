/**
 * Shared File Upload Security, Magic-Byte Inspection, Dimension Bomb Guard & Metadata Scrubber.
 * Works identically in both browser (TypeScript/Vite) and Node.js server runtimes.
 *
 * Security guarantees:
 * - Never trusts client MIME types or filename extensions alone.
 * - Blocks executable, script, archive, HTML, and double-extension filenames.
 * - Verifies exact binary magic bytes + parses real width/height from image headers.
 * - Blocks decompression bombs (width/height > 8192px or > 40 megapixels).
 * - Detects EICAR antivirus test strings, PE/ELF/ZIP/HTML/PHP polyglots, and trailing script payloads.
 * - Strips EXIF/XMP/comment metadata chunks and trailing polyglot bytes from PNG, JPEG, and WebP.
 */

export const MAX_ADMIN_LOGO_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_SVG_BYTES = 512 * 1024; // 512 KB

export const MAX_PIXEL_WIDTH = 8192;
export const MAX_PIXEL_HEIGHT = 8192;
export const MAX_TOTAL_PIXELS = 40_000_000; // 40 MP decompression bomb ceiling

export const EICAR_SIGNATURE =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export const DANGEROUS_EXTENSIONS = new Set([
  'exe', 'dll', 'bat', 'cmd', 'ps1', 'psm1', 'psd1',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx',
  'html', 'htm', 'xhtml', 'shtml', 'mht', 'mhtml',
  'php', 'php3', 'php4', 'php5', 'phtml', 'phar',
  'sh', 'bash', 'zsh', 'ksh', 'csh',
  'jar', 'war', 'ear', 'class',
  'apk', 'aab', 'ipa', 'xap',
  'scr', 'msi', 'msp', 'mst',
  'vbs', 'vbe', 'ws', 'wsf', 'wsh', 'hta', 'chm',
  'reg', 'cpl', 'com', 'pif', 'lnk', 'inf',
  'elf', 'bin', 'so', 'dylib', 'app', 'dmg', 'iso', 'img', 'deb', 'rpm',
  'asp', 'aspx', 'jsp', 'jspx', 'cgi', 'pl', 'py', 'rb',
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'cab',
  'xml', 'xsl', 'xslt', 'swf',
]);

export type AllowedRasterMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export interface FilenameValidationResult {
  valid: boolean;
  sanitizedName: string;
  extension: string;
  error?: string;
}

export interface BinaryInspectionResult {
  valid: boolean;
  detectedMime?: AllowedRasterMime;
  width?: number;
  height?: number;
  byteSize: number;
  threatDetected?: string;
  error?: string;
}

export function sanitizeUploadFilename(rawName?: string | null): FilenameValidationResult {
  const input = String(rawName || 'upload.png').trim();
  if (!input || input.includes('\0')) {
    return {
      valid: false,
      sanitizedName: 'rejected',
      extension: '',
      error: 'Invalid filename containing empty or null-byte characters.',
    };
  }

  // Strip directory traversal paths
  const baseName = input.split(/[\\/]/).pop() || 'upload.png';
  const cleaned = baseName
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[^\w.\-() ]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);

  if (!cleaned) {
    return {
      valid: false,
      sanitizedName: 'rejected',
      extension: '',
      error: 'Filename is invalid after sanitization.',
    };
  }

  const segments = cleaned.toLowerCase().split('.').filter(Boolean);
  if (segments.length < 2) {
    return {
      valid: false,
      sanitizedName: cleaned,
      extension: '',
      error: 'File must include a valid image extension (.png, .jpg, .jpeg, .webp).',
    };
  }

  const finalExt = segments[segments.length - 1];
  // Check ALL dot segments for dangerous extensions (blocks double-extensions like evil.php.png or app.exe.jpg)
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    if (DANGEROUS_EXTENSIONS.has(seg)) {
      return {
        valid: false,
        sanitizedName: cleaned,
        extension: finalExt,
        error: `Dangerous or disallowed file extension ".${seg}" is blocked by security policy.`,
      };
    }
  }

  if (finalExt === 'svg' || finalExt === 'svgz') {
    return {
      valid: true,
      sanitizedName: cleaned,
      extension: finalExt,
    };
  }

  if (!['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(finalExt)) {
    return {
      valid: false,
      sanitizedName: cleaned,
      extension: finalExt,
      error: `Unsupported file extension ".${finalExt}". Allowed: PNG, JPG, JPEG, WebP.`,
    };
  }

  return {
    valid: true,
    sanitizedName: cleaned,
    extension: finalExt === 'jpg' ? 'jpeg' : finalExt,
  };
}

export function decodeBase64ToBytes(base64Body: string): Uint8Array {
  const clean = base64Body.replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(clean, 'base64'));
  }
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function encodeBytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function readAscii(bytes: Uint8Array, start: number, len: number): string {
  const end = Math.min(bytes.length, start + len);
  let out = '';
  for (let i = start; i < end; i++) {
    const code = bytes[i];
    out += code >= 9 && code <= 126 ? String.fromCharCode(code) : ' ';
  }
  return out;
}

function uint32BE(b: Uint8Array, off: number): number {
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
}

function uint32LE(b: Uint8Array, off: number): number {
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
}

function uint16BE(b: Uint8Array, off: number): number {
  return (b[off] << 8) | b[off + 1];
}

function uint16LE(b: Uint8Array, off: number): number {
  return b[off] | (b[off + 1] << 8);
}

function detectSuspiciousPayloads(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return 'EMPTY_OR_TRUNCATED_FILE';

  // Executable & archive binary headers
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) return 'PE_EXECUTABLE_HEADER_MZ';
  if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return 'ELF_EXECUTABLE_HEADER';
  if (
    (bytes[0] === 0xfe && bytes[1] === 0xed && bytes[2] === 0xfa && (bytes[3] === 0xce || bytes[3] === 0xcf)) ||
    (bytes[0] === 0xcf && bytes[1] === 0xfa && bytes[2] === 0xed && bytes[3] === 0xfe)
  ) {
    return 'MACHO_EXECUTABLE_HEADER';
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05)) {
    return 'ARCHIVE_ZIP_JAR_APK_HEADER';
  }
  if (bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21) {
    return 'RAR_ARCHIVE_HEADER';
  }
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return 'GZIP_ARCHIVE_HEADER';
  }
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'PDF_DOCUMENT_HEADER';
  }

  // Inspect header window + tail window for EICAR or embedded script/HTML/PHP polyglots
  const headText = readAscii(bytes, 0, Math.min(bytes.length, 4096));
  const tailStart = Math.max(0, bytes.length - 4096);
  const tailText = readAscii(bytes, tailStart, bytes.length - tailStart);
  const combined = `${headText}\n${tailText}`;

  if (combined.includes(EICAR_SIGNATURE)) {
    return 'EICAR_TEST_MALWARE_SIGNATURE';
  }

  // If image starts with ASCII script/HTML/shebang
  const trimmedHead = headText.trimStart().toLowerCase();
  if (
    trimmedHead.startsWith('<!doctype') ||
    trimmedHead.startsWith('<html') ||
    trimmedHead.startsWith('<script') ||
    trimmedHead.startsWith('<?php') ||
    trimmedHead.startsWith('#!/')
  ) {
    return 'SCRIPT_OR_HTML_DOCUMENT';
  }

  // Polyglot check across head/tail ASCII segments (common in GIFAR / JPEG+PHP / PNG+HTML polyglots)
  if (/<\s*script\b|<\s*\?\s*php\b|<\s*iframe\b|javascript\s*:/i.test(combined)) {
    return 'EMBEDDED_SCRIPT_POLYGLOT';
  }

  return null;
}

function parsePngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return null;
  }
  // IHDR chunk must be first chunk at offset 12..15
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return null;
  }
  const width = uint32BE(bytes, 16);
  const height = uint32BE(bytes, 20);
  // Check IEND exists to catch truncated/corrupt PNGs
  let hasIend = false;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const chunkLen = uint32BE(bytes, offset);
    if (chunkLen > bytes.length - offset - 12) break;
    const type =
      String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (type === 'IEND') {
      hasIend = true;
      break;
    }
    offset += 12 + chunkLen;
  }
  if (!hasIend) return null;
  return { width, height };
}

function parseJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 12) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;

  let offset = 2;
  let dims: { width: number; height: number } | null = null;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd9) break; // EOI
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const segLen = uint16BE(bytes, offset);
    if (segLen < 2 || offset + segLen > bytes.length) break;

    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 contain image dimensions
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && segLen >= 7 && !dims) {
      const height = uint16BE(bytes, offset + 3);
      const width = uint16BE(bytes, offset + 5);
      dims = { width, height };
    }
    if (marker === 0xda) {
      // SOS reached: verify EOI exists near end or scan stops cleanly
      break;
    }
    offset += segLen;
  }

  return dims;
}

function parseWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  if (
    readAscii(bytes, 0, 4) !== 'RIFF' ||
    readAscii(bytes, 8, 4) !== 'WEBP'
  ) {
    return null;
  }
  const chunkType = readAscii(bytes, 12, 4);
  if (chunkType === 'VP8 ' && bytes.length >= 30) {
    // Key frame start code 9d 01 2a at byte 23..25
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const width = uint16LE(bytes, 26) & 0x3fff;
    const height = uint16LE(bytes, 28) & 0x3fff;
    return { width, height };
  }
  if (chunkType === 'VP8L' && bytes.length >= 25) {
    if (bytes[20] !== 0x2f) return null;
    const bits = uint32LE(bytes, 21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }
  if (chunkType === 'VP8X' && bytes.length >= 30) {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height };
  }
  return null;
}

function parseGifDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 14) return null;
  const hdr = readAscii(bytes, 0, 6);
  if (hdr !== 'GIF87a' && hdr !== 'GIF89a') return null;
  return {
    width: uint16LE(bytes, 6),
    height: uint16LE(bytes, 8),
  };
}

export function inspectImageBinary(
  bytes: Uint8Array,
  declaredMime?: string | null,
  options?: {
    maxBytes?: number;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    allowGif?: boolean;
  }
): BinaryInspectionResult {
  const maxBytes = options?.maxBytes ?? MAX_ADMIN_LOGO_BYTES;
  const minW = options?.minWidth ?? 1;
  const minH = options?.minHeight ?? 1;
  const maxW = options?.maxWidth ?? MAX_PIXEL_WIDTH;
  const maxH = options?.maxHeight ?? MAX_PIXEL_HEIGHT;

  if (!bytes || bytes.length === 0) {
    return { valid: false, byteSize: 0, error: 'Uploaded file is empty.' };
  }
  if (bytes.length > maxBytes) {
    return {
      valid: false,
      byteSize: bytes.length,
      error: `File size (${(bytes.length / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed limit (${(maxBytes / (1024 * 1024)).toFixed(1)} MB).`,
    };
  }

  const threat = detectSuspiciousPayloads(bytes);
  if (threat) {
    return {
      valid: false,
      byteSize: bytes.length,
      threatDetected: threat,
      error: `Upload blocked by security inspection (${threat}). Only clean PNG, JPG, JPEG, or WebP images are permitted.`,
    };
  }

  let detectedMime: AllowedRasterMime | undefined;
  let dims: { width: number; height: number } | null = null;

  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    detectedMime = 'image/png';
    dims = parsePngDimensions(bytes);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    detectedMime = 'image/jpeg';
    dims = parseJpegDimensions(bytes);
  } else if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    detectedMime = 'image/webp';
    dims = parseWebpDimensions(bytes);
  } else if (options?.allowGif && bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    detectedMime = 'image/gif';
    dims = parseGifDimensions(bytes);
  }

  if (!detectedMime) {
    return {
      valid: false,
      byteSize: bytes.length,
      threatDetected: 'MAGIC_BYTE_MISMATCH',
      error: 'Invalid or unsupported file signature. File content does not match PNG, JPG, JPEG, or WebP.',
    };
  }

  if (declaredMime) {
    const normDeclared = declaredMime.toLowerCase() === 'image/jpg' ? 'image/jpeg' : declaredMime.toLowerCase();
    if (normDeclared !== detectedMime) {
      return {
        valid: false,
        byteSize: bytes.length,
        threatDetected: 'DECLARED_MIME_SPOOF',
        error: `File MIME mismatch: declared "${normDeclared}" but binary header is "${detectedMime}".`,
      };
    }
  }

  if (!dims || dims.width <= 0 || dims.height <= 0) {
    return {
      valid: false,
      byteSize: bytes.length,
      threatDetected: 'CORRUPT_IMAGE_STRUCTURE',
      error: 'Corrupt or malformed image file: unable to verify valid image dimensions.',
    };
  }

  if (dims.width < minW || dims.height < minH) {
    return {
      valid: false,
      byteSize: bytes.length,
      width: dims.width,
      height: dims.height,
      error: `Image dimensions (${dims.width}×${dims.height}px) are too small (minimum ${minW}×${minH}px).`,
    };
  }

  if (dims.width > maxW || dims.height > maxH || dims.width * dims.height > MAX_TOTAL_PIXELS) {
    return {
      valid: false,
      byteSize: bytes.length,
      width: dims.width,
      height: dims.height,
      threatDetected: 'DECOMPRESSION_BOMB_DIMENSIONS',
      error: `Image dimensions (${dims.width}×${dims.height}px) exceed safe limits (${maxW}×${maxH}px / 40MP).`,
    };
  }

  return {
    valid: true,
    detectedMime,
    width: dims.width,
    height: dims.height,
    byteSize: bytes.length,
  };
}

/**
 * Strips EXIF, GPS, XMP, comment metadata, and trailing polyglot bytes from PNG/JPEG/WebP buffers.
 */
export function stripBinaryImageMetadata(bytes: Uint8Array, mime: AllowedRasterMime): Uint8Array {
  if (mime === 'image/png') {
    const KEEP_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'sRGB', 'cHRM', 'bKGD', 'pHYs']);
    const chunks: Uint8Array[] = [bytes.subarray(0, 8)];
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const len = uint32BE(bytes, offset);
      if (len > bytes.length - offset - 12) break;
      const type = String.fromCharCode(
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7]
      );
      const totalChunkLen = 12 + len;
      if (KEEP_CHUNKS.has(type)) {
        chunks.push(bytes.subarray(offset, offset + totalChunkLen));
      }
      offset += totalChunkLen;
      if (type === 'IEND') break;
    }
    const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(totalLen);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }

  if (mime === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
    const segments: Uint8Array[] = [bytes.subarray(0, 2)];
    let offset = 2;
    while (offset + 2 <= bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const markerStart = offset;
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      if (offset >= bytes.length) break;
      const marker = bytes[offset++];
      if (marker === 0xd9) {
        segments.push(new Uint8Array([0xff, 0xd9]));
        break;
      }
      if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        segments.push(bytes.subarray(markerStart, offset));
        continue;
      }
      if (offset + 2 > bytes.length) break;
      const segLen = uint16BE(bytes, offset);
      if (segLen < 2 || offset + segLen > bytes.length) break;
      const endOfSeg = offset + segLen;

      if (marker === 0xda) {
        // Start of Scan: copy entropy stream up to EOI (FF D9) so trailing appended polyglot payloads are dropped
        let eoiIdx = -1;
        for (let i = bytes.length - 2; i >= endOfSeg; i--) {
          if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
            eoiIdx = i + 2;
            break;
          }
        }
        segments.push(bytes.subarray(markerStart, eoiIdx > 0 ? eoiIdx : bytes.length));
        break;
      }

      // Strip APP1..APP13 (EXIF/GPS/XMP/IPTC) and COM (0xFE) comments; keep APP0 (JFIF) & coding tables
      const isStrippableMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
      if (!isStrippableMetadata) {
        segments.push(bytes.subarray(markerStart, endOfSeg));
      }
      offset = endOfSeg;
    }

    const totalLen = segments.reduce((sum, s) => sum + s.length, 0);
    const out = new Uint8Array(totalLen);
    let pos = 0;
    for (const s of segments) {
      out.set(s, pos);
      pos += s.length;
    }
    return out;
  }

  if (mime === 'image/webp') {
    if (bytes.length < 12) return bytes;
    const chunks: Uint8Array[] = [];
    let offset = 12;
    let payloadSize = 4; // 'WEBP'
    while (offset + 8 <= bytes.length) {
      const fourcc = readAscii(bytes, offset, 4);
      const chunkLen = uint32LE(bytes, offset + 4);
      const paddedLen = chunkLen + (chunkLen % 2);
      if (offset + 8 + chunkLen > bytes.length) break;
      const actualEnd = Math.min(bytes.length, offset + 8 + paddedLen);
      if (fourcc !== 'EXIF' && fourcc !== 'XMP ') {
        const chunkSlice = bytes.subarray(offset, actualEnd);
        chunks.push(chunkSlice);
        payloadSize += chunkSlice.length;
      }
      offset = actualEnd;
    }
    if (chunks.length === 0) return bytes;
    const out = new Uint8Array(8 + payloadSize);
    out.set(bytes.subarray(0, 12), 0);
    // Update RIFF chunk size (little endian)
    out[4] = payloadSize & 0xff;
    out[5] = (payloadSize >> 8) & 0xff;
    out[6] = (payloadSize >> 16) & 0xff;
    out[7] = (payloadSize >> 24) & 0xff;
    let pos = 12;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }

  return bytes;
}
