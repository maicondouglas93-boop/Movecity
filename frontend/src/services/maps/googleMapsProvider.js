import { setOptions, importLibrary } from '@googlemaps/js-api-loader'

let optionsSet = false
let mapsLibraryPromise = null
function loadMapsLibrary() {
    if (!optionsSet) {
        setOptions({
            key: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
            v: 'weekly',
        })
        optionsSet = true
    }
    if (!mapsLibraryPromise) {
        mapsLibraryPromise = importLibrary('maps')
    }
    return mapsLibraryPromise
}

function svgDataUri(svg) {
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg)
}

// Usa google.maps.Marker (legado, ainda funcional) em vez de AdvancedMarkerElement —
// decisão explícita para não depender de um Map ID do Console. Só aceita ícones de
// imagem, não HTML, então a aproximação visual é por SVG/emoji, não idêntica ao
// divIcon do Leaflet. pickup/destination reaproveitam o path SVG original (já eram
// SVG puro, não dependiam de fonte de ícone — por isso ficam bem próximos do original).
const VEHICLE_EMOJI = {
    car: '🚗',
    moto: '🏍',
    motorcycle: '🏍',
    auto: '🚕',
}

function vehicleIconUrl(type) {
    const emoji = VEHICLE_EMOJI[type] || VEHICLE_EMOJI.car
    const ringColor = type === 'auto' ? '#facc15' : '#ffffff' // aproxima o acento amarelo do "auto" original
    return svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="#000" stroke="${ringColor}" stroke-width="2"/><text x="20" y="27" font-size="18" text-anchor="middle">${emoji}</text></svg>`)
}

const USER_ICON_URL = svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#3b82f6" fill-opacity="0.35"/><circle cx="10" cy="10" r="6" fill="#2563eb" stroke="#fff" stroke-width="2"/></svg>`)

// path original: M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z
const pinIconUrl = (bgColor) => svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="12.5" fill="${bgColor}" stroke="#fff" stroke-width="3"/><g transform="translate(7,7) scale(0.5833)"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#fff"/></g></svg>`)
const PICKUP_ICON_URL = pinIconUrl('#16a34a')
const DESTINATION_ICON_URL = pinIconUrl('#dc2626')

