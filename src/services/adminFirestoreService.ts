import { type User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  ADMIN_EMAIL,
  auth,
  db,
  handleFirestoreError,
  isAdminUser,
  OperationType,
} from '../firebase';
import {
  DEFAULT_MULTICAIXA_HOLDER,
  DEFAULT_MULTICAIXA_NUMBER,
  DEFAULT_MULTICAIXA_PLACEHOLDER,
  PRO_PLAN_CATALOG,
  type AdminAuditAction,
  type AdminAuditLogRecord,
  type AdminVerifyResponse,
  type AuthProviderKind,
  type BillingCycle,
  type MulticaixaSettingsRecord,
  type PaymentRecord,
  type PaymentStatus,
  type ProOrderRecord,
  type ProOrderStatus,
  type SubscriptionStatus,
  type SupportedLanguage,
  type TranscriptionLogRecord,
  type UserFreeQuotaState,
  type UserPlan,
  type UserProfileRecord,
  type VideoExportType,
} from '../types';

export function makeSafeOrderId(prefix = 'PED'): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (
    val &&
    typeof val === 'object' &&
    'toDate' in val &&
    typeof (val as { toDate: () => Date }).toDate === 'function'
  ) {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof val === 'string' && val.trim()) {
    return val;
  }
  return new Date().toISOString();
}

async function resolveAuthEmail(user: User): Promise<string> {
  try {
    const tokenRes = await user.getIdTokenResult();
    if (
      typeof tokenRes.claims?.email === 'string' &&
      tokenRes.claims.email.trim()
    ) {
      return tokenRes.claims.email.trim();
    }
  } catch {
    // fallback to user.email
  }
  return (user.email || '').trim();
}

function detectAuthProvider(user: User): AuthProviderKind {
  const hasGoogle = user.providerData.some((p) => p.providerId === 'google.com');
  return hasGoogle ? 'google' : 'email';
}

function sanitizeDisplayName(user: User): string {
  const candidate =
    user.displayName?.trim() ||
    (user.email ? user.email.split('@')[0] : '') ||
    'Utilizador';
  return candidate.slice(0, 120);
}

