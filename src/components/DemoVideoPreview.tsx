import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SubtitlePreset } from '../types';

/**
 * CONFIGURAÇÃO FÁCIL DO VÍDEO REAL:
 * Cole abaixo a URL ou caminho do seu arquivo de vídeo (ex: "/demo-dewes.mp4" ou "https://...").
 * Enquanto estiver vazio (""), será exibida a demonstração animada automática de criação de legendas.
 */
export const VIDEO_URL = '';

/**
 * VELOCIDADE DA DEMONSTRAÇÃO (em milissegundos)
 * Edite facilmente os tempos abaixo para acelerar ou desacelerar o ritmo.
 */
export const VELOCIDADE = {
  /** Tempo entre cada palavra falada */
  msPorPalavra: 460,
  /** Pausa breve após a última palavra antes de iniciar a correção */
  msInicioCorrecao: 300,
  /** Duração total da correção com cursor piscando e troca de cor */
  msDuracaoCorrecao: 780,
  /** Tempo de exibição da frase pronta antes do fade de saída */
  msPausaFinal: 720,
  /** Duração do fade de saída entre uma frase e outra */
  msFadeSaida: 300,
};

export interface DemoFrase {
  preset: SubtitlePreset;
  estiloLabel: string;
  tagline: string;
  palavras: string[];
  /** Índice da palavra corrigida ao vivo pelo cursor */
  correcaoIndice: number;
  /** Como a palavra aparece antes da correção */
  correcaoAntes: string;
  /** Como a palavra fica após a correção (com mudança de cor) */
  correcaoDepois: string;
}

/**
 * FRASES DA DEMONSTRAÇÃO (em ordem dos 4 estilos)
 * Edite livremente os textos abaixo.
 */
export const FRASES: DemoFrase[] = [
  {
    preset: 'viral_impacto',
    estiloLabel: 'Estilo: Viral Impacto',
    tagline: 'Legendas dinâmicas que prendem a atenção.',
    palavras: ['CRIE', 'VÍDEOS', 'QUE', 'PRENDEM'],
    correcaoIndice: 1,
    correcaoAntes: 'VIDEOS',
    correcaoDepois: 'VÍDEOS',
  },
  {
    preset: 'neon_noturno',
    estiloLabel: 'Estilo: Neon Noturno',
    tagline: 'Brilho intenso sincronizado com cada palavra.',
    palavras: ['LEGENDAS', 'EM', 'SEGUNDOS'],
    correcaoIndice: 0,
    correcaoAntes: 'LEGENDA',
    correcaoDepois: 'LEGENDAS',
  },
  {
    preset: 'elegante_pregacao',
    estiloLabel: 'Estilo: Elegante Pregação',
    tagline: 'Tipografia refinada e destaque suave na fala.',
    palavras: ['Destaque', 'cada', 'palavra'],
    correcaoIndice: 2,
    correcaoAntes: 'palvra',
    correcaoDepois: 'palavra',
  },
  {
    preset: 'caixa_destaque',
    estiloLabel: 'Estilo: Caixa Destaque',
    tagline: 'Efeito karaokê pronto para viralizar.',
    palavras: ['Seu', 'vídeo', 'pronto', 'para', 'viralizar'],
    correcaoIndice: 3,
    correcaoAntes: 'pra',
    correcaoDepois: 'para',
  },
];

type EditStage = 'none' | 'cursor_before' | 'cursor_after' | 'corrected';

interface ParticleSpec {
  id: number;
  leftPct: number;
  bottomPct: number;
  sizePx: number;
  durationSec: number;
  delaySec: number;
  driftPx: number;
  opacity: number;
  color: string;
}

interface EqualizerBarSpec {
  freqA: number;
  freqB: number;
  phase: number;
  envelope: number;
}

const EQUALIZER_BARS: EqualizerBarSpec[] = Array.from({ length: 24 }, (_, idx) => {
  const norm = idx / 23; // 0..1
  const centerDist = Math.abs(norm - 0.5) * 2; // 0 at center, 1 at edges
  const envelope = 0.42 + (1 - centerDist * centerDist) * 0.58;
  return {
    freqA: 7.2 + ((idx * 1.9) % 5.4),
    freqB: 11.5 + ((idx * 2.7) % 6.1),
    phase: idx * 0.68,
    envelope,
  };
});

const PARTICLES_ALL: ParticleSpec[] = Array.from({ length: 16 }, (_, idx) => {
  const colors = ['#8A2BE2', '#FF4D8D', '#C084FC', '#F472B6', '#38BDF8'];
  return {
    id: idx,
    leftPct: 6 + ((idx * 19) % 88),
    bottomPct: -4 - ((idx * 7) % 16),
    sizePx: 2 + (idx % 3) * 1.4,
    durationSec: 5.4 + (idx % 5) * 1.25,
    delaySec: -((idx * 1.35) % 6.5),
    driftPx: (idx % 2 === 0 ? 1 : -1) * (8 + (idx % 4) * 6),
    opacity: 0.28 + (idx % 4) * 0.14,
    color: colors[idx % colors.length],
  };
});

