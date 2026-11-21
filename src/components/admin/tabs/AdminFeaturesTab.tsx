import React, { useState, useEffect } from 'react';
import {
  Sliders,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ToggleLeft,
  ToggleRight,
  Shield,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';

export const AdminFeaturesTab: React.FC = () => {
  const toast = useToast();
  const [features, setFeatures] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadFeatures = async () => {
    setIsLoading(true);
    try {
      const res = await adminClient.getFeatureFlags();
      if (res.success && Array.isArray(res.features)) {
        setFeatures(res.features);
      }
    } catch (err: any) {
      toast.error('Query Error', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadFeatures();
  }, []);

  const handleToggleFeature = async (feat: any) => {
    const nextState = !feat.is_enabled;
    setUpdatingId(feat.id);
    try {
      const res = await adminClient.updateFeatureFlag(feat.id, {
        is_enabled: nextState,
      });

      if (res.success) {
        toast.success(
          nextState ? 'Feature Enabled' : 'Feature Disabled',
          `${feat.name} is now ${nextState ? 'active' : 'disabled'}.`
        );
        await loadFeatures();
      } else {
        toast.error('Failed', res.message);
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRolloutChange = async (feat: any, newPct: number) => {
    try {
      await adminClient.updateFeatureFlag(feat.id, {
        rollout_percentage: newPct,
      });
      toast.info('Rollout Updated', `${feat.name} rollout set to ${newPct}%.`);
      await loadFeatures();
    } catch (err: any) {
      toast.error('Error', err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Sliders className="w-4 h-4 text-emerald-600" />
            <span>Feature Flags & Capability Availability</span>
          </h3>
          <p className="text-xs text-slate-400">
            Control module availability, gradual percentage rollouts, and instant emergency rollbacks
          </p>
        </div>

        <button
          onClick={loadFeatures}
          className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 transition-all cursor-pointer"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {features.map((f) => (
          <div
            key={f.id}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="font-mono text-[10px] text-slate-400 font-bold uppercase">{f.key}</span>
                <h4 className="font-bold text-base text-slate-800 dark:text-slate-200 mt-0.5">{f.name}</h4>
              </div>

              <button
                onClick={() => handleToggleFeature(f)}
                disabled={updatingId === f.id}
                className={`p-1.5 rounded-2xl transition-all cursor-pointer ${
                  f.is_enabled ? 'text-emerald-600' : 'text-slate-400'
                }`}
                title={f.is_enabled ? 'Disable Feature' : 'Enable Feature'}
              >
                {f.is_enabled ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
              </button>
            </div>

            <p className="text-xs text-slate-500">{f.description}</p>

            {/* Rollout slider */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-bold">
                <span className="text-slate-500">Rollout Percentage</span>
                <span className="text-emerald-600 font-mono">{f.rollout_percentage || 100}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={f.rollout_percentage || 100}
                onChange={(e) => handleRolloutChange(f, Number(e.target.value))}
                className="w-full accent-emerald-600 cursor-pointer"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
