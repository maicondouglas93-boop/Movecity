import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { app } from '../firebase';
import axios from 'axios';

const messaging = getMessaging(app);

export const requestFCMToken = async () => {
    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            const currentToken = await getToken(messaging, { 
                vapidKey: 'BOd912Gqg_pC--G3G-FfWJbA5x1tM-12x9vM12030' // Placeholder VAPID Key. (The user will need to replace this if using real push from console)
            });
            if (currentToken) {
                // Send token to backend
                const token = localStorage.getItem('token') || localStorage.getItem('captain-token');
                if (token) {
                    await axios.post(`${import.meta.env.VITE_BASE_URL}/notifications/token`, {
                        token: currentToken,
                        device: navigator.userAgent
                    }, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                }
                return currentToken;
            } else {
                console.log('No registration token available. Request permission to generate one.');
            }
        }
    } catch (error) {
        console.error('An error occurred while retrieving token. ', error);
    }
};

export const onMessageListener = () =>
    new Promise((resolve) => {
        onMessage(messaging, (payload) => {
            resolve(payload);
        });
    });
