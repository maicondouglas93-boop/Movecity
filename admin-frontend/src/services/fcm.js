import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";
import { app } from './firebase';
import api from './api';

let messaging = null;

// Mesmo cuidado do app do passageiro/motorista (frontend/src/services/fcm.js): chamar
// getMessaging(app) incondicionalmente dispara, em ambientes sem suporte, uma unhandled
// promise rejection DENTRO do próprio SDK do Firebase — isSupported() evita isso.
// Ver o comentário equivalente no fcm.js do app do passageiro: configuração ausente e
// navegador sem suporte são problemas diferentes e precisam de mensagens diferentes.
// Aqui, ao contrário do app do passageiro, o Firebase é usado SÓ para push — se faltar
// configuração, o painel funciona normalmente, só não recebe notificação.
const hasFirebaseConfig = !!(app?.options?.projectId && app?.options?.messagingSenderId);

const messagingReady = isSupported()
    .then((supported) => {
        if (!hasFirebaseConfig) {
            console.warn(
                '[Push] Configuração do Firebase ausente: as variáveis VITE_FIREBASE_* não chegaram ' +
                'neste build. O painel funciona normalmente, mas não vai receber notificações ' +
                '(novo motorista, denúncia, problema de pagamento).'
            );
            return null;
        }
        if (!supported) {
            console.warn('[Push] Este navegador não suporta Web Push.');
            return null;
        }
        try {
            messaging = getMessaging(app);
        } catch (error) {
            console.warn('[Push] Falha ao inicializar o Firebase Messaging:', error.message);
        }
        return messaging;
    })
    .catch(() => null);

const FCM_SW_URL = '/firebase-messaging-sw.js';
const FCM_SW_SCOPE = '/firebase-cloud-messaging-push-scope';

const waitForActive = (registration) => {
    if (registration.active) return Promise.resolve(registration);
    const worker = registration.installing || registration.waiting;
    if (!worker) return Promise.resolve(registration);
    return new Promise((resolve) => {
        worker.addEventListener('statechange', function handler() {
            if (worker.state === 'activated') {
                worker.removeEventListener('statechange', handler);
                resolve(registration);
            }
        });
    });
};

let registrationPromise = null;

const getFcmRegistration = () => {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    if (!registrationPromise) {
        registrationPromise = navigator.serviceWorker
            .register(FCM_SW_URL, { scope: FCM_SW_SCOPE })
            .then(waitForActive)
            .catch((error) => {
                console.warn('Falha ao registrar o Service Worker de push:', error.message);
                registrationPromise = null;
                return null;
            });
    }
    return registrationPromise;
};

// Chamado uma vez após o login/confirmação de sessão (AuthContext.jsx). Diferente do
// app do passageiro/motorista, não há cartão de contexto antes do prompt nativo — o
// público aqui é interno (a própria equipe), não passageiros/motoristas novos que
// poderiam negar por reflexo.
export const requestAdminFCMToken = async () => {
    await messagingReady;
    if (!messaging) return null;
    if (!('Notification' in window)) return null;

    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return null;

        const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
        if (!vapidKey) {
            console.warn('VAPID key not configured. Push notifications are disabled.');
            return null;
        }

        const registration = await getFcmRegistration();
        const currentToken = await getToken(messaging, {
            vapidKey,
            ...(registration ? { serviceWorkerRegistration: registration } : {})
        });

        if (currentToken) {
            await api.post('/admin/notifications/token', {
                token: currentToken,
                device: navigator.userAgent
            });
            return currentToken;
        }
    } catch (error) {
        console.warn('FCM token retrieval failed:', error.message);
    }
    return null;
};

// Usado no logout, pra desvincular o token deste dispositivo da conta que está saindo.
export const getCurrentAdminFcmToken = async () => {
    await messagingReady;
    if (!messaging) return null;
    if (!('Notification' in window) || Notification.permission !== 'granted') return null;

    try {
        const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
        if (!vapidKey) return null;
        const registration = await getFcmRegistration();
        return await getToken(messaging, {
            vapidKey,
            ...(registration ? { serviceWorkerRegistration: registration } : {})
        });
    } catch (error) {
        console.warn('Falha ao obter token FCM atual:', error.message);
        return null;
    }
};

export const onAdminForegroundMessage = (callback) => {
    let unsubscribed = false;
    let unsubscribeFn = () => { unsubscribed = true; };

    messagingReady.then(() => {
        if (unsubscribed || !messaging) return;
        unsubscribeFn = onMessage(messaging, callback);
    });

    return () => unsubscribeFn();
};
