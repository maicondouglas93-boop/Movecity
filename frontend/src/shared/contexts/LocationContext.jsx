import React, { createContext, useState, useEffect, useRef } from 'react';
import { hasActiveSession, onSessionChanged } from '@/shared/services/session';
import { computeBearing, distanceMeters } from '@/shared/services/maps/navigationMath';

export const LocationContext = createContext();

// Fase D (2026-08-03): abaixo deste deslocamento entre dois fixes, a diferença é ruído
// de GPS parado (deriva típica de 3-8 m), não movimento — calcular bearing daí faria a
// seta girar sozinha com o veículo parado no semáforo.
const MIN_BEARING_DISTANCE_M = 8;

export const LocationProvider = ({ children }) => {
    // Inicializa com a última localização conhecida do localStorage (se existir)
    const [userLocation, setUserLocation] = useState(() => {
        try {
            const saved = localStorage.getItem('lastLocation');
            return saved ? JSON.parse(saved) : null;
        } catch (e) {
            return null;
        }
    });

    const [locationError, setLocationError] = useState(null);
    // Auditoria PWA (2026-08-03, A2): antes o watcher ligava assim que o app abria,
    // inclusive nas telas de login/cadastro, antes de existir qualquer sessão — GPS de
    // alta precisão gastando bateria sem necessidade e o prompt de permissão nativo
    // aparecendo sem contexto, na primeira tela que a pessoa via. Reage a login/logout
    // via o evento de session.js (contexts de user/captain não dão um sinal confiável
    // de "está logado" — UserDataContext começa com um objeto vazio, não null).
    const [hasSession, setHasSession] = useState(() => hasActiveSession());

    // Ref para uso imediato em Sockets/Mapas sem causar re-renderizações desnecessárias
    const locationRef = useRef(userLocation);
    // Fase D: bases do bearing calculado (fallback de quando o GPS não reporta heading).
    const lastFixRef = useRef(null);
    const lastHeadingRef = useRef(null);

    useEffect(() => {
        return onSessionChanged(() => setHasSession(hasActiveSession()));
    }, []);

    useEffect(() => {
        if (!hasSession) return;

        if (!navigator.geolocation) {
            setLocationError('Geolocalização não é suportada neste navegador.');
            return;
        }

        const handleSuccess = (position) => {
            const { latitude, longitude, heading, speed, accuracy } = position.coords;
            const point = { lat: latitude, lng: longitude };

            // Fase D (2026-08-03): o GPS só reporta `heading` quando há movimento real
            // e o dispositivo tem bússola/curso — em desktop, parado ou em túnel vem
            // null (ou NaN). Sem um rumo, a câmera de navegação não tem para onde
            // girar, então calculamos pelo deslocamento entre dois fixes consecutivos.
            // O último rumo válido é mantido enquanto o veículo está parado: apontar
            // para o norte só porque o carro parou seria pior que manter a direção.
            let resolvedHeading = Number.isFinite(heading) ? heading : null;
            const previous = lastFixRef.current;
            if (resolvedHeading == null && previous) {
                const moved = distanceMeters(previous, point);
                if (moved != null && moved >= MIN_BEARING_DISTANCE_M) {
                    resolvedHeading = computeBearing(previous, point);
                }
            }
            if (resolvedHeading == null) resolvedHeading = lastHeadingRef.current;
            if (resolvedHeading != null) lastHeadingRef.current = resolvedHeading;
            lastFixRef.current = point;

            const coords = {
                ...point,
                heading: resolvedHeading,
                // `speed` vem em m/s pela spec da Geolocation API; null quando o
                // dispositivo não sabe medir.
                speed: Number.isFinite(speed) ? speed : null,
                accuracy: Number.isFinite(accuracy) ? accuracy : null,
                timestamp: position.timestamp || Date.now(),
            };

            // Atualiza a ref e o state
            locationRef.current = coords;
            setUserLocation(coords);
            setLocationError(null);

            // Persiste para uso imediato na próxima abertura. Só lat/lng de propósito:
            // rumo e velocidade de uma sessão anterior estariam errados na próxima
            // abertura e girariam o mapa para uma direção fantasma.
            try {
                localStorage.setItem('lastLocation', JSON.stringify(point));
            } catch (e) {
                console.error('Erro ao salvar no localStorage', e);
            }
        };

        // Auditoria PWA (2026-08-03, M6): os três códigos de erro da Geolocation API
        // tinham a mesma mensagem genérica (exceto permissão) — quem lê não sabia se
        // precisava ligar o GPS, esperar o sinal ou é mesmo permissão negada.
        const handleError = (error) => {
            console.error('Erro de GPS:', error);
            // Evitamos recriar o watcher num loop infinito caso o erro seja de permissão.
            if (error.code === error.PERMISSION_DENIED) {
                setLocationError('Permissão de localização negada.');
            } else if (error.code === error.POSITION_UNAVAILABLE) {
                setLocationError('Não foi possível obter sua localização. Verifique se o GPS está ligado.');
            } else if (error.code === error.TIMEOUT) {
                setLocationError('Sinal de GPS demorando para responder. Tentando novamente...');
            } else {
                setLocationError(`Erro ao obter localização: ${error.message}`);
            }
        };

        const options = {
            enableHighAccuracy: true,
            maximumAge: 3000,
            timeout: 10000
        };

        // Único watcher ativo em toda a aplicação
        const watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, options);

        // Limpeza garantida ao desmontar a aplicação
        return () => {
            navigator.geolocation.clearWatch(watchId);
        };
    }, [hasSession]);

    return (
        <LocationContext.Provider value={{ userLocation, locationRef, locationError }}>
            {children}
        </LocationContext.Provider>
    );
};
