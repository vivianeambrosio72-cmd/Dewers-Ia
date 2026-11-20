import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  RecaptchaVerifier,
  setPersistence,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

declare global {
  interface Window {
    grecaptcha?: {
      reset: (widgetId?: number) => void;
    };
  }
}

export const ADMIN_EMAIL = 'vivianeambrosio72@gmail.com';
const LAST_FIREBASE_ERROR_KEY = 'dewes_ia_last_firebase_error_v1';

export const firebaseRuntimeConfig = {
  projectId: firebaseConfig.projectId,
  authDomain: firebaseConfig.authDomain,
};

export interface LastFirebaseErrorRecord {
  code: string;
  message: string;
  action: string;
  timestamp: string;
}

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
auth.languageCode = 'pt';

setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('[DEWES Auth] Falha ao configurar persistência local:', err);
});

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export function isAdminUser(user: User | null | undefined): boolean {
  if (!user) return false;
  const hasGoogleProvider = user.providerData.some(
    (provider) => provider.providerId === 'google.com',
  );
  return (
    hasGoogleProvider &&
    Boolean(user.emailVerified) &&
    (user.email || '').trim().toLowerCase() === ADMIN_EMAIL
  );
}

export function extractFirebaseErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const raw = (error as { code?: unknown }).code;
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
  }
  const msg = error instanceof Error ? error.message : String(error);
  const match = msg.match(/\bauth\/[a-z0-9-]+\b/i);
  return match ? match[0].toLowerCase() : 'unknown';
}

