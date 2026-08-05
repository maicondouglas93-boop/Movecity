importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Fase 7 da correção do sistema de push (2026-08-02): canal de push para o painel
// administrativo. Bem mais simples que o do app do motorista (frontend/public/
// firebase-messaging-sw.js) — não existe nenhuma ação tipo "aceitar corrida" pra
// processar aqui, só mostrar a notificação e, ao clicar, abrir o painel.
//
// Fase 1 da auditoria de production readiness (C4, 2026-08-05): a config Firebase
// saiu do código versionado — quem registra este worker (src/services/fcm.js) anexa
// a config na query string da URL de registro, e ela sobrevive a restarts porque faz
// parte da URL registrada.
const swParams = new URLSearchParams(self.location.search);
const firebaseConfig = {
    apiKey: swParams.get('apiKey') || '',
    authDomain: swParams.get('authDomain') || '',
    projectId: swParams.get('projectId') || '',
    storageBucket: swParams.get('storageBucket') || '',
    messagingSenderId: swParams.get('messagingSenderId') || '',
    appId: swParams.get('appId') || '',
};

const hasFirebaseConfig = !!(firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId);

let messaging = null;
if (hasFirebaseConfig) {
    firebase.initializeApp(firebaseConfig);
    messaging = firebase.messaging();
} else {
    console.warn('[admin firebase-messaging-sw.js] Config Firebase ausente na query string do registro — push em background desativado.');
}

if (messaging) messaging.onBackgroundMessage((payload) => {
    console.log('[admin firebase-messaging-sw.js] Received background message ', payload);
    const notificationTitle = payload.notification?.title || payload.data?.title || 'MoveCity Admin';

    const notificationOptions = {
        body: payload.notification?.body || payload.data?.message,
        icon: '/favicon.svg',
        data: payload.data
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    // Aceita tanto '/rota' quanto 'rota' — o backend manda com barra inicial, mas
    // normalizar aqui evita '//rota' se algum emissor futuro mandar sem.
    const deepLink = event.notification.data?.deepLink;
    const targetUrl = deepLink ? `/${String(deepLink).replace(/^\/+/, '')}` : '/dashboard';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
            for (const client of clientsList) {
                if ('focus' in client) return client.focus();
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});
