import React from 'react';
import {
  ArrowLeft,
  AudioLines,
  CheckCircle2,
  Download,
  FileText,
  Lock,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  NoiseReductionConfig,
  NoiseReductionLevel,
  StyleConfig,
  SubtitleSegment,
} from '../types';
import { formatTimeDisplay } from '../utils/subtitles';

const EXPORT_NOISE_LEVELS: Array<{
  value: NoiseReductionLevel;
  label: string;
}> = [
  { value: 'light', label: 'Suave' },
  { value: 'medium', label: 'Médio' },
  { value: 'strong', label: 'Forte' },
];

interface ExportStageProps {
  projectTitle: string;
  duration: number;
  segments: SubtitleSegment[];
  styleConfig: StyleConfig;
  hasVideo: boolean;
  isExporting: boolean;
  exportProgress: number;
  onDownloadVideo: () => void;
  onCancelExport: () => void;
  onDownloadSrt: () => void;
  onBackToStep2: () => void;
  freePlanInfo?: {
    isFree: boolean;
    savedUsed: number;
    limit: number;
    saveBlocked: boolean;
  };
  onOpenProUpgrade?: () => void;
  noiseReduction?: NoiseReductionConfig;
  onNoiseReductionChange?: (next: NoiseReductionConfig) => void;
}

export function ExportStage({
  projectTitle,
  duration,
  segments,
  styleConfig,
  hasVideo,
  isExporting,
  exportProgress,
  onDownloadVideo,
  onCancelExport,
  onDownloadSrt,
  onBackToStep2,
  freePlanInfo,
  onOpenProUpgrade,
  noiseReduction = { enabled: false, level: 'medium' },
  onNoiseReductionChange,
}: ExportStageProps) {
  const totalWords = segments.reduce((acc, s) => acc + s.words.length, 0);
  const saveBlocked = Boolean(freePlanInfo?.saveBlocked);

  return (
    <div className="max-w-2xl mx-auto py-10 px-4 sm:px-6 space-y-6">
      <div className="p-6 sm:p-8 rounded-xl bg-[#11141D] border border-white/10 space-y-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <h1 className="text-xl font-bold text-slate-100">
              Vídeo pronto para exportação
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              As legendas configuradas serão aplicadas no arquivo final.
            </p>
          </div>
        </div>

        {/* Summary Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-white/10">
          <div className="p-3 rounded-lg bg-[#090B10] border border-white/10">
            <div className="text-[11px] text-slate-400">Duração</div>
            <div className="font-mono-tabular text-sm font-semibold text-slate-100 mt-0.5">
              {formatTimeDisplay(duration)}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-[#090B10] border border-white/10">
            <div className="text-[11px] text-slate-400">Legendas</div>
            <div className="font-mono-tabular text-sm font-semibold text-slate-100 mt-0.5">
              {totalWords} palavras
            </div>
          </div>
          <div className="p-3 rounded-lg bg-[#090B10] border border-white/10">
            <div className="text-[11px] text-slate-400">Estilo</div>
            <div className="text-xs font-semibold text-amber-400 mt-1 truncate">
              {styleConfig.preset.replace('_', ' ').toUpperCase()}
            </div>
          </div>
        </div>

        {/* Audio Noise Reduction Option */}
        {onNoiseReductionChange && (
          <div className="p-3.5 rounded-xl bg-[#090B10] border border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${
                  noiseReduction.enabled
                    ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                    : 'bg-[#181C27] border-white/10 text-slate-400'
                }`}
              >
                <AudioLines className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-100">
                  Reduzir ruído no vídeo final
                </p>
                <p className="text-[11px] text-slate-400">
                  Aplica filtro de voz limpa durante a renderização
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {noiseReduction.enabled && (
                <div
                  role="group"
                  aria-label="Nível de redução de ruído"
                  className="inline-flex items-center rounded-lg bg-[#11141D] border border-white/10 p-0.5"
                >
                  {EXPORT_NOISE_LEVELS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isExporting}
                      onClick={() =>
                        onNoiseReductionChange({
                          ...noiseReduction,
                          level: opt.value,
                        })
                      }
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                        noiseReduction.level === opt.value
                          ? 'bg-amber-400 text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                role="switch"
                aria-checked={noiseReduction.enabled}
                disabled={isExporting}
                onClick={() =>
                  onNoiseReductionChange({
                    ...noiseReduction,
                    enabled: !noiseReduction.enabled,
                  })
                }
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-50 ${
                  noiseReduction.enabled
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/25'
                    : 'bg-[#181C27] border-white/10 text-slate-300 hover:bg-white/10'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    noiseReduction.enabled ? 'bg-emerald-400' : 'bg-slate-500'
                  }`}
                />
                {noiseReduction.enabled ? 'Ativado' : 'Desativado'}
              </button>
            </div>
          </div>
        )}

        {/* Render Progress */}
        {isExporting && (
          <div className="p-4 rounded-lg bg-[#090B10] border border-amber-400/30 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-200">
                Renderizando "{projectTitle}" com legendas...
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono-tabular text-xs font-semibold text-amber-400">
                  {exportProgress}%
                </span>
                <button
                  type="button"
                  onClick={onCancelExport}
                  aria-label="Cancelar exportação"
                  className="text-slate-400 hover:text-rose-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 transition-all duration-200"
                style={{ width: `${exportProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Free Plan Quota Gate */}
        {freePlanInfo?.isFree && (
          <div
            className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-3 text-xs ${
              saveBlocked
                ? 'bg-rose-500/10 border-rose-500/35 text-rose-200'
                : 'bg-[#090B10] border-white/10 text-slate-300'
            }`}
          >
            <div className="flex items-start gap-2.5 min-w-0 flex-1">
              {saveBlocked && (
                <Lock className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <span>
                {saveBlocked
                  ? `Limite do Plano Grátis atingido (${freePlanInfo.limit} vídeos). O salvamento está bloqueado. Ative o plano PRO para baixar este vídeo ou arquivo .SRT.`
                  : `Plano Grátis: ${Math.min(freePlanInfo.savedUsed, freePlanInfo.limit)} de ${freePlanInfo.limit} vídeos salvos utilizados.`}
              </span>
            </div>
            {onOpenProUpgrade && (
              <button
                type="button"
                onClick={onOpenProUpgrade}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-400 text-slate-950 font-bold hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Assinar PRO
              </button>
            )}
          </div>
        )}

        {/* Primary Export Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
          <button
            type="button"
            disabled={!hasVideo || segments.length === 0 || isExporting || saveBlocked}
            onClick={onDownloadVideo}
            className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-amber-400 text-slate-950 text-sm font-semibold hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {saveBlocked ? (
              <Lock className="w-4 h-4" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {saveBlocked
              ? 'Salvamento bloqueado (Plano Grátis)'
              : isExporting
                ? 'Renderizando vídeo...'
                : 'Baixar vídeo final'}
          </button>

          <button
            type="button"
            disabled={segments.length === 0 || isExporting || saveBlocked}
            onClick={onDownloadSrt}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-[#181C27] border border-white/10 text-sm font-semibold text-slate-100 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {saveBlocked ? (
              <Lock className="w-4 h-4 text-slate-400" />
            ) : (
              <FileText className="w-4 h-4 text-slate-300" />
            )}
            Baixar arquivo .SRT
          </button>
        </div>

        {/* Footer Navigation */}
        <div className="pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            disabled={isExporting}
            onClick={onBackToStep2}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para Legendas
          </button>
        </div>
      </div>
    </div>
  );
}
