import React, { createContext, useState, useEffect, useRef } from 'react';

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
    
    // Ref para uso imediato em Sockets/Mapas sem causar re-renderizações desnecessárias
    const locationRef = useRef(userLocation);

    useEffect(() => {
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

        const handleError = (error) => {
            console.error('Erro de GPS:', error);
            // Evitamos recriar o watcher num loop infinito caso o erro seja de permissão.
            if (error.code === error.PERMISSION_DENIED) {
                setLocationError('Permissão de localização negada.');
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
    }, []);

    return (
        <LocationContext.Provider value={{ userLocation, locationRef, locationError }}>
            {children}
        </LocationContext.Provider>
    );
};
