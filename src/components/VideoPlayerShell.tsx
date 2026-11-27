import React, { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Pause,
  Play,
  RefreshCw,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  NoiseReductionConfig,
  NoiseReductionLevel,
  StyleConfig,
  SubtitleSegment,
} from '../types';
import {
  attachNoiseReductionChain,
  type NoiseReductionGraphHandle,
} from '../utils/audioNoiseReduction';
import { formatTimeDisplay, getActiveWordChunk } from '../utils/subtitles';
import { SubtitleOverlay } from './SubtitleOverlay';
import { TimelineTracks } from './TimelineTracks';

const videoNoiseGraphs = new WeakMap<
  HTMLVideoElement,
  { ctx: AudioContext; handle: NoiseReductionGraphHandle }
>();

const NOISE_LEVEL_OPTIONS: Array<{
  value: NoiseReductionLevel;
  label: string;
}> = [
  { value: 'light', label: 'Suave' },
  { value: 'medium', label: 'Médio' },
  { value: 'strong', label: 'Forte' },
];

interface VideoPlayerShellProps {
  step: 1 | 2;
  videoUrl: string | null;
  videoFileName: string | null;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  segments: SubtitleSegment[];
  styleConfig: StyleConfig;
  clipEndTime?: number | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onSelectFile?: (file: File) => void;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onTimeSync: (time: number) => void;
  onLoadedMetadata: (duration: number) => void;
  onPlayStateChange: (playing: boolean) => void;
  onClipPlaybackComplete?: () => void;
  onAddSubtitleAtPlayhead?: () => void;
  onResizeSegmentStart?: () => void;
  onResizeSegment?: (segmentId: string, nextStart: number, nextEnd: number) => void;
  noiseReduction?: NoiseReductionConfig;
  onNoiseReductionChange?: (next: NoiseReductionConfig) => void;
}

