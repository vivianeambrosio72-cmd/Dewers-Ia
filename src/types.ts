export type SupportedLanguage = 'pt-BR' | 'en-US' | 'es-ES' | 'fr-FR';

export type SubtitlePreset =
  | 'viral_impacto'
  | 'neon_noturno'
  | 'elegante_pregacao'
  | 'caixa_destaque';

export type TransitionType =
  | 'fade'
  | 'zoom'
  | 'slide'
  | 'glitch'
  | 'whip'
  | 'cube_zoom'
  | 'flip'
  | 'heartbeat'
  | 'flash'
  | 'spin'
  | 'shake'
  | 'blur'
  | 'wipe'
  | 'bounce';

export type TransitionMode = 'transition' | 'cut';

export type TransitionIntensity = 'low' | 'medium' | 'high';

export type TransitionCategory = 'classic' | 'dynamic' | '3d' | 'impact';

export interface TransitionDefinition {
  value: TransitionType;
  label: string;
  desc: string;
  category: TransitionCategory;
}

export interface WordTiming {
  id: string;
  text: string;
  start: number;
  end: number;
  confidence?: number;
  needsReview?: boolean;
}

export interface SubtitleSegment {
  id: string;
  text: string;
  start: number;
  end: number;
  words: WordTiming[];
}

export interface StyleConfig {
  preset: SubtitlePreset;
  fontFamily: string;
  fontScale: number; // 50 a 150 (%)
  textColor: string;
  highlightColor: string;
  verticalPosition: number; // 5 a 95 (% do topo)
}

export interface TransitionConfig {
  enabled: boolean;
  mode: TransitionMode;
  type: TransitionType;
  intensity: TransitionIntensity;
  pauseThreshold: number;
  duration: number;
}

export type WizardStep = 1 | 2 | 3 | 'export';

export interface TransitionPoint {
  id: string;
  time: number; // segundos no vídeo onde a transição ocorre
  type: TransitionType;
  duration: number; // segundos
  intensity: TransitionIntensity;
  source: 'auto' | 'manual';
  pauseDuration?: number;
}

export interface DetectedPause {
  id: string;
  start: number;
  end: number;
  duration: number;
  beforeSegmentId: string;
  afterSegmentId: string;
}

export interface SavedProject {
  id: string;
  ownerId: string;
  title: string;
  videoFileName: string;
  duration: number;
  language: SupportedLanguage;
  styleConfig: StyleConfig;
  transitionConfig: TransitionConfig;
  transitionPoints?: TransitionPoint[];
  segments: SubtitleSegment[];
  wordCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export const LANGUAGE_OPTIONS: Array<{ value: SupportedLanguage; label: string }> = [
  { value: 'pt-BR', label: 'Português (Brasil) · pt-BR' },
  { value: 'en-US', label: 'Inglês · en-US' },
  { value: 'es-ES', label: 'Espanhol · es-ES' },
  { value: 'fr-FR', label: 'Francês · fr-FR' },
];

export const TRANSITION_LIBRARY: TransitionDefinition[] = [
  { value: 'fade', label: 'Fade', desc: 'Suavização progressiva', category: 'classic' },
  { value: 'zoom', label: 'Zoom', desc: 'Aproximação de impacto', category: 'dynamic' },
  { value: 'slide', label: 'Deslizar', desc: 'Movimento lateral fluido', category: 'classic' },
  { value: 'glitch', label: 'Glitch', desc: 'Pulso digital cromático', category: 'impact' },
  { value: 'whip', label: 'Whip Pan', desc: 'Chicote horizontal veloz', category: 'dynamic' },
  { value: 'cube_zoom', label: 'Cube Zoom', desc: 'Rotação 3D com zoom', category: '3d' },
  { value: 'flip', label: 'Flip 3D', desc: 'Giro horizontal em eixo Y', category: '3d' },
  { value: 'heartbeat', label: 'Heartbeat', desc: 'Duplo pulso rítmico', category: 'impact' },
  { value: 'flash', label: 'Flash', desc: 'Clarão branco de corte', category: 'impact' },
  { value: 'spin', label: 'Spin', desc: 'Rotação 360° dinâmica', category: 'dynamic' },
  { value: 'shake', label: 'Camera Shake', desc: 'Vibração rápida de câmera', category: 'impact' },
  { value: 'blur', label: 'Blur Dissolve', desc: 'Desfoque óptico suave', category: 'classic' },
  { value: 'wipe', label: 'Wipe', desc: 'Cortina de revelação limpa', category: 'classic' },
  { value: 'bounce', label: 'Bounce', desc: 'Salto elástico de entrada', category: 'dynamic' },
];

export const FONT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'Anton', label: 'Anton' },
  { value: 'Montserrat', label: 'Montserrat ExtraBold' },
  { value: 'Poppins', label: 'Poppins Bold' },
  { value: 'Playfair Display', label: 'Playfair Display' },
  { value: 'Inter', label: 'Inter ExtraBold' },
];

export const PRESET_DEFINITIONS: Record<
  SubtitlePreset,
  {
    name: string;
    subtitle: string;
    baseFontSize: number;
    style: StyleConfig;
  }
> = {
  viral_impacto: {
    name: 'VIRAL IMPACTO',
    subtitle: 'Anton em caixa alta · Contorno 6px · Pop amarelo',
    baseFontSize: 42,
    style: {
      preset: 'viral_impacto',
      fontFamily: 'Anton',
      fontScale: 100,
      textColor: '#FFFFFF',
      highlightColor: '#FFE600',
      verticalPosition: 72,
    },
  },
  neon_noturno: {
    name: 'NEON NOTURNO',
    subtitle: 'Poppins Bold · Brilho ciano e destaque rosa neon',
    baseFontSize: 34,
    style: {
      preset: 'neon_noturno',
      fontFamily: 'Poppins',
      fontScale: 100,
      textColor: '#FFFFFF',
      highlightColor: '#FF2BD6',
      verticalPosition: 50,
    },
  },
  elegante_pregacao: {
    name: 'ELEGANTE PREGAÇÃO',
    subtitle: 'Playfair Display · Creme suave e sublinhado dourado',
    baseFontSize: 32,
    style: {
      preset: 'elegante_pregacao',
      fontFamily: 'Playfair Display',
      fontScale: 100,
      textColor: '#FFF8E7',
      highlightColor: '#D4AF37',
      verticalPosition: 76,
    },
  },
  caixa_destaque: {
    name: 'CAIXA DESTAQUE',
    subtitle: 'Inter ExtraBold · Pílula karaokê degradê deslizante',
    baseFontSize: 30,
    style: {
      preset: 'caixa_destaque',
      fontFamily: 'Inter',
      fontScale: 100,
      textColor: '#FFFFFF',
      highlightColor: '#FF4D8D',
      verticalPosition: 84,
    },
  },
};
