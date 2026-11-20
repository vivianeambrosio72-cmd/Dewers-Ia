import React from 'react';
import {
  FONT_OPTIONS,
  PRESET_DEFINITIONS,
  type StyleConfig,
  type SubtitlePreset,
} from '../types';

interface StylePanelProps {
  styleConfig: StyleConfig;
  onChange: (next: StyleConfig) => void;
}

const TEXT_SWATCHES = ['#FFFFFF', '#FFF8E7', '#F8FAFC', '#FFE600', '#00F0FF'];
const HIGHLIGHT_SWATCHES = ['#FFE600', '#FF2BD6', '#D4AF37', '#FF4D8D', '#00F0FF'];

function StyleThumbnail({ presetKey }: { presetKey: SubtitlePreset }) {
  if (presetKey === 'viral_impacto') {
    return (
      <div className="h-14 rounded-md bg-[#090B10] border border-white/10 flex items-center justify-center px-3 overflow-hidden">
        <span
          className="text-base uppercase tracking-wide"
          style={{
            fontFamily: '"Anton", "Montserrat", sans-serif',
            fontWeight: 800,
            color: '#FFFFFF',
            WebkitTextStroke: '4px #000000',
            paintOrder: 'stroke fill',
            textShadow: '0 3px 0 #000000',
          }}
        >
          FOCO{' '}
          <span style={{ color: '#FFE600', display: 'inline-block', transform: 'scale(1.12)' }}>
            VIRAL
          </span>
        </span>
      </div>
    );
  }

  if (presetKey === 'neon_noturno') {
    return (
      <div className="h-14 rounded-md bg-[#090B10] border border-white/10 flex items-center justify-center px-3 overflow-hidden">
        <span
          className="text-sm font-bold uppercase"
          style={{
            fontFamily: '"Poppins", sans-serif',
            letterSpacing: '2px',
            color: '#FFFFFF',
            textShadow: '0 0 8px #00F0FF, 0 0 18px #00F0FF',
          }}
        >
          NOITE{' '}
          <span
            style={{
              color: '#FF2BD6',
              textShadow: '0 0 8px #FF2BD6, 0 0 18px #FF2BD6',
            }}
          >
            NEON
          </span>
        </span>
      </div>
    );
  }

  if (presetKey === 'elegante_pregacao') {
    return (
      <div className="h-14 rounded-md bg-[#090B10] border border-white/10 flex items-center justify-center px-3 overflow-hidden">
        <span
          className="text-sm font-semibold"
          style={{
            fontFamily: '"Playfair Display", serif',
            color: '#FFF8E7',
            textShadow: '0 2px 8px rgba(0,0,0,0.7)',
          }}
        >
          Palavra{' '}
          <span
            style={{
              color: '#D4AF37',
              borderBottom: '1.5px solid #D4AF37',
              paddingBottom: '1px',
            }}
          >
            Viva
          </span>
        </span>
      </div>
    );
  }

  // caixa_destaque
  return (
    <div className="h-14 rounded-md bg-[#090B10] border border-white/10 flex items-center justify-center px-3 overflow-hidden">
      <div
        className="flex items-center gap-1.5 text-xs font-extrabold text-white"
        style={{
          fontFamily: '"Inter", sans-serif',
          backgroundColor: 'rgba(0,0,0,0.65)',
          borderRadius: '10px',
          padding: '6px 10px',
        }}
      >
        <span>Seu</span>
        <span
          className="px-2 py-0.5 rounded-full text-white"
          style={{
            background: 'linear-gradient(90deg, #8A2BE2 0%, #FF4D8D 100%)',
          }}
        >
          vídeo
        </span>
        <span>aqui</span>
      </div>
    </div>
  );
}