// Implementação Google Maps JS do contrato descrito em mapContract.js.
export function createGoogleMapsProvider() {
    let googleMaps = null // namespace { Map, Marker, Polyline, Circle, LatLngBounds, ... }
    let map = null
    const markers = {}
    let routeLine = null
    let radiusCircle = null

    function resolveIcon(type) {
        let url, size, anchor
        if (type === 'user') {
            url = USER_ICON_URL; size = 20; anchor = 10
        } else if (type === 'pickup') {
            url = PICKUP_ICON_URL; size = 28; anchor = 14
        } else if (type === 'destination') {
            url = DESTINATION_ICON_URL; size = 28; anchor = 14
        } else {
            url = vehicleIconUrl(type); size = 40; anchor = 20
        }
        return {
            url,
            scaledSize: new googleMaps.Size(size, size),
            anchor: new googleMaps.Point(anchor, anchor),
        }
    }

    function placeMarker(id, position, options = {}) {
        if (!map) return
        const icon = resolveIcon(options.type)
        const existing = markers[id]
        if (existing) {
            existing.setPosition({ lat: position.lat, lng: position.lng })
            existing.setIcon(icon)
        } else {
            const marker = new googleMaps.Marker({
                position: { lat: position.lat, lng: position.lng },
                map,
                icon,
                title: options.title,
            })
            if (options.tooltip) {
                marker.addListener('mouseover', () => marker.setTitle(options.tooltip))
            }
            markers[id] = marker
        }
    }

    function moveMarker(id, position) {
        const marker = markers[id]
        if (marker) marker.setPosition({ lat: position.lat, lng: position.lng })
    }

    function setMarkerIcon(id, type) {
        const marker = markers[id]
        if (marker) marker.setIcon(resolveIcon(type))
    }

    function removeMarker(id) {
        const marker = markers[id]
        if (marker) {
            marker.setMap(null)
            delete markers[id]
        }
    }

    function setRoute(coords, options = {}) {
        if (!map) return
        const path = coords.map(([lat, lng]) => ({ lat, lng }))
        if (routeLine) {
            routeLine.setPath(path)
        } else {
            routeLine = new googleMaps.Polyline({
                path,
                strokeColor: options.color || '#111111',
                strokeWeight: options.weight || 6,
                strokeOpacity: options.opacity ?? 0.9,
                map,
            })
        }
    }

    function removeRoute() {
        if (routeLine) {
            routeLine.setMap(null)
            routeLine = null
        }
    }

    function setCircle(position, options = {}) {
        if (!map) return
        const center = { lat: position.lat, lng: position.lng }
        if (radiusCircle) {
            radiusCircle.setCenter(center)
        } else {
            radiusCircle = new googleMaps.Circle({
                center,
                radius: options.radius || 3000,
                strokeColor: options.color || '#3b82f6',
                strokeWeight: options.weight ?? 1.5,
                fillColor: options.fillColor || '#3b82f6',
                fillOpacity: options.fillOpacity ?? 0.08,
                map,
            })
        }
    }

    function removeCircle() {
        if (radiusCircle) {
            radiusCircle.setMap(null)
            radiusCircle = null
        }
    }

    function fitBounds(coords, options = {}) {
        if (!map || !coords || coords.length === 0) return false
        try {
            const bounds = new googleMaps.LatLngBounds()
            coords.forEach(([lat, lng]) => bounds.extend({ lat, lng }))
            const [px = 50, py = 50] = options.padding || [50, 50]
            map.fitBounds(bounds, { top: py, right: px, bottom: py, left: px })
            return true
        } catch (err) {
            console.warn('Google Maps fitBounds error:', err)
            return false
        }
    }

    function panTo(position, options = {}) {
        if (!map) return
        const center = { lat: position.lat, lng: position.lng }
        if (options.animate === false) {
            map.setCenter(center) // salto instantâneo, sem animação (usado no loop de interpolação do capitão)
        } else {
            map.panTo(center)
        }
    }

    function invalidateSize() {
        if (map) googleMaps.event.trigger(map, 'resize')
    }

    function destroy() {
        Object.values(markers).forEach(m => m.setMap(null))
        Object.keys(markers).forEach(k => delete markers[k])
        if (routeLine) { routeLine.setMap(null); routeLine = null }
        if (radiusCircle) { radiusCircle.setMap(null); radiusCircle = null }
        map = null // Google não expõe um "map.remove()"; sem containerRef, o GC cuida do resto
    }

    async function init(domNode, { center, zoom = 15, onMoveEnd, onDragStart, onZoomStart } = {}) {
        await loadMapsLibrary()
        // importLibrary('maps') só devolve {Map, ...} no objeto retornado. Classes como
        // Size, Point, LatLngBounds, Marker, Polyline, Circle e event ficam disponíveis
        // no namespace global window.google.maps assim que qualquer importLibrary resolve
        // — é o padrão recomendado pela própria Google para a API modular.
        googleMaps = window.google.maps

        map = new googleMaps.Map(domNode, {
            center: { lat: center.lat, lng: center.lng },
            zoom,
            disableDefaultUI: true,
            zoomControl: false,
            clickableIcons: false,
        })

        placeMarker('user', center, { type: 'user' })

        // 'idle' é o equivalente do Google a 'moveend' do Leaflet: dispara quando o
        // mapa termina de assentar após qualquer pan/zoom (usuário ou programático).
        if (onMoveEnd) {
            map.addListener('idle', () => {
                const c = map.getCenter()
                onMoveEnd({ lat: c.lat(), lng: c.lng() })
            })
        }
        if (onDragStart) map.addListener('dragstart', onDragStart)
        // 'zoom_changed' dispara tanto em zoom do usuário quanto programático (ex:
        // fitBounds) — mesma abrangência do 'zoomstart' do Leaflet, que tem o mesmo
        // comportamento (replica o original, não é uma mudança de comportamento).
        if (onZoomStart) map.addListener('zoom_changed', onZoomStart)
    }

    return {
        init,
        invalidateSize,
        placeMarker,
        moveMarker,
        setMarkerIcon,
        removeMarker,
        setRoute,
        removeRoute,
        setCircle,
        removeCircle,
        fitBounds,
        panTo,
        destroy,
    }
}
