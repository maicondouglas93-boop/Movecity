# Relatório — Capacitor Motorista (implementação)

Data: 2026-08-05

## Fase 1 GPS (2026-08-05, noite)

Ver `docs/CAPACITOR-PHASE1-LOCATION.md`.

- Bridge única `CaptainLocationBridge` (ONLINE 10s / serviço 5s / OFFLINE para).
- FGS Capawesome com `updateForegroundService` + textos por estado.
- GO preservado (só `/captain-presential`); não liga ONLINE.
- Toggle ONLINE sincroniza `CaptainContext` + pede permissão GPS.

## Fase 2 Ofertas / deep link (2026-08-05)

Ver `docs/CAPACITOR-PHASE2-OFFERS.md`.

- Deep link nativo → React (`NativeDeepLinkBridge`).
- Aceite morto com refresh JWT; pós-aceite `/captain-riding` ou `/captain-parcel`.
- `NEW_PARCEL` full-screen parity + backend `sendCaptainOfferPush`.
- Ícone FGS `ic_stat_movecity`.

## Fase 3 OEM / full-screen (2026-08-06)

Ver `docs/CAPACITOR-PHASE3-OEM-PERMISSIONS.md`.

- Plugin `NativeDriverPermissions` + card de onboarding na Home.
- Atalhos MIUI (autostart / outras permissões), FSI API 34+, bateria.

## Fase 4 Alertas secundários (2026-08-06)

Ver `docs/CAPACITOR-PHASE4-ALERTS.md`.

- `DriverAlertNotifier` para chat/pagamento/cancelamento em background.
- `sendToCaptain` com split Android data-only + priority high.

## CI/CD APK por TAG (2026-08-06)

Ver [`docs/ANDROID_RELEASE.md`](../../docs/ANDROID_RELEASE.md).

- `ci.yml` — push/PR (testes/build; sem Release)
- `android-release.yml` — só TAG `v*.*.*` (APK assinado + GitHub Release + SHA-256)

## Atualização in-app do APK (2026-08-06)

Ver `docs/APK-IN-APP-UPDATE.md`.

- Backend: modelo `driverAppVersion` + `GET /api/app-version/driver` + admin PUT.
- Admin: página **Atualização Motorista** (`/driver-app`).
- Plugin nativo `AppUpdate` (download + progresso + SHA-256 + instalador).
- UI: `AppUpdateGate` no boot + “Sobre o MoveCity” no perfil.

## Fase 5 Release (2026-08-06)

Ver `docs/CAPACITOR-PHASE5-RELEASE.md`.

- `version.properties`, signing via `keystore.properties`, R8, `npm run cap:release`.

## 1. Auditoria (resumo)

- Build driver já existia (`main.driver.jsx` → `dist-driver`).
- Auth/refresh centralizado em `shared/services/axios.js` (15min + refresh).
- Tokens FCM: model com `{ token, device }` — **device suficiente**; backend não alterado.
- GPS Web só foreground; Android precisa FGS.

## 2. Arquivos principais criados/modificados

**Criados**

- `shared/platform/{platform,location,notification,haptics,wakeLock,appLifecycle}.service.js` (+ platform.js)
- `shared/components/{ErrorBoundary,DriverBackButton}.jsx`
- `capacitor.config.json`
- `android/` (projeto Capacitor)
- `docs/CAPACITOR.md` (atualizado)
- este relatório

**Modificados (amostra)**

- `vite.config.js` — `base: './'` no mode driver
- `LocationContext`, `RideContext`, `fcm.js`, `session.js`
- Telas críticas do motorista → `api` compartilhado
- `CaptainHome` / `CaptainDetails` / `CaptainLogout` — push + FGS lifecycle
- `App.driver.jsx` — ErrorBoundary + back button
- `package.json` — scripts `cap:sync` / `cap:open` + deps Capacitor

## 3. Capacitor

| Item | Valor |
|------|--------|
| Core | 6.x |
| appId | `br.com.movecity.driver` |
| appName | MoveCity Motorista |
| webDir | `dist-driver` |

## 4. Plugins

Ver tabela em `docs/CAPACITOR.md`. FGS = `@capawesome-team/capacitor-android-foreground-service@6.2.0` (oficiais não cobrem).

## 5. Web preservada

- `npm run build` → `dist/` + PWA **PASS (código/build)**
- Mode driver isolado; adapters só ativam nativo via `isNativePlatform()`

## 6. Android (código)

- Push: `notification.service` → Cap Push + `device:'android'`
- GPS: `location.service` → Cap Geolocation
- FGS: start quando online/trip; stop offline/fim/logout
- Wake lock: Screen Wake Lock API (sem plugin extra)
- Back button: `DriverBackButton`
- Lifecycle: `appStateChange` → sync RideContext

## 7. Backend

**Nenhuma alteração.** Auditoria: `device` no `notificationToken` basta.

## 8. Testes / builds

| Item | Resultado | Nível |
|------|-----------|--------|
| `npm run build` | PASS | código/build |
| `npm run build:driver` | PASS | código/build |
| `npx cap add/sync android` | PASS | código/build |
| Vitest sessionKind + LocationContext | 9 PASS | código/build |
| `gradlew assembleDebug` | FAIL — SDK Android ausente (`ANDROID_HOME`) | PENDÊNCIA config |
| APK gerado | não | PENDÊNCIA config |
| GPS background físico | — | NÃO TESTADO |
| FGS + notificação persistente físico | — | NÃO TESTADO |
| FCM app morto / tap | — | NÃO TESTADO (falta `google-services.json`) |
| Emulador | — | NÃO TESTADO |
| Validação produção | — | NÃO TESTADO |

## 9. Problemas pré-existentes (não mascarados)

- Axios cru ainda pode existir em telas não críticas do driver
- Sem ErrorBoundary no shell Web passageiro (só driver shell)
- Firebase SW com config hardcoded (Web)
- CI sem gate de build Android

## 10. Pendências

1. Instalar Android SDK / Android Studio → `local.properties` (`sdk.dir`)
2. `google-services.json` + SHA-1/256 Firebase
3. Teste físico checklist GPS/FGS/FCM (regras do plano)
4. Ícone/splash finais; keystore release

## 11. Comandos

```bash
# Web
cd frontend && npm run dev
cd frontend && npm run build

# Driver web
npm run dev:driver
npm run build:driver

# Capacitor
npm run cap:sync
npm run cap:open

# APK (com SDK)
cd android && ./gradlew assembleDebug   # Windows: gradlew.bat assembleDebug
```

## 12. Localização do APK

**Não gerado nesta sessão** (SDK ausente). Path esperado após build local:

`frontend/android/app/build/outputs/apk/debug/app-debug.apk`
