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

  if (preset === 'viral_impacto' || preset === 'mrbeast_3d' || preset === 'fogo_turbo') {
    const t = Math.min(1, chunkElapsed / 0.14);
    const eased = 1 - Math.pow(1 - t, 3);
    containerOpacity = eased;
    containerTranslateY = (1 - eased) * 16;
  } else if (preset === 'neon_noturno') {
    const t = Math.min(1, chunkElapsed / 0.26);
    const flicker =
      chunkElapsed < 0.22
        ? 0.65 + 0.35 * Math.abs(Math.sin(chunkElapsed * 55))
        : 1;
    containerOpacity = Math.min(1, t * 1.4) * flicker;
  } else if (preset === 'elegante_pregacao' || preset === 'cinema_blur') {
    containerOpacity = Math.min(1, chunkElapsed / 0.26);
  } else if (preset === 'cyber_glitch') {
    const t = Math.min(1, chunkElapsed / 0.12);
    containerOpacity = t;
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
      setPillRect((prev) => (prev === null ? prev : null));
      return;
    }
    const idx = chunk.activeWordIndex;
    const containerEl = containerRef.current;
    const wordEl = idx >= 0 ? wordRefs.current[idx] : null;
    if (!containerEl || !wordEl) {
      setPillRect((prev) => (prev === null ? prev : null));
      return;
    }
    const nextLeft = wordEl.offsetLeft - 8;
    const nextTop = wordEl.offsetTop - 3;
    const nextWidth = wordEl.offsetWidth + 16;
    const nextHeight = wordEl.offsetHeight + 6;
    setPillRect((prev) =>
      prev &&
      prev.left === nextLeft &&
      prev.top === nextTop &&
      prev.width === nextWidth &&
      prev.height === nextHeight
        ? prev
        : {
            left: nextLeft,
            top: nextTop,
            width: nextWidth,
            height: nextHeight,
          },
    );
  }, [preset, chunk.chunkId, chunk.activeWordIndex, fontSizePx, styleConfig.fontFamily]);

  // Preset-specific typography rules
  const isUppercase =
    preset === 'viral_impacto' ||
    preset === 'neon_noturno' ||
    preset === 'mrbeast_3d' ||
    preset === 'cyber_glitch' ||
    preset === 'fogo_turbo';

  const fontWeight =
    preset === 'mrbeast_3d'
      ? 900
      : preset === 'viral_impacto' || preset === 'caixa_destaque' || preset === 'cinema_blur'
        ? 800
        : preset === 'neon_noturno' || preset === 'cyber_glitch' || preset === 'fogo_turbo'
          ? 700
          : 600;

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
          letterSpacing:
            preset === 'neon_noturno'
              ? '2px'
              : preset === 'cyber_glitch' || preset === 'fogo_turbo'
                ? '1.2px'
                : 'normal',
          gap: '0.28em',
          ...(preset === 'caixa_destaque'
            ? {
                backgroundColor: 'rgba(0, 0, 0, 0.65)',
                borderRadius: '16px',
                padding: `${padV}px ${padH}px`,
              }
            : preset === 'cinema_blur'
              ? {
                  backgroundColor: 'rgba(9, 11, 16, 0.68)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  borderRadius: '14px',
                  padding: `${padV}px ${padH}px`,
                  boxShadow: '0 8px 28px rgba(0, 0, 0, 0.45)',
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

          // Word pop/impact transform calculations
          let wordScale = 1;
          let skewTransform = '';
          let glitchShiftX = 0;

          if (isActive && preset === 'viral_impacto') {
            const p = Math.min(1, wordElapsed / 0.15);
            wordScale = 1 + 0.2 * Math.sin(p * Math.PI);
          } else if (preset === 'mrbeast_3d') {
            skewTransform = ' skewX(-7deg)';
            if (isActive) {
              const p = Math.min(1, wordElapsed / 0.16);
              wordScale = 1.06 + 0.18 * Math.sin(p * Math.PI);
            }
          } else if (isActive && preset === 'cyber_glitch') {
            skewTransform = ' skewX(-8deg)';
            const p = Math.min(1, wordElapsed / 0.12);
            glitchShiftX = p < 1 ? Math.sin(wordElapsed * 140) * 2.5 * (1 - p) : 0;
            wordScale = 1.06;
          } else if (isActive && preset === 'fogo_turbo') {
            const p = Math.min(1, wordElapsed / 0.16);
            wordScale = 1.04 + 0.16 * Math.sin(p * Math.PI);
          } else if (isActive && preset === 'cinema_blur') {
            wordScale = 1.09;
          }

          let wordStyle: React.CSSProperties = {
            position: 'relative',
            zIndex: 1,
            display: 'inline-block',
            transform: `translate3d(${glitchShiftX.toFixed(1)}px, 0, 0) scale(${wordScale.toFixed(3)})${skewTransform}`,
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
          } else if (preset === 'mrbeast_3d') {
            wordStyle = {
              ...wordStyle,
              color: isActive ? styleConfig.highlightColor : styleConfig.textColor,
              WebkitTextStroke: `${Math.max(4, Math.round(fontSizePx * 0.18))}px #000000`,
              paintOrder: 'stroke fill',
              textShadow:
                '0 2px 0 #000000, 0 4px 0 #000000, 0 6px 0 #000000, 0 8px 10px rgba(0,0,0,0.85)',
            };
          } else if (preset === 'cyber_glitch') {
            const accent = styleConfig.highlightColor || '#00F0FF';
            if (isActive) {
              wordStyle = {
                ...wordStyle,
                backgroundColor: accent,
                color: '#05070B',
                padding: '0.04em 0.28em',
                borderRadius: '4px',
                boxShadow: `0 0 16px ${accent}, 0 3px 0 #000000`,
              };
            } else {
              wordStyle = {
                ...wordStyle,
                color: styleConfig.textColor,
                textShadow: `-2.5px 0 #00F0FF, 2.5px 0 #FF0055, 0 2px 6px rgba(0,0,0,0.85)`,
              };
            }
          } else if (preset === 'fogo_turbo') {
            const fireAccent = styleConfig.highlightColor || '#FF7A00';
            if (isActive) {
              wordStyle = {
                ...wordStyle,
                backgroundImage: `linear-gradient(180deg, #FFFFFF 0%, #FFE600 42%, ${fireAccent} 100%)`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                filter: `drop-shadow(0 2px 0 #000000) drop-shadow(0 -1.5px 0 #000000) drop-shadow(1.5px 0 0 #000000) drop-shadow(-1.5px 0 0 #000000) drop-shadow(0 4px 2px rgba(0,0,0,0.95)) drop-shadow(0 0 16px ${fireAccent})`,
              };
            } else {
              wordStyle = {
                ...wordStyle,
                color: styleConfig.textColor,
                WebkitTextStroke: `${Math.max(3, Math.round(fontSizePx * 0.14))}px #000000`,
                paintOrder: 'stroke fill',
                textShadow: '0 3px 0 #000000',
              };
            }
          } else if (preset === 'cinema_blur') {
            const gold = styleConfig.highlightColor || '#FFB800';
            wordStyle = {
              ...wordStyle,
              color: isActive ? gold : styleConfig.textColor,
              opacity: isActive ? 1 : 0.48,
              filter: isActive ? 'blur(0px)' : 'blur(0.85px)',
              textShadow: isActive
                ? `0 0 16px ${gold}99, 0 2px 10px rgba(0,0,0,0.85)`
                : '0 2px 6px rgba(0,0,0,0.6)',
              transition: 'opacity 140ms ease, filter 140ms ease, transform 140ms ease',
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
