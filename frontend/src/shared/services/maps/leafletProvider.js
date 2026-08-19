import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { vehicleMarkerImages } from '../../assets/vehicleAssets'

// Fix default marker icon issue in Leaflet with Webpack/Vite
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
});

// Fase C (2026-08-03): ponteiro de direção. Nasce invisível e só aparece quando
// setMarkerRotation recebe um heading — motorista parado não aponta para lugar nenhum.
// Gira só o ponteiro: o ícone do veículo fica em pé para continuar legível.
const directionPointer = `
  <div class="leaflet-marker-rotator absolute inset-0" style="transform: rotate(0deg); transform-origin: 50% 50%; opacity: 0;">
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
      <path d="M 24,2 L 29.5,12.5 L 18.5,12.5 Z" fill="#111827" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>
  </div>
`;

// Ícone solto: sem círculo/fundo por trás, só a imagem do veículo — o círculo colorido
// escondia o desenho e, num "car_motorcycle" (motorista autorizado pros dois), não dava
// pra saber qual veículo estava vindo de verdade.
const vehicleIcon = (imgSrc) => L.divIcon({
    html: `
      <div class="relative h-12 w-12">
        ${directionPointer}
        <div class="absolute inset-0 flex items-center justify-center drop-shadow-lg">
          <img src="${imgSrc}" class="h-9 w-9 object-contain" alt="" />
        </div>
      </div>
    `,
    className: 'custom-vehicle-icon',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
});

// Motorista autorizado a carro E moto: continua com marcador neutro e distinto, de
// propósito. Não dá pra prometer ao passageiro qual veículo vai chegar, então desenhar
// um carro aqui seria mentir — mantém o símbolo neutro em vez de escolher por ele.
const neutralIcon = (iconClass, colorClasses) => L.divIcon({
    html: `
      <div class="relative h-12 w-12">
        ${directionPointer}
        <div class="absolute inset-2 flex items-center justify-center ${colorClasses} rounded-full border-2 border-white shadow-xl">
          <i class="${iconClass} text-lg"></i>
        </div>
      </div>
    `,
    className: 'custom-vehicle-icon',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
});

const vehicleIcons = {
    car: vehicleIcon(vehicleMarkerImages.car),
    moto: vehicleIcon(vehicleMarkerImages.moto),
    motorcycle: vehicleIcon(vehicleMarkerImages.motorcycle),
    car_motorcycle: neutralIcon('ri-user-location-fill', 'bg-violet-700 text-white'),
    auto: vehicleIcon(vehicleMarkerImages.auto),
};

const userPositionIcon = L.divIcon({
    html: `
      <div class="relative flex items-center justify-center h-5 w-5">
        <div class="absolute h-5 w-5 bg-blue-500 rounded-full animate-ping opacity-60"></div>
        <div class="h-3 w-3 bg-blue-600 rounded-full border-2 border-white shadow-md"></div>
      </div>
    `,
    className: 'user-position-icon',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
});

const pickupIcon = L.divIcon({
    html: `
      <div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:#16a34a;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="14" height="14"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
      </div>
    `,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 28],
});

const destinationIcon = L.divIcon({
    html: `
      <div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:#dc2626;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="14" height="14"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
      </div>
    `,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 28],
});

// Fase D (2026-08-03): marcador do modo navegação. O Leaflet não gira a câmera, mas
// gira o marcador sem problema (divIcon é DOM puro) — então o motorista pelo menos vê
// para onde o veículo aponta, mesmo no fallback 2D.
const navigatorIcon = L.divIcon({
    html: `
      <div class="leaflet-marker-rotator" style="transform: rotate(0deg); transform-origin: 50% 50%;">
        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="-12 -12 24 24">
          <path d="M 0,-9 L 6.5,8 L 0,4 L -6.5,8 Z" fill="#111111" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
        </svg>
      </div>
    `,
    className: 'navigator-icon',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
});

function resolveIcon(type) {
    if (type === 'user') return userPositionIcon;
    if (type === 'pickup') return pickupIcon;
    if (type === 'destination') return destinationIcon;
    if (type === 'navigator') return navigatorIcon;
    return vehicleIcons[type] || vehicleIcons.car;
}