export function StylePanel({ styleConfig, onChange }: StylePanelProps) {
  const presets = Object.keys(PRESET_DEFINITIONS) as SubtitlePreset[];

  const applyPreset = (presetKey: SubtitlePreset) => {
    onChange({ ...PRESET_DEFINITIONS[presetKey].style });
  };

  return (
    <div className="flex flex-col gap-5">
      {/* 4 Professional Subtitle Styles with Clickable Thumbnails */}
      <div className="p-4 rounded-xl bg-[#11141D] border border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">
            Estilos profissionais de legenda
          </h3>
          <span className="text-xs text-slate-400">
            2 a 4 palavras sincronizadas por vez
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {presets.map((key) => {
            const def = PRESET_DEFINITIONS[key];
            const isSelected = styleConfig.preset === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                className={`p-3 rounded-lg border text-left transition-colors flex flex-col gap-2.5 ${
                  isSelected
                    ? 'bg-amber-400/10 border-amber-400'
                    : 'bg-[#181C27] border-white/10 hover:border-white/25'
                }`}
              >
                <StyleThumbnail presetKey={key} />
                <div>
                  <div className="text-xs font-bold tracking-wide text-slate-100">
                    {def.name}
                  </div>
                  <div className="text-xs text-slate-400 leading-snug mt-0.5">
                    {def.subtitle}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Size (50% - 150%) & Vertical Position Sliders + Typography Fine-Tuning */}
      <div className="p-4 rounded-xl bg-[#11141D] border border-white/10 space-y-5">
        <h3 className="text-sm font-semibold text-slate-100">
          Ajustes em tempo real
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Font Scale Slider (50% to 150%) */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label htmlFor="font-scale" className="text-xs font-medium text-slate-300">
                Tamanho da fonte
              </label>
              <span className="font-mono-tabular text-xs text-amber-400 font-semibold">
                {styleConfig.fontScale}%
              </span>
            </div>
            <input
              id="font-scale"
              type="range"
              min={50}
              max={150}
              step={5}
              value={styleConfig.fontScale}
              onChange={(e) =>
                onChange({ ...styleConfig, fontScale: Number(e.target.value) })
              }
              className="w-full accent-amber-400 cursor-pointer h-2 bg-white/10 rounded-lg"
            />
            <div className="flex justify-between text-[11px] text-slate-500 font-mono-tabular">
              <span>50%</span>
              <span>100%</span>
              <span>150%</span>
            </div>
          </div>

          {/* Vertical Position Slider (5% to 95%) */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="vertical-position"
                className="text-xs font-medium text-slate-300"
              >
                Posição vertical
              </label>
              <span className="font-mono-tabular text-xs text-sky-400 font-semibold">
                {styleConfig.verticalPosition}%
              </span>
            </div>
            <input
              id="vertical-position"
              type="range"
              min={10}
              max={90}
              step={1}
              value={styleConfig.verticalPosition}
              onChange={(e) =>
                onChange({
                  ...styleConfig,
                  verticalPosition: Number(e.target.value),
                })
              }
              className="w-full accent-sky-400 cursor-pointer h-2 bg-white/10 rounded-lg"
            />
            <div className="flex justify-between text-[11px] text-slate-500">
              <span>Topo (10%)</span>
              <span>Centro (50%)</span>
              <span>Base (90%)</span>
            </div>
          </div>
        </div>

        {/* Font Selector & Colors */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-white/[0.06]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="font-select" className="text-xs font-medium text-slate-300">
              Fonte
            </label>
            <select
              id="font-select"
              value={styleConfig.fontFamily}
              onChange={(e) =>
                onChange({ ...styleConfig, fontFamily: e.target.value })
              }
              className="px-3 py-2 rounded-lg bg-[#181C27] border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-amber-400"
            >
              {FONT_OPTIONS.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-slate-300">Texto base</span>
            <div className="flex items-center gap-1.5">
              {TEXT_SWATCHES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={`Cor do texto ${hex}`}
                  onClick={() => onChange({ ...styleConfig, textColor: hex })}
                  style={{ backgroundColor: hex }}
                  className={`w-6 h-6 rounded border transition-transform ${
                    styleConfig.textColor.toUpperCase() === hex
                      ? 'border-amber-400 scale-110'
                      : 'border-white/20'
                  }`}
                />
              ))}
              <input
                type="color"
                aria-label="Cor personalizada do texto"
                value={styleConfig.textColor}
                onChange={(e) =>
                  onChange({ ...styleConfig, textColor: e.target.value })
                }
                className="w-7 h-6 rounded bg-transparent border border-white/15 cursor-pointer"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-slate-300">Destaque</span>
            <div className="flex items-center gap-1.5">
              {HIGHLIGHT_SWATCHES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={`Cor de destaque ${hex}`}
                  onClick={() => onChange({ ...styleConfig, highlightColor: hex })}
                  style={{ backgroundColor: hex }}
                  className={`w-6 h-6 rounded border transition-transform ${
                    styleConfig.highlightColor.toUpperCase() === hex
                      ? 'border-white scale-110'
                      : 'border-white/20'
                  }`}
                />
              ))}
              <input
                type="color"
                aria-label="Cor personalizada de destaque"
                value={styleConfig.highlightColor}
                onChange={(e) =>
                  onChange({ ...styleConfig, highlightColor: e.target.value })
                }
                className="w-7 h-6 rounded bg-transparent border border-white/15 cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
