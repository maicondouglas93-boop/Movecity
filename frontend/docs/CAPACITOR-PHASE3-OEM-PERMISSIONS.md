# Capacitor Fase 3 — Permissões OEM / full-screen

Data: 2026-08-06

## Objetivo

Guiar o motorista a liberar permissões que o Android/MIUI **não** concedem só com o dialog padrão — necessárias para oferta full-screen e GPS em background.

## Entregue

- Plugin nativo `NativeDriverPermissions`:
  - status: FSI (API 34+), battery optimization, família Xiaomi
  - atalhos: app settings, FSI settings, battery, autostart OEM, “outras permissões” MIUI
- Card `DriverOemPermissionsCard` na Home (dispensável, uma vez)
- Manifest: `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`
- Log no `RideOfferNotifier` se FSI estiver negada (API 34+)

## Não altera

- ONLINE/OFFLINE
- Botão GO / corrida presencial