// Implementação Leaflet do contrato descrito em mapContract.js.
// Cria uma nova instância isolada a cada chamada (estado guardado por closure,
// não em módulo) — permite múltiplas instâncias de LiveTracking montadas ao mesmo tempo
// sem compartilhar mapa/marcadores entre si.
export function createLeafletProvider() {
    let map = null;
    const markers = {};
    let routeLine = null;
    let radiusCircle = null;

    function placeMarker(id, position, options = {}) {
        if (!map) return;
        const icon = resolveIcon(options.type);
        const existing = markers[id];
        if (existing) {
            existing.setLatLng([position.lat, position.lng]);
            existing.setIcon(icon);
        } else {
            const marker = L.marker([position.lat, position.lng], { icon, title: options.title }).addTo(map);
            if (options.tooltip) {
                marker.bindTooltip(options.tooltip, { permanent: false, direction: 'top' });
            }
            markers[id] = marker;
        }
    }

    function moveMarker(id, position) {
        const marker = markers[id];
        if (marker) marker.setLatLng([position.lat, position.lng]);
    }

    function setMarkerIcon(id, type) {
        const marker = markers[id];
        if (marker) marker.setIcon(resolveIcon(type));
    }

    // Gira o CONTEÚDO do divIcon, nunca o elemento do marcador em si: o Leaflet usa o
    // `transform` do elemento externo para posicionar o marcador no mapa, e sobrescrevê-lo
    // faria o marcador saltar para o canto da tela.
    function setMarkerRotation(id, degrees) {
        const marker = markers[id];
        if (!marker || !Number.isFinite(degrees) || typeof marker.getElement !== 'function') return;
        const rotator = marker.getElement()?.querySelector('.leaflet-marker-rotator');
        if (!rotator) return;
        rotator.style.transform = `rotate(${degrees}deg)`;
        rotator.style.opacity = '1';
    }

    // Leaflet é 2D top-down: não existe heading nem tilt de câmera. Devolver false aqui
    // é o que permite ao LiveTracking escolher o fallback (mapa sem rotação, veículo
    // girando) em vez de fingir uma navegação que não acontece.
    function supportsCamera() {
        return false;
    }

    // Degradação graciosa: aplica o que o Leaflet tem (centro e zoom) e ignora
    // heading/tilt. `animate: false` porque quem chama já interpola quadro a quadro.
    function moveCamera({ center, zoom } = {}) {
        if (!map || !center) return;
        if (Number.isFinite(zoom)) {
            map.setView([center.lat, center.lng], zoom, { animate: false });
        } else {
            map.panTo([center.lat, center.lng], { animate: false });
        }
    }

    function removeMarker(id) {
        const marker = markers[id];
        if (marker && map) {
            map.removeLayer(marker);
            delete markers[id];
        }
    }

    function setRoute(coords, options = {}) {
        if (!map) return;
        if (routeLine) {
            routeLine.setLatLngs(coords);
        } else {
            routeLine = L.polyline(coords, {
                color: options.color || '#111111', // Uber black route line
                weight: options.weight || 6,
                opacity: options.opacity ?? 0.9
            }).addTo(map);
        }
    }

    function removeRoute() {
        if (routeLine && map) {
            map.removeLayer(routeLine);
            routeLine = null;
        }
    }

    function setCircle(position, options = {}) {
        if (!map) return;
        if (radiusCircle) {
            radiusCircle.setLatLng([position.lat, position.lng]);
        } else {
            radiusCircle = L.circle([position.lat, position.lng], {
                color: options.color || '#3b82f6', // Tailwind blue-500
                fillColor: options.fillColor || '#3b82f6',
                fillOpacity: options.fillOpacity ?? 0.08,
                radius: options.radius || 3000,
                weight: options.weight ?? 1.5,
                dashArray: options.dashArray || '5, 5'
            }).addTo(map);
        }
    }

    function removeCircle() {
        if (radiusCircle && map) {
            map.removeLayer(radiusCircle);
            radiusCircle = null;
        }
    }

    function fitBounds(coords, options = {}) {
        if (!map || !coords || coords.length === 0) return false;
        try {
            const bounds = L.latLngBounds(coords);
            const fitOpts = {
                padding: options.padding || [50, 50],
                animate: options.animate !== false,
            };
            // maxZoom evita que 1 ponto (ou valores quase iguais) estoure o zoom de rua.
            if (Number.isFinite(options.maxZoom)) fitOpts.maxZoom = options.maxZoom;
            map.fitBounds(bounds, fitOpts);
            return true;
        } catch (err) {
            console.warn('Leaflet fitBounds error:', err);
            return false;
        }
    }

    function panTo(position, options = {}) {
        if (!map) return;
        map.panTo([position.lat, position.lng], { animate: options.animate ?? false });
    }

    function invalidateSize() {
        if (map) map.invalidateSize();
    }

    function destroy() {
        if (map) {
            map.remove(); // remove() já limpa todas as layers (markers, polyline, circle)
            map = null;
        }
        Object.keys(markers).forEach(k => delete markers[k]);
        routeLine = null;
        radiusCircle = null;
    }

    // async por contrato (mapContract.js) mesmo não precisando de await aqui — o
    // provider google carrega a API JS de forma assíncrona, e LiveTracking.jsx trata
    // init() uniformemente como possivelmente assíncrono para os dois providers.
    async function init(domNode, { center, zoom = 15, onMoveEnd, onDragStart, onZoomStart } = {}) {
        map = L.map(domNode, { zoomControl: false }).setView([center.lat, center.lng], zoom);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        placeMarker('user', center, { type: 'user' });

        if (onMoveEnd) {
            map.on('moveend', () => {
                const c = map.getCenter();
                onMoveEnd({ lat: c.lat, lng: c.lng });
            });
        }
        if (onDragStart) map.on('dragstart', onDragStart);
        if (onZoomStart) map.on('zoomstart', onZoomStart);

        // Fix gray tiles on initial render
        setTimeout(() => {
            if (map) map.invalidateSize();
        }, 300);
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
        destroy
    };
}
