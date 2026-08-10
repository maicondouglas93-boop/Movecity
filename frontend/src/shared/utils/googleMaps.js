/**
 * Monta URL de navegação do Google Maps até um destino. Prefere coordenadas
 * (mais preciso, não depende de geocoding do lado do Google) e cai pro
 * endereço em texto quando não há coordenada disponível.
 */
export function buildGoogleMapsUrl({ lat, lng, address } = {}) {
  if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
  }
  if (address) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`
  }
  return null
}

export function openInGoogleMaps({ lat, lng, address } = {}) {
  const url = buildGoogleMapsUrl({ lat, lng, address })
  if (!url) return false
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}
