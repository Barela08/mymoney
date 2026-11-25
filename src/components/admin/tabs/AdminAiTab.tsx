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
  KeyRound,
  Sliders,
  CheckCircle2,
  Save,
  Shield,
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
  const [aiEnabled, setAiEnabled] = useState<boolean>(true);
  const [aiModel, setAiModel] = useState<string>('gemini-2.5-flash-lite');
  const [allowedModels, setAllowedModels] = useState<string[]>([
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-4-hydrogen',
  ]);
  const [integrationsConfig, setIntegrationsConfig] = useState<{
    senderName: string;
    siteUrl: string;
    supportEmail: string;
    supportPhone: string;
  }>({
    senderName: 'My Money Manager by HackifyPro',
    siteUrl: 'https://mymoney.nileshbarela.site',
    supportEmail: 'hackifyproofficial@gmail.com',
    supportPhone: '+91 9685989477',
  });
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  const fetchAiData = async () => {
    setIsLoading(true);
    try {
      const [aiRes, featRes, cfgRes] = await Promise.all([
        adminClient.getAiStatus(),
        adminClient.getFeatureFlags(),
        adminClient.getIntegrationsConfig().catch(() => null),
      ]);

      if (aiRes.success && Array.isArray(aiRes.modules)) {
        setModules(aiRes.modules);
        setIsGeminiConfigured(Boolean(aiRes.geminiConfigured));
        if (typeof aiRes.aiEnabled === 'boolean') setAiEnabled(aiRes.aiEnabled);
        if (typeof aiRes.activeModel === 'string' && aiRes.activeModel) setAiModel(aiRes.activeModel);
        if (Array.isArray(aiRes.allowedModels) && aiRes.allowedModels.length > 0) {
          setAllowedModels(aiRes.allowedModels);
        }
      }

      if (cfgRes?.success && cfgRes.config) {
        if (typeof cfgRes.config.aiEnabled === 'boolean') setAiEnabled(cfgRes.config.aiEnabled);
        if (typeof cfgRes.config.aiModel === 'string' && cfgRes.config.aiModel) setAiModel(cfgRes.config.aiModel);
        if (Array.isArray(cfgRes.config.allowedAiModels) && cfgRes.config.allowedAiModels.length > 0) {
          setAllowedModels(cfgRes.config.allowedAiModels);
        }
        setIntegrationsConfig({
          senderName: cfgRes.config.senderName || 'My Money Manager by HackifyPro',
          siteUrl: cfgRes.config.siteUrl || 'https://mymoney.nileshbarela.site',
          supportEmail: cfgRes.config.supportEmail || 'hackifyproofficial@gmail.com',
          supportPhone: cfgRes.config.supportPhone || '+91 9685989477',
        });
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

  const handleSaveAiConfig = async (nextEnabled: boolean = aiEnabled, nextModel: string = aiModel) => {
    setIsSavingConfig(true);
    try {
      const res = await adminClient.updateIntegrationsConfig({
        aiEnabled: nextEnabled,
        aiModel: nextModel,
        senderName: integrationsConfig.senderName,
        siteUrl: integrationsConfig.siteUrl,
        supportEmail: integrationsConfig.supportEmail,
        supportPhone: integrationsConfig.supportPhone,
      });
      if (res.success) {
        setAiEnabled(nextEnabled);
        setAiModel(nextModel);
        toast.success(
          'AI Engine Updated',
          `AI Assistant is ${nextEnabled ? 'active' : 'paused'} using ${nextModel}.`
        );
        await fetchAiData();
      }
    } catch (err: any) {
      toast.error('Save Failed', err.message || 'Could not update AI configuration.');
    } finally {
      setIsSavingConfig(false);
    }
  };

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
              <h2 className="text-base font-bold text-white flex items-center gap-2 flex-wrap">
                AI & Financial Intelligence Management
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                  isGeminiConfigured && aiEnabled
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : isGeminiConfigured && !aiEnabled
                    ? 'bg-slate-800 text-slate-300 border-slate-700'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}>
                  {isGeminiConfigured
                    ? aiEnabled
                      ? 'Gemini API Connected'
                      : 'AI Paused by Admin'
                    : 'Server GEMINI_API_KEY Needed'}
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                Centralized governance across My Money Manager's AI Assistant, Voice Agent, and 7 financial intelligence modules. Secrets stay strictly in server environment variables and are never stored in browser storage.
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

      {/* AI Engine & Model Control */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">AI Engine & Model Control</h3>
              <p className="text-xs text-slate-400">
                Select the active Gemini model and control live availability across Chat AI, Voice Agent, and Receipt OCR.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isSavingConfig}
            onClick={() => handleSaveAiConfig(!aiEnabled, aiModel)}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer disabled:opacity-50 ${
              aiEnabled
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            <span>{aiEnabled ? 'AI Engine: Active' : 'AI Engine: Paused'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
          <div className="lg:col-span-5">
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Active Gemini Model
            </label>
            <select
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {allowedModels.map((modelName) => (
                <option key={modelName} value={modelName}>
                  {modelName}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-4 flex items-center gap-2 h-10 px-3.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs">
            <KeyRound className={`w-4 h-4 shrink-0 ${isGeminiConfigured ? 'text-emerald-400' : 'text-amber-400'}`} />
            <div className="min-w-0">
              <span className="text-slate-400 block text-[10px] uppercase tracking-wider">Server API Key</span>
              <span className={`font-semibold flex items-center gap-1 ${isGeminiConfigured ? 'text-emerald-400' : 'text-amber-300'}`}>
                {isGeminiConfigured ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    GEMINI_API_KEY Active
                  </>
                ) : (
                  'GEMINI_API_KEY Not Set'
                )}
              </span>
            </div>
          </div>

          <div className="lg:col-span-3">
            <button
              type="button"
              disabled={isSavingConfig}
              onClick={() => handleSaveAiConfig(aiEnabled, aiModel)}
              className="w-full h-10 inline-flex items-center justify-center gap-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSavingConfig ? 'Saving...' : 'Save AI Settings'}</span>
            </button>
          </div>
        </div>

        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-300">
          <Shield className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <span className="font-semibold text-white">Security Policy:</span> Secret credentials like{' '}
            <code className="px-1.5 py-0.5 rounded bg-slate-800 text-emerald-300 font-mono text-[11px]">GEMINI_API_KEY</code>{' '}
            are never entered or exposed in browser forms. Set or rotate{' '}
            <code className="px-1.5 py-0.5 rounded bg-slate-800 text-emerald-300 font-mono text-[11px]">GEMINI_API_KEY</code>{' '}
            in <span className="font-semibold text-white">Settings &gt; Secrets</span> (or your Vercel project Environment Variables) and AI Chat, Voice Agent, and Receipt OCR activate automatically.
          </p>
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
                <span className={`flex items-center gap-1 font-medium ${mod.status === 'operational' ? 'text-emerald-400' : 'text-amber-400'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${mod.status === 'operational' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
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
