import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clapperboard,
  Loader2,
  LogIn,
  LogOut,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import {
  auth,
  isAdminUser,
  signInWithGoogle,
  signOutUser,
} from './firebase';
import {
  logTranscriptionActivity,
  logVideoExportActivity,
  subscribeToCurrentUserProfile,
  subscribeToMulticaixaSettings,
  subscribeToUserFreeQuota,
  subscribeToUserProOrders,
  syncUserProfileOnLogin,
  verifyAdminSessionOnServer,
} from './services/adminFirestoreService';
import {
  DEFAULT_MULTICAIXA_HOLDER,
  DEFAULT_MULTICAIXA_NUMBER,
  FREE_VIDEO_LIMIT,
  PRESET_DEFINITIONS,
  type AdminVerifyResponse,
  type MulticaixaSettingsRecord,
  type ProOrderRecord,
  type StyleConfig,
  type SubtitleSegment,
  type SupportedLanguage,
  type TranscriptionUsageMeta,
  type UserFreeQuotaState,
  type UserProfileRecord,
  type WizardStep,
} from './types';
import {
  createSegmentAtTime,
  editSingleWordInSegment,
  findAndReplaceInSegments,
  generateSrtContent,
  markWordReviewedInSegment,
  mergeTwoSegments,
  rebuildSegmentWords,
  splitSegmentAtWordIndex,
  splitSegmentByCharOffset,
  updateSegmentTimeRange,
} from './utils/subtitles';
import { prepareAudioForTranscription } from './utils/audioExtractor';
import { exportVideoWithBurnedSubtitles } from './utils/videoExporter';
import { WizardProgressBar } from './components/WizardProgressBar';
import { VideoPlayerShell } from './components/VideoPlayerShell';
import { SubtitleEditorPanel } from './components/SubtitleEditorPanel';
import { StylePanel } from './components/StylePanel';
import { ExportStage } from './components/ExportStage';
import { LoginScreen } from './components/LoginScreen';
import { AdminDiagnosticPanel } from './components/AdminDiagnosticPanel';
import { AdminDashboard } from './components/AdminDashboard';
import { ProUpgradeModal } from './components/ProUpgradeModal';
import {
  OfflineBanner,
  PWAInstallButton,
  PWAUpdateBanner,
} from './components/PWABanners';

interface BannerAlert {
  type: 'error' | 'info' | 'success';
  message: string;
}

const MAX_UPLOAD_MB = 200;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const AUTOSAVE_STORAGE_KEY = 'dewers_ia_step2_autosave_v1';

interface LocalDraftPayload {
  videoKey: string | null;
  videoFileName: string | null;
  language: SupportedLanguage;
  customDictionary: string;
  styleConfig: StyleConfig;
  segments: SubtitleSegment[];
  subtitlesReviewed: boolean;
  updatedAt: number;
}

function readLocalDraft(): LocalDraftPayload | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalDraftPayload;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function App() {
  // Auth & Exclusive Admin Route
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfileRecord | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [showAdminDiag, setShowAdminDiag] = useState(false);
  const [showProModal, setShowProModal] = useState(false);
  const [proLimitMessage, setProLimitMessage] = useState<string | null>(null);
  const [freeQuota, setFreeQuota] = useState<UserFreeQuotaState>({
    generatedCount: 0,
    generatedVideoNames: [],
    savedVideosCount: 0,
    savedVideoKeys: [],
    loaded: false,
  });
  const [multicaixaSettings, setMulticaixaSettings] =
    useState<MulticaixaSettingsRecord>({
      id: 'multicaixa_express',
      multicaixaNumber: DEFAULT_MULTICAIXA_NUMBER,
      whatsappNumber: '',
      holderName: DEFAULT_MULTICAIXA_HOLDER,
      updatedBy: '',
      updatedAt: '',
    });
  const [userProOrders, setUserProOrders] = useState<ProOrderRecord[]>([]);
  const [pathname, setPathname] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.pathname || '/' : '/',
  );
  const [adminVerifyState, setAdminVerifyState] = useState<
    'idle' | 'checking' | 'authorized' | 'denied'
  >('idle');
  const [adminVerifyResult, setAdminVerifyResult] =
    useState<AdminVerifyResponse | null>(null);
  const isAdmin = useMemo(() => isAdminUser(user), [user]);
  const isEffectivePro = useMemo(() => {
    if (userProfile?.plan !== 'PRO' || userProfile?.subscriptionStatus !== 'active') {
      return false;
    }
    if (!userProfile.subscriptionExpiresAt) {
      return true;
    }
    const expiryMs = Date.parse(userProfile.subscriptionExpiresAt);
    return !Number.isFinite(expiryMs) || expiryMs > Date.now();
  }, [userProfile]);
  const isFreePlan = !isAdmin && !isEffectivePro;
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/');

  const navigateTo = useCallback((nextPath: string) => {
    if (typeof window !== 'undefined' && window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
    setPathname(nextPath);
  }, []);

  // Sequential Wizard
  const [step, setStep] = useState<WizardStep>(1);
  const [maxReachedStep, setMaxReachedStep] = useState<number>(1);

  // Video & Player
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState('Novo vídeo curto');
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Step 2: Subtitles, Dictionary, Undo/Redo & Style
  const initialDraft = useMemo(() => readLocalDraft(), []);
  const [language, setLanguage] = useState<SupportedLanguage>(
    initialDraft?.language || 'pt-BR',
  );
  const [customDictionary, setCustomDictionary] = useState<string>(
    initialDraft?.customDictionary || '',
  );
  const [segments, setSegments] = useState<SubtitleSegment[]>([]);
  const [undoStack, setUndoStack] = useState<SubtitleSegment[][]>([]);
  const [redoStack, setRedoStack] = useState<SubtitleSegment[][]>([]);
  const [subtitlesReviewed, setSubtitlesReviewed] = useState(false);
  const [clipEndTime, setClipEndTime] = useState<number | null>(null);
  const [transcribedKey, setTranscribedKey] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [transcribeStage, setTranscribeStage] = useState('Preparando vídeo...');
  const [styleConfig, setStyleConfig] = useState<StyleConfig>(() => {
    if (
      initialDraft?.styleConfig &&
      PRESET_DEFINITIONS[initialDraft.styleConfig.preset]
    ) {
      return initialDraft.styleConfig;
    }
    return { ...PRESET_DEFINITIONS.viral_impacto.style };
  });


  // Export
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const exportAbortRef = useRef<AbortController | null>(null);

  // Feedback Banner
  const [alert, setAlert] = useState<BannerAlert | null>(null);

  useEffect(() => {
    const onPopState = () => {
      setPathname(window.location.pathname || '/');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setUserProfile(null);
        setUserProOrders([]);
        setFreeQuota({
          generatedCount: 0,
          generatedVideoNames: [],
          savedVideosCount: 0,
          savedVideoKeys: [],
          loaded: false,
        });
        setProLimitMessage(null);
        setShowProModal(false);
        setAdminVerifyState('idle');
        setAdminVerifyResult(null);
        setShowAdminDiag(false);
        setStep(1);
      } else {
        void syncUserProfileOnLogin(nextUser).then((profile) => {
          if (profile) setUserProfile(profile);
        });
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsubProfile = subscribeToCurrentUserProfile(user.uid, (profile) => {
      if (profile) setUserProfile(profile);
    });
    const unsubSettings = subscribeToMulticaixaSettings((settings) => {
      setMulticaixaSettings(settings);
    });
    const unsubOrders = subscribeToUserProOrders(user.uid, (orders) => {
      setUserProOrders(orders);
    });
    const unsubQuota = subscribeToUserFreeQuota(user.uid, (quota) => {
      setFreeQuota(quota);
    });
    return () => {
      unsubProfile();
      unsubSettings();
      unsubOrders();
      unsubQuota();
    };
  }, [user]);

  useEffect(() => {
    if (!isAdminRoute || !user) {
      return;
    }
    if (!isAdminUser(user)) {
      setAdminVerifyState('denied');
      setAdminVerifyResult({
        authorized: false,
        error:
          'Acesso negado. Apenas a conta administradora principal autorizada pode aceder a esta área.',
        code: 'ADMIN_FORBIDDEN',
      });
      return;
    }

    let cancelled = false;
    setAdminVerifyState('checking');
    void verifyAdminSessionOnServer(user).then((res) => {
      if (cancelled) return;
      if (res.authorized) {
        setAdminVerifyState('authorized');
        setAdminVerifyResult(res);
      } else {
        setAdminVerifyState('denied');
        setAdminVerifyResult(res);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isAdminRoute, user]);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  // Inform user on startup if an autosaved draft exists from a previous session
  useEffect(() => {
    if (
      initialDraft &&
      Array.isArray(initialDraft.segments) &&
      initialDraft.segments.length > 0 &&
      initialDraft.videoFileName
    ) {
      setAlert({
        type: 'info',
        message: `Rascunho salvo automaticamente encontrado para "${initialDraft.videoFileName}" (${initialDraft.segments.length} legendas). Selecione o mesmo vídeo para restaurar suas edições.`,
      });
    }
  }, [initialDraft]);

  // Auto-save Step 2 work in localStorage
  useEffect(() => {
    try {
      const videoKey = videoFile ? `${videoFile.name}_${videoFile.size}` : null;
      const existing = readLocalDraft();
      const payload: LocalDraftPayload = {
        videoKey: videoKey ?? existing?.videoKey ?? null,
        videoFileName: videoFileName ?? existing?.videoFileName ?? null,
        language,
        customDictionary,
        styleConfig,
        segments:
          segments.length > 0
            ? segments
            : videoFile
              ? []
              : existing?.segments ?? [],
        subtitlesReviewed:
          segments.length > 0
            ? subtitlesReviewed
            : videoFile
              ? false
              : existing?.subtitlesReviewed ?? false,
        updatedAt: Date.now(),
      };
      localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors cleanly
    }
  }, [
    videoFile,
    videoFileName,
    language,
    customDictionary,
    styleConfig,
    segments,
    subtitlesReviewed,
  ]);


  const handleSelectFile = useCallback(
    (file: File) => {
      setAlert(null);
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const validExts = ['mp4', 'mov', 'webm', 'm4v'];
      const validMimes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];

      if (!validExts.includes(ext) && !validMimes.includes(file.type)) {
        setAlert({
          type: 'error',
          message: 'Formato não suportado. Envie um vídeo MP4, MOV ou WebM.',
        });
        return;
      }

      if (file.size > MAX_UPLOAD_BYTES) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
        setAlert({
          type: 'error',
          message: `Vídeo grande demais (${sizeMb} MB). O limite máximo é ${MAX_UPLOAD_MB} MB.`,
        });
        return;
      }

      const nextUrl = URL.createObjectURL(file);
      const fileSig = `${file.name}_${file.size}`;
      const savedDraft = readLocalDraft();

      setVideoFile(file);
      setVideoUrl(nextUrl);
      setVideoFileName(file.name);
      setProjectTitle(file.name.replace(/\.[^/.]+$/, '') || 'Novo vídeo curto');
      setCurrentTime(0);
      setClipEndTime(null);
      setIsPlaying(false);
      setUndoStack([]);
      setRedoStack([]);

      if (
        savedDraft &&
        savedDraft.videoKey === fileSig &&
        Array.isArray(savedDraft.segments) &&
        savedDraft.segments.length > 0
      ) {
        setSegments(savedDraft.segments);
        setLanguage(savedDraft.language || 'pt-BR');
        setCustomDictionary(savedDraft.customDictionary || '');
        if (savedDraft.styleConfig && PRESET_DEFINITIONS[savedDraft.styleConfig.preset]) {
          setStyleConfig(savedDraft.styleConfig);
        }
        setSubtitlesReviewed(Boolean(savedDraft.subtitlesReviewed));
        setTranscribedKey(`${fileSig}_${savedDraft.language || 'pt-BR'}`);
        setMaxReachedStep(2);
        setAlert({
          type: 'success',
          message: `Edições salvas automaticamente para "${file.name}" restauradas (${savedDraft.segments.length} blocos).`,
        });
      } else {
        setSegments([]);
        setSubtitlesReviewed(false);
        setTranscribedKey(null);
        setMaxReachedStep(1);
      }
    },
    [],
  );

  const extractHtmlTitleHint = (htmlText: string): string => {
    const titleMatch = htmlText.match(/<title[^>]*>([^<]{1,80})<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      return titleMatch[1].replace(/\s+/g, ' ').trim();
    }
    return '';
  };

  const parseServerError = (
    status: number,
    responseText: string,
    context?: string,
  ): string => {
    const trimmed = (responseText || '').trim();
    try {
      const data = JSON.parse(trimmed || '{}');
      if (typeof data?.error === 'string' && data.error.trim()) {
        return data.error;
      }
    } catch {
      // non-JSON response (e.g. proxy HTML error)
    }

    console.error('[DEWES Transcribe] Resposta inesperada do servidor:', {
      status,
      context,
      preview: trimmed.slice(0, 240),
    });

    if (status === 413) {
      return 'O arquivo ultrapassou o limite aceito pelo servidor neste envio. Tente um vídeo menor.';
    }
    if (status === 502 || status === 503 || status === 504) {
      return `O servidor de transcrição demorou para responder (HTTP ${status}). Tente novamente em instantes.`;
    }
    if (/^<!doctype|^<html/i.test(trimmed)) {
      const titleHint = extractHtmlTitleHint(trimmed);
      const hintSuffix = titleHint ? ` [${titleHint}]` : '';
      const ctxSuffix = context ? ` (${context})` : '';
      return `O servidor retornou uma página HTML inesperada em vez dos dados da transcrição (HTTP ${status})${hintSuffix}${ctxSuffix}. Recarregue a página e tente novamente.`;
    }
    if (!trimmed && status > 0) {
      return `O servidor encerrou a conexão sem enviar dados (HTTP ${status}). Tente novamente em instantes.`;
    }
    if (status > 0) {
      return `Falha na comunicação com o servidor de transcrição (HTTP ${status}).`;
    }
    return 'Falha na comunicação com o servidor de transcrição. Verifique sua conexão e tente novamente.';
  };

  const fileToBase64 = (file: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = typeof reader.result === 'string' ? reader.result : '';
        const commaIdx = res.indexOf(',');
        resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
      };
      reader.onerror = () => reject(new Error('Falha ao ler áudio no navegador.'));
      reader.readAsDataURL(file);
    });

  const currentVideoKey = useMemo(() => {
    if (videoFile) {
      return `${videoFile.name}_${videoFile.size}`;
    }
    return videoFileName || projectTitle || 'video';
  }, [videoFile, videoFileName, projectTitle]);

  const isGenerationBlocked = useMemo(
    () => isFreePlan && freeQuota.generatedCount >= FREE_VIDEO_LIMIT,
    [isFreePlan, freeQuota.generatedCount],
  );

  const isSaveBlocked = useMemo(
    () =>
      isFreePlan &&
      (freeQuota.savedVideosCount >= FREE_VIDEO_LIMIT ||
        (freeQuota.generatedCount >= FREE_VIDEO_LIMIT &&
          Boolean(videoFileName) &&
          !freeQuota.generatedVideoNames.includes(videoFileName || ''))),
    [
      isFreePlan,
      freeQuota.savedVideosCount,
      freeQuota.generatedCount,
      freeQuota.generatedVideoNames,
      videoFileName,
    ],
  );

  const openProModalWithLimit = useCallback((message: string) => {
    setProLimitMessage(message);
    setAlert({ type: 'error', message });
    setShowProModal(true);
  }, []);

  const runGeminiTranscription = useCallback(
    async (targetLang: SupportedLanguage) => {
      if (!videoFile) return;

      if (isGenerationBlocked) {
        openProModalWithLimit(
          'Limite do Plano Grátis atingido (2 de 2 vídeos gerados). Assine o plano PRO para continuar a gerar vídeos.',
        );
        return;
      }

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setAlert({
          type: 'error',
          message: 'Sem internet. Gerar legendas precisa de conexão.',
        });
        return;
      }

      setAlert(null);
      setIsTranscribing(true);
      setTranscribeProgress(5);
      setTranscribeStage('Conectando ao servidor de transcrição...');

      let serverMaxUploadBytes = 100 * 1024 * 1024;
      let serverChunkSupported = true;
      let serverPlatform = 'node';

      // Verify /api/health first so proxy/auth/static-host/Vercel limits are caught immediately
      try {
        const healthRes = await fetch('/api/health', {
          method: 'GET',
          cache: 'no-store',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        const healthText = await healthRes.text();
        let healthOk = false;
        let parsedHealth: {
          status?: string;
          platform?: string;
          maxUploadBytes?: number;
          chunkSupported?: boolean;
          hasGeminiKey?: boolean;
        } = {};
        try {
          parsedHealth = JSON.parse(healthText || '{}');
          healthOk = healthRes.ok && parsedHealth?.status === 'ok';
        } catch {
          healthOk = false;
        }
        if (!healthOk) {
          throw new Error(
            parseServerError(healthRes.status, healthText, 'api-health'),
          );
        }
        if (parsedHealth.hasGeminiKey === false) {
          throw new Error(
            'Chave da API Gemini (GEMINI_API_KEY) não configurada neste servidor. Adicione GEMINI_API_KEY nas Environment Variables da Vercel e faça um novo deploy.',
          );
        }
        if (
          typeof parsedHealth.maxUploadBytes === 'number' &&
          parsedHealth.maxUploadBytes > 0
        ) {
          serverMaxUploadBytes = parsedHealth.maxUploadBytes;
        }
        if (typeof parsedHealth.chunkSupported === 'boolean') {
          serverChunkSupported = parsedHealth.chunkSupported;
        }
        if (typeof parsedHealth.platform === 'string') {
          serverPlatform = parsedHealth.platform;
        }
      } catch (healthErr) {
        setIsTranscribing(false);
        setTranscribeProgress(0);
        setAlert({
          type: 'error',
          message:
            healthErr instanceof Error
              ? healthErr.message
              : 'Não foi possível conectar ao servidor de transcrição.',
        });
        return;
      }

      setTranscribeStage('Extraindo e otimizando áudio do vídeo...');
      const maxAudioWavBytes = serverChunkSupported
        ? 14 * 1024 * 1024
        : Math.max(
            1024 * 1024,
            Math.min(2.6 * 1024 * 1024, Math.floor(serverMaxUploadBytes * 0.65)),
          );
      const maxPartDurationSec = serverChunkSupported ? 180 : 50;

      const prepared = await prepareAudioForTranscription(
        videoFile,
        maxAudioWavBytes,
        maxPartDurationSec,
      );
      if (prepared.isSilent) {
        setIsTranscribing(false);
        setTranscribeProgress(0);
        setAlert({
          type: 'error',
          message:
            'Vídeo sem áudio ou completamente mudo. Envie um vídeo com fala audível.',
        });
        return;
      }

      const partsToProcess =
        prepared.audioParts.length > 0
          ? prepared.audioParts
          : [{ file: videoFile, startTime: 0, duration }];

      if (
        prepared.audioParts.length === 0 &&
        !serverChunkSupported &&
        videoFile.size > serverMaxUploadBytes
      ) {
        setIsTranscribing(false);
        setTranscribeProgress(0);
        const limitMb = Math.max(1, Math.round(serverMaxUploadBytes / (1024 * 1024)));
        const reasonHint = prepared.decodeError
          ? ` (${prepared.decodeError})`
          : '';
        setAlert({
          type: 'error',
          message:
            serverPlatform === 'vercel'
              ? `Não foi possível extrair o áudio deste vídeo no navegador${reasonHint} e o arquivo original ultrapassa o limite direto de ${limitMb} MB da Vercel. Reexporte ou converta o vídeo como MP4 (AAC) padrão para enviar arquivos de 100 MB ou mais.`
              : `O arquivo ultrapassou o limite de ${limitMb} MB aceito pelo servidor.`,
        });
        return;
      }

      const CHUNK_THRESHOLD_BYTES = serverChunkSupported
        ? 10 * 1024 * 1024
        : serverMaxUploadBytes + 1;
      const JSON_FALLBACK_MAX_BYTES = serverChunkSupported
        ? 12 * 1024 * 1024
        : Math.floor(serverMaxUploadBytes * 0.72);
      const CHUNK_SIZE_BYTES = 3 * 1024 * 1024; // 3 MB chunks (safe under proxy body limits)
      let aiTicker: number | undefined;

      const transcribeSingleTarget = async (
        targetFile: File,
        partIdx: number,
        totalParts: number,
        allowNoAudio: boolean,
      ): Promise<{
        segments: SubtitleSegment[];
        detectedLanguage: string;
        usage?: TranscriptionUsageMeta;
      }> => {
        const partLabel = totalParts > 1 ? ` (${partIdx + 1}/${totalParts})` : '';
        const basePct = 10 + Math.round((partIdx / totalParts) * 85);
        const spanPct = Math.max(5, Math.round(85 / totalParts));
        const uploadMaxPct = Math.min(94, basePct + Math.round(spanPct * 0.45));
        const aiMaxPct = Math.min(95, basePct + spanPct);

        const sendViaChunkedUpload = async (): Promise<{
          segments: SubtitleSegment[];
          detectedLanguage: string;
          usage?: TranscriptionUsageMeta;
        }> => {
          const uploadId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const totalChunks = Math.ceil(targetFile.size / CHUNK_SIZE_BYTES);

          for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE_BYTES;
            const end = Math.min(targetFile.size, start + CHUNK_SIZE_BYTES);
            const chunkBlob = targetFile.slice(start, end);

            const chunkForm = new FormData();
            chunkForm.append('uploadId', uploadId);
            chunkForm.append('chunkIndex', String(i));
            chunkForm.append('chunk', chunkBlob, `part_${i}`);

            setTranscribeStage(
              `Enviando vídeo${partLabel} (${i + 1}/${totalChunks})...`,
            );
            const chunkRes = await fetch('/api/transcribe/chunk', {
              method: 'POST',
              credentials: 'include',
              headers: { Accept: 'application/json' },
              body: chunkForm,
            });
            const chunkText = await chunkRes.text();
            if (!chunkRes.ok) {
              throw new Error(
                parseServerError(chunkRes.status, chunkText, 'chunk'),
              );
            }
            setTranscribeProgress(
              Math.min(
                uploadMaxPct,
                basePct + Math.round(((i + 1) / totalChunks) * (uploadMaxPct - basePct)),
              ),
            );
          }

          setTranscribeProgress(uploadMaxPct);
          setTranscribeStage(`Transcrevendo áudio com Gemini${partLabel}...`);
          aiTicker = window.setInterval(() => {
            setTranscribeProgress((prev) => (prev < aiMaxPct ? prev + 1 : prev));
          }, 700);

          const completeRes = await fetch('/api/transcribe/complete', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              uploadId,
              totalChunks,
              fileName: targetFile.name,
              mimeType: targetFile.type || 'video/mp4',
              language: targetLang,
              customDictionary: customDictionary.trim(),
            }),
          });
          if (aiTicker) {
            clearInterval(aiTicker);
            aiTicker = undefined;
          }

          const completeText = await completeRes.text();
          let data: {
            segments?: SubtitleSegment[];
            detectedLanguage?: string;
            usage?: TranscriptionUsageMeta;
            error?: string;
            code?: string;
          } = {};
          try {
            data = JSON.parse(completeText || '{}');
          } catch {
            throw new Error(
              parseServerError(completeRes.status, completeText, 'complete'),
            );
          }

          if (allowNoAudio && (completeRes.status === 422 || data.code === 'NO_AUDIO')) {
            return { segments: [], detectedLanguage: targetLang };
          }

          if (!completeRes.ok || !Array.isArray(data.segments)) {
            throw new Error(
              data.error ||
                parseServerError(completeRes.status, completeText, 'complete-json'),
            );
          }

          return {
            segments: data.segments,
            detectedLanguage: data.detectedLanguage || targetLang,
            usage: data.usage,
          };
        };

        const sendViaJsonFallback = async (): Promise<{
          segments: SubtitleSegment[];
          detectedLanguage: string;
          usage?: TranscriptionUsageMeta;
        }> => {
          setTranscribeStage(`Reenviando áudio em formato compatível${partLabel}...`);
          setTranscribeProgress(uploadMaxPct);
          const audioBase64 = await fileToBase64(targetFile);
          const res = await fetch('/api/transcribe-json', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              audioBase64,
              fileName: targetFile.name,
              mimeType: targetFile.type || 'audio/wav',
              language: targetLang,
              customDictionary: customDictionary.trim(),
            }),
          });
          const text = await res.text();
          let data: {
            segments?: SubtitleSegment[];
            detectedLanguage?: string;
            usage?: TranscriptionUsageMeta;
            error?: string;
            code?: string;
          } = {};
          try {
            data = JSON.parse(text || '{}');
          } catch {
            throw new Error(parseServerError(res.status, text, 'transcribe-json'));
          }
          if (allowNoAudio && (res.status === 422 || data.code === 'NO_AUDIO')) {
            return { segments: [], detectedLanguage: targetLang };
          }
          if (!res.ok || !Array.isArray(data.segments)) {
            throw new Error(
              data.error || parseServerError(res.status, text, 'transcribe-json'),
            );
          }
          return {
            segments: data.segments,
            detectedLanguage: data.detectedLanguage || targetLang,
            usage: data.usage,
          };
        };

        if (targetFile.size > CHUNK_THRESHOLD_BYTES) {
          return sendViaChunkedUpload();
        }

        const formData = new FormData();
        formData.append('video', targetFile);
        formData.append('language', targetLang);
        if (customDictionary.trim()) {
          formData.append('customDictionary', customDictionary.trim());
        }

        try {
          return await new Promise<{
            segments: SubtitleSegment[];
            detectedLanguage: string;
            usage?: TranscriptionUsageMeta;
          }>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/transcribe');
            xhr.withCredentials = true;
            xhr.setRequestHeader('Accept', 'application/json');
            xhr.timeout = 240000;

            xhr.upload.onprogress = (ev) => {
              if (ev.lengthComputable) {
                const ratio = ev.loaded / Math.max(1, ev.total);
                const pct = Math.min(
                  uploadMaxPct,
                  basePct + Math.round(ratio * (uploadMaxPct - basePct)),
                );
                setTranscribeProgress(pct);
                setTranscribeStage(
                  prepared.audioParts.length > 0
                    ? `Enviando áudio otimizado${partLabel}...`
                    : `Enviando vídeo para transcrição${partLabel}...`,
                );
              }
            };

            xhr.upload.onload = () => {
              setTranscribeProgress(uploadMaxPct);
              setTranscribeStage(`Transcrevendo áudio com Gemini${partLabel}...`);
              aiTicker = window.setInterval(() => {
                setTranscribeProgress((prev) => (prev < aiMaxPct ? prev + 1 : prev));
              }, 700);
            };

            xhr.onload = () => {
              if (aiTicker) {
                clearInterval(aiTicker);
                aiTicker = undefined;
              }
              const contentType = xhr.getResponseHeader('content-type') || '';
              if (
                xhr.responseURL &&
                !xhr.responseURL.includes('/api/transcribe')
              ) {
                reject(
                  new Error(
                    parseServerError(
                      xhr.status,
                      xhr.responseText,
                      `redirected:${xhr.responseURL}`,
                    ),
                  ),
                );
                return;
              }
              try {
                const data = JSON.parse(xhr.responseText || '{}');
                if (
                  allowNoAudio &&
                  (xhr.status === 422 || data.code === 'NO_AUDIO')
                ) {
                  resolve({ segments: [], detectedLanguage: targetLang });
                  return;
                }
                if (
                  xhr.status >= 200 &&
                  xhr.status < 300 &&
                  Array.isArray(data.segments)
                ) {
                  resolve(data);
                } else {
                  reject(
                    new Error(
                      data.error ||
                        parseServerError(
                          xhr.status,
                          xhr.responseText,
                          `ct=${contentType}`,
                        ),
                    ),
                  );
                }
              } catch {
                reject(
                  new Error(
                    parseServerError(
                      xhr.status,
                      xhr.responseText,
                      `ct=${contentType}`,
                    ),
                  ),
                );
              }
            };

            xhr.ontimeout = () => {
              if (aiTicker) {
                clearInterval(aiTicker);
                aiTicker = undefined;
              }
              reject(
                new Error(
                  'O tempo de transcrição excedeu o limite. Tente um vídeo mais curto ou verifique sua conexão.',
                ),
              );
            };

            xhr.onerror = () => {
              if (aiTicker) {
                clearInterval(aiTicker);
                aiTicker = undefined;
              }
              reject(
                new Error(
                  'Erro de rede ao enviar o vídeo. Verifique sua conexão e tente novamente.',
                ),
              );
            };

            xhr.send(formData);
          });
        } catch (multipartErr) {
          const msg =
            multipartErr instanceof Error
              ? multipartErr.message
              : String(multipartErr);
          const looksLikeHtmlOrProxyIssue =
            msg.includes('HTML') || msg.includes('sem enviar dados');
          const looksLikeTooLarge =
            msg.includes('ultrapassou o limite') ||
            msg.includes('entity too large') ||
            msg.includes('413');
          if (serverChunkSupported && looksLikeTooLarge) {
            return sendViaChunkedUpload();
          }
          if (
            (looksLikeHtmlOrProxyIssue || looksLikeTooLarge) &&
            targetFile.size <= JSON_FALLBACK_MAX_BYTES
          ) {
            return sendViaJsonFallback();
          }
          throw multipartErr;
        }
      };

      let totalTokensSum = 0;
      let estimatedCostSum = 0;
      let lastModelUsed = 'gemini-3.5-transcribe';

      try {
        const mergedSegments: SubtitleSegment[] = [];
        let finalDetectedLanguage: string = targetLang;
        const totalParts = partsToProcess.length;

        for (let idx = 0; idx < totalParts; idx++) {
          const part = partsToProcess[idx];
          const partResult = await transcribeSingleTarget(
            part.file,
            idx,
            totalParts,
            totalParts > 1,
          );
          if (idx === 0 && partResult.detectedLanguage) {
            finalDetectedLanguage = partResult.detectedLanguage;
          }
          if (partResult.usage) {
            totalTokensSum += partResult.usage.totalTokens || 0;
            estimatedCostSum += partResult.usage.estimatedCostUsd || 0;
            if (partResult.usage.modelUsed) {
              lastModelUsed = partResult.usage.modelUsed;
            }
          }

          const offset = part.startTime;
          for (const seg of partResult.segments) {
            const shiftedWords = seg.words.map((w) => ({
              ...w,
              id: `p${idx}_${w.id}`,
              start: Number((w.start + offset).toFixed(3)),
              end: Number((w.end + offset).toFixed(3)),
            }));
            mergedSegments.push({
              ...seg,
              id: `p${idx}_${seg.id}`,
              start: Number((seg.start + offset).toFixed(3)),
              end: Number((seg.end + offset).toFixed(3)),
              words: shiftedWords,
            });
          }
        }

        if (mergedSegments.length === 0) {
          throw new Error(
            'Nenhuma fala audível foi detectada neste vídeo. Verifique se o áudio não está mudo.',
          );
        }

        setTranscribeProgress(100);
        setTranscribeStage('Legendas prontas!');
        setUndoStack([]);
        setRedoStack([]);
        setSegments(mergedSegments);
        setSubtitlesReviewed(false);
        setTranscribedKey(`${videoFile.name}_${videoFile.size}_${targetLang}`);
        const reviewCount = mergedSegments.reduce(
          (acc, s) => acc + s.words.filter((w) => w.needsReview).length,
          0,
        );
        const totalWordCount = mergedSegments.reduce(
          (acc, s) => acc + s.words.length,
          0,
        );
        if (user) {
          void logTranscriptionActivity({
            user,
            userPlan: isEffectivePro ? 'PRO' : 'FREE',
            videoFileName: videoFile.name,
            durationSeconds: duration || 0,
            language: targetLang,
            segmentCount: mergedSegments.length,
            wordCount: totalWordCount,
            modelUsed: lastModelUsed,
            estimatedCostUsd: Number(estimatedCostSum.toFixed(6)),
            totalTokens: totalTokensSum,
            status: 'completed',
          });
        }
        setAlert({
          type: 'success',
          message:
            reviewCount > 0
              ? `Transcrição concluída (${mergedSegments.length} blocos). Há ${reviewCount} palavra(s) marcada(s) em amarelo para revisão antes de avançar.`
              : `Transcrição concluída (${mergedSegments.length} blocos, ${finalDetectedLanguage}). Revise o texto e clique em "Legendas revisadas" para continuar.`,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (user) {
          void logTranscriptionActivity({
            user,
            userPlan: isEffectivePro ? 'PRO' : 'FREE',
            videoFileName: videoFile.name,
            durationSeconds: duration || 0,
            language: targetLang,
            segmentCount: 0,
            wordCount: 0,
            modelUsed: lastModelUsed,
            estimatedCostUsd: Number(estimatedCostSum.toFixed(6)),
            totalTokens: totalTokensSum,
            status: 'error',
            errorCode: 'TRANSCRIPTION_ERROR',
            errorMessage: msg,
          });
        }
        setAlert({ type: 'error', message: msg });
      } finally {
        if (aiTicker) clearInterval(aiTicker);
        setTimeout(() => {
          setIsTranscribing(false);
          setTranscribeProgress(0);
        }, 300);
      }
    },
    [
      videoFile,
      customDictionary,
      duration,
      user,
      isEffectivePro,
      isGenerationBlocked,
      openProModalWithLimit,
    ],
  );

  // Step 1 -> Step 2 (Auto-transcribe upon entering Step 2 if needed)
  const handleGoToStep2 = () => {
    if (!videoUrl) return;
    const currentKey = videoFile
      ? `${videoFile.name}_${videoFile.size}_${language}`
      : '';
    const needsNewGeneration =
      Boolean(videoFile) && (segments.length === 0 || transcribedKey !== currentKey);

    if (needsNewGeneration && isGenerationBlocked) {
      openProModalWithLimit(
        'Limite do Plano Grátis atingido (2 de 2 vídeos gerados). Assine o plano PRO para gerar mais vídeos.',
      );
      return;
    }

    setAlert(null);
    setStep(2);
    setMaxReachedStep((prev) => Math.max(prev, 2));
    if (needsNewGeneration) {
      runGeminiTranscription(language);
    }
  };

  // Step 2 -> Exportar (Requires subtitlesReviewed confirmation)
  const handleGoToExport = () => {
    if (segments.length === 0 || !subtitlesReviewed) return;
    setAlert(null);
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
    setClipEndTime(null);
    setStep('export');
    setMaxReachedStep(3);
  };

  const handleSelectWizardStep = (targetStep: WizardStep) => {
    setAlert(null);
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
    setClipEndTime(null);
    setStep(targetStep);
  };

  // Undo / Redo + Subtitle Editing Operations
  const pushUndoSnapshot = useCallback((snapshot: SubtitleSegment[]) => {
    setUndoStack((prev) => [...prev.slice(-49), snapshot]);
    setRedoStack([]);
  }, []);

  const markSubtitlesModified = useCallback(() => {
    setSubtitlesReviewed(false);
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const previous = prev[prev.length - 1];
      setSegments((curr) => {
        setRedoStack((r) => [...r, curr]);
        return previous;
      });
      markSubtitlesModified();
      return prev.slice(0, -1);
    });
  }, [markSubtitlesModified]);

  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[prev.length - 1];
      setSegments((curr) => {
        setUndoStack((u) => [...u.slice(-49), curr]);
        return next;
      });
      markSubtitlesModified();
      return prev.slice(0, -1);
    });
  }, [markSubtitlesModified]);

  // Global Ctrl+Z / Ctrl+Y shortcuts while on Step 2
  useEffect(() => {
    if (step !== 2) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (isTextField) return;

      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step, handleUndo, handleRedo]);

  const handleEditSegmentText = (segmentId: string, newText: string) => {
    setSegments((prev) =>
      prev.map((seg) => (seg.id === segmentId ? rebuildSegmentWords(seg, newText) : seg)),
    );
    markSubtitlesModified();
  };

  const handleEditSingleWord = (
    segmentId: string,
    wordId: string,
    newWordText: string,
  ) => {
    pushUndoSnapshot(segments);
    setSegments((prev) =>
      prev.map((seg) =>
        seg.id === segmentId
          ? editSingleWordInSegment(seg, wordId, newWordText)
          : seg,
      ),
    );
    markSubtitlesModified();
  };

  const handleMarkWordReviewed = (segmentId: string, wordId: string) => {
    pushUndoSnapshot(segments);
    setSegments((prev) =>
      prev.map((seg) =>
        seg.id === segmentId ? markWordReviewedInSegment(seg, wordId) : seg,
      ),
    );
  };

  const handleSplitSegment = (segmentId: string, cursorPos?: number) => {
    const idx = segments.findIndex((s) => s.id === segmentId);
    if (idx === -1) return;
    const target = segments[idx];
    const parts =
      typeof cursorPos === 'number'
        ? splitSegmentByCharOffset(target, cursorPos)
        : splitSegmentAtWordIndex(target, Math.floor(target.words.length / 2));
    if (!parts) return;

    pushUndoSnapshot(segments);
    setSegments((prev) => [
      ...prev.slice(0, idx),
      parts[0],
      parts[1],
      ...prev.slice(idx + 1),
    ]);
    markSubtitlesModified();
  };

  const handleMergeWithNext = (segmentId: string) => {
    const idx = segments.findIndex((s) => s.id === segmentId);
    if (idx === -1 || idx >= segments.length - 1) return;
    pushUndoSnapshot(segments);
    const merged = mergeTwoSegments(segments[idx], segments[idx + 1]);
    setSegments((prev) => [
      ...prev.slice(0, idx),
      merged,
      ...prev.slice(idx + 2),
    ]);
    markSubtitlesModified();
  };

  const handleDeleteSegment = (segmentId: string) => {
    pushUndoSnapshot(segments);
    setSegments((prev) => prev.filter((s) => s.id !== segmentId));
    markSubtitlesModified();
  };

  const handleAddSegmentAtCurrentTime = () => {
    pushUndoSnapshot(segments);
    setSegments((prev) => createSegmentAtTime(prev, currentTime, duration));
    markSubtitlesModified();
  };

  const handleUpdateSegmentTimes = (
    segmentId: string,
    newStart: number,
    newEnd: number,
  ) => {
    setSegments((prev) =>
      prev
        .map((seg) =>
          seg.id === segmentId
            ? updateSegmentTimeRange(seg, newStart, newEnd, duration)
            : seg,
        )
        .sort((a, b) => a.start - b.start),
    );
    markSubtitlesModified();
  };

  const handleFindAndReplaceAll = (
    searchQuery: string,
    replacement: string,
  ): number => {
    const { nextSegments, matchCount } = findAndReplaceInSegments(
      segments,
      searchQuery,
      replacement,
    );
    if (matchCount > 0) {
      pushUndoSnapshot(segments);
      setSegments(nextSegments);
      markSubtitlesModified();
    }
    return matchCount;
  };

  const handlePlaySegmentClip = (seg: SubtitleSegment) => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = seg.start;
    setCurrentTime(seg.start);
    setClipEndTime(seg.end);
    vid.play().catch(() => {});
  };


  const handleTogglePlay = () => {
    const vid = videoRef.current;
    if (!vid) return;
    setClipEndTime(null);
    if (vid.paused) {
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  };

  const handleSeek = (time: number) => {
    const vid = videoRef.current;
    if (!vid) return;
    setClipEndTime(null);
    const clamped = Math.max(0, Math.min(duration || 0, time));
    vid.currentTime = clamped;
    setCurrentTime(clamped);
  };

  const handleDownloadSrt = () => {
    if (segments.length === 0) return;
    if (isSaveBlocked) {
      openProModalWithLimit(
        'Limite do Plano Grátis atingido (2 vídeos). O salvamento está bloqueado até ativar o plano PRO.',
      );
      return;
    }
    const srt = generateSrtContent(segments);
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const baseName = (projectTitle || videoFileName || 'legendas').replace(
      /\.[^/.]+$/,
      '',
    );
    a.download = `${baseName}.srt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    if (user) {
      void logVideoExportActivity({
        user,
        userPlan: isEffectivePro ? 'PRO' : 'FREE',
        videoKey: currentVideoKey,
        videoFileName: videoFileName || `${baseName}.mp4`,
        exportType: 'srt',
      });
    }
  };

  const handleExportVideo = async () => {
    if (!videoUrl || segments.length === 0) return;
    if (isSaveBlocked) {
      openProModalWithLimit(
        'Limite do Plano Grátis atingido (2 vídeos). O salvamento está bloqueado até ativar o plano PRO.',
      );
      return;
    }
    setAlert(null);
    setIsExporting(true);
    setExportProgress(0);

    const controller = new AbortController();
    exportAbortRef.current = controller;

    try {
      const result = await exportVideoWithBurnedSubtitles({
        videoUrl,
        segments,
        style: styleConfig,
        onProgress: setExportProgress,
        signal: controller.signal,
      });

      const downloadUrl = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      const baseName = (projectTitle || videoFileName || 'dewers-ia').replace(
        /\.[^/.]+$/,
        '',
      );
      a.download = `${baseName}-legendado.${result.extension}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(downloadUrl);

      if (user) {
        void logVideoExportActivity({
          user,
          userPlan: isEffectivePro ? 'PRO' : 'FREE',
          videoKey: currentVideoKey,
          videoFileName: videoFileName || `${baseName}.mp4`,
          exportType: 'video',
        });
      }

      setAlert({
        type: 'success',
        message: 'Vídeo final renderizado com legendas e baixado com sucesso.',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg !== 'EXPORT_ABORTED') {
        setAlert({
          type: 'error',
          message: `Erro ao renderizar vídeo final: ${msg}`,
        });
      }
    } finally {
      exportAbortRef.current = null;
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  const handleSignIn = async () => {
    setAlert(null);
    try {
      await signInWithGoogle();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('popup-closed-by-user')) {
        setAlert({
          type: 'error',
          message: `Não foi possível entrar com o Google: ${msg}`,
        });
      }
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#0B0D13] text-slate-200 flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
          <span>Verificando sessão...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <LoginScreen
          onLoginSuccess={() => {
            setStep(1);
          }}
        />
        <OfflineBanner />
        <PWAUpdateBanner />
      </>
    );
  }

  if (isAdminRoute) {
    if (!isAdmin || adminVerifyState === 'denied') {
      return (
        <div className="min-h-screen bg-[#090B10] text-slate-100 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#10131C] border border-rose-500/30 p-6 space-y-4 text-center shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6 text-rose-400" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-lg font-bold text-white">
                403 · Acesso Administrativo Restrito
              </h1>
              <p className="text-xs text-slate-300 leading-relaxed">
                {adminVerifyResult?.error ||
                  'Esta rota é exclusiva da administradora principal autorizada. A sua conta atual não possui privilégios administrativos.'}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => navigateTo('/')}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-amber-400 text-slate-950 text-xs font-bold hover:bg-amber-300 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Voltar ao Estúdio
              </button>
              <button
                type="button"
                onClick={() => signOutUser()}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-slate-200 hover:bg-white/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Terminar Sessão
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (adminVerifyState === 'checking' || adminVerifyState === 'idle' || !adminVerifyResult) {
      return (
        <div className="min-h-screen bg-[#090B10] text-slate-200 flex items-center justify-center p-4">
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
            <span>Validando credenciais administrativas no servidor...</span>
          </div>
        </div>
      );
    }

    return (
      <>
        <AdminDashboard
          user={user}
          serverVerification={adminVerifyResult}
          onBackToStudio={() => navigateTo('/')}
          onSignOut={() => signOutUser()}
        />
        <OfflineBanner />
        <PWAUpdateBanner />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#090B10] text-slate-100 flex flex-col">
      {/* Top Bar */}
      <header className="border-b border-white/10 bg-[#090B10]/95 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => setStep(1)}
            className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            <Clapperboard className="w-5 h-5 text-amber-400" />
            <span>Dewers IA</span>
          </button>

          {/* Zone 2: PRO Plan, Install PWA, Exclusive Admin Controls (dewersmatari@gmail.com only) & Auth Action */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <PWAInstallButton />
            {user && (
              <button
                type="button"
                onClick={() => {
                  setProLimitMessage(null);
                  setShowProModal(true);
                }}
                title="Plano PRO via Multicaixa Express e WhatsApp"
                className={`pwa-touch-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[44px] sm:min-h-[36px] ${
                  isEffectivePro
                    ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-200 hover:bg-emerald-500/25'
                    : 'bg-amber-400/15 border-amber-400/35 text-amber-200 hover:bg-amber-400/25'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {isEffectivePro
                    ? 'PRO Ativo'
                    : isFreePlan
                      ? `Assinar PRO (${Math.min(freeQuota.generatedCount, FREE_VIDEO_LIMIT)}/${FREE_VIDEO_LIMIT})`
                      : 'Assinar PRO'}
                </span>
              </button>
            )}
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => navigateTo('/admin')}
                  title="Painel Administrativo Exclusivo"
                  className="pwa-touch-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400/15 border border-amber-400/35 text-xs font-semibold text-amber-200 hover:bg-amber-400/25 transition-colors whitespace-nowrap shrink-0 min-h-[44px] sm:min-h-[36px]"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-300" />
                  <span className="hidden md:inline">Painel Admin</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdminDiag(true)}
                  title="Painel de Diagnóstico Firebase (Modo Desenvolvedor)"
                  className="pwa-touch-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-purple-500/15 border border-purple-400/30 text-xs font-medium text-purple-200 hover:bg-purple-500/25 transition-colors whitespace-nowrap shrink-0 min-h-[44px] sm:min-h-[36px]"
                >
                  <Terminal className="w-3.5 h-3.5 text-purple-300" />
                  <span className="hidden md:inline">Diagnóstico</span>
                </button>
              </>
            )}
            {user ? (
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="hidden sm:flex items-center gap-2 text-xs text-slate-300 max-w-[180px]">
                  {user.photoURL && (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || 'Avatar'}
                      referrerPolicy="no-referrer"
                      className="w-7 h-7 rounded-full border border-white/15 object-cover shrink-0"
                    />
                  )}
                  <span className="truncate font-medium">
                    {user.displayName || user.email}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => signOutUser()}
                  className="pwa-touch-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181C27] border border-white/10 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors whitespace-nowrap shrink-0 min-h-[44px] sm:min-h-[36px]"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sair
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSignIn}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-400 text-slate-950 text-xs font-semibold hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0"
              >
                <LogIn className="w-3.5 h-3.5" />
                Entrar com Google
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Top Step Progress Bar */}
      <WizardProgressBar
        currentStep={step}
        maxReachedStep={maxReachedStep}
        hasVideo={Boolean(videoUrl)}
        hasSubtitles={segments.length > 0}
        onSelectStep={handleSelectWizardStep}
      />

      <main className="flex-1">
        {/* Alert Banner */}
        {alert && (
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-5">
            <div
              role="alert"
              className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-sm ${
                alert.type === 'error'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                  : alert.type === 'info'
                    ? 'bg-sky-500/10 border-sky-500/30 text-sky-200'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {alert.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                ) : (
                  <CheckCircle2
                    className={`w-4 h-4 shrink-0 ${
                      alert.type === 'info' ? 'text-sky-400' : 'text-emerald-400'
                    }`}
                  />
                )}
                <span className="break-words">{alert.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setAlert(null)}
                aria-label="Fechar aviso"
                className="text-slate-400 hover:text-white shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {step === 1 ? (
          /* ===================== ETAPA 1: VÍDEO ===================== */
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-slate-100">
                  1. Enviar vídeo
                </h1>
                <p className="text-sm text-slate-400 mt-0.5">
                  Carregue seu vídeo curto (MP4, MOV ou WebM) e faça a pré-visualização antes de gerar as legendas.
                </p>
              </div>
              <button
                type="button"
                disabled={!videoUrl}
                onClick={handleGoToStep2}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber-400 text-slate-950 text-sm font-semibold hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
              >
                Continuar
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <VideoPlayerShell
              step={1}
              videoUrl={videoUrl}
              videoFileName={videoFileName}
              duration={duration}
              currentTime={currentTime}
              isPlaying={isPlaying}
              segments={[]}
              styleConfig={styleConfig}
              videoRef={videoRef}
              onSelectFile={handleSelectFile}
              onTogglePlay={handleTogglePlay}
              onSeek={handleSeek}
              onTimeSync={setCurrentTime}
              onLoadedMetadata={(dur) => setDuration(dur)}
              onPlayStateChange={setIsPlaying}
            />
          </div>
        ) : step === 2 ? (
          /* ===================== ETAPA 2: LEGENDAS ===================== */
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-6">
            {/* Step 2 Top Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-white/10">
              <div>
                <h1 className="text-lg font-bold text-slate-100">
                  2. Legendas e Estilo
                </h1>
                <p className="text-xs text-slate-400">
                  Escolha o estilo visual, ajuste tamanho/posição e corrija qualquer palavra clicando na frase.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleSelectWizardStep(1)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#181C27] border border-white/10 text-xs font-semibold text-slate-200 hover:bg-white/10 transition-colors whitespace-nowrap"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Voltar
                </button>
                <button
                  type="button"
                  disabled={segments.length === 0 || isTranscribing || !subtitlesReviewed}
                  onClick={handleGoToExport}
                  title={
                    !subtitlesReviewed
                      ? 'Clique em "Legendas revisadas" antes de continuar'
                      : undefined
                  }
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-amber-400 text-slate-950 text-xs font-semibold hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                  Continuar
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Transcription Progress Bar */}
            {isTranscribing && (
              <div className="bg-[#11141D] border border-amber-400/30 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-200">{transcribeStage}</span>
                  <span className="font-mono-tabular font-semibold text-amber-400">
                    {transcribeProgress}%
                  </span>
                </div>
                <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 transition-all duration-200"
                    style={{ width: `${transcribeProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Two-Column Step 2 Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <section className="lg:col-span-5 lg:sticky lg:top-24">
                <VideoPlayerShell
                  step={2}
                  videoUrl={videoUrl}
                  videoFileName={videoFileName}
                  duration={duration}
                  currentTime={currentTime}
                  isPlaying={isPlaying}
                  segments={segments}
                  styleConfig={styleConfig}
                  clipEndTime={clipEndTime}
                  videoRef={videoRef}
                  onTogglePlay={handleTogglePlay}
                  onSeek={handleSeek}
                  onTimeSync={setCurrentTime}
                  onLoadedMetadata={(dur) => setDuration(dur)}
                  onPlayStateChange={setIsPlaying}
                  onClipPlaybackComplete={() => setClipEndTime(null)}
                  onAddSubtitleAtPlayhead={handleAddSegmentAtCurrentTime}
                  onResizeSegmentStart={() => pushUndoSnapshot(segments)}
                  onResizeSegment={handleUpdateSegmentTimes}
                />
              </section>

              <section className="lg:col-span-7 flex flex-col gap-5">
                <StylePanel
                  styleConfig={styleConfig}
                  onChange={setStyleConfig}
                />
                <SubtitleEditorPanel
                  hasVideo={Boolean(videoFile)}
                  duration={duration}
                  language={language}
                  customDictionary={customDictionary}
                  segments={segments}
                  currentTime={currentTime}
                  isPlaying={isPlaying}
                  isTranscribing={isTranscribing}
                  canUndo={undoStack.length > 0}
                  canRedo={redoStack.length > 0}
                  subtitlesReviewed={subtitlesReviewed}
                  onLanguageChange={(nextLang) => {
                    setLanguage(nextLang);
                  }}
                  onCustomDictionaryChange={setCustomDictionary}
                  onGenerateSubtitles={() => runGeminiTranscription(language)}
                  onBeginTextEditSnapshot={() => pushUndoSnapshot(segments)}
                  onEditSegmentText={handleEditSegmentText}
                  onEditSingleWord={handleEditSingleWord}
                  onMarkWordReviewed={handleMarkWordReviewed}
                  onSplitSegment={handleSplitSegment}
                  onMergeWithNext={handleMergeWithNext}
                  onDeleteSegment={handleDeleteSegment}
                  onAddSegmentAtCurrentTime={handleAddSegmentAtCurrentTime}
                  onUpdateSegmentTimes={handleUpdateSegmentTimes}
                  onFindAndReplaceAll={handleFindAndReplaceAll}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                  onPlaySegmentClip={handlePlaySegmentClip}
                  onSeekTo={handleSeek}
                  onConfirmReviewed={() => {
                    setSubtitlesReviewed(true);
                    setAlert({
                      type: 'success',
                      message:
                        'Legendas confirmadas como revisadas! Clique em "Continuar" para exportar o vídeo.',
                    });
                  }}
                  freePlanInfo={{
                    isFree: isFreePlan,
                    used: freeQuota.generatedCount,
                    limit: FREE_VIDEO_LIMIT,
                    generationBlocked: isGenerationBlocked,
                  }}
                  onOpenProUpgrade={() => {
                    setProLimitMessage(
                      isGenerationBlocked
                        ? 'Limite do Plano Grátis atingido (2 vídeos). Assine o PRO para continuar.'
                        : null,
                    );
                    setShowProModal(true);
                  }}
                />
              </section>
            </div>
          </div>
        ) : (
          /* ===================== EXPORTAÇÃO (APÓS ETAPA 2) ===================== */
          <ExportStage
            projectTitle={projectTitle}
            duration={duration}
            segments={segments}
            styleConfig={styleConfig}
            hasVideo={Boolean(videoUrl)}
            isExporting={isExporting}
            exportProgress={exportProgress}
            onDownloadVideo={handleExportVideo}
            onCancelExport={() => exportAbortRef.current?.abort()}
            onDownloadSrt={handleDownloadSrt}
            onBackToStep2={() => setStep(2)}
            freePlanInfo={{
              isFree: isFreePlan,
              savedUsed: freeQuota.savedVideosCount,
              limit: FREE_VIDEO_LIMIT,
              saveBlocked: isSaveBlocked,
            }}
            onOpenProUpgrade={() => {
              setProLimitMessage(
                isSaveBlocked
                  ? 'Limite de salvamento do Plano Grátis atingido (2 vídeos). Assine o PRO para baixar.'
                  : null,
              );
              setShowProModal(true);
            }}
          />
        )}
      </main>
      {user && (
        <ProUpgradeModal
          open={showProModal}
          onClose={() => {
            setShowProModal(false);
            setProLimitMessage(null);
          }}
          user={user}
          userProfile={userProfile}
          multicaixaSettings={multicaixaSettings}
          userOrders={userProOrders}
          limitMessage={proLimitMessage}
        />
      )}
      {isAdmin && (
        <AdminDiagnosticPanel
          open={showAdminDiag}
          onClose={() => setShowAdminDiag(false)}
          adminEmail={user?.email}
        />
      )}
      <OfflineBanner />
      <PWAUpdateBanner />
    </div>
  );
}
