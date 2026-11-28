/**
 * Real-time Application Performance & Security Telemetry Collector
 *
 * Tracks actual request volume, rolling 60-second RPS, response latency percentiles (p50/p95/p99),
 * HTTP 4xx/5xx error rates, slow DB query timings, rate-limit triggers, and upload security counts.
 */

const g = globalThis as any;

interface TelemetryBucket {
  latenciesMs: number[];
  requestTimestamps: number[];
  slowQueries: Array<{ label: string; durationMs: number; at: string }>;
  totalRequests: number;
  status2xx: number;
  status4xx: number;
  status5xx: number;
  rateLimitedCount: number;
  uploadSuccessCount: number;
  uploadRejectedCount: number;
  quarantineBlockedCount: number;
  activeUploadCount: number;
  peakUploadConcurrency: number;
}

if (!g.__mmTelemetryState) {
  g.__mmTelemetryState = {
    latenciesMs: [],
    requestTimestamps: [],
    slowQueries: [],
    totalRequests: 0,
    status2xx: 0,
    status4xx: 0,
    status5xx: 0,
    rateLimitedCount: 0,
    uploadSuccessCount: 0,
    uploadRejectedCount: 0,
    quarantineBlockedCount: 0,
    activeUploadCount: 0,
    peakUploadConcurrency: 0,
  } as TelemetryBucket;
}

const state: TelemetryBucket = g.__mmTelemetryState;

export function recordHttpRequestMetric(durationMs: number, statusCode: number): void {
  const now = Date.now();
  state.totalRequests += 1;
  state.requestTimestamps.push(now);
  // Keep only last 10,000 timestamps or last 60s
  if (state.requestTimestamps.length > 10000) {
    state.requestTimestamps.splice(0, state.requestTimestamps.length - 5000);
  }

  state.latenciesMs.push(Math.max(0, Math.round(durationMs)));
  if (state.latenciesMs.length > 2000) {
    state.latenciesMs.shift();
  }

  if (statusCode >= 500) state.status5xx += 1;
  else if (statusCode >= 400) state.status4xx += 1;
  else if (statusCode >= 200) state.status2xx += 1;
}

export function recordSlowQueryMetric(label: string, durationMs: number): void {
  if (durationMs < 150) return;
  state.slowQueries.unshift({
    label: String(label).slice(0, 120),
    durationMs: Math.round(durationMs),
    at: new Date().toISOString(),
  });
  if (state.slowQueries.length > 30) {
    state.slowQueries.length = 30;
  }
}

export function recordRateLimitEvent(): void {
  state.rateLimitedCount += 1;
}

export function recordUploadMetric(outcome: 'success' | 'rejected' | 'quarantined'): void {
  if (outcome === 'success') state.uploadSuccessCount += 1;
  else if (outcome === 'rejected') state.uploadRejectedCount += 1;
  else {
    state.uploadRejectedCount += 1;
    state.quarantineBlockedCount += 1;
  }
}

export function updateActiveUploadsDelta(delta: 1 | -1): void {
  state.activeUploadCount = Math.max(0, state.activeUploadCount + delta);
  if (state.activeUploadCount > state.peakUploadConcurrency) {
    state.peakUploadConcurrency = state.activeUploadCount;
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function getTelemetrySnapshot() {
  const now = Date.now();
  const cutoff60s = now - 60_000;
  // Prune old timestamps
  while (state.requestTimestamps.length > 0 && state.requestTimestamps[0] < cutoff60s) {
    state.requestTimestamps.shift();
  }
  const requestsLast60s = state.requestTimestamps.length;
  const currentRps = Number((requestsLast60s / 60).toFixed(2));

  const sortedLat = [...state.latenciesMs].sort((a, b) => a - b);
  const errorCount = state.status4xx + state.status5xx;
  const errorRatePct =
    state.totalRequests > 0 ? Number(((errorCount / state.totalRequests) * 100).toFixed(2)) : 0;
  const serverErrorRatePct =
    state.totalRequests > 0 ? Number(((state.status5xx / state.totalRequests) * 100).toFixed(2)) : 0;

  return {
    totalRequests: state.totalRequests,
    requestsLast60s,
    currentRps,
    statusCounts: {
      ok2xx: state.status2xx,
      client4xx: state.status4xx,
      server5xx: state.status5xx,
    },
    errorRatePct,
    serverErrorRatePct,
    latencyMs: {
      p50: percentile(sortedLat, 50),
      p95: percentile(sortedLat, 95),
      p99: percentile(sortedLat, 99),
      sampleCount: sortedLat.length,
    },
    slowQueries: state.slowQueries.slice(0, 10),
    rateLimitedCount: state.rateLimitedCount,
    uploads: {
      success: state.uploadSuccessCount,
      rejected: state.uploadRejectedCount,
      quarantineBlocked: state.quarantineBlockedCount,
      active: state.activeUploadCount,
      peakConcurrency: state.peakUploadConcurrency,
    },
  };
}
