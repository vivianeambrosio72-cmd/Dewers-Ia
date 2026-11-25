import React, { useEffect, useMemo, useState } from 'react';
import { type User } from 'firebase/auth';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clapperboard,
  Clock,
  CreditCard,
  DollarSign,
  FileWarning,
  Filter,
  History,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Video,
  X,
  XCircle,
} from 'lucide-react';
import {
  adminApproveProOrder,
  adminCreatePayment,
  adminMarkTranscriptionErrorResolved,
  adminRejectProOrder,
  adminSaveMulticaixaSettings,
  adminUpdatePaymentStatus,
  adminUpdateUserPlan,
  fetchAdminDashboardOnce,
  subscribeToAdminCollections,
} from '../services/adminFirestoreService';
import {
  DEFAULT_MULTICAIXA_HOLDER,
  DEFAULT_MULTICAIXA_NUMBER,
  type AdminAuditLogRecord,
  type AdminVerifyResponse,
  type BillingCycle,
  type MulticaixaSettingsRecord,
  type PaymentRecord,
  type PaymentStatus,
  type ProOrderRecord,
  type ProOrderStatus,
  type SubscriptionStatus,
  type TranscriptionLogRecord,
  type UserPlan,
  type UserProfileRecord,
} from '../types';

type AdminTab =
  | 'overview'
  | 'pro_orders'
  | 'users'
  | 'payments'
  | 'transcriptions'
  | 'audit';

interface AdminDashboardProps {
  user: User;
  serverVerification: AdminVerifyResponse;
  onBackToStudio: () => void;
  onSignOut: () => void;
}

function formatBrl(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value || 0);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value || 0);
}

function formatDateTimePt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateOnlyPt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

function daysAgo(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

const PLAN_LABELS: Record<UserPlan, string> = {
  FREE: 'FREE',
  PRO: 'PRO',
};

const SUB_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  free: 'Gratuito',
  active: 'Ativa',
  pending: 'Pendente',
  expired: 'Expirada',
  cancelled: 'Cancelada',
};

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  confirmed: 'Confirmado',
  pending: 'Pendente',
  refused: 'Recusado',
};

const CYCLE_LABELS: Record<BillingCycle, string> = {
  none: 'Nenhum',
  monthly: 'Mensal',
  annual: 'Anual',
};

function formatKz(value: number): string {
  return `${new Intl.NumberFormat('pt-PT', {
    maximumFractionDigits: 0,
  }).format(value || 0)} Kz`;
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  UPDATE_USER_PLAN: 'Plano atualizado',
  CREATE_PAYMENT: 'Pagamento registado',
  UPDATE_PAYMENT_STATUS: 'Pagamento atualizado',
  RESOLVE_TRANSCRIPTION_ERROR: 'Erro analisado',
  REVOKE_SUBSCRIPTION: 'Assinatura revogada',
  ADMIN_VERIFY: 'Verificação admin',
  APPROVE_PRO_ORDER: 'Pedido PRO aprovado',
  REJECT_PRO_ORDER: 'Pedido PRO rejeitado',
  UPDATE_PAYMENT_SETTINGS: 'Config. Multicaixa Express',
};

