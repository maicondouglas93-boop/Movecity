import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";
import { app } from '@/shared/services/firebase';
import axios from 'axios';
import { getAccessToken } from '@/shared/services/session';

let messaging = null;

// Fase 5 da auditoria de push (2026-08-02): chamar getMessaging(app) incondicionalmente
// (como era antes) dispara, em ambientes sem suporte (jsdom nos testes, navegadores mais
// antigos, modo privado sem IndexedDB), uma unhandled promise rejection DENTRO do
// próprio SDK do Firebase ("messaging/unsupported-browser") — fora do alcance de
// qualquer try/catch síncrono nosso, porque o SDK dispara uma checagem assíncrona
// interna independente do que o nosso código faz. `isSupported()` é a checagem oficial
// da própria lib pra evitar isso, feita antes de qualquer tentativa de uso.
// Distingue os dois motivos de o push não iniciar, que antes caíam na MESMA mensagem
// ("not supported in this environment") e mandavam quem estava diagnosticando para o
// lado errado: configuração ausente é problema de deploy (variáveis não chegaram no
// build), não de navegador.
const hasFirebaseConfig = !!(app?.options?.projectId && app?.options?.messagingSenderId);

const messagingReady = isSupported()
    .then((supported) => {
        if (!hasFirebaseConfig) {
            console.error(
                '[Push] Configuração do Firebase ausente: as variáveis VITE_FIREBASE_* não chegaram neste build. ' +
                'Push desativado. ATENÇÃO: o login com Google usa a MESMA configuração (services/firebase.js) ' +
                'e também não vai funcionar até isso ser corrigido no painel de deploy.'
            );
            return null;
        }
        if (!supported) {
            console.warn(
                '[Push] Este navegador não suporta Web Push. No iPhone, só funciona com o app ' +
                'instalado na tela de início (PWA) — no Safari comum, não.'
            );
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

// Auditoria de notificações push (2026-08-02, C1): antes, nada registrava este worker
// explicitamente — o SDK do Firebase escolhia sozinho qual Service Worker usar, e na
// prática colidia com o worker do vite-plugin-pwa (que controla o escopo "/"). Isso
// fazia swCommunication.js mandar o JWT pro worker errado (o do PWA, não o do Firebase),
// deixando o IndexedDB do worker de push sempre vazio e o botão "Aceitar" da notificação
// sempre falhando com "sessão expirada". Registrar aqui, com escopo próprio, e reusar
// esta mesma registration tanto no getToken() quanto no postMessage (swCommunication.js)
// resolve os dois lados de uma vez.
let registrationPromise = null;

export const getFcmRegistration = () => {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    if (!registrationPromise) {
        registrationPromise = navigator.serviceWorker
            .register(FCM_SW_URL, { scope: FCM_SW_SCOPE, updateViaCache: 'none' })
            .then(async (registration) => {
                // Garante que o SW novo (sem Aceitar/Recusar) substitui o antigo em cache.
                try {
                    await registration.update();
                } catch (_) { /* ignore */ }
                return waitForActive(registration);
            })
            .catch((error) => {
                console.warn('Falha ao registrar o Service Worker de push:', error.message);
                registrationPromise = null;
                return null;
            });
    }
    return registrationPromise;
};

export const requestFCMToken = async () => {
    await messagingReady;
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

            const registration = await getFcmRegistration();
            const currentToken = await getToken(messaging, {
                vapidKey,
                ...(registration ? { serviceWorkerRegistration: registration } : {})
            });
            if (currentToken) {
                // Send token to backend
                const token = getAccessToken('user') || getAccessToken('captain');
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

// A3 da auditoria de push (2026-08-02): usado no logout pra descobrir o token deste
// dispositivo e pedir ao backend que o desvincule da conta que está saindo. Não chama
// Notification.requestPermission() de novo — só lê o token se a permissão já foi
// concedida antes; não faz sentido (nem pediria) permissão só pra sair.
export const getCurrentFcmToken = async () => {
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

// A9 da auditoria de push (2026-08-02): `onMessageListener` (removido) nunca funcionava
// de verdade — era uma Promise que só resolve UMA vez, então só conseguiria mostrar a
// primeira mensagem recebida durante toda a vida da aba, e além disso nunca era
// importada em lugar nenhum do app. Com o app aberto (primeiro plano), o Firebase NÃO
// mostra a notificação nativa sozinho — quem decide o que fazer é este listener. Sem
// ele, a única coisa que hoje avisa o usuário de algo em primeiro plano é o Socket.IO.
//
// Mantém o contrato síncrono (devolve a função de cancelamento na hora, sem `await`) pra
// não complicar quem chama isto de dentro de um useEffect — só espera messagingReady
// por dentro antes de de fato assinar.
export const onForegroundMessage = (callback) => {
    let unsubscribed = false;
    let unsubscribeFn = () => { unsubscribed = true; };

    messagingReady.then(() => {
        if (unsubscribed || !messaging) return;
        unsubscribeFn = onMessage(messaging, callback);
    });

    return () => unsubscribeFn();
};
