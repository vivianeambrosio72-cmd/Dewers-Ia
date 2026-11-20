import React, { useEffect, useState } from 'react';
import {
  Eye,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  TRANSITION_LIBRARY,
  type TransitionCategory,
  type TransitionConfig,
  type TransitionIntensity,
  type TransitionPoint,
  type TransitionType,
} from '../types';
import { formatTimePrecise } from '../utils/subtitles';
import { computeTransitionVisual } from '../utils/transitionEffects';

interface Step3TransitionsPanelProps {
  transitionConfig: TransitionConfig;
  transitionPoints: TransitionPoint[];
  selectedPointId: string | null;
  currentTime: number;
  hasVideo: boolean;
  onConfigChange: (next: TransitionConfig) => void;
  onAddPointAtCurrentTime: () => void;
  onRemovePoint: (pointId: string) => void;
  onUpdatePointType: (pointId: string, type: TransitionType) => void;
  onRecalculatePauses: () => void;
  onSelectPoint: (point: TransitionPoint) => void;
  onPreviewTransitionOnVideo: (type: TransitionType) => void;
}

const CATEGORY_TABS: Array<{ id: 'all' | TransitionCategory; label: string }> = [
  { id: 'all', label: 'Todas (14)' },
  { id: 'classic', label: 'Clássicas' },
  { id: 'dynamic', label: 'Dinâmicas' },
  { id: '3d', label: '3D' },
  { id: 'impact', label: 'Impacto' },
];

