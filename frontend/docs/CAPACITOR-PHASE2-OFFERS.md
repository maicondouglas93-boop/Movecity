# Capacitor Fase 2 — Ofertas + deep link + FGS icon

Data: 2026-08-05

## Entregue

1. **Deep link nativo** — `MainActivity` / pós-aceite gravam path; `NativeDeepLinkBridge` navega no React.
2. **Aceite com app morto** — refresh token no `NativeSessionStore` + retry em 401; pós-aceite → `/captain-riding` ou `/captain-parcel`.
3. **NEW_PARCEL** — mesmo caminho full-screen que NEW_RIDE (MessagingService + AlarmClock + Aceitar/Recusar).
4. **Backend** — `sendCaptainOfferPush` split android/web + `priority: high` para ride e parcel.
5. **Ícone FGS** — `ic_stat_movecity` (drawable) no Foreground Service.
6. **Tap push** — `bindPushNavigation` navega ofertas (não ignora mais no tap).

## GO / ONLINE

Inalterados. Oferta nativa não muda disponibilidade nem inicia presencial.
