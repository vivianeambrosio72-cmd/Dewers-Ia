import React, { useState } from 'react';
import { Download, RefreshCw, Share, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { usePWAUpdate } from '../hooks/usePWAUpdate';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSTip, setShowIOSTip] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="pwa-touch-btn inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#181C27] border border-purple-500/40 text-xs font-semibold text-purple-200 hover:bg-purple-500/20 hover:border-purple-400 transition-colors whitespace-nowrap shrink-0 min-h-[44px] sm:min-h-[36px]"
      >
        <Download className="w-3.5 h-3.5 text-purple-300" />
        <span>Instalar app</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowIOSTip((v) => !v)}
          className="pwa-touch-btn inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#181C27] border border-purple-500/40 text-xs font-semibold text-purple-200 hover:bg-purple-500/20 transition-colors whitespace-nowrap shrink-0 min-h-[44px] sm:min-h-[36px]"
        >
          <Share className="w-3.5 h-3.5 text-purple-300" />
          <span>Instalar app</span>
        </button>

        {showIOSTip && (
          <div className="fixed inset-x-4 bottom-5 sm:inset-x-auto sm:right-6 sm:top-16 sm:bottom-auto z-50 max-w-xs rounded-xl bg-[#141724] border border-purple-500/40 p-3.5 shadow-2xl text-xs text-slate-200">
            <div className="flex items-start justify-between gap-2">
              <p className="leading-relaxed">
                Toque em <strong>Compartilhar</strong> e depois em{' '}
                <strong>Adicionar à Tela de Início</strong>.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSTip(false)}
                aria-label="Fechar dica de instalação"
                className="p-1 text-slate-400 hover:text-white shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}

export function OfflineBanner() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 right-4 sm:right-auto z-50 max-w-md rounded-xl bg-[#181C27]/95 backdrop-blur-sm border border-amber-400/40 px-4 py-2.5 text-xs text-amber-100 shadow-2xl flex items-center gap-2.5"
    >
      <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
      <span>
        Sem internet. Gerar legendas precisa de conexão. Suas edições salvas continuam disponíveis.
      </span>
    </div>
  );
}

export function PWAUpdateBanner() {
  const { needRefresh, applyUpdate, dismissUpdate } = usePWAUpdate();

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 left-4 sm:left-auto z-50 max-w-sm rounded-xl bg-[#141724] border border-purple-500/50 px-4 py-3 text-xs text-slate-100 shadow-2xl flex items-center justify-between gap-3"
    >
      <span className="font-medium">Nova versão disponível</span>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={applyUpdate}
          className="pwa-touch-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-500 transition-colors min-h-[44px] sm:min-h-[34px]"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Atualizar
        </button>
        <button
          type="button"
          onClick={dismissUpdate}
          aria-label="Dispensar atualização"
          className="p-1.5 text-slate-400 hover:text-white"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
