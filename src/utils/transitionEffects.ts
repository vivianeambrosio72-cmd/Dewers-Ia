import type React from 'react';
import type { TransitionIntensity, TransitionType } from '../types';

export interface TransitionVisualFrame {
  style: React.CSSProperties;
  flashOpacity: number;
}

export function getIntensityMultiplier(intensity: TransitionIntensity): number {
  if (intensity === 'low') return 0.6;
  if (intensity === 'high') return 1.45;
  return 1.0;
}

export function computeTransitionVisual(
  type: TransitionType,
  progress: number,
  intensity: TransitionIntensity,
): TransitionVisualFrame {
  const p = Math.min(1, Math.max(0, progress));
  const mult = getIntensityMultiplier(intensity);
  const pulse = Math.sin(p * Math.PI);

  switch (type) {
    case 'fade':
      return {
        style: { opacity: Math.max(0.12, 1 - 0.78 * mult * pulse) },
        flashOpacity: 0,
      };

    case 'zoom':
      return {
        style: {
          transform: `scale(${(1 + 0.16 * mult * pulse).toFixed(3)})`,
        },
        flashOpacity: 0,
      };

    case 'slide': {
      const shift = (p < 0.5 ? -p * 2 : (1 - p) * 2) * 18 * mult;
      return {
        style: {
          transform: `translateX(${shift.toFixed(1)}%)`,
        },
        flashOpacity: 0,
      };
    }

    case 'glitch': {
      const jx = Math.sin(p * 42) * 10 * mult * pulse;
      const jy = Math.cos(p * 34) * 5 * mult * pulse;
      return {
        style: {
          transform: `translate(${jx.toFixed(1)}px, ${jy.toFixed(1)}px) skewX(${(jx * 0.4).toFixed(1)}deg)`,
          filter: `hue-rotate(${Math.round(120 * pulse)}deg) contrast(${(1 + 0.35 * pulse).toFixed(2)})`,
        },
        flashOpacity: 0,
      };
    }

    case 'whip': {
      const dir = p < 0.5 ? -p * 2 : (1 - p) * 2;
      const translate = dir * 42 * mult;
      const blurPx = (6 * mult * pulse).toFixed(1);
      return {
        style: {
          transform: `translateX(${translate.toFixed(1)}%) scaleX(${(1 + 0.18 * pulse).toFixed(3)})`,
          filter: `blur(${blurPx}px)`,
        },
        flashOpacity: 0,
      };
    }

    case 'cube_zoom': {
      const angle = (p < 0.5 ? p * 2 : (p - 1) * 2) * 42 * mult;
      const scale = 1 - 0.18 * pulse + 0.24 * mult * Math.pow(pulse, 2);
      return {
        style: {
          transform: `perspective(680px) rotateY(${angle.toFixed(1)}deg) scale(${scale.toFixed(3)})`,
        },
        flashOpacity: 0,
      };
    }

    case 'flip': {
      const deg = p * 360;
      const scale = 1 - 0.14 * pulse;
      return {
        style: {
          transform: `perspective(700px) rotateY(${deg.toFixed(1)}deg) scale(${scale.toFixed(3)})`,
        },
        flashOpacity: 0,
      };
    }

    case 'heartbeat': {
      // Double beat: beat 1 around p=0.25, beat 2 around p=0.65
      const beat1 = Math.exp(-Math.pow((p - 0.25) / 0.11, 2));
      const beat2 = Math.exp(-Math.pow((p - 0.62) / 0.13, 2)) * 0.78;
      const scale = 1 + 0.16 * mult * Math.max(beat1, beat2);
      return {
        style: {
          transform: `scale(${scale.toFixed(3)})`,
        },
        flashOpacity: 0,
      };
    }

    case 'flash': {
      const flashOpacity = Math.min(0.92, 0.78 * mult * Math.pow(pulse, 1.4));
      return {
        style: {
          filter: `brightness(${(1 + 0.65 * mult * pulse).toFixed(2)})`,
        },
        flashOpacity,
      };
    }

    case 'spin': {
      const deg = p * 360 * (mult > 1.2 ? 1 : 1);
      const scale = 1 - 0.22 * pulse;
      return {
        style: {
          transform: `rotate(${deg.toFixed(1)}deg) scale(${scale.toFixed(3)})`,
        },
        flashOpacity: 0,
      };
    }

    case 'shake': {
      const sx = Math.sin(p * 55) * 9 * mult * pulse;
      const sy = Math.cos(p * 47) * 7 * mult * pulse;
      const rot = Math.sin(p * 38) * 3.5 * mult * pulse;
      return {
        style: {
          transform: `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${(1 + 0.06 * pulse).toFixed(3)})`,
        },
        flashOpacity: 0,
      };
    }

    case 'blur': {
      const blurPx = (10 * mult * pulse).toFixed(1);
      return {
        style: {
          filter: `blur(${blurPx}px)`,
          opacity: Math.max(0.45, 1 - 0.35 * pulse),
          transform: `scale(${(1 + 0.05 * pulse).toFixed(3)})`,
        },
        flashOpacity: 0,
      };
    }

    case 'wipe': {
      const insetRight = p < 0.5 ? p * 100 : (1 - p) * 100;
      return {
        style: {
          clipPath: `inset(0 ${Math.min(85, insetRight * 0.85 * mult).toFixed(1)}% 0 0)`,
        },
        flashOpacity: 0,
      };
    }

    case 'bounce': {
      const bounceWave = Math.abs(Math.sin(p * Math.PI * 2.5)) * (1 - p);
      const translateY = -22 * mult * bounceWave;
      const scale = 1 + 0.1 * mult * bounceWave;
      return {
        style: {
          transform: `translateY(${translateY.toFixed(1)}px) scale(${scale.toFixed(3)})`,
        },
        flashOpacity: 0,
      };
    }
  }
}
