import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { app } from '../firebase';
import axios from 'axios';

let messaging = null;

try {
    messaging = getMessaging(app);
} catch (error) {
    console.warn('Firebase Messaging not supported in this environment:', error.message);
}

export const requestFCMToken = async () => {
    if (!messaging) {
        console.warn('Firebase Messaging is not available.');
        return null;
    }

    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
            if (!vapidKey) {
                console.warn('VAPID key not configured. Push notifications are disabled.');
                return null;
            }

            const currentToken = await getToken(messaging, { vapidKey });
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
        console.warn('FCM token retrieval failed:', error.message);
    }
    return null;
};

export const onMessageListener = () =>
    new Promise((resolve) => {
        if (!messaging) return;
        onMessage(messaging, (payload) => {
            resolve(payload);
        });
    });

