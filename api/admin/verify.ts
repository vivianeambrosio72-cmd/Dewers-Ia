import {
  verifyExclusiveAdminRequest,
} from '../_lib/adminAuth.js';
import {
  sendJson,
  type VercelRequest,
  type VercelResponse,
} from '../_lib/transcribeCore.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendJson(res, 405, {
      error: 'Método não permitido.',
      code: 'METHOD_NOT_ALLOWED',
    });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  const result = await verifyExclusiveAdminRequest(req);

  if (!result.ok) {
    sendJson(res, result.status, {
      authorized: false,
      error: result.error,
      code: result.code,
    });
    return;
  }

  sendJson(res, 200, {
    authorized: true,
    uid: result.uid,
    email: result.email,
    provider: result.provider,
    hasCustomClaim: result.hasCustomClaim,
    authMode: result.hasCustomClaim
      ? 'custom-claim-and-verified-token'
      : 'verified-id-token-and-rules',
  });
}
