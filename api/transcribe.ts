import multer from 'multer';
import path from 'node:path';
import {
  sendJson,
  transcribeBufferAndRespond,
  VERCEL_MAX_UPLOAD_BYTES,
  type VercelRequest,
  type VercelResponse,
} from './_lib/transcribeCore.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: VERCEL_MAX_UPLOAD_BYTES + 256 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExt = ['.mp4', '.mov', '.webm', '.m4v', '.mp3', '.wav', '.m4a'];
    const allowedMime = [
      'video/mp4',
      'video/quicktime',
      'video/webm',
      'video/x-m4v',
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
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

  try {
    await new Promise<void>((resolve, reject) => {
      const middleware = upload.single('video') as unknown as (
        r: VercelRequest,
        s: VercelResponse,
        next: (err?: unknown) => void,
      ) => void;
      middleware(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } catch (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        sendJson(res, 413, {
          error:
            'O arquivo ultrapassou o limite de envio na Vercel (4 MB). Envie um vídeo mais curto ou em MP4/MOV compatível.',
          code: 'FILE_TOO_LARGE',
        });
        return;
      }
      sendJson(res, 400, {
        error: `Erro ao receber o arquivo de vídeo: ${err.message}`,
        code: 'UPLOAD_ERROR',
      });
      return;
    }

    if (err instanceof Error && err.message === 'UNSUPPORTED_FORMAT') {
      sendJson(res, 400, {
        error: 'Formato não suportado. Envie um vídeo MP4, MOV ou WebM.',
        code: 'UNSUPPORTED_FORMAT',
      });
      return;
    }

    sendJson(res, 500, {
      error: `Erro interno no upload: ${err instanceof Error ? err.message : String(err)}`,
      code: 'UPLOAD_SERVER_ERROR',
    });
    return;
  }

  const file = req.file;
  if (!file || !file.buffer) {
    sendJson(res, 400, {
      error: 'Nenhum arquivo de vídeo foi enviado para transcrição.',
      code: 'MISSING_FILE',
    });
    return;
  }

  await transcribeBufferAndRespond({
    buffer: file.buffer,
    originalName: file.originalname || 'video.mp4',
    rawMimeType: file.mimetype,
    languageInput: req.body?.language,
    customDictionaryInput: req.body?.customDictionary,
    res,
  });
}
