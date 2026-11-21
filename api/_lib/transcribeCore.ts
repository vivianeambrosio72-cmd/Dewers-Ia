import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export interface VercelRequest extends IncomingMessage {
  body?: Record<string, unknown>;
  query?: Record<string, string | string[]>;
  file?: {
    originalname?: string;
    mimetype?: string;
    buffer: Buffer;
    size: number;
  };
}

export interface VercelResponse extends ServerResponse {
  status?: (code: number) => VercelResponse;
  json?: (data: unknown) => void;
}

export const LANGUAGE_LABELS: Record<string, string> = {
  'pt-BR': 'Português do Brasil',
  'en-US': 'Inglês',
  'es-ES': 'Espanhol',
  'fr-FR': 'Francês',
};

export const VERCEL_MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB safe under Vercel 4.5 MB body limit

export function sendJson(
  res: VercelResponse,
  statusCode: number,
  payload: unknown,
): void {
  const statusFn = res.status;
  const jsonFn = res.json;
  if (typeof statusFn === 'function' && typeof jsonFn === 'function') {
    const boundRes = statusFn.call(res, statusCode);
    if (typeof boundRes?.json === 'function') {
      boundRes.json(payload);
      return;
    }
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function resolveMimeType(fileName: string, rawMimeType?: string): string {
  const ext = path.extname(fileName || '').toLowerCase();
  if (ext === '.mov' || rawMimeType === 'video/quicktime') return 'video/quicktime';
  if (ext === '.webm' || rawMimeType === 'video/webm') return 'video/webm';
  if (ext === '.mp3' || rawMimeType === 'audio/mpeg' || rawMimeType === 'audio/mp3') {
    return 'audio/mp3';
  }
  if (ext === '.wav' || rawMimeType === 'audio/wav') return 'audio/wav';
  if (ext === '.m4a' || rawMimeType === 'audio/mp4') return 'audio/mp4';
  return 'video/mp4';
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
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
      await sleep(800 * Math.pow(2, attempt - 1));
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
      let end = Number.isFinite(w.end)
        ? Math.max(start + 0.05, Number(w.end))
        : start + 0.25;
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
        const segStart = Number.isFinite(seg.start)
          ? Math.max(globalCursor, Number(seg.start))
          : globalCursor;
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

export async function transcribeBufferAndRespond(params: {
  buffer: Buffer;
  originalName: string;
  rawMimeType?: string;
  languageInput: unknown;
  customDictionaryInput: unknown;
  res: VercelResponse;
}): Promise<void> {
  const {
    buffer,
    originalName,
    rawMimeType,
    languageInput,
    customDictionaryInput,
    res,
  } = params;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, {
      error:
        'Chave da API Gemini não encontrada no servidor. Configure a variável GEMINI_API_KEY nas Environment Variables do projeto.',
      code: 'API_KEY_ERROR',
    });
    return;
  }

  if (!buffer || buffer.length === 0) {
    sendJson(res, 400, {
      error: 'Nenhum arquivo de áudio ou vídeo válido foi enviado.',
      code: 'MISSING_FILE',
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

  try {
    const mimeType = resolveMimeType(originalName, rawMimeType);
    const mediaPart = {
      inlineData: {
        mimeType,
        data: buffer.toString('base64'),
      },
    };

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
                      description: 'Término exato da palavra em segundos.',
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
                abortSignal: AbortSignal.timeout(38000),
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
        break;
      } catch (err) {
        lastModelError = err;
        const errMsg = err instanceof Error ? err.message : String(err);
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
      sendJson(res, 422, {
        error:
          'Nenhuma fala audível foi detectada neste vídeo. Verifique se o áudio não está mudo.',
        code: 'NO_AUDIO',
      });
      return;
    }

    const segments = sanitizeTranscription(parsed);
    if (segments.length === 0) {
      sendJson(res, 422, {
        error:
          'Não foi possível extrair falas deste vídeo. Confirme se há voz audível na gravação.',
        code: 'NO_AUDIO',
      });
      return;
    }

    sendJson(res, 200, {
      hasSpeech: true,
      detectedLanguage: parsed.detectedLanguage || language,
      segments,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const errName = error instanceof Error ? error.name : '';

    if (
      errName === 'AbortError' ||
      errName === 'TimeoutError' ||
      msg.includes('aborted') ||
      msg.includes('timeout')
    ) {
      sendJson(res, 504, {
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
      sendJson(res, 403, {
        error:
          'Chave da API Gemini inválida ou sem permissão. Verifique GEMINI_API_KEY nas configurações.',
        code: 'API_KEY_ERROR',
      });
      return;
    }

    if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
      sendJson(res, 429, {
        error:
          'Cota da API Gemini temporariamente excedida. Aguarde alguns segundos e tente novamente.',
        code: 'QUOTA_EXCEEDED',
      });
      return;
    }

    sendJson(res, 502, {
      error: `Falha ao processar o vídeo com a IA: ${msg}`,
      code: 'API_ERROR',
    });
  }
}