export function VideoPlayerShell({
  step,
  videoUrl,
  videoFileName,
  duration,
  currentTime,
  isPlaying,
  segments,
  styleConfig,
  clipEndTime = null,
  videoRef,
  onSelectFile,
  onTogglePlay,
  onSeek,
  onTimeSync,
  onLoadedMetadata,
  onPlayStateChange,
  onClipPlaybackComplete,
  onAddSubtitleAtPlayhead,
  onResizeSegmentStart,
  onResizeSegment,
  noiseReduction = { enabled: false, level: 'medium' },
  onNoiseReductionChange,
}: VideoPlayerShellProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [videoRatio, setVideoRatio] = useState<number>(9 / 16);
  const [liveTime, setLiveTime] = useState(currentTime);
  const onTimeSyncRef = useRef(onTimeSync);
  const onClipPlaybackCompleteRef = useRef(onClipPlaybackComplete);
  onTimeSyncRef.current = onTimeSync;
  onClipPlaybackCompleteRef.current = onClipPlaybackComplete;

  useEffect(() => {
    if (!isPlaying) {
      setLiveTime((prev) => (prev === currentTime ? prev : currentTime));
    }
  }, [currentTime, isPlaying]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !videoUrl) return;
    let entry = videoNoiseGraphs.get(vid);
    if (!entry && !noiseReduction.enabled) {
      return;
    }
    if (!entry) {
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const source = ctx.createMediaElementSource(vid);
        const handle = attachNoiseReductionChain(
          ctx,
          source,
          ctx.destination,
          noiseReduction,
        );
        entry = { ctx, handle };
        videoNoiseGraphs.set(vid, entry);
      } catch {
        return;
      }
    } else {
      entry.handle.updateConfig(noiseReduction);
    }
    if (isPlaying || noiseReduction.enabled) {
      void entry.handle.resumeIfSuspended();
    }
  }, [noiseReduction, isPlaying, videoUrl, videoRef]);

  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;
    let lastCommittedTime = -1;

    const tick = () => {
      const vid = videoRef.current;
      if (vid) {
        if (
          clipEndTime !== null &&
          clipEndTime !== undefined &&
          vid.currentTime >= clipEndTime
        ) {
          vid.pause();
          vid.currentTime = clipEndTime;
          setLiveTime(clipEndTime);
          onTimeSyncRef.current(clipEndTime);
          onClipPlaybackCompleteRef.current?.();
          return;
        }
        const nextT = vid.currentTime;
        if (Math.abs(nextT - lastCommittedTime) >= 0.001) {
          lastCommittedTime = nextT;
          setLiveTime(nextT);
          onTimeSyncRef.current(nextT);
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, clipEndTime, videoRef]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && onSelectFile) onSelectFile(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onSelectFile) onSelectFile(file);
    e.target.value = '';
  };

  const activeChunk =
    step === 2 ? getActiveWordChunk(segments, liveTime) : null;

  const isPortrait = videoRatio < 1;

  return (
    <div className="flex flex-col gap-4">
      {onSelectFile && (
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v"
          onChange={handleFileChange}
          className="hidden"
        />
      )}

      {!videoUrl ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className={`min-h-[400px] rounded-xl border border-dashed transition-colors cursor-pointer flex flex-col items-center justify-center p-8 text-center ${
            isDragging
              ? 'border-amber-400 bg-amber-400/10'
              : 'border-white/15 bg-[#11141D] hover:border-white/30 hover:bg-[#141824]'
          }`}
        >
          <div className="w-12 h-12 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center mb-4 text-amber-400">
            <Upload className="w-5 h-5" />
          </div>
          <h2 className="text-base font-semibold text-slate-100 mb-1.5">
            Envie seu vídeo para começar
          </h2>
          <p className="text-sm text-slate-400 max-w-sm mb-5 leading-relaxed">
            Arraste o arquivo MP4, MOV ou WebM aqui ou clique para selecionar do computador.
          </p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            className="px-4 py-2 rounded-lg bg-amber-400 text-slate-950 text-sm font-semibold hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0"
          >
            Selecionar vídeo
          </button>
          <p className="text-xs text-slate-500 mt-4">
            Formatos aceitos: MP4, MOV ou WebM · Até 200 MB
          </p>
        </div>
      ) : (
        <>
          <div className="bg-[#11141D] border border-white/10 rounded-xl p-4 flex flex-col gap-3">
            <div className="relative w-full bg-[#05070B] rounded-lg overflow-hidden border border-white/10 flex items-center justify-center min-h-[300px] max-h-[460px]">
              <div
                className="relative overflow-hidden flex items-center justify-center w-full"
                style={{
                  aspectRatio: isPortrait ? '9 / 16' : '16 / 9',
                  maxHeight: '440px',
                  maxWidth: isPortrait ? '255px' : '100%',
                }}
              >
                <video
                  ref={videoRef}
                  src={videoUrl}
                  muted={isMuted}
                  playsInline
                  onClick={onTogglePlay}
                  onPlay={(e) => {
                    const entry = videoNoiseGraphs.get(e.currentTarget);
                    if (entry) {
                      void entry.handle.resumeIfSuspended();
                    }
                    onPlayStateChange(true);
                  }}
                  onPause={() => onPlayStateChange(false)}
                  onEnded={() => onPlayStateChange(false)}
                  onLoadedMetadata={(e) => {
                    const vid = e.currentTarget;
                    if (vid.videoWidth && vid.videoHeight) {
                      setVideoRatio(vid.videoWidth / vid.videoHeight);
                    }
                    onLoadedMetadata(vid.duration || 0);
                  }}
                  onTimeUpdate={(e) => {
                    if (!isPlaying) {
                      const t = e.currentTarget.currentTime;
                      setLiveTime(t);
                      onTimeSync(t);
                    }
                  }}
                  className="w-full h-full object-contain cursor-pointer select-none"
                />

                {activeChunk && (
                  <SubtitleOverlay
                    chunk={activeChunk}
                    liveTime={liveTime}
                    styleConfig={styleConfig}
                    containerScale={isPortrait ? 0.48 : 0.56}
                  />
                )}

                {!isPlaying && (
                  <button
                    type="button"
                    onClick={onTogglePlay}
                    aria-label="Reproduzir vídeo"
                    className="absolute inset-0 m-auto w-12 h-12 rounded-full bg-black/55 border border-white/20 flex items-center justify-center text-white hover:bg-black/75 transition-colors"
                  >
                    <Play className="w-5 h-5 fill-current ml-0.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Transport Controls */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onTogglePlay}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181C27] border border-white/10 text-slate-100 text-xs font-medium hover:bg-white/10 transition-colors whitespace-nowrap"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-3.5 h-3.5" />
                      Pausar
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      Reproduzir
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setIsMuted((m) => !m)}
                  aria-label={isMuted ? 'Ativar som' : 'Silenciar vídeo'}
                  className="p-1.5 rounded-lg bg-[#181C27] border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                >
                  {isMuted ? (
                    <VolumeX className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <span className="font-mono-tabular text-xs text-slate-400 ml-1">
                  {formatTimeDisplay(liveTime)} / {formatTimeDisplay(duration)}
                </span>
              </div>

              {step === 1 && onSelectFile && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-colors whitespace-nowrap"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Trocar vídeo
                </button>
              )}
            </div>

            {onNoiseReductionChange && (
              <div className="pt-3 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                      noiseReduction.enabled
                        ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                        : 'bg-[#181C27] border-white/10 text-slate-400'
                    }`}
                  >
                    <AudioLines className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-100">
                      Reduzir ruído do vídeo
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">
                      Suaviza chiado, vento e ruído de fundo na prévia, transcrição e exportação
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {noiseReduction.enabled && (
                    <div
                      role="group"
                      aria-label="Intensidade da redução de ruído"
                      className="inline-flex items-center rounded-lg bg-[#090B10] border border-white/10 p-0.5"
                    >
                      {NOISE_LEVEL_OPTIONS.map((opt) => {
                        const active = noiseReduction.level === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() =>
                              onNoiseReductionChange({
                                ...noiseReduction,
                                level: opt.value,
                              })
                            }
                            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                              active
                                ? 'bg-amber-400 text-slate-950'
                                : 'text-slate-300 hover:text-white'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <button
                    type="button"
                    role="switch"
                    aria-checked={noiseReduction.enabled}
                    onClick={() =>
                      onNoiseReductionChange({
                        ...noiseReduction,
                        enabled: !noiseReduction.enabled,
                      })
                    }
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap ${
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
          </div>

          <TimelineTracks
            step={step}
            duration={duration}
            currentTime={liveTime}
            videoFileName={videoFileName}
            segments={segments}
            onSeek={onSeek}
            onAddSubtitleAtPlayhead={onAddSubtitleAtPlayhead}
            onResizeSegmentStart={onResizeSegmentStart}
            onResizeSegment={onResizeSegment}
          />
        </>
      )}
    </div>
  );
}
