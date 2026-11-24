import React, { useEffect, useRef, useState } from 'react';
import {
  Pause,
  Play,
  RefreshCw,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { StyleConfig, SubtitleSegment } from '../types';
import { formatTimeDisplay, getActiveWordChunk } from '../utils/subtitles';
import { SubtitleOverlay } from './SubtitleOverlay';
import { TimelineTracks } from './TimelineTracks';

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
}: VideoPlayerShellProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [videoRatio, setVideoRatio] = useState<number>(9 / 16);
  const [liveTime, setLiveTime] = useState(currentTime);

  useEffect(() => {
    setLiveTime(currentTime);
  }, [currentTime]);

  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;

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
          onTimeSync(clipEndTime);
          onClipPlaybackComplete?.();
          return;
        }
        setLiveTime(vid.currentTime);
        onTimeSync(vid.currentTime);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, clipEndTime, videoRef, onTimeSync, onClipPlaybackComplete]);

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
                  onPlay={() => onPlayStateChange(true)}
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
