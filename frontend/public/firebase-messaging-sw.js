importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

const firebaseConfig = {
    apiKey: "AIzaSyBR8Kw7upDB9mpntUsRInL7sSgWiEXVbOU",
    authDomain: "movecity-12a8d.firebaseapp.com",
    projectId: "movecity-12a8d",
    storageBucket: "movecity-12a8d.firebasestorage.app",
    messagingSenderId: "130874019505",
    appId: "1:130874019505:web:5ee27a5f42159b89375c90",
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

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

messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);

    const data = payload.data || {};
    const notificationTitle = payload.notification?.title || data.title || 'Nova Mensagem';
    const body = payload.notification?.body || data.message || '';

    const notificationOptions = {
        body,
        icon: '/movecity-icon.jpg',
        badge: '/movecity-icon.jpg',
        data,
        timestamp: Date.now(),
    };

    if (data.type === 'NEW_RIDE') {
        // Sem Aceitar/Recusar (2026-08-04): o motorista vê valor, origem, destino e
        // distância no body e toca na notificação para abrir a oferta no app.
        notificationOptions.requireInteraction = true;
        notificationOptions.renotify = true;
        notificationOptions.silent = false;
        notificationOptions.vibrate = [300, 100, 300, 100, 300];
        if (data.rideId) {
            notificationOptions.tag = `ride-${data.rideId}`;
        }
    }

    return self.registration.showNotification(notificationTitle, notificationOptions);
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
    if (data?.rideId) return `/captain-home?rideOffer=${encodeURIComponent(data.rideId)}`;
    return '/captain-home';
};

self.addEventListener('notificationclick', (event) => {
    const notification = event.notification;
    const data = notification.data || {};
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
