# Publicação Android na Google Play

Este documento cobre os dois aplicativos móveis do MoveCity:

| Aplicativo | Package ID | Nome | versionCode | versionName | Bundle |
|---|---|---|---:|---|---|
| Motorista | `br.com.movecity.driver` | MoveCity Motorista | `24` | `1.1.22` | `bundlePlayRelease` |
| Passageiro | `br.com.movecity.passenger` | MoveCity Passageiro | `1` | `1.0.0` | `bundleRelease` |

Os dois projetos usam `compileSdk 36`, `targetSdk 36`, AGP 8.9.1, Gradle
8.11.1 e Java 17. O `versionCode` de cada app é independente e deve aumentar a
cada upload na Play Console.

## O que está automatizado

O workflow **Android Play Store — AABs** (`android-play-bundles.yml`) pode ser
executado manualmente em GitHub Actions para gerar o app do motorista, do
passageiro ou ambos. Ele:

1. executa os testes do frontend;
2. instala SDK Android 36;
3. configura Firebase e a upload key sem registrar valores nos logs;
4. sincroniza o bundle web com Capacitor;
5. gera AAB assinado;
6. verifica ZIP, assinatura e arquivos mínimos do bundle;
7. no motorista, confirma que permissões exclusivas do sideload foram removidas;
8. publica os AABs como artifacts do workflow por 14 dias.

O AAB do motorista usa a variante `playRelease`. O APK externo continua usando
`release`, preservando o atualizador por APK e o comportamento já distribuído.

## Secrets necessários no GitHub

### Compartilhados pelos dois apps

- `VITE_BASE_URL`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_VAPID_KEY`
- `VITE_GOOGLE_MAPS_API_KEY`
- `VITE_GOOGLE_MAPS_MAP_ID` (opcional)
- `VITE_SENTRY_DSN` (opcional)
- `VITE_SUPPORT_WHATSAPP`
- `VITE_SUPPORT_EMAIL`

### Upload key do motorista

O workflow reutiliza os secrets já usados no APK externo:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Ao cadastrar o app na Play Console, habilite **Play App Signing**. A chave acima
passa a ser a upload key; mantenha backup offline. Não gere outra chave para cada
release.

### Passageiro

Crie primeiro no Firebase um app Android com package exato
`br.com.movecity.passenger`, baixe `google-services.json` e configure:

- `PASSENGER_GOOGLE_SERVICES_JSON_BASE64`
- `PASSENGER_ANDROID_KEYSTORE_BASE64`
- `PASSENGER_ANDROID_KEYSTORE_PASSWORD`
- `PASSENGER_ANDROID_KEY_ALIAS`
- `PASSENGER_ANDROID_KEY_PASSWORD`

Não reutilize o `google-services.json` do motorista: ele pertence a
`br.com.movecity.driver`.

## Geração local

Copie o respectivo `keystore.properties.example` para `keystore.properties`,
preencha os valores e mantenha o `.jks` dentro da pasta Android correspondente.
Depois:

```bash
cd frontend
npm ci
npm run aab:driver
npm run aab:passenger
```

Os comandos falham de propósito quando a upload key ou o Firebase nativo estão
ausentes. Nunca envie um AAB assinado com a chave de debug.

## Permissões e declarações do motorista

O AAB da Play remove:

- instalação de APK (`REQUEST_INSTALL_PACKAGES`);
- full-screen intent;
- alarmes exatos;
- solicitação direta para ignorar otimização de bateria;
- desativação do bloqueio de tela.

Ele mantém localização em segundo plano e foreground service de localização porque
o GPS durante uma corrida é uma função central. Na Play Console será necessário:

1. preencher a declaração de **Background location**;
2. preencher a declaração de **Foreground service — location**;
3. fornecer um vídeo não listado mostrando o motorista ficando online, aceitando a
   corrida, minimizando o app e a notificação persistente de rastreamento;
4. explicar que interromper o serviço impede despacho, navegação e segurança da
   corrida ativa;
5. incluir credenciais exclusivas para a equipe de revisão acessar o app.

O passageiro solicita apenas localização em uso, internet, notificações e vibração.

## Bloqueadores antes do primeiro envio para revisão

Estes itens exigem dados, decisões ou acessos que não ficam no repositório:

- **Firebase do passageiro:** `google-services.json` ainda não existe no projeto.
- **Upload keys:** confirmar a chave existente do motorista e criar/guardar a do
  passageiro.
- **Publicar as páginas já implementadas:** após o deploy, validar sem login
  `https://www.moovecity.com.br/privacy`, `/support` e `/account-deletion`.
- **Validar o fluxo de exclusão em produção:** passageiro e motorista já bloqueiam a
  conta imediatamente e agendam a anonimização em 30 dias. O suporte deve acompanhar
  e aprovar os pedidos públicos em `GET/POST /api/admin/account-deletions`.
- **Data safety:** usar `docs/PLAY_STORE_DATA_SAFETY.md` como base e conferir as
  respostas no formulário atual da Play Console.
- **Conteúdo da loja:** faltam feature graphic 1024×500 e screenshots reais dos dois
  apps. O PNG 512×512 existente pode servir como ponto de partida para o ícone da
  ficha, após validação da marca.
- **Classificação etária, categoria, países, e-mail/telefone/site de suporte e
  declaração de anúncios:** preencher na Play Console.
- **Conta de revisão:** criar um passageiro e um motorista aprovados, sem dados reais.
- **Teste fechado:** se a conta de desenvolvedor for pessoal e tiver sido criada
  depois de 13/11/2023, confirmar no Console a exigência de teste fechado antes de
  solicitar produção.

## Ordem recomendada na Play Console

1. Criar os dois apps com os nomes e package IDs da tabela.
2. Ativar Play App Signing e registrar as upload keys.
3. Resolver os bloqueadores de privacidade e exclusão de conta.
4. Completar App content e Data safety.
5. Executar o workflow e baixar os dois artifacts AAB.
6. Enviar primeiro para **Internal testing**.
7. Instalar os builds gerados pela Play e testar login, mapas, push, corrida completa,
   app em segundo plano, pagamento, chat e exclusão de conta.
8. Fazer closed testing quando exigido e só depois solicitar produção.

## Smoke test mínimo por release

- instalação limpa e atualização sobre a versão anterior;
- login por senha e Google;
- permissão de notificações e recebimento de push com app aberto/fechado;
- mapa, GPS e criação/aceite de corrida;
- corrida inteira até pagamento e avaliação;
- perda e retorno de rede;
- motorista em background com notificação de serviço ativa;
- logout e exclusão de conta;
- ausência do instalador próprio de APK no build Play.

Os textos sugeridos das duas fichas, contatos e URLs estão em
`docs/PLAY_STORE_LISTING.md`.
