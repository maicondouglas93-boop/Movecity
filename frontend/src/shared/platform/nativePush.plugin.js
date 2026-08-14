/** Import tardio: não inicializa o plugin FCM em builds onde o push nativo foi desativado. */
export async function getNativePushNotifications() {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    return PushNotifications
}
