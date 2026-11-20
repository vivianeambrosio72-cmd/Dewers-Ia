import React from 'react';
import { ArrowRight, Check, Lock } from 'lucide-react';
import type { WizardStep } from '../types';

interface WizardProgressBarProps {
  currentStep: WizardStep;
  maxReachedStep: number; // 1, 2, 3, or 4 (export)
  hasVideo: boolean;
  hasSubtitles: boolean;
  subtitlesReviewed?: boolean;
  onSelectStep: (step: WizardStep) => void;
}

const STEPS: Array<{ id: 1 | 2 | 3; label: string }> = [
  { id: 1, label: '1. Vídeo' },
  { id: 2, label: '2. Legendas' },
  { id: 3, label: '3. Transições' },
];

export function WizardProgressBar({
  currentStep,
  maxReachedStep,
  hasVideo,
  hasSubtitles,
  subtitlesReviewed = false,
  onSelectStep,
}: WizardProgressBarProps) {
  const currentNum = currentStep === 'export' ? 4 : currentStep;

  const isStepCompleted = (id: 1 | 2 | 3) => {
    if (id === 1) return currentNum > 1 && hasVideo;
    if (id === 2) return currentNum > 2 && hasSubtitles;
    if (id === 3) return currentNum > 3;
    return false;
  };

  const canNavigateTo = (id: 1 | 2 | 3) => {
    if (id === currentStep) return false;
    if (id === 1) return true;
    if (id === 2) return hasVideo && maxReachedStep >= 2;
    if (id === 3) return hasVideo && hasSubtitles && subtitlesReviewed && maxReachedStep >= 3;
    return false;
  };

  return (
    <div className="border-b border-white/10 bg-[#0D1017]">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
        <ol className="flex flex-wrap items-center gap-2 sm:gap-3" aria-label="Etapas do assistente">
          {STEPS.map((step, index) => {
            const isCurrent = currentStep === step.id;
            const completed = isStepCompleted(step.id);
            const reachable = canNavigateTo(step.id);

            return (
              <React.Fragment key={step.id}>
                <li>
                  <button
                    type="button"
                    disabled={!reachable && !isCurrent}
                    onClick={() => {
                      if (reachable) onSelectStep(step.id);
                    }}
                    className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 border ${
                      isCurrent
                        ? 'bg-amber-400 text-slate-950 border-amber-400'
                        : completed
                          ? 'bg-[#181C27] text-emerald-400 border-emerald-500/30 hover:border-emerald-400/60 cursor-pointer'
                          : reachable
                            ? 'bg-[#181C27] text-slate-200 border-white/15 hover:border-white/30 cursor-pointer'
                            : 'bg-[#11141D] text-slate-500 border-white/5 cursor-not-allowed'
                    }`}
                  >
                    {completed ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : !isCurrent && !reachable ? (
                      <Lock className="w-3 h-3 text-slate-600 shrink-0" />
                    ) : null}
                    <span>{step.label}</span>
                  </button>
                </li>
                {index < STEPS.length - 1 && (
                  <li aria-hidden="true" className="text-slate-600">
                    <ArrowRight className="w-4 h-4" />
                  </li>
                )}
              </React.Fragment>
            );
          })}

          {currentStep === 'export' && (
            <>
              <li aria-hidden="true" className="text-slate-600">
                <ArrowRight className="w-4 h-4" />
              </li>
              <li>
                <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold bg-amber-400 text-slate-950 border border-amber-400 whitespace-nowrap">
                  Exportar
                </span>
              </li>
            </>
          )}
        </ol>

        <span className="text-xs text-slate-400 hidden sm:inline">
          {currentStep === 1 && 'Etapa 1 de 3 · Carregue o vídeo'}
          {currentStep === 2 && 'Etapa 2 de 3 · Ajuste estilo e texto das legendas'}
          {currentStep === 3 && 'Etapa 3 de 3 · Defina transições nos pontos da timeline'}
          {currentStep === 'export' && 'Concluído · Baixe o vídeo final ou .SRT'}
        </span>
      </div>
    </div>
  );
}
