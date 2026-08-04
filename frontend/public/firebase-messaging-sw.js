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
        // Sempre oferece ações quando o SO suportar (desktop). No Android Chrome as
        // actions de Web Push costumam NÃO aparecer — o toque no corpo da notificação
        // é o caminho principal e precisa abrir o PWA com ?rideOffer=.
        notificationOptions.actions = [
            { action: 'accept', title: 'Aceitar' },
            { action: 'reject', title: 'Recusar' },
        ];
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

let acceptingRide = false;

const fetchWithTimeout = async (resource, options = {}) => {
    const { timeout = 10000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(resource, {
        ...options,
        signal: controller.signal
    });
    clearTimeout(id);
    return response;
};

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
    const action = event.action || '';
    const data = notification.data || {};
    const targetUrl = resolveDeepLink(data);
    const rideTag = data.rideId ? `ride-${data.rideId}` : undefined;

    event.waitUntil((async () => {
        try {
            // Toque no corpo / ação "open" / sem ação → abrir PWA na oferta.
            if (!action || action === 'open') {
                await focusOrOpenWindow(targetUrl);
                notification.close();
                return;
            }

            if (action === 'reject') {
                // Recusar: fecha a oferta visualmente e abre o app (sem aceitar).
                // No Android, só o toque no corpo costuma existir — esta ação é desktop.
                await focusOrOpenWindow('/captain-home');
                notification.close();
                await self.registration.showNotification('Oferta ignorada', {
                    body: 'Você pode ver outras corridas no app.',
                    icon: '/movecity-icon.jpg',
                    badge: '/movecity-icon.jpg',
                    tag: rideTag,
                    data: { deepLink: '/captain-home' },
                });
                return;
            }

            if (action === 'accept') {
                const canInline = data.canAcceptInline === 'true' && !!data.apiUrl && !!data.rideId;

                // Sem API/token: abre o app na oferta para aceitar na Home.
                if (!canInline) {
                    await focusOrOpenWindow(targetUrl);
                    notification.close();
                    return;
                }

                if (acceptingRide) {
                    await focusOrOpenWindow(targetUrl);
                    notification.close();
                    return;
                }
                acceptingRide = true;

                try {
                    // Feedback sem fechar a original ainda — mantém o gesto do usuário.
                    await self.registration.showNotification('Aceitando corrida...', {
                        body: 'Aguarde enquanto confirmamos.',
                        icon: '/movecity-icon.jpg',
                        badge: '/movecity-icon.jpg',
                        tag: rideTag,
                        requireInteraction: true,
                        data: { ...data, deepLink: '/captain-home' },
                    });

                    const token = await getToken();
                    if (!token) {
                        await focusOrOpenWindow(targetUrl);
                        notification.close();
                        await self.registration.showNotification('Abra o app para aceitar', {
                            body: 'Sessão não encontrada no segundo plano. Entre no app e aceite a corrida.',
                            icon: '/movecity-icon.jpg',
                            badge: '/movecity-icon.jpg',
                            tag: rideTag,
                            data: { deepLink: targetUrl },
                        });
                        return;
                    }

                    const response = await fetchWithTimeout(`${data.apiUrl}/rides/${data.rideId}/accept`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json',
                        },
                        timeout: 10000,
                    });

                    if (response.status === 200) {
                        // Aceita → Home do motorista (ConfirmRidePopUp / OTP), NÃO /captain-riding
                        // (riding é só com status started).
                        const homeUrl = '/captain-home';
                        await focusOrOpenWindow(homeUrl);
                        notification.close();
                        await self.registration.showNotification('Corrida aceita', {
                            body: 'Abrindo o app para continuar.',
                            icon: '/movecity-icon.jpg',
                            badge: '/movecity-icon.jpg',
                            tag: rideTag,
                            data: { ...data, deepLink: homeUrl },
                        });
                    } else if (response.status === 409) {
                        let serverMessage = 'Esta corrida não está mais disponível.';
                        try {
                            const bodyJson = await response.json();
                            if (bodyJson?.message) serverMessage = bodyJson.message;
                        } catch (_) { /* ignore */ }
                        await focusOrOpenWindow('/captain-home');
                        notification.close();
                        await self.registration.showNotification('Corrida indisponível', {
                            body: serverMessage,
                            icon: '/movecity-icon.jpg',
                            badge: '/movecity-icon.jpg',
                            tag: rideTag,
                            data: { deepLink: '/captain-home' },
                        });
                    } else if (response.status === 401) {
                        await clearToken();
                        await focusOrOpenWindow('/captain-login');
                        notification.close();
                        await self.registration.showNotification('Sessão expirada', {
                            body: 'Faça login novamente para aceitar corridas.',
                            icon: '/movecity-icon.jpg',
                            badge: '/movecity-icon.jpg',
                            tag: rideTag,
                            data: { deepLink: '/captain-login' },
                        });
                    } else {
                        await focusOrOpenWindow(targetUrl);
                        notification.close();
                        await self.registration.showNotification('Não foi possível aceitar', {
                            body: 'Abra o app e tente pela oferta na tela inicial.',
                            icon: '/movecity-icon.jpg',
                            badge: '/movecity-icon.jpg',
                            tag: rideTag,
                            data: { deepLink: targetUrl },
                        });
                    }
                } finally {
                    acceptingRide = false;
                }
                return;
            }

            // Qualquer outra ação desconhecida: abre o deep link.
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
