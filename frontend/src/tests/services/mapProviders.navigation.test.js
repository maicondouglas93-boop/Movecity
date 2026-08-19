import { describe, it, expect, vi, beforeEach } from 'vitest'

// Fase D da experiência de corrida ativa (2026-08-03): contrato de câmera dos
// providers de mapa. Rotação, tilt e "câmera segue o veículo" não dá para verificar
// olhando um print — aqui a verificação é sobre o que cada provider REALMENTE manda
// para a biblioteca, inclusive o caso que falha em silêncio na vida real: mapa raster
// (sem Map ID vetorial) aceita heading/tilt sem reclamar e simplesmente ignora.

// ---- Dublê do namespace google.maps ----
const makeGoogleStub = ({ renderingType = 'VECTOR' } = {}) => {
    const mapInstance = {
        moveCamera: vi.fn(),
        setCenter: vi.fn(),
        setZoom: vi.fn(),
        getRenderingType: () => renderingType,
        addListener: vi.fn(),
    }
    const markerInstances = []
    const MapCtor = vi.fn(function (node, options) {
        mapInstance.options = options
        return mapInstance
    })
    const MarkerCtor = vi.fn(function (options) {
        const marker = {
            options,
            icon: options.icon,
            setIcon: vi.fn(function (icon) { marker.icon = icon }),
            setPosition: vi.fn(),
            setMap: vi.fn(),
        }
        markerInstances.push(marker)
        return marker
    })
    return {
        namespace: {
            Map: MapCtor,
            Marker: MarkerCtor,
            Polyline: vi.fn(() => ({ setMap: vi.fn(), setPath: vi.fn() })),
            Circle: vi.fn(() => ({ setMap: vi.fn() })),
            LatLngBounds: vi.fn(() => ({ extend: vi.fn(), isEmpty: () => false })),
            Point: function (x, y) { this.x = x; this.y = y },
            Size: function (w, h) { this.w = w; this.h = h },
            event: { trigger: vi.fn() },
        },
        mapInstance,
        markerInstances,
        MapCtor,
    }
}

let currentStub = null
vi.mock('@googlemaps/js-api-loader', () => ({
    setOptions: vi.fn(),
    importLibrary: vi.fn(async () => currentStub.namespace),
}))

const loadGoogleProvider = async () => {
    // Reimportado a cada teste: o Map ID é lido no topo do módulo (constante), então
    // trocar import.meta.env exige limpar o cache de módulos.
    vi.resetModules()
    const mod = await import('@/shared/services/maps/googleMapsProvider')
    return mod.createGoogleMapsProvider()
}

const initProvider = async (provider) => {
    // O provider lê o namespace de window.google.maps (padrão da API moderna: o loader
    // popula o global), não do retorno de importLibrary.
    window.google = { maps: currentStub.namespace }
    const node = document.createElement('div')
    document.body.appendChild(node)
    await provider.init(node, { center: { lat: -23.55, lng: -46.63 }, zoom: 14 })
    return node
}

