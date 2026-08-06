# Capacitor — MoveCity Motorista (Android)

App Android do motorista reutiliza o mesmo React do build `driver`. A Web/PWA completa continua em `npm run build` → `dist/`.

## Builds

| Comando | Saída | Conteúdo |
|---------|--------|----------|
| `npm run build` | `dist/` | Web completa + PWA |
| `npm run build:driver` | `dist-driver/` | Só motorista |
| `npm run cap:sync` | sync Android | `build:driver` + `cap sync android` |
| `npm run cap:open` | — | Abre Android Studio |
| `npm run cap:release` | APK release | sync + `assembleRelease` (ver Fase 5) |

## Configuração

- **appId:** `br.com.movecity.driver`
- **webDir:** `dist-driver`
- **Arquivo:** `capacitor.config.json`

## Plugins (e justificativa)

| Plugin | Por quê |
|--------|---------|
| `@capacitor/app` | Lifecycle + botão voltar |
| `@capacitor/geolocation` | GPS nativo (oficial) |
| `@capacitor/push-notifications` | FCM nativo (Web SW não serve no APK) |
| `@capacitor/haptics` | Vibração nativa |
| `@capacitor/status-bar` / `splash-screen` / `keyboard` / `network` | UX Android básica |
| `@capawesome-team/capacitor-android-foreground-service` | FGS + notificação persistente — **oficiais não cobrem** tracking com app minimizado/tela bloqueada |

## Tokens push

Backend atual: `POST /notifications/token` com `{ token, device }`.

- Web: `device = userAgent`
- Android: `device = 'android'`

**Sem segundo endpoint.** Campo `platform`/`deviceId` **não** foi adicionado — `device` já distingue.

## Login no emulador Android (erro “email/senha”)

Causa comum: o APK foi gerado com `VITE_BASE_URL=http://localhost:3000`. No emulador, `localhost` **não** é o seu PC.

1. Backend rodando na máquina: `cd Backend && npm run dev` (porta 3000).
2. Arquivo `frontend/.env.driver.local` (já no gitignore) com:
   ```
   VITE_BASE_URL=http://10.0.2.2:3000
   ```
3. Rebuild e sync:
   ```bash
   cd frontend
   npm run cap:sync
   ```
   Depois Run de novo no Android Studio.
4. CORS do backend aceita origem Capacitor (`https://localhost`).
5. Cleartext HTTP liberado no `AndroidManifest` + `network_security_config.xml` (dev).

**Dispositivo físico:** use o IP da LAN do PC, ex. `VITE_BASE_URL=http://192.168.x.x:3000` (mesmo Wi‑Fi), não `10.0.2.2`.

## Pendências manuais (não mascarar)

1. Criar app Android no Firebase Console (`br.com.movecity.driver`)
2. Colocar `android/app/google-services.json`
3. SHA-1/SHA-256 no Firebase e restrições da Maps API
4. Validar GPS background + FGS + FCM em **dispositivo físico**

## Validação — níveis de evidência

| Item | Nível esperado |
|------|----------------|
| `npm run build` / `build:driver` / `cap sync` | PASS código/build |
| GPS background / FGS / FCM morto | PASS dispositivo físico ou PENDÊNCIA/NÃO TESTADO |
| Soft-launch produção | Validação de produção (ops) |

## Fluxo de APK debug

```bash
cd frontend
npm run cap:sync
npm run cap:open
# Android Studio → Build → Build APK(s)
# ou: cd android && ./gradlew assembleDebug
```

APK esperado: `android/app/build/outputs/apk/debug/app-debug.apk`
