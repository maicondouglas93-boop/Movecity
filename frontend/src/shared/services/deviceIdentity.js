const DEVICE_ID_KEY = 'movecity:device-id'
let memoryDeviceId = null

function createDeviceId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  }
  // Identificador de conveniência, não credencial. Este fallback cobre WebViews muito
  // antigos sem Web Crypto; autenticação e revogação continuam vinculadas ao JTI.
  return `fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 18)}`
}

export function getDeviceId() {
  if (memoryDeviceId) return memoryDeviceId
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY)
    if (stored) return (memoryDeviceId = stored)
    memoryDeviceId = createDeviceId()
    localStorage.setItem(DEVICE_ID_KEY, memoryDeviceId)
    return memoryDeviceId
  } catch {
    memoryDeviceId = memoryDeviceId || createDeviceId()
    return memoryDeviceId
  }
}
