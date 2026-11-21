import { getStoredSessionToken } from './authApi';

export type CalculatorMode = 'gst' | 'offer' | 'split' | 'basic';

export interface CalculatorSettings {
  last_mode: CalculatorMode;
  default_gst_percent: number;
  default_offer_percent: number;
  default_split_people: number;
}

export interface CalculationHistoryRecord {
  id: string;
  calc_type: CalculatorMode;
  title?: string;
  input_values: Record<string, any>;
  result_values: Record<string, any>;
  created_at: string;
}

const LOCAL_STORAGE_SETTINGS_KEY = 'my_money_calc_settings';
const LOCAL_STORAGE_HISTORY_KEY = 'my_money_calc_history_v2';

const DEFAULT_SETTINGS: CalculatorSettings = {
  last_mode: 'gst',
  default_gst_percent: 18,
  default_offer_percent: 10,
  default_split_people: 2,
};

function getAuthHeaders(): Record<string, string> {
  const token = getStoredSessionToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Fetch user calculator settings with offline fallback to localStorage
 */
export async function fetchCalculatorSettings(): Promise<CalculatorSettings> {
  // Try remote backend if user has session
  const token = getStoredSessionToken();
  if (token) {
    try {
      const res = await fetch('/api/calculator/settings', {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.settings) {
          localStorage.setItem(LOCAL_STORAGE_SETTINGS_KEY, JSON.stringify(data.settings));
          return data.settings;
        }
      }
    } catch (e) {
      console.warn('Notice fetching calculator settings from server:', e);
    }
  }

  // Fallback to local storage
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_SETTINGS_KEY);
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch {
    // Ignore JSON error
  }

  return DEFAULT_SETTINGS;
}

/**
 * Persist user calculator settings to backend and local storage
 */
export async function persistCalculatorSettings(
  settings: Partial<CalculatorSettings>
): Promise<CalculatorSettings> {
  const current = await fetchCalculatorSettings();
  const merged: CalculatorSettings = { ...current, ...settings };

  // Always update local cache
  try {
    localStorage.setItem(LOCAL_STORAGE_SETTINGS_KEY, JSON.stringify(merged));
  } catch {
    // ignore
  }

  // Update remote backend if authenticated
  const token = getStoredSessionToken();
  if (token) {
    try {
      await fetch('/api/calculator/settings', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(merged),
      });
    } catch (e) {
      console.warn('Notice saving calculator settings to server:', e);
    }
  }

  return merged;
}

/**
 * Fetch calculation history with offline fallback
 */
export async function fetchCalculationHistory(
  typeFilter?: CalculatorMode
): Promise<CalculationHistoryRecord[]> {
  const token = getStoredSessionToken();
  if (token) {
    try {
      const url = typeFilter
        ? `/api/calculator/history?type=${encodeURIComponent(typeFilter)}`
        : '/api/calculator/history';
      const res = await fetch(url, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.history)) {
          // Normalize input_values and result_values if returned as strings
          const records: CalculationHistoryRecord[] = data.history.map((r: any) => ({
            id: r.id,
            calc_type: r.calc_type,
            title: r.title,
            input_values: typeof r.input_values === 'string' ? JSON.parse(r.input_values) : r.input_values,
            result_values: typeof r.result_values === 'string' ? JSON.parse(r.result_values) : r.result_values,
            created_at: r.created_at,
          }));
          localStorage.setItem(LOCAL_STORAGE_HISTORY_KEY, JSON.stringify(records.slice(0, 50)));
          return records;
        }
      }
    } catch (e) {
      console.warn('Notice fetching calculation history from server:', e);
    }
  }

  // Fallback to local storage
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_HISTORY_KEY);
    if (saved) {
      const parsed: CalculationHistoryRecord[] = JSON.parse(saved);
      if (typeFilter) {
        return parsed.filter((r) => r.calc_type === typeFilter);
      }
      return parsed;
    }
  } catch {
    // ignore
  }

  return [];
}

/**
 * Save an intentional calculation result to history
 */
export async function recordCalculation(
  payload: Omit<CalculationHistoryRecord, 'id' | 'created_at'>
): Promise<CalculationHistoryRecord> {
  const localRecord: CalculationHistoryRecord = {
    ...payload,
    id: `calc-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    created_at: new Date().toISOString(),
  };

  // Prepend to local storage
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_HISTORY_KEY);
    const existing: CalculationHistoryRecord[] = saved ? JSON.parse(saved) : [];
    const updated = [localRecord, ...existing.slice(0, 49)];
    localStorage.setItem(LOCAL_STORAGE_HISTORY_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }

  // Save to remote backend if authenticated
  const token = getStoredSessionToken();
  if (token) {
    try {
      const res = await fetch('/api/calculator/history', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.record) {
          return {
            id: data.record.id,
            calc_type: data.record.calc_type,
            title: data.record.title,
            input_values: typeof data.record.input_values === 'string' ? JSON.parse(data.record.input_values) : data.record.input_values,
            result_values: typeof data.record.result_values === 'string' ? JSON.parse(data.record.result_values) : data.record.result_values,
            created_at: data.record.created_at,
          };
        }
      }
    } catch (e) {
      console.warn('Notice saving calculation to server:', e);
    }
  }

  return localRecord;
}

/**
 * Delete a specific record or clear all calculation history
 */
export async function clearCalculationHistory(recordId?: string): Promise<boolean> {
  // Update local storage
  try {
    if (recordId) {
      const saved = localStorage.getItem(LOCAL_STORAGE_HISTORY_KEY);
      if (saved) {
        const existing: CalculationHistoryRecord[] = JSON.parse(saved);
        const updated = existing.filter((r) => r.id !== recordId);
        localStorage.setItem(LOCAL_STORAGE_HISTORY_KEY, JSON.stringify(updated));
      }
    } else {
      localStorage.removeItem(LOCAL_STORAGE_HISTORY_KEY);
    }
  } catch {
    // ignore
  }

  // Sync with remote backend
  const token = getStoredSessionToken();
  if (token) {
    try {
      const url = recordId
        ? `/api/calculator/history?id=${encodeURIComponent(recordId)}`
        : '/api/calculator/history';
      await fetch(url, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
    } catch (e) {
      console.warn('Notice clearing calculation history on server:', e);
    }
  }

  return true;
}
