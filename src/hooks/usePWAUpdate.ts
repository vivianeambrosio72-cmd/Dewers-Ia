import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export function usePWAUpdate() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const updateFnRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(
    null,
  );

  useEffect(() => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onRegisterError(error) {
        console.warn('Erro ao registrar Service Worker:', error);
      },
    });
    updateFnRef.current = updateSW;
  }, []);

  const applyUpdate = async () => {
    if (updateFnRef.current) {
      await updateFnRef.current(true);
    } else {
      window.location.reload();
    }
  };

  const dismissUpdate = () => {
    setNeedRefresh(false);
  };

  return { needRefresh, applyUpdate, dismissUpdate };
}
