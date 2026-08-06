import { isNativePlatform } from '@/shared/platform/platform'

/**
 * Vibração / haptic unificada.
 * Web: Vibration API. Android: @capacitor/haptics (Impact).
 */
export async function vibrate(pattern = [200, 100, 200]) {
    try {
        if (isNativePlatform()) {
            const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
            await Haptics.impact({ style: ImpactStyle.Heavy })
            return
        }
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(pattern)
        }
    } catch (err) {
        console.warn('[haptics] falha:', err?.message || err)
    }
}
