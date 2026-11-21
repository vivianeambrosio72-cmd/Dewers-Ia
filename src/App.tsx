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
  deleteSubtitleProject,
  saveSubtitleProject,
  subscribeUserProjects,
  upsertUserProfile,
} from './services/projectService';
import {
  PRESET_DEFINITIONS,
  type SavedProject,
  type StyleConfig,
  type SubtitleSegment,
  type SupportedLanguage,
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
import { ProjectsPanel } from './components/ProjectsPanel';
import { LoginScreen } from './components/LoginScreen';
import { AdminDiagnosticPanel } from './components/AdminDiagnosticPanel';
import {
  OfflineBanner,
  PWAInstallButton,
  PWAUpdateBanner,
} from './components/PWABanners';

type WorkspaceView = 'wizard' | 'projects';

interface BannerAlert {
  type: 'error' | 'info' | 'success';
  message: string;
}

const MAX_UPLOAD_MB = 100;
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
  // Auth & Firestore
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [showAdminDiag, setShowAdminDiag] = useState(false);
  const isAdmin = useMemo(() => isAdminUser(user), [user]);

  // Navigation & Sequential Wizard
  const [view, setView] = useState<WorkspaceView>('wizard');
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
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser) {
        try {
          await upsertUserProfile(nextUser);
        } catch (err) {
          console.error('Erro ao sincronizar perfil:', err);
        }
      } else {
        setProjects([]);
        setShowAdminDiag(false);
        setView('wizard');
        setStep(1);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;
    setProjectsLoading(true);
    const unsub = subscribeUserProjects(
      user.uid,
      (list) => {
        setProjects(list);
        setProjectsLoading(false);
      },
      (err) => {
        setProjectsLoading(false);
        setAlert({
          type: 'error',
          message: `Erro ao carregar projetos salvos: ${err.message}`,
        });
      },
    );
    return () => unsub();
  }, [authReady, user]);

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
      if (!activeProjectId) {
        setProjectTitle(file.name.replace(/\.[^/.]+$/, '') || 'Novo vídeo curto');
      }
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
    [activeProjectId],
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

  const runGeminiTranscription = useCallback(
    async (targetLang: SupportedLanguage) => {
      if (!videoFile) return;

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

      // Verify /api/health first so proxy/auth/static-host issues are caught immediately
      try {
        const healthRes = await fetch('/api/health', {
          method: 'GET',
          cache: 'no-store',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        const healthText = await healthRes.text();
        let healthOk = false;
        try {
          const parsedHealth = JSON.parse(healthText || '{}');
          healthOk = healthRes.ok && parsedHealth?.status === 'ok';
        } catch {
          healthOk = false;
        }
        if (!healthOk) {
          throw new Error(
            parseServerError(healthRes.status, healthText, 'api-health'),
          );
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

      setTranscribeStage('Preparando áudio do vídeo...');
      const prepared = await prepareAudioForTranscription(videoFile);
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

      const uploadTargetFile = prepared.audioFile ?? videoFile;
      const CHUNK_THRESHOLD_BYTES = 16 * 1024 * 1024; // 16 MB
      const JSON_FALLBACK_MAX_BYTES = 12 * 1024 * 1024; // 12 MB raw -> ~16 MB base64
      const CHUNK_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB chunks (safe under Cloud Run 32 MB limit)
      let aiTicker: number | undefined;

      const sendViaJsonFallback = async (): Promise<{
        segments: SubtitleSegment[];
        detectedLanguage: string;
      }> => {
        setTranscribeStage('Reenviando áudio em formato compatível...');
        setTranscribeProgress(55);
        const audioBase64 = await fileToBase64(uploadTargetFile);
        const res = await fetch('/api/transcribe-json', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            audioBase64,
            fileName: uploadTargetFile.name,
            mimeType: uploadTargetFile.type || 'audio/wav',
            language: targetLang,
            customDictionary: customDictionary.trim(),
          }),
        });
        const text = await res.text();
        let data: {
          segments?: SubtitleSegment[];
          detectedLanguage?: string;
          error?: string;
        } = {};
        try {
          data = JSON.parse(text || '{}');
        } catch {
          throw new Error(parseServerError(res.status, text, 'transcribe-json'));
        }
        if (!res.ok || !Array.isArray(data.segments)) {
          throw new Error(
            data.error || parseServerError(res.status, text, 'transcribe-json'),
          );
        }
        return {
          segments: data.segments,
          detectedLanguage: data.detectedLanguage || targetLang,
        };
      };

      try {
        let result: {
          segments: SubtitleSegment[];
          detectedLanguage: string;
        };

        if (uploadTargetFile.size <= CHUNK_THRESHOLD_BYTES) {
          const formData = new FormData();
          formData.append('video', uploadTargetFile);
          formData.append('language', targetLang);
          if (customDictionary.trim()) {
            formData.append('customDictionary', customDictionary.trim());
          }

          try {
            result = await new Promise<{
              segments: SubtitleSegment[];
              detectedLanguage: string;
            }>((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open('POST', '/api/transcribe');
              xhr.withCredentials = true;
              xhr.setRequestHeader('Accept', 'application/json');
              xhr.timeout = 240000;

              xhr.upload.onprogress = (ev) => {
                if (ev.lengthComputable) {
                  const pct = Math.min(45, Math.round((ev.loaded / ev.total) * 45));
                  setTranscribeProgress(Math.max(10, pct));
                  setTranscribeStage(
                    prepared.audioFile
                      ? 'Enviando áudio otimizado...'
                      : 'Enviando vídeo para transcrição...',
                  );
                }
              };

              xhr.upload.onload = () => {
                setTranscribeProgress(50);
                setTranscribeStage('Transcrevendo áudio com Gemini...');
                aiTicker = window.setInterval(() => {
                  setTranscribeProgress((prev) => (prev < 92 ? prev + 2 : prev));
                }, 700);
              };

              xhr.onload = () => {
                if (aiTicker) clearInterval(aiTicker);
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
                if (aiTicker) clearInterval(aiTicker);
                reject(
                  new Error(
                    'O tempo de transcrição excedeu o limite. Tente um vídeo mais curto ou verifique sua conexão.',
                  ),
                );
              };

              xhr.onerror = () => {
                if (aiTicker) clearInterval(aiTicker);
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
            if (
              looksLikeHtmlOrProxyIssue &&
              uploadTargetFile.size <= JSON_FALLBACK_MAX_BYTES
            ) {
              result = await sendViaJsonFallback();
            } else {
              throw multipartErr;
            }
          }
        } else {
          // Chunked upload for large videos where browser audio extraction wasn't used
          const uploadId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const totalChunks = Math.ceil(uploadTargetFile.size / CHUNK_SIZE_BYTES);

          for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE_BYTES;
            const end = Math.min(uploadTargetFile.size, start + CHUNK_SIZE_BYTES);
            const chunkBlob = uploadTargetFile.slice(start, end);

            const chunkForm = new FormData();
            chunkForm.append('uploadId', uploadId);
            chunkForm.append('chunkIndex', String(i));
            chunkForm.append('chunk', chunkBlob, `part_${i}`);

            setTranscribeStage(`Enviando vídeo (${i + 1}/${totalChunks})...`);
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
              Math.max(10, Math.round(((i + 1) / totalChunks) * 45)),
            );
          }

          setTranscribeProgress(50);
          setTranscribeStage('Transcrevendo áudio com Gemini...');
          aiTicker = window.setInterval(() => {
            setTranscribeProgress((prev) => (prev < 92 ? prev + 2 : prev));
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
              fileName: uploadTargetFile.name,
              mimeType: uploadTargetFile.type || 'video/mp4',
              language: targetLang,
              customDictionary: customDictionary.trim(),
            }),
          });
          if (aiTicker) clearInterval(aiTicker);

          const completeText = await completeRes.text();
          let data: {
            segments?: SubtitleSegment[];
            detectedLanguage?: string;
            error?: string;
          } = {};
          try {
            data = JSON.parse(completeText || '{}');
          } catch {
            throw new Error(
              parseServerError(completeRes.status, completeText, 'complete'),
            );
          }

          if (!completeRes.ok || !Array.isArray(data.segments)) {
            throw new Error(
              data.error ||
                parseServerError(completeRes.status, completeText, 'complete-json'),
            );
          }

          result = {
            segments: data.segments,
            detectedLanguage: data.detectedLanguage || targetLang,
          };
        }

        setTranscribeProgress(100);
        setTranscribeStage('Legendas prontas!');
        setUndoStack([]);
        setRedoStack([]);
        setSegments(result.segments);
        setSubtitlesReviewed(false);
        setTranscribedKey(`${videoFile.name}_${videoFile.size}_${targetLang}`);
        const reviewCount = result.segments.reduce(
          (acc, s) => acc + s.words.filter((w) => w.needsReview).length,
          0,
        );
        setAlert({
          type: 'success',
          message:
            reviewCount > 0
              ? `Transcrição concluída (${result.segments.length} blocos). Há ${reviewCount} palavra(s) marcada(s) em amarelo para revisão antes de avançar.`
              : `Transcrição concluída (${result.segments.length} blocos). Revise o texto e clique em "Legendas revisadas" para continuar.`,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setAlert({ type: 'error', message: msg });
      } finally {
        if (aiTicker) clearInterval(aiTicker);
        setTimeout(() => {
          setIsTranscribing(false);
          setTranscribeProgress(0);
        }, 300);
      }
    },
    [videoFile, customDictionary],
  );

  // Step 1 -> Step 2 (Auto-transcribe upon entering Step 2 if needed)
  const handleGoToStep2 = () => {
    if (!videoUrl) return;
    setAlert(null);
    setStep(2);
    setMaxReachedStep((prev) => Math.max(prev, 2));
    if (videoFile) {
      const currentKey = `${videoFile.name}_${videoFile.size}_${language}`;
      if (segments.length === 0 || transcribedKey !== currentKey) {
        runGeminiTranscription(language);
      }
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
    if (view !== 'wizard' || step !== 2) return;
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
  }, [view, step, handleUndo, handleRedo]);

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
  };

  const handleExportVideo = async () => {
    if (!videoUrl || segments.length === 0) return;
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

  const handleSaveProject = async () => {
    if (!user) {
      await handleSignIn();
      return;
    }
    if (segments.length === 0) return;

    setAlert(null);
    setIsSavingProject(true);
    try {
      const savedId = await saveSubtitleProject({
        projectId: activeProjectId || undefined,
        ownerId: user.uid,
        title: projectTitle || 'Projeto Dewers IA',
        videoFileName: videoFileName || 'video.mp4',
        duration,
        language,
        styleConfig,
        transitionConfig: {
          enabled: false,
          mode: 'transition',
          type: 'fade',
          intensity: 'low',
          pauseThreshold: 0.7,
          duration: 0.45,
        },
        transitionPoints: [],
        segments,
      });
      setActiveProjectId(savedId);
      setAlert({
        type: 'success',
        message: 'Projeto salvo na sua conta com sucesso.',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setAlert({
        type: 'error',
        message: `Erro ao salvar projeto: ${msg}`,
      });
    } finally {
      setIsSavingProject(false);
    }
  };

  const handleOpenProject = (proj: SavedProject) => {
    setActiveProjectId(proj.id);
    setProjectTitle(proj.title);
    setVideoFileName(proj.videoFileName);
    setDuration(proj.duration);
    const validLangs: SupportedLanguage[] = ['pt-BR', 'en-US', 'es-ES', 'fr-FR'];
    setLanguage(validLangs.includes(proj.language) ? proj.language : 'pt-BR');

    const validPresets = Object.keys(PRESET_DEFINITIONS);
    const loadedStyle = proj.styleConfig as StyleConfig;
    if (validPresets.includes(loadedStyle.preset)) {
      setStyleConfig({
        ...loadedStyle,
        fontScale: loadedStyle.fontScale ?? 100,
        verticalPosition: loadedStyle.verticalPosition ?? 75,
      });
    } else {
      setStyleConfig({ ...PRESET_DEFINITIONS.viral_impacto.style });
    }

    setSegments(proj.segments);
    setUndoStack([]);
    setRedoStack([]);
    setSubtitlesReviewed(Boolean(proj.segments.length > 0));

    setView('wizard');
    setStep(videoUrl ? 2 : 1);
    setMaxReachedStep(videoUrl ? 2 : 1);
    setAlert({
      type: 'info',
      message: videoUrl
        ? `Projeto "${proj.title}" carregado.`
        : `Projeto "${proj.title}" carregado. Envie o arquivo de vídeo local correspondente para revisar na Etapa 2 e exportar.`,
    });
  };

  const handleDeleteProject = async (projectId: string) => {
    try {
      await deleteSubtitleProject(projectId);
      if (activeProjectId === projectId) {
        setActiveProjectId(null);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setAlert({
        type: 'error',
        message: `Erro ao excluir projeto: ${msg}`,
      });
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
            setView('wizard');
            setStep(1);
          }}
        />
        <OfflineBanner />
        <PWAUpdateBanner />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#090B10] text-slate-100 flex flex-col">
      {/* Top Bar Contract: 3 zones */}
      <header className="border-b border-white/10 bg-[#090B10]/95 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => setView('wizard')}
            className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            <Clapperboard className="w-5 h-5 text-amber-400" />
            <span>Dewers IA</span>
          </button>

          {/* Zone 2: Clean Nav Links */}
          <nav className="flex items-center gap-6 text-sm font-medium text-slate-400">
            <button
              type="button"
              onClick={() => setView('wizard')}
              className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
                view === 'wizard' ? 'text-white' : ''
              }`}
            >
              Assistente
            </button>
            <button
              type="button"
              onClick={() => setView('projects')}
              className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
                view === 'projects' ? 'text-white' : ''
              }`}
            >
              Meus Projetos
            </button>
          </nav>

          {/* Zone 3: Install PWA, Admin Diagnostic (Google Admin only) & Auth Action */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <PWAInstallButton />
            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowAdminDiag(true)}
                title="Painel de Diagnóstico Firebase (Modo Desenvolvedor)"
                className="pwa-touch-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-purple-500/15 border border-purple-400/30 text-xs font-medium text-purple-200 hover:bg-purple-500/25 transition-colors whitespace-nowrap shrink-0 min-h-[44px] sm:min-h-[36px]"
              >
                <Terminal className="w-3.5 h-3.5 text-purple-300" />
                <span className="hidden md:inline">Diagnóstico</span>
              </button>
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

      {/* Top Step Progress Bar (shown in Wizard mode) */}
      {view === 'wizard' && (
        <WizardProgressBar
          currentStep={step}
          maxReachedStep={maxReachedStep}
          hasVideo={Boolean(videoUrl)}
          hasSubtitles={segments.length > 0}
          onSelectStep={handleSelectWizardStep}
        />
      )}

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

        {view === 'projects' ? (
          <ProjectsPanel
            isAuthenticated={Boolean(user)}
            isLoading={projectsLoading}
            projects={projects}
            activeProjectId={activeProjectId}
            onSignIn={handleSignIn}
            onOpenProject={handleOpenProject}
            onDeleteProject={handleDeleteProject}
            onBackToEditor={() => setView('wizard')}
          />
        ) : step === 1 ? (
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
            isSavingProject={isSavingProject}
            isAuthenticated={Boolean(user)}
            onDownloadVideo={handleExportVideo}
            onCancelExport={() => exportAbortRef.current?.abort()}
            onDownloadSrt={handleDownloadSrt}
            onSaveProject={handleSaveProject}
            onBackToStep2={() => setStep(2)}
          />
        )}
      </main>
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
