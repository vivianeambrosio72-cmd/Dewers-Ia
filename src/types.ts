export type SupportedLanguage = 'pt-BR' | 'en-US' | 'es-ES' | 'fr-FR';

export type SubtitlePreset =
  | 'viral_impacto'
  | 'neon_noturno'
  | 'elegante_pregacao'
  | 'caixa_destaque'
  | 'mrbeast_3d'
  | 'cyber_glitch'
  | 'fogo_turbo'
  | 'cinema_blur';

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

export type WizardStep = 1 | 2 | 'export';

export interface TransitionPoint {
  id: string;
  time: number;
  type: TransitionType;
  duration: number;
  intensity: TransitionIntensity;
  source: 'auto' | 'manual';
  pauseDuration?: number;
}

export const LANGUAGE_OPTIONS: Array<{ value: SupportedLanguage; label: string }> = [
  { value: 'pt-BR', label: 'Português (Brasil) · pt-BR' },
  { value: 'en-US', label: 'Inglês · en-US' },
  { value: 'es-ES', label: 'Espanhol · es-ES' },
  { value: 'fr-FR', label: 'Francês · fr-FR' },
];

export const FONT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'Anton', label: 'Anton' },
  { value: 'Montserrat', label: 'Montserrat Black' },
  { value: 'Bebas Neue', label: 'Bebas Neue' },
  { value: 'Oswald', label: 'Oswald Bold' },
  { value: 'Plus Jakarta Sans', label: 'Plus Jakarta Sans' },
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
  mrbeast_3d: {
    name: '3D BLOCKBUSTER',
    subtitle: 'Montserrat Black itálico · Extrusão 3D · Verde pop',
    baseFontSize: 40,
    style: {
      preset: 'mrbeast_3d',
      fontFamily: 'Montserrat',
      fontScale: 100,
      textColor: '#FFFFFF',
      highlightColor: '#22FF66',
      verticalPosition: 74,
    },
  },
  cyber_glitch: {
    name: 'CYBER GLITCH',
    subtitle: 'Oswald · Aberração RGB ciano/magenta · Tarja inclinada',
    baseFontSize: 38,
    style: {
      preset: 'cyber_glitch',
      fontFamily: 'Oswald',
      fontScale: 100,
      textColor: '#FFFFFF',
      highlightColor: '#00F0FF',
      verticalPosition: 68,
    },
  },
  fogo_turbo: {
    name: 'GRADIENTE FOGO',
    subtitle: 'Bebas Neue · Metal incandescente · Brilho laranja',
    baseFontSize: 46,
    style: {
      preset: 'fogo_turbo',
      fontFamily: 'Bebas Neue',
      fontScale: 100,
      textColor: '#F8FAFC',
      highlightColor: '#FF7A00',
      verticalPosition: 72,
    },
  },
  cinema_blur: {
    name: 'CINEMA FOCO',
    subtitle: 'Plus Jakarta Sans · Desfoque focal · Destaque dourado',
    baseFontSize: 33,
    style: {
      preset: 'cinema_blur',
      fontFamily: 'Plus Jakarta Sans',
      fontScale: 100,
      textColor: '#F1F5F9',
      highlightColor: '#FFB800',
      verticalPosition: 78,
    },
  },
};

export type UserPlan = 'FREE' | 'PRO';
export type SubscriptionStatus =
  | 'free'
  | 'active'
  | 'pending'
  | 'expired'
  | 'cancelled';
export type BillingCycle = 'none' | 'monthly' | 'annual';
export type AuthProviderKind = 'google' | 'email';

