import React, { createContext, useState, useEffect, useRef } from 'react';
import { hasActiveSession, onSessionChanged } from '@/services/session';

export const LocationContext = createContext();

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
            const coords = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            
            // Atualiza a ref e o state
            locationRef.current = coords;
            setUserLocation(coords);
            setLocationError(null);

            // Persiste para uso imediato na próxima abertura
            try {
                localStorage.setItem('lastLocation', JSON.stringify(coords));
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
