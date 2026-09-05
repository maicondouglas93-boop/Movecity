// Apenas a corrida em andamento e o perfil mínimo: não é autorização offline para
// carteira, novas ofertas ou outras contas. O servidor continua validando as ações.
import { db } from '@/shared/services/db'

const KEY = 'movecity:driver-recovery:v1'
const apiBase = () => String(import.meta.env.VITE_BASE_URL || '').replace(/\/+$/, '')

export function clearDriverRecovery() {
    try { localStorage.removeItem(KEY) } catch { /* armazenamento indisponível */ }
}

export function readDriverRecovery(ownerId) {
    if (!ownerId) return null
    try {
        const saved = JSON.parse(localStorage.getItem(KEY))
        return saved?.version === 1 && saved.ownerId === String(ownerId)
            && saved.apiBase === apiBase() ? saved : null
    } catch { return null }
}

function write(ownerId, patch) {
    if (!ownerId) return false
    try {
        localStorage.setItem(KEY, JSON.stringify({
            ...readDriverRecovery(ownerId), ...patch,
            version: 1, ownerId: String(ownerId), apiBase: apiBase(),
        }))
        return true
    } catch { return false }
}

export function saveDriverProfile(ownerId, profile) {
    if (!profile?._id || String(profile._id) !== String(ownerId)) return false
    const { _id, fullname, vehicle } = profile
    return write(ownerId, { profile: { _id, fullname, vehicle } })
}

export function saveDriverRide(ownerId, ride) {
    return write(ownerId, { ride: ride?._id && ride.status === 'started' ? ride : null })
}

export function clearSavedDriverRide(ownerId, rideId) {
    if (String(readDriverRecovery(ownerId)?.ride?._id) === String(rideId)) saveDriverRide(ownerId, null)
}

export async function loadDriverRecovery(ownerId) {
    const saved = readDriverRecovery(ownerId)
    if (!saved?.profile?._id || saved.ride?.status !== 'started') return null
    // Falha ao ler a fila não pode ressuscitar um encerramento pendente.
    const pending = await db.offlineActions.toArray()
    const current = readDriverRecovery(ownerId)
    if (current?.ride?.status !== 'started' || current.ride._id !== saved.ride._id) return null
    return pending.some(action => action.type === 'end-ride'
        && String(action.rideId) === String(saved.ride._id)) ? null : current
}
