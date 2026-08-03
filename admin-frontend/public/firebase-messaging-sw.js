importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Fase 7 da correção do sistema de push (2026-08-02): canal de push para o painel
// administrativo. Bem mais simples que o do app do motorista (frontend/public/
// firebase-messaging-sw.js) — não existe nenhuma ação tipo "aceitar corrida" pra
// processar aqui, só mostrar a notificação e, ao clicar, abrir o painel.
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

messaging.onBackgroundMessage((payload) => {
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
