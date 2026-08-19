import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import { vehicleMarkerImages } from '../../assets/vehicleAssets'

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

// Fase D (2026-08-03): heading/tilt só existem em mapa VETORIAL, e mapa vetorial exige
// um Map ID criado no Console. Sem essa variável o mapa continua funcionando igual a
// antes (raster), apenas sem câmera de navegação — por isso ela é opcional aqui, não
// um requisito duro que quebraria as outras telas.
const MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || null

// Usa google.maps.Marker (legado, ainda funcional) em vez de AdvancedMarkerElement.
// A decisão original era não depender de Map ID; a Fase D passou a usar um (para a
// câmera vetorial), mas o marcador legado continua porque funciona igual nos dois
// tipos de mapa e evita reescrever todos os marcadores das outras telas. Só aceita
// ícones de imagem, não HTML, então a aproximação visual é por SVG/emoji, não
// idêntica ao divIcon do Leaflet. pickup/destination reaproveitam o path SVG original (já eram
// SVG puro, não dependiam de fonte de ícone — por isso ficam bem próximos do original).
const VEHICLE_IMAGE_BY_TYPE = {
    car: vehicleMarkerImages.car,
    moto: vehicleMarkerImages.moto,
    motorcycle: vehicleMarkerImages.motorcycle,
    car_motorcycle: vehicleMarkerImages.car,
    auto: vehicleMarkerImages.auto,
}

// Fase C (2026-08-03): o ícone ganhou um ponteiro externo que indica a direção do
// motorista. O emoji continua sempre em pé de propósito — girar o círculo inteiro só
// deixaria o emoji tombado, sem comunicar direção (um 🚗 de lado não é uma seta). Sem
// heading conhecido (motorista parado ou recém-visto) o ponteiro não é desenhado, em vez
// de apontar para o norte e mentir.
// Sem círculo/fundo por trás — só a imagem do veículo, embutida como <image> dentro do
// mesmo SVG do ponteiro de direção (google.maps.Marker só aceita UM ícone de imagem, daí
// os dois precisarem estar na mesma URI, diferente do divIcon do Leaflet).
function vehicleIconUrl(type, rotation = null) {
    const imgSrc = VEHICLE_IMAGE_BY_TYPE[type] || VEHICLE_IMAGE_BY_TYPE.car
    const pointer = Number.isFinite(rotation)
        ? `<g transform="rotate(${rotation.toFixed(0)} 24 24)"><path d="M 24,2 L 29.5,12.5 L 18.5,12.5 Z" fill="#111827" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/></g>`
        : ''
    // xlink:href além de href: renderizadores de SVG-como-imagem mais antigos (incluindo
    // WebViews Android antigas, que é justamente onde o app do motorista roda) ignoram o
    // href simples do SVG 2 e só entendem o xlink do SVG 1.1.
    return svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="48" height="48" viewBox="0 0 48 48">${pointer}<image href="${imgSrc}" xlink:href="${imgSrc}" x="9" y="9" width="30" height="30"/></svg>`)
}

const USER_ICON_URL = svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#3b82f6" fill-opacity="0.35"/><circle cx="10" cy="10" r="6" fill="#2563eb" stroke="#fff" stroke-width="2"/></svg>`)

// Marcador do modo navegação (tipo 'navigator'). Diferente dos demais, é um Symbol
// (path SVG), não uma imagem: só Symbol aceita `rotation` nativamente no Google Maps —
// com ícone de imagem seria preciso regerar o data-URI a cada grau girado, caríssimo
// num loop de animação. Formato de seta, o mesmo vocabulário visual de Waze/Google
// Maps em navegação (o carro vira uma seta que aponta para onde você vai).
const NAVIGATOR_PATH = 'M 0,-9 L 6.5,8 L 0,4 L -6.5,8 Z'

// path original: M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z
const pinIconUrl = (bgColor) => svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="12.5" fill="${bgColor}" stroke="#fff" stroke-width="3"/><g transform="translate(7,7) scale(0.5833)"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#fff"/></g></svg>`)
const PICKUP_ICON_URL = pinIconUrl('#16a34a')
const DESTINATION_ICON_URL = pinIconUrl('#dc2626')

