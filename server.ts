import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { verifyExclusiveAdminRequest } from './api/_lib/adminAuth.js';

const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB
const UPLOAD_DIR = path.join(os.tmpdir(), 'dewers-ia-uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const LANGUAGE_LABELS: Record<string, string> = {
  'pt-BR': 'Português do Brasil',
  'en-US': 'Inglês',
  'es-ES': 'Espanhol',
  'fr-FR': 'Francês',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.mp4';
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExt = ['.mp4', '.mov', '.webm', '.m4v', '.mp3', '.wav'];
    const allowedMime = [
      'video/mp4',
      'video/quicktime',
      'video/webm',
      'video/x-m4v',
      'audio/mpeg',
      'audio/wav',
      'audio/mp4',
      'application/octet-stream',
    ];
    if (allowedMime.includes(file.mimetype) || allowedExt.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('UNSUPPORTED_FORMAT'));
    }
  },
});

function resolveMimeType(fileName: string, rawMimeType?: string): string {
  const ext = path.extname(fileName || '').toLowerCase();
  if (ext === '.mov' || rawMimeType === 'video/quicktime') return 'video/quicktime';
  if (ext === '.webm' || rawMimeType === 'video/webm') return 'video/webm';
  if (ext === '.mp3' || rawMimeType === 'audio/mpeg' || rawMimeType === 'audio/mp3') return 'audio/mp3';
  if (ext === '.wav' || rawMimeType === 'audio/wav') return 'audio/wav';
  if (ext === '.m4a' || rawMimeType === 'audio/mp4') return 'audio/mp4';
  return 'video/mp4';
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes('429') ||
        msg.includes('503') ||
        msg.includes('500') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('UNAVAILABLE');
      if (!isTransient || attempt === maxAttempts) {
        throw err;
      }
      await sleep(1000 * Math.pow(2, attempt - 1));
    }
  }
  throw lastError;
}

interface RawWord {
  text?: string;
  start?: number;
  end?: number;
  confidence?: number;
}

interface RawSegment {
  text?: string;
  start?: number;
  end?: number;
  words?: RawWord[];
}

interface GeminiTranscriptionPayload {
  hasSpeech?: boolean;
  detectedLanguage?: string;
  segments?: RawSegment[];
}

