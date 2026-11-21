import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

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
function createFirestoreClient() {
  try {
    return initializeFirestore(
      app,
      { experimentalForceLongPolling: true },
      firebaseConfig.firestoreDatabaseId,
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const db = createFirestoreClient();
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
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (msg.includes('client is offline') || msg.includes('unavailable')) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (retryErr) {
        const retryMsg =
          retryErr instanceof Error ? retryErr.message.toLowerCase() : String(retryErr).toLowerCase();
        if (retryMsg.includes('client is offline')) {
          console.error('Verifique a configuração do Firebase: cliente offline.');
        }
      }
    }
  }
}
testConnection();

export async function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function signInWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function registerWithEmail(email: string, password: string) {
  return createUserWithEmailAndPassword(auth, email.trim(), password);
}

export async function resetPasswordWithEmail(email: string) {
  return sendPasswordResetEmail(auth, email.trim());
}

export function mapAuthErrorToPortuguese(error: unknown): string {
  const code = extractFirebaseErrorCode(error);
  const msg = error instanceof Error ? error.message : String(error);

  if (code === 'auth/popup-closed-by-user') {
    return '';
  }
  if (code === 'auth/invalid-email' || msg.includes('invalid-email')) {
    return 'E-mail inválido. Confira e tente de novo.';
  }
  if (
    code === 'auth/user-not-found' ||
    code === 'auth/wrong-password' ||
    code === 'auth/invalid-credential' ||
    msg.includes('invalid-credential')
  ) {
    return 'E-mail ou senha incorretos.';
  }
  if (code === 'auth/email-already-in-use' || msg.includes('email-already-in-use')) {
    return 'Este e-mail já está cadastrado. Tente entrar na sua conta.';
  }
  if (code === 'auth/weak-password' || msg.includes('weak-password')) {
    return 'A senha deve ter pelo menos 6 caracteres.';
  }
  if (code === 'auth/user-disabled' || msg.includes('user-disabled')) {
    return 'Esta conta foi desativada. Avise o administrador.';
  }
  if (code === 'auth/too-many-requests' || msg.includes('too-many-requests')) {
    return 'Muitas tentativas. Aguarde alguns minutos.';
  }
  if (code === 'auth/operation-not-allowed' || msg.includes('operation-not-allowed')) {
    return 'Login por e-mail não está ativado no Firebase. Avise o administrador.';
  }
  if (code === 'auth/unauthorized-domain' || msg.includes('unauthorized-domain')) {
    return 'Este endereço não está autorizado no Firebase.';
  }
  if (code === 'auth/network-request-failed' || msg.includes('network-request-failed')) {
    return 'Sem conexão. Verifique a internet.';
  }

  console.error('[DEWES Auth] Erro Firebase não mapeado:', code, error);
  return 'Não foi possível concluir a autenticação. Tente novamente em instantes.';
}

export async function signOutUser() {
  return signOut(auth);
}
