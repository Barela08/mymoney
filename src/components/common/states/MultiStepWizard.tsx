import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2 } from 'lucide-react';

export interface WizardStep {
  id: string;
  title: string;
  description?: string;
  component: React.ReactNode;
  isValid?: boolean;
}

export interface MultiStepWizardProps {
  title: string;
  steps: WizardStep[];
  onComplete: () => void;
  onCancel?: () => void;
  isSubmitting?: boolean;
}

export const MultiStepWizard: React.FC<MultiStepWizardProps> = ({
  title,
  steps,
  onComplete,
  onCancel,
  isSubmitting = false,
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const currentStep = steps[currentStepIndex];
  const isFirst = currentStepIndex === 0;
  const isLast = currentStepIndex === steps.length - 1;

  const handleNext = () => {
    if (isLast) {
      onComplete();
    } else {
      setCurrentStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
    }
  };

  const handleBack = () => {
    setCurrentStepIndex((prev) => Math.max(prev - 1, 0));
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl p-5 sm:p-8 max-w-2xl mx-auto">
      {/* Title & Progress Header */}
      <div className="mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">{title}</h3>
          <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
            Step {currentStepIndex + 1} of {steps.length}
          </span>
        </div>

        {/* Step Indicator Pills */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          {steps.map((s, idx) => (
            <div key={s.id} className="space-y-1">
              <div
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  idx <= currentStepIndex ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-800'
                }`}
              />
              <p
                className={`text-[10px] font-semibold truncate ${
                  idx === currentStepIndex
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                {s.title}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Step Body */}
      <div className="min-h-[220px] py-2">
        <div className="mb-4">
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">{currentStep.title}</h4>
          {currentStep.description && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{currentStep.description}</p>
          )}
        </div>
        {currentStep.component}
      </div>

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between pt-6 mt-6 border-t border-slate-100 dark:border-slate-800">
        <button
          type="button"
          onClick={isFirst ? onCancel : handleBack}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{isFirst ? 'Cancel' : 'Back'}</span>
        </button>

        <button
          type="button"
          onClick={handleNext}
          disabled={currentStep.isValid === false || isSubmitting}
          className="flex items-center gap-1.5 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 disabled:opacity-50 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md transition-all cursor-pointer"
        >
          <span>{isLast ? (isSubmitting ? 'Finalizing...' : 'Complete & Confirm') : 'Continue'}</span>
          {isLast ? <Check className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};
