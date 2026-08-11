# Capacitor Fase 1 — GPS nativo + Foreground Service

Data: 2026-08-11

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
4. Em corrida ativa, cada ponto é gravado na fila Dexie antes do envio, associado à
   corrida e com `pointId` estável. No reconnect + join ack,
   `flushQueuedLocations` envia **todos** em ordem e só remove cada registro depois do
   ack do backend. A fila sobrevive a reinício do app.

## Limite conhecido: processo JavaScript encerrado

O Foreground Service mantém a notificação e melhora a sobrevivência do app em
background/tela bloqueada, mas o `watchPosition` e a gravação no Dexie continuam sendo
executados pelo processo JavaScript do Capacitor. Não existe neste projeto um coletor
Android nativo independente que grave pontos enquanto esse processo estiver morto.

Portanto:

- pontos que chegaram ao JavaScript ficam persistidos e são reenviados com segurança;
- perda temporária de internet não descarta esses pontos;
- se Android/OEM encerrar o processo JavaScript antes da coleta, o intervalo sem coleta
  não pode ser reconstruído pela fila;
- o cenário `background + tela bloqueada + offline + processo JS encerrado` permanece
  **não garantido** até existir buffer nativo e teste em dispositivo físico.

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
