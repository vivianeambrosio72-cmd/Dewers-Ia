import React, { useEffect, useMemo, useState } from 'react';
import { type User } from 'firebase/auth';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  MessageCircle,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react';
import {
  createProOrder,
  makeSafeOrderId,
} from '../services/adminFirestoreService';
import {
  DEFAULT_MULTICAIXA_PLACEHOLDER,
  PRO_PLAN_CATALOG,
  type MulticaixaSettingsRecord,
  type ProOrderRecord,
  type UserProfileRecord,
} from '../types';

interface ProUpgradeModalProps {
  open: boolean;
  onClose: () => void;
  user: User;
  userProfile: UserProfileRecord | null;
  multicaixaSettings: MulticaixaSettingsRecord;
  userOrders: ProOrderRecord[];
  limitMessage?: string | null;
}

function sanitizeWaDigits(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 9 && digits.startsWith('9')) {
    return `244${digits}`;
  }
  return digits;
}

function buildWhatsAppMessage(params: {
  email: string;
  uid: string;
  planLabel: string;
  priceFormatted: string;
  orderId: string;
}): string {
  return [
    'Olá! Segue o comprovativo de pagamento Multicaixa Express para ativação do plano PRO na DEWES IA:',
    '',
    `• E-mail do utilizador: ${params.email}`,
    `• Identificador da conta (UID): ${params.uid}`,
    `• Plano escolhido: ${params.planLabel}`,
    `• Valor a pagar: ${params.priceFormatted}`,
    `• Identificador do pedido: ${params.orderId}`,
    '',
    'Vou anexar a imagem ou PDF do comprovativo abaixo.',
  ].join('\n');
}

function buildWhatsAppHref(
  waDigits: string,
  params: {
    email: string;
    uid: string;
    planLabel: string;
    priceFormatted: string;
    orderId: string;
  },
): string {
  const msg = buildWhatsAppMessage(params);
  return `https://wa.me/${waDigits}?text=${encodeURIComponent(msg)}`;
}

function formatDatePt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
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

