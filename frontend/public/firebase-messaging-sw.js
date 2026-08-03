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

messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);
    const notificationTitle = payload.notification?.title || payload.data?.title || 'Nova Mensagem';
    
    const notificationOptions = {
        body: payload.notification?.body || payload.data?.message,
        icon: '/movecity-icon.jpg',
        data: payload.data
    };

    // Firebase normally handles actions if sent via webpush, 
    // but if we intercept it here, we show it manually.
    // If we want custom actions in background messages:
    if (payload.data && payload.data.type === 'NEW_RIDE') {
        notificationOptions.actions = [
            { action: 'accept', title: '✅ Aceitar' },
            { action: 'reject', title: '❌ Recusar' },
            { action: 'open', title: '📱 Abrir App' }
        ];
        notificationOptions.requireInteraction = true;
    }

    self.registration.showNotification(notificationTitle, notificationOptions);
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

const focusOrOpenWindow = async (url) => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
        if (client.url.includes(url) && 'focus' in client) {
            return client.focus();
        }
    }
    if (self.clients.openWindow) {
        return self.clients.openWindow(url);
    }
};

self.addEventListener('notificationclick', function(event) {
    const notification = event.notification;
    const action = event.action;
    const data = notification.data || {};

    // M7 da auditoria de push, corrigido na auditoria final (2026-08-02): antes, TODO
    // clique sem rideId — e todo clique COM rideId que não fosse na ação "accept" —
    // abria '/captain-home'. Um passageiro tocando em "Corrida Aceita!" ia parar na
    // tela inicial do MOTORISTA. O backend agora manda a rota certa em data.deepLink
    // (ver notificationDispatcher.service.js: DEEP_LINK); '/captain-home' só continua
    // como último recurso pra notificações antigas, enviadas antes desta correção.
    const targetUrl = data.deepLink || '/captain-home';

    if (!data.rideId) {
        notification.close();
        event.waitUntil(focusOrOpenWindow(targetUrl));
        return;
    }

    // Sem apiUrl não há como aceitar a corrida daqui. O backend só omite as ações de
    // aceite quando BASE_URL não está configurado, então este caminho não deveria ser
    // alcançável — mas se for, abrir o app é o desfecho correto, nunca chamar localhost
    // (que seria o próprio aparelho do motorista).
    const apiUrl = data.apiUrl;

    if (action === 'reject') {
        notification.close();
        return;
    }

    if (action === 'open' || !action) {
        notification.close();
        event.waitUntil(focusOrOpenWindow(targetUrl));
        return;
    }

    if (action === 'accept') {
        if (!apiUrl) {
            notification.close();
            event.waitUntil(focusOrOpenWindow(targetUrl));
            return;
        }
        if (acceptingRide) return;
        acceptingRide = true;

        // Feedback visual: alterando a notificação
        event.waitUntil((async () => {
            try {
                // Fechar notificação atual e abrir "Aceitando..."
                notification.close();
                await self.registration.showNotification('⏳ Aceitando...', {
                    body: 'Aguarde enquanto confirmamos a corrida.',
                    icon: '/movecity-icon.jpg',
                    requireInteraction: true
                });

                const token = await getToken();
                if (!token) {
                    throw new Error('UNAUTHORIZED');
                }

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
                        body: 'Toque para abrir a viagem.',
                        icon: '/movecity-icon.jpg',
                        data: data
                    });
                } else if (response.status === 409) {
                    await self.registration.showNotification('❌ Corrida indisponível', {
                        body: 'Outro motorista aceitou primeiro.',
                        icon: '/movecity-icon.jpg'
                    });
                } else if (response.status === 401) {
                    await self.registration.showNotification('❌ Sessão expirada', {
                        body: 'Faça login novamente para aceitar corridas.',
                        icon: '/movecity-icon.jpg'
                    });
                    // Limpar token se estiver inválido
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
                    icon: '/movecity-icon.jpg'
                });
            } finally {
                acceptingRide = false;
            }
        })());
    }
});