describe('googleMapsProvider — câmera de navegação (Fase D)', () => {
    beforeEach(() => {
        currentStub = makeGoogleStub()
        vi.stubEnv('VITE_GOOGLE_MAPS_MAP_ID', 'movecity-nav-map')
    })

    it('cria o mapa com o Map ID configurado (é o que habilita o mapa vetorial)', async () => {
        const provider = await loadGoogleProvider()
        await initProvider(provider)

        expect(currentStub.MapCtor).toHaveBeenCalled()
        expect(currentStub.MapCtor.mock.calls[0][1].mapId).toBe('movecity-nav-map')
    })

    it('em mapa vetorial, aplica heading e tilt junto com centro e zoom', async () => {
        const provider = await loadGoogleProvider()
        await initProvider(provider)

        expect(provider.supportsCamera()).toBe(true)

        provider.moveCamera({ center: { lat: -23.5, lng: -46.6 }, heading: 137, tilt: 55, zoom: 17.5 })

        expect(currentStub.mapInstance.moveCamera).toHaveBeenCalledWith({
            center: { lat: -23.5, lng: -46.6 },
            zoom: 17.5,
            heading: 137,
            tilt: 55,
        })
    })

    it('em mapa raster, NÃO manda heading/tilt — o Google os ignoraria em silêncio', async () => {
        currentStub = makeGoogleStub({ renderingType: 'RASTER' })
        const provider = await loadGoogleProvider()
        await initProvider(provider)

        expect(provider.supportsCamera()).toBe(false)

        provider.moveCamera({ center: { lat: -23.5, lng: -46.6 }, heading: 137, tilt: 55, zoom: 17 })

        const camera = currentStub.mapInstance.moveCamera.mock.calls[0][0]
        expect(camera).toEqual({ center: { lat: -23.5, lng: -46.6 }, zoom: 17 })
    })

    it('sem Map ID, não inventa um e reporta que não há câmera de navegação', async () => {
        vi.stubEnv('VITE_GOOGLE_MAPS_MAP_ID', '')
        currentStub = makeGoogleStub({ renderingType: 'RASTER' })
        const provider = await loadGoogleProvider()
        await initProvider(provider)

        expect(currentStub.MapCtor.mock.calls[0][1].mapId).toBeUndefined()
        expect(provider.supportsCamera()).toBe(false)
    })

    it('gira o marcador de navegação atualizando a rotação do Symbol', async () => {
        const provider = await loadGoogleProvider()
        await initProvider(provider)

        provider.placeMarker('navigator', { lat: -23.5, lng: -46.6 }, { type: 'navigator' })
        provider.setMarkerRotation('navigator', 212)

        const marker = currentStub.markerInstances[currentStub.markerInstances.length - 1]
        expect(marker.icon.rotation).toBe(212)
        // Symbol (path), não ícone de imagem: é o que permite girar sem regerar o SVG.
        expect(marker.icon.path).toBeTruthy()
        expect(marker.icon.url).toBeUndefined()
    })

    it('preserva a rotação ao reposicionar o marcador (não volta a apontar para o norte)', async () => {
        const provider = await loadGoogleProvider()
        await initProvider(provider)

        provider.placeMarker('navigator', { lat: -23.5, lng: -46.6 }, { type: 'navigator' })
        provider.setMarkerRotation('navigator', 90)
        provider.placeMarker('navigator', { lat: -23.4, lng: -46.5 }, { type: 'navigator' })

        const marker = currentStub.markerInstances[currentStub.markerInstances.length - 1]
        expect(marker.icon.rotation).toBe(90)
    })

    it('gira o marcador de veículo regerando o SVG, sem ponteiro antes de haver rumo', async () => {
        const provider = await loadGoogleProvider()
        await initProvider(provider)

        provider.placeMarker('driver_1', { lat: -23.5, lng: -46.6 }, { type: 'car' })
        const marker = currentStub.markerInstances[currentStub.markerInstances.length - 1]
        const semRumo = decodeURIComponent(marker.icon.url)
        expect(semRumo).not.toContain('rotate(')

        provider.setMarkerRotation('driver_1', 90)
        const comRumo = decodeURIComponent(marker.icon.url)
        expect(comRumo).toContain('rotate(90 24 24)')
        // Continua sendo imagem (não vira Symbol) e mantém o mesmo ponto de ancoragem,
        // senão o marcador saltaria no mapa ao ganhar direção.
        expect(marker.icon.path).toBeUndefined()
        expect(marker.icon.anchor).toEqual({ x: 24, y: 24 })
    })

    it('usa ícone neutro e distinto para motorista autorizado a carro e moto', async () => {
        const provider = await loadGoogleProvider()
        await initProvider(provider)

        provider.placeMarker('driver_both', { lat: -23.5, lng: -46.6 }, { type: 'car_motorcycle' })
        const marker = currentStub.markerInstances[currentStub.markerInstances.length - 1]
        const svg = decodeURIComponent(marker.icon.url)

        expect(svg).toContain('#6d28d9')
        expect(svg).toContain('◎')
        expect(svg).not.toContain('🚗')
        expect(svg).not.toContain('🏍')
    })

    it('mantém os ícones existentes de carro e moto distintos do ícone neutro', async () => {
        const provider = await loadGoogleProvider()
        await initProvider(provider)

        provider.placeMarker('driver_car', { lat: -23.5, lng: -46.6 }, { type: 'car' })
        const carSvg = decodeURIComponent(currentStub.markerInstances.at(-1).icon.url)
        provider.placeMarker('driver_moto', { lat: -23.4, lng: -46.5 }, { type: 'motorcycle' })
        const motorcycleSvg = decodeURIComponent(currentStub.markerInstances.at(-1).icon.url)

        // Carro e moto passaram a usar a arte real do veículo (PNG embutido em base64
        // dentro do SVG), no lugar do emoji sobre círculo preto. O que importa continua
        // sendo o mesmo: cada um traz uma imagem, e nenhum deles é o marcador neutro.
        expect(carSvg).toContain('data:image/png;base64,')
        expect(carSvg).not.toContain('#6d28d9')
        expect(motorcycleSvg).toContain('data:image/png;base64,')
        expect(motorcycleSvg).not.toContain('#6d28d9')
        expect(carSvg).not.toBe(motorcycleSvg)
    })

    it('ignora rotação em marcadores que não representam direção', async () => {
        const provider = await loadGoogleProvider()
        await initProvider(provider)

        provider.placeMarker('user', { lat: -23.5, lng: -46.6 }, { type: 'user' })
        const antes = currentStub.markerInstances[currentStub.markerInstances.length - 1].icon.url

        expect(() => provider.setMarkerRotation('user', 90)).not.toThrow()
        expect(() => provider.setMarkerRotation('inexistente', 90)).not.toThrow()

        const marker = currentStub.markerInstances[currentStub.markerInstances.length - 1]
        expect(marker.icon.url).toBe(antes)
    })
})

