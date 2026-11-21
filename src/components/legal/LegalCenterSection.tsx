import React, { useState, useMemo } from 'react';
import {
  ShieldCheck,
  FileText,
  Lock,
  Building,
  Search,
  Calendar,
  ArrowRight,
  ExternalLink,
  ChevronRight,
  CheckCircle2,
  Printer,
  Copy,
  Check,
  Scale,
  HelpCircle,
  Users,
  Smartphone,
  Eye,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { LEGAL_POLICIES, LegalPolicyItem } from '../../data/legalPolicies';
import { useToast } from '../../context/ToastContext';

interface LegalCenterSectionProps {
  initialPolicyId?: string;
  onNavigateToAccountDeletion?: () => void;
}

export const LegalCenterSection: React.FC<LegalCenterSectionProps> = ({
  initialPolicyId = 'privacy_policy',
  onNavigateToAccountDeletion,
}) => {
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>(initialPolicyId);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'privacy' | 'security' | 'legal' | 'company'>('all');
  const [isCopied, setIsCopied] = useState(false);
  const toast = useToast();

  // Filter policies based on category and search
  const filteredPolicies = useMemo(() => {
    return LEGAL_POLICIES.filter((p) => {
      if (selectedCategory !== 'all' && p.category !== selectedCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesTitle = p.title.toLowerCase().includes(q);
        const matchesSummary = p.summary.toLowerCase().includes(q);
        const matchesContent = p.sections.some(
          (s) => s.title.toLowerCase().includes(q) || s.content.some((c) => c.toLowerCase().includes(q))
        );
        return matchesTitle || matchesSummary || matchesContent;
      }
      return true;
    });
  }, [selectedCategory, searchQuery]);

  const activePolicy = useMemo(() => {
    return LEGAL_POLICIES.find((p) => p.id === selectedPolicyId) || LEGAL_POLICIES[0];
  }, [selectedPolicyId]);

  const handleCopyLink = () => {
    const url = `${window.location.origin}/#legal=${activePolicy.id}`;
    navigator.clipboard.writeText(url);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
    toast.success('Link Copied', `Direct link to ${activePolicy.shortTitle} copied to clipboard.`);
  };

  const handlePrint = () => {
    window.print();
  };

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'privacy':
        return <ShieldCheck className="w-4 h-4 text-emerald-500" />;
      case 'security':
        return <Lock className="w-4 h-4 text-indigo-500" />;
      case 'legal':
        return <Scale className="w-4 h-4 text-amber-500" />;
      case 'company':
      default:
        return <Building className="w-4 h-4 text-blue-500" />;
    }
  };

  const getCategoryBadge = (cat: string) => {
    switch (cat) {
      case 'privacy':
        return 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
      case 'security':
        return 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800';
      case 'legal':
        return 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
      case 'company':
      default:
        return 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-20 lg:pb-8 max-w-6xl mx-auto">
      {/* Top Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-700 p-6 sm:p-8 text-white shadow-xl shadow-emerald-900/10">
        <div className="relative z-10 max-w-2xl space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-semibold tracking-wide uppercase">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Legal, Privacy & Compliance Center</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            Trust & Transparency Documentation
          </h2>
          <p className="text-xs sm:text-sm text-emerald-100/90 leading-relaxed font-medium">
            Accurate, comprehensive, and up-to-date legal terms, security policies, DPDP Act 2023 disclosures, and data rights for My Money Manager by HackifyPro.
          </p>
        </div>

        {/* Quick links to account deletion & grievance */}
        <div className="mt-5 flex flex-wrap gap-2.5 pt-2 border-t border-white/15">
          <button
            onClick={() => setSelectedPolicyId('privacy_policy')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              selectedPolicyId === 'privacy_policy'
                ? 'bg-white text-emerald-700 shadow-sm'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
          >
            Privacy Policy
          </button>
          <button
            onClick={() => setSelectedPolicyId('data_retention')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              selectedPolicyId === 'data_retention'
                ? 'bg-white text-emerald-700 shadow-sm'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
          >
            Data Retention & Deletion
          </button>
          <button
            onClick={() => setSelectedPolicyId('grievance_redressal')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              selectedPolicyId === 'grievance_redressal'
                ? 'bg-white text-emerald-700 shadow-sm'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
          >
            Grievance Officer
          </button>
          {onNavigateToAccountDeletion && (
            <button
              onClick={onNavigateToAccountDeletion}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-500/20 hover:bg-rose-500/30 text-rose-100 border border-rose-300/30 transition-all flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-300" />
              <span>Delete Account & Data &rarr;</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Grid: Left Policies Index (16 pages) + Right Content Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Index & Search */}
        <div className="lg:col-span-4 xl:col-span-4 bg-white dark:bg-slate-900 rounded-3xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Search 16 legal policies..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2.5 rounded-xl text-xs font-medium bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Category Filter Pills */}
          <div className="flex flex-wrap gap-1.5 pb-2 border-b border-slate-100 dark:border-slate-800">
            {(
              [
                { id: 'all', label: 'All (16)' },
                { id: 'privacy', label: 'Privacy' },
                { id: 'security', label: 'Security' },
                { id: 'legal', label: 'Legal' },
                { id: 'company', label: 'Support' },
              ] as const
            ).map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  selectedCategory === cat.id
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Policy List */}
          <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
            {filteredPolicies.map((policy, idx) => {
              const isSelected = policy.id === selectedPolicyId;
              return (
                <button
                  key={policy.id}
                  onClick={() => setSelectedPolicyId(policy.id)}
                  className={`w-full flex items-center justify-between p-3 rounded-2xl text-left transition-all cursor-pointer border ${
                    isSelected
                      ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 shadow-sm'
                      : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-5 h-5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate">{policy.title}</p>
                      <p className="text-[10px] text-slate-400 capitalize mt-0.5">{policy.category} policy</p>
                    </div>
                  </div>
                  <ChevronRight
                    className={`w-4 h-4 shrink-0 transition-transform ${
                      isSelected ? 'text-emerald-600 transform translate-x-0.5' : 'text-slate-300 dark:text-slate-600'
                    }`}
                  />
                </button>
              );
            })}

            {filteredPolicies.length === 0 && (
              <div className="text-center py-8 text-xs text-slate-400">
                No policies match your search "{searchQuery}"
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Full Reader View */}
        <div className="lg:col-span-8 xl:col-span-8 bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
          {/* Header & Meta */}
          <div className="border-b border-slate-100 dark:border-slate-800 pb-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${getCategoryBadge(
                  activePolicy.category
                )}`}
              >
                {getCategoryIcon(activePolicy.category)}
                <span className="capitalize">{activePolicy.category} Section</span>
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyLink}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                  title="Copy direct policy link"
                >
                  {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{isCopied ? 'Copied' : 'Share Link'}</span>
                </button>
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                  title="Print this document"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
              </div>
            </div>

            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight">
                {activePolicy.title}
              </h1>
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>Last Updated: {activePolicy.lastUpdated}</span>
                <span className="mx-1 text-slate-300">•</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Active & Enforced</span>
              </p>
            </div>

            {/* Policy Summary Callout */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
              <strong className="text-slate-900 dark:text-slate-100 block mb-1">Executive Summary:</strong>
              {activePolicy.summary}
            </div>
          </div>

          {/* Policy Sections */}
          <div className="space-y-6 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
            {activePolicy.sections.map((sec, sIdx) => (
              <div key={sIdx} className="space-y-2.5">
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <span className="w-1.5 h-4 rounded-full bg-emerald-500 inline-block" />
                  <span>{sec.title}</span>
                </h3>
                <div className="space-y-2 pl-3.5 border-l-2 border-slate-100 dark:border-slate-800">
                  {sec.content.map((paragraph, pIdx) => (
                    <p key={pIdx} className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Quick Contextual Actions / Links */}
          <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-slate-400">
              Published by <strong className="text-slate-700 dark:text-slate-300">HackifyPro Engineering & Compliance</strong>
            </div>

            <div className="flex items-center gap-2">
              {activePolicy.id !== 'privacy_policy' && (
                <button
                  onClick={() => setSelectedPolicyId('privacy_policy')}
                  className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                >
                  &larr; View Privacy Policy
                </button>
              )}
              {activePolicy.id !== 'terms_conditions' && (
                <button
                  onClick={() => setSelectedPolicyId('terms_conditions')}
                  className="text-xs font-bold text-slate-600 dark:text-slate-400 hover:underline cursor-pointer ml-3"
                >
                  Terms & Conditions &rarr;
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