// Implementação Google Maps JS do contrato descrito em mapContract.js.
export function createGoogleMapsProvider() {
    let googleMaps = null // namespace { Map, Marker, Polyline, Circle, LatLngBounds, ... }
    let map = null
    const markers = {}
    // Fase D: o Google não expõe o tipo/rotação de volta a partir do marcador, e
    // reconstruir o Symbol exige os dois — então guardamos por id.
    const markerTypes = {}
    const markerRotations = {}
    let routeLine = null
    let radiusCircle = null
    let vectorMap = false

    function resolveIcon(type, rotation = null) {
        if (type === 'navigator') {
            return {
                path: NAVIGATOR_PATH,
                rotation: rotation ?? 0,
                scale: 1.7,
                fillColor: '#111111',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 2,
                anchor: new googleMaps.Point(0, 0),
            }
        }
        let url, size, anchor
        if (type === 'user') {
            url = USER_ICON_URL; size = 20; anchor = 10
        } else if (type === 'pickup') {
            url = PICKUP_ICON_URL; size = 28; anchor = 14
        } else if (type === 'destination') {
            url = DESTINATION_ICON_URL; size = 28; anchor = 14
        } else {
            url = vehicleIconUrl(type, rotation); size = 48; anchor = 24
        }
        return {
            url,
            scaledSize: new googleMaps.Size(size, size),
            anchor: new googleMaps.Point(anchor, anchor),
        }
    }

    function placeMarker(id, position, options = {}) {
        if (!map) return
        markerTypes[id] = options.type
        const icon = resolveIcon(options.type, markerRotations[id] ?? null)
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
        if (!marker) return
        markerTypes[id] = type
        marker.setIcon(resolveIcon(type, markerRotations[id] ?? null))
    }

    // O Symbol do tipo 'navigator' gira nativamente, de graça — é o que sustenta o loop de
    // navegação a 60fps. Os ícones de veículo são imagens e exigem regerar o data-URI, o
    // que só é viável porque quem os usa (frota no mapa do passageiro) chama isto no
    // máximo a cada poucos segundos por motorista, e não a cada frame.
    function setMarkerRotation(id, degrees) {
        const marker = markers[id]
        const type = markerTypes[id]
        if (!marker || !Number.isFinite(degrees) || type === 'user' || type === 'pickup' || type === 'destination') return
        if (markerRotations[id] === degrees) return
        markerRotations[id] = degrees
        marker.setIcon(resolveIcon(type, degrees))
    }

    function removeMarker(id) {
        const marker = markers[id]
        if (marker) {
            marker.setMap(null)
            delete markers[id]
            delete markerTypes[id]
            delete markerRotations[id]
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
            // Google não tem maxZoom nativo no fitBounds — limita depois do idle.
            if (Number.isFinite(options.maxZoom)) {
                googleMaps.event.addListenerOnce(map, 'idle', () => {
                    if (map && map.getZoom() > options.maxZoom) map.setZoom(options.maxZoom)
                })
            }
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

    function supportsCamera() {
        return vectorMap
    }

    // Sem animação própria: quem chama já interpola quadro a quadro. `moveCamera` do
    // Google é justamente a API instantânea (ao contrário de panTo/setZoom, que animam)
    // e aplica center+zoom+heading+tilt numa transação só — evitando o tremor de
    // aplicar cada eixo em chamadas separadas.
    function moveCamera({ center, heading, tilt, zoom } = {}) {
        if (!map) return
        const camera = {}
        if (center) camera.center = { lat: center.lat, lng: center.lng }
        if (Number.isFinite(zoom)) camera.zoom = zoom
        // Mapa raster ignora heading/tilt; mandar mesmo assim só polui o console.
        if (vectorMap) {
            if (Number.isFinite(heading)) camera.heading = heading
            if (Number.isFinite(tilt)) camera.tilt = tilt
        }
        if (typeof map.moveCamera === 'function') {
            map.moveCamera(camera)
            return
        }
        // Versões antigas da API JS não têm moveCamera — degrada para os setters.
        if (camera.center) map.setCenter(camera.center)
        if (camera.zoom != null) map.setZoom(camera.zoom)
        if (camera.heading != null) map.setHeading(camera.heading)
        if (camera.tilt != null) map.setTilt(camera.tilt)
    }

    function destroy() {
        Object.values(markers).forEach(m => m.setMap(null))
        Object.keys(markers).forEach(k => delete markers[k])
        Object.keys(markerTypes).forEach(k => delete markerTypes[k])
        Object.keys(markerRotations).forEach(k => delete markerRotations[k])
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

        // Fase D (2026-08-03): com Map ID vetorial o mapa aceita heading/tilt (câmera de
        // navegação). Sem ele o Google entrega raster e ignora os dois — o app continua
        // funcionando, só sem navegação rotacionada (ver supportsCamera).
        const mapOptions = {
            center: { lat: center.lat, lng: center.lng },
            zoom,
            disableDefaultUI: true,
            zoomControl: false,
            clickableIcons: false,
        }
        if (MAP_ID) mapOptions.mapId = MAP_ID

        map = new googleMaps.Map(domNode, mapOptions)

        // `getRenderingType()` é a resposta da própria API sobre o que ela realmente
        // entregou — mais confiável que assumir vetorial só porque um Map ID foi
        // passado (um Map ID configurado como raster no Console cairia na armadilha de
        // girar a câmera sem nada acontecer na tela). Logo após o construtor ele ainda
        // pode responder 'UNINITIALIZED', então o valor definitivo chega pelo evento.
        const readRenderingType = () => {
            if (typeof map.getRenderingType !== 'function') return Boolean(MAP_ID)
            const type = map.getRenderingType()
            if (type === 'UNINITIALIZED') return Boolean(MAP_ID)
            return type === 'VECTOR'
        }
        vectorMap = readRenderingType()
        map.addListener('renderingtype_changed', () => {
            vectorMap = readRenderingType()
            // Um Map ID configurado como RASTER no Console é o modo de falha mais
            // traiçoeiro daqui: tudo carrega, nada dá erro, e a câmera simplesmente
            // não gira. Sem este aviso, o sintoma seria "a navegação não funciona"
            // sem nenhuma pista de onde olhar.
            if (MAP_ID && !vectorMap) {
                console.warn(
                    `[maps] O Map ID "${MAP_ID}" está renderizando como RASTER. ` +
                    'A navegação do motorista (rotação e inclinação da câmera) exige um ' +
                    'Map ID VETORIAL — verifique o tipo dele no Google Cloud Console.'
                )
            }
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
        setMarkerRotation,
        removeMarker,
        setRoute,
        removeRoute,
        setCircle,
        removeCircle,
        fitBounds,
        panTo,
        moveCamera,
        supportsCamera,
        destroy,
    }
}
