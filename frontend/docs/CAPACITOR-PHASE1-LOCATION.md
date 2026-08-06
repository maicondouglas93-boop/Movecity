# Capacitor Fase 1 — GPS nativo + Foreground Service

Data: 2026-08-05

## Regras preservadas

- **ONLINE/OFFLINE** = disponibilidade (`POST /captains/toggle-online`). Não é o botão GO.
- **GO** = navega para `/captain-presential` e inicia corrida presencial. Não altera `isOnline`.

## Como o GPS funciona

1. `LocationProvider` mantém `watchPosition` (Capacitor Geolocation no APK).
2. `CaptainLocationBridge` decide se emite e com qual frequência:
   - ONLINE sem serviço: **10s**
   - Corrida / encomenda / presencial ativo: **5s**
   - OFFLINE sem serviço: **não emite** (FGS parado)
3. Emit: socket `update-location-captain` (identidade pelo `join` autenticado).
4. Sem internet: fila Dexie (máx. 20 pontos); no reconnect + join ack, `flushQueuedLocations` envia só o **último**.

## Foreground Service

- Plugin: `@capawesome-team/capacitor-android-foreground-service`
- Canal: `movecity_location`
- Start quando `isOnline || hasActiveTrip`
- `updateForegroundService` ao mudar texto (online → corrida/encomenda)
- Textos:
  - Online: “Você está online. Sua localização está ativa para serviços.”
  - Corrida: “Corrida em andamento. Localização ativa.”
  - Encomenda: “Encomenda em andamento. Localização ativa.”
  - Presencial: “Corrida presencial em andamento. Localização ativa.”

## Arquivos principais

| Arquivo | Papel |
|---------|--------|
| `shared/platform/location.service.js` | watch, permissões, FGS |
| `shared/services/captainLocationSync.js` | intervalos + emit/fila |
| `driver/components/CaptainLocationBridge.jsx` | ponte única React |
| `driver/components/CaptainDetails.jsx` | toggle ONLINE + sync context |
