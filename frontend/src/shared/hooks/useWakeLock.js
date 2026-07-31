import { useState, useEffect, useCallback, useRef } from 'react';

export const useWakeLock = () => {
    const [isSupported, setIsSupported] = useState(false);
    const [isLocked, setIsLocked] = useState(false);
    const wakeLockRef = useRef(null);
    const [intentToLock, setIntentToLock] = useState(false);

    useEffect(() => {
        setIsSupported('wakeLock' in navigator);
    }, []);

    const requestLock = useCallback(async () => {
        if (!isSupported) {
            console.warn('Wake Lock API not supported. Fallback required if playing silent video.');
            return;
        }

        try {
            if (wakeLockRef.current) return;
            wakeLockRef.current = await navigator.wakeLock.request('screen');
            setIsLocked(true);
            
            wakeLockRef.current.addEventListener('release', () => {
                wakeLockRef.current = null;
                setIsLocked(false);
            });
            console.log('Wake Lock is active');
        } catch (err) {
            console.error('Failed to request wake lock:', err);
        }
    }, [isSupported]);

    const releaseLock = useCallback(async () => {
        if (wakeLockRef.current) {
            await wakeLockRef.current.release();
            wakeLockRef.current = null;
            setIsLocked(false);
        }
    }, []);

    useEffect(() => {
        if (intentToLock && document.visibilityState === 'visible') {
            requestLock();
        } else if (!intentToLock) {
            releaseLock();
        }
    }, [intentToLock, requestLock, releaseLock]);

    useEffect(() => {
        const handleVisibility = () => {
            if (document.visibilityState === 'visible' && intentToLock) {
                requestLock();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            releaseLock(); // Clean up on unmount
        };
    }, [intentToLock, requestLock, releaseLock]);

    const toggleLock = (shouldLock) => {
        setIntentToLock(shouldLock);
    };

    return { isSupported, isLocked, requestLock: () => toggleLock(true), releaseLock: () => toggleLock(false) };
};