export function ProUpgradeModal({
  open,
  onClose,
  user,
  userProfile,
  multicaixaSettings,
  userOrders,
  limitMessage,
}: ProUpgradeModalProps) {
  const [selectedCycle, setSelectedCycle] = useState<'monthly' | 'annual' | null>(
    null,
  );
  const [draftOrderId, setDraftOrderId] = useState<string>(() =>
    makeSafeOrderId('PED'),
  );
  const [copiedNumber, setCopiedNumber] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);
  const [submittingOrderId, setSubmittingOrderId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    setFeedback(null);
    setSelectedCycle(null);
    setDraftOrderId(makeSafeOrderId('PED'));
  }, [open]);

  const rawDestination =
    multicaixaSettings.whatsappNumber.trim() ||
    multicaixaSettings.multicaixaNumber.trim();
  const waDigits = useMemo(
    () => sanitizeWaDigits(rawDestination),
    [rawDestination],
  );
  const isNumberConfigured =
    multicaixaSettings.multicaixaNumber.trim() !== '' &&
    multicaixaSettings.multicaixaNumber.trim() !== DEFAULT_MULTICAIXA_PLACEHOLDER &&
    waDigits.length >= 8;

  const selectedPlan = selectedCycle ? PRO_PLAN_CATALOG[selectedCycle] : null;
  const userEmail = user.email || userProfile?.email || '';

  const activeProExpiry = useMemo(() => {
    if (
      userProfile?.plan === 'PRO' &&
      userProfile?.subscriptionStatus === 'active'
    ) {
      return userProfile.subscriptionExpiresAt || null;
    }
    return null;
  }, [userProfile]);

  const isProActive = Boolean(
    userProfile?.plan === 'PRO' && userProfile?.subscriptionStatus === 'active',
  );

  const waHref = useMemo(() => {
    if (!selectedPlan || !isNumberConfigured || !userEmail) return '#';
    return buildWhatsAppHref(waDigits, {
      email: userEmail,
      uid: user.uid,
      planLabel: selectedPlan.planLabel,
      priceFormatted: selectedPlan.priceFormatted,
      orderId: draftOrderId,
    });
  }, [selectedPlan, isNumberConfigured, userEmail, waDigits, user.uid, draftOrderId]);

  if (!open) return null;

  const handleSelectPlan = (cycle: 'monthly' | 'annual') => {
    setFeedback(null);
    if (selectedCycle !== cycle) {
      setSelectedCycle(cycle);
      setDraftOrderId(makeSafeOrderId('PED'));
    }
  };

  const handleCopyMulticaixaNumber = async () => {
    try {
      await navigator.clipboard.writeText(multicaixaSettings.multicaixaNumber);
      setCopiedNumber(true);
      setTimeout(() => setCopiedNumber(false), 2000);
    } catch {
      // ignore clipboard errors cleanly
    }
  };

  const handleWhatsAppClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!selectedPlan) {
      e.preventDefault();
      setFeedback({
        type: 'error',
        message: 'Selecione primeiro o plano PRO Mensal ou PRO Anual.',
      });
      return;
    }
    if (!isNumberConfigured) {
      e.preventDefault();
      setFeedback({
        type: 'error',
        message:
          'O número Multicaixa Express / WhatsApp ainda não foi configurado pelo administrador.',
      });
      return;
    }
    if (!userEmail) {
      e.preventDefault();
      setFeedback({
        type: 'error',
        message: 'A sua conta precisa de ter um e-mail associado para registar o pedido.',
      });
      return;
    }

    const orderIdToSave = draftOrderId;
    const cycleToSave = selectedPlan.billingCycle;

    if (submittingOrderId === orderIdToSave) {
      e.preventDefault();
      return;
    }

    setSubmittingOrderId(orderIdToSave);
    setFeedback({
      type: 'info',
      message: `Pedido ${orderIdToSave} registado como PENDENTE. Envie o comprovativo (imagem ou PDF) no WhatsApp. O plano PRO será ativado assim que o administrador confirmar a receção do valor.`,
    });

    // Rotate draft ID immediately so clicking again later never collides with the same document ID
    setDraftOrderId(makeSafeOrderId('PED'));
    setSelectedCycle(null);

    void createProOrder({
      orderId: orderIdToSave,
      user,
      billingCycle: cycleToSave,
    })
      .catch((err) => {
        const raw = err instanceof Error ? err.message : String(err);
        let friendly = 'Não foi possível registar o pedido no servidor. Tente novamente.';
        if (raw && !raw.trim().startsWith('{')) {
          friendly = raw;
        } else if (/permission/i.test(raw)) {
          friendly =
            'Permissão recusada ao registar pedido. Confirme se iniciou sessão com e-mail verificado e tente novamente.';
        }
        setFeedback({
          type: 'error',
          message: friendly,
        });
      })
      .finally(() => {
        setSubmittingOrderId(null);
      });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pro-upgrade-title"
    >
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-[#10131C] border border-white/15 shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[#10131C]/95 backdrop-blur-sm px-5 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-amber-300" />
            </div>
            <div className="min-w-0">
              <h2
                id="pro-upgrade-title"
                className="text-base font-bold text-white truncate"
              >
                Plano PRO · Multicaixa Express
              </h2>
              <p className="text-xs text-slate-400 truncate">
                Ativação simples e rápida com envio do comprovativo pelo WhatsApp
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela PRO"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Current Account Plan Banner */}
          <div
            className={`rounded-xl border px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs ${
              isProActive
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                : 'bg-[#090B10] border-white/[0.08] text-slate-300'
            }`}
          >
            <div className="min-w-0">
              <p className="font-semibold text-white">
                Estado da sua conta:{' '}
                <span
                  className={
                    isProActive ? 'text-emerald-300' : 'text-amber-300'
                  }
                >
                  {isProActive ? 'PRO Ativo' : 'FREE (máx. 2 vídeos)'}
                </span>
              </p>
              <p className="text-[11px] text-slate-400 truncate mt-0.5">
                {userEmail} · UID {user.uid}
              </p>
            </div>
            {isProActive && activeProExpiry && (
              <span className="font-mono-tabular px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-semibold text-emerald-200">
                Válido até {formatDatePt(activeProExpiry)}
              </span>
            )}
          </div>

          {limitMessage && !isProActive && (
            <div
              role="alert"
              className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 flex items-start gap-2.5 text-xs text-amber-100 leading-relaxed"
            >
              <AlertCircle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
              <span>{limitMessage}</span>
            </div>
          )}

          {/* Feedback Message */}
          {feedback && (
            <div
              role="alert"
              className={`rounded-xl border px-4 py-3 flex items-start gap-2.5 text-xs leading-relaxed ${
                feedback.type === 'error'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                  : feedback.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                    : 'bg-sky-500/10 border-sky-500/30 text-sky-200'
              }`}
            >
              {feedback.type === 'error' ? (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          {/* Step 1: Choose Plan */}
          <div className="space-y-2.5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              1. Escolha o seu plano PRO
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(['monthly', 'annual'] as const).map((cycle) => {
                const plan = PRO_PLAN_CATALOG[cycle];
                const isSelected = selectedCycle === cycle;
                return (
                  <button
                    key={cycle}
                    type="button"
                    onClick={() => handleSelectPlan(cycle)}
                    className={`text-left rounded-2xl border p-4 transition-all ${
                      isSelected
                        ? 'bg-amber-400/10 border-amber-400 shadow-lg shadow-amber-500/10'
                        : 'bg-[#090B10] border-white/10 hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-white">
                        {plan.planLabel}
                      </span>
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${
                          isSelected
                            ? 'bg-amber-400 text-slate-950 border-amber-300'
                            : 'bg-white/5 text-slate-300 border-white/10'
                        }`}
                      >
                        {plan.durationLabel}
                      </span>
                    </div>
                    <p className="mt-2 text-2xl font-bold font-mono-tabular text-amber-300">
                      {plan.priceFormatted}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {plan.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2 & 3: Payment Info + Large WhatsApp Button */}
          {!selectedPlan ? (
            <div className="rounded-xl bg-[#090B10] border border-dashed border-white/15 px-4 py-5 text-center text-xs text-slate-400">
              Selecione <strong className="text-slate-200">PRO Mensal (1.000 Kz)</strong> ou{' '}
              <strong className="text-slate-200">PRO Anual (10.000 Kz)</strong> para ver os dados do Multicaixa Express e enviar o comprovativo.
            </div>
          ) : (
            <div className="rounded-2xl bg-[#090B10] border border-white/10 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.08]">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-300">
                    2. Dados para transferência Multicaixa Express
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Transfira exatamente{' '}
                    <strong className="text-white">
                      {selectedPlan.priceFormatted}
                    </strong>{' '}
                    e envie o comprovativo (imagem ou PDF) no botão abaixo.
                  </p>
                </div>
                <span className="font-mono-tabular text-[11px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-200">
                  Pedido: {draftOrderId}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl bg-[#10131C] border border-white/[0.08] p-3">
                  <p className="text-slate-400">Número Multicaixa Express</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-base font-bold font-mono-tabular text-white truncate">
                      {multicaixaSettings.multicaixaNumber}
                    </span>
                    {isNumberConfigured && (
                      <button
                        type="button"
                        onClick={handleCopyMulticaixaNumber}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[11px] font-semibold text-slate-200 shrink-0"
                      >
                        {copiedNumber ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            Copiado
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copiar
                          </>
                        )}
                      </button>
                    )}
                  </div>
                  {multicaixaSettings.holderName && (
                    <p className="mt-1 text-[11px] text-slate-400 truncate">
                      Titular: {multicaixaSettings.holderName}
                    </p>
                  )}
                </div>

                <div className="rounded-xl bg-[#10131C] border border-white/[0.08] p-3">
                  <p className="text-slate-400">Plano e valor exato</p>
                  <p className="mt-1 text-base font-bold font-mono-tabular text-amber-300">
                    {selectedPlan.planLabel} · {selectedPlan.priceFormatted}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Validade após aprovação: {selectedPlan.durationLabel}
                  </p>
                </div>
              </div>

              {!isNumberConfigured && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3.5 py-2.5 text-xs text-amber-200">
                  O administrador ainda não definiu o número de Multicaixa Express e WhatsApp nas definições de{' '}
                  <span className="font-mono">/admin → Pedidos PRO</span>.
                </div>
              )}

              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleWhatsAppClick}
                aria-disabled={!isNumberConfigured}
                className={`w-full flex items-center justify-center gap-2.5 px-5 py-4 rounded-xl text-sm font-bold transition-colors ${
                  isNumberConfigured
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20'
                    : 'bg-white/10 text-slate-400 cursor-not-allowed'
                }`}
              >
                <MessageCircle className="w-5 h-5 shrink-0" />
                <span>Enviar comprovativo pelo WhatsApp</span>
              </a>

              <p className="text-[11px] text-slate-400 text-center leading-relaxed">
                Ao clicar, o pedido fica registado como{' '}
                <strong className="text-slate-200">PENDENTE</strong> e abre o WhatsApp com os seus dados preenchidos. O plano PRO só é ativado após confirmação do pagamento pelo administrador.
              </p>
            </div>
          )}

          {/* User's Order History */}
          {userOrders.length > 0 && (
            <div className="space-y-2.5 pt-1">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Os seus pedidos PRO ({userOrders.length})
              </p>
              <div className="space-y-2">
                {userOrders.slice(0, 6).map((order) => {
                  const canReopenWa =
                    order.status === 'PENDENTE' && isNumberConfigured && userEmail;
                  const reopenHref = canReopenWa
                    ? buildWhatsAppHref(waDigits, {
                        email: order.userEmail || userEmail,
                        uid: order.userId,
                        planLabel: order.planLabel,
                        priceFormatted:
                          order.billingCycle === 'annual'
                            ? '10.000 Kz'
                            : '1.000 Kz',
                        orderId: order.id,
                      })
                    : '#';

                  return (
                    <div
                      key={order.id}
                      className="rounded-xl bg-[#090B10] border border-white/[0.08] p-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-white">
                            {order.planLabel}
                          </span>
                          <span className="font-mono-tabular text-amber-300 font-semibold">
                            {order.amountKz.toLocaleString('pt-PT')} Kz
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold ${
                              order.status === 'APROVADO'
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : order.status === 'REJEITADO'
                                  ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                                  : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                            }`}
                          >
                            {order.status === 'APROVADO' ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : order.status === 'REJEITADO' ? (
                              <XCircle className="w-3 h-3" />
                            ) : (
                              <Clock className="w-3 h-3" />
                            )}
                            {order.status}
                          </span>
                        </div>
                        <p className="text-[11px] font-mono text-slate-400">
                          {order.id} · {formatDateTimePt(order.createdAt)}
                        </p>
                        {order.status === 'APROVADO' &&
                          order.activatedExpiresAt && (
                            <p className="text-[11px] text-emerald-300">
                              Ativo até {formatDatePt(order.activatedExpiresAt)}
                            </p>
                          )}
                        {order.status === 'REJEITADO' && order.rejectionReason && (
                          <p className="text-[11px] text-rose-300">
                            Motivo: {order.rejectionReason}
                          </p>
                        )}
                      </div>

                      {canReopenWa && (
                        <a
                          href={reopenHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-[11px] font-semibold text-emerald-200 transition-colors shrink-0"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          Reabrir WhatsApp
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
