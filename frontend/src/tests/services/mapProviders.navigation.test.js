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
    const mod = await import('@/services/maps/googleMapsProvider')
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

    it('ignora rotação em marcador de imagem em vez de quebrar o ícone', async () => {
        const provider = await loadGoogleProvider()
        await initProvider(provider)

        provider.placeMarker('captain', { lat: -23.5, lng: -46.6 }, { type: 'car' })
        expect(() => provider.setMarkerRotation('captain', 90)).not.toThrow()
        expect(() => provider.setMarkerRotation('inexistente', 90)).not.toThrow()

        const marker = currentStub.markerInstances[currentStub.markerInstances.length - 1]
        expect(marker.icon.url).toBeTruthy()
    })
})

describe('leafletProvider — degradação sem câmera (Fase D)', () => {
    it('declara que não suporta câmera, mas ainda aplica centro e zoom', async () => {
        vi.resetModules()
        const { createLeafletProvider } = await import('@/services/maps/leafletProvider')
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
        const { createLeafletProvider } = await import('@/services/maps/leafletProvider')
        const provider = createLeafletProvider()

        const node = document.createElement('div')
        node.style.width = '400px'
        node.style.height = '400px'
        document.body.appendChild(node)
        await provider.init(node, { center: { lat: -23.55, lng: -46.63 }, zoom: 14 })

        provider.placeMarker('navigator', { lat: -23.55, lng: -46.63 }, { type: 'navigator' })
        provider.setMarkerRotation('navigator', 45)

        const rotator = document.querySelector('.leaflet-navigator-rotator')
        expect(rotator).not.toBeNull()
        expect(rotator.style.transform).toBe('rotate(45deg)')
        // O transform do elemento externo é do Leaflet (posicionamento) — sobrescrevê-lo
        // jogaria o marcador para o canto da tela.
        expect(rotator.parentElement.style.transform).not.toContain('rotate(45deg)')

        provider.destroy()
    })
})