export interface TranscriptionUsageMeta {
  modelUsed: string;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface UserProfileRecord {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string | null;
  role: 'user' | 'admin';
  authProvider: AuthProviderKind;
  plan: UserPlan;
  subscriptionStatus: SubscriptionStatus;
  billingCycle: BillingCycle;
  subscriptionExpiresAt?: string | null;
  lastActiveAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptionLogRecord {
  id: string;
  userId: string;
  userEmail: string;
  userPlan: UserPlan;
  videoFileName: string;
  durationSeconds: number;
  minutesProcessed: number;
  language: SupportedLanguage;
  segmentCount: number;
  wordCount: number;
  modelUsed: string;
  estimatedCostUsd: number;
  totalTokens: number;
  status: 'completed' | 'error';
  errorCode?: string | null;
  errorMessage?: string | null;
  resolvedByAdmin?: boolean;
  createdAt: string;
}

export type PaymentStatus = 'confirmed' | 'pending' | 'refused';

export interface PaymentRecord {
  id: string;
  userId: string;
  userEmail: string;
  plan: 'PRO';
  billingCycle: 'monthly' | 'annual';
  amountBrl: number;
  status: PaymentStatus;
  subscriptionStatus: Exclude<SubscriptionStatus, 'free'>;
  paymentMethod: string;
  notes?: string | null;
  expiresAt?: string | null;
  recordedBy: string;
  createdAt: string;
  updatedAt: string;
}

export type AdminAuditAction =
  | 'UPDATE_USER_PLAN'
  | 'CREATE_PAYMENT'
  | 'UPDATE_PAYMENT_STATUS'
  | 'RESOLVE_TRANSCRIPTION_ERROR'
  | 'REVOKE_SUBSCRIPTION'
  | 'ADMIN_VERIFY'
  | 'APPROVE_PRO_ORDER'
  | 'REJECT_PRO_ORDER'
  | 'UPDATE_PAYMENT_SETTINGS';

export interface AdminAuditLogRecord {
  id: string;
  adminUid: string;
  adminEmail: string;
  action: AdminAuditAction;
  targetType:
    | 'user'
    | 'payment'
    | 'transcription'
    | 'pro_order'
    | 'settings'
    | 'system';
  targetId: string;
  targetEmail?: string | null;
  summary: string;
  previousValue?: string | null;
  newValue?: string | null;
  createdAt: string;
}

export interface AdminVerifyResponse {
  authorized: boolean;
  uid?: string;
  email?: string;
  provider?: string;
  hasCustomClaim?: boolean;
  authMode?: string;
  error?: string;
  code?: string;
}

export type ProOrderStatus = 'PENDENTE' | 'APROVADO' | 'REJEITADO';

export interface MulticaixaSettingsRecord {
  id: string;
  multicaixaNumber: string;
  whatsappNumber: string;
  holderName: string;
  updatedBy: string;
  updatedAt: string;
}

export interface ProOrderRecord {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  billingCycle: 'monthly' | 'annual';
  planLabel: 'PRO Mensal' | 'PRO Anual';
  amountKz: 1000 | 10000;
  durationDays: 30 | 365;
  status: ProOrderStatus;
  approvedBy?: string | null;
  approvedByUid?: string | null;
  rejectionReason?: string | null;
  activatedStartAt?: string | null;
  activatedExpiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_MULTICAIXA_PLACEHOLDER = '[INSERIR O MEU NÚMERO]';
export const DEFAULT_MULTICAIXA_NUMBER = '+244 936 964 366';
export const DEFAULT_MULTICAIXA_HOLDER = 'Adelino D';

export const PRO_PLAN_CATALOG: Record<
  'monthly' | 'annual',
  {
    billingCycle: 'monthly' | 'annual';
    planLabel: 'PRO Mensal' | 'PRO Anual';
    amountKz: 1000 | 10000;
    priceFormatted: string;
    durationDays: 30 | 365;
    durationLabel: string;
    description: string;
  }
> = {
  monthly: {
    billingCycle: 'monthly',
    planLabel: 'PRO Mensal',
    amountKz: 1000,
    priceFormatted: '1.000 Kz',
    durationDays: 30,
    durationLabel: '30 dias',
    description: 'Acesso completo ao plano PRO durante 30 dias.',
  },
  annual: {
    billingCycle: 'annual',
    planLabel: 'PRO Anual',
    amountKz: 10000,
    priceFormatted: '10.000 Kz',
    durationDays: 365,
    durationLabel: '365 dias',
    description: 'Poupança anual com acesso PRO durante 365 dias.',
  },
};

export const FREE_VIDEO_LIMIT = 2;

export type VideoExportType = 'video' | 'srt';

export interface VideoExportLogRecord {
  id: string;
  userId: string;
  userEmail: string;
  userPlan: UserPlan;
  videoKey: string;
  videoFileName: string;
  exportType: VideoExportType;
  createdAt: string;
}

export interface UserFreeQuotaState {
  generatedCount: number;
  generatedVideoNames: string[];
  savedVideosCount: number;
  savedVideoKeys: string[];
  loaded: boolean;
}
