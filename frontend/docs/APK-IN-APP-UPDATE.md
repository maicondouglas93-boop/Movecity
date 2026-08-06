# Atualização in-app do APK — MoveCity Motorista

Distribuição fora da Google Play Store: o motorista verifica e instala novas versões pelo próprio aplicativo.

## Arquitetura

```text
Painel Admin → PUT /api/admin/driver-app-version → Mongo (metadados)
APK Motorista → GET /api/app-version/driver → compara versionCode → download → instalador Android
```

O arquivo `.apk` **não** fica no MongoDB — apenas `apkUrl` (HTTPS/CDN).

## Endpoints

| Método | Rota | Auth |
|--------|------|------|
| GET | `/api/app-version/driver` | Público (leitura) |
| GET | `/api/admin/driver-app-version` | Admin `super_admin` |
| PUT | `/api/admin/driver-app-version` | Admin `super_admin` |

## Publicar nova versão (administrador)

### Opção A — GitHub Actions (recomendado)

1. Incremente `VERSION_CODE` em `frontend/android/version.properties`.
2. `git tag vX.Y.Z && git push origin vX.Y.Z` (ver `docs/ANDROID_RELEASE.md`).
3. Na GitHub Release, use o asset `release-metadata.json` ou a URL do APK + `SHA256SUMS.txt`.
4. No painel Admin → **Atualização Motorista**, cole `apkUrl` / `sha256` / versão e salve.

### Opção B — Manual

1. Gere o APK release com a **mesma** chave de assinatura (`keystore.properties`).
2. Incremente `VERSION_CODE` e `VERSION_NAME` em `frontend/android/version.properties`.
3. Faça upload do `.apk` para CDN/storage HTTPS.
4. Calcule SHA-256 (recomendado): `certutil -hashfile app-release.apk SHA256` (Windows).
5. No painel Admin → **Atualização Motorista**:
   - Versão publicada / versionCode
   - Versão mínima / minimumVersionCode
   - URL do APK
   - SHA-256 e tamanho (opcional)
   - Notas + obrigatória (se necessário)
   - Salvar

## Package ID

`br.com.movecity.driver` — deve permanecer igual em todas as versões.

## Permissões Android

- `REQUEST_INSTALL_PACKAGES` — abre o instalador de pacotes (sideload).

## Plugin Capacitor

- Nativo: `AppUpdate` (`AppUpdatePlugin.java`)
- JS: `frontend/src/shared/platform/appUpdate.service.js`

## Testes manuais (checklist)

1. APK atualizado → “versão mais recente”
2. Backend com versionCode maior → modal de update
3. `mandatory=false` → Atualizar / Depois
4. `mandatory=true` ou abaixo do mínimo → sem “Depois”
5. Sem internet → app continua (exceto mínimo já cacheado)
6. Download interrompido → não instala
7. SHA-256 errado → instalação bloqueada
8. Update sobre instalação → login preservado
9. Mesmo package → update normal
10. Assinatura diferente → Android rejeita (esperado)

## Variáveis opcionais (backend)

- `APK_ALLOWED_HOSTS` — lista CSV de hosts permitidos em `apkUrl` (ex.: `cdn.movecity.com.br`)
