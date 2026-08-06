# Publicação do APK — MoveCity Motorista

Pipeline GitHub Actions para distribuição **fora da Play Store**.

## Fluxo

```text
git push          → CI (testes/build) — NÃO cria Release
git tag vX.Y.Z
git push origin vX.Y.Z → Android Release (APK assinado + GitHub Release)
```

## Desenvolvimento (só CI)

```bash
git add .
git commit -m "feat: melhorias no aplicativo motorista"
git push
```

Dispara `.github/workflows/ci.yml` (Backend, frontend motorista, admin).  
**Não** gera APK nem GitHub Release.

## Publicar nova versão

1. Incremente `VERSION_CODE` em `frontend/android/version.properties`  
   (deve ser **maior** que o `VersionCode` da última GitHub Release).
2. Commit e push normalmente; espere o CI passar.
3. Crie e envie a TAG (a TAG define o `versionName`):

```bash
# Exemplo: versionName 1.5.0 → TAG v1.5.0
# VERSION_CODE em version.properties já deve estar em 15 (exemplo)

git tag v1.5.0
git push origin v1.5.0
```

Dispara `.github/workflows/android-release.yml`.

### O que a Release gera

| Item | Valor |
|------|--------|
| Título | `MoveCity Motorista v1.5.0` |
| APK | `movecity-driver-1.5.0.apk` |
| Hash | `SHA256SUMS.txt` |
| Metadados ADM | `release-metadata.json` |
| Package | `br.com.movecity.driver` |

URL típica do APK:

```text
https://github.com/<owner>/<repo>/releases/download/v1.5.0/movecity-driver-1.5.0.apk
```

## Status da keystore de produção

**Neste repositório não há keystore de produção commitada** (correto — está no `.gitignore`).

Localmente também pode não existir `frontend/android/movecity-driver-release.jks`.

Antes da **primeira** Release automática:

1. Crie a keystore **uma única vez**.
2. Guarde backup offline seguro (perder a chave impede update sobre APKs já instalados).
3. Configure os GitHub Secrets (abaixo).
4. **Não** gere uma segunda keystore “só para CI”.

### Criar keystore (uma vez)

```bash
keytool -genkey -v \
  -keystore movecity-driver-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias movecity
```

Coloque o `.jks` em `frontend/android/` e copie `keystore.properties.example` → `keystore.properties` para builds locais.

### Base64 no Windows (PowerShell)

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\caminho\movecity-driver-release.jks")) | Set-Clipboard
```

Cole o valor no Secret `ANDROID_KEYSTORE_BASE64` (não commite o Base64).

### Base64 no Linux/macOS

```bash
base64 -w0 movecity-driver-release.jks | pbcopy   # macOS
base64 -w0 movecity-driver-release.jks            # Linux
```

## GitHub Secrets (obrigatórios para Release)

Configure em **Settings → Secrets and variables → Actions**:

| Secret | Descrição |
|--------|-----------|
| `ANDROID_KEYSTORE_BASE64` | Conteúdo do `.jks` em Base64 |
| `ANDROID_KEYSTORE_PASSWORD` | Senha da keystore |
| `ANDROID_KEY_ALIAS` | Alias da chave (ex.: `movecity`) |
| `ANDROID_KEY_PASSWORD` | Senha da chave |

O workflow usa `GITHUB_TOKEN` padrão para criar a Release (`contents: write`).  
Nenhum PAT extra é necessário.

**Nunca** coloque `.jks`, senhas ou Base64 no Git, no APK ou em `.env` público.

## Versionamento

Arquivo: `frontend/android/version.properties`

```properties
VERSION_CODE=15
VERSION_NAME=1.5.0
```

- `VERSION_NAME` é sobrescrito no pipeline para coincidir com a TAG (`v1.5.0` → `1.5.0`).
- `VERSION_CODE` **não** sobe sozinho: incremente manualmente antes da TAG.
- O workflow falha se `VERSION_CODE` ≤ máximo já publicado nas Releases (`VersionCode:` nas notes).

## Validação automática do APK

Antes da Release, o pipeline verifica:

- arquivo existe e tamanho > 0
- `applicationId` = `br.com.movecity.driver`
- `versionName` = versão da TAG
- `versionCode` = valor de `version.properties`
- assinatura presente (`apksigner`)
- **não** é certificado “Android Debug”

## Atualização no app (painel ADM)

Este pipeline **não** altera o MongoDB.

Após a GitHub Release:

1. Abra a Release e copie a URL do APK (ou use `release-metadata.json`).
2. Painel Admin → **Atualização Motorista**.
3. Preencha `version`, `versionCode`, `apkUrl`, `sha256`, notas, `mandatory` / versão mínima.
4. Salve.

Os motoristas passam a ver a atualização via `GET /api/app-version/driver`.

## Stack do workflow de Release

| Item | Valor |
|------|--------|
| Runner | `ubuntu-latest` |
| Node | 20 |
| Java | 17 (Temurin) |
| Android SDK | platform 34, build-tools 34.0.0 |
| Gradle | wrapper do projeto (8.2.1) |
| Capacitor | `npm run cap:sync` (`build:driver` + `cap sync android`) |
| Gradle task | `assembleRelease` com `CI_REQUIRE_RELEASE_SIGNING=true` |

## Troubleshooting

| Problema | Causa | Solução |
|----------|--------|---------|
| Secrets ausentes | Keystore nunca configurada no GitHub | Criar keystore + Secrets |
| `VERSION_CODE` rejeitado | Código ≤ última Release | Incrementar em `version.properties` |
| Release já existe | Mesma TAG reenviada | Usar TAG nova (`v1.5.1`) |
| APK DEBUG | Build local sem `keystore.properties` | Só o workflow de TAG publica APK oficial |
| Update não instala | Keystore diferente da anterior | Sempre a mesma chave de produção |

## Relação com scripts locais

```bash
cd frontend
npm run cap:release   # local: sync + assembleRelease
```

Sem `keystore.properties`, o APK local é assinado com **debug** (não distribuir).  
No GitHub Actions de TAG, a ausência de Secrets **falha** o job.