function normalizeUserDoc(
  uid: string,
  data: Record<string, unknown>,
): UserProfileRecord {
  const email = String(data.email || '');
  const role =
    data.role === 'admin' && email.toLowerCase() === ADMIN_EMAIL
      ? 'admin'
      : 'user';
  const plan: UserPlan = data.plan === 'PRO' ? 'PRO' : 'FREE';
  const subscriptionStatus: SubscriptionStatus =
    data.subscriptionStatus === 'active' ||
    data.subscriptionStatus === 'pending' ||
    data.subscriptionStatus === 'expired' ||
    data.subscriptionStatus === 'cancelled'
      ? data.subscriptionStatus
      : 'free';
  const billingCycle: BillingCycle =
    data.billingCycle === 'monthly' || data.billingCycle === 'annual'
      ? data.billingCycle
      : 'none';

  return {
    uid,
    displayName: String(data.displayName || 'Utilizador'),
    email,
    photoURL: typeof data.photoURL === 'string' ? data.photoURL : null,
    role,
    authProvider: data.authProvider === 'google' ? 'google' : 'email',
    plan,
    subscriptionStatus,
    billingCycle,
    subscriptionExpiresAt:
      typeof data.subscriptionExpiresAt === 'string'
        ? data.subscriptionExpiresAt
        : null,
    lastActiveAt: toIsoString(data.lastActiveAt),
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

function normalizeTranscriptionDoc(
  id: string,
  data: Record<string, unknown>,
): TranscriptionLogRecord {
  const lang = data.language;
  const validLang: SupportedLanguage =
    lang === 'en-US' || lang === 'es-ES' || lang === 'fr-FR' ? lang : 'pt-BR';

  return {
    id,
    userId: String(data.userId || ''),
    userEmail: String(data.userEmail || ''),
    userPlan: data.userPlan === 'PRO' ? 'PRO' : 'FREE',
    videoFileName: String(data.videoFileName || 'video.mp4'),
    durationSeconds: Number(data.durationSeconds || 0),
    minutesProcessed: Number(data.minutesProcessed || 0),
    language: validLang,
    segmentCount: Number(data.segmentCount || 0),
    wordCount: Number(data.wordCount || 0),
    modelUsed: String(data.modelUsed || 'gemini'),
    estimatedCostUsd: Number(data.estimatedCostUsd || 0),
    totalTokens: Number(data.totalTokens || 0),
    status: data.status === 'error' ? 'error' : 'completed',
    errorCode: typeof data.errorCode === 'string' ? data.errorCode : null,
    errorMessage:
      typeof data.errorMessage === 'string' ? data.errorMessage : null,
    resolvedByAdmin: Boolean(data.resolvedByAdmin),
    createdAt: toIsoString(data.createdAt),
  };
}

function normalizePaymentDoc(
  id: string,
  data: Record<string, unknown>,
): PaymentRecord {
  const status: PaymentStatus =
    data.status === 'confirmed' || data.status === 'refused'
      ? data.status
      : 'pending';
  const subscriptionStatus: Exclude<SubscriptionStatus, 'free'> =
    data.subscriptionStatus === 'active' ||
    data.subscriptionStatus === 'expired' ||
    data.subscriptionStatus === 'cancelled'
      ? data.subscriptionStatus
      : 'pending';

  return {
    id,
    userId: String(data.userId || ''),
    userEmail: String(data.userEmail || ''),
    plan: 'PRO',
    billingCycle: data.billingCycle === 'annual' ? 'annual' : 'monthly',
    amountBrl: Number(data.amountBrl || 0),
    status,
    subscriptionStatus,
    paymentMethod: String(data.paymentMethod || 'PIX'),
    notes: typeof data.notes === 'string' ? data.notes : null,
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : null,
    recordedBy: String(data.recordedBy || ADMIN_EMAIL),
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

function normalizeProOrderDoc(
  id: string,
  data: Record<string, unknown>,
): ProOrderRecord {
  const billingCycle = data.billingCycle === 'annual' ? 'annual' : 'monthly';
  const status: ProOrderStatus =
    data.status === 'APROVADO' || data.status === 'REJEITADO'
      ? data.status
      : 'PENDENTE';

  return {
    id,
    userId: String(data.userId || ''),
    userName: String(data.userName || 'Utilizador'),
    userEmail: String(data.userEmail || ''),
    billingCycle,
    planLabel: billingCycle === 'annual' ? 'PRO Anual' : 'PRO Mensal',
    amountKz: billingCycle === 'annual' ? 10000 : 1000,
    durationDays: billingCycle === 'annual' ? 365 : 30,
    status,
    approvedBy: typeof data.approvedBy === 'string' ? data.approvedBy : null,
    approvedByUid:
      typeof data.approvedByUid === 'string' ? data.approvedByUid : null,
    rejectionReason:
      typeof data.rejectionReason === 'string' ? data.rejectionReason : null,
    activatedStartAt:
      typeof data.activatedStartAt === 'string' ? data.activatedStartAt : null,
    activatedExpiresAt:
      typeof data.activatedExpiresAt === 'string'
        ? data.activatedExpiresAt
        : null,
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

function normalizeMulticaixaSettingsDoc(
  data?: Record<string, unknown>,
): MulticaixaSettingsRecord {
  const rawNumber =
    typeof data?.multicaixaNumber === 'string'
      ? data.multicaixaNumber.trim()
      : '';
  const multicaixaNumber =
    rawNumber && rawNumber !== DEFAULT_MULTICAIXA_PLACEHOLDER
      ? rawNumber
      : DEFAULT_MULTICAIXA_NUMBER;
  const rawHolder =
    typeof data?.holderName === 'string' ? data.holderName.trim() : '';
  const holderName =
    rawHolder ||
    (multicaixaNumber === DEFAULT_MULTICAIXA_NUMBER
      ? DEFAULT_MULTICAIXA_HOLDER
      : '');

  return {
    id: 'multicaixa_express',
    multicaixaNumber,
    whatsappNumber:
      typeof data?.whatsappNumber === 'string' ? data.whatsappNumber.trim() : '',
    holderName,
    updatedBy:
      typeof data?.updatedBy === 'string' ? data.updatedBy : ADMIN_EMAIL,
    updatedAt: data?.updatedAt
      ? toIsoString(data.updatedAt)
      : new Date().toISOString(),
  };
}

function normalizeAuditDoc(
  id: string,
  data: Record<string, unknown>,
): AdminAuditLogRecord {
  return {
    id,
    adminUid: String(data.adminUid || ''),
    adminEmail: String(data.adminEmail || ''),
    action: (data.action as AdminAuditAction) || 'UPDATE_USER_PLAN',
    targetType:
      data.targetType === 'user' ||
      data.targetType === 'payment' ||
      data.targetType === 'transcription' ||
      data.targetType === 'pro_order' ||
      data.targetType === 'settings'
        ? data.targetType
        : 'system',
    targetId: String(data.targetId || ''),
    targetEmail:
      typeof data.targetEmail === 'string' ? data.targetEmail : null,
    summary: String(data.summary || ''),
    previousValue:
      typeof data.previousValue === 'string' ? data.previousValue : null,
    newValue: typeof data.newValue === 'string' ? data.newValue : null,
    createdAt: toIsoString(data.createdAt),
  };
}

/**
 * Sincroniza o perfil do utilizador no Firestore quando inicia sessão.
 * Nunca eleva plano nem permissões no frontend.
 */
export async function syncUserProfileOnLogin(
  user: User,
): Promise<UserProfileRecord | null> {
  if (!user.email) return null;
  const userRef = doc(db, 'users', user.uid);
  const displayName = sanitizeDisplayName(user);
  const photoURL = user.photoURL ? user.photoURL.slice(0, 1000) : null;
  const authProvider = detectAuthProvider(user);

  let resolvedEmail = user.email;
  try {
    const tokenRes = await user.getIdTokenResult();
    if (
      typeof tokenRes.claims?.email === 'string' &&
      tokenRes.claims.email.trim()
    ) {
      resolvedEmail = tokenRes.claims.email.trim();
    }
  } catch {
    // Keep user.email fallback
  }

  let existingSnapData: Record<string, unknown> | null = null;

  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      const role = isAdminUser(user) ? 'admin' : 'user';
      const payload = {
        uid: user.uid,
        displayName,
        email: resolvedEmail,
        photoURL,
        role,
        authProvider,
        plan: 'FREE' as const,
        subscriptionStatus: 'free' as const,
        billingCycle: 'none' as const,
        lastActiveAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(userRef, payload);
      return {
        uid: user.uid,
        displayName,
        email: resolvedEmail,
        photoURL,
        role,
        authProvider,
        plan: 'FREE',
        subscriptionStatus: 'free',
        billingCycle: 'none',
        subscriptionExpiresAt: null,
        lastActiveAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    existingSnapData = snap.data() as Record<string, unknown>;
    const allowedUserKeys = new Set([
      'uid',
      'displayName',
      'email',
      'photoURL',
      'role',
      'authProvider',
      'plan',
      'subscriptionStatus',
      'billingCycle',
      'subscriptionExpiresAt',
      'lastActiveAt',
      'createdAt',
      'updatedAt',
    ]);
    const hasOnlyAllowedKeys = Object.keys(existingSnapData).every((k) =>
      allowedUserKeys.has(k),
    );
    const hasCompleteValidSchema =
      hasOnlyAllowedKeys &&
      existingSnapData.uid === user.uid &&
      typeof existingSnapData.email === 'string' &&
      existingSnapData.email.trim().length >= 3 &&
      (existingSnapData.role === 'user' || existingSnapData.role === 'admin') &&
      (existingSnapData.authProvider === 'google' ||
        existingSnapData.authProvider === 'email') &&
      (existingSnapData.plan === 'FREE' || existingSnapData.plan === 'PRO') &&
      typeof existingSnapData.subscriptionStatus === 'string' &&
      ['free', 'active', 'pending', 'expired', 'cancelled'].includes(
        existingSnapData.subscriptionStatus,
      ) &&
      typeof existingSnapData.billingCycle === 'string' &&
      ['none', 'monthly', 'annual'].includes(existingSnapData.billingCycle) &&
      existingSnapData.createdAt instanceof Timestamp;

    if (hasCompleteValidSchema) {
      await updateDoc(userRef, {
        displayName,
        photoURL,
        authProvider,
        lastActiveAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const preservedPlan: UserPlan =
        existingSnapData.plan === 'PRO' ? 'PRO' : 'FREE';
      const rawStatus = existingSnapData.subscriptionStatus;
      const preservedStatus: SubscriptionStatus =
        rawStatus === 'active' ||
        rawStatus === 'pending' ||
        rawStatus === 'expired' ||
        rawStatus === 'cancelled' ||
        rawStatus === 'free'
          ? rawStatus
          : 'free';
      const rawCycle = existingSnapData.billingCycle;
      const preservedCycle: BillingCycle =
        rawCycle === 'monthly' || rawCycle === 'annual' || rawCycle === 'none'
          ? rawCycle
          : 'none';
      const preservedRole =
        existingSnapData.role === 'admin' && isAdminUser(user)
          ? 'admin'
          : 'user';

      const repairedPayload: Record<string, unknown> = {
        uid: user.uid,
        displayName,
        email: resolvedEmail,
        photoURL,
        role: preservedRole,
        authProvider,
        plan: preservedPlan,
        subscriptionStatus: preservedStatus,
        billingCycle: preservedCycle,
        lastActiveAt: serverTimestamp(),
        createdAt:
          existingSnapData.createdAt instanceof Timestamp
            ? existingSnapData.createdAt
            : serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (
        typeof existingSnapData.subscriptionExpiresAt === 'string' &&
        existingSnapData.subscriptionExpiresAt.length <= 40
      ) {
        repairedPayload.subscriptionExpiresAt =
          existingSnapData.subscriptionExpiresAt;
      }

      await setDoc(userRef, repairedPayload);
    }

    const refreshed = await getDoc(userRef);
    if (!refreshed.exists()) return null;
    return normalizeUserDoc(
      user.uid,
      refreshed.data() as Record<string, unknown>,
    );
  } catch (error) {
    console.warn(
      '[DEWES Telemetry] Falha ao sincronizar perfil no Firestore:',
      error,
    );
    if (existingSnapData) {
      return normalizeUserDoc(user.uid, existingSnapData);
    }
    return null;
  }
}

export function subscribeToCurrentUserProfile(
  uid: string,
  onUpdate: (profile: UserProfileRecord | null) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      onUpdate(
        normalizeUserDoc(snap.id, snap.data() as Record<string, unknown>),
      );
    },
    (error) => {
      console.warn('[DEWES Profile] Erro ao escutar perfil do utilizador:', error);
    },
  );
}

export function subscribeToMulticaixaSettings(
  onUpdate: (settings: MulticaixaSettingsRecord) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, 'settings', 'multicaixa_express'),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(normalizeMulticaixaSettingsDoc());
        return;
      }
      onUpdate(
        normalizeMulticaixaSettingsDoc(snap.data() as Record<string, unknown>),
      );
    },
    (error) => {
      console.warn(
        '[DEWES Settings] Erro ao carregar configuração Multicaixa Express:',
        error,
      );
      onUpdate(normalizeMulticaixaSettingsDoc());
    },
  );
}

export function subscribeToUserProOrders(
  userId: string,
  onUpdate: (orders: ProOrderRecord[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'pro_orders'),
    where('userId', '==', userId),
    limit(50),
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) =>
          normalizeProOrderDoc(d.id, d.data() as Record<string, unknown>),
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      onUpdate(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'pro_orders');
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

/**
 * Cria um pedido PRO com estado inicial obrigatório PENDENTE no Cloud Firestore.
 * Nunca ativa o plano PRO no lado do cliente.
 */
export async function createProOrder(params: {
  orderId: string;
  user: User;
  billingCycle: 'monthly' | 'annual';
}): Promise<ProOrderRecord> {
  const authEmail = await resolveAuthEmail(params.user);
  if (!authEmail) {
    throw new Error('A conta precisa de ter um e-mail válido.');
  }
  const catalog = PRO_PLAN_CATALOG[params.billingCycle];
  const cleanId = params.orderId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  const path = `pro_orders/${cleanId}`;
  const userName = sanitizeDisplayName(params.user);

  try {
    await setDoc(doc(db, 'pro_orders', cleanId), {
      id: cleanId,
      userId: params.user.uid,
      userName,
      userEmail: authEmail,
      billingCycle: catalog.billingCycle,
      planLabel: catalog.planLabel,
      amountKz: catalog.amountKz,
      durationDays: catalog.durationDays,
      status: 'PENDENTE',
      approvedBy: null,
      approvedByUid: null,
      rejectionReason: null,
      activatedStartAt: null,
      activatedExpiresAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const nowIso = new Date().toISOString();
    return {
      id: cleanId,
      userId: params.user.uid,
      userName,
      userEmail: authEmail,
      billingCycle: catalog.billingCycle,
      planLabel: catalog.planLabel,
      amountKz: catalog.amountKz,
      durationDays: catalog.durationDays,
      status: 'PENDENTE',
      approvedBy: null,
      approvedByUid: null,
      rejectionReason: null,
      activatedStartAt: null,
      activatedExpiresAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeToUserFreeQuota(
  userId: string,
  onUpdate: (quota: UserFreeQuotaState) => void,
): Unsubscribe {
  let txLoaded = false;
  let exportLoaded = false;
  let generatedVideoNames: string[] = [];
  let savedVideoKeys: string[] = [];

  const emit = () => {
    onUpdate({
      generatedCount: generatedVideoNames.length,
      generatedVideoNames,
      savedVideosCount: savedVideoKeys.length,
      savedVideoKeys,
      loaded: txLoaded && exportLoaded,
    });
  };

  const txQ = query(
    collection(db, 'transcriptions'),
    where('userId', '==', userId),
    limit(100),
  );
  const unsubTx = onSnapshot(
    txQ,
    (snap) => {
      generatedVideoNames = snap.docs
        .map((d) => d.data() as Record<string, unknown>)
        .filter((data) => data.status === 'completed')
        .map((data) => String(data.videoFileName || 'video.mp4'));
      txLoaded = true;
      emit();
    },
    (error) => {
      console.warn('[DEWES Quota] Erro ao consultar transcrições do utilizador:', error);
      txLoaded = true;
      emit();
    },
  );

  const exportsQ = query(
    collection(db, 'video_exports'),
    where('userId', '==', userId),
    limit(100),
  );
  const unsubExports = onSnapshot(
    exportsQ,
    (snap) => {
      const uniqueKeys = new Set<string>();
      snap.docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const key = String(data.videoKey || data.videoFileName || d.id);
        if (key) uniqueKeys.add(key);
      });
      savedVideoKeys = Array.from(uniqueKeys);
      exportLoaded = true;
      emit();
    },
    (error) => {
      console.warn('[DEWES Quota] Erro ao consultar exportações do utilizador:', error);
      exportLoaded = true;
      emit();
    },
  );

  return () => {
    unsubTx();
    unsubExports();
  };
}

export async function logVideoExportActivity(params: {
  user: User;
  userPlan: UserPlan;
  videoKey: string;
  videoFileName: string;
  exportType: VideoExportType;
}): Promise<void> {
  const authEmail = await resolveAuthEmail(params.user);
  if (!authEmail) return;
  const id = makeSafeId('exp');
  const path = `video_exports/${id}`;
  const cleanVideoKey = (params.videoKey || params.videoFileName || 'video')
    .trim()
    .slice(0, 240);
  const cleanFileName = (params.videoFileName || 'video.mp4')
    .trim()
    .slice(0, 200);

  try {
    await setDoc(doc(db, 'video_exports', id), {
      id,
      userId: params.user.uid,
      userEmail: authEmail,
      userPlan: params.userPlan === 'PRO' ? 'PRO' : 'FREE',
      videoKey: cleanVideoKey || 'video',
      videoFileName: cleanFileName || 'video.mp4',
      exportType: params.exportType,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn(`[DEWES Quota] Falha ao gravar ${path}:`, error);
  }
}

/**
 * Regista cada transcrição concluída ou erro de processamento para monitorização no /admin.
 */
export async function logTranscriptionActivity(params: {
  user: User;
  userPlan: UserPlan;
  videoFileName: string;
  durationSeconds: number;
  language: SupportedLanguage;
  segmentCount: number;
  wordCount: number;
  modelUsed: string;
  estimatedCostUsd: number;
  totalTokens: number;
  status: 'completed' | 'error';
  errorCode?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  const authEmail = await resolveAuthEmail(params.user);
  if (!authEmail) return;
  const id = makeSafeId('tx');
  const path = `transcriptions/${id}`;
  const clampedDuration = Math.max(
    0,
    Math.min(14400, Number(params.durationSeconds) || 0),
  );
  const minutesProcessed = Number((clampedDuration / 60).toFixed(2));

  try {
    await setDoc(doc(db, 'transcriptions', id), {
      id,
      userId: params.user.uid,
      userEmail: authEmail,
      userPlan: params.userPlan === 'PRO' ? 'PRO' : 'FREE',
      videoFileName: (params.videoFileName || 'video.mp4').slice(0, 200),
      durationSeconds: Number(clampedDuration.toFixed(2)),
      minutesProcessed: Math.max(0, Math.min(240, minutesProcessed)),
      language: params.language,
      segmentCount: Math.max(0, Math.min(5000, Math.round(params.segmentCount))),
      wordCount: Math.max(0, Math.min(50000, Math.round(params.wordCount))),
      modelUsed: (params.modelUsed || 'gemini-3.1-flash-lite').slice(0, 80),
      estimatedCostUsd: Math.max(
        0,
        Math.min(100, Number(params.estimatedCostUsd) || 0),
      ),
      totalTokens: Math.max(
        0,
        Math.min(5000000, Math.round(params.totalTokens || 0)),
      ),
      status: params.status,
      errorCode: params.errorCode ? String(params.errorCode).slice(0, 80) : null,
      errorMessage: params.errorMessage
        ? String(params.errorMessage).slice(0, 500)
        : null,
      resolvedByAdmin: false,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn(`[DEWES Telemetry] Falha ao gravar ${path}:`, error);
  }
}

/**
 * Verifica no servidor (Express / Vercel via Firebase Admin SDK) se o ID Token pertence
 * exclusivamente à conta administradora verificada dewersmatari@gmail.com.
 */
export async function verifyAdminSessionOnServer(
  user: User,
): Promise<AdminVerifyResponse> {
  try {
    const idToken = await user.getIdToken(true);
    const res = await fetch('/api/admin/verify', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
    });

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      return {
        authorized: false,
        error:
          'A sessão de segurança da pré-visualização expirou. Recarregue a página ou abra em uma nova guia.',
        code: 'ADMIN_PROXY_COOKIE_CHECK',
      };
    }

    const data = (await res.json().catch(() => ({}))) as AdminVerifyResponse;
    if (!res.ok || !data.authorized) {
      return {
        authorized: false,
        error:
          data.error ||
          'Acesso negado pelo servidor. Apenas dewersmatari@gmail.com pode aceder.',
        code: data.code || 'ADMIN_FORBIDDEN',
      };
    }
    return data;
  } catch {
    return {
      authorized: false,
      error: 'Não foi possível validar a sessão administrativa no servidor.',
      code: 'ADMIN_VERIFY_NETWORK_ERROR',
    };
  }
}

function assertCurrentAdmin(): { uid: string; email: string } {
  const current = auth.currentUser;
  if (!current || !isAdminUser(current) || !current.email) {
    throw new Error('Operação não autorizada para esta conta.');
  }
  return { uid: current.uid, email: current.email.toLowerCase() };
}

export interface AdminRealtimeBundle {
  users: UserProfileRecord[];
  transcriptions: TranscriptionLogRecord[];
  payments: PaymentRecord[];
  proOrders: ProOrderRecord[];
  auditLogs: AdminAuditLogRecord[];
  multicaixaSettings: MulticaixaSettingsRecord;
}

export function subscribeToAdminCollections(
  onUpdate: (partial: Partial<AdminRealtimeBundle>) => void,
  onError: (err: Error) => void,
): () => void {
  const unsubs: Unsubscribe[] = [];

  const usersQ = query(
    collection(db, 'users'),
    orderBy('createdAt', 'desc'),
    limit(500),
  );
  unsubs.push(
    onSnapshot(
      usersQ,
      (snap) => {
        onUpdate({
          users: snap.docs.map((d) =>
            normalizeUserDoc(d.id, d.data() as Record<string, unknown>),
          ),
        });
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, 'users');
        } catch (wrapped) {
          onError(
            wrapped instanceof Error ? wrapped : new Error(String(wrapped)),
          );
        }
      },
    ),
  );

  const txQ = query(
    collection(db, 'transcriptions'),
    orderBy('createdAt', 'desc'),
    limit(1000),
  );
  unsubs.push(
    onSnapshot(
      txQ,
      (snap) => {
        onUpdate({
          transcriptions: snap.docs.map((d) =>
            normalizeTranscriptionDoc(
              d.id,
              d.data() as Record<string, unknown>,
            ),
          ),
        });
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, 'transcriptions');
        } catch (wrapped) {
          onError(
            wrapped instanceof Error ? wrapped : new Error(String(wrapped)),
          );
        }
      },
    ),
  );

  const paymentsQ = query(
    collection(db, 'payments'),
    orderBy('createdAt', 'desc'),
    limit(500),
  );
  unsubs.push(
    onSnapshot(
      paymentsQ,
      (snap) => {
        onUpdate({
          payments: snap.docs.map((d) =>
            normalizePaymentDoc(d.id, d.data() as Record<string, unknown>),
          ),
        });
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, 'payments');
        } catch (wrapped) {
          onError(
            wrapped instanceof Error ? wrapped : new Error(String(wrapped)),
          );
        }
      },
    ),
  );

  const proOrdersQ = query(
    collection(db, 'pro_orders'),
    orderBy('createdAt', 'desc'),
    limit(500),
  );
  unsubs.push(
    onSnapshot(
      proOrdersQ,
      (snap) => {
        onUpdate({
          proOrders: snap.docs.map((d) =>
            normalizeProOrderDoc(d.id, d.data() as Record<string, unknown>),
          ),
        });
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, 'pro_orders');
        } catch (wrapped) {
          onError(
            wrapped instanceof Error ? wrapped : new Error(String(wrapped)),
          );
        }
      },
    ),
  );

  const auditQ = query(
    collection(db, 'audit_logs'),
    orderBy('createdAt', 'desc'),
    limit(500),
  );
  unsubs.push(
    onSnapshot(
      auditQ,
      (snap) => {
        onUpdate({
          auditLogs: snap.docs.map((d) =>
            normalizeAuditDoc(d.id, d.data() as Record<string, unknown>),
          ),
        });
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, 'audit_logs');
        } catch (wrapped) {
          onError(
            wrapped instanceof Error ? wrapped : new Error(String(wrapped)),
          );
        }
      },
    ),
  );

  unsubs.push(
    onSnapshot(
      doc(db, 'settings', 'multicaixa_express'),
      (snap) => {
        onUpdate({
          multicaixaSettings: snap.exists()
            ? normalizeMulticaixaSettingsDoc(
                snap.data() as Record<string, unknown>,
              )
            : normalizeMulticaixaSettingsDoc(),
        });
      },
      (error) => {
        try {
          handleFirestoreError(
            error,
            OperationType.GET,
            'settings/multicaixa_express',
          );
        } catch (wrapped) {
          onError(
            wrapped instanceof Error ? wrapped : new Error(String(wrapped)),
          );
        }
      },
    ),
  );

  return () => {
    unsubs.forEach((fn) => fn());
  };
}

export async function fetchAdminDashboardOnce(): Promise<AdminRealtimeBundle> {
  try {
    const [
      usersSnap,
      txSnap,
      paymentsSnap,
      proOrdersSnap,
      auditSnap,
      settingsSnap,
    ] = await Promise.all([
      getDocs(
        query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(500)),
      ),
      getDocs(
        query(
          collection(db, 'transcriptions'),
          orderBy('createdAt', 'desc'),
          limit(1000),
        ),
      ),
      getDocs(
        query(
          collection(db, 'payments'),
          orderBy('createdAt', 'desc'),
          limit(500),
        ),
      ),
      getDocs(
        query(
          collection(db, 'pro_orders'),
          orderBy('createdAt', 'desc'),
          limit(500),
        ),
      ),
      getDocs(
        query(
          collection(db, 'audit_logs'),
          orderBy('createdAt', 'desc'),
          limit(500),
        ),
      ),
      getDoc(doc(db, 'settings', 'multicaixa_express')),
    ]);

    return {
      users: usersSnap.docs.map((d) =>
        normalizeUserDoc(d.id, d.data() as Record<string, unknown>),
      ),
      transcriptions: txSnap.docs.map((d) =>
        normalizeTranscriptionDoc(d.id, d.data() as Record<string, unknown>),
      ),
      payments: paymentsSnap.docs.map((d) =>
        normalizePaymentDoc(d.id, d.data() as Record<string, unknown>),
      ),
      proOrders: proOrdersSnap.docs.map((d) =>
        normalizeProOrderDoc(d.id, d.data() as Record<string, unknown>),
      ),
      auditLogs: auditSnap.docs.map((d) =>
        normalizeAuditDoc(d.id, d.data() as Record<string, unknown>),
      ),
      multicaixaSettings: settingsSnap.exists()
        ? normalizeMulticaixaSettingsDoc(
            settingsSnap.data() as Record<string, unknown>,
          )
        : normalizeMulticaixaSettingsDoc(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'admin_dashboard');
  }
}

export async function adminSaveMulticaixaSettings(params: {
  multicaixaNumber: string;
  whatsappNumber: string;
  holderName: string;
}): Promise<void> {
  const admin = assertCurrentAdmin();
  const multicaixaNumber = params.multicaixaNumber.trim().slice(0, 40);
  const whatsappNumber = params.whatsappNumber.trim().slice(0, 40);
  const holderName = params.holderName.trim().slice(0, 120);

  if (!multicaixaNumber) {
    throw new Error('Informe o número Multicaixa Express.');
  }

  const settingPath = 'settings/multicaixa_express';
  const auditId = makeSafeId('audit');

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'settings', 'multicaixa_express'), {
      id: 'multicaixa_express',
      multicaixaNumber,
      whatsappNumber: whatsappNumber || null,
      holderName: holderName || null,
      updatedBy: admin.email,
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'audit_logs', auditId), {
      id: auditId,
      adminUid: admin.uid,
      adminEmail: admin.email,
      action: 'UPDATE_PAYMENT_SETTINGS',
      targetType: 'settings',
      targetId: 'multicaixa_express',
      targetEmail: admin.email,
      summary: `Configuração Multicaixa Express atualizada (${multicaixaNumber})`.slice(
        0,
        300,
      ),
      previousValue: null,
      newValue: `${multicaixaNumber}${whatsappNumber ? ` · WA ${whatsappNumber}` : ''}`.slice(
        0,
        200,
      ),
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, settingPath);
  }
}

