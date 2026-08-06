# Capacitor Fase 5 — Release Android

Data: 2026-08-06

## Objetivo

Preparar APK/AAB publicável sem quebrar o fluxo debug (`assembleDebug`).

## Versionamento

Arquivo: `frontend/android/version.properties`

```
VERSION_CODE=2
VERSION_NAME=1.1.0
```

Incremente `VERSION_CODE` a cada upload na Play Store.

## Assinatura

1. Gere o keystore (uma vez):

```bash
keytool -genkey -v -keystore movecity-driver-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias movecity
```

2. Copie `keystore.properties.example` → `keystore.properties` (gitignored) e preencha.

3. Coloque o `.jks` em `frontend/android/` (ou ajuste `storeFile`).

Sem `keystore.properties`, `assembleRelease` assina com **debug** e emite warning — útil para smoke test, **não publicar**.

Publicação automatizada por TAG: ver [`docs/ANDROID_RELEASE.md`](../../docs/ANDROID_RELEASE.md).

## Build

```bash
cd frontend
npm run cap:release
```

Saída: `android/app/build/outputs/apk/release/app-release.apk`

Release oficial (CI):

```bash
git tag v1.5.0
git push origin v1.5.0
```

## R8

- `minifyEnabled true` + `shrinkResources true` no release
- Regras em `app/proguard-rules.pro` (Capacitor, Firebase, MoveCity, Capawesome)

## Checklist Play Store

- [ ] `keystore.properties` real
- [ ] `google-services.json` de produção
- [ ] SHA-1/SHA-256 do keystore no Firebase / Maps
- [ ] `VERSION_CODE` incrementado
- [ ] Testar login, ONLINE, oferta full-screen, Aceitar, GPS background no APK release
