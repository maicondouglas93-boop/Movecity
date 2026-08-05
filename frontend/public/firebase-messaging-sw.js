/* eslint-disable no-undef */
// SW_VERSION: 2026-08-05-config-via-query — Fase 1 da auditoria de production
// readiness (C4): a config Firebase saiu do código versionado. Arquivos em public/
// não passam pelo build do Vite (import.meta.env não existe aqui), então quem
// registra este worker (src/shared/services/fcm.js) anexa a config na query string
// da URL de registro — ela fica gravada na registration e sobrevive a restarts do
// worker, inclusive push em background com o app fechado.
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

const swParams = new URLSearchParams(self.location.search);
const firebaseConfig = {
    apiKey: swParams.get('apiKey') || '',
    authDomain: swParams.get('authDomain') || '',
    projectId: swParams.get('projectId') || '',
    storageBucket: swParams.get('storageBucket') || '',
    messagingSenderId: swParams.get('messagingSenderId') || '',
    appId: swParams.get('appId') || '',
};

// Sem config (registro antigo em cache ou variáveis ausentes no build), o push por
// Firebase fica desativado — mas o worker continua vivo para SYNC_TOKEN/notificationclick.
const hasFirebaseConfig = !!(firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId);

let messaging = null;
if (hasFirebaseConfig) {
    firebase.initializeApp(firebaseConfig);
    messaging = firebase.messaging();
} else {
    console.warn('[firebase-messaging-sw.js] Config Firebase ausente na query string do registro — push em background desativado.');
}

// IndexedDB Helper
const DB_NAME = 'MoveCitySW';
const STORE_NAME = 'auth';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            e.target.result.createObjectStore(STORE_NAME);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function setToken(token) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(token, 'jwt');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getToken() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get('jwt');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function clearToken() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete('jwt');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SYNC_TOKEN') {
        setToken(event.data.token).catch(console.error);
    } else if (event.data && event.data.type === 'CLEAR_TOKEN') {
        clearToken().catch(console.error);
    }
});

if (messaging) messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);

    const data = payload.data || {};
    const notificationTitle = payload.notification?.title || data.title || 'Nova Mensagem';
    const body = payload.notification?.body || data.message || '';

    const notificationOptions = {
        body,
        icon: '/pwa-icon-192.png',
        badge: '/pwa-icon-192.png',
        data,
        timestamp: Date.now(),
        // Explicitamente sem ações — SW antigo em cache ainda mostrava Aceitar/Recusar.
        actions: [],
    };

    if (data.type === 'NEW_RIDE' || data.type === 'NEW_PARCEL') {
        // Só body rico; toque na notificação abre a oferta no app.
        notificationOptions.requireInteraction = true;
        notificationOptions.renotify = true;
        notificationOptions.silent = false;
        notificationOptions.vibrate = [300, 100, 300, 100, 300];
        if (data.type === 'NEW_RIDE' && data.rideId) {
            notificationOptions.tag = `ride-${data.rideId}`;
        }
        if (data.type === 'NEW_PARCEL' && data.parcelId) {
            notificationOptions.tag = `parcel-${data.parcelId}`;
        }
    }

    return self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(Promise.resolve());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

const toAbsoluteUrl = (url) => {
    try {
        return new URL(url || '/', self.location.origin).href;
    } catch {
        return new URL('/', self.location.origin).href;
    }
};

// CRÍTICO (Android Chrome): NÃO chamar notification.close() antes de openWindow/focus.
// Fechar a notificação primeiro cancela o "user gesture" e o openWindow falha em
// silêncio — o PWA não abre. Sempre abrir/focar ANTES de fechar.
const focusOrOpenWindow = async (url) => {
    const absoluteUrl = toAbsoluteUrl(url);
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    for (const client of clientsList) {
        try {
            if (new URL(client.url).origin !== self.location.origin) continue;
        } catch {
            continue;
        }

        if ('focus' in client) {
            await client.focus();
        }

        // Chrome 92+: navega a janela já aberta para o deep link.
        if (typeof client.navigate === 'function') {
            try {
                await client.navigate(absoluteUrl);
                return client;
            } catch (err) {
                console.warn('[SW] client.navigate falhou, usando postMessage:', err);
            }
        }

        client.postMessage({ type: 'NOTIFICATION_NAVIGATE', url: absoluteUrl });
        return client;
    }

    if (self.clients.openWindow) {
        return self.clients.openWindow(absoluteUrl);
    }
    return null;
};

const resolveDeepLink = (data) => {
    // Prefere path relativo (mesma origem do PWA). deepLinkAbsolute só se for same-origin.
    if (data?.deepLink) return data.deepLink;
    if (data?.deepLinkAbsolute) {
        try {
            const abs = new URL(data.deepLinkAbsolute);
            if (abs.origin === self.location.origin) {
                return `${abs.pathname}${abs.search}${abs.hash}`;
            }
        } catch (_) { /* ignore */ }
    }
    if (data?.parcelId) return `/captain-home?parcelOffer=${encodeURIComponent(data.parcelId)}`;
    if (data?.rideId) return `/captain-home?rideOffer=${encodeURIComponent(data.rideId)}`;
    return '/captain-home';
};

self.addEventListener('notificationclick', (event) => {
    const notification = event.notification;
    const data = notification.data || {};
    // Ignora ações legadas (accept/reject) de SWs antigos — sempre só abre o app.
    const targetUrl = resolveDeepLink(data);

    event.waitUntil((async () => {
        try {
            await focusOrOpenWindow(targetUrl);
            notification.close();
        } catch (error) {
            console.error('[SW] Falha no notificationclick:', error);
            try {
                await focusOrOpenWindow(targetUrl);
            } catch (_) { /* ignore */ }
            try {
                notification.close();
            } catch (_) { /* ignore */ }
        }
    })());
});
