/**
 * My Money Manager — Notification Sound Engine (Web Audio API)
 * Synthesizes crisp, zero-asset notification chimes without relying on external MP3 files.
 */

let sharedAudioCtx: AudioContext | null = null;
let audioUnlocked = false;
let unlockListenersAttached = false;
let lastSoundPlayedAt = 0;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx) {
    try {
      sharedAudioCtx = new AudioCtx();
    } catch {
      return null;
    }
  }
  return sharedAudioCtx;
}

/**
 * Unlocks browser Web Audio API on the first user interaction so future alerts play cleanly.
 */
export function initNotificationAudioUnlock(): void {
  if (typeof window === 'undefined' || unlockListenersAttached) return;
  unlockListenersAttached = true;

  const unlock = () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        audioUnlocked = true;
      }).catch(() => {});
    } else {
      audioUnlocked = true;
    }
  };

  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
}

/**
 * Checks if current IST time falls within user's configured Quiet Hours window.
 */
export function isCurrentTimeInQuietHoursIST(
  startTime: string = '22:00',
  endTime: string = '07:00',
  nowDate: Date = new Date()
): boolean {
  try {
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(nowDate.getTime() + istOffset);
    const curTotalMin = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();

    const [startH, startM] = startTime.split(':').map((n) => parseInt(n, 10));
    const [endH, endM] = endTime.split(':').map((n) => parseInt(n, 10));
    if (!Number.isFinite(startH) || !Number.isFinite(endH)) return false;

    const startTotalMin = startH * 60 + (Number.isFinite(startM) ? startM : 0);
    const endTotalMin = endH * 60 + (Number.isFinite(endM) ? endM : 0);

    if (startTotalMin <= endTotalMin) {
      return curTotalMin >= startTotalMin && curTotalMin < endTotalMin;
    }
    return curTotalMin >= startTotalMin || curTotalMin < endTotalMin;
  } catch {
    return false;
  }
}

function scheduleTone(
  ctx: AudioContext,
  frequency: number,
  startOffsetSec: number,
  durationSec: number,
  peakGain: number,
  wave: OscillatorType = 'sine'
): void {
  const now = ctx.currentTime + startOffsetSec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = wave;
  osc.frequency.setValueAtTime(frequency, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + durationSec + 0.02);
}

/**
 * Plays an audible chime tailored to notification category/type.
 */
export async function playNotificationSound(
  category?: string,
  type?: string,
  options?: {
    soundEnabled?: boolean;
    quietHoursEnabled?: boolean;
    quietHoursStart?: string;
    quietHoursEnd?: string;
    force?: boolean;
  }
): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (options?.soundEnabled === false && !options?.force) return false;

  if (
    !options?.force &&
    options?.quietHoursEnabled &&
    category !== 'security' &&
    isCurrentTimeInQuietHoursIST(options.quietHoursStart, options.quietHoursEnd)
  ) {
    return false;
  }

  const nowMs = Date.now();
  if (!options?.force && nowMs - lastSoundPlayedAt < 900) {
    return false;
  }

  const ctx = getAudioContext();
  if (!ctx) return false;

  try {
    if (ctx.state === 'suspended') {
      await ctx.resume();
      audioUnlocked = true;
    }
    if (ctx.state !== 'running' && !audioUnlocked && !options?.force) {
      return false;
    }

    lastSoundPlayedAt = nowMs;

    const normalizedCat = (category || 'general').toLowerCase();
    const normalizedType = (type || 'info').toLowerCase();

    if (normalizedCat === 'security' || normalizedType === 'error' || normalizedType === 'warning') {
      // Alert double chime (distinct warm urgent tone)
      scheduleTone(ctx, 880, 0, 0.14, 0.18, 'triangle');
      scheduleTone(ctx, 698.46, 0.16, 0.18, 0.18, 'triangle');
      scheduleTone(ctx, 880, 0.36, 0.22, 0.16, 'triangle');
    } else if (
      normalizedType === 'success' ||
      normalizedCat === 'income' ||
      normalizedCat === 'settlement' ||
      normalizedCat === 'feedback'
    ) {
      // Bright uplifting 3-note chime (C5 -> E5 -> G5)
      scheduleTone(ctx, 523.25, 0, 0.13, 0.16, 'sine');
      scheduleTone(ctx, 659.25, 0.1, 0.15, 0.18, 'sine');
      scheduleTone(ctx, 783.99, 0.21, 0.26, 0.18, 'sine');
    } else {
      // Clean crisp 2-note chime (G5 -> C6)
      scheduleTone(ctx, 783.99, 0, 0.14, 0.16, 'sine');
      scheduleTone(ctx, 1046.5, 0.12, 0.26, 0.18, 'sine');
    }

    return true;
  } catch {
    return false;
  }
}
