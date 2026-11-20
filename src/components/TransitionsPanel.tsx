import React, { useEffect, useState } from 'react';
import { Check, Eye, Play, Scissors, Sparkles } from 'lucide-react';
import {
  TRANSITION_LIBRARY,
  type DetectedPause,
  type TransitionCategory,
  type TransitionConfig,
  type TransitionIntensity,
  type TransitionType,
} from '../types';
import { formatTimePrecise } from '../utils/subtitles';
import { computeTransitionVisual } from '../utils/transitionEffects';

interface TransitionsPanelProps {
  transitionConfig: TransitionConfig;
  pauses: DetectedPause[];
  hasVideo: boolean;
  onChange: (next: TransitionConfig) => void;
  onSeekTo: (time: number) => void;
  onPreviewTransitionOnVideo: (type: TransitionType) => void;
}

const CATEGORY_TABS: Array<{ id: 'all' | TransitionCategory; label: string }> = [
  { id: 'all', label: 'Todas (14)' },
  { id: 'classic', label: 'Clássicas' },
  { id: 'dynamic', label: 'Dinâmicas' },
  { id: '3d', label: '3D' },
  { id: 'impact', label: 'Impacto' },
];

export function TransitionsPanel({
  transitionConfig,
  pauses,
  hasVideo,
  onChange,
  onSeekTo,
  onPreviewTransitionOnVideo,
}: TransitionsPanelProps) {
  const [category, setCategory] = useState<'all' | TransitionCategory>('all');
  const [previewTarget, setPreviewTarget] = useState<TransitionType>(
    transitionConfig.type,
  );
  const [previewProgress, setPreviewProgress] = useState<number | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);

  const filteredTransitions =
    category === 'all'
      ? TRANSITION_LIBRARY
      : TRANSITION_LIBRARY.filter((item) => item.category === category);

  const activePreviewMeta =
    TRANSITION_LIBRARY.find((t) => t.value === previewTarget) ||
    TRANSITION_LIBRARY[0];

  // Animate the dedicated transition preview box whenever previewNonce increments
  useEffect(() => {
    if (previewNonce === 0) return;
    let rafId = 0;
    const durMs = Math.max(180, (transitionConfig.duration || 0.45) * 1000);
    const startAt = performance.now();

    const step = (now: number) => {
      const p = (now - startAt) / durMs;
      if (p >= 1) {
        setPreviewProgress(null);
        return;
      }
      setPreviewProgress(p);
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [previewNonce, transitionConfig.duration]);

  const handlePreviewClick = (type: TransitionType) => {
    setPreviewTarget(type);
    setPreviewNonce((n) => n + 1);
    if (hasVideo) {
      onPreviewTransitionOnVideo(type);
    }
  };

  const handleApplyTransition = (type: TransitionType) => {
    setPreviewTarget(type);
    onChange({ ...transitionConfig, type });
  };

  const previewVisual =
    previewProgress !== null
      ? computeTransitionVisual(
          previewTarget,
          previewProgress,
          transitionConfig.intensity,
        )
      : null;

  const isSecondClip = previewProgress !== null && previewProgress >= 0.5;

  return (
    <div className="flex flex-col gap-5">
      {/* Master Toggle */}
      <div className="p-4 rounded-xl bg-[#11141D] border border-white/10 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            Pausas longas e transições automáticas
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Detecta silêncios na fala para cortar ou aplicar efeitos visuais.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={transitionConfig.enabled}
          onClick={() =>
            onChange({ ...transitionConfig, enabled: !transitionConfig.enabled })
          }
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 border ${
            transitionConfig.enabled
              ? 'bg-amber-400 text-slate-950 border-amber-400'
              : 'bg-[#181C27] text-slate-300 border-white/10 hover:text-white'
          }`}
        >
          {transitionConfig.enabled ? 'Ligado' : 'Desligado'}
        </button>
      </div>

      {/* Controls */}
      <div
        className={`p-4 rounded-xl bg-[#11141D] border border-white/10 space-y-5 transition-opacity ${
          transitionConfig.enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'
        }`}
      >
        {/* Mode */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-300">
            Ação ao detectar pausa longa
          </span>
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#181C27] rounded-lg border border-white/10">
            <button
              type="button"
              onClick={() => onChange({ ...transitionConfig, mode: 'transition' })}
              className={`py-2 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                transitionConfig.mode === 'transition'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Aplicar transição
            </button>
            <button
              type="button"
              onClick={() => onChange({ ...transitionConfig, mode: 'cut' })}
              className={`py-2 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                transitionConfig.mode === 'cut'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Scissors className="w-3.5 h-3.5" />
              Cortar pausas
            </button>
          </div>
        </div>

        {/* Transition Library + Live Sandbox Preview */}
        {transitionConfig.mode === 'transition' && (
          <>
            {/* Interactive Transition Preview Box */}
            <div className="rounded-lg bg-[#090B10] border border-white/10 p-3.5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="w-full sm:w-44 h-24 rounded-md overflow-hidden border border-white/15 relative bg-[#141824] shrink-0">
                <div
                  className="w-full h-full flex flex-col items-center justify-center px-3 text-center"
                  style={{
                    background: isSecondClip
                      ? 'linear-gradient(135deg, #1E293B 0%, #0F172A 100%)'
                      : 'linear-gradient(135deg, #27272A 0%, #11141D 100%)',
                    ...(previewVisual?.style ?? {}),
                  }}
                >
                  <span className="text-[11px] font-semibold text-amber-400">
                    {isSecondClip ? 'Cena B' : 'Cena A'}
                  </span>
                  <span className="text-xs font-bold text-slate-100 mt-0.5">
                    {activePreviewMeta.label}
                  </span>
                </div>
                {previewVisual && previewVisual.flashOpacity > 0 && (
                  <div
                    className="pointer-events-none absolute inset-0 bg-white"
                    style={{ opacity: previewVisual.flashOpacity }}
                  />
                )}
              </div>

              <div className="flex-1 min-w-0 space-y-2 w-full">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-slate-400">
                      Pré-visualização antes de aplicar
                    </div>
                    <div className="text-sm font-semibold text-slate-100">
                      {activePreviewMeta.label} · {transitionConfig.duration.toFixed(2)}s
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handlePreviewClick(previewTarget)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181C27] border border-white/15 text-xs font-semibold text-slate-100 hover:bg-white/10 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Play className="w-3.5 h-3.5 text-amber-400 fill-current" />
                    Testar
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-400 truncate">
                    {activePreviewMeta.desc}
                  </span>
                  {transitionConfig.type !== previewTarget && (
                    <button
                      type="button"
                      onClick={() => handleApplyTransition(previewTarget)}
                      className="px-3 py-1 rounded-md bg-amber-400 text-slate-950 text-xs font-semibold hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0"
                    >
                      Aplicar este efeito
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Category Filter & Library Grid */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-300">
                  Biblioteca de transições
                </span>
                <div className="flex flex-wrap items-center gap-1 p-1 bg-[#181C27] rounded-lg border border-white/10">
                  {CATEGORY_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setCategory(tab.id)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                        category === tab.id
                          ? 'bg-amber-400 text-slate-950 font-semibold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[320px] overflow-y-auto pr-1">
                {filteredTransitions.map((t) => {
                  const isApplied = transitionConfig.type === t.value;
                  const isPreviewing = previewTarget === t.value;
                  return (
                    <div
                      key={t.value}
                      className={`p-3 rounded-lg border transition-colors flex flex-col justify-between gap-2.5 ${
                        isApplied
                          ? 'bg-amber-400/10 border-amber-400'
                          : isPreviewing
                            ? 'bg-[#181C27] border-sky-400/60'
                            : 'bg-[#181C27] border-white/10 hover:border-white/25'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-100">
                            {t.label}
                          </span>
                          {isApplied && (
                            <span className="text-[11px] font-semibold text-amber-400 flex items-center gap-1 whitespace-nowrap">
                              <Check className="w-3 h-3" />
                              Ativa
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{t.desc}</p>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handlePreviewClick(t.value)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#090B10] border border-white/10 text-xs font-medium text-slate-200 hover:text-white hover:border-white/25 transition-colors whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5 text-sky-400" />
                          Pré-visualizar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplyTransition(t.value)}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                            isApplied
                              ? 'bg-amber-400 text-slate-950'
                              : 'bg-white/10 text-slate-100 hover:bg-amber-400 hover:text-slate-950'
                          }`}
                        >
                          {isApplied ? 'Aplicada' : 'Aplicar'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Transition Duration & Intensity */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="transition-duration"
                    className="text-xs font-medium text-slate-300"
                  >
                    Duração da transição
                  </label>
                  <span className="font-mono-tabular text-xs font-semibold text-amber-400">
                    {transitionConfig.duration.toFixed(2)}s
                  </span>
                </div>
                <input
                  id="transition-duration"
                  type="range"
                  min={0.15}
                  max={1.5}
                  step={0.05}
                  value={transitionConfig.duration}
                  onChange={(e) =>
                    onChange({
                      ...transitionConfig,
                      duration: Number(e.target.value),
                    })
                  }
                  className="w-full accent-amber-400 cursor-pointer h-2 bg-white/10 rounded-lg mt-1"
                />
                <span className="text-[11px] text-slate-500">
                  Ajuste entre cortes rápidos (0.15s) e suaves (1.50s).
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-300">
                  Intensidade do efeito
                </span>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#181C27] rounded-lg border border-white/10">
                  {(
                    [
                      { value: 'low', label: 'Suave' },
                      { value: 'medium', label: 'Média' },
                      { value: 'high', label: 'Intensa' },
                    ] as Array<{ value: TransitionIntensity; label: string }>
                  ).map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() =>
                        onChange({ ...transitionConfig, intensity: item.value })
                      }
                      className={`py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                        transitionConfig.intensity === item.value
                          ? 'bg-amber-400 text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Pause Threshold Slider */}
        <div className="flex flex-col gap-2 pt-1 border-t border-white/[0.06]">
          <div className="flex items-center justify-between pt-2">
            <label
              htmlFor="pause-threshold"
              className="text-xs font-medium text-slate-300"
            >
              Duração mínima da pausa
            </label>
            <span className="font-mono-tabular text-xs font-semibold text-sky-400">
              {transitionConfig.pauseThreshold.toFixed(1)}s
            </span>
          </div>
          <input
            id="pause-threshold"
            type="range"
            min={0.4}
            max={2.0}
            step={0.1}
            value={transitionConfig.pauseThreshold}
            onChange={(e) =>
              onChange({
                ...transitionConfig,
                pauseThreshold: Number(e.target.value),
              })
            }
            className="w-full accent-sky-400 cursor-pointer h-2 bg-white/10 rounded-lg"
          />
          <p className="text-xs text-slate-500">
            Intervalos de silêncio maiores que {transitionConfig.pauseThreshold.toFixed(1)}s receberão{' '}
            {transitionConfig.mode === 'cut' ? 'corte automático' : 'transição visual'}.
          </p>
        </div>
      </div>

      {/* Detected Pauses List */}
      <div className="rounded-xl bg-[#11141D] border border-white/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">
            Pausas detectadas
          </h3>
          <span className="font-mono-tabular text-xs text-slate-400">
            {pauses.length} {pauses.length === 1 ? 'ponto' : 'pontos'}
          </span>
        </div>

        {pauses.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Nenhuma pausa acima de {transitionConfig.pauseThreshold.toFixed(1)}s encontrada na transcrição atual.
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06] max-h-[220px] overflow-y-auto">
            {pauses.map((pause, index) => (
              <button
                key={pause.id}
                type="button"
                onClick={() => onSeekTo(Math.max(0, pause.start - 0.35))}
                className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-white/[0.04] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono-tabular text-xs text-slate-500">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="font-mono-tabular text-xs text-slate-200">
                    {formatTimePrecise(pause.start)} → {formatTimePrecise(pause.end)}
                  </span>
                </div>
                <span className="font-mono-tabular text-xs text-sky-400">
                  {pause.duration.toFixed(2)}s · Ir para ponto
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
