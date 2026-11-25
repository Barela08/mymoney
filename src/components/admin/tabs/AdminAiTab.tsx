import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Bot,
  Calendar,
  AlertTriangle,
  ScanText,
  PieChart,
  RefreshCw,
  Power,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';

interface AiModuleInfo {
  key: string;
  name: string;
  status: string;
  provider: string;
  requests24h: number;
  avgLatencyMs: number;
  errorRate: number;
}

export const AdminAiTab: React.FC = () => {
  const toast = useToast();
  const [modules, setModules] = useState<AiModuleInfo[]>([]);
  const [featureFlags, setFeatureFlags] = useState<any[]>([]);
  const [isGeminiConfigured, setIsGeminiConfigured] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  const fetchAiData = async () => {
    setIsLoading(true);
    try {
      const [aiRes, featRes] = await Promise.all([
        adminClient.getAiStatus(),
        adminClient.getFeatureFlags(),
      ]);

      if (aiRes.success && Array.isArray(aiRes.modules)) {
        setModules(aiRes.modules);
        setIsGeminiConfigured(aiRes.geminiConfigured);
      }

      if (featRes.success && Array.isArray(featRes.features)) {
        setFeatureFlags(featRes.features);
      }
    } catch (err: any) {
      toast.error('Failed to load AI management status', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAiData();
  }, []);

  const handleToggleFeature = async (featureKey: string, currentEnabled: boolean) => {
    setTogglingKey(featureKey);
    try {
      const matchingFlag = featureFlags.find((f) => f.key === featureKey);
      if (!matchingFlag) {
        toast.error('Error', 'Feature flag record not found.');
        return;
      }

      const res = await adminClient.updateFeatureFlag(matchingFlag.id, {
        is_enabled: !currentEnabled,
      });

      if (res.success) {
        toast.success('Feature Updated', `${matchingFlag.name} is now ${!currentEnabled ? 'enabled' : 'disabled'}.`);
        fetchAiData();
      }
    } catch (err: any) {
      toast.error('Toggle Failed', err.message);
    } finally {
      setTogglingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 shrink-0">
              <Bot className="w-5 h-5 stroke-[1.75]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                AI & Financial Intelligence Management
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                  isGeminiConfigured
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}>
                  {isGeminiConfigured ? 'Gemini API Connected' : 'Local Fallback Engine'}
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                Centralized telemetry and governance across the 7 financial intelligence modules. API credentials are encrypted server-side; customer financial queries are never logged without explicit purpose-limited grants.
              </p>
            </div>
          </div>
          <button
            onClick={fetchAiData}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-purple-400' : ''}`} />
            <span>Refresh AI Health</span>
          </button>
        </div>
      </div>

      {/* 7 AI Financial Intelligence Modules Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {modules.map((mod) => {
          const matchingFlag = featureFlags.find((f) => f.key === mod.key);
          const isEnabled = matchingFlag ? matchingFlag.is_enabled : true;

          return (
            <div
              key={mod.key}
              className={`p-5 rounded-2xl border transition-all ${
                isEnabled
                  ? 'bg-slate-900 border-slate-800 hover:border-slate-700'
                  : 'bg-slate-950/60 border-slate-800/60 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    {mod.key.includes('ocr') ? (
                      <ScanText className="w-4 h-4" />
                    ) : mod.key.includes('calendar') ? (
                      <Calendar className="w-4 h-4" />
                    ) : mod.key.includes('alert') ? (
                      <AlertTriangle className="w-4 h-4" />
                    ) : mod.key.includes('net_worth') ? (
                      <PieChart className="w-4 h-4" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">{mod.name}</h3>
                    <p className="text-[11px] text-slate-400 font-mono">{mod.provider}</p>
                  </div>
                </div>

                {matchingFlag && (
                  <button
                    onClick={() => handleToggleFeature(mod.key, isEnabled)}
                    disabled={togglingKey === mod.key}
                    className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                      isEnabled
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                        : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-white'
                    }`}
                    title={isEnabled ? 'Click to Disable Feature' : 'Click to Enable Feature'}
                  >
                    <Power className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Metrics */}
              <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-slate-800/80 text-center">
                <div>
                  <span className="text-[10px] text-slate-500 block uppercase">24h Invocations</span>
                  <span className="text-xs font-mono font-bold text-white mt-0.5 block">{mod.requests24h}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block uppercase">Avg Latency</span>
                  <span className="text-xs font-mono font-bold text-emerald-400 mt-0.5 block">{mod.avgLatencyMs}ms</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block uppercase">Error Rate</span>
                  <span className="text-xs font-mono font-bold text-slate-300 mt-0.5 block">{mod.errorRate}%</span>
                </div>
              </div>

              {/* Status footer */}
              <div className="flex items-center justify-between text-[11px] text-slate-500 mt-3 pt-2 border-t border-slate-800/40">
                <span className="flex items-center gap-1 text-emerald-400 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {mod.status}
                </span>
                <span>Rollout: {matchingFlag?.rollout_percentage || 100}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
