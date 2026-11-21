import {
  sendJson,
  VERCEL_MAX_UPLOAD_BYTES,
  type VercelRequest,
  type VercelResponse,
} from './_lib/transcribeCore';

export default function handler(req: VercelRequest, res: VercelResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, {
      error: 'Método não permitido.',
      code: 'METHOD_NOT_ALLOWED',
    });
    return;
  }

  sendJson(res, 200, {
    status: 'ok',
    service: 'dewers-ia',
    platform: 'vercel',
    maxUploadBytes: VERCEL_MAX_UPLOAD_BYTES,
    chunkSupported: false,
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
  });
}