function StatusChip({
  tone,
  label,
}: {
  tone: 'emerald' | 'amber' | 'rose' | 'purple' | 'slate';
  label: string;
}) {
  const styles: Record<typeof tone, string> = {
    emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    rose: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    purple: 'bg-purple-500/15 text-purple-200 border-purple-500/30',
    slate: 'bg-white/5 text-slate-300 border-white/15',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold whitespace-nowrap ${styles[tone]}`}
    >
      {label}
    </span>
  );
}

export function AdminDashboard({
  user,
  serverVerification,
  onBackToStudio,
  onSignOut,
}: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [users, setUsers] = useState<UserProfileRecord[]>([]);
  const [transcriptions, setTranscriptions] = useState<TranscriptionLogRecord[]>(
    [],
  );
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [proOrders, setProOrders] = useState<ProOrderRecord[]>([]);
  const [multicaixaSettings, setMulticaixaSettings] =
    useState<MulticaixaSettingsRecord>({
      id: 'multicaixa_express',
      multicaixaNumber: DEFAULT_MULTICAIXA_NUMBER,
      whatsappNumber: '',
      holderName: DEFAULT_MULTICAIXA_HOLDER,
      updatedBy: user.email || '',
      updatedAt: new Date().toISOString(),
    });
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Pedidos PRO (Multicaixa Express + WhatsApp)
  const [proOrderFilter, setProOrderFilter] = useState<'ALL' | ProOrderStatus>(
    'ALL',
  );
  const [proOrderSearch, setProOrderSearch] = useState('');
  const [showSettingsEditor, setShowSettingsEditor] = useState(false);
  const [cfgMulticaixaNumber, setCfgMulticaixaNumber] = useState(
    DEFAULT_MULTICAIXA_NUMBER,
  );
  const [cfgWhatsappNumber, setCfgWhatsappNumber] = useState('');
  const [cfgHolderName, setCfgHolderName] = useState(DEFAULT_MULTICAIXA_HOLDER);
  const [savingSettings, setSavingSettings] = useState(false);
  const [approveModalOrder, setApproveModalOrder] =
    useState<ProOrderRecord | null>(null);
  const [rejectModalOrder, setRejectModalOrder] =
    useState<ProOrderRecord | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState('');
  const [processingOrderId, setProcessingOrderId] = useState<string | null>(
    null,
  );

  // Filters: Users
  const [userSearch, setUserSearch] = useState('');
  const [userPlanFilter, setUserPlanFilter] = useState<'ALL' | UserPlan>('ALL');
  const [userStatusFilter, setUserStatusFilter] = useState<
    'ALL' | SubscriptionStatus
  >('ALL');
  const [userDateFilter, setUserDateFilter] = useState<
    'ALL' | '7D' | '30D' | 'TODAY'
  >('ALL');

  // Selected User Detail Drawer / Modal
  const [selectedUser, setSelectedUser] = useState<UserProfileRecord | null>(
    null,
  );
  const [editPlan, setEditPlan] = useState<UserPlan>('FREE');
  const [editSubStatus, setEditSubStatus] = useState<SubscriptionStatus>('free');
  const [editBillingCycle, setEditBillingCycle] =
    useState<BillingCycle>('none');
  const [editExpiresAt, setEditExpiresAt] = useState<string>('');
  const [savingUserEdit, setSavingUserEdit] = useState(false);

  // Filters & Create Modal: Payments
  const [paymentFilter, setPaymentFilter] = useState<
    'ALL' | 'confirmed' | 'pending' | 'refused' | 'sub_active' | 'sub_expired'
  >('ALL');
  const [paymentSearch, setPaymentSearch] = useState('');
  const [showNewPaymentForm, setShowNewPaymentForm] = useState(false);
  const [newPayUserId, setNewPayUserId] = useState('');
  const [newPayCycle, setNewPayCycle] = useState<'monthly' | 'annual'>(
    'monthly',
  );
  const [newPayAmount, setNewPayAmount] = useState('49.90');
  const [newPayStatus, setNewPayStatus] = useState<PaymentStatus>('confirmed');
  const [newPayMethod, setNewPayMethod] = useState('PIX');
  const [newPayExpiresAt, setNewPayExpiresAt] = useState('');
  const [newPayNotes, setNewPayNotes] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);
  const [updatingPaymentId, setUpdatingPaymentId] = useState<string | null>(
    null,
  );

  // Filters: Transcriptions
  const [txFilter, setTxFilter] = useState<
    'ALL' | 'completed' | 'error' | 'unresolved_error'
  >('ALL');
  const [txPlanFilter, setTxPlanFilter] = useState<'ALL' | UserPlan>('ALL');
  const [txSearch, setTxSearch] = useState('');
  const [resolvingTxId, setResolvingTxId] = useState<string | null>(null);

  // Filters: Audit
  const [auditSearch, setAuditSearch] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setSyncError(null);

    const unsub = subscribeToAdminCollections(
      (partial) => {
        if (!active) return;
        if (partial.users) setUsers(partial.users);
        if (partial.transcriptions) setTranscriptions(partial.transcriptions);
        if (partial.payments) setPayments(partial.payments);
        if (partial.proOrders) setProOrders(partial.proOrders);
        if (partial.multicaixaSettings) {
          setMulticaixaSettings(partial.multicaixaSettings);
          setCfgMulticaixaNumber(partial.multicaixaSettings.multicaixaNumber);
          setCfgWhatsappNumber(partial.multicaixaSettings.whatsappNumber);
          setCfgHolderName(partial.multicaixaSettings.holderName);
        }
        if (partial.auditLogs) setAuditLogs(partial.auditLogs);
        setLoading(false);
      },
      (err) => {
        if (!active) return;
        setSyncError(err.message);
        setLoading(false);
      },
    );

    return () => {
      active = false;
      unsub();
    };
  }, []);

  const handleManualRefresh = async () => {
    setLoading(true);
    setSyncError(null);
    try {
      const bundle = await fetchAdminDashboardOnce();
      setUsers(bundle.users);
      setTranscriptions(bundle.transcriptions);
      setPayments(bundle.payments);
      setProOrders(bundle.proOrders);
      setMulticaixaSettings(bundle.multicaixaSettings);
      setCfgMulticaixaNumber(bundle.multicaixaSettings.multicaixaNumber);
      setCfgWhatsappNumber(bundle.multicaixaSettings.whatsappNumber);
      setCfgHolderName(bundle.multicaixaSettings.holderName);
      setAuditLogs(bundle.auditLogs);
      setToast({
        type: 'success',
        message: 'Dados administrativos atualizados em tempo real.',
      });
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Aggregated per-user usage map
  const userUsageMap = useMemo(() => {
    const map = new Map<
      string,
      {
        count: number;
        completedCount: number;
        errorCount: number;
        minutes: number;
        costUsd: number;
      }
    >();
    for (const tx of transcriptions) {
      const curr = map.get(tx.userId) || {
        count: 0,
        completedCount: 0,
        errorCount: 0,
        minutes: 0,
        costUsd: 0,
      };
      curr.count += 1;
      if (tx.status === 'completed') {
        curr.completedCount += 1;
        curr.minutes += tx.minutesProcessed || 0;
      } else {
        curr.errorCount += 1;
      }
      curr.costUsd += tx.estimatedCostUsd || 0;
      map.set(tx.userId, curr);
    }
    return map;
  }, [transcriptions]);

  // Core KPI Calculations
  const metrics = useMemo(() => {
    const cutoff30d = daysAgo(30);
    const cutoff7d = daysAgo(7);

    const totalUsers = users.length;
    const activeUsers = users.filter(
      (u) => new Date(u.lastActiveAt).getTime() >= cutoff30d,
    ).length;
    const newRegistrations7d = users.filter(
      (u) => new Date(u.createdAt).getTime() >= cutoff7d,
    ).length;
    const freeUsers = users.filter((u) => u.plan === 'FREE').length;
    const proUsers = users.filter((u) => u.plan === 'PRO').length;
    const monthlySubscriptions = users.filter(
      (u) =>
        u.plan === 'PRO' &&
        u.billingCycle === 'monthly' &&
        u.subscriptionStatus === 'active',
    ).length;
    const annualSubscriptions = users.filter(
      (u) =>
        u.plan === 'PRO' &&
        u.billingCycle === 'annual' &&
        u.subscriptionStatus === 'active',
    ).length;
    const expiredSubscriptions = users.filter(
      (u) => u.subscriptionStatus === 'expired',
    ).length;

    const completedTx = transcriptions.filter((t) => t.status === 'completed');
    const errorTx = transcriptions.filter((t) => t.status === 'error');
    const totalTranscriptions = completedTx.length;
    const totalMinutesProcessed = completedTx.reduce(
      (sum, t) => sum + (t.minutesProcessed || 0),
      0,
    );
    const totalAiCostUsd = transcriptions.reduce(
      (sum, t) => sum + (t.estimatedCostUsd || 0),
      0,
    );
    const totalTokensUsed = transcriptions.reduce(
      (sum, t) => sum + (t.totalTokens || 0),
      0,
    );

    const freeTxCount = completedTx.filter((t) => t.userPlan === 'FREE').length;
    const proTxCount = completedTx.filter((t) => t.userPlan === 'PRO').length;
    const freeMinutes = completedTx
      .filter((t) => t.userPlan === 'FREE')
      .reduce((s, t) => s + (t.minutesProcessed || 0), 0);
    const proMinutes = completedTx
      .filter((t) => t.userPlan === 'PRO')
      .reduce((s, t) => s + (t.minutesProcessed || 0), 0);

    // STRICT: Revenue counts ONLY confirmed payments
    const confirmedPayments = payments.filter((p) => p.status === 'confirmed');
    const pendingPayments = payments.filter((p) => p.status === 'pending');
    const refusedPayments = payments.filter((p) => p.status === 'refused');

    const totalConfirmedRevenueBrl = confirmedPayments.reduce(
      (sum, p) => sum + (p.amountBrl || 0),
      0,
    );
    const monthlyConfirmedRevenueBrl = confirmedPayments
      .filter((p) => p.billingCycle === 'monthly')
      .reduce((sum, p) => sum + (p.amountBrl || 0), 0);
    const annualConfirmedRevenueBrl = confirmedPayments
      .filter((p) => p.billingCycle === 'annual')
      .reduce((sum, p) => sum + (p.amountBrl || 0), 0);
    const pendingAmountBrl = pendingPayments.reduce(
      (sum, p) => sum + (p.amountBrl || 0),
      0,
    );

    const activePaidSubscriptions = payments.filter(
      (p) => p.subscriptionStatus === 'active',
    ).length;
    const expiredPaidSubscriptions = payments.filter(
      (p) => p.subscriptionStatus === 'expired',
    ).length;

    return {
      totalUsers,
      activeUsers,
      newRegistrations7d,
      freeUsers,
      proUsers,
      monthlySubscriptions,
      annualSubscriptions,
      expiredSubscriptions,
      totalTranscriptions,
      errorCount: errorTx.length,
      unresolvedErrorCount: errorTx.filter((t) => !t.resolvedByAdmin).length,
      totalMinutesProcessed,
      totalAiCostUsd,
      totalTokensUsed,
      freeTxCount,
      proTxCount,
      freeMinutes,
      proMinutes,
      totalConfirmedRevenueBrl,
      monthlyConfirmedRevenueBrl,
      annualConfirmedRevenueBrl,
      confirmedCount: confirmedPayments.length,
      pendingPaymentsCount: pendingPayments.length,
      pendingAmountBrl,
      refusedPaymentsCount: refusedPayments.length,
      activePaidSubscriptions,
      expiredPaidSubscriptions,
    };
  }, [users, transcriptions, payments]);

  // Last 14 days daily transcriptions chart data
  const dailySeries = useMemo(() => {
    const days: Array<{
      key: string;
      label: string;
      completed: number;
      errors: number;
      minutes: number;
    }> = [];
    const now = new Date();
    const map = new Map<string, { completed: number; errors: number; minutes: number }>();

    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
      });
      days.push({ key, label, completed: 0, errors: 0, minutes: 0 });
      map.set(key, { completed: 0, errors: 0, minutes: 0 });
    }

    for (const tx of transcriptions) {
      const key = String(tx.createdAt || '').slice(0, 10);
      const bucket = map.get(key);
      if (!bucket) continue;
      if (tx.status === 'completed') {
        bucket.completed += 1;
        bucket.minutes += tx.minutesProcessed || 0;
      } else {
        bucket.errors += 1;
      }
    }

    return days.map((d) => {
      const bucket = map.get(d.key)!;
      return { ...d, ...bucket };
    });
  }, [transcriptions]);

  const maxDailyCount = useMemo(
    () => Math.max(1, ...dailySeries.map((d) => d.completed + d.errors)),
    [dailySeries],
  );

  // Filtered Users
  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    const nowMs = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    return users.filter((u) => {
      if (
        q &&
        !u.email.toLowerCase().includes(q) &&
        !u.uid.toLowerCase().includes(q) &&
        !u.displayName.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (userPlanFilter !== 'ALL' && u.plan !== userPlanFilter) return false;
      if (
        userStatusFilter !== 'ALL' &&
        u.subscriptionStatus !== userStatusFilter
      ) {
        return false;
      }
      if (userDateFilter !== 'ALL') {
        const createdMs = new Date(u.createdAt).getTime();
        if (userDateFilter === 'TODAY' && createdMs < startOfToday.getTime()) {
          return false;
        }
        if (
          userDateFilter === '7D' &&
          createdMs < nowMs - 7 * 24 * 60 * 60 * 1000
        ) {
          return false;
        }
        if (
          userDateFilter === '30D' &&
          createdMs < nowMs - 30 * 24 * 60 * 60 * 1000
        ) {
          return false;
        }
      }
      return true;
    });
  }, [users, userSearch, userPlanFilter, userStatusFilter, userDateFilter]);

  // Filtered Payments
  const filteredPayments = useMemo(() => {
    const q = paymentSearch.trim().toLowerCase();
    return payments.filter((p) => {
      if (
        q &&
        !p.userEmail.toLowerCase().includes(q) &&
        !p.userId.toLowerCase().includes(q) &&
        !p.id.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (paymentFilter === 'confirmed' && p.status !== 'confirmed') {
        return false;
      }
      if (paymentFilter === 'pending' && p.status !== 'pending') return false;
      if (paymentFilter === 'refused' && p.status !== 'refused') return false;
      if (
        paymentFilter === 'sub_active' &&
        p.subscriptionStatus !== 'active'
      ) {
        return false;
      }
      if (
        paymentFilter === 'sub_expired' &&
        p.subscriptionStatus !== 'expired'
      ) {
        return false;
      }
      return true;
    });
  }, [payments, paymentFilter, paymentSearch]);

  // Filtered Transcriptions
  const filteredTranscriptions = useMemo(() => {
    const q = txSearch.trim().toLowerCase();
    return transcriptions.filter((t) => {
      if (
        q &&
        !t.userEmail.toLowerCase().includes(q) &&
        !t.videoFileName.toLowerCase().includes(q) &&
        !t.userId.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (txPlanFilter !== 'ALL' && t.userPlan !== txPlanFilter) return false;
      if (txFilter === 'completed' && t.status !== 'completed') return false;
      if (txFilter === 'error' && t.status !== 'error') return false;
      if (
        txFilter === 'unresolved_error' &&
        (t.status !== 'error' || t.resolvedByAdmin)
      ) {
        return false;
      }
      return true;
    });
  }, [transcriptions, txSearch, txFilter, txPlanFilter]);

  // Top Users by Transcription Usage
  const topUsersByUsage = useMemo(() => {
    return [...users]
      .map((u) => {
        const usage = userUsageMap.get(u.uid) || {
          count: 0,
          completedCount: 0,
          errorCount: 0,
          minutes: 0,
          costUsd: 0,
        };
        return { user: u, ...usage };
      })
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count || b.minutes - a.minutes)
      .slice(0, 10);
  }, [users, userUsageMap]);

  // PRO Orders Metrics & Filtering (strictly counts ONLY APROVADO for revenue)
  const proMetrics = useMemo(() => {
    const pending = proOrders.filter((o) => o.status === 'PENDENTE');
    const approved = proOrders.filter((o) => o.status === 'APROVADO');
    const rejected = proOrders.filter((o) => o.status === 'REJEITADO');
    const confirmedRevenueKz = approved.reduce(
      (sum, o) => sum + (o.amountKz || 0),
      0,
    );
    const activeProCount = users.filter(
      (u) => u.plan === 'PRO' && u.subscriptionStatus === 'active',
    ).length;
    const expiredProCount = users.filter(
      (u) => u.subscriptionStatus === 'expired',
    ).length;

    return {
      totalCount: proOrders.length,
      pendingCount: pending.length,
      approvedCount: approved.length,
      rejectedCount: rejected.length,
      confirmedRevenueKz,
      activeProCount,
      expiredProCount,
    };
  }, [proOrders, users]);

  const filteredProOrders = useMemo(() => {
    const q = proOrderSearch.trim().toLowerCase();
    return proOrders.filter((o) => {
      if (proOrderFilter !== 'ALL' && o.status !== proOrderFilter) {
        return false;
      }
      if (
        q &&
        !o.userEmail.toLowerCase().includes(q) &&
        !o.userName.toLowerCase().includes(q) &&
        !o.userId.toLowerCase().includes(q) &&
        !o.id.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [proOrders, proOrderFilter, proOrderSearch]);

  // Filtered Audit Logs
  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (a) =>
        a.summary.toLowerCase().includes(q) ||
        (a.targetEmail || '').toLowerCase().includes(q) ||
        a.action.toLowerCase().includes(q) ||
        a.targetId.toLowerCase().includes(q),
    );
  }, [auditLogs, auditSearch]);

  const openUserDetail = (u: UserProfileRecord) => {
    setSelectedUser(u);
    setEditPlan(u.plan);
    setEditSubStatus(u.subscriptionStatus);
    setEditBillingCycle(u.billingCycle);
    setEditExpiresAt(
      u.subscriptionExpiresAt ? u.subscriptionExpiresAt.slice(0, 10) : '',
    );
  };

  const handleSaveUserPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setSavingUserEdit(true);
    setToast(null);
    try {
      await adminUpdateUserPlan({
        targetUser: selectedUser,
        plan: editPlan,
        subscriptionStatus: editPlan === 'FREE' ? 'free' : editSubStatus,
        billingCycle: editPlan === 'FREE' ? 'none' : editBillingCycle,
        subscriptionExpiresAt: editExpiresAt
          ? `${editExpiresAt}T23:59:59.000Z`
          : null,
      });
      setToast({
        type: 'success',
        message: `Plano de ${selectedUser.email} atualizado e registado na auditoria.`,
      });
      setSelectedUser(null);
    } catch (err) {
      setToast({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Erro ao atualizar plano.',
      });
    } finally {
      setSavingUserEdit(false);
    }
  };

  const handleCreatePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetUser = users.find((u) => u.uid === newPayUserId);
    if (!targetUser) {
      setToast({
        type: 'error',
        message: 'Selecione um utilizador válido para registar o pagamento.',
      });
      return;
    }
    const amountNum = Number(newPayAmount.replace(',', '.'));
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      setToast({
        type: 'error',
        message: 'Informe um valor de pagamento válido em Reais (BRL).',
      });
      return;
    }

    setSavingPayment(true);
    setToast(null);
    try {
      await adminCreatePayment({
        targetUser,
        billingCycle: newPayCycle,
        amountBrl: amountNum,
        status: newPayStatus,
        paymentMethod: newPayMethod,
        notes: newPayNotes,
        expiresAt: newPayExpiresAt ? `${newPayExpiresAt}T23:59:59.000Z` : null,
      });
      setToast({
        type: 'success',
        message: `Pagamento para ${targetUser.email} registado com auditoria.`,
      });
      setShowNewPaymentForm(false);
      setNewPayNotes('');
    } catch (err) {
      setToast({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Falha ao registar pagamento.',
      });
    } finally {
      setSavingPayment(false);
    }
  };

  const handleQuickPaymentStatus = async (
    payment: PaymentRecord,
    nextStatus: PaymentStatus,
    nextSubStatus: Exclude<SubscriptionStatus, 'free'>,
  ) => {
    setUpdatingPaymentId(payment.id);
    setToast(null);
    try {
      await adminUpdatePaymentStatus({
        payment,
        nextStatus,
        nextSubscriptionStatus: nextSubStatus,
      });
      setToast({
        type: 'success',
        message: `Pagamento de ${payment.userEmail} atualizado para "${PAYMENT_STATUS_LABELS[nextStatus]}".`,
      });
    } catch (err) {
      setToast({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Falha ao atualizar pagamento.',
      });
    } finally {
      setUpdatingPaymentId(null);
    }
  };

  const handleResolveTxError = async (log: TranscriptionLogRecord) => {
    setResolvingTxId(log.id);
    setToast(null);
    try {
      await adminMarkTranscriptionErrorResolved(log);
      setToast({
        type: 'success',
        message: `Erro em "${log.videoFileName}" marcado como analisado.`,
      });
    } catch (err) {
      setToast({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Falha ao marcar erro.',
      });
    } finally {
      setResolvingTxId(null);
    }
  };

  const handleSaveMulticaixaSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setToast(null);
    try {
      await adminSaveMulticaixaSettings({
        multicaixaNumber: cfgMulticaixaNumber,
        whatsappNumber: cfgWhatsappNumber,
        holderName: cfgHolderName,
      });
      setToast({
        type: 'success',
        message: 'Número Multicaixa Express e WhatsApp guardados com sucesso.',
      });
      setShowSettingsEditor(false);
    } catch (err) {
      setToast({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Erro ao guardar definições Multicaixa Express.',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleConfirmApproveProOrder = async () => {
    if (!approveModalOrder) return;
    setProcessingOrderId(approveModalOrder.id);
    setToast(null);
    try {
      await adminApproveProOrder(approveModalOrder);
      setToast({
        type: 'success',
        message: `Pedido ${approveModalOrder.id} aprovado! Plano ${approveModalOrder.planLabel} ativado para ${approveModalOrder.userEmail}.`,
      });
      setApproveModalOrder(null);
    } catch (err) {
      setToast({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Falha ao aprovar pedido PRO.',
      });
    } finally {
      setProcessingOrderId(null);
    }
  };

  const handleConfirmRejectProOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectModalOrder) return;
    setProcessingOrderId(rejectModalOrder.id);
    setToast(null);
    try {
      await adminRejectProOrder({
        order: rejectModalOrder,
        reason: rejectReasonInput,
      });
      setToast({
        type: 'success',
        message: `Pedido ${rejectModalOrder.id} rejeitado e registado em auditoria.`,
      });
      setRejectModalOrder(null);
      setRejectReasonInput('');
    } catch (err) {
      setToast({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Falha ao rejeitar pedido PRO.',
      });
    } finally {
      setProcessingOrderId(null);
    }
  };

  const navItems: Array<{
    id: AdminTab;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    {
      id: 'overview',
      label: 'Visão Geral',
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: 'pro_orders',
      label: 'Pedidos PRO',
      icon: <Sparkles className="w-4 h-4" />,
      badge: proMetrics.pendingCount > 0 ? proMetrics.pendingCount : undefined,
    },
    {
      id: 'users',
      label: 'Utilizadores',
      icon: <Users className="w-4 h-4" />,
      badge: metrics.totalUsers,
    },
    {
      id: 'payments',
      label: 'Pagamentos',
      icon: <CreditCard className="w-4 h-4" />,
      badge: metrics.pendingPaymentsCount > 0 ? metrics.pendingPaymentsCount : undefined,
    },
    {
      id: 'transcriptions',
      label: 'Transcrições & IA',
      icon: <Video className="w-4 h-4" />,
      badge: metrics.unresolvedErrorCount > 0 ? metrics.unresolvedErrorCount : undefined,
    },
    {
      id: 'audit',
      label: 'Auditoria & Segurança',
      icon: <ShieldCheck className="w-4 h-4" />,
    },
  ];

  const activeNavLabel =
    navItems.find((item) => item.id === activeTab)?.label || 'Visão Geral';

  const selectedUserTranscriptions = useMemo(() => {
    if (!selectedUser) return [];
    return transcriptions
      .filter((t) => t.userId === selectedUser.uid)
      .slice(0, 20);
  }, [selectedUser, transcriptions]);

  const selectedUserPayments = useMemo(() => {
    if (!selectedUser) return [];
    return payments.filter((p) => p.userId === selectedUser.uid);
  }, [selectedUser, payments]);

  return (
    <div className="min-h-screen bg-[#090B10] text-slate-100 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Sidebar Navigation */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 h-screen w-64 shrink-0 bg-[#0D1018] border-r border-white/[0.08] flex flex-col transition-transform duration-200 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="h-16 px-5 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Clapperboard className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold tracking-tight text-white truncate">
                DEWES IA
              </p>
              <p className="text-[11px] text-slate-400 truncate">
                Administração
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
            aria-label="Fechar menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                  isActive
                    ? 'bg-amber-400/15 text-amber-300 border border-amber-400/30'
                    : 'text-slate-300 hover:bg-white/[0.05] hover:text-white border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </span>
                {typeof item.badge === 'number' && (
                  <span
                    className={`font-mono-tabular px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      isActive
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-white/10 text-slate-200'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/[0.08] space-y-3">
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-3">
            <div className="flex items-center gap-2 text-emerald-300 text-[11px] font-semibold">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>Admin Principal</span>
            </div>
            <p className="mt-1 text-xs font-mono text-slate-200 truncate">
              {user.email}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-400">
              {serverVerification.hasCustomClaim
                ? 'Custom Claim + Token OK'
                : 'Token verificado no servidor'}
            </p>
          </div>

          <button
            type="button"
            onClick={onBackToStudio}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white/[0.05] hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Voltar ao Estúdio
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 h-16 bg-[#090B10]/95 backdrop-blur-sm border-b border-white/[0.08] px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10"
              aria-label="Abrir navegação"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <span>Painel Administrativo</span>
                <span>·</span>
                <span className="text-slate-100 font-semibold truncate">
                  {activeNavLabel}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141824] border border-white/10 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50 transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
              />
              <span className="hidden sm:inline">Atualizar</span>
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141824] border border-white/10 text-xs font-semibold text-slate-200 hover:bg-white/10 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </header>

        {/* Main Workspace */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto space-y-6">
          {toast && (
            <div
              className={`rounded-xl border px-4 py-3 flex items-center justify-between gap-3 text-xs ${
                toast.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
              }`}
            >
              <div className="flex items-center gap-2">
                {toast.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span>{toast.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {syncError && (
            <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-xs text-rose-200 flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span className="break-all">
                Erro de permissão ou ligação ao Firestore: {syncError}
              </span>
            </div>
          )}

          {/* ==================== 1. VISÃO GERAL ==================== */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-xl font-bold text-white">
                  Visão Geral e Estatísticas
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  Indicadores em tempo real de utilizadores, planos, consumo de IA e receita confirmada.
                </p>
              </div>

              {/* 12 Requested KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Total de Utilizadores</span>
                    <Users className="w-4 h-4 text-slate-400" />
                  </div>
                  <p className="text-2xl font-bold font-mono-tabular text-white">
                    {metrics.totalUsers}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Contas registadas no Firebase
                  </p>
                </div>

                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Utilizadores Ativos (30d)</span>
                    <Activity className="w-4 h-4 text-emerald-400" />
                  </div>
                  <p className="text-2xl font-bold font-mono-tabular text-white">
                    {metrics.activeUsers}
                  </p>
                  <p className="text-[11px] text-emerald-300">
                    {metrics.totalUsers > 0
                      ? `${Math.round((metrics.activeUsers / metrics.totalUsers) * 100)}% da base ativa`
                      : 'Sem registos'}
                  </p>
                </div>

                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Novos Registos (7d)</span>
                    <Sparkles className="w-4 h-4 text-amber-400" />
                  </div>
                  <p className="text-2xl font-bold font-mono-tabular text-white">
                    {metrics.newRegistrations7d}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Últimos 7 dias
                  </p>
                </div>

                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Receita Total Confirmada</span>
                    <DollarSign className="w-4 h-4 text-emerald-400" />
                  </div>
                  <p className="text-2xl font-bold font-mono-tabular text-emerald-300">
                    {formatBrl(metrics.totalConfirmedRevenueBrl)}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Apenas {metrics.confirmedCount} pagamento(s) confirmado(s)
                  </p>
                </div>

                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Utilizadores FREE</span>
                    <Users className="w-4 h-4 text-slate-400" />
                  </div>
                  <p className="text-2xl font-bold font-mono-tabular text-white">
                    {metrics.freeUsers}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Plano gratuito padrão
                  </p>
                </div>

                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Assinantes PRO</span>
                    <Sparkles className="w-4 h-4 text-purple-400" />
                  </div>
                  <p className="text-2xl font-bold font-mono-tabular text-purple-200">
                    {metrics.proUsers}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Contas no plano PRO
                  </p>
                </div>

                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Assinaturas Mensais</span>
                    <CreditCard className="w-4 h-4 text-sky-400" />
                  </div>
                  <p className="text-2xl font-bold font-mono-tabular text-white">
                    {metrics.monthlySubscriptions}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Receita confirmada: {formatBrl(metrics.monthlyConfirmedRevenueBrl)}
                  </p>
                </div>

                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Assinaturas Anuais</span>
                    <CreditCard className="w-4 h-4 text-purple-400" />
                  </div>
                  <p className="text-2xl font-bold font-mono-tabular text-white">
                    {metrics.annualSubscriptions}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Receita confirmada: {formatBrl(metrics.annualConfirmedRevenueBrl)}
                  </p>
                </div>

                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Transcrições Realizadas</span>
                    <Video className="w-4 h-4 text-amber-400" />
                  </div>
                  <p className="text-2xl font-bold font-mono-tabular text-white">
                    {metrics.totalTranscriptions}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {metrics.errorCount} erro(s) técnico(s) registado(s)
                  </p>
                </div>

                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Minutos Processados</span>
                    <Clock className="w-4 h-4 text-amber-400" />
                  </div>
                  <p className="text-2xl font-bold font-mono-tabular text-white">
                    {metrics.totalMinutesProcessed.toFixed(1)} min
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Custo IA est.: {formatUsd(metrics.totalAiCostUsd)}
                  </p>
                </div>

                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Pagamentos Pendentes</span>
                    <Clock className="w-4 h-4 text-amber-400" />
                  </div>
                  <p className="text-2xl font-bold font-mono-tabular text-amber-300">
                    {metrics.pendingPaymentsCount}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Total pendente: {formatBrl(metrics.pendingAmountBrl)}
                  </p>
                </div>

                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Assinaturas Expiradas</span>
                    <FileWarning className="w-4 h-4 text-rose-400" />
                  </div>
                  <p className="text-2xl font-bold font-mono-tabular text-rose-300">
                    {metrics.expiredSubscriptions}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Necessitam renovação
                  </p>
                </div>
              </div>

              {/* Visual Charts Row */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* 14-day Transcription Activity Bar Chart */}
                <div className="lg:col-span-8 rounded-2xl bg-[#10131C] border border-white/[0.08] p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-bold text-white">
                        Transcrições nos Últimos 14 Dias
                      </h2>
                      <p className="text-xs text-slate-400">
                        Volume diário de transcrições concluídas e erros técnicos
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-[11px] text-slate-300">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-amber-400" />
                        Concluídas
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />
                        Erros
                      </span>
                    </div>
                  </div>

                  <div className="h-52 flex items-end gap-2 pt-4 pb-1">
                    {dailySeries.map((day) => {
                      const total = day.completed + day.errors;
                      const completedH = Math.round(
                        (day.completed / maxDailyCount) * 140,
                      );
                      const errorH = Math.round(
                        (day.errors / maxDailyCount) * 140,
                      );
                      return (
                        <div
                          key={day.key}
                          className="flex-1 flex flex-col items-center gap-1.5 group min-w-0"
                          title={`${day.label}: ${day.completed} concluída(s), ${day.errors} erro(s), ${day.minutes.toFixed(1)} min`}
                        >
                          <span className="text-[10px] font-mono-tabular text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                            {total}
                          </span>
                          <div className="w-full max-w-[28px] h-[144px] flex flex-col justify-end gap-0.5 bg-white/[0.02] rounded-md overflow-hidden p-0.5">
                            {day.errors > 0 && (
                              <div
                                className="w-full bg-rose-500 rounded-sm transition-all"
                                style={{ height: `${Math.max(4, errorH)}px` }}
                              />
                            )}
                            {day.completed > 0 && (
                              <div
                                className="w-full bg-amber-400 rounded-sm transition-all"
                                style={{
                                  height: `${Math.max(4, completedH)}px`,
                                }}
                              />
                            )}
                          </div>
                          <span className="text-[10px] font-mono-tabular text-slate-500 truncate w-full text-center">
                            {day.label.slice(0, 5)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Plan & Revenue Breakdown */}
                <div className="lg:col-span-4 rounded-2xl bg-[#10131C] border border-white/[0.08] p-5 space-y-5">
                  <div>
                    <h2 className="text-sm font-bold text-white">
                      Distribuição de Planos e Receita
                    </h2>
                    <p className="text-xs text-slate-400">
                      Proporção atual da base e faturação confirmada
                    </p>
                  </div>

                  {/* FREE vs PRO Bar */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 font-medium">
                        FREE ({metrics.freeUsers}) vs PRO ({metrics.proUsers})
                      </span>
                      <span className="font-mono-tabular text-slate-400">
                        {metrics.totalUsers > 0
                          ? `${Math.round((metrics.proUsers / metrics.totalUsers) * 100)}% PRO`
                          : '0% PRO'}
                      </span>
                    </div>
                    <div className="h-3 rounded-full bg-white/[0.06] overflow-hidden flex">
                      <div
                        className="bg-slate-500 h-full transition-all"
                        style={{
                          width: `${
                            metrics.totalUsers > 0
                              ? (metrics.freeUsers / metrics.totalUsers) * 100
                              : 100
                          }%`,
                        }}
                      />
                      <div
                        className="bg-purple-500 h-full transition-all"
                        style={{
                          width: `${
                            metrics.totalUsers > 0
                              ? (metrics.proUsers / metrics.totalUsers) * 100
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Confirmed Revenue Breakdown */}
                  <div className="space-y-3 pt-2 border-t border-white/[0.08] text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">
                        Receita Mensal Confirmada
                      </span>
                      <span className="font-mono-tabular font-semibold text-white">
                        {formatBrl(metrics.monthlyConfirmedRevenueBrl)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">
                        Receita Anual Confirmada
                      </span>
                      <span className="font-mono-tabular font-semibold text-white">
                        {formatBrl(metrics.annualConfirmedRevenueBrl)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">
                        Pagamentos Pendentes
                      </span>
                      <span className="font-mono-tabular font-semibold text-amber-300">
                        {formatBrl(metrics.pendingAmountBrl)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">
                        Pagamentos Recusados
                      </span>
                      <span className="font-mono-tabular font-semibold text-rose-300">
                        {metrics.refusedPaymentsCount}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ==================== 1B. PEDIDOS PRO (MULTICAIXA + WHATSAPP) ==================== */}
          {activeTab === 'pro_orders' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-white">
                    Pedidos PRO · Multicaixa Express e WhatsApp
                  </h1>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Verifique o comprovativo recebido no WhatsApp e aprove ou rejeite pedidos. Apenas pedidos aprovados ativam o plano PRO e somam na receita confirmada.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSettingsEditor((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-400 text-slate-950 text-xs font-bold hover:bg-amber-300 transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  Configurar Multicaixa Express
                </button>
              </div>

              {/* Active Multicaixa Settings Summary Banner */}
              <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="space-y-1">
                  <p className="text-slate-400">
                    Número Multicaixa Express ativo
                  </p>
                  <p className="text-sm font-bold font-mono-tabular text-white">
                    {multicaixaSettings.multicaixaNumber}
                    {multicaixaSettings.holderName
                      ? ` · ${multicaixaSettings.holderName}`
                      : ''}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-slate-400">WhatsApp para comprovativos</p>
                  <p className="text-sm font-bold font-mono-tabular text-emerald-300">
                    {multicaixaSettings.whatsappNumber ||
                      multicaixaSettings.multicaixaNumber}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-slate-400">Preçário em vigor</p>
                  <p className="text-xs font-semibold text-amber-300">
                    PRO Mensal: 1.000 Kz (30d) · PRO Anual: 10.000 Kz (365d)
                  </p>
                </div>
              </div>

              {/* Multicaixa Express & WhatsApp Settings Editor */}
              {showSettingsEditor && (
                <form
                  onSubmit={handleSaveMulticaixaSettings}
                  className="rounded-2xl bg-[#10131C] border border-amber-400/35 p-5 space-y-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-bold text-white">
                      Definições Multicaixa Express &amp; WhatsApp
                    </h2>
                    <button
                      type="button"
                      onClick={() => setShowSettingsEditor(false)}
                      className="text-slate-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block text-slate-400 mb-1">
                        NUMERO_MULTICAIXA_EXPRESS *
                      </label>
                      <input
                        type="text"
                        required
                        value={cfgMulticaixaNumber}
                        onChange={(e) => setCfgMulticaixaNumber(e.target.value)}
                        placeholder="Ex.: 923 000 000"
                        className="w-full px-3 py-2 rounded-xl bg-[#090B10] border border-white/10 text-white font-mono-tabular"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">
                        Número WhatsApp (vazio = igual ao Express)
                      </label>
                      <input
                        type="text"
                        value={cfgWhatsappNumber}
                        onChange={(e) => setCfgWhatsappNumber(e.target.value)}
                        placeholder="Deixe vazio se for o mesmo número"
                        className="w-full px-3 py-2 rounded-xl bg-[#090B10] border border-white/10 text-white font-mono-tabular"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">
                        Nome do titular (opcional)
                      </label>
                      <input
                        type="text"
                        value={cfgHolderName}
                        onChange={(e) => setCfgHolderName(e.target.value)}
                        placeholder="Nome apresentado ao cliente"
                        className="w-full px-3 py-2 rounded-xl bg-[#090B10] border border-white/10 text-white"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowSettingsEditor(false)}
                      className="px-4 py-2 rounded-xl bg-white/5 text-xs font-semibold text-slate-300 hover:bg-white/10"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={savingSettings}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-400 text-slate-950 text-xs font-bold hover:bg-amber-300 disabled:opacity-50"
                    >
                      {savingSettings && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      )}
                      Guardar Configuração
                    </button>
                  </div>
                </form>
              )}

              {/* PRO Orders Summary Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4">
                  <p className="text-xs text-slate-400">Pedidos Pendentes</p>
                  <p className="mt-1 text-2xl font-bold font-mono-tabular text-amber-300">
                    {proMetrics.pendingCount}
                  </p>
                </div>
                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4">
                  <p className="text-xs text-slate-400">Pedidos Aprovados</p>
                  <p className="mt-1 text-2xl font-bold font-mono-tabular text-emerald-300">
                    {proMetrics.approvedCount}
                  </p>
                </div>
                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4">
                  <p className="text-xs text-slate-400">Pedidos Rejeitados</p>
                  <p className="mt-1 text-2xl font-bold font-mono-tabular text-rose-300">
                    {proMetrics.rejectedCount}
                  </p>
                </div>
                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4">
                  <p className="text-xs text-slate-400">
                    Receita PRO Confirmada (Kz)
                  </p>
                  <p className="mt-1 text-2xl font-bold font-mono-tabular text-emerald-300">
                    {formatKz(proMetrics.confirmedRevenueKz)}
                  </p>
                </div>
                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4">
                  <p className="text-xs text-slate-400">
                    Assinaturas PRO Ativas / Exp.
                  </p>
                  <p className="mt-1 text-2xl font-bold font-mono-tabular text-white">
                    {proMetrics.activeProCount} / {proMetrics.expiredProCount}
                  </p>
                </div>
              </div>

              {/* Filter & Search Bar */}
              <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      ['ALL', 'Todos'],
                      ['PENDENTE', 'Pendentes'],
                      ['APROVADO', 'Aprovados'],
                      ['REJEITADO', 'Rejeitados'],
                    ] as const
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setProOrderFilter(val)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        proOrderFilter === val
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-white/[0.05] text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={proOrderSearch}
                    onChange={(e) => setProOrderSearch(e.target.value)}
                    placeholder="Pesquisar e-mail, utilizador ou ID..."
                    className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[#090B10] border border-white/10 text-xs text-white"
                  />
                </div>
              </div>

              {/* Pedidos PRO Table */}
              <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-white/[0.08] bg-white/[0.02] text-slate-400">
                        <th className="py-3 px-4 font-semibold">Utilizador</th>
                        <th className="py-3 px-4 font-semibold">E-mail</th>
                        <th className="py-3 px-4 font-semibold">
                          Plano escolhido
                        </th>
                        <th className="py-3 px-4 font-semibold text-right">
                          Valor
                        </th>
                        <th className="py-3 px-4 font-semibold">
                          Data do pedido
                        </th>
                        <th className="py-3 px-4 font-semibold">
                          Identificador do pedido
                        </th>
                        <th className="py-3 px-4 font-semibold">Estado</th>
                        <th className="py-3 px-4 font-semibold text-right">
                          Ações
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {filteredProOrders.length === 0 ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="py-10 text-center text-slate-400"
                          >
                            {loading
                              ? 'A carregar pedidos PRO...'
                              : 'Nenhum pedido PRO encontrado para os filtros selecionados.'}
                          </td>
                        </tr>
                      ) : (
                        filteredProOrders.map((order) => (
                          <tr key={order.id} className="hover:bg-white/[0.02]">
                            <td className="py-3 px-4">
                              <p className="font-semibold text-white truncate max-w-[160px]">
                                {order.userName}
                              </p>
                              <p className="text-[10px] font-mono text-slate-500 truncate max-w-[160px]">
                                {order.userId}
                              </p>
                            </td>
                            <td className="py-3 px-4 text-slate-200 truncate max-w-[200px]">
                              {order.userEmail}
                            </td>
                            <td className="py-3 px-4">
                              <StatusChip
                                tone="purple"
                                label={`${order.planLabel} (${order.durationDays}d)`}
                              />
                            </td>
                            <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-amber-300 whitespace-nowrap">
                              {formatKz(order.amountKz)}
                            </td>
                            <td className="py-3 px-4 font-mono-tabular text-slate-400 whitespace-nowrap">
                              {formatDateTimePt(order.createdAt)}
                            </td>
                            <td className="py-3 px-4 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                              {order.id}
                            </td>
                            <td className="py-3 px-4">
                              <div className="space-y-1">
                                <StatusChip
                                  tone={
                                    order.status === 'APROVADO'
                                      ? 'emerald'
                                      : order.status === 'REJEITADO'
                                        ? 'rose'
                                        : 'amber'
                                  }
                                  label={order.status}
                                />
                                {order.status === 'APROVADO' &&
                                  order.activatedExpiresAt && (
                                    <p className="text-[10px] text-emerald-300/90 font-mono-tabular whitespace-nowrap">
                                      Válido até{' '}
                                      {formatDateOnlyPt(
                                        order.activatedExpiresAt,
                                      )}
                                    </p>
                                  )}
                                {order.status === 'REJEITADO' &&
                                  order.rejectionReason && (
                                    <p className="text-[10px] text-rose-300/90 max-w-[200px] truncate">
                                      {order.rejectionReason}
                                    </p>
                                  )}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              {order.status === 'PENDENTE' ? (
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    disabled={processingOrderId === order.id}
                                    onClick={() => setApproveModalOrder(order)}
                                    className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500 text-emerald-200 hover:text-slate-950 border border-emerald-500/35 text-[11px] font-bold transition-colors disabled:opacity-40"
                                  >
                                    APROVAR
                                  </button>
                                  <button
                                    type="button"
                                    disabled={processingOrderId === order.id}
                                    onClick={() => {
                                      setRejectModalOrder(order);
                                      setRejectReasonInput('');
                                    }}
                                    className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500 text-rose-200 hover:text-white border border-rose-500/35 text-[11px] font-bold transition-colors disabled:opacity-40"
                                  >
                                    REJEITAR
                                  </button>
                                </div>
                              ) : (
                                <span className="text-[11px] text-slate-400">
                                  {order.approvedBy || 'Processado'}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ==================== 2. GESTÃO DE UTILIZADORES ==================== */}
          {activeTab === 'users' && (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-bold text-white">
                  Gestão de Utilizadores
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  Pesquise por e-mail ou identificador, filtre por plano/estado/registo e consulte histórico de utilização.
                </p>
              </div>

              {/* Search & Filter Toolbar */}
              <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-5 relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Pesquisar por e-mail, UID ou nome..."
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#090B10] border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400/50"
                  />
                </div>
                <div className="md:col-span-2">
                  <select
                    value={userPlanFilter}
                    onChange={(e) =>
                      setUserPlanFilter(e.target.value as 'ALL' | UserPlan)
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#090B10] border border-white/10 text-xs text-slate-200 focus:outline-none focus:border-amber-400/50"
                  >
                    <option value="ALL">Plano: Todos</option>
                    <option value="FREE">FREE</option>
                    <option value="PRO">PRO</option>
                  </select>
                </div>
                <div className="md:col-span-3">
                  <select
                    value={userStatusFilter}
                    onChange={(e) =>
                      setUserStatusFilter(
                        e.target.value as 'ALL' | SubscriptionStatus,
                      )
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#090B10] border border-white/10 text-xs text-slate-200 focus:outline-none focus:border-amber-400/50"
                  >
                    <option value="ALL">Estado: Todos</option>
                    <option value="free">Gratuito</option>
                    <option value="active">Assinatura Ativa</option>
                    <option value="pending">Pagamento Pendente</option>
                    <option value="expired">Assinatura Expirada</option>
                    <option value="cancelled">Cancelada</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <select
                    value={userDateFilter}
                    onChange={(e) =>
                      setUserDateFilter(
                        e.target.value as 'ALL' | '7D' | '30D' | 'TODAY',
                      )
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#090B10] border border-white/10 text-xs text-slate-200 focus:outline-none focus:border-amber-400/50"
                  >
                    <option value="ALL">Registo: Todas as datas</option>
                    <option value="TODAY">Hoje</option>
                    <option value="7D">Últimos 7 dias</option>
                    <option value="30D">Últimos 30 dias</option>
                  </select>
                </div>
              </div>

              {/* Users Table */}
              <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-white/[0.08] bg-white/[0.02] text-slate-400">
                        <th className="py-3 px-4 font-semibold">Utilizador</th>
                        <th className="py-3 px-4 font-semibold">Plano</th>
                        <th className="py-3 px-4 font-semibold">Estado</th>
                        <th className="py-3 px-4 font-semibold">Ciclo</th>
                        <th className="py-3 px-4 font-semibold text-right">
                          Transcrições
                        </th>
                        <th className="py-3 px-4 font-semibold text-right">
                          Minutos
                        </th>
                        <th className="py-3 px-4 font-semibold">Registo</th>
                        <th className="py-3 px-4 font-semibold text-right">
                          Ação
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="py-10 text-center text-slate-400"
                          >
                            {loading
                              ? 'A carregar utilizadores...'
                              : 'Nenhum utilizador encontrado para os filtros atuais.'}
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((u) => {
                          const usage = userUsageMap.get(u.uid);
                          return (
                            <tr
                              key={u.uid}
                              className="hover:bg-white/[0.02] transition-colors"
                            >
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2.5">
                                  <div className="min-w-0">
                                    <div className="font-semibold text-white flex items-center gap-2">
                                      <span className="truncate max-w-[200px]">
                                        {u.displayName}
                                      </span>
                                      {u.role === 'admin' && (
                                        <StatusChip
                                          tone="amber"
                                          label="ADMIN"
                                        />
                                      )}
                                    </div>
                                    <p className="text-[11px] text-slate-300 truncate max-w-[240px]">
                                      {u.email}
                                    </p>
                                    <p className="text-[10px] font-mono text-slate-500">
                                      {u.uid} · {u.authProvider}
                                    </p>
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <StatusChip
                                  tone={u.plan === 'PRO' ? 'purple' : 'slate'}
                                  label={PLAN_LABELS[u.plan]}
                                />
                              </td>
                              <td className="py-3 px-4">
                                <StatusChip
                                  tone={
                                    u.subscriptionStatus === 'active'
                                      ? 'emerald'
                                      : u.subscriptionStatus === 'pending'
                                        ? 'amber'
                                        : u.subscriptionStatus === 'expired' ||
                                            u.subscriptionStatus === 'cancelled'
                                          ? 'rose'
                                          : 'slate'
                                  }
                                  label={
                                    SUB_STATUS_LABELS[u.subscriptionStatus]
                                  }
                                />
                              </td>
                              <td className="py-3 px-4 text-slate-300">
                                {CYCLE_LABELS[u.billingCycle]}
                              </td>
                              <td className="py-3 px-4 text-right font-mono-tabular text-white">
                                {usage?.completedCount || 0}
                              </td>
                              <td className="py-3 px-4 text-right font-mono-tabular text-slate-200">
                                {(usage?.minutes || 0).toFixed(1)}
                              </td>
                              <td className="py-3 px-4 font-mono-tabular text-slate-400 whitespace-nowrap">
                                {formatDateOnlyPt(u.createdAt)}
                              </td>
                              <td className="py-3 px-4 text-right">
                                <button
                                  type="button"
                                  onClick={() => openUserDetail(u)}
                                  className="px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-amber-400 hover:text-slate-950 text-xs font-semibold text-slate-200 transition-colors"
                                >
                                  Detalhes
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ==================== 3. PAGAMENTOS & ASSINATURAS ==================== */}
          {activeTab === 'payments' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-white">
                    Monitorização de Pagamentos e Assinaturas
                  </h1>
                  <p className="text-xs text-slate-400 mt-0.5">
                    A receita exibida contabiliza exclusivamente pagamentos efetivamente confirmados.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!newPayUserId && users.length > 0) {
                      setNewPayUserId(users[0].uid);
                    }
                    setShowNewPaymentForm((v) => !v);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-400 text-slate-950 text-xs font-bold hover:bg-amber-300 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Registar Pagamento
                </button>
              </div>

              {/* Financial Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4">
                  <p className="text-xs text-slate-400">
                    Receita Confirmada Total
                  </p>
                  <p className="mt-1 text-xl font-bold font-mono-tabular text-emerald-300">
                    {formatBrl(metrics.totalConfirmedRevenueBrl)}
                  </p>
                </div>
                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4">
                  <p className="text-xs text-slate-400">Receita Mensal</p>
                  <p className="mt-1 text-xl font-bold font-mono-tabular text-white">
                    {formatBrl(metrics.monthlyConfirmedRevenueBrl)}
                  </p>
                </div>
                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4">
                  <p className="text-xs text-slate-400">Receita Anual</p>
                  <p className="mt-1 text-xl font-bold font-mono-tabular text-white">
                    {formatBrl(metrics.annualConfirmedRevenueBrl)}
                  </p>
                </div>
                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4">
                  <p className="text-xs text-slate-400">
                    Pagamentos Pendentes
                  </p>
                  <p className="mt-1 text-xl font-bold font-mono-tabular text-amber-300">
                    {metrics.pendingPaymentsCount} ·{' '}
                    {formatBrl(metrics.pendingAmountBrl)}
                  </p>
                </div>
                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4">
                  <p className="text-xs text-slate-400">
                    Recusados / Expiradas
                  </p>
                  <p className="mt-1 text-xl font-bold font-mono-tabular text-rose-300">
                    {metrics.refusedPaymentsCount} /{' '}
                    {metrics.expiredPaidSubscriptions}
                  </p>
                </div>
              </div>

              {/* Create Payment Form */}
              {showNewPaymentForm && (
                <form
                  onSubmit={handleCreatePaymentSubmit}
                  className="rounded-2xl bg-[#10131C] border border-amber-400/30 p-5 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-white">
                      Registar Pagamento Manual / Assinatura PRO
                    </h2>
                    <button
                      type="button"
                      onClick={() => setShowNewPaymentForm(false)}
                      className="text-slate-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block text-slate-400 mb-1">
                        Utilizador
                      </label>
                      <select
                        value={newPayUserId}
                        onChange={(e) => setNewPayUserId(e.target.value)}
                        required
                        className="w-full px-3 py-2 rounded-xl bg-[#090B10] border border-white/10 text-white"
                      >
                        <option value="">Selecionar utilizador...</option>
                        {users.map((u) => (
                          <option key={u.uid} value={u.uid}>
                            {u.email} ({u.plan})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">
                        Ciclo PRO
                      </label>
                      <select
                        value={newPayCycle}
                        onChange={(e) =>
                          setNewPayCycle(e.target.value as 'monthly' | 'annual')
                        }
                        className="w-full px-3 py-2 rounded-xl bg-[#090B10] border border-white/10 text-white"
                      >
                        <option value="monthly">Mensal</option>
                        <option value="annual">Anual</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">
                        Valor (BRL)
                      </label>
                      <input
                        type="text"
                        value={newPayAmount}
                        onChange={(e) => setNewPayAmount(e.target.value)}
                        required
                        className="w-full px-3 py-2 rounded-xl bg-[#090B10] border border-white/10 text-white font-mono-tabular"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">
                        Estado do Pagamento
                      </label>
                      <select
                        value={newPayStatus}
                        onChange={(e) =>
                          setNewPayStatus(e.target.value as PaymentStatus)
                        }
                        className="w-full px-3 py-2 rounded-xl bg-[#090B10] border border-white/10 text-white"
                      >
                        <option value="confirmed">Confirmado (Ativa PRO)</option>
                        <option value="pending">Pendente</option>
                        <option value="refused">Recusado</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">
                        Método de Pagamento
                      </label>
                      <input
                        type="text"
                        value={newPayMethod}
                        onChange={(e) => setNewPayMethod(e.target.value)}
                        placeholder="PIX, Cartão, Boleto..."
                        required
                        className="w-full px-3 py-2 rounded-xl bg-[#090B10] border border-white/10 text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">
                        Vencimento da Assinatura
                      </label>
                      <input
                        type="date"
                        value={newPayExpiresAt}
                        onChange={(e) => setNewPayExpiresAt(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-[#090B10] border border-white/10 text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Observações internas
                    </label>
                    <input
                      type="text"
                      value={newPayNotes}
                      onChange={(e) => setNewPayNotes(e.target.value)}
                      placeholder="Ex.: Comprovativo PIX validado..."
                      className="w-full px-3 py-2 rounded-xl bg-[#090B10] border border-white/10 text-xs text-white"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowNewPaymentForm(false)}
                      className="px-4 py-2 rounded-xl bg-white/5 text-xs font-semibold text-slate-300 hover:bg-white/10"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={savingPayment}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-400 text-slate-950 text-xs font-bold hover:bg-amber-300 disabled:opacity-50"
                    >
                      {savingPayment && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      )}
                      Guardar Pagamento
                    </button>
                  </div>
                </form>
              )}

              {/* Payment Filters */}
              <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      ['ALL', 'Todos'],
                      ['confirmed', 'Confirmados'],
                      ['pending', 'Pendentes'],
                      ['refused', 'Recusados'],
                      ['sub_active', 'Assinaturas Ativas'],
                      ['sub_expired', 'Assinaturas Expiradas'],
                    ] as const
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setPaymentFilter(val)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        paymentFilter === val
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-white/[0.05] text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={paymentSearch}
                    onChange={(e) => setPaymentSearch(e.target.value)}
                    placeholder="Filtrar por e-mail ou ID..."
                    className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[#090B10] border border-white/10 text-xs text-white"
                  />
                </div>
              </div>

              {/* Payments Table */}
              <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-white/[0.08] bg-white/[0.02] text-slate-400">
                        <th className="py-3 px-4 font-semibold">Utilizador</th>
                        <th className="py-3 px-4 font-semibold">Ciclo / Método</th>
                        <th className="py-3 px-4 font-semibold text-right">
                          Valor
                        </th>
                        <th className="py-3 px-4 font-semibold">Pagamento</th>
                        <th className="py-3 px-4 font-semibold">Assinatura</th>
                        <th className="py-3 px-4 font-semibold">Data</th>
                        <th className="py-3 px-4 font-semibold text-right">
                          Ações
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {filteredPayments.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="py-10 text-center text-slate-400"
                          >
                            Nenhum pagamento registado para o filtro selecionado.
                          </td>
                        </tr>
                      ) : (
                        filteredPayments.map((p) => (
                          <tr key={p.id} className="hover:bg-white/[0.02]">
                            <td className="py-3 px-4">
                              <p className="font-semibold text-white">
                                {p.userEmail}
                              </p>
                              <p className="text-[10px] font-mono text-slate-500">
                                {p.id}
                              </p>
                            </td>
                            <td className="py-3 px-4 text-slate-300">
                              {CYCLE_LABELS[p.billingCycle]} · {p.paymentMethod}
                            </td>
                            <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-white">
                              {formatBrl(p.amountBrl)}
                            </td>
                            <td className="py-3 px-4">
                              <StatusChip
                                tone={
                                  p.status === 'confirmed'
                                    ? 'emerald'
                                    : p.status === 'pending'
                                      ? 'amber'
                                      : 'rose'
                                }
                                label={PAYMENT_STATUS_LABELS[p.status]}
                              />
                            </td>
                            <td className="py-3 px-4">
                              <StatusChip
                                tone={
                                  p.subscriptionStatus === 'active'
                                    ? 'emerald'
                                    : p.subscriptionStatus === 'pending'
                                      ? 'amber'
                                      : 'rose'
                                }
                                label={SUB_STATUS_LABELS[p.subscriptionStatus]}
                              />
                            </td>
                            <td className="py-3 px-4 font-mono-tabular text-slate-400 whitespace-nowrap">
                              {formatDateOnlyPt(p.createdAt)}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                {p.status !== 'confirmed' && (
                                  <button
                                    type="button"
                                    disabled={updatingPaymentId === p.id}
                                    onClick={() =>
                                      handleQuickPaymentStatus(
                                        p,
                                        'confirmed',
                                        'active',
                                      )
                                    }
                                    className="px-2 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 font-semibold disabled:opacity-40"
                                  >
                                    Confirmar
                                  </button>
                                )}
                                {p.status !== 'refused' && (
                                  <button
                                    type="button"
                                    disabled={updatingPaymentId === p.id}
                                    onClick={() =>
                                      handleQuickPaymentStatus(
                                        p,
                                        'refused',
                                        'cancelled',
                                      )
                                    }
                                    className="px-2 py-1 rounded-md bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 font-semibold disabled:opacity-40"
                                  >
                                    Recusar
                                  </button>
                                )}
                                {p.subscriptionStatus !== 'expired' && (
                                  <button
                                    type="button"
                                    disabled={updatingPaymentId === p.id}
                                    onClick={() =>
                                      handleQuickPaymentStatus(
                                        p,
                                        p.status,
                                        'expired',
                                      )
                                    }
                                    className="px-2 py-1 rounded-md bg-white/[0.06] hover:bg-white/15 text-slate-300 font-semibold disabled:opacity-40"
                                  >
                                    Expirar
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ==================== 4. TRANSCRIÇÕES & IA ==================== */}
          {activeTab === 'transcriptions' && (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-bold text-white">
                  Monitorização das Transcrições e Custos de IA
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  Acompanhe volume diário, consumo por plano FREE vs PRO, minutos processados, erros e custos estimados do Gemini.
                </p>
              </div>

              {/* AI & Usage Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4">
                  <p className="text-xs text-slate-400">
                    Transcrições Concluídas
                  </p>
                  <p className="mt-1 text-2xl font-bold font-mono-tabular text-white">
                    {metrics.totalTranscriptions}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {metrics.totalMinutesProcessed.toFixed(1)} minutos totais
                  </p>
                </div>

                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4">
                  <p className="text-xs text-slate-400">Uso Plano FREE vs PRO</p>
                  <p className="mt-1 text-lg font-bold font-mono-tabular text-white">
                    {metrics.freeTxCount} FREE · {metrics.proTxCount} PRO
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {metrics.freeMinutes.toFixed(1)} min FREE ·{' '}
                    {metrics.proMinutes.toFixed(1)} min PRO
                  </p>
                </div>

                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4">
                  <p className="text-xs text-slate-400">
                    Custo Estimado da IA
                  </p>
                  <p className="mt-1 text-2xl font-bold font-mono-tabular text-amber-300">
                    {formatUsd(metrics.totalAiCostUsd)}
                  </p>
                  <p className="text-[11px] text-slate-400 font-mono-tabular">
                    {metrics.totalTokensUsed.toLocaleString('pt-BR')} tokens
                  </p>
                </div>

                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4">
                  <p className="text-xs text-slate-400">
                    Erros de Processamento
                  </p>
                  <p className="mt-1 text-2xl font-bold font-mono-tabular text-rose-300">
                    {metrics.errorCount}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {metrics.unresolvedErrorCount} pendente(s) de revisão
                  </p>
                </div>
              </div>

              {/* Top Users by Transcriptions */}
              {topUsersByUsage.length > 0 && (
                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-5 space-y-3">
                  <h2 className="text-sm font-bold text-white">
                    Transcrições por Utilizador (Top 10)
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {topUsersByUsage.map((row) => (
                      <div
                        key={row.user.uid}
                        className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3.5 py-2.5 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-white truncate">
                            {row.user.email}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {row.user.plan} · {row.completedCount} concluída(s) ·{' '}
                            {row.errorCount} erro(s)
                          </p>
                        </div>
                        <div className="text-right font-mono-tabular shrink-0">
                          <p className="font-bold text-amber-300">
                            {row.minutes.toFixed(1)} min
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {formatUsd(row.costUsd)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Filters */}
              <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      ['ALL', 'Todas'],
                      ['completed', 'Concluídas'],
                      ['error', 'Com Erro'],
                      ['unresolved_error', 'Erros Pendentes'],
                    ] as const
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setTxFilter(val)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        txFilter === val
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-white/[0.05] text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <select
                    value={txPlanFilter}
                    onChange={(e) =>
                      setTxPlanFilter(e.target.value as 'ALL' | UserPlan)
                    }
                    className="px-3 py-1.5 rounded-lg bg-[#090B10] border border-white/10 text-xs text-slate-200"
                  >
                    <option value="ALL">Plano: Todos</option>
                    <option value="FREE">FREE</option>
                    <option value="PRO">PRO</option>
                  </select>
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={txSearch}
                    onChange={(e) => setTxSearch(e.target.value)}
                    placeholder="Pesquisar e-mail ou vídeo..."
                    className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[#090B10] border border-white/10 text-xs text-white"
                  />
                </div>
              </div>

              {/* Transcriptions Table */}
              <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-white/[0.08] bg-white/[0.02] text-slate-400">
                        <th className="py-3 px-4 font-semibold">Vídeo / Data</th>
                        <th className="py-3 px-4 font-semibold">Utilizador</th>
                        <th className="py-3 px-4 font-semibold">Plano</th>
                        <th className="py-3 px-4 font-semibold text-right">
                          Minutos
                        </th>
                        <th className="py-3 px-4 font-semibold">Modelo / Tokens</th>
                        <th className="py-3 px-4 font-semibold text-right">
                          Custo Est.
                        </th>
                        <th className="py-3 px-4 font-semibold">Estado</th>
                        <th className="py-3 px-4 font-semibold text-right">
                          Ação
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {filteredTranscriptions.length === 0 ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="py-10 text-center text-slate-400"
                          >
                            Nenhuma transcrição registada até ao momento.
                          </td>
                        </tr>
                      ) : (
                        filteredTranscriptions.map((t) => (
                          <tr key={t.id} className="hover:bg-white/[0.02]">
                            <td className="py-3 px-4">
                              <p className="font-semibold text-white truncate max-w-[210px]">
                                {t.videoFileName}
                              </p>
                              <p className="text-[10px] font-mono-tabular text-slate-400">
                                {formatDateTimePt(t.createdAt)} · {t.language}
                              </p>
                            </td>
                            <td className="py-3 px-4 text-slate-200 truncate max-w-[200px]">
                              {t.userEmail}
                            </td>
                            <td className="py-3 px-4">
                              <StatusChip
                                tone={t.userPlan === 'PRO' ? 'purple' : 'slate'}
                                label={t.userPlan}
                              />
                            </td>
                            <td className="py-3 px-4 text-right font-mono-tabular text-white">
                              {t.minutesProcessed.toFixed(2)}
                            </td>
                            <td className="py-3 px-4 font-mono-tabular text-slate-300">
                              <p className="truncate max-w-[160px]">
                                {t.modelUsed}
                              </p>
                              <p className="text-[10px] text-slate-500">
                                {t.totalTokens.toLocaleString('pt-BR')} tokens ·{' '}
                                {t.wordCount} palavras
                              </p>
                            </td>
                            <td className="py-3 px-4 text-right font-mono-tabular text-amber-300">
                              {formatUsd(t.estimatedCostUsd)}
                            </td>
                            <td className="py-3 px-4">
                              {t.status === 'completed' ? (
                                <StatusChip tone="emerald" label="Concluída" />
                              ) : (
                                <div className="space-y-1">
                                  <StatusChip
                                    tone={
                                      t.resolvedByAdmin ? 'slate' : 'rose'
                                    }
                                    label={
                                      t.resolvedByAdmin
                                        ? 'Erro analisado'
                                        : t.errorCode || 'Erro'
                                    }
                                  />
                                  {t.errorMessage && (
                                    <p className="text-[10px] text-rose-300/90 max-w-[220px] truncate">
                                      {t.errorMessage}
                                    </p>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              {t.status === 'error' && !t.resolvedByAdmin ? (
                                <button
                                  type="button"
                                  disabled={resolvingTxId === t.id}
                                  onClick={() => handleResolveTxError(t)}
                                  className="px-2.5 py-1 rounded-md bg-white/[0.06] hover:bg-emerald-500/20 hover:text-emerald-200 text-[11px] font-semibold text-slate-200 disabled:opacity-40"
                                >
                                  Marcar resolvido
                                </button>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ==================== 5. AUDITORIA & SEGURANÇA ==================== */}
          {activeTab === 'audit' && (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-bold text-white">
                  Auditoria e Proteção Administrativa
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  Registo imutável de todas as alterações administrativas e verificação criptográfica no servidor.
                </p>
              </div>

              {/* Server & Rules Security Status */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-2xl bg-[#10131C] border border-emerald-500/25 p-4 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                    <ShieldCheck className="w-4 h-4" />
                    <span>Conta Administradora Exclusiva</span>
                  </div>
                  <p className="text-xs font-mono text-white">
                    {serverVerification.email || user.email}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    UID: <span className="font-mono">{user.uid}</span>
                  </p>
                </div>

                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                    <Filter className="w-4 h-4" />
                    <span>Validação no Servidor (/api/admin/verify)</span>
                  </div>
                  <p className="text-xs text-white font-semibold">
                    {serverVerification.hasCustomClaim
                      ? 'Custom Claim admin:true + ID Token verificado'
                      : 'ID Token Firebase verificado + Firestore Security Rules'}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Nenhum outro e-mail passa pela verificação do backend.
                  </p>
                </div>

                <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-purple-300">
                    <History className="w-4 h-4" />
                    <span>Regras Anti-Escalação Ativas</span>
                  </div>
                  <p className="text-xs text-slate-200">
                    Utilizadores comuns nunca podem alterar role, plan, billingCycle ou gravar pagamentos/auditoria.
                  </p>
                </div>
              </div>

              {/* Audit Filter */}
              <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] p-4 flex items-center justify-between gap-3">
                <div className="relative w-full max-w-md">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Pesquisar ação, e-mail alvo ou resumo..."
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#090B10] border border-white/10 text-xs text-white"
                  />
                </div>
                <span className="text-xs text-slate-400 font-mono-tabular">
                  {filteredAuditLogs.length} registo(s)
                </span>
              </div>

              {/* Audit Logs Table */}
              <div className="rounded-2xl bg-[#10131C] border border-white/[0.08] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-white/[0.08] bg-white/[0.02] text-slate-400">
                        <th className="py-3 px-4 font-semibold">Data / Hora</th>
                        <th className="py-3 px-4 font-semibold">Ação</th>
                        <th className="py-3 px-4 font-semibold">Alvo</th>
                        <th className="py-3 px-4 font-semibold">Alteração</th>
                        <th className="py-3 px-4 font-semibold">Resumo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {filteredAuditLogs.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="py-10 text-center text-slate-400"
                          >
                            Nenhuma ação administrativa registada ainda.
                          </td>
                        </tr>
                      ) : (
                        filteredAuditLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-white/[0.02]">
                            <td className="py-3 px-4 font-mono-tabular text-slate-400 whitespace-nowrap">
                              {formatDateTimePt(log.createdAt)}
                            </td>
                            <td className="py-3 px-4">
                              <StatusChip
                                tone="amber"
                                label={
                                  AUDIT_ACTION_LABELS[log.action] || log.action
                                }
                              />
                            </td>
                            <td className="py-3 px-4">
                              <p className="text-white font-medium">
                                {log.targetEmail || log.targetId}
                              </p>
                              <p className="text-[10px] font-mono text-slate-500">
                                {log.targetType} · {log.targetId}
                              </p>
                            </td>
                            <td className="py-3 px-4 font-mono text-[11px] text-slate-300">
                              {log.previousValue || '—'} →{' '}
                              {log.newValue || '—'}
                            </td>
                            <td className="py-3 px-4 text-slate-200 max-w-md">
                              {log.summary}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ==================== USER DETAIL & PLAN EDIT MODAL ==================== */}
      {selectedUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#10131C] border border-white/15 shadow-2xl">
            <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between gap-3 sticky top-0 bg-[#10131C] z-10">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-white truncate">
                  {selectedUser.displayName}
                </h2>
                <p className="text-xs text-slate-400 truncate">
                  {selectedUser.email} · {selectedUser.uid}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-5 text-xs">
              {/* Usage Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl bg-[#090B10] border border-white/[0.08] p-3">
                  <p className="text-slate-400">Transcrições</p>
                  <p className="mt-1 text-lg font-bold font-mono-tabular text-white">
                    {userUsageMap.get(selectedUser.uid)?.completedCount || 0}
                  </p>
                </div>
                <div className="rounded-xl bg-[#090B10] border border-white/[0.08] p-3">
                  <p className="text-slate-400">Minutos</p>
                  <p className="mt-1 text-lg font-bold font-mono-tabular text-white">
                    {(
                      userUsageMap.get(selectedUser.uid)?.minutes || 0
                    ).toFixed(1)}
                  </p>
                </div>
                <div className="rounded-xl bg-[#090B10] border border-white/[0.08] p-3">
                  <p className="text-slate-400">Custo IA Est.</p>
                  <p className="mt-1 text-lg font-bold font-mono-tabular text-amber-300">
                    {formatUsd(
                      userUsageMap.get(selectedUser.uid)?.costUsd || 0,
                    )}
                  </p>
                </div>
                <div className="rounded-xl bg-[#090B10] border border-white/[0.08] p-3">
                  <p className="text-slate-400">Registo</p>
                  <p className="mt-1 text-sm font-bold font-mono-tabular text-white">
                    {formatDateOnlyPt(selectedUser.createdAt)}
                  </p>
                </div>
              </div>

              {/* Admin Protected Plan Editor */}
              <form
                onSubmit={handleSaveUserPlan}
                className="rounded-xl bg-[#090B10] border border-white/[0.08] p-4 space-y-3"
              >
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Gestão de Plano e Assinatura (Registado em Auditoria)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-1">Plano</label>
                    <select
                      value={editPlan}
                      onChange={(e) => {
                        const nextPlan = e.target.value as UserPlan;
                        setEditPlan(nextPlan);
                        if (nextPlan === 'FREE') {
                          setEditSubStatus('free');
                          setEditBillingCycle('none');
                        } else {
                          if (editSubStatus === 'free') {
                            setEditSubStatus('active');
                          }
                          if (editBillingCycle === 'none') {
                            setEditBillingCycle('monthly');
                          }
                        }
                      }}
                      className="w-full px-3 py-2 rounded-lg bg-[#10131C] border border-white/10 text-white"
                    >
                      <option value="FREE">FREE</option>
                      <option value="PRO">PRO</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">
                      Estado da Assinatura
                    </label>
                    <select
                      value={editPlan === 'FREE' ? 'free' : editSubStatus}
                      disabled={editPlan === 'FREE'}
                      onChange={(e) =>
                        setEditSubStatus(e.target.value as SubscriptionStatus)
                      }
                      className="w-full px-3 py-2 rounded-lg bg-[#10131C] border border-white/10 text-white disabled:opacity-50"
                    >
                      <option value="free">Gratuito</option>
                      <option value="active">Ativa</option>
                      <option value="pending">Pendente</option>
                      <option value="expired">Expirada</option>
                      <option value="cancelled">Cancelada</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">
                      Ciclo de Faturação
                    </label>
                    <select
                      value={editPlan === 'FREE' ? 'none' : editBillingCycle}
                      disabled={editPlan === 'FREE'}
                      onChange={(e) =>
                        setEditBillingCycle(e.target.value as BillingCycle)
                      }
                      className="w-full px-3 py-2 rounded-lg bg-[#10131C] border border-white/10 text-white disabled:opacity-50"
                    >
                      <option value="none">Nenhum</option>
                      <option value="monthly">Mensal</option>
                      <option value="annual">Anual</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">
                      Data de Expiração
                    </label>
                    <input
                      type="date"
                      value={editExpiresAt}
                      disabled={editPlan === 'FREE'}
                      onChange={(e) => setEditExpiresAt(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-[#10131C] border border-white/10 text-white disabled:opacity-50"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={savingUserEdit}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-400 text-slate-950 font-bold hover:bg-amber-300 disabled:opacity-50"
                  >
                    {savingUserEdit && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    )}
                    Guardar Alterações
                  </button>
                </div>
              </form>

              {/* Recent Transcriptions for this User */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Histórico Recente de Utilização (
                  {selectedUserTranscriptions.length})
                </h3>
                {selectedUserTranscriptions.length === 0 ? (
                  <p className="text-slate-400 py-2">
                    Este utilizador ainda não realizou transcrições.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {selectedUserTranscriptions.map((tx) => (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-[#090B10] border border-white/[0.06] px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-slate-200 truncate">
                            {tx.videoFileName}
                          </p>
                          <p className="text-[10px] text-slate-500 font-mono-tabular">
                            {formatDateTimePt(tx.createdAt)} ·{' '}
                            {tx.minutesProcessed.toFixed(2)} min
                          </p>
                        </div>
                        <StatusChip
                          tone={tx.status === 'completed' ? 'emerald' : 'rose'}
                          label={tx.status === 'completed' ? 'OK' : 'Erro'}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Payments History for this User */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Pagamentos Associados ({selectedUserPayments.length})
                </h3>
                {selectedUserPayments.length === 0 ? (
                  <p className="text-slate-400 py-1">
                    Sem pagamentos registados para este utilizador.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {selectedUserPayments.map((pay) => (
                      <div
                        key={pay.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-[#090B10] border border-white/[0.06] px-3 py-2"
                      >
                        <div>
                          <p className="font-mono-tabular font-semibold text-white">
                            {formatBrl(pay.amountBrl)} ·{' '}
                            {CYCLE_LABELS[pay.billingCycle]}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {formatDateOnlyPt(pay.createdAt)} ·{' '}
                            {pay.paymentMethod}
                          </p>
                        </div>
                        <StatusChip
                          tone={
                            pay.status === 'confirmed'
                              ? 'emerald'
                              : pay.status === 'pending'
                                ? 'amber'
                                : 'rose'
                          }
                          label={PAYMENT_STATUS_LABELS[pay.status]}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ==================== CONFIRM APPROVE PRO ORDER MODAL ==================== */}
      {approveModalOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl bg-[#10131C] border border-emerald-500/35 shadow-2xl p-5 space-y-4 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">
                    Confirmar aprovação de pagamento
                  </h2>
                  <p className="text-slate-400 font-mono">
                    {approveModalOrder.id}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setApproveModalOrder(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-xl bg-[#090B10] border border-white/[0.08] p-3.5 space-y-1.5">
              <p className="text-slate-300">
                Utilizador:{' '}
                <strong className="text-white">
                  {approveModalOrder.userName} ({approveModalOrder.userEmail})
                </strong>
              </p>
              <p className="text-slate-300">
                Plano:{' '}
                <strong className="text-amber-300">
                  {approveModalOrder.planLabel} ·{' '}
                  {formatKz(approveModalOrder.amountKz)}
                </strong>
              </p>
              <p className="text-slate-400">
                Ao confirmar, o plano PRO será ativado por{' '}
                {approveModalOrder.durationDays} dias (ou somado ao prazo atual se
                estiver ativo) em nome de {user.email}.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setApproveModalOrder(null)}
                disabled={processingOrderId === approveModalOrder.id}
                className="px-4 py-2 rounded-xl bg-white/5 text-slate-300 font-semibold hover:bg-white/10"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmApproveProOrder}
                disabled={processingOrderId === approveModalOrder.id}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 disabled:opacity-50"
              >
                {processingOrderId === approveModalOrder.id && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                Confirmar e Ativar PRO
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== REJECT PRO ORDER MODAL ==================== */}
      {rejectModalOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleConfirmRejectProOrder}
            className="w-full max-w-md rounded-2xl bg-[#10131C] border border-rose-500/35 shadow-2xl p-5 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0">
                  <XCircle className="w-5 h-5 text-rose-400" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">
                    Rejeitar pedido PRO
                  </h2>
                  <p className="text-slate-400 font-mono">
                    {rejectModalOrder.id} · {rejectModalOrder.userEmail}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRejectModalOrder(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1.5">
                Motivo da rejeição *
              </label>
              <textarea
                rows={3}
                required
                minLength={3}
                value={rejectReasonInput}
                onChange={(e) => setRejectReasonInput(e.target.value)}
                placeholder="Ex.: Comprovativo ilegível ou transferência não localizada no Multicaixa Express."
                className="w-full px-3 py-2 rounded-xl bg-[#090B10] border border-white/10 text-white focus:outline-none focus:border-rose-400/60"
              />
              <p className="mt-1 text-[11px] text-slate-400">
                O utilizador permanecerá no plano FREE (caso não tenha outro PRO
                ativo) e poderá ver este motivo.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectModalOrder(null)}
                disabled={processingOrderId === rejectModalOrder.id}
                className="px-4 py-2 rounded-xl bg-white/5 text-slate-300 font-semibold hover:bg-white/10"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={processingOrderId === rejectModalOrder.id}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-500 text-white font-bold hover:bg-rose-400 disabled:opacity-50"
              >
                {processingOrderId === rejectModalOrder.id && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                Rejeitar Pedido
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