/**
 * Aprova um pedido PRO pendente numa transação atómica do Firestore (validando também a sessão no backend).
 * Impede aprovações duplicadas e soma os dias caso já exista uma assinatura PRO válida.
 */
export async function adminApproveProOrder(
  order: ProOrderRecord,
): Promise<void> {
  const admin = assertCurrentAdmin();
  const current = auth.currentUser;
  if (!current) {
    throw new Error('Sessão expirada.');
  }

  const serverCheck = await verifyAdminSessionOnServer(current);
  if (!serverCheck.authorized) {
    throw new Error(
      serverCheck.error || 'Permissão administrativa recusada pelo servidor.',
    );
  }

  const orderPath = `pro_orders/${order.id}`;
  const orderRef = doc(db, 'pro_orders', order.id);
  const userRef = doc(db, 'users', order.userId);
  const auditId = makeSafeId('audit');

  try {
    await runTransaction(db, async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists()) {
        throw new Error('Pedido PRO não encontrado.');
      }
      const orderData = orderSnap.data() as Record<string, unknown>;
      if (orderData.status !== 'PENDENTE') {
        throw new Error(
          `Este pedido já foi processado (${String(orderData.status)}). Aprovações duplicadas são bloqueadas.`,
        );
      }

      const userSnap = await tx.get(userRef);
      if (!userSnap.exists()) {
        throw new Error('Perfil do utilizador não encontrado no Firestore.');
      }
      const userData = userSnap.data() as Record<string, unknown>;

      const now = new Date();
      const nowMs = now.getTime();
      let baseMs = nowMs;

      if (
        userData.plan === 'PRO' &&
        userData.subscriptionStatus === 'active' &&
        typeof userData.subscriptionExpiresAt === 'string'
      ) {
        const currentExpiryMs = Date.parse(userData.subscriptionExpiresAt);
        if (Number.isFinite(currentExpiryMs) && currentExpiryMs > nowMs) {
          baseMs = currentExpiryMs;
        }
      }

      const durationDays = order.billingCycle === 'annual' ? 365 : 30;
      const startIso = now.toISOString().slice(0, 40);
      const expiresIso = new Date(
        baseMs + durationDays * 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 40);

      tx.update(orderRef, {
        status: 'APROVADO',
        approvedBy: admin.email,
        approvedByUid: admin.uid,
        activatedStartAt: startIso,
        activatedExpiresAt: expiresIso,
        updatedAt: serverTimestamp(),
      });

      tx.update(userRef, {
        plan: 'PRO',
        subscriptionStatus: 'active',
        billingCycle: order.billingCycle,
        subscriptionExpiresAt: expiresIso,
        updatedAt: serverTimestamp(),
      });

      tx.set(doc(db, 'audit_logs', auditId), {
        id: auditId,
        adminUid: admin.uid,
        adminEmail: admin.email,
        action: 'APPROVE_PRO_ORDER',
        targetType: 'pro_order',
        targetId: order.id,
        targetEmail: order.userEmail,
        summary: `Pedido ${order.id} (${order.planLabel} · ${order.amountKz} Kz) aprovado para ${order.userEmail}. PRO válido até ${expiresIso.slice(0, 10)}.`.slice(
          0,
          300,
        ),
        previousValue: `${String(userData.plan || 'FREE')}/PENDENTE`,
        newValue: `PRO/APROVADO (${expiresIso.slice(0, 10)})`,
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Aprovações duplicadas') ||
        error.message.includes('não encontrado') ||
        error.message.includes('Permissão administrativa'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, orderPath);
  }
}

/**
 * Rejeita um pedido PRO pendente registando o motivo e mantendo o utilizador no plano FREE
 * (caso ainda não tenha uma assinatura PRO válida ativa).
 */
export async function adminRejectProOrder(params: {
  order: ProOrderRecord;
  reason: string;
}): Promise<void> {
  const admin = assertCurrentAdmin();
  const current = auth.currentUser;
  if (!current) {
    throw new Error('Sessão expirada.');
  }

  const cleanReason = params.reason.trim().slice(0, 300);
  if (cleanReason.length < 3) {
    throw new Error('Informe o motivo da rejeição (mínimo 3 caracteres).');
  }

  const serverCheck = await verifyAdminSessionOnServer(current);
  if (!serverCheck.authorized) {
    throw new Error(
      serverCheck.error || 'Permissão administrativa recusada pelo servidor.',
    );
  }

  const orderPath = `pro_orders/${params.order.id}`;
  const orderRef = doc(db, 'pro_orders', params.order.id);
  const userRef = doc(db, 'users', params.order.userId);
  const auditId = makeSafeId('audit');

  try {
    await runTransaction(db, async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists()) {
        throw new Error('Pedido PRO não encontrado.');
      }
      const orderData = orderSnap.data() as Record<string, unknown>;
      if (orderData.status !== 'PENDENTE') {
        throw new Error(
          `Este pedido já foi processado (${String(orderData.status)}).`,
        );
      }

      const userSnap = await tx.get(userRef);
      if (userSnap.exists()) {
        const userData = userSnap.data() as Record<string, unknown>;
        const hasActivePro =
          userData.plan === 'PRO' &&
          userData.subscriptionStatus === 'active' &&
          typeof userData.subscriptionExpiresAt === 'string' &&
          Date.parse(userData.subscriptionExpiresAt) > Date.now();

        if (!hasActivePro && userData.plan !== 'FREE') {
          tx.update(userRef, {
            plan: 'FREE',
            subscriptionStatus: 'free',
            billingCycle: 'none',
            updatedAt: serverTimestamp(),
          });
        }
      }

      tx.update(orderRef, {
        status: 'REJEITADO',
        rejectionReason: cleanReason,
        approvedBy: admin.email,
        approvedByUid: admin.uid,
        updatedAt: serverTimestamp(),
      });

      tx.set(doc(db, 'audit_logs', auditId), {
        id: auditId,
        adminUid: admin.uid,
        adminEmail: admin.email,
        action: 'REJECT_PRO_ORDER',
        targetType: 'pro_order',
        targetId: params.order.id,
        targetEmail: params.order.userEmail,
        summary: `Pedido ${params.order.id} de ${params.order.userEmail} rejeitado. Motivo: ${cleanReason}`.slice(
          0,
          300,
        ),
        previousValue: 'PENDENTE',
        newValue: 'REJEITADO',
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('já foi processado') ||
        error.message.includes('não encontrado') ||
        error.message.includes('Permissão administrativa'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, orderPath);
  }
}

export async function adminUpdateUserPlan(params: {
  targetUser: UserProfileRecord;
  plan: UserPlan;
  subscriptionStatus: SubscriptionStatus;
  billingCycle: BillingCycle;
  subscriptionExpiresAt: string | null;
}): Promise<void> {
  const admin = assertCurrentAdmin();
  const {
    targetUser,
    plan,
    subscriptionStatus,
    billingCycle,
    subscriptionExpiresAt,
  } = params;
  const userPath = `users/${targetUser.uid}`;
  const auditId = makeSafeId('audit');

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', targetUser.uid), {
      plan,
      subscriptionStatus,
      billingCycle:
        plan === 'FREE'
          ? 'none'
          : billingCycle === 'none'
            ? 'monthly'
            : billingCycle,
      subscriptionExpiresAt: subscriptionExpiresAt
        ? subscriptionExpiresAt.slice(0, 40)
        : null,
      updatedAt: serverTimestamp(),
    });

    const prevSummary = `${targetUser.plan}/${targetUser.subscriptionStatus}/${targetUser.billingCycle}`;
    const nextSummary = `${plan}/${subscriptionStatus}/${plan === 'FREE' ? 'none' : billingCycle}`;
    const action: AdminAuditAction =
      subscriptionStatus === 'expired' ||
      subscriptionStatus === 'cancelled' ||
      plan === 'FREE'
        ? 'REVOKE_SUBSCRIPTION'
        : 'UPDATE_USER_PLAN';

    batch.set(doc(db, 'audit_logs', auditId), {
      id: auditId,
      adminUid: admin.uid,
      adminEmail: admin.email,
      action,
      targetType: 'user',
      targetId: targetUser.uid,
      targetEmail: targetUser.email,
      summary:
        `Plano de ${targetUser.email} alterado para ${nextSummary}`.slice(
          0,
          300,
        ),
      previousValue: prevSummary.slice(0, 200),
      newValue: nextSummary.slice(0, 200),
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function adminCreatePayment(params: {
  targetUser: UserProfileRecord;
  billingCycle: 'monthly' | 'annual';
  amountBrl: number;
  status: PaymentStatus;
  paymentMethod: string;
  notes?: string;
  expiresAt?: string | null;
}): Promise<void> {
  const admin = assertCurrentAdmin();
  const paymentId = makeSafeId('pay');
  const auditId = makeSafeId('audit');
  const paymentPath = `payments/${paymentId}`;

  const subscriptionStatus: Exclude<SubscriptionStatus, 'free'> =
    params.status === 'confirmed'
      ? 'active'
      : params.status === 'pending'
        ? 'pending'
        : 'cancelled';

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'payments', paymentId), {
      id: paymentId,
      userId: params.targetUser.uid,
      userEmail: params.targetUser.email,
      plan: 'PRO',
      billingCycle: params.billingCycle,
      amountBrl: Math.max(0, Math.min(100000, Number(params.amountBrl) || 0)),
      status: params.status,
      subscriptionStatus,
      paymentMethod: (params.paymentMethod || 'PIX').slice(0, 60),
      notes: params.notes ? params.notes.trim().slice(0, 300) : null,
      expiresAt: params.expiresAt ? params.expiresAt.slice(0, 40) : null,
      recordedBy: admin.email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(db, 'users', params.targetUser.uid), {
      plan: params.status === 'confirmed' ? 'PRO' : params.targetUser.plan,
      subscriptionStatus:
        params.status === 'confirmed'
          ? 'active'
          : params.status === 'pending'
            ? 'pending'
            : params.targetUser.subscriptionStatus,
      billingCycle:
        params.status === 'confirmed'
          ? params.billingCycle
          : params.targetUser.billingCycle,
      subscriptionExpiresAt:
        params.status === 'confirmed' && params.expiresAt
          ? params.expiresAt.slice(0, 40)
          : params.targetUser.subscriptionExpiresAt || null,
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'audit_logs', auditId), {
      id: auditId,
      adminUid: admin.uid,
      adminEmail: admin.email,
      action: 'CREATE_PAYMENT',
      targetType: 'payment',
      targetId: paymentId,
      targetEmail: params.targetUser.email,
      summary:
        `Pagamento R$ ${Number(params.amountBrl).toFixed(2)} (${params.billingCycle}) registado como ${params.status} para ${params.targetUser.email}`.slice(
          0,
          300,
        ),
      previousValue: `${params.targetUser.plan}/${params.targetUser.subscriptionStatus}`,
      newValue: `${params.status}/${subscriptionStatus}`,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, paymentPath);
  }
}

export async function adminUpdatePaymentStatus(params: {
  payment: PaymentRecord;
  nextStatus: PaymentStatus;
  nextSubscriptionStatus: Exclude<SubscriptionStatus, 'free'>;
}): Promise<void> {
  const admin = assertCurrentAdmin();
  const { payment, nextStatus, nextSubscriptionStatus } = params;
  const paymentPath = `payments/${payment.id}`;
  const auditId = makeSafeId('audit');

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'payments', payment.id), {
      status: nextStatus,
      subscriptionStatus: nextSubscriptionStatus,
      recordedBy: admin.email,
      updatedAt: serverTimestamp(),
    });

    const nextPlan: UserPlan =
      nextStatus === 'confirmed' && nextSubscriptionStatus === 'active'
        ? 'PRO'
        : nextSubscriptionStatus === 'expired' ||
            nextSubscriptionStatus === 'cancelled'
          ? 'FREE'
          : 'PRO';

    batch.update(doc(db, 'users', payment.userId), {
      plan: nextPlan,
      subscriptionStatus:
        nextPlan === 'FREE' && nextSubscriptionStatus === 'cancelled'
          ? 'cancelled'
          : nextSubscriptionStatus,
      billingCycle: nextPlan === 'FREE' ? 'none' : payment.billingCycle,
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'audit_logs', auditId), {
      id: auditId,
      adminUid: admin.uid,
      adminEmail: admin.email,
      action: 'UPDATE_PAYMENT_STATUS',
      targetType: 'payment',
      targetId: payment.id,
      targetEmail: payment.userEmail,
      summary:
        `Pagamento ${payment.id} de ${payment.userEmail} atualizado para ${nextStatus} (${nextSubscriptionStatus})`.slice(
          0,
          300,
        ),
      previousValue: `${payment.status}/${payment.subscriptionStatus}`,
      newValue: `${nextStatus}/${nextSubscriptionStatus}`,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, paymentPath);
  }
}

export async function adminMarkTranscriptionErrorResolved(
  log: TranscriptionLogRecord,
): Promise<void> {
  const admin = assertCurrentAdmin();
  const txPath = `transcriptions/${log.id}`;
  const auditId = makeSafeId('audit');

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'transcriptions', log.id), {
      resolvedByAdmin: true,
    });
    batch.set(doc(db, 'audit_logs', auditId), {
      id: auditId,
      adminUid: admin.uid,
      adminEmail: admin.email,
      action: 'RESOLVE_TRANSCRIPTION_ERROR',
      targetType: 'transcription',
      targetId: log.id,
      targetEmail: log.userEmail,
      summary:
        `Erro ${log.errorCode || 'API_ERROR'} na transcrição ${log.videoFileName} marcado como resolvido`.slice(
          0,
          300,
        ),
      previousValue: 'pendente',
      newValue: 'resolvido',
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, txPath);
  }
}
