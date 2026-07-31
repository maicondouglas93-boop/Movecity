
import React, { createContext, useEffect } from 'react';
import { io } from 'socket.io-client';

export const SocketContext = createContext();

import * as Sentry from '@sentry/react';
import { db } from '@/services/db';

const socket = io(`${import.meta.env.VITE_BASE_URL}`, {
    transports: [ 'polling' ]
});

const SocketProvider = ({ children }) => {
    useEffect(() => {
        socket.on('connect', () => {
            console.log('Connected to server');
            syncOfflineQueue();
        });

        socket.on('disconnect', (reason) => {
            console.log('Disconnected from server', reason);
            Sentry.captureMessage(`Socket disconnected: ${reason}`, 'warning');
        });

        const syncOfflineQueue = async () => {
            try {
                const actions = await db.offlineActions.toArray();
                if (actions.length > 0) {
                    console.log('Syncing offline actions...', actions);
                    for (const action of actions) {
                        socket.emit(action.type, action.payload);
                        await db.offlineActions.delete(action.id);
                    }
                }
                
                const locations = await db.driverLocations.toArray();
                if (locations.length > 0) {
                    // Send last location or bulk locations
                    const lastLoc = locations[locations.length - 1];
                    socket.emit('update-location-captain', {
                        userId: lastLoc.userId,
                        location: { ltd: lastLoc.lat, lng: lastLoc.lng }
                    });
                    await db.driverLocations.clear();
                }
            } catch (err) {
                console.error('Failed to sync offline queue:', err);
                Sentry.captureException(err);
            }
        };

        window.addEventListener('online', syncOfflineQueue);

        return () => {
            window.removeEventListener('online', syncOfflineQueue);
        };
    }, []);
    return (
        <SocketContext.Provider value={{ socket }}>
            {children}
        </SocketContext.Provider>
    );
};

export default SocketProvider;