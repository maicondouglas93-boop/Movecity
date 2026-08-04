import { createContext, useState, useContext, useEffect } from 'react';
import * as Sentry from '@sentry/react';

export const CaptainDataContext = createContext();

const CaptainContext = ({ children }) => {
    const [ captain, setCaptain ] = useState(null);
    const [ isLoading, setIsLoading ] = useState(false);
    const [ error, setError ] = useState(null);

    useEffect(() => {
        if (captain && captain._id) {
            Sentry.setUser({ id: captain._id, email: captain.email, username: captain.fullname?.firstname });
        } else {
            Sentry.setUser(null);
        }
    }, [captain]);

    const updateCaptain = (captainData) => {
        setCaptain(captainData);
    };

    const value = {
        captain,
        setCaptain,
        isLoading,
        setIsLoading,
        error,
        setError,
        updateCaptain
    };

    return (
        <CaptainDataContext.Provider value={value}>
            {children}
        </CaptainDataContext.Provider>
    );
};

export default CaptainContext;