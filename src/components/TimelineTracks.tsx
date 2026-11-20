import React, { useRef, useState } from 'react';
import { Film, Plus, Sparkles, Type as TypeIcon } from 'lucide-react';
import type { SubtitleSegment, TransitionPoint } from '../types';
import { formatTimeDisplay, formatTimePrecise } from '../utils/subtitles';

interface TimelineTracksProps {
  step: 1 | 2 | 3;
  duration: number;
  currentTime: number;
  videoFileName: string | null;
  segments: SubtitleSegment[];
  transitionPoints: TransitionPoint[];
  selectedTransitionId?: string | null;
  onSeek: (time: number) => void;
  onSelectTransitionPoint?: (point: TransitionPoint) => void;
  onAddTransitionAtPlayhead?: () => void;
  onAddSubtitleAtPlayhead?: () => void;
  onResizeSegmentStart?: () => void;
  onResizeSegment?: (segmentId: string, nextStart: number, nextEnd: number) => void;
}

export function TimelineTracks({
  step,
  duration,
  currentTime,
  videoFileName,
  segments,
  transitionPoints,
  selectedTransitionId,
  onSeek,
  onSelectTransitionPoint,
  onAddTransitionAtPlayhead,
  onAddSubtitleAtPlayhead,
  onResizeSegmentStart,
  onResizeSegment,
}: TimelineTracksProps) {
  const trackAreaRef = useRef<HTMLDivElement>(null);
  const subtitleTrackRef = useRef<HTMLDivElement>(null);
  const [draggingSegId, setDraggingSegId] = useState<string | null>(null);

  const safeDuration = Math.max(0.1, duration);
  const playheadPct = Math.min(100, Math.max(0, (currentTime / safeDuration) * 100));

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!trackAreaRef.current || duration <= 0 || draggingSegId) return;
    const rect = trackAreaRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  };

  const startEdgeDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    seg: SubtitleSegment,
    edge: 'start' | 'end',
  ) => {
    if (step !== 2 || !onResizeSegment || duration <= 0) return;
    e.stopPropagation();
    e.preventDefault();

    onResizeSegmentStart?.();
    setDraggingSegId(seg.id);

    const trackEl = subtitleTrackRef.current;
    if (!trackEl) return;

    const handleMove = (moveEvent: PointerEvent) => {
      const rect = trackEl.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.min(1, Math.max(0, (moveEvent.clientX - rect.left) / rect.width));
      const targetTime = ratio * duration;

      if (edge === 'start') {
        const nextStart = Math.max(0, Math.min(seg.end - 0.15, targetTime));
        onResizeSegment(seg.id, nextStart, seg.end);
      } else {
        const nextEnd = Math.min(duration, Math.max(seg.start + 0.15, targetTime));
        onResizeSegment(seg.id, seg.start, nextEnd);
      }
    };

    const handleUp = () => {
      setDraggingSegId(null);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  return (
    <div className="bg-[#11141D] border border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-200">
            Timeline
          </span>
          <span className="text-xs text-slate-500">
            {step === 1 && '1 faixa · Vídeo original'}
            {step === 2 && '2 faixas · Arraste as bordas das legendas para ajustar tempos'}
            {step === 3 && '3 faixas · Vídeo, Legendas (travadas) e Transições'}
          </span>
        </div>
        <span className="font-mono-tabular text-xs text-slate-400">
          {formatTimeDisplay(currentTime)} / {formatTimeDisplay(duration)}
        </span>
      </div>

      {/* Multi-track Area */}
      <div
        ref={trackAreaRef}
        onClick={handleTrackClick}
        className="relative rounded-lg bg-[#090B10] border border-white/10 p-2.5 space-y-2 cursor-pointer select-none overflow-hidden"
      >
        {/* Global Playhead Indicator */}
        <div
          aria-hidden="true"
          style={{ left: `${playheadPct}%` }}
          className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-amber-400 z-20"
        >
          <div className="w-2.5 h-2.5 -ml-[4px] bg-amber-400 rounded-b-sm" />
        </div>

        {/* Track 1: Video (always shown in Steps 1, 2, 3) */}
        <div className="flex items-center gap-2.5">
          <div className="w-20 shrink-0 flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
            <Film className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>Vídeo</span>
          </div>
          <div className="flex-1 h-8 rounded bg-slate-800/70 border border-white/10 px-2.5 flex items-center overflow-hidden">
            <span className="text-[11px] text-slate-200 truncate">
              {videoFileName || 'Clipe de vídeo'}
            </span>
          </div>
        </div>

        {/* Track 2: Subtitles (shown ONLY in Steps 2 and 3) */}
        {step >= 2 && (
          <div className="flex items-center gap-2.5">
            <div className="w-20 shrink-0 flex items-center justify-between gap-1 text-[11px] font-medium text-slate-400">
              <div className="flex items-center gap-1.5 min-w-0">
                <TypeIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">Legendas</span>
              </div>
              {step === 2 && onAddSubtitleAtPlayhead && (
                <button
                  type="button"
                  title="Adicionar legenda no ponto atual"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddSubtitleAtPlayhead();
                  }}
                  className="p-0.5 rounded bg-amber-400/20 text-amber-300 hover:bg-amber-400 hover:text-slate-950 transition-colors shrink-0"
                >
                  <Plus className="w-3 h-3" />
                </button>
              )}
            </div>
            <div
              ref={subtitleTrackRef}
              className="flex-1 h-8 rounded bg-[#141824] border border-white/10 relative overflow-hidden"
            >
              {segments.map((seg) => {
                const leftPct = (seg.start / safeDuration) * 100;
                const widthPct = Math.max(1.8, ((seg.end - seg.start) / safeDuration) * 100);
                const isActive = currentTime >= seg.start && currentTime <= seg.end;
                const hasLowConf = seg.words.some((w) => w.needsReview);

                return (
                  <div
                    key={seg.id}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    title={`${formatTimePrecise(seg.start)}–${formatTimePrecise(seg.end)}: ${seg.text}`}
                    className={`group absolute top-1 bottom-1 rounded-sm border flex items-center transition-colors ${
                      step === 3
                        ? 'bg-slate-700/70 border-slate-500/40 text-slate-300'
                        : isActive
                          ? 'bg-amber-400 text-slate-950 border-amber-200 font-semibold z-10'
                          : hasLowConf
                            ? 'bg-amber-500/35 border-amber-400 text-amber-100 hover:bg-amber-500/50'
                            : 'bg-amber-400/25 border-amber-400/40 text-amber-100 hover:bg-amber-400/40'
                    }`}
                  >
                    {step === 2 && onResizeSegment && (
                      <div
                        role="separator"
                        aria-label="Ajustar início da legenda"
                        onPointerDown={(e) => startEdgeDrag(e, seg, 'start')}
                        className="w-1.5 h-full cursor-ew-resize shrink-0 hover:bg-white/60 rounded-l-sm"
                      />
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSeek(seg.start);
                      }}
                      className="flex-1 min-w-0 h-full text-[10px] px-1 truncate text-left"
                    >
                      {seg.text}
                    </button>

                    {step === 2 && onResizeSegment && (
                      <div
                        role="separator"
                        aria-label="Ajustar fim da legenda"
                        onPointerDown={(e) => startEdgeDrag(e, seg, 'end')}
                        className="w-1.5 h-full cursor-ew-resize shrink-0 hover:bg-white/60 rounded-r-sm"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Track 3: Transitions (shown ONLY in Step 3) */}
        {step === 3 && (
          <div className="flex items-center gap-2.5">
            <div className="w-20 shrink-0 flex items-center justify-between gap-1 text-[11px] font-medium text-slate-400">
              <div className="flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span>Transições</span>
              </div>
              {onAddTransitionAtPlayhead && (
                <button
                  type="button"
                  title="Adicionar transição no ponto atual"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddTransitionAtPlayhead();
                  }}
                  className="p-0.5 rounded bg-sky-400/20 text-sky-300 hover:bg-sky-400 hover:text-slate-950 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="flex-1 h-8 rounded bg-[#141824] border border-white/10 relative overflow-hidden">
              {transitionPoints.map((pt) => {
                const leftPct = Math.min(98, Math.max(1, (pt.time / safeDuration) * 100));
                const isSelected = pt.id === selectedTransitionId;
                return (
                  <button
                    key={pt.id}
                    type="button"
                    title={`${pt.type} · ${formatTimeDisplay(pt.time)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeek(Math.max(0, pt.time - 0.35));
                      onSelectTransitionPoint?.(pt);
                    }}
                    style={{ left: `${leftPct}%` }}
                    className={`absolute top-1 bottom-1 -translate-x-1/2 px-1.5 rounded text-[10px] font-semibold border whitespace-nowrap transition-colors ${
                      isSelected
                        ? 'bg-sky-400 text-slate-950 border-white z-10'
                        : 'bg-sky-500/30 text-sky-200 border-sky-400/60 hover:bg-sky-400/50'
                    }`}
                  >
                    {pt.type}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
