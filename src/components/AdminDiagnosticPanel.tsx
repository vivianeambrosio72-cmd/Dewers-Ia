import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Globe,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import {
  clearLastFirebaseError,
  firebaseRuntimeConfig,
  getLastFirebaseError,
  type LastFirebaseErrorRecord,
} from '../firebase';

interface AdminDiagnosticPanelProps {
  open: boolean;
  onClose: () => void;
  adminEmail: string | null | undefined;
}

export function AdminDiagnosticPanel({
  open,
  onClose,
  adminEmail,
}: AdminDiagnosticPanelProps) {
  const [lastError, setLastError] = useState<LastFirebaseErrorRecord | null>(
    null,
  );
  const [copiedField, setCopiedField] = useState<'domain' | 'code' | null>(
    null,
  );

  const currentDomain =
    typeof window !== 'undefined' ? window.location.hostname : '';
  const currentOrigin =
    typeof window !== 'undefined' ? window.location.origin : '';

  const providersConsoleUrl = `https://console.firebase.google.com/project/${firebaseRuntimeConfig.projectId}/authentication/providers`;
  const settingsConsoleUrl = `https://console.firebase.google.com/project/${firebaseRuntimeConfig.projectId}/authentication/settings`;

  const refreshErrorRecord = () => {
    setLastError(getLastFirebaseError());
  };

  useEffect(() => {
    if (open) {
      refreshErrorRecord();
    }
  }, [open]);

  if (!open) return null;

  const copyText = async (value: string, field: 'domain' | 'code') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 1800);
    } catch {
      // ignore clipboard unavailability
    }
  };

  const isProviderDisabledError =
    lastError?.code === 'auth/operation-not-allowed' ||
    Boolean(lastError?.message?.includes('operation-not-allowed'));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-diag-title"
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-[#11141E] border border-purple-500/30 shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3 bg-[#151927]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-500/15 border border-purple-400/30 flex items-center justify-center">
              <Terminal className="w-4 h-4 text-purple-300" />
            </div>
            <div>
              <h2
                id="admin-diag-title"
                className="text-sm font-bold text-white"
              >
                Painel de Diagnóstico (Modo Desenvolvedor)
              </h2>
              <p className="text-[11px] text-slate-400">
                Visível apenas para a conta admin via Google
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar diagnóstico"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {/* Admin Identity Confirmation */}
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-3.5 py-2.5 flex items-center gap-2.5 text-emerald-200">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <span className="font-semibold">Admin autenticado via Google:</span>{' '}
              <span className="font-mono break-all">{adminEmail}</span>
            </div>
          </div>

          {/* Current App Domain */}
          <div className="rounded-xl bg-[#0B0D14] border border-white/10 p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-purple-400" />
                Domínio atual do app
              </span>
              <button
                type="button"
                onClick={() => copyText(currentDomain, 'domain')}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[11px] text-purple-200 transition-colors"
              >
                {copiedField === 'domain' ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    Copiar domínio
                  </>
                )}
              </button>
            </div>
            <div className="font-mono text-xs text-white bg-black/40 border border-white/10 rounded-lg px-3 py-2 break-all">
              {currentDomain || '(desconhecido)'}
            </div>
            <p className="text-[11px] text-slate-400">
              Origem completa: <span className="font-mono text-slate-300">{currentOrigin}</span>
            </p>
            <p className="text-[11px] text-slate-500">
              Projeto Firebase:{' '}
              <span className="font-mono text-slate-300">
                {firebaseRuntimeConfig.projectId}
              </span>{' '}
              • authDomain:{' '}
              <span className="font-mono text-slate-300">
                {firebaseRuntimeConfig.authDomain}
              </span>
            </p>
          </div>

          {/* Firebase Console Quick Links & Email/Password Auth Guide */}
          <div
            className={`rounded-xl border p-3.5 space-y-2.5 ${
              isProviderDisabledError
                ? 'bg-amber-500/10 border-amber-500/35'
                : 'bg-[#0B0D14] border-white/10'
            }`}
          >
            <div className="flex items-center gap-2 font-semibold text-amber-200">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Ativação do Login por E-mail/Senha no Firebase</span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              O provedor <strong>E-mail/senha</strong> é gratuito no plano Spark (sem precisar de cartão/Blaze). Se aparecer{' '}
              <span className="font-mono text-amber-200">auth/operation-not-allowed</span>, ative-o no Firebase Console do projeto{' '}
              <span className="font-mono text-white">{firebaseRuntimeConfig.projectId}</span>:
            </p>
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-300">
              <li>
                Abra <strong>Sign-in method</strong> → <strong>Adicionar novo provedor</strong> → selecione{' '}
                <strong>E-mail/senha</strong>, ative a primeira chave e clique em <strong>Salvar</strong>.
              </li>
              <li>
                Em <strong>Configurações → Domínios autorizados</strong>, confirme que o domínio acima está listado.
              </li>
            </ol>
            <div className="flex flex-wrap gap-2 pt-1">
              <a
                href={providersConsoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-purple-600/80 hover:bg-purple-500 text-white text-[11px] font-medium transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Ativar E-mail/senha
              </a>
              <a
                href={settingsConsoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-200 text-[11px] font-medium transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Domínios autorizados
              </a>
            </div>
          </div>

          {/* Last Firebase Error Code */}
          <div className="rounded-xl bg-[#0B0D14] border border-white/10 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-200">
                Último código de erro do Firebase
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={refreshErrorRecord}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[11px] text-slate-300 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  Atualizar
                </button>
                {lastError && (
                  <button
                    type="button"
                    onClick={() => {
                      clearLastFirebaseError();
                      setLastError(null);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-rose-500/10 hover:bg-rose-500/20 text-[11px] text-rose-300 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    Limpar
                  </button>
                )}
              </div>
            </div>

            {lastError ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 bg-rose-500/10 border border-rose-500/25 rounded-lg px-3 py-2">
                  <span className="font-mono font-bold text-rose-200">
                    {lastError.code}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyText(lastError.code, 'code')}
                    className="inline-flex items-center gap-1 text-[11px] text-rose-200 hover:text-white"
                  >
                    {copiedField === 'code' ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    Copiar
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 break-words">
                  <strong className="text-slate-300">Detalhe:</strong>{' '}
                  {lastError.message}
                </p>
                <p className="text-[10px] text-slate-500 font-mono">
                  Ação: {lastError.action} •{' '}
                  {new Date(lastError.timestamp).toLocaleString('pt-BR')}
                </p>
              </div>
            ) : (
              <div className="rounded-lg bg-white/[0.03] border border-white/10 px-3 py-2.5 text-slate-400">
                Nenhum erro recente do Firebase registrado neste navegador.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
