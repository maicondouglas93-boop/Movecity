// Contrato que qualquer provider de mapa do frontend (leaflet, google, ...) deve implementar.
// Documentação de referência — LiveTracking.jsx só conhece esta interface, nunca a
// biblioteca de mapa por baixo. Isso é o que torna a troca de provider (Etapa 6) segura:
// trocar o provider não deveria exigir tocar em LiveTracking.jsx.
//
// Tipos de marcador reconhecidos (campo `type` em placeMarker/setMarkerIcon):
//   'user'        — posição do usuário (ponto azul pulsante)
//   'pickup'      — pin verde de embarque
//   'destination' — pin vermelho de destino
//   'car' | 'moto' | 'motorcycle' | 'auto' — ícone de veículo do motorista
//
// IDs de marcador usados por LiveTracking.jsx: 'user', 'captain', 'pickup', 'destination'.
//
// @typedef {Object} LatLng
// @property {number} lat
// @property {number} lng
//
// @typedef {Object} MapProvider
// @property {(domNode: HTMLElement, opts: {center: LatLng, zoom?: number, onMoveEnd?: (center: LatLng) => void, onDragStart?: () => void, onZoomStart?: () => void}) => Promise<void>} init
//   Cria o mapa dentro de domNode, centrado em opts.center. Chamado uma única vez.
//   SEMPRE assíncrono por contrato (mesmo que um provider específico não precise
//   esperar nada) — o provider google carrega a API JS via rede antes de poder criar
//   o mapa; leaflet resolve a Promise imediatamente. Quem chama deve sempre aguardar.
// @property {() => void} invalidateSize
//   Força o mapa a recalcular suas dimensões (necessário após mudança de tamanho do container).
// @property {(id: string, position: LatLng, opts?: {type?: string, title?: string, tooltip?: string}) => void} placeMarker
//   Cria o marcador `id` se não existir, ou atualiza posição E ícone se já existir.
//   Uso: mudanças discretas de estado (não usar em loop de animação — ver moveMarker).
// @property {(id: string, position: LatLng) => void} moveMarker
//   Move um marcador já existente, sem tocar no ícone. Barato o suficiente para loop de animação (rAF).
// @property {(id: string, type: string) => void} setMarkerIcon
//   Troca só o ícone de um marcador já existente, sem tocar na posição.
// @property {(id: string) => void} removeMarker
// @property {(coords: [number, number][], opts?: {color?: string, weight?: number, opacity?: number}) => void} setRoute
//   Cria ou atualiza a polyline de rota. coords no formato [[lat,lng], ...].
// @property {() => void} removeRoute
// @property {(position: LatLng, opts?: {radius?: number, color?: string, fillColor?: string, fillOpacity?: number, weight?: number, dashArray?: string}) => void} setCircle
//   Cria ou atualiza o círculo de raio de busca.
// @property {() => void} removeCircle
// @property {(coords: [number, number][], opts?: {padding?: [number, number], animate?: boolean}) => boolean} fitBounds
//   Enquadra o mapa nas coordenadas dadas. Retorna true em sucesso, false se falhar (coords inválidas etc).
// @property {(position: LatLng, opts?: {animate?: boolean}) => void} panTo
// @property {() => void} destroy
//   Destroi o mapa e limpa todos os recursos (marcadores, rota, círculo, listeners).

export {}; // arquivo só de documentação/tipos, sem exports em runtime
