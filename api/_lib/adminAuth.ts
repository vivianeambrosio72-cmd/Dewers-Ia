import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export const EXCLUSIVE_ADMIN_EMAIL = 'dewersmatari@gmail.com';

interface FirebaseAppletConfig {
  projectId?: string;
}

function readFirebaseProjectId(): string {
  const candidates = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(import.meta.dirname, '../../firebase-applet-config.json'),
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(
          fs.readFileSync(filePath, 'utf-8'),
        ) as FirebaseAppletConfig;
        if (parsed.projectId && parsed.projectId.trim()) {
          return parsed.projectId.trim();
        }
      }
    } catch {
      // try next path
    }
  }
  return process.env.FIREBASE_PROJECT_ID || 'eighth-passkey-w91ww';
}

function getFirebaseAdminApp(): App {
  if (getApps().length > 0) {
    return getApp();
  }
  const projectId = readFirebaseProjectId();
  return initializeApp({ projectId });
}

export interface AdminVerifySuccess {
  ok: true;
  uid: string;
  email: string;
  provider: string;
  hasCustomClaim: boolean;
}

export interface AdminVerifyFailure {
  ok: false;
  status: 401 | 403;
  error: string;
  code: string;
}

export type AdminVerifyResult = AdminVerifySuccess | AdminVerifyFailure;

export async function verifyExclusiveAdminRequest(
  req: IncomingMessage,
): Promise<AdminVerifyResult> {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: 'Token de autenticação ausente. Faça login para continuar.',
      code: 'ADMIN_TOKEN_MISSING',
    };
  }

  try {
    const app = getFirebaseAdminApp();
    const decoded = await getAuth(app).verifyIdToken(token);
    const email = String(decoded.email || '')
      .trim()
      .toLowerCase();
    const emailVerified = Boolean(decoded.email_verified);
    const hasCustomClaim = decoded.admin === true;
    const provider = String(decoded.firebase?.sign_in_provider || 'unknown');

    if (!emailVerified || email !== EXCLUSIVE_ADMIN_EMAIL) {
      return {
        ok: false,
        status: 403,
        error:
          'Acesso negado. Apenas a conta administradora principal autorizada pode aceder a esta área.',
        code: 'ADMIN_FORBIDDEN',
      };
    }

    return {
      ok: true,
      uid: decoded.uid,
      email,
      provider,
      hasCustomClaim,
    };
  } catch {
    return {
      ok: false,
      status: 401,
      error: 'Sessão inválida ou expirada. Inicie sessão novamente.',
      code: 'ADMIN_TOKEN_INVALID',
    };
  }
}
