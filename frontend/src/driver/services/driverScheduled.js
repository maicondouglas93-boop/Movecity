import api from '@/shared/services/axios'
import { withHardTimeout } from '@/shared/utils/hardTimeout'

export function validateUpcoming(data) {
    if (!Array.isArray(data?.upcoming)) throw new Error('INVALID_UPCOMING')
    const ids = new Set()
    for (const item of data.upcoming) {
        const key = `${item?.kind}:${item?._id}`
        if (!item || typeof item._id !== 'string' || !item._id.trim()
            || !['ride', 'parcel'].includes(item.kind) || ids.has(key)) throw new Error('INVALID_UPCOMING')
        ids.add(key)
    }
    return data.upcoming
}

export async function fetchDriverScheduled(signal) {
    const { data } = await withHardTimeout(api.get('/captains/scheduled-upcoming', { signal }))
    return validateUpcoming(data)
}
