# Capacitor Fase 4 — Alertas secundários em background

Data: 2026-08-06

## Problema

Com app em background/morto, pushes data-only (chat, pagamento, cancelamento…) não desenhavam notificação nativa — só ofertas NEW_RIDE/NEW_PARCEL tinham UI.

## Entregue

- `DriverAlertNotifier` — canal `driver_alerts_v1`, tap abre app no `deepLink`
- `MoveCityMessagingService` — background não-oferta → bandeja; oferta → full-screen; foreground → Capacitor
- Backend `sendToCaptain` — split android/web; Android data-only + `priority: high`; `type` no payload data

## Tipos cobertos (via sendToCaptain)

CHAT, RIDE_CANCELLED, PAYMENT, RECHARGE, DOCUMENT, etc.

## Não altera

ONLINE/OFFLINE, GO, fluxo de oferta full-screen.
