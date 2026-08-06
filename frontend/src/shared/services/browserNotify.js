import { getFcmRegistration } from '@/shared/services/fcm'
import { isNativePlatform } from '@/shared/platform/platform'

// Notificação do browser/SW (PWA). No APK Capacitor a apresentação é nativa
// (RideOfferNotifier / DriverAlertNotifier via MoveCityMessagingService) — não
// criar Notification web em paralelo (duplicata + sintoma de "só após o toque").
//
// Correção do crash de tela branca (2026-08-04): as três chamadas antigas usavam
// `new Notification(title, {...})` direto. No Android esse construtor é proibido fora
// de um Service Worker — o navegador lança `TypeError: Illegal constructor`. Em
// CaptainRiding.jsx essa chamada ficava dentro do corpo de um useEffect, e como o app
// não tem nenhum Error Boundary, a exceção derrubava a árvore inteira assim que a
// corrida era iniciada. `ServiceWorkerRegistration.showNotification()` funciona nos
// dois casos (desktop e Android) e reusa o mesmo worker que o FCM já registra
// (getFcmRegistration, services/fcm.js) — nunca lança de forma síncrona, então é seguro
// chamar de dentro de qualquer efeito/handler sem try/catch no chamador.
export function showBrowserNotification(title, body) {
    if (isNativePlatform()) return
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    if (!('serviceWorker' in navigator)) return

    getFcmRegistration()
        .then((registration) => {
            if (!registration) return
            return registration.showNotification(title, { body, icon: '/movecity-icon.jpg' })
        })
        .catch((err) => console.error('Falha ao exibir notificação do browser:', err))
}
