import { getFcmRegistration } from './fcm'

// Auditoria de notificações push (2026-08-02, C1): antes usava
// navigator.serviceWorker.controller, que é o worker que controla a PÁGINA (o do
// vite-plugin-pwa, escopo "/") — não o worker do Firebase Messaging (escopo próprio,
// registrado em fcm.js). A mensagem nunca chegava a quem precisava dela.
export const syncTokenWithSW = async (token) => {
    const registration = await getFcmRegistration()
    if (registration?.active) {
        registration.active.postMessage({
            type: 'SYNC_TOKEN',
            token: token
        })
    }
}

export const clearTokenInSW = async () => {
    const registration = await getFcmRegistration()
    if (registration?.active) {
        registration.active.postMessage({
            type: 'CLEAR_TOKEN'
        })
    }
}