export function DemoVideoPreview() {
  const [fraseIdx, setFraseIdx] = useState(0);
  const [visibleCount, setVisibleCount] = useState(1);
  const [activeWordIdx, setActiveWordIdx] = useState(0);
  const [generationDone, setGenerationDone] = useState(false);
  const [editStage, setEditStage] = useState<EditStage>('none');
  const [isExiting, setIsExiting] = useState(false);

  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  // Refs updated directly at 60fps via requestAnimationFrame (0 React re-renders per frame)
  const tiltContainerRef = useRef<HTMLDivElement | null>(null);
  const headGroupRef = useRef<SVGGElement | null>(null);
  const mouthRef = useRef<SVGEllipseElement | null>(null);
  const mouthInnerRef = useRef<SVGEllipseElement | null>(null);
  const eyeLeftRef = useRef<SVGEllipseElement | null>(null);
  const eyeRightRef = useRef<SVGEllipseElement | null>(null);
  const ringsAuraRef = useRef<HTMLDivElement | null>(null);
  const eqBarRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const progressFillRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);

  // Refs for sliding karaoke pill in "Caixa Destaque"
  const caixaContainerRef = useRef<HTMLDivElement | null>(null);
  const wordSpanRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const [karaokePill, setKaraokePill] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    visible: boolean;
  }>({ left: 0, top: 0, width: 0, height: 0, visible: false });

  const fraseAtual = FRASES[fraseIdx % FRASES.length];

  // Accessibility + responsive particle count listeners
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const motionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mobileMq = window.matchMedia('(max-width: 767px)');

    const syncMotion = () => setPrefersReducedMotion(motionMq.matches);
    const syncMobile = () => setIsMobileViewport(mobileMq.matches);

    syncMotion();
    syncMobile();

    motionMq.addEventListener('change', syncMotion);
    mobileMq.addEventListener('change', syncMobile);
    return () => {
      motionMq.removeEventListener('change', syncMotion);
      mobileMq.removeEventListener('change', syncMobile);
    };
  }, []);

  // Simple fade-only cycle when prefers-reduced-motion is enabled
  useEffect(() => {
    if (!prefersReducedMotion || VIDEO_URL) return;

    setVisibleCount(fraseAtual.palavras.length);
    setActiveWordIdx(fraseAtual.palavras.length - 1);
    setGenerationDone(true);
    setEditStage('corrected');
    setIsExiting(false);

    const fadeTimer = window.setTimeout(() => {
      setIsExiting(true);
    }, 2400);

    const nextTimer = window.setTimeout(() => {
      setFraseIdx((prev) => (prev + 1) % FRASES.length);
    }, 2700);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(nextTimer);
    };
  }, [prefersReducedMotion, fraseIdx, fraseAtual.palavras.length]);

  // Main 60fps requestAnimationFrame animation & timeline scheduler
  useEffect(() => {
    if (prefersReducedMotion || VIDEO_URL) return;

    let rafId = 0;
    let phraseStartMs = performance.now();
    let activePhrase = fraseIdx;

    // Track last committed discrete React states to avoid redundant setState calls
    let lastVisible = 1;
    let lastActiveWord = 0;
    let lastGenDone = false;
    let lastEditStage: EditStage = 'none';
    let lastExiting = false;

    setVisibleCount(1);
    setActiveWordIdx(0);
    setGenerationDone(false);
    setEditStage('none');
    setIsExiting(false);

    const tick = (now: number) => {
      const currentPhrase = FRASES[activePhrase % FRASES.length];
      const wordCount = currentPhrase.palavras.length;

      const genDuration = wordCount * VELOCIDADE.msPorPalavra;
      const beforeFixEnd = genDuration + VELOCIDADE.msInicioCorrecao;
      const fixMid = beforeFixEnd + VELOCIDADE.msDuracaoCorrecao * 0.48;
      const fixEnd = beforeFixEnd + VELOCIDADE.msDuracaoCorrecao;
      const holdEnd = fixEnd + VELOCIDADE.msPausaFinal;
      const totalDuration = holdEnd + VELOCIDADE.msFadeSaida;

      const elapsed = now - phraseStartMs;

      if (elapsed >= totalDuration) {
        activePhrase = (activePhrase + 1) % FRASES.length;
        phraseStartMs = now;
        lastVisible = 1;
        lastActiveWord = 0;
        lastGenDone = false;
        lastEditStage = 'none';
        lastExiting = false;

        setFraseIdx(activePhrase);
        setVisibleCount(1);
        setActiveWordIdx(0);
        setGenerationDone(false);
        setEditStage('none');
        setIsExiting(false);
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      // 1. Compute discrete subtitle & cursor milestones
      const nextWordIdx = Math.min(
        wordCount - 1,
        Math.floor(elapsed / VELOCIDADE.msPorPalavra),
      );
      const nextVisible = Math.min(wordCount, nextWordIdx + 1);
      const nextGenDone = elapsed >= genDuration;

      let nextEditStage: EditStage = 'none';
      if (elapsed >= beforeFixEnd && elapsed < fixMid) {
        nextEditStage = 'cursor_before';
      } else if (elapsed >= fixMid && elapsed < fixEnd) {
        nextEditStage = 'cursor_after';
      } else if (elapsed >= fixEnd) {
        nextEditStage = 'corrected';
      }

      const nextExiting = elapsed >= holdEnd;

      if (nextVisible !== lastVisible) {
        lastVisible = nextVisible;
        setVisibleCount(nextVisible);
      }
      if (nextWordIdx !== lastActiveWord) {
        lastActiveWord = nextWordIdx;
        setActiveWordIdx(nextWordIdx);
      }
      if (nextGenDone !== lastGenDone) {
        lastGenDone = nextGenDone;
        setGenerationDone(nextGenDone);
      }
      if (nextEditStage !== lastEditStage) {
        lastEditStage = nextEditStage;
        setEditStage(nextEditStage);
      }
      if (nextExiting !== lastExiting) {
        lastExiting = nextExiting;
        setIsExiting(nextExiting);
      }

      // 2. Continuous 60fps DOM updates via refs
      const tSec = now * 0.001;
      const genRatio = Math.min(1, Math.max(0, elapsed / genDuration));
      const wordProgress = (elapsed % VELOCIDADE.msPorPalavra) / VELOCIDADE.msPorPalavra;
      const isSpeaking = elapsed < genDuration;

      // Syllable burst envelope inside each word (peaks early-mid word, dips between words)
      const syllablePulse = isSpeaking
        ? Math.sin(Math.min(1, wordProgress) * Math.PI) * 0.65 +
          Math.abs(Math.sin(tSec * 15.2)) * 0.35
        : 0.05;

      // Progress bar & mini timeline playhead
      if (progressFillRef.current) {
        progressFillRef.current.style.transform = `scaleX(${genRatio.toFixed(4)})`;
      }
      if (playheadRef.current) {
        const timelineProgress = Math.min(1, elapsed / holdEnd);
        playheadRef.current.style.transform = `translate3d(${(timelineProgress * 100).toFixed(2)}%, 0, 0)`;
      }

      // Head tilt (gentle 2 to 3 degree sway while speaking)
      if (headGroupRef.current) {
        const tiltDeg = isSpeaking
          ? Math.sin(tSec * 2.6) * 2.4 + Math.cos(tSec * 4.1) * 0.55
          : Math.sin(tSec * 1.1) * 0.5;
        const bobY = isSpeaking ? Math.sin(tSec * 6.5) * 1.1 : 0;
        headGroupRef.current.style.transform = `translate3d(0, ${bobY.toFixed(2)}px, 0) rotate(${tiltDeg.toFixed(2)}deg)`;
      }

      // Mouth animation synchronized with speech rhythm
      if (mouthRef.current && mouthInnerRef.current) {
        const mouthOpen = isSpeaking ? 0.18 + syllablePulse * 0.82 : 0.06;
        const ry = 1.2 + mouthOpen * 4.6;
        const rx = 6.2 - mouthOpen * 0.9;
        mouthRef.current.setAttribute('ry', ry.toFixed(2));
        mouthRef.current.setAttribute('rx', rx.toFixed(2));
        mouthInnerRef.current.setAttribute('ry', Math.max(0.4, ry - 1.1).toFixed(2));
        mouthInnerRef.current.setAttribute('rx', Math.max(2, rx - 1.2).toFixed(2));
        mouthInnerRef.current.style.opacity = isSpeaking ? '0.9' : '0.2';
      }

      // Natural eye blink every ~3.8 seconds
      const blinkCycle = tSec % 3.8;
      const blinkScaleY = blinkCycle > 3.66 && blinkCycle < 3.79 ? 0.12 : 1;
      if (eyeLeftRef.current && eyeRightRef.current) {
        eyeLeftRef.current.style.transform = `scaleY(${blinkScaleY})`;
        eyeRightRef.current.style.transform = `scaleY(${blinkScaleY})`;
      }

      // Sound aura scale boost tied to speech energy
      if (ringsAuraRef.current) {
        const auraScale = 1 + syllablePulse * 0.08;
        ringsAuraRef.current.style.transform = `scale(${auraScale.toFixed(3)})`;
      }

      // 24-bar sound equalizer at 60fps
      for (let i = 0; i < EQUALIZER_BARS.length; i++) {
        const barEl = eqBarRefs.current[i];
        if (!barEl) continue;
        const spec = EQUALIZER_BARS[i];
        const wave =
          0.5 +
          0.5 *
            Math.sin(tSec * spec.freqA + spec.phase) *
            Math.cos(tSec * spec.freqB * 0.55 - spec.phase * 0.5);
        const energy = isSpeaking ? 0.25 + syllablePulse * 0.75 : 0.14;
        const scaleY = Math.min(1, Math.max(0.14, (0.16 + wave * 0.84) * spec.envelope * energy + 0.12));
        barEl.style.transform = `scaleY(${scaleY.toFixed(3)})`;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [fraseIdx, prefersReducedMotion]);

  // Measure active word position for the sliding karaoke pill in "Caixa Destaque"
  useLayoutEffect(() => {
    if (fraseAtual.preset !== 'caixa_destaque') {
      setKaraokePill((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      return;
    }

    const container = caixaContainerRef.current;
    const activeEl = wordSpanRefs.current[activeWordIdx];
    if (!container || !activeEl) return;

    const left = activeEl.offsetLeft;
    const top = activeEl.offsetTop;
    const width = activeEl.offsetWidth;
    const height = activeEl.offsetHeight;

    setKaraokePill((prev) =>
      prev.visible &&
      prev.left === left &&
      prev.top === top &&
      prev.width === width &&
      prev.height === height
        ? prev
        : { left, top, width, height, visible: true },
    );
  }, [fraseAtual.preset, fraseIdx, activeWordIdx, visibleCount, editStage]);

  // 3D parallax hover handlers (pure CSS transform on ref)
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (prefersReducedMotion || !tiltContainerRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1; // -1..1
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1; // -1..1
    const rotY = nx * 7.5;
    const rotX = -ny * 6.5;
    tiltContainerRef.current.style.transform = `rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`;
  };

  const handleMouseLeave = () => {
    if (!tiltContainerRef.current) return;
    tiltContainerRef.current.style.transform = 'rotateX(0deg) rotateY(0deg)';
  };

  const particles = useMemo(() => {
    if (prefersReducedMotion) return [];
    return isMobileViewport ? PARTICLES_ALL.slice(0, 5) : PARTICLES_ALL;
  }, [prefersReducedMotion, isMobileViewport]);

  const visibleWords = fraseAtual.palavras.slice(0, visibleCount);

  return (
    <div
      className="flex flex-col items-center justify-center w-full max-w-[390px] mx-auto select-none"
      style={{ perspective: '1000px' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Subtle 3D tilt layer */}
      <div
        ref={tiltContainerRef}
        className="relative w-full max-w-[308px] transition-transform duration-300 ease-out"
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/* Gentle 4-second 8px vertical float wrapper */}
        <div
          className="relative w-full"
          style={
            prefersReducedMotion
              ? undefined
              : { animation: 'dewes-phone-float 4s ease-in-out infinite' }
          }
        >
          {/* Slowly pulsing purple aura around the phone */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-5 rounded-[40px] blur-2xl"
            style={{
              background:
                'radial-gradient(circle at 50% 45%, rgba(138, 43, 226, 0.52) 0%, rgba(255, 77, 141, 0.24) 48%, transparent 74%)',
              ...(prefersReducedMotion
                ? { opacity: 0.5 }
                : { animation: 'dewes-glow-pulse 4.5s ease-in-out infinite' }),
            }}
          />

          {/* Phone Mockup Frame */}
          <div className="relative w-full aspect-[9/16] rounded-[30px] overflow-hidden bg-[#080B18] border border-purple-400/35 shadow-[0_24px_70px_-14px_rgba(138,43,226,0.55)]">
            {VIDEO_URL ? (
              <video
                src={VIDEO_URL}
                autoPlay
                muted
                loop
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="relative w-full h-full flex flex-col justify-between overflow-hidden">
                {/* Base dark-blue gradient */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      'linear-gradient(165deg, #091533 0%, #0B1024 55%, #070913 100%)',
                  }}
                />

                {/* Crossfading dark-purple gradient layer (slow shift between purple & blue) */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      'linear-gradient(155deg, #250D44 0%, #150C33 52%, #0B0A19 100%)',
                    ...(prefersReducedMotion
                      ? { opacity: 0.65 }
                      : { animation: 'dewes-bg-shift 9s ease-in-out infinite' }),
                  }}
                />

                {/* Studio top spotlight */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full blur-3xl opacity-45"
                  style={{
                    background:
                      'radial-gradient(circle, rgba(138,43,226,0.6) 0%, rgba(255,77,141,0.22) 55%, transparent 78%)',
                  }}
                />

                {/* Floating upward particles */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 overflow-hidden"
                >
                  {particles.map((p) => (
                    <span
                      key={p.id}
                      className="absolute rounded-full will-change-transform"
                      style={
                        {
                          left: `${p.leftPct}%`,
                          bottom: `${p.bottomPct}%`,
                          width: `${p.sizePx}px`,
                          height: `${p.sizePx}px`,
                          backgroundColor: p.color,
                          boxShadow: `0 0 ${p.sizePx * 3}px ${p.color}`,
                          '--p-drift': `${p.driftPx}px`,
                          '--p-opacity': String(p.opacity),
                          animation: `dewes-particle-rise ${p.durationSec}s linear ${p.delaySec}s infinite`,
                        } as React.CSSProperties
                      }
                    />
                  ))}
                </div>

                {/* TOP LAYER: Slim generation progress bar + Style badge */}
                <div className="relative z-10 px-4 pt-4 space-y-2.5">
                  {/* Slim progress bar ("Gerando legendas..." -> "Legendas prontas ✓") */}
                  <div className="rounded-xl bg-black/45 backdrop-blur-sm border border-white/10 px-3 py-2">
                    <div className="flex items-center justify-between text-[10px] font-semibold tracking-wide mb-1.5">
                      <span
                        className={
                          generationDone
                            ? 'text-emerald-300 transition-colors duration-200'
                            : 'text-purple-200 transition-colors duration-200'
                        }
                      >
                        {generationDone
                          ? 'Legendas prontas ✓'
                          : 'Gerando legendas...'}
                      </span>
                      <span className="text-[9px] font-mono text-slate-400">
                        {fraseIdx + 1}/{FRASES.length}
                      </span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
                      <div
                        ref={progressFillRef}
                        className="h-full w-full rounded-full origin-left will-change-transform"
                        style={{
                          transform: prefersReducedMotion ? 'scaleX(1)' : 'scaleX(0)',
                          background: generationDone
                            ? 'linear-gradient(90deg, #8A2BE2 0%, #34D399 100%)'
                            : 'linear-gradient(90deg, #8A2BE2 0%, #FF4D8D 100%)',
                        }}
                      />
                    </div>
                  </div>

                  {/* Animated Style Badge at top */}
                  <div className="flex justify-center">
                    <div
                      key={fraseAtual.estiloLabel}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-950/70 border border-purple-400/30 text-[11px] font-semibold text-purple-100 shadow-sm backdrop-blur-sm"
                      style={
                        prefersReducedMotion
                          ? undefined
                          : { animation: 'dewes-style-badge-in 260ms ease-out forwards' }
                      }
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{
                          background:
                            'linear-gradient(135deg, #8A2BE2 0%, #FF4D8D 100%)',
                        }}
                      />
                      <span>{fraseAtual.estiloLabel}</span>
                    </div>
                  </div>
                </div>

                {/* CENTER STAGE: Stylized Speaker SVG + Expanding Wave Rings + 24-Bar Equalizer */}
                <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 pt-1">
                  {/* Speaker Portrait + Pulsing Wave Rings */}
                  <div className="relative flex items-center justify-center mb-4">
                    <div
                      ref={ringsAuraRef}
                      aria-hidden="true"
                      className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    >
                      {!prefersReducedMotion ? (
                        <>
                          <span
                            className="absolute w-28 h-28 rounded-full border-2 border-[#8A2BE2]/65"
                            style={{
                              animation:
                                'dewes-ring-wave 2.1s cubic-bezier(0.16, 1, 0.3, 1) 0s infinite',
                            }}
                          />
                          <span
                            className="absolute w-28 h-28 rounded-full border-2 border-[#FF4D8D]/60"
                            style={{
                              animation:
                                'dewes-ring-wave 2.1s cubic-bezier(0.16, 1, 0.3, 1) 0.7s infinite',
                            }}
                          />
                          <span
                            className="absolute w-28 h-28 rounded-full border border-purple-300/45"
                            style={{
                              animation:
                                'dewes-ring-wave 2.1s cubic-bezier(0.16, 1, 0.3, 1) 1.4s infinite',
                            }}
                          />
                        </>
                      ) : (
                        <span className="absolute w-32 h-32 rounded-full border border-purple-400/30" />
                      )}
                    </div>

                    {/* Stylized Modern Vector Speaker SVG */}
                    <div className="relative w-28 h-28 rounded-full p-[2px] bg-gradient-to-br from-[#8A2BE2] via-purple-500/40 to-[#FF4D8D] shadow-[0_0_28px_rgba(138,43,226,0.45)]">
                      <div className="w-full h-full rounded-full overflow-hidden bg-gradient-to-b from-[#1D123A] to-[#0B0E1D] flex items-center justify-center">
                        <svg
                          viewBox="0 0 120 120"
                          className="w-full h-full"
                          aria-label="Pessoa falando no estúdio"
                        >
                          <defs>
                            <linearGradient id="dewesCoatGrad" x1="0" y1="0" x2="1" y2="1">
                              <stop offset="0%" stopColor="#3B236E" />
                              <stop offset="100%" stopColor="#1B1336" />
                            </linearGradient>
                            <linearGradient id="dewesSkinGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#F5C9A8" />
                              <stop offset="100%" stopColor="#E4AC86" />
                            </linearGradient>
                            <linearGradient id="dewesHairGrad" x1="0" y1="0" x2="1" y2="1">
                              <stop offset="0%" stopColor="#26174A" />
                              <stop offset="100%" stopColor="#110B24" />
                            </linearGradient>
                          </defs>

                          {/* Shoulders / Jacket */}
                          <path
                            d="M22 122 C24 94, 42 86, 60 86 C78 86, 96 94, 98 122 Z"
                            fill="url(#dewesCoatGrad)"
                            stroke="#8A2BE2"
                            strokeOpacity="0.4"
                            strokeWidth="1.2"
                          />
                          {/* Collar glow V-accent */}
                          <path
                            d="M48 88 L60 101 L72 88"
                            fill="none"
                            stroke="#FF4D8D"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeOpacity="0.7"
                          />

                          {/* Animated Head Group (tilts 2-3 deg with speech rhythm) */}
                          <g
                            ref={headGroupRef}
                            style={{
                              transformOrigin: '60px 84px',
                            }}
                          >
                            {/* Neck */}
                            <rect
                              x="53"
                              y="74"
                              width="14"
                              height="15"
                              rx="6"
                              fill="#DCA17C"
                            />

                            {/* Back Hair */}
                            <path
                              d="M34 56 C33 34, 45 22, 60 22 C75 22, 87 34, 86 56 L86 68 C82 62, 78 58, 76 58 L44 58 C42 58, 38 62, 34 68 Z"
                              fill="url(#dewesHairGrad)"
                            />

                            {/* Ears */}
                            <circle cx="38" cy="56" r="4.5" fill="#E3AA84" />
                            <circle cx="82" cy="56" r="4.5" fill="#E3AA84" />

                            {/* Studio Earbud highlight */}
                            <circle cx="38" cy="57" r="2" fill="#FF4D8D" />
                            <circle cx="82" cy="57" r="2" fill="#8A2BE2" />

                            {/* Face */}
                            <rect
                              x="40"
                              y="32"
                              width="40"
                              height="46"
                              rx="19"
                              fill="url(#dewesSkinGrad)"
                            />

                            {/* Stylish Front Hair */}
                            <path
                              d="M39 46 C40 30, 52 24, 63 25 C74 26, 82 34, 81 46 C77 39, 71 36, 63 37 C54 38, 45 41, 39 46 Z"
                              fill="url(#dewesHairGrad)"
                            />

                            {/* Eyebrows */}
                            <path
                              d="M47 47 Q51.5 44.8 55.5 47"
                              fill="none"
                              stroke="#2A1845"
                              strokeWidth="1.9"
                              strokeLinecap="round"
                            />
                            <path
                              d="M64.5 47 Q68.5 44.8 73 47"
                              fill="none"
                              stroke="#2A1845"
                              strokeWidth="1.9"
                              strokeLinecap="round"
                            />

                            {/* Eyes with natural blink */}
                            <ellipse
                              ref={eyeLeftRef}
                              cx="51.5"
                              cy="52.5"
                              rx="2.3"
                              ry="2.6"
                              fill="#1D1235"
                              style={{ transformOrigin: '51.5px 52.5px' }}
                            />
                            <ellipse
                              ref={eyeRightRef}
                              cx="68.5"
                              cy="52.5"
                              rx="2.3"
                              ry="2.6"
                              fill="#1D1235"
                              style={{ transformOrigin: '68.5px 52.5px' }}
                            />
                            <circle cx="52.2" cy="51.6" r="0.8" fill="#FFFFFF" />
                            <circle cx="69.2" cy="51.6" r="0.8" fill="#FFFFFF" />

                            {/* Subtle Nose */}
                            <path
                              d="M60 54 L58.6 60.5 L61.2 61"
                              fill="none"
                              stroke="#C98D68"
                              strokeWidth="1.4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />

                            {/* Soft Cheeks */}
                            <ellipse
                              cx="46.5"
                              cy="61"
                              rx="3.2"
                              ry="1.7"
                              fill="#FF4D8D"
                              fillOpacity="0.18"
                            />
                            <ellipse
                              cx="73.5"
                              cy="61"
                              rx="3.2"
                              ry="1.7"
                              fill="#FF4D8D"
                              fillOpacity="0.18"
                            />

                            {/* Animated Speaking Mouth */}
                            <ellipse
                              ref={mouthRef}
                              cx="60"
                              cy="68.5"
                              rx="6.0"
                              ry="1.8"
                              fill="#7A2246"
                            />
                            <ellipse
                              ref={mouthInnerRef}
                              cx="60"
                              cy="69.1"
                              rx="4.4"
                              ry="0.8"
                              fill="#FF4D8D"
                              style={{ opacity: 0.35 }}
                            />
                          </g>
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* 24-Bar Purple-to-Pink Sound Equalizer */}
                  <div
                    aria-hidden="true"
                    className="flex items-center justify-center gap-[3px] h-8 w-full max-w-[210px]"
                  >
                    {EQUALIZER_BARS.map((_, idx) => (
                      <span
                        key={idx}
                        ref={(el) => {
                          eqBarRefs.current[idx] = el;
                        }}
                        className="w-[3.5px] h-7 rounded-full origin-center will-change-transform"
                        style={{
                          transform: 'scaleY(0.28)',
                          background:
                            'linear-gradient(180deg, #FF4D8D 0%, #8A2BE2 100%)',
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* MAIN PART: Animated Live Subtitles cycling through the 4 styles */}
                <div
                  className={`relative z-10 px-4 pb-4 min-h-[112px] flex items-center justify-center transition-opacity duration-300 ${
                    isExiting ? 'opacity-0' : 'opacity-100'
                  }`}
                >
                  <div
                    ref={
                      fraseAtual.preset === 'caixa_destaque'
                        ? caixaContainerRef
                        : undefined
                    }
                    className={`relative flex flex-wrap items-center justify-center text-center max-w-full ${
                      fraseAtual.preset === 'caixa_destaque'
                        ? 'bg-black/75 border border-white/10 rounded-2xl px-3.5 py-2.5 shadow-xl'
                        : ''
                    }`}
                    style={{
                      gap: '0.3em',
                      fontSize:
                        fraseAtual.preset === 'viral_impacto'
                          ? '25px'
                          : fraseAtual.preset === 'neon_noturno'
                            ? '19px'
                            : fraseAtual.preset === 'elegante_pregacao'
                              ? '21px'
                              : '17px',
                    }}
                  >
                    {/* Sliding karaoke pill for Caixa Destaque */}
                    {fraseAtual.preset === 'caixa_destaque' && karaokePill.visible && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute left-0 top-0 rounded-full"
                        style={{
                          width: `${karaokePill.width}px`,
                          height: `${karaokePill.height}px`,
                          transform: `translate3d(${karaokePill.left}px, ${karaokePill.top}px, 0)`,
                          background:
                            'linear-gradient(90deg, #8A2BE2 0%, #FF4D8D 100%)',
                          boxShadow: '0 0 16px rgba(255, 77, 141, 0.45)',
                          transition: prefersReducedMotion
                            ? 'none'
                            : 'transform 210ms cubic-bezier(0.22, 1, 0.36, 1), width 210ms cubic-bezier(0.22, 1, 0.36, 1), height 210ms cubic-bezier(0.22, 1, 0.36, 1)',
                        }}
                      />
                    )}

                    {visibleWords.map((word, idx) => {
                      const isActive = idx === activeWordIdx && editStage === 'none';
                      const isTargetFix = idx === fraseAtual.correcaoIndice;
                      const showBeforeFix =
                        isTargetFix && editStage === 'cursor_before';
                      const showAfterFixCursor =
                        isTargetFix && editStage === 'cursor_after';
                      const isFixedColor =
                        isTargetFix &&
                        (editStage === 'cursor_after' || editStage === 'corrected');

                      const displayWord = showBeforeFix
                        ? fraseAtual.correcaoAntes
                        : isTargetFix &&
                            (editStage === 'cursor_after' || editStage === 'corrected')
                          ? fraseAtual.correcaoDepois
                          : word;

                      const renderCaret =
                        !prefersReducedMotion &&
                        (showBeforeFix || showAfterFixCursor) ? (
                          <span
                            aria-hidden="true"
                            className="inline-block align-middle ml-[2px] w-[2px] h-[0.95em] rounded-full bg-[#FF4D8D] shadow-[0_0_8px_#FF4D8D]"
                            style={{
                              animation:
                                'dewes-caret-blink 520ms steps(1, end) infinite',
                            }}
                          />
                        ) : null;

                      if (fraseAtual.preset === 'viral_impacto') {
                        const wordColor = isFixedColor
                          ? '#34D399'
                          : isActive
                            ? '#FFE600'
                            : '#FFFFFF';
                        return (
                          <span
                            key={`${fraseIdx}-${idx}`}
                            className="inline-flex items-center px-[0.04em] transition-colors duration-200"
                            style={{
                              fontFamily: '"Anton", sans-serif',
                              fontSize: '25px',
                              lineHeight: 1.15,
                              textTransform: 'uppercase',
                              color: wordColor,
                              WebkitTextStroke: '4.5px #000000',
                              paintOrder: 'stroke fill',
                              textShadow: isFixedColor
                                ? '0 3px 0 #000000, 0 0 14px rgba(52, 211, 153, 0.65)'
                                : '0 3px 0 #000000',
                              animation: prefersReducedMotion
                                ? undefined
                                : isActive
                                  ? 'dewes-viral-enter 170ms cubic-bezier(0.22, 1, 0.36, 1) forwards'
                                  : undefined,
                            }}
                          >
                            {displayWord}
                            {renderCaret}
                          </span>
                        );
                      }

                      if (fraseAtual.preset === 'neon_noturno') {
                        const glow = isFixedColor
                          ? '#34D399'
                          : isActive
                            ? '#FF2BD6'
                            : '#00F0FF';
                        const color = isFixedColor
                          ? '#6EE7B7'
                          : isActive
                            ? '#FF2BD6'
                            : '#FFFFFF';
                        return (
                          <span
                            key={`${fraseIdx}-${idx}`}
                            className="inline-flex items-center transition-colors duration-200"
                            style={{
                              fontFamily: '"Poppins", sans-serif',
                              fontWeight: 700,
                              fontSize: '19px',
                              letterSpacing: '1.6px',
                              textTransform: 'uppercase',
                              color,
                              textShadow: `0 0 8px ${glow}, 0 0 18px ${glow}, 0 0 32px ${glow}`,
                              animation: prefersReducedMotion
                                ? undefined
                                : isActive
                                  ? 'dewes-neon-flicker 240ms ease-out, dewes-pop-150 150ms cubic-bezier(0.22, 1, 0.36, 1)'
                                  : undefined,
                            }}
                          >
                            {displayWord}
                            {renderCaret}
                          </span>
                        );
                      }

                      if (fraseAtual.preset === 'elegante_pregacao') {
                        const color = isFixedColor
                          ? '#34D399'
                          : isActive
                            ? '#D4AF37'
                            : '#FFF8E7';
                        return (
                          <span
                            key={`${fraseIdx}-${idx}`}
                            className="inline-flex items-center transition-colors duration-200"
                            style={{
                              fontFamily: '"Playfair Display", serif',
                              fontWeight: 600,
                              fontSize: '21px',
                              color,
                              textShadow: '0 2px 10px rgba(0, 0, 0, 0.8)',
                              borderBottom: isFixedColor
                                ? '1.5px solid #34D399'
                                : isActive
                                  ? '1.5px solid #D4AF37'
                                  : '1.5px solid transparent',
                              paddingBottom: '1px',
                              animation: prefersReducedMotion
                                ? undefined
                                : isActive
                                  ? 'dewes-elegante-fade 240ms ease-out, dewes-pop-150 150ms cubic-bezier(0.22, 1, 0.36, 1)'
                                  : undefined,
                            }}
                          >
                            {displayWord}
                            {renderCaret}
                          </span>
                        );
                      }

                      // caixa_destaque (karaoke pill glides behind active word)
                      const textColor = isFixedColor
                        ? '#34D399'
                        : isActive
                          ? '#FFE600'
                          : '#FFFFFF';
                      return (
                        <span
                          key={`${fraseIdx}-${idx}`}
                          ref={(el) => {
                            wordSpanRefs.current[idx] = el;
                          }}
                          className="relative z-10 inline-flex items-center px-2 py-0.5 rounded-full transition-colors duration-200"
                          style={{
                            fontFamily: '"Inter", sans-serif',
                            fontWeight: 800,
                            fontSize: '17px',
                            color: textColor,
                            animation: prefersReducedMotion
                              ? undefined
                              : isActive
                                ? 'dewes-pop-150 150ms cubic-bezier(0.22, 1, 0.36, 1)'
                                : undefined,
                          }}
                        >
                          {displayWord}
                          {renderCaret}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* BOTTOM LAYER: Mini Subtitle Timeline (ONLY subtitle blocks appearing left-to-right) */}
                <div className="relative z-10 px-4 pb-4">
                  <div className="rounded-xl bg-black/50 backdrop-blur-sm border border-white/10 px-2.5 py-2">
                    <div className="flex items-center justify-between text-[9px] font-medium text-slate-400 mb-1.5">
                      <span>Faixa de legendas</span>
                      <span className="font-mono text-purple-300">
                        {visibleCount}/{fraseAtual.palavras.length} palavras
                      </span>
                    </div>

                    <div className="relative h-4 rounded-md bg-white/[0.04] overflow-hidden flex items-center gap-1 px-1">
                      {/* Playhead sweeping left to right */}
                      {!prefersReducedMotion && (
                        <div
                          ref={playheadRef}
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-0 left-0 w-full z-20 will-change-transform"
                          style={{ transform: 'translate3d(0%, 0, 0)' }}
                        >
                          <div className="w-[2px] h-full bg-white shadow-[0_0_8px_#FFFFFF]" />
                        </div>
                      )}

                      {fraseAtual.palavras.map((_, idx) => {
                        const revealed = idx < visibleCount;
                        const isBeingFixed =
                          idx === fraseAtual.correcaoIndice &&
                          (editStage === 'cursor_after' || editStage === 'corrected');
                        const isCurrentlyActive =
                          idx === activeWordIdx && editStage === 'none';

                        return (
                          <div
                            key={`${fraseIdx}-tl-${idx}`}
                            className="h-2.5 flex-1 rounded-[3px] origin-left transition-all duration-200"
                            style={{
                              opacity: revealed ? 1 : 0.14,
                              background: !revealed
                                ? 'rgba(255,255,255,0.12)'
                                : isBeingFixed
                                  ? 'linear-gradient(90deg, #10B981 0%, #34D399 100%)'
                                  : isCurrentlyActive
                                    ? 'linear-gradient(90deg, #FFE600 0%, #FF4D8D 100%)'
                                    : 'linear-gradient(90deg, #8A2BE2 0%, #FF4D8D 100%)',
                              boxShadow:
                                revealed && isCurrentlyActive
                                  ? '0 0 8px rgba(255, 230, 0, 0.5)'
                                  : undefined,
                              animation:
                                revealed && !prefersReducedMotion
                                  ? 'dewes-timeline-block-in 180ms ease-out forwards'
                                  : undefined,
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Caption underneath changing with each phrase */}
      <div className="mt-5 text-center min-h-[28px] flex items-center justify-center px-4">
        <p
          key={fraseAtual.tagline}
          className="text-sm font-medium text-slate-300 transition-opacity duration-300"
        >
          {fraseAtual.tagline}
        </p>
      </div>
    </div>
  );
}