function sanitizeTranscription(payload: GeminiTranscriptionPayload) {
  const rawSegments = Array.isArray(payload.segments) ? payload.segments : [];
  const cleanSegments: Array<{
    id: string;
    text: string;
    start: number;
    end: number;
    words: Array<{
      id: string;
      text: string;
      start: number;
      end: number;
      confidence: number;
      needsReview: boolean;
    }>;
  }> = [];

  let globalCursor = 0;

  for (let sIdx = 0; sIdx < rawSegments.length; sIdx++) {
    const seg = rawSegments[sIdx];
    const rawWords = Array.isArray(seg.words) ? seg.words : [];

    const words: Array<{
      id: string;
      text: string;
      start: number;
      end: number;
      confidence: number;
      needsReview: boolean;
    }> = [];
    for (let wIdx = 0; wIdx < rawWords.length; wIdx++) {
      const w = rawWords[wIdx];
      const text = String(w.text ?? '').trim();
      if (!text) continue;
      let start = Number.isFinite(w.start) ? Math.max(0, Number(w.start)) : globalCursor;
      let end = Number.isFinite(w.end) ? Math.max(start + 0.05, Number(w.end)) : start + 0.25;
      if (start < globalCursor) {
        start = globalCursor;
        if (end <= start) end = start + 0.12;
      }
      globalCursor = end;
      const rawConf = Number.isFinite(w.confidence) ? Number(w.confidence) : 0.95;
      const confidence = Math.min(1, Math.max(0, Number(rawConf.toFixed(2))));
      words.push({
        id: `w_${sIdx}_${wIdx}_${Math.random().toString(36).slice(2, 6)}`,
        text,
        start: Number(start.toFixed(3)),
        end: Number(end.toFixed(3)),
        confidence,
        needsReview: confidence < 0.78,
      });
    }

    if (words.length === 0 && seg.text) {
      const tokens = String(seg.text).trim().split(/\s+/).filter(Boolean);
      if (tokens.length > 0) {
        const segStart = Number.isFinite(seg.start) ? Math.max(globalCursor, Number(seg.start)) : globalCursor;
        const segEnd = Number.isFinite(seg.end)
          ? Math.max(segStart + tokens.length * 0.2, Number(seg.end))
          : segStart + tokens.length * 0.35;
        const step = (segEnd - segStart) / tokens.length;
        tokens.forEach((tok, idx) => {
          const wStart = segStart + idx * step;
          const wEnd = segStart + (idx + 1) * step;
          words.push({
            id: `w_${sIdx}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
            text: tok,
            start: Number(wStart.toFixed(3)),
            end: Number(wEnd.toFixed(3)),
            confidence: 0.7,
            needsReview: true,
          });
        });
        globalCursor = segEnd;
      }
    }

    if (words.length > 0) {
      cleanSegments.push({
        id: `seg_${sIdx}_${Math.random().toString(36).slice(2, 7)}`,
        text: words.map((w) => w.text).join(' '),
        start: words[0].start,
        end: words[words.length - 1].end,
        words,
      });
    }
  }

  return cleanSegments;
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const defaultJsonParser = express.json({ limit: '4mb' });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api/transcribe-json') {
      next();
      return;
    }
    defaultJsonParser(req, res, next);
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'dewers-ia',
      platform: 'node',
      maxUploadBytes: MAX_FILE_SIZE_BYTES,
      chunkSupported: true,
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  const handleAdminVerify = async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const result = await verifyExclusiveAdminRequest(req);
    if (!result.ok) {
      res.status(result.status).json({
        authorized: false,
        error: result.error,
        code: result.code,
      });
      return;
    }
    res.json({
      authorized: true,
      uid: result.uid,
      email: result.email,
      provider: result.provider,
      hasCustomClaim: result.hasCustomClaim,
      authMode: result.hasCustomClaim
        ? 'custom-claim-and-verified-token'
        : 'verified-id-token-and-rules',
    });
  };

  app.get('/api/admin/verify', handleAdminVerify);
  app.post('/api/admin/verify', handleAdminVerify);

  const INLINE_MAX_BYTES = 18 * 1024 * 1024; // 18 MB inline fast path

  async function processTranscriptionAndRespond(params: {
    filePath: string;
    originalName: string;
    rawMimeType?: string;
    languageInput: unknown;
    customDictionaryInput: unknown;
    res: Response;
  }) {
    const {
      filePath,
      originalName,
      rawMimeType,
      languageInput,
      customDictionaryInput,
      res,
    } = params;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await fs.promises.unlink(filePath).catch(() => {});
      res.status(500).json({
        error:
          'Chave da API Gemini não encontrada no servidor. Configure a variável GEMINI_API_KEY nas configurações do projeto.',
        code: 'API_KEY_ERROR',
      });
      return;
    }

    const language =
      typeof languageInput === 'string' && LANGUAGE_LABELS[languageInput]
        ? languageInput
        : 'pt-BR';
    const languageLabel = LANGUAGE_LABELS[language];
    const customDictionary =
      typeof customDictionaryInput === 'string'
        ? customDictionaryInput.trim().slice(0, 2000)
        : '';

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    let uploadedRemoteName: string | undefined;

    try {
      const mimeType = resolveMimeType(originalName, rawMimeType);
      const fileStat = await fs.promises.stat(filePath);

      let mediaPart:
        | { inlineData: { mimeType: string; data: string } }
        | { fileData: { fileUri?: string; mimeType: string } };

      if (fileStat.size <= INLINE_MAX_BYTES) {
        // Fast inline path: avoids ai.files.upload + PROCESSING polling latency
        const rawBytes = await fs.promises.readFile(filePath);
        mediaPart = {
          inlineData: {
            mimeType,
            data: rawBytes.toString('base64'),
          },
        };
      } else {
        const uploadResult = await ai.files.upload({
          file: filePath,
          config: {
            mimeType,
            displayName: originalName || 'dewers-video',
          },
        });

        uploadedRemoteName = uploadResult.name;
        if (!uploadedRemoteName) {
          throw new Error('Falha ao registrar arquivo na API Gemini.');
        }

        // Wait for file processing to become ACTIVE (max ~45s)
        let fileState = uploadResult.state;
        let attempts = 0;
        while (fileState === 'PROCESSING' && attempts < 30) {
          await sleep(1500);
          const status = await ai.files.get({ name: uploadedRemoteName });
          fileState = status.state;
          attempts++;
        }

        if (fileState !== 'ACTIVE') {
          throw new Error(
            'O processamento do vídeo pela API Gemini falhou ou excedeu o tempo limite.',
          );
        }

        mediaPart = {
          fileData: {
            fileUri: uploadResult.uri,
            mimeType: uploadResult.mimeType || mimeType,
          },
        };
      }

      const promptLines = [
        `Transcreva toda a fala deste arquivo com precisão de nível de palavra utilizando obrigatoriamente o idioma com código ${language} (${languageLabel}).`,
        'Regras obrigatórias:',
        `1. Código do idioma alvo para transcrição: ${language}. Se a fala estiver em outro idioma, transcreva/adapte fielmente para ${languageLabel} (${language}), mantendo o sincronismo exato.`,
        '2. Se o áudio NÃO tiver voz humana falando palavras identificáveis (mudo, silêncio, apenas música instrumental, ruído ou tons contínuos), defina obrigatoriamente hasSpeech como false e retorne segments como []. Nunca invente falas inexistentes.',
        '3. Caso haja fala, defina hasSpeech como true e agrupe as falas em segmentos curtos e dinâmicos (2 a 4 palavras por bloco, ideal para legendas de vídeos curtos estilo Reels/TikTok).',
        '4. Para CADA palavra dentro de words, forneça text, start (em segundos decimais, ex: 1.42), end (em segundos decimais, ex: 1.78) e confidence (número de 0.0 a 1.0).',
        '5. Seja honesto na pontuação de confidence: atribua valor menor que 0.78 (ex: 0.55 a 0.75) sempre que houver dúvida ortográfica, nome próprio incomum, fala muito rápida, música alta ao fundo ou áudio pouco claro, para sinalizar ao usuário que aquela palavra merece revisão.',
        '6. Mantenha pontuação natural e ortografia correta no idioma solicitado.',
      ];

      if (customDictionary) {
        promptLines.push(
          `7. Dicionário personalizado ("Palavras importantes" do usuário): utilize EXATAMENTE estas grafias, nomes próprios, termos técnicos ou expressões sempre que identificar pronúncia compatível no áudio: ${customDictionary}`,
        );
      }

      const prompt = promptLines.join('\n');
      const startMs = Date.now();
      console.log(`[DEWES Transcribe] Enviando ${mimeType} (${fileStat.size} bytes) para Gemini...`);

      const systemInstruction = `Você é um engenheiro especialista em legendagem automática de vídeos curtos. Transcreva exclusivamente usando o código de idioma ${language} (${languageLabel}) e retorne JSON válido seguindo o schema, com tempos exatos em segundos e confiança calibrada para cada palavra falada.`;
      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          hasSpeech: {
            type: Type.BOOLEAN,
            description:
              'true se houver fala humana audível no vídeo, false se estiver mudo ou sem fala.',
          },
          detectedLanguage: {
            type: Type.STRING,
            description: 'Código ou nome do idioma detectado na fala.',
          },
          segments: {
            type: Type.ARRAY,
            description:
              'Lista ordenada cronologicamente de blocos curtos de legenda.',
            items: {
              type: Type.OBJECT,
              properties: {
                text: {
                  type: Type.STRING,
                  description:
                    'Texto completo do bloco de legenda (2 a 6 palavras).',
                },
                start: {
                  type: Type.NUMBER,
                  description: 'Tempo de início do bloco em segundos.',
                },
                end: {
                  type: Type.NUMBER,
                  description: 'Tempo de término do bloco em segundos.',
                },
                words: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      text: {
                        type: Type.STRING,
                        description:
                          'Palavra individual (incluindo pontuação anexa, se houver).',
                      },
                      start: {
                        type: Type.NUMBER,
                        description: 'Início exato da palavra em segundos.',
                      },
                      end: {
                        type: Type.NUMBER,
                        description:
                          'Término exato da palavra em segundos.',
                      },
                      confidence: {
                        type: Type.NUMBER,
                        description:
                          'Confiança de 0.0 a 1.0 na transcrição exata desta palavra (< 0.78 quando incerta).',
                      },
                    },
                    required: ['text', 'start', 'end', 'confidence'],
                  },
                },
              },
              required: ['text', 'start', 'end', 'words'],
            },
          },
        },
        required: ['hasSpeech', 'detectedLanguage', 'segments'],
      };

      const candidateModels = mimeType.startsWith('audio/')
        ? ['gemini-3.5-transcribe', 'gemini-3.1-flash-lite', 'gemini-4-hydrogen']
        : ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'];

      let response: Awaited<ReturnType<typeof ai.models.generateContent>> | undefined;
      let lastModelError: unknown;
      let usedModelName = candidateModels[candidateModels.length - 1];

      for (const modelName of candidateModels) {
        try {
          const isFlashLite = modelName === 'gemini-3.1-flash-lite';
          const isHydrogen = modelName === 'gemini-4-hydrogen';
          response = await withRetry(
            () =>
              ai.models.generateContent({
                model: modelName,
                contents: {
                  parts: [mediaPart, { text: prompt }],
                },
                config: {
                  abortSignal: AbortSignal.timeout(30000),
                  ...(isFlashLite
                    ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }
                    : isHydrogen
                      ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                      : {}),
                  systemInstruction,
                  responseMimeType: 'application/json',
                  responseSchema,
                },
              }),
            2,
          );
          usedModelName = modelName;
          console.log(
            `[DEWES Transcribe] Modelo ${modelName} respondeu em ${Date.now() - startMs}ms.`,
          );
          break;
        } catch (err) {
          lastModelError = err;
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn(
            `[DEWES Transcribe] Modelo ${modelName} falhou (${errMsg}); tentando próximo se disponível.`,
          );
          if (
            errMsg.includes('PERMISSION_DENIED') ||
            errMsg.includes('API_KEY_INVALID') ||
            errMsg.includes('403')
          ) {
            throw err;
          }
        }
      }

      if (!response) {
        throw lastModelError ?? new Error('Nenhum modelo Gemini respondeu.');
      }

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        throw new Error('A API Gemini retornou uma resposta vazia.');
      }

      let parsed: GeminiTranscriptionPayload;
      try {
        parsed = JSON.parse(rawText) as GeminiTranscriptionPayload;
      } catch {
        throw new Error(
          'Não foi possível interpretar os tempos de legenda retornados pela IA.',
        );
      }

      if (parsed.hasSpeech === false) {
        res.status(422).json({
          error:
            'Nenhuma fala audível foi detectada neste vídeo. Verifique se o áudio não está mudo.',
          code: 'NO_AUDIO',
        });
        return;
      }

      const segments = sanitizeTranscription(parsed);
      if (segments.length === 0) {
        res.status(422).json({
          error:
            'Não foi possível extrair falas deste vídeo. Confirme se há voz audível na gravação.',
          code: 'NO_AUDIO',
        });
        return;
      }

      const promptTokens = Number(response.usageMetadata?.promptTokenCount || 0);
      const candidatesTokens = Number(
        response.usageMetadata?.candidatesTokenCount || 0,
      );
      const totalTokens = Number(
        response.usageMetadata?.totalTokenCount || promptTokens + candidatesTokens,
      );
      const estimatedCostUsd = Number(
        ((promptTokens * 0.15 + candidatesTokens * 0.6) / 1_000_000).toFixed(6),
      );

      res.json({
        hasSpeech: true,
        detectedLanguage: parsed.detectedLanguage || language,
        segments,
        usage: {
          modelUsed: usedModelName,
          promptTokens,
          candidatesTokens,
          totalTokens,
          estimatedCostUsd,
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const errName = error instanceof Error ? error.name : '';
      console.error('Erro na transcrição Gemini:', errName, msg);

      if (
        errName === 'AbortError' ||
        errName === 'TimeoutError' ||
        msg.includes('aborted') ||
        msg.includes('timeout')
      ) {
        res.status(504).json({
          error:
            'A transcrição demorou mais que o esperado na IA. Tente novamente em instantes ou envie um vídeo mais curto.',
          code: 'GEMINI_TIMEOUT',
        });
        return;
      }

      if (
        msg.includes('PERMISSION_DENIED') ||
        msg.includes('API_KEY_INVALID') ||
        msg.includes('403')
      ) {
        res.status(403).json({
          error:
            'Chave da API Gemini inválida ou sem permissão. Verifique a chave em Configurações > Secrets.',
          code: 'API_KEY_ERROR',
        });
        return;
      }

      if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
        res.status(429).json({
          error:
            'Cota da API Gemini temporariamente excedida. Aguarde alguns segundos e tente novamente.',
          code: 'QUOTA_EXCEEDED',
        });
        return;
      }

      res.status(502).json({
        error: `Falha ao processar o vídeo com a IA: ${msg}`,
        code: 'API_ERROR',
      });
    } finally {
      await fs.promises.unlink(filePath).catch(() => {});
      if (uploadedRemoteName) {
        await ai.files.delete({ name: uploadedRemoteName }).catch(() => {});
      }
    }
  }

  const chunkUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 },
  });

  app.post(
    '/api/transcribe/chunk',
    (req: Request, res: Response, next: NextFunction) => {
      chunkUpload.single('chunk')(req, res, (err: unknown) => {
        if (err) {
          res.status(400).json({
            error: `Erro ao enviar parte do vídeo: ${err instanceof Error ? err.message : String(err)}`,
            code: 'CHUNK_UPLOAD_ERROR',
          });
          return;
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      try {
        const uploadId = String(req.body?.uploadId || '').replace(
          /[^a-zA-Z0-9_-]/g,
          '',
        );
        const chunkIndex = Number(req.body?.chunkIndex);
        const file = req.file;
        if (!uploadId || !Number.isInteger(chunkIndex) || chunkIndex < 0 || !file) {
          res.status(400).json({
            error: 'Parte do upload inválida.',
            code: 'INVALID_CHUNK',
          });
          return;
        }
        const chunkDir = path.join(UPLOAD_DIR, `chunks_${uploadId}`);
        await fs.promises.mkdir(chunkDir, { recursive: true });
        await fs.promises.writeFile(
          path.join(chunkDir, `${String(chunkIndex).padStart(5, '0')}.part`),
          file.buffer,
        );
        res.json({ ok: true, chunkIndex });
      } catch (err) {
        res.status(500).json({
          error: `Falha ao gravar parte do vídeo: ${err instanceof Error ? err.message : String(err)}`,
          code: 'CHUNK_WRITE_ERROR',
        });
      }
    },
  );

  app.post('/api/transcribe/complete', async (req: Request, res: Response) => {
    const uploadId = String(req.body?.uploadId || '').replace(
      /[^a-zA-Z0-9_-]/g,
      '',
    );
    const totalChunks = Number(req.body?.totalChunks);
    const fileName = String(req.body?.fileName || 'video.mp4');
    const mimeType = String(req.body?.mimeType || 'video/mp4');

    if (
      !uploadId ||
      !Number.isInteger(totalChunks) ||
      totalChunks < 1 ||
      totalChunks > 64
    ) {
      res.status(400).json({
        error: 'Parâmetros de montagem do vídeo inválidos.',
        code: 'INVALID_COMPLETE',
      });
      return;
    }

    const chunkDir = path.join(UPLOAD_DIR, `chunks_${uploadId}`);
    const ext = path.extname(fileName).toLowerCase() || '.mp4';
    const assembledPath = path.join(UPLOAD_DIR, `assembled_${uploadId}${ext}`);

    try {
      const writeStream = fs.createWriteStream(assembledPath);
      let totalSize = 0;

      for (let i = 0; i < totalChunks; i++) {
        const partPath = path.join(
          chunkDir,
          `${String(i).padStart(5, '0')}.part`,
        );
        const partBuf = await fs.promises.readFile(partPath);
        totalSize += partBuf.length;
        if (totalSize > MAX_FILE_SIZE_BYTES) {
          writeStream.destroy();
          await fs.promises.unlink(assembledPath).catch(() => {});
          res.status(413).json({
            error:
              'O arquivo excede o limite máximo de 200 MB. Compacte o vídeo ou envie um trecho menor.',
            code: 'FILE_TOO_LARGE',
          });
          return;
        }
        await new Promise<void>((resolve, reject) => {
          writeStream.write(partBuf, (e) => (e ? reject(e) : resolve()));
        });
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.end((e?: Error | null) => (e ? reject(e) : resolve()));
      });
      await fs.promises.rm(chunkDir, { recursive: true, force: true }).catch(() => {});

      await processTranscriptionAndRespond({
        filePath: assembledPath,
        originalName: fileName,
        rawMimeType: mimeType,
        languageInput: req.body?.language,
        customDictionaryInput: req.body?.customDictionary,
        res,
      });
    } catch (err) {
      await fs.promises.rm(chunkDir, { recursive: true, force: true }).catch(() => {});
      await fs.promises.unlink(assembledPath).catch(() => {});
      if (!res.headersSent) {
        res.status(500).json({
          error: `Falha ao montar vídeo para transcrição: ${err instanceof Error ? err.message : String(err)}`,
          code: 'ASSEMBLE_ERROR',
        });
      }
    }
  });

  app.post(
    '/api/transcribe',
    (req: Request, res: Response, next: NextFunction) => {
      upload.single('video')(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            res.status(413).json({
              error:
                'O arquivo excede o limite máximo de 200 MB. Compacte o vídeo ou envie um trecho menor.',
              code: 'FILE_TOO_LARGE',
            });
            return;
          }
          res.status(400).json({
            error: `Erro ao receber o arquivo de vídeo: ${err.message}`,
            code: 'UPLOAD_ERROR',
          });
          return;
        }
        if (err instanceof Error && err.message === 'UNSUPPORTED_FORMAT') {
          res.status(400).json({
            error: 'Formato não suportado. Envie um vídeo MP4, MOV ou WebM.',
            code: 'UNSUPPORTED_FORMAT',
          });
          return;
        }
        if (err) {
          res.status(500).json({
            error: `Erro interno no upload: ${err instanceof Error ? err.message : String(err)}`,
            code: 'UPLOAD_SERVER_ERROR',
          });
          return;
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      const file = req.file;
      if (!file) {
        res.status(400).json({
          error: 'Nenhum arquivo de vídeo foi enviado para transcrição.',
          code: 'MISSING_FILE',
        });
        return;
      }

      await processTranscriptionAndRespond({
        filePath: file.path,
        originalName: file.originalname || 'video.mp4',
        rawMimeType: file.mimetype,
        languageInput: req.body?.language,
        customDictionaryInput: req.body?.customDictionary,
        res,
      });
    },
  );

  app.post(
    '/api/transcribe-json',
    express.json({ limit: '26mb' }),
    async (req: Request, res: Response) => {
      const audioBase64 =
        typeof req.body?.audioBase64 === 'string' ? req.body.audioBase64 : '';
      const rawFileName =
        typeof req.body?.fileName === 'string'
          ? path.basename(req.body.fileName)
          : 'audio.wav';
      const rawMimeType =
        typeof req.body?.mimeType === 'string' ? req.body.mimeType : 'audio/wav';

      if (!audioBase64) {
        res.status(400).json({
          error: 'Nenhum áudio foi enviado para transcrição.',
          code: 'MISSING_FILE',
        });
        return;
      }

      const buffer = Buffer.from(audioBase64, 'base64');
      if (buffer.length === 0 || buffer.length > INLINE_MAX_BYTES) {
        res.status(413).json({
          error: 'O áudio excedeu o limite permitido para envio direto.',
          code: 'FILE_TOO_LARGE',
        });
        return;
      }

      const ext = path.extname(rawFileName).toLowerCase() || '.wav';
      const safeTempPath = path.join(
        UPLOAD_DIR,
        `json_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`,
      );

      try {
        await fs.promises.writeFile(safeTempPath, buffer);
        await processTranscriptionAndRespond({
          filePath: safeTempPath,
          originalName: rawFileName,
          rawMimeType,
          languageInput: req.body?.language,
          customDictionaryInput: req.body?.customDictionary,
          res,
        });
      } catch (err) {
        await fs.promises.unlink(safeTempPath).catch(() => {});
        if (!res.headersSent) {
          res.status(500).json({
            error: `Erro ao preparar áudio para transcrição: ${err instanceof Error ? err.message : String(err)}`,
            code: 'JSON_UPLOAD_ERROR',
          });
        }
      }
    },
  );

  // Guarantee /api/* always returns JSON instead of HTML fallback
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({
      error: 'Rota de API não encontrada.',
      code: 'API_NOT_FOUND',
    });
  });

  app.use(
    (err: unknown, req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api')) {
        if (!res.headersSent) {
          const errObj = err as { status?: number; statusCode?: number; type?: string; message?: string };
          if (
            errObj?.status === 413 ||
            errObj?.statusCode === 413 ||
            errObj?.type === 'entity.too.large'
          ) {
            res.status(413).json({
              error:
                'O arquivo ultrapassou o limite aceito pelo servidor nesta requisição. Tente novamente ou envie um vídeo menor.',
              code: 'FILE_TOO_LARGE',
            });
            return;
          }
          res.status(500).json({
            error: `Erro interno no servidor: ${err instanceof Error ? err.message : String(err)}`,
            code: 'INTERNAL_SERVER_ERROR',
          });
        }
        return;
      }
      next(err);
    },
  );

  if (process.env.NODE_ENV !== 'production') {
    if (process.env.DISABLE_HMR === 'true') {
      app.get('/manifest.webmanifest', (_req: Request, res: Response) => {
        res.type('application/manifest+json').json({
          id: '/',
          name: 'DEWES IA',
          short_name: 'DEWES IA',
          description: 'Legendas automáticas com IA',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'any',
          lang: 'pt-BR',
          background_color: '#0B0B12',
          theme_color: '#8A2BE2',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        });
      });
    }
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.requestTimeout = 5 * 60 * 1000;
  httpServer.headersTimeout = 65 * 1000;

  const port = Number(process.env.PORT) || 3000;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Dewers IA rodando na porta ${port}`);
  });
}

startServer().catch((err) => {
  console.error('Falha fatal ao iniciar o servidor:', err);
  process.exit(1);
});
