import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

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

const vehicleIcons = {
    car: L.divIcon({
        html: `
          <div class="flex items-center justify-center h-10 w-10 bg-black text-white rounded-full border-2 border-white shadow-xl">
            <i class="ri-car-fill text-xl"></i>
          </div>
        `,
        className: 'custom-vehicle-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
    }),
    moto: L.divIcon({
        html: `
          <div class="flex items-center justify-center h-10 w-10 bg-black text-white rounded-full border-2 border-white shadow-xl">
            <i class="ri-motorbike-fill text-xl"></i>
          </div>
        `,
        className: 'custom-vehicle-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
    }),
    motorcycle: L.divIcon({
        html: `
          <div class="flex items-center justify-center h-10 w-10 bg-black text-white rounded-full border-2 border-white shadow-xl">
            <i class="ri-motorbike-fill text-xl"></i>
          </div>
        `,
        className: 'custom-vehicle-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
    }),
    auto: L.divIcon({
        html: `
          <div class="flex items-center justify-center h-10 w-10 bg-black text-yellow-400 rounded-full border-2 border-white shadow-xl">
            <i class="ri-taxi-fill text-xl text-yellow-400"></i>
          </div>
        `,
        className: 'custom-vehicle-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
    }),
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

function resolveIcon(type) {
    if (type === 'user') return userPositionIcon;
    if (type === 'pickup') return pickupIcon;
    if (type === 'destination') return destinationIcon;
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
            map.fitBounds(bounds, { padding: options.padding || [50, 50], animate: options.animate !== false });
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
        removeMarker,
        setRoute,
        removeRoute,
        setCircle,
        removeCircle,
        fitBounds,
        panTo,
        destroy
    };
}
