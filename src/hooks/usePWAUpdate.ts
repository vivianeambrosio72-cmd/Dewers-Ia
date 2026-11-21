import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export function usePWAUpdate() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const updateFnRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(
    null,
  );
  const applyingRef = useRef(false);

  useEffect(() => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        if (!applyingRef.current) {
          setNeedRefresh(true);
        }
      },
      onRegisterError(error) {
        console.warn('Erro ao registrar Service Worker:', error);
      },
    });
    updateFnRef.current = updateSW;
  }, []);

  const applyUpdate = async () => {
    if (applyingRef.current) return;
    applyingRef.current = true;
    // Hide the update banner and button immediately on click
    setNeedRefresh(false);

    let reloaded = false;
    const triggerReload = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };

    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('controllerchange', triggerReload, {
          once: true,
        });

        const reg = await navigator.serviceWorker.getRegistration();
        if (reg?.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }

      if (updateFnRef.current) {
        await updateFnRef.current(true);
      }
    } catch {
      // fallback to reload below
    }

    // Guarantee reload even if controllerchange doesn't fire in this browser/iframe
    window.setTimeout(triggerReload, 350);
  };

  const dismissUpdate = () => {
    setNeedRefresh(false);
  };

  return { needRefresh, applyUpdate, dismissUpdate };
}