describe('leafletProvider — degradação sem câmera (Fase D)', () => {
    it('declara que não suporta câmera, mas ainda aplica centro e zoom', async () => {
        vi.resetModules()
        const { createLeafletProvider } = await import('@/shared/services/maps/leafletProvider')
        const provider = createLeafletProvider()

        const node = document.createElement('div')
        node.style.width = '400px'
        node.style.height = '400px'
        document.body.appendChild(node)
        await provider.init(node, { center: { lat: -23.55, lng: -46.63 }, zoom: 14 })

        expect(provider.supportsCamera()).toBe(false)
        // Não pode lançar: o LiveTracking chama moveCamera igual nos dois providers e
        // conta com a degradação silenciosa.
        expect(() => provider.moveCamera({ center: { lat: -23.5, lng: -46.6 }, heading: 90, tilt: 55, zoom: 17 })).not.toThrow()

        provider.destroy()
    })

    it('gira o conteúdo do marcador, nunca o elemento posicionado pelo Leaflet', async () => {
        vi.resetModules()
        const { createLeafletProvider } = await import('@/shared/services/maps/leafletProvider')
        const provider = createLeafletProvider()

        const node = document.createElement('div')
        node.style.width = '400px'
        node.style.height = '400px'
        document.body.appendChild(node)
        await provider.init(node, { center: { lat: -23.55, lng: -46.63 }, zoom: 14 })

        provider.placeMarker('navigator', { lat: -23.55, lng: -46.63 }, { type: 'navigator' })
        provider.setMarkerRotation('navigator', 45)

        const rotator = document.querySelector('.leaflet-marker-rotator')
        expect(rotator).not.toBeNull()
        expect(rotator.style.transform).toBe('rotate(45deg)')
        // O transform do elemento externo é do Leaflet (posicionamento) — sobrescrevê-lo
        // jogaria o marcador para o canto da tela.
        expect(rotator.parentElement.style.transform).not.toContain('rotate(45deg)')

        provider.destroy()
    })

    it('mantém o ponteiro de direção do veículo invisível até haver rumo conhecido', async () => {
        vi.resetModules()
        const { createLeafletProvider } = await import('@/shared/services/maps/leafletProvider')
        const provider = createLeafletProvider()

        const node = document.createElement('div')
        node.style.width = '400px'
        node.style.height = '400px'
        document.body.appendChild(node)
        await provider.init(node, { center: { lat: -23.55, lng: -46.63 }, zoom: 14 })

        provider.placeMarker('driver_1', { lat: -23.55, lng: -46.63 }, { type: 'car' })

        const rotator = document.querySelector('.leaflet-marker-rotator')
        // Motorista recém-visto ainda não tem rumo: apontar para o norte seria mentira.
        expect(rotator.style.opacity).toBe('0')

        provider.setMarkerRotation('driver_1', 120)
        expect(rotator.style.transform).toBe('rotate(120deg)')
        expect(rotator.style.opacity).toBe('1')

        provider.destroy()
    })

    it('usa marcador neutro no Leaflet para autorização carro e moto', async () => {
        vi.resetModules()
        const { createLeafletProvider } = await import('@/shared/services/maps/leafletProvider')
        const provider = createLeafletProvider()
        const node = document.createElement('div')
        node.style.width = '400px'
        node.style.height = '400px'
        document.body.appendChild(node)
        await provider.init(node, { center: { lat: -23.55, lng: -46.63 }, zoom: 14 })

        provider.placeMarker('driver_both', { lat: -23.55, lng: -46.63 }, { type: 'car_motorcycle' })

        const icon = document.querySelector('.ri-user-location-fill')
        expect(icon).not.toBeNull()
        expect(icon.className).not.toContain('ri-car-fill')
        expect(icon.className).not.toContain('ri-motorbike-fill')
        provider.destroy()
    })
})