export function Step3TransitionsPanel({
  transitionConfig,
  transitionPoints,
  selectedPointId,
  currentTime,
  hasVideo,
  onConfigChange,
  onAddPointAtCurrentTime,
  onRemovePoint,
  onUpdatePointType,
  onRecalculatePauses,
  onSelectPoint,
  onPreviewTransitionOnVideo,
}: Step3TransitionsPanelProps) {
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

  const handleSelectDefaultType = (type: TransitionType) => {
    setPreviewTarget(type);
    onConfigChange({ ...transitionConfig, type });
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
      {/* Mode & Toggle */}
      <div className="p-4 rounded-xl bg-[#11141D] border border-white/10 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Transições automáticas e manuais
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Escolha o efeito padrão, ajuste a intensidade e gerencie cada ponto na timeline.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={transitionConfig.enabled}
            onClick={() =>
              onConfigChange({
                ...transitionConfig,
                enabled: !transitionConfig.enabled,
              })
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

        <div
          className={`space-y-4 transition-opacity ${
            transitionConfig.enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'
          }`}
        >
          {/* Mode */}
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#181C27] rounded-lg border border-white/10">
            <button
              type="button"
              onClick={() =>
                onConfigChange({ ...transitionConfig, mode: 'transition' })
              }
              className={`py-2 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                transitionConfig.mode === 'transition'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Aplicar transições
            </button>
            <button
              type="button"
              onClick={() => onConfigChange({ ...transitionConfig, mode: 'cut' })}
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

          {/* Intensity & Duration */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-300">
                Intensidade padrão
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
                      onConfigChange({ ...transitionConfig, intensity: item.value })
                    }
                    className={`py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
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

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="step3-duration"
                  className="text-xs font-medium text-slate-300"
                >
                  Duração do efeito
                </label>
                <span className="font-mono-tabular text-xs font-semibold text-amber-400">
                  {transitionConfig.duration.toFixed(2)}s
                </span>
              </div>
              <input
                id="step3-duration"
                type="range"
                min={0.15}
                max={1.5}
                step={0.05}
                value={transitionConfig.duration}
                onChange={(e) =>
                  onConfigChange({
                    ...transitionConfig,
                    duration: Number(e.target.value),
                  })
                }
                className="w-full accent-amber-400 cursor-pointer h-2 bg-white/10 rounded-lg mt-2"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Transition Library + Sandbox Preview */}
      {transitionConfig.enabled && transitionConfig.mode === 'transition' && (
        <div className="p-4 rounded-xl bg-[#11141D] border border-white/10 space-y-4">
          <div className="rounded-lg bg-[#090B10] border border-white/10 p-3 flex items-center justify-between gap-4">
            <div className="w-32 h-16 rounded-md overflow-hidden border border-white/15 relative bg-[#141824] shrink-0">
              <div
                className="w-full h-full flex flex-col items-center justify-center px-2 text-center"
                style={{
                  background: isSecondClip
                    ? 'linear-gradient(135deg, #1E293B 0%, #0F172A 100%)'
                    : 'linear-gradient(135deg, #27272A 0%, #11141D 100%)',
                  ...(previewVisual?.style ?? {}),
                }}
              >
                <span className="text-[10px] font-semibold text-amber-400">
                  {isSecondClip ? 'Cena B' : 'Cena A'}
                </span>
                <span className="text-xs font-bold text-slate-100 truncate max-w-full">
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

            <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-100 truncate">
                  {activePreviewMeta.label}
                </div>
                <div className="text-xs text-slate-400 truncate">
                  {activePreviewMeta.desc}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handlePreviewClick(previewTarget)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181C27] border border-white/15 text-xs font-semibold text-slate-100 hover:bg-white/10 transition-colors shrink-0"
              >
                <Play className="w-3.5 h-3.5 text-amber-400 fill-current" />
                Testar
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-300">
              Tipo padrão para novos pontos
            </span>
            <div className="flex flex-wrap items-center gap-1 p-1 bg-[#181C27] rounded-lg border border-white/10">
              {CATEGORY_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCategory(tab.id)}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
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

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[210px] overflow-y-auto pr-1">
            {filteredTransitions.map((t) => {
              const selected = transitionConfig.type === t.value;
              return (
                <div
                  key={t.value}
                  className={`p-2.5 rounded-lg border flex flex-col justify-between gap-2 ${
                    selected
                      ? 'bg-amber-400/10 border-amber-400'
                      : 'bg-[#181C27] border-white/10'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectDefaultType(t.value)}
                    className="text-left"
                  >
                    <div className="text-xs font-semibold text-slate-100">
                      {t.label}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate mt-0.5">
                      {t.desc}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePreviewClick(t.value)}
                    className="inline-flex items-center justify-center gap-1 py-1 rounded bg-[#090B10] border border-white/10 text-[11px] text-slate-300 hover:text-white"
                  >
                    <Eye className="w-3 h-3 text-sky-400" />
                    Pré-visualizar
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-Point Transitions Editor */}
      <div className="rounded-xl bg-[#11141D] border border-white/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Pontos de transição ({transitionPoints.length})
            </h3>
            <p className="text-[11px] text-slate-400">
              Adicione, remova ou altere o efeito de cada ponto individualmente.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRecalculatePauses}
              title="Detectar pausas novamente"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#181C27] border border-white/10 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
              Detectar pausas
            </button>
            <button
              type="button"
              onClick={onAddPointAtCurrentTime}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-400 text-slate-950 text-xs font-semibold hover:bg-sky-300 transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Adicionar em {formatTimePrecise(currentTime)}
            </button>
          </div>
        </div>

        {/* Sensitivity slider */}
        <div className="px-4 py-2.5 border-b border-white/[0.06] bg-[#0D1017] flex items-center justify-between gap-4">
          <label
            htmlFor="pause-sens"
            className="text-xs text-slate-400 whitespace-nowrap"
          >
            Sensibilidade de pausa ({transitionConfig.pauseThreshold.toFixed(1)}s)
          </label>
          <input
            id="pause-sens"
            type="range"
            min={0.4}
            max={2.0}
            step={0.1}
            value={transitionConfig.pauseThreshold}
            onChange={(e) =>
              onConfigChange({
                ...transitionConfig,
                pauseThreshold: Number(e.target.value),
              })
            }
            className="w-44 accent-sky-400 cursor-pointer h-1.5 bg-white/10 rounded-lg"
          />
        </div>

        {transitionPoints.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Nenhum ponto de transição ativo. Clique em "Adicionar em {formatTimePrecise(currentTime)}" ou ajuste a sensibilidade para detectar pausas.
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06] max-h-[240px] overflow-y-auto">
            {transitionPoints.map((pt, idx) => {
              const isSelected = pt.id === selectedPointId;
              return (
                <div
                  key={pt.id}
                  className={`px-4 py-2.5 flex items-center justify-between gap-3 ${
                    isSelected ? 'bg-sky-400/10' : 'hover:bg-white/[0.02]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectPoint(pt)}
                    className="flex items-center gap-2.5 text-left min-w-0"
                  >
                    <span className="font-mono-tabular text-xs text-slate-500">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span className="font-mono-tabular text-xs font-semibold text-sky-300">
                      {formatTimePrecise(pt.time)}
                    </span>
                    <span className="text-xs text-slate-400 truncate">
                      {pt.source === 'auto'
                        ? `Pausa (${pt.pauseDuration?.toFixed(1) ?? ''}s)`
                        : 'Manual'}
                    </span>
                  </button>

                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      aria-label={`Tipo de transição do ponto ${idx + 1}`}
                      value={pt.type}
                      onChange={(e) =>
                        onUpdatePointType(pt.id, e.target.value as TransitionType)
                      }
                      className="px-2 py-1 rounded bg-[#181C27] border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-sky-400"
                    >
                      {TRANSITION_LIBRARY.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => onPreviewTransitionOnVideo(pt.type)}
                      title="Pré-visualizar este efeito"
                      className="p-1.5 rounded bg-[#181C27] border border-white/10 text-slate-300 hover:text-white"
                    >
                      <Play className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemovePoint(pt.id)}
                      aria-label={`Remover transição em ${formatTimePrecise(pt.time)}`}
                      className="p-1.5 rounded bg-[#181C27] border border-white/10 text-slate-400 hover:text-rose-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
