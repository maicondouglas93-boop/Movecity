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

// Escutar mensagens da página para salvar o token
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SYNC_TOKEN') {
        setToken(event.data.token).catch(console.error);
    } else if (event.data && event.data.type === 'CLEAR_TOKEN') {
        clearToken().catch(console.error);
    }
});

// Heads-up (2026-08-04): NEW_RIDE chega como data-only. O SW é a ÚNICA camada que
// chama showNotification — com vibrate + requireInteraction + renotify, maximizando
// a chance de o Android Chrome mostrar heads-up. Retornar a Promise é obrigatório:
// sem isso o Chrome pode mostrar "This site has been updated in the background".
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
        // Timestamp agora: ajuda o sistema a tratar como alerta recente.
        timestamp: Date.now(),
    };

    if (data.type === 'NEW_RIDE') {
        const canAccept = data.canAcceptInline === 'true';
        if (canAccept) {
            notificationOptions.actions = [
                { action: 'accept', title: '✅ Aceitar' },
                { action: 'reject', title: '❌ Recusar' },
            ];
        }
        // requireInteraction: não some sozinha (corrida precisa de resposta).
        // vibrate: no Android Chrome, vibração + som aumentam a chance de heads-up.
        // renotify + tag: se a mesma corrida for reenviada, o SO alerta de novo em
        // vez de silenciar uma notificação já existente com a mesma tag.
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

// Lock para evitar múltiplos cliques
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

// Foca uma janela já aberta do MoveCity (qualquer rota) e pede navegação via
// postMessage; se não houver, abre uma nova com a URL do deep link (com rideOffer).
const focusOrOpenWindow = async (url) => {
    const absoluteUrl = new URL(url, self.location.origin).href;
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    for (const client of clientsList) {
        try {
            if (new URL(client.url).origin !== self.location.origin) continue;
        } catch {
            continue;
        }
        if ('focus' in client) {
            await client.focus();
            client.postMessage({ type: 'NOTIFICATION_NAVIGATE', url: absoluteUrl });
            return client;
        }
    }

    if (self.clients.openWindow) {
        return self.clients.openWindow(absoluteUrl);
    }
};

self.addEventListener('notificationclick', function(event) {
    const notification = event.notification;
    const action = event.action;
    const data = notification.data || {};

    // Deep link vem do backend (data.deepLink). Para NEW_RIDE inclui ?rideOffer=<id>
    // para a CaptainHome abrir a oferta certa — não a home genérica.
    const targetUrl = data.deepLink || '/captain-home';

    if (!data.rideId) {
        notification.close();
        event.waitUntil(focusOrOpenWindow(targetUrl));
        return;
    }

    const apiUrl = data.apiUrl;

    if (action === 'reject') {
        // Recusar só fecha a notificação — não declina no servidor (decisão de produto
        // já documentada: a oferta continua no card "Corrida disponível" da Home).
        notification.close();
        return;
    }

    if (action === 'open' || !action) {
        notification.close();
        event.waitUntil(focusOrOpenWindow(targetUrl));
        return;
    }

    if (action === 'accept') {
        if (!apiUrl || data.canAcceptInline !== 'true') {
            notification.close();
            event.waitUntil(focusOrOpenWindow(targetUrl));
            return;
        }
        if (acceptingRide) return;
        acceptingRide = true;

        const rideTag = data.rideId ? `ride-${data.rideId}` : undefined;

        event.waitUntil((async () => {
            try {
                notification.close();
                await self.registration.showNotification('⏳ Aceitando...', {
                    body: 'Aguarde enquanto confirmamos a corrida.',
                    icon: '/movecity-icon.jpg',
                    badge: '/movecity-icon.jpg',
                    tag: rideTag,
                    requireInteraction: true
                });

                const token = await getToken();
                if (!token) {
                    throw new Error('UNAUTHORIZED');
                }

                // Mesmo endpoint atômico da tela do motorista — o backend decide.
                const response = await fetchWithTimeout(`${apiUrl}/rides/${data.rideId}/accept`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                });

                if (response.status === 200) {
                    await self.registration.showNotification('✅ Corrida Aceita!', {
                        body: 'Abrindo a viagem...',
                        icon: '/movecity-icon.jpg',
                        badge: '/movecity-icon.jpg',
                        tag: rideTag,
                        data: { ...data, deepLink: '/captain-riding' }
                    });
                    await focusOrOpenWindow('/captain-riding');
                } else if (response.status === 409) {
                    let serverMessage = 'Esta corrida não está mais disponível.';
                    try {
                        const bodyJson = await response.json();
                        if (bodyJson?.message) serverMessage = bodyJson.message;
                    } catch (parseErr) {
                        // Resposta sem JSON válido — mantém a mensagem genérica.
                    }
                    await self.registration.showNotification('❌ Corrida indisponível', {
                        body: serverMessage,
                        icon: '/movecity-icon.jpg',
                        badge: '/movecity-icon.jpg',
                        tag: rideTag
                    });
                } else if (response.status === 401) {
                    await self.registration.showNotification('❌ Sessão expirada', {
                        body: 'Faça login novamente para aceitar corridas.',
                        icon: '/movecity-icon.jpg',
                        badge: '/movecity-icon.jpg',
                        tag: rideTag
                    });
                    await clearToken();
                } else {
                    throw new Error('UNKNOWN_ERROR');
                }
            } catch (error) {
                console.error('Erro ao aceitar corrida pelo SW:', error);
                await self.registration.showNotification('❌ Erro de Conexão', {
                    body: error.message === 'UNAUTHORIZED'
                        ? 'Você precisa estar logado.'
                        : 'Verifique sua internet e tente abrir o app.',
                    icon: '/movecity-icon.jpg',
                    badge: '/movecity-icon.jpg',
                    tag: rideTag
                });
            } finally {
                acceptingRide = false;
            }
        })());
    }
});