export function recordLastFirebaseError(error: unknown, action: string): string {
  const code = extractFirebaseErrorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[DEWES Auth][${action}] Código de erro Firebase:`, code, error);

  try {
    const record: LastFirebaseErrorRecord = {
      code,
      message,
      action,
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem(LAST_FIREBASE_ERROR_KEY, JSON.stringify(record));
  } catch {
    // ignore storage errors
  }

  return code;
}

export function getLastFirebaseError(): LastFirebaseErrorRecord | null {
  try {
    const raw = localStorage.getItem(LAST_FIREBASE_ERROR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastFirebaseErrorRecord;
    if (!parsed || typeof parsed.code !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearLastFirebaseError(): void {
  try {
    localStorage.removeItem(LAST_FIREBASE_ERROR_KEY);
  } catch {
    // ignore
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Verifique a configuração do Firebase: cliente offline.');
    }
  }
}
testConnection();

export async function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

// Single reusable invisible RecaptchaVerifier instance management
let activeRecaptcha: RecaptchaVerifier | null = null;
let activeRecaptchaWidgetId: number | null = null;
let activeRecaptchaContainer: HTMLElement | string | null = null;

function resolveContainerElement(
  containerTarget: HTMLElement | string | null,
): HTMLElement | null {
  if (!containerTarget || typeof document === 'undefined') return null;
  if (typeof containerTarget === 'string') {
    return document.getElementById(containerTarget);
  }
  return containerTarget;
}

export function clearRecaptchaVerifier(
  containerTarget?: HTMLElement | string | null,
) {
  if (
    activeRecaptchaWidgetId !== null &&
    typeof window !== 'undefined' &&
    typeof window.grecaptcha?.reset === 'function'
  ) {
    try {
      window.grecaptcha.reset(activeRecaptchaWidgetId);
    } catch {
      // ignore reset errors
    }
  }

  if (activeRecaptcha) {
    try {
      activeRecaptcha.clear();
    } catch {
      // ignore cleanup errors
    }
  }

  const targetEl = resolveContainerElement(
    containerTarget ?? activeRecaptchaContainer,
  );
  if (targetEl) {
    targetEl.innerHTML = '';
  }

  activeRecaptcha = null;
  activeRecaptchaWidgetId = null;
  activeRecaptchaContainer = null;
}

async function getOrCreateRecaptchaVerifier(
  containerTarget: HTMLElement | string,
  forceNew = false,
): Promise<RecaptchaVerifier> {
  if (forceNew) {
    clearRecaptchaVerifier(containerTarget);
  }

  if (activeRecaptcha && activeRecaptchaContainer === containerTarget) {
    return activeRecaptcha;
  }

  // Ensure the fixed DOM container starts clean before rendering
  clearRecaptchaVerifier(containerTarget);

  const verifier = new RecaptchaVerifier(auth, containerTarget, {
    size: 'invisible',
    callback: () => {
      // Token resolved silently
    },
    'expired-callback': () => {
      if (
        activeRecaptchaWidgetId !== null &&
        typeof window !== 'undefined' &&
        typeof window.grecaptcha?.reset === 'function'
      ) {
        try {
          window.grecaptcha.reset(activeRecaptchaWidgetId);
        } catch {
          // ignore
        }
      }
    },
  });

  try {
    activeRecaptcha = verifier;
    activeRecaptchaContainer = containerTarget;
    activeRecaptchaWidgetId = await verifier.render();
    return verifier;
  } catch (err) {
    clearRecaptchaVerifier(containerTarget);
    throw err;
  }
}

export async function sendPhoneVerificationCode(
  phoneNumberE164: string,
  containerTarget: HTMLElement | string,
  options?: { forceFreshRecaptcha?: boolean },
): Promise<ConfirmationResult> {
  try {
    const verifier = await getOrCreateRecaptchaVerifier(
      containerTarget,
      Boolean(options?.forceFreshRecaptcha),
    );
    return await signInWithPhoneNumber(auth, phoneNumberE164, verifier);
  } catch (err) {
    // Always reset & clear so the next attempt recreates cleanly without
    // triggering "reCAPTCHA has already been rendered in this element".
    clearRecaptchaVerifier(containerTarget);
    throw err;
  }
}

export function mapAuthErrorToPortuguese(error: unknown): string {
  const code = extractFirebaseErrorCode(error);
  const msg = error instanceof Error ? error.message : String(error);

  if (code === 'auth/popup-closed-by-user') {
    return '';
  }
  if (code === 'auth/invalid-phone-number' || msg.includes('invalid-phone-number')) {
    return 'Número inválido. Confira e tente de novo.';
  }
  if (code === 'auth/too-many-requests' || msg.includes('too-many-requests')) {
    return 'Muitas tentativas. Aguarde alguns minutos.';
  }
  if (
    code === 'auth/invalid-verification-code' ||
    msg.includes('invalid-verification-code')
  ) {
    return 'Código incorreto.';
  }
  if (code === 'auth/code-expired' || msg.includes('code-expired')) {
    return 'O código expirou. Peça um novo.';
  }
  if (code === 'auth/captcha-check-failed' || msg.includes('captcha-check-failed')) {
    return 'Falha na verificação. Atualize a página e tente novamente.';
  }
  if (code === 'auth/quota-exceeded' || msg.includes('quota-exceeded')) {
    return 'Limite de SMS atingido. Tente mais tarde.';
  }
  if (code === 'auth/operation-not-allowed' || msg.includes('operation-not-allowed')) {
    return 'Login por telefone não está ativado. Avise o administrador.';
  }
  if (code === 'auth/unauthorized-domain' || msg.includes('unauthorized-domain')) {
    return 'Este endereço não está autorizado no Firebase.';
  }
  if (code === 'auth/network-request-failed' || msg.includes('network-request-failed')) {
    return 'Sem conexão. Verifique a internet.';
  }
  if (code === 'auth/missing-phone-number') {
    return 'Número inválido. Confira e tente de novo.';
  }

  console.error('[DEWES Auth] Erro Firebase não mapeado:', code, error);
  return 'Não foi possível concluir a verificação. Tente novamente em instantes.';
}

export async function signOutUser() {
  clearRecaptchaVerifier();
  return signOut(auth);
}
