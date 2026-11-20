import React, { useLayoutEffect, useRef, useState } from 'react';
import { PRESET_DEFINITIONS, type StyleConfig } from '../types';
import type { ActiveWordChunk } from '../utils/subtitles';

interface SubtitleOverlayProps {
  chunk: ActiveWordChunk;
  liveTime: number;
  styleConfig: StyleConfig;
  containerScale?: number;
}

export function SubtitleOverlay({
  chunk,
  liveTime,
  styleConfig,
  containerScale = 0.56,
}: SubtitleOverlayProps) {
  const preset = styleConfig.preset;
  const presetMeta = PRESET_DEFINITIONS[preset];
  const basePx = presetMeta.baseFontSize;
  const fontSizePx = Math.max(
    12,
    Math.round(basePx * (styleConfig.fontScale / 100) * containerScale),
  );

  const chunkElapsed = Math.max(0, liveTime - chunk.start);
  const activeWord =
    chunk.activeWordIndex >= 0 ? chunk.words[chunk.activeWordIndex] : undefined;
  const wordElapsed = activeWord ? Math.max(0, liveTime - activeWord.start) : 0;

  // Entrance animations per preset
  let containerOpacity = 1;
  let containerTranslateY = 0;

  if (preset === 'viral_impacto') {
    // Salto rápido de baixo para cima (150ms)
    const t = Math.min(1, chunkElapsed / 0.15);
    const eased = 1 - Math.pow(1 - t, 3);
    containerOpacity = eased;
    containerTranslateY = (1 - eased) * 18;
  } else if (preset === 'neon_noturno') {
    // Fade suave + leve piscar de neon ao entrar (260ms)
    const t = Math.min(1, chunkElapsed / 0.26);
    const flicker =
      chunkElapsed < 0.22
        ? 0.65 + 0.35 * Math.abs(Math.sin(chunkElapsed * 55))
        : 1;
    containerOpacity = Math.min(1, t * 1.4) * flicker;
  } else if (preset === 'elegante_pregacao') {
    // Fade lento (300ms), sem movimentos bruscos
    containerOpacity = Math.min(1, chunkElapsed / 0.3);
  }

  // Sliding karaoke pill state for Style 4: "CAIXA DESTAQUE"
  const containerRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const [pillRect, setPillRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (preset !== 'caixa_destaque') {
      setPillRect(null);
      return;
    }
    const idx = chunk.activeWordIndex;
    const containerEl = containerRef.current;
    const wordEl = idx >= 0 ? wordRefs.current[idx] : null;
    if (!containerEl || !wordEl) {
      setPillRect(null);
      return;
    }
    setPillRect({
      left: wordEl.offsetLeft - 8,
      top: wordEl.offsetTop - 3,
      width: wordEl.offsetWidth + 16,
      height: wordEl.offsetHeight + 6,
    });
  }, [preset, chunk.chunkId, chunk.activeWordIndex, fontSizePx, styleConfig.fontFamily]);

  // Preset specific typography rules
  const isUppercase = preset === 'viral_impacto' || preset === 'neon_noturno';
  const fontWeight =
    preset === 'viral_impacto'
      ? 800
      : preset === 'neon_noturno'
        ? 700
        : preset === 'elegante_pregacao'
          ? 600
          : 800;

  const padV = Math.round(12 * containerScale * 1.25);
  const padH = Math.round(20 * containerScale * 1.25);

  return (
    <div
      className="pointer-events-none absolute inset-x-3 flex justify-center z-10"
      style={{
        top: `${styleConfig.verticalPosition}%`,
        transform: `translateY(calc(-50% + ${containerTranslateY.toFixed(1)}px))`,
        opacity: containerOpacity,
      }}
    >
      <div
        ref={containerRef}
        className="relative flex flex-wrap items-center justify-center text-center max-w-full"
        style={{
          fontFamily: `"${styleConfig.fontFamily}", sans-serif`,
          fontSize: `${fontSizePx}px`,
          fontWeight,
          lineHeight: 1.28,
          textTransform: isUppercase ? 'uppercase' : 'none',
          letterSpacing: preset === 'neon_noturno' ? '2px' : 'normal',
          gap: `0.28em`,
          ...(preset === 'caixa_destaque'
            ? {
                backgroundColor: 'rgba(0, 0, 0, 0.65)',
                borderRadius: '16px',
                padding: `${padV}px ${padH}px`,
              }
            : {
                padding: '4px 8px',
              }),
        }}
      >
        {/* Sliding Karaoke Pill for Style 4 */}
        {preset === 'caixa_destaque' && pillRect && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: `${pillRect.left}px`,
              top: `${pillRect.top}px`,
              width: `${pillRect.width}px`,
              height: `${pillRect.height}px`,
              borderRadius: '9999px',
              background: `linear-gradient(90deg, #8A2BE2 0%, ${styleConfig.highlightColor || '#FF4D8D'} 100%)`,
              transition:
                'left 120ms cubic-bezier(0.22, 1, 0.36, 1), top 120ms ease, width 120ms ease, height 120ms ease',
              zIndex: 0,
            }}
          />
        )}

        {chunk.words.map((word, idx) => {
          const isActive = idx === chunk.activeWordIndex;

          // Pop scale animation for Viral Impacto (100% -> 120% -> 100% in 150ms)
          let wordScale = 1;
          if (isActive && preset === 'viral_impacto') {
            const p = Math.min(1, wordElapsed / 0.15);
            wordScale = 1 + 0.2 * Math.sin(p * Math.PI);
          }

          let wordStyle: React.CSSProperties = {
            position: 'relative',
            zIndex: 1,
            display: 'inline-block',
            transform: `scale(${wordScale.toFixed(3)})`,
          };

          if (preset === 'viral_impacto') {
            wordStyle = {
              ...wordStyle,
              color: isActive ? styleConfig.highlightColor : styleConfig.textColor,
              WebkitTextStroke: '6px #000000',
              paintOrder: 'stroke fill',
              textShadow: '0 4px 0 #000000',
            };
          } else if (preset === 'neon_noturno') {
            const glowColor = isActive ? styleConfig.highlightColor : '#00F0FF';
            wordStyle = {
              ...wordStyle,
              color: isActive ? styleConfig.highlightColor : styleConfig.textColor,
              textShadow: `0 0 8px ${glowColor}, 0 0 20px ${glowColor}, 0 0 40px ${glowColor}`,
            };
          } else if (preset === 'elegante_pregacao') {
            wordStyle = {
              ...wordStyle,
              color: isActive ? styleConfig.highlightColor : styleConfig.textColor,
              textShadow: '0 2px 10px rgba(0, 0, 0, 0.7)',
              borderBottom: isActive
                ? `2px solid ${styleConfig.highlightColor}`
                : '2px solid transparent',
              paddingBottom: '1px',
            };
          } else if (preset === 'caixa_destaque') {
            wordStyle = {
              ...wordStyle,
              color: '#FFFFFF',
            };
          }

          return (
            <span
              key={word.id}
              ref={(el) => {
                wordRefs.current[idx] = el;
              }}
              style={wordStyle}
            >
              {word.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
