import { useState, useEffect, useCallback, useRef } from 'react';

export const useWakeLock = () => {
    const [isSupported, setIsSupported] = useState(false);
    const [isLocked, setIsLocked] = useState(false);
    const wakeLockRef = useRef(null);
    // Auditoria PWA (2026-08-03, B3): guarda a mesma função pra poder tirá-la do
    // WakeLockSentinel antes de soltar a referência — sem isso o listener 'release'
    // ficava preso no objeto antigo (o browser só o libera de fato quando não sobra
    // mais nenhuma referência a ele, inclusive a do próprio listener).
    const releaseHandlerRef = useRef(null);
    const [intentToLock, setIntentToLock] = useState(false);

    useEffect(() => {
        setIsSupported('wakeLock' in navigator);
    }, []);

    // Implementação real (chama a Wake Lock API) — nomes próprios pra não colidir
    // com requestLock/releaseLock públicos (abaixo), que são o toggle de intenção.
    const acquireWakeLock = useCallback(async () => {
        if (!isSupported) {
            console.warn('Wake Lock API not supported. Fallback required if playing silent video.');
            return;
        }

        try {
            if (wakeLockRef.current) return;
            wakeLockRef.current = await navigator.wakeLock.request('screen');
            setIsLocked(true);

            releaseHandlerRef.current = () => {
                wakeLockRef.current = null;
                releaseHandlerRef.current = null;
                setIsLocked(false);
            };
            wakeLockRef.current.addEventListener('release', releaseHandlerRef.current);
            console.log('Wake Lock is active');
        } catch (err) {
            console.error('Failed to request wake lock:', err);
        }
    }, [isSupported]);

    const releaseWakeLock = useCallback(async () => {
        if (wakeLockRef.current) {
            if (releaseHandlerRef.current) {
                wakeLockRef.current.removeEventListener('release', releaseHandlerRef.current);
                releaseHandlerRef.current = null;
            }
            await wakeLockRef.current.release();
            wakeLockRef.current = null;
            setIsLocked(false);
        }
    }, []);

    useEffect(() => {
        if (intentToLock && document.visibilityState === 'visible') {
            acquireWakeLock();
        } else if (!intentToLock) {
            releaseWakeLock();
        }
    }, [intentToLock, acquireWakeLock, releaseWakeLock]);

    useEffect(() => {
        const handleVisibility = () => {
            if (document.visibilityState === 'visible' && intentToLock) {
                acquireWakeLock();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            releaseWakeLock(); // Clean up on unmount
        };
    }, [intentToLock, acquireWakeLock, releaseWakeLock]);

    const toggleLock = useCallback((shouldLock) => {
        setIntentToLock(shouldLock);
    }, []);

    // Auditoria de performance (2026-08-08, P2): requestLock/releaseLock (a API
    // pública deste hook) eram funções inline recriadas a cada chamada do hook —
    // qualquer efeito consumidor com deps [requestLock] (ex.: CaptainRiding.jsx)
    // redisparava a cada render do componente hospedeiro, não só na montagem. Hoje
    // o disparo repetido era inofensivo (guards internos em acquireWakeLock, ex.
    // `if (wakeLockRef.current) return`), mas useCallback é a correção correta na
    // fonte, não um paliativo no chamador.
    const requestLock = useCallback(() => toggleLock(true), [toggleLock]);
    const releaseLock = useCallback(() => toggleLock(false), [toggleLock]);

    return { isSupported, isLocked, requestLock, releaseLock };
};
