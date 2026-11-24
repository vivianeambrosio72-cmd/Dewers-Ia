import path from 'node:path';
import {
  sendJson,
  transcribeBufferAndRespond,
  VERCEL_MAX_UPLOAD_BYTES,
  type VercelRequest,
  type VercelResponse,
} from './_lib/transcribeCore.js';

export const config = {
  maxDuration: 60,
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, {
      error: 'Método não permitido.',
      code: 'METHOD_NOT_ALLOWED',
    });
    return;
  }

  let body: Record<string, unknown> = {};
  if (req.body && typeof req.body === 'object') {
    body = req.body;
  } else {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (raw) {
        body = JSON.parse(raw) as Record<string, unknown>;
      }
    } catch {
      sendJson(res, 400, {
        error: 'Corpo JSON inválido na requisição de transcrição.',
        code: 'INVALID_JSON',
      });
      return;
    }
  }

  const audioBase64 =
    typeof body.audioBase64 === 'string' ? body.audioBase64 : '';
  const rawFileName =
    typeof body.fileName === 'string'
      ? path.basename(body.fileName)
      : 'audio.wav';
  const rawMimeType =
    typeof body.mimeType === 'string' ? body.mimeType : 'audio/wav';

  if (!audioBase64) {
    sendJson(res, 400, {
      error: 'Nenhum áudio foi enviado para transcrição.',
      code: 'MISSING_FILE',
    });
    return;
  }

  const buffer = Buffer.from(audioBase64, 'base64');
  if (buffer.length === 0 || buffer.length > VERCEL_MAX_UPLOAD_BYTES) {
    sendJson(res, 413, {
      error: 'O áudio excedeu o limite permitido pela Vercel.',
      code: 'FILE_TOO_LARGE',
    });
    return;
  }

  await transcribeBufferAndRespond({
    buffer,
    originalName: rawFileName,
    rawMimeType,
    languageInput: body.language,
    customDictionaryInput: body.customDictionary,
    res,
  });
}
