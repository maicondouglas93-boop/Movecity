# Correção do sistema de notificações push — plano de implementação

**Data:** 2026-08-02
**Base:** `docs/plans/2026-08-02-auditoria-notificacoes-push.md` (auditoria completa, sem alterações de código)
**Pedido:** corrigir todos os achados (5 críticos, 10 altos, 12 médios, 5 baixos) em etapas pequenas e validadas, sem refatoração completa de uma vez.

Revisão de risco feita antes de codificar — ver seção 3. Plano e ajustes aprovados pelo usuário em 2026-08-02.

---

## 1. Execução em etapas (ordem definida pelo usuário)

**Fase 1 (agora):** C1, C2, C3, C5 — restaura o fluxo essencial (motorista recebe e aceita corrida por push) sem derrubar a API. Testar o fluxo de push de corrida nova antes de avançar.

**Fase 2 (só após validar a Fase 1):** C4, A3, A4, A10 — segurança (segmentação, logout, posse de token, chat).

As demais fases do plano original (reestruturação em módulos, escalabilidade, canal admin) **não fazem parte deste pedido ainda** — ficam registradas como próximos passos naturais, mas não serão implementadas nesta rodada, para não misturar refatoração grande com correção de bug crítico.

---

## 2. Mapeamento achado → correção → arquivo (Fases 1 e 2 apenas)

### C1 — SW nunca recebe o JWT; SW errado (escopo revisado após risco de auth)

**Decisão de arquitetura:** não implementar refresh token dentro do Service Worker. Motivo: `auth.service.js:75-83` revoga a família inteira de sessões quando um refresh token já rotacionado é reapresentado (detecção de reuse). Se o SW rotacionasse em background, o `localStorage` da página (não sincronizado, pois o app está fechado) ficaria com uma cópia já invalidada — na próxima abertura do app, o próprio motorista seria deslogado pelo mecanismo desenhado para pegar roubo de token. Sincronizar **somente o access token** evita esse colapso; se ele expirar (15min) enquanto o app está fechado, o SW mostra a notificação "Sessão expirada, abra o app" que **já existe** em `firebase-messaging-sw.js:187-193` — degradação graciosa, sem risco de sessão.

Passos:
1. `frontend/src/services/fcm.js` — registrar `firebase-messaging-sw.js` **explicitamente** com `navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/firebase-cloud-messaging-push-scope' })`, aguardar `.ready`, e passar essa `registration` para `getToken(messaging, { vapidKey, serviceWorkerRegistration })`. Isso remove a ambiguidade com o SW do `vite-plugin-pwa` (que controla `/`) — hoje o Firebase escolhe sozinho, e é essa ambiguidade que faz `swCommunication.js` mirar o worker errado.
2. `frontend/src/services/swCommunication.js` — trocar `navigator.serviceWorker.controller` pela registration explícita obtida do mesmo helper de `fcm.js` (exportar uma função `getFcmRegistration()` reaproveitada pelos dois arquivos).
3. `frontend/src/services/axios.js` — após uma renovação silenciosa bem-sucedida, sincronizar o novo access token pro SW (reaproveita `syncTokenWithSW`).
4. `UserLogin.jsx`, `UserSignup.jsx`, `CaptainLogin.jsx`, `CaptainSignup.jsx` — sincronizar o access token pro SW logo após `saveSession`.
5. `UserLogout.jsx`, `CaptainLogout.jsx` — chamar `clearTokenInSW` (já existe, só nunca foi chamada).
6. `frontend/vite.config.js` — excluir `firebase-messaging-sw.js` do precache do Workbox (`globIgnores`), para não arriscar servir uma cópia desatualizada do worker de push após deploy.
7. `frontend/public/firebase-messaging-sw.js` — **sem mudança funcional planejada**: o fallback de "sessão expirada" já existe e passa a ser alcançado normalmente uma vez que o token chega até lá.

### C2 — `BASE_URL` indefinido, fallback `localhost:4000`
- `Backend/.env.example` — documentar `BASE_URL` (URL pública do backend, usada pelo Service Worker do motorista para aceitar corrida em segundo plano).
- `Backend/services/notification.service.js` — corrigir o fallback para refletir a porta real (`PORT`) em vez de uma porta que não é a do próprio servidor; logar aviso alto se `BASE_URL` ausente com `NODE_ENV=production`.

### C3 — Motorista nunca é convidado a permitir push
- `frontend/src/modules/driver/pages/CaptainHome.jsx` — replicar o cartão de permissão do passageiro (mesmo padrão visual de `Home.jsx:661-684`, adaptado: "Ative notificações para receber corridas mesmo com o app em segundo plano"), com os mesmos três estados (`granted` → busca token; `default` sem prompt já visto → mostra cartão; dispensa marca `localStorage`).

### C5 — Falha de push derruba a API
- `Backend/controllers/ride.controller.js` — `.catch(console.error)` nas 4 chamadas fire-and-forget (linhas 66, 154, 223, 289), mesmo padrão já usado na linha 357.
- `Backend/services/notification.service.js` — envolver `Notification.create` + `NotificationToken.find` em try/catch dentro de `sendToUser`/`sendToCaptain`/`sendAdminNotification` (hoje só o envio ao Firebase dentro de `sendPush` está protegido).
- `Backend/server.js` — `process.on('unhandledRejection', ...)` e `process.on('uncaughtException', ...)` como rede de segurança final (loga, não derruba), sem mascarar os try/catch específicos já adicionados.

### C4 — Segmentação com `$exists:true` vaza entre públicos e duplica (Fase 2)
- `Backend/controllers/notification.controller.js` — `registerToken` passa a `$unset` o campo que não se aplica em vez de gravar `null`.
- `Backend/services/notification.service.js` — consultas trocam de `{campo: {$exists:true}}` para `{campo: {$ne: null}}`; `sendAdminNotification` deduplica tokens com `Set` antes de enviar.
- **Migração** (`Backend/scripts/fix-notification-tokens.js`, novo): em lote via `updateMany`, não por documento:
  1. `countDocuments({ userId: null })` e `countDocuments({ captainId: null })` — log do total afetado **antes** de alterar.
  2. `updateMany({ userId: null }, { $unset: { userId: '' } })` e o mesmo para `captainId`.
  3. Logar `modifiedCount` de cada operação.
  4. Idempotente (uma segunda execução encontra `0` documentos e não altera nada).
  5. **Instrução registrada no script e no plano:** rodar uma vez após o deploy do código do passo anterior — mesmo rodando antes também corrige o vazamento (o índice é só em `token`, então um `$unset` já tira o documento do match de `$exists:true` mesmo com código antigo ainda no ar), mas tokens registrados pelo controller antigo entre a migração e o deploy voltam a gravar `null`. Rodar de novo (idempotente) fecha essa janela.

### A3 — Logout não desvincula o token FCM (Fase 2)
- Novo `DELETE /notifications/token` autenticado (`Backend/routes/notification.routes.js`, `Backend/controllers/notification.controller.js`), chamado por `UserLogout.jsx`/`CaptainLogout.jsx` antes de limpar a sessão local, além do `clearTokenInSW` já adicionado na Fase 1.

### A4 — Registro de token sem checar posse (Fase 2)
- `Backend/controllers/notification.controller.js` — parar de logar o token completo (reduz a superfície que viabiliza sequestro); manter o upsert (necessário para dispositivo compartilhado); registrar quando um token muda de dono.
- Rate limit dedicado no endpoint de registro.

### A10 — Chat sem checar participação na corrida (Fase 2)
- `Backend/socket.js` — `join-chat`, `send-message`, `message-read`, `typing-*` passam a exigir e validar um JWT informando quem está do outro lado, confirmando que é `ride.user` ou `ride.captain` daquele `rideId`.
- **Risco de deploy coordenado:** essa mudança precisa do lado do frontend (`RideChat.jsx`) enviando o token junto, no mesmo deploy — um frontend antigo em cache batendo num backend já validando quebraria o chat. Será tratado dentro da própria Fase 2, nos dois lados juntos.

---

## 3. Checklist final antes de alterar código (Fase 1)

**Arquivos que serão modificados nesta etapa:**
- `frontend/src/services/fcm.js`
- `frontend/src/services/swCommunication.js`
- `frontend/src/services/axios.js`
- `frontend/src/modules/passenger/pages/UserLogin.jsx`
- `frontend/src/modules/passenger/pages/UserSignup.jsx`
- `frontend/src/modules/passenger/pages/UserLogout.jsx`
- `frontend/src/modules/driver/pages/CaptainLogin.jsx`
- `frontend/src/modules/driver/pages/CaptainSignup.jsx`
- `frontend/src/modules/driver/pages/CaptainLogout.jsx`
- `frontend/src/modules/driver/pages/CaptainHome.jsx`
- `frontend/vite.config.js`
- `Backend/.env.example`
- `Backend/services/notification.service.js`
- `Backend/controllers/ride.controller.js`
- `Backend/server.js`

**Nenhum arquivo novo nesta etapa.** (`fix-notification-tokens.js` e as mudanças de C4/A3/A4/A10 ficam para a Fase 2.)

**Confirmações de conflito com a arquitetura atual:**
- `firebase-messaging-sw.js` **não precisa mudar** — o bug era 100% do lado de quem deveria alimentá-lo (token nunca chegava) e de qual worker recebia a mensagem, não da lógica interna do worker, que já tem o fallback correto de sessão expirada.
- Registrar o SW explicitamente com escopo próprio remove a ambiguidade com o SW do `vite-plugin-pwa` (que continua controlando `/` normalmente, sem mudança nele).
- `saveSession`/`getAccessToken`/`session.js` não mudam — a sincronização com o SW é uma chamada adicional no mesmo ponto onde a sessão já é salva, não uma substituição do mecanismo de sessão.
- Nenhuma regra de negócio de corrida, pagamento ou autenticação muda — C5 só adiciona tratamento de erro ao redor de chamadas que já existem, sem alterar quando ou para quem elas são disparadas.
- `Backend/server.js`: `unhandledRejection`/`uncaughtException` só logam — não alteram o comportamento de erros já tratados localmente (os try/catch específicos continuam sendo a primeira linha de defesa; o handler global é só a rede de segurança final).

**Teste planejado ao final da Fase 1:** fluxo real de "passageiro cria corrida → motorista offline recebe push → aceita pelo botão da notificação", usando um ambiente onde seja possível simular o SW recebendo o token e chamando o endpoint de aceite — sem mocks, contra o backend real.

---

---

## 4. Detalhes da execução — Fase 1 (C1, C2, C3, C5)

**C1:**
- `frontend/src/services/fcm.js` — `getFcmRegistration()` novo: registra `firebase-messaging-sw.js` explicitamente com escopo `/firebase-cloud-messaging-push-scope`, espera o worker ficar `active` (`waitForActive`), e essa mesma registration é passada pro `getToken()` via `serviceWorkerRegistration`.
- `frontend/src/services/swCommunication.js` — `syncTokenWithSW`/`clearTokenInSW` agora usam `getFcmRegistration()` em vez de `navigator.serviceWorker.controller`.
- Chamadas de sincronização adicionadas em: `UserLogin.jsx`, `UserSignup.jsx`, `CaptainLogin.jsx`, `CaptainSignup.jsx` (login/signup, com Google incluso no passageiro), `axios.js` (toda renovação silenciosa), `UserLogout.jsx`/`CaptainLogout.jsx` (`clearTokenInSW` no logout).
- `frontend/vite.config.js` — `globIgnores: ['**/firebase-messaging-sw.js']` no Workbox. Confirmado via build: o arquivo desapareceu do manifest de precache (`grep -c firebase-messaging-sw dist/sw.js` → `0`).
- Sem mudança no `firebase-messaging-sw.js` — o fallback de "sessão expirada" já existia e passa a ser alcançado normalmente.
- **Decisão mantida:** nenhuma lógica de refresh de token dentro do Service Worker (risco de reuse-detection revogar a sessão, ver seção 3 da revisão de risco).

**C2:**
- `Backend/.env.example` — `BASE_URL` documentado.
- `Backend/services/notification.service.js` — fallback corrigido de `localhost:4000` pra `localhost:${PORT || 3000}`; aviso em log se `BASE_URL` ausente com `NODE_ENV=production`.

**C3:**
- `frontend/src/modules/driver/pages/CaptainHome.jsx` — cartão de permissão adicionado, espelhando `Home.jsx` (chave própria `notificationPromptSeenCaptain` no localStorage, pra não colidir com o dismiss do passageiro no mesmo navegador).

**C5:**
- `Backend/services/notification.service.js` — `sendToUser`, `sendToCaptain`, `sendAdminNotification` agora envolvem `Notification.create`/`NotificationToken.find` em try/catch.
- `Backend/controllers/ride.controller.js` — `.catch(console.error)` nas 4 chamadas fire-and-forget (linhas correspondentes a `sendNewRide`, `sendRideAccepted`, `sendRideStarted`, `sendRideFinished`).
- `Backend/server.js` — `unhandledRejection`/`uncaughtException` como rede de segurança final (só loga).

### Verificação feita (sem mocks, contra banco e endpoints reais)

- **Build do frontend:** passou; confirmado por grep que `firebase-messaging-sw.js` saiu do precache.
- **Novo teste real** `Backend/tests/integration/notification.push.test.js`: chama o endpoint real `POST /notifications/token` com JWT real, cria corrida via `POST /rides/create` real, confirma que o motorista compatível (posição real via `MongoMemoryReplSet`, sem mock de geolocalização — só o geocoding externo é mockado, como já era convenção no projeto) foi despachado, que o documento `Notification` foi gravado, e que a resposta da criação da corrida continua `201` **mesmo com a chamada real ao Firebase falhando** (`FirebaseAppError: The default Firebase app does not exist` — as credenciais não estão configuradas neste ambiente). Essa falha real, capturada e logada sem derrubar a requisição, é a prova em produção-símile de que C5 funciona — não foi simulada.
- **Suíte completa do backend:** `17 suites, 110 testes, todos passando` — sem regressão em corridas, usuários, motoristas, autenticação/sessão ou os demais módulos.
- **Fora do alcance de um teste de backend automatizado:** a entrega física da notificação a um dispositivo real depende de um navegador de verdade e de um projeto Firebase configurado — isso foi verificado por leitura de código (registro explícito do worker, escopo correto, `getToken` recebendo a registration) e pelo build passando, não por execução ponta a ponta em browser.

*(Fase 1 validada pelo usuário — "siga". Fase 2 iniciada e concluída abaixo.)*

## 5. Detalhes da execução — Fase 2 (C4, A3, A4, A10)

**C4 (segmentação):**
- `Backend/controllers/notification.controller.js` — `registerToken` reescrito: grava só o campo do dono real via `$set`, e `$unset` explícito no campo que não se aplica (nunca mais grava `null`).
- `Backend/services/notification.service.js` — `sendAdminNotification` trocou `{$exists:true}` por `{$ne:null}` nas duas consultas, e deduplica a lista final com `Set`.
- `Backend/scripts/fix-notification-tokens.js` (novo) — migração em lote (`updateMany`, não documento-por-documento) para os dados já gravados. Loga a contagem afetada antes e o `modifiedCount` de cada operação depois.
  - **Bug pego na verificação, corrigido antes de qualquer execução real:** o filtro inicial `{userId: null}` no MongoDB casa tanto com valor `null` quanto com o campo **ausente** — então rodar a migração pela segunda vez continuava "encontrando" e "corrigindo" os mesmos documentos (e o Mongoose ainda atualiza `updatedAt` em todo `$unset`, mesmo sem nada pra remover, inflando `modifiedCount`). Corrigido usando `{$type: 10}` (BSON Null), que só casa com valor null de verdade. Reverificado contra `MongoMemoryReplSet`: 1ª execução corrige os documentos esperados, 2ª execução encontra 0 e não altera nada — idempotência real, não só aparente.

**A3 (logout desvincula o token):**
- Novo `DELETE /notifications/token` (`notification.controller.js: unregisterToken`, `notification.routes.js`), autenticado, só remove se o token pertencer a quem está pedindo.
- `UserLogout.jsx`/`CaptainLogout.jsx` — antes de limpar a sessão, buscam o token FCM atual do dispositivo (`fcm.js: getCurrentFcmToken`, sem repedir permissão) e chamam o novo endpoint, em paralelo com a chamada de logout existente.

**A4 (proteção do registro de token):**
- `registerToken` não bloqueia a reatribuição (necessária pra aparelho compartilhado), mas loga um aviso quando um token muda de dono.
- Token completo nunca mais aparece em log — nem no registro nem no log de falha de envio do `sendPush` (antes: `[${token}]`; agora: só os últimos 8 caracteres).
- Rate limit dedicado (`notificationTokenLimiter`, 20/15min) no `POST /notifications/token`.

**A10 (segurança do chat):**
- `Backend/socket.js` — `join-chat` agora exige um JWT no payload, resolve a identidade (usuário ou motorista) e confirma que ela é `ride.user` ou `ride.captain` da corrida antes de autorizar; a autorização fica em `socket.data.authorizedChats` (memória do socket, por conexão) e é checada em `send-message`, `message-delivered`, `message-read`, `typing-start`, `typing-stop` sem repetir a consulta ao banco a cada evento.
- `frontend/src/shared/components/RideChat.jsx` — `join-chat` agora envia o JWT (`token`, já existente no componente) junto com o `rideId`. Mudança coordenada com o backend no mesmo commit, conforme o risco de deploy identificado na revisão de plano.

### Verificação feita (sem mocks)

- **Novo teste** `Backend/tests/sockets/chat.security.test.js` — três testes com clientes reais de `socket.io-client` contra um servidor Socket.IO real: um estranho com JWT válido (mas de identidade errada) recebe `unauthorized` e não recebe as mensagens trocadas na sala; passageiro e motorista reais da mesma corrida trocam mensagem normalmente; `join-chat` sem token é rejeitado.
- **Testes adicionados** em `Backend/tests/integration/notification.push.test.js`: segmentação (token de motorista nunca aparece na consulta de passageiro e vice-versa, usando a mesma query do `sendAdminNotification`), remoção de token só pelo dono real, reatribuição de token em dispositivo compartilhado sem duplicar documento.
- **Suíte completa do backend:** `18 suites, 116 testes, todos passando`.
- **Build do frontend:** passou.

*(Fase 2 validada pelo usuário — "continue". Fase 4 do plano original de 8 fases [reestruturação em módulos] iniciada e concluída abaixo. A numeração desta seção segue a do plano original de 8 fases, não a renumeração "Fase 1/Fase 2" usada só para pacear a execução das correções críticas/segurança.)*

## 6. Detalhes da execução — Fase 4 (reestruturação em módulos)

Estrutura criada em `Backend/notification/`, cada arquivo com uma responsabilidade só:

- **`tokenRegistry.service.js`** — único módulo que toca a coleção `NotificationToken`: registrar (com a correção C4 embutida), remover (A3/A4), buscar tokens por usuário/motorista/lista de ids, e `removeInvalidTokens` (implementa o achado A2 da auditoria original, que ainda não tinha sido corrigido: tokens que o Firebase reporta como definitivamente inválidos agora são apagados, em vez de a base só crescer pra sempre).
- **`pushTransport.service.js`** — único módulo que fala com o Firebase Admin SDK: chunking de 500 tokens (corrige M2 — campanha com mais de 500 destinatários falhava por inteiro), retry com backoff em falha de lote, timeout de 10s por chamada, e redação do token nos logs de falha (mesma correção A4/M10 já feita na Fase 3, agora só em um lugar).
- **`notificationDispatcher.service.js`** — regras de negócio: quem recebe o quê, grava o histórico (`Notification`/`NotificationCampaign`) com o status real (`sending` → `sent`/`failed`, corrige M4 — antes gravava `sent` incondicionalmente antes mesmo de tentar enviar), e o lock atômico do processamento de campanha (corrige M1 — `findOneAndUpdate` com o status de origem no filtro, mesmo padrão de `rideService.acceptRideAtomic`, em vez do `findById` + `save()` separado que permitia duas instâncias processarem a mesma campanha).
- **`queue.service.js`** — ponto único de desacoplamento: todo envio disparado por um evento de corrida passa por `enqueue()`, que nunca faz quem chamou esperar o resultado, e captura qualquer erro que escape do job (corrige M3 — antes cada call site em `ride.controller.js` tratava o próprio erro individualmente).

`Backend/services/notification.service.js` virou uma fachada de uma linha (`module.exports = require('../notification/notificationDispatcher.service')`) — mantém exatamente os mesmos nomes que `ride.controller.js` e `admin.controller.js` já importavam, então nenhum outro arquivo precisou mudar por causa disto. `Backend/controllers/notification.controller.js` foi migrado para chamar `tokenRegistry.service.js` em vez de tocar o model Mongoose diretamente.

### Bugs pegos pela suíte de testes antes de considerar concluído

1. **Enum do schema desatualizado:** `Notification.create({status:'sending', ...})` falhava com `ValidationError` porque `models/notification.model.js` só aceitava `['draft','sent','failed']` — o novo estado intermediário `'sending'` (parte da própria correção de M4) não tinha sido adicionado ao enum. Corrigido.
2. **Teste com suposição de sincronismo que a própria correção eliminou:** o teste de Fase 1 assumia que a `Notification` já existiria no banco no instante em que a resposta HTTP de `POST /rides/create` chegasse — verdade antes, porque `sendToCaptain` era `await`ado numa cadeia de promises iniciada de forma síncrona. Com o desacoplamento via `queue.enqueue` (M3) e o retry real (com `setTimeout`) do `pushTransport` (parte de resolver M3), isso deixou de ser garantido — e não deveria ser: é exatamente o comportamento que a correção buscava. Reescrito para esperar (`poll`) o estado final da notificação, refletindo o novo desenho ao invés de mascará-lo.

### Verificação feita

- **Novo teste** (`Fase 4: reestruturação do serviço de push (M1)`) — duas chamadas concorrentes reais de `processCampaign` na mesma campanha, confirmando que só uma processa (métricas não duplicam).
- Testes de C4/A3/A4/A10 (Fase 3) continuam passando inalterados — a fachada preservou o comportamento observável.
- **Suíte completa do backend:** `18 suites, 117 testes, todos passando`.
- **Build do frontend:** passou (Fase 4 não tocou nada no frontend).

### Ainda em aberto (não pedido nesta rodada)

Fase 5 (push em primeiro plano, "motorista chegou", cancelamento, chat com app fechado), Fase 6 restante (nada síncrono ficou faltando corrigir, mas vale revisitar sob carga real), e Fase 7 (canal de push para o admin) continuam registradas no plano original e não foram implementadas.

---

## 7. Detalhes da execução — Fase 5 (correções de funcionalidade)

**A9 — push em primeiro plano:**
- `frontend/src/services/fcm.js` — `onMessageListener` (nunca funcionava de verdade: era uma `Promise` que só resolve uma vez, e nunca era importada em lugar nenhum) trocado por `onForegroundMessage(callback)`, que devolve a função de cancelamento do `onMessage` real.
- **Bug real pego pela suíte antes de fechar:** chamar `getMessaging(app)` incondicionalmente no topo do módulo (como já era antes das minhas mudanças) dispara, em ambientes sem suporte (jsdom nos testes, e potencialmente navegadores/situações reais sem IndexedDB), uma *unhandled promise rejection* **dentro do próprio SDK do Firebase** (`messaging/unsupported-browser`) — fora do alcance do try/catch síncrono que já existia. Isso já era um bug latente do código original; ficou visível porque a Fase 1 passou a importar `fcm.js` transitivamente em `UserLogin.jsx`/`UserSignup.jsx` (via `swCommunication.js`), arquivos cujos testes não mockavam `firebase/messaging`. Corrigido usando `isSupported()` — a checagem oficial da própria lib — antes de qualquer tentativa de uso.
- `Home.jsx` e `CaptainHome.jsx` — novo `useEffect` assinando `onForegroundMessage`, mostrando a notificação como toast (reaproveita `ToastContext`).

**A5 — "motorista chegou":** `ride.controller.js: updateRideStatus` agora dispara `sendCaptainArrived` quando `status === 'arrived'`, além do socket que já existia.

**A6 — cancelamento confiável:** `ride.controller.js: cancelRide` agora dispara `sendRideCancelledToCaptain` quando a corrida já tinha um motorista designado (`ride.captain`), além do `sendMessageToRoom` que já existia (e continua sendo o mecanismo pra avisar motoristas ainda em despacho, sem um designado).

**Pagamento e carteira:** `ride.controller.js: payRide` agora notifica o motorista por push além de socket. `wallet.service.js: createTransaction` passou a chamar `sendRechargeApproved` (existia desde sempre, nunca fora chamada — M11 da auditoria original) quando `type === 'recharge'`; as demais movimentações (comissão, ajuste) continuam só com socket, de propósito, pra não notificar demais.

**A7 — chat com app fechado:** a parte mais envolvida desta fase. `socket.js` ganhou rastreamento de presença por corrida e por tipo de identidade (`chatPresence`, contagem por referência — suporta a mesma pessoa com duas abas abertas sem que fechar uma derrube a presença da outra), atualizado em `join-chat`, `leave-chat` e `disconnect`. `send-message` passa a checar, depois do relay via Socket.IO, se o destinatário está de fato presente na sala; se não estiver, dispara `sendChatMessageToCaptain`/`sendChatMessageToUser` como fallback — exatamente a regra pedida ("App aberto → Socket.IO; App fechado → Firebase Push").

`models/notification.model.js` — enum de `type` estendido (`RIDE_ARRIVED`, `RIDE_CANCELLED`, `CHAT`, `PAYMENT`) pra acomodar os tipos novos.

### Verificação feita (sem mocks)

- Testes reais adicionados a `notification.push.test.js`: A5 (push de "chegou"), A6 (push de cancelamento só quando há motorista designado; confirmado também que cancelar uma corrida ainda sem motorista **não** tenta notificar ninguém por push), pagamento, e carteira (chamando o mesmo `wallet.service.js: createTransaction` usado por todo o resto do sistema, não um atalho).
- Testes reais adicionados a `chat.security.test.js` (clientes reais de `socket.io-client`): motorista manda mensagem com o passageiro ausente → passageiro recebe push; passageiro sai do chat (`leave-chat`) e a mensagem seguinte volta a gerar push (prova que a presença é limpa corretamente, não fica "presa"); e, no teste que já existia de troca de mensagem com os dois presentes, nova asserção confirmando que **nenhum** push é gerado nesse caso (Socket.IO já entregou, push seria redundante).
- **Suíte completa do backend:** `18 suites, 124 testes, todos passando`.
- **Suíte do frontend:** as mesmas 3 falhas pré-existentes documentadas na sessão (contexto de localização não provido em teste, poluição de `localStorage` entre testes) — nenhuma nova falha introduzida. Build do frontend passou.

---

## 8. Detalhes da execução — Fase 7 (canal de push para o admin)

**Backend:**
- `models/notificationToken.model.js` — campo `adminId` novo (terceiro tipo de dono possível, além de `userId`/`captainId`).
- `models/notification.model.js` — `targetAudience` ganhou `'admins'`.
- `notification/tokenRegistry.service.js` — `registerToken` reescrito pra generalizar de "2 donos possíveis" pra "N donos possíveis" (`ALL_OWNER_FIELDS.filter(...)` no lugar do antigo par fixo `OWNER_FIELD`/`OTHER_FIELD`), e `getAllAdminTokens` novo.
- `notification/notificationDispatcher.service.js` — `sendAdminAlert` (broadcast pra todos os admins com token registrado, mesmo padrão do `sendAdminNotification` já existente) e três atalhos: `sendNewCaptainAlert`, `sendComplaintAlert`, `sendPaymentProblemAlert`.
- `controllers/notification.controller.js` — `registerToken`/`unregisterToken` passam a aceitar `req.admin` como terceira identidade possível.
- `routes/admin.routes.js` — `POST /admin/notifications/token` e `DELETE /admin/notifications/token`, com `authAdmin` e o mesmo rate limit (`notificationTokenLimiter`) já usado pelas rotas de passageiro/motorista.
- Gatilhos reais conectados: `captain.controller.js: registerCaptain` (novo motorista aguardando aprovação), `ride.controller.js: submitReview` (denúncia — só quando `issueCategory` é preenchido e diferente de `'none'`), `webhook.controller.js` (evento `PAYMENT_OVERDUE`/`PAYMENT_DECLINED` do Asaas, que antes só caía em "Event ignored").
- **Bug real pego pela suíte:** meu teste usava um valor de `issueCategory` inventado (`'comportamento_inadequado'`) que não existe no enum real da rota (`ride.routes.js`: `['none', 'delay', 'behavior', 'vehicle_cleanliness', 'overcharge']`) — corrigido pra `'behavior'`. Ao investigar isso, achei um bug de verdade na minha própria correção: `'none'` é um valor **válido** desse enum (significa "sem problema"), mas meu `if (issueCategory)` trataria qualquer valor truthy — incluindo `'none'` — como denúncia. Corrigido para `if (issueCategory && issueCategory !== 'none')`, com teste dedicado confirmando que `'none'` não dispara alerta nenhum.

**admin-frontend (app novo, sem infraestrutura de push nenhuma antes):**
- `package.json` — dependência `firebase` adicionada (mesma versão do app do passageiro/motorista).
- `.env.example` — variáveis `VITE_FIREBASE_*` documentadas.
- `src/services/firebase.js`, `src/services/fcm.js` (novos) — mesmo padrão robusto já validado no app do passageiro/motorista: registro explícito do Service Worker com escopo próprio, e `isSupported()` antes de chamar `getMessaging()` (evita o mesmo bug de unhandled rejection já corrigido na Fase 5).
- `public/firebase-messaging-sw.js` (novo) — mais simples que o do motorista: só mostra a notificação e abre o painel ao clicar, sem lógica de "aceitar corrida".
- `src/contexts/AuthContext.jsx` — `login()` e a restauração de sessão (`GET /admin/me` bem-sucedido) chamam `requestAdminFCMToken()`; `logout()` desvincula o token do dispositivo antes de encerrar a sessão (mesma lógica de A3).
- `src/App.jsx` — push em primeiro plano (A9): `onAdminForegroundMessage` mostra o alerta como toast, reaproveitando o `ToastContext` que já existia no painel.

### Verificação feita (sem mocks)

- Testes reais adicionados a `notification.push.test.js`: admin registra o próprio token (sem `userId`/`captainId`); novo motorista se cadastrando gera alerta; denúncia com `issueCategory` válido gera alerta; avaliação sem `issueCategory` **não** gera alerta; avaliação com `issueCategory:'none'` também **não** gera alerta (prova do bug corrigido acima); webhook `PAYMENT_OVERDUE` gera alerta.
- **Suíte completa do backend:** `18 suites, 130 testes, todos passando`.
- **admin-frontend:** build passou; suíte de testes rodada duas vezes — uma com os arquivos originais (`git stash`) e outra com as mudanças da Fase 7, pra confirmar de forma empírica (não só por inspeção) que as 2 falhas em `Login.test.jsx` já existiam antes de qualquer mudança desta fase (seletor de teste desatualizado — `getByPlaceholderText(/Email/i)` não bate com o placeholder real `"admin@movecity.com"` — não relacionado a push). Nenhuma falha nova.

---

## 9. Fase 8 — auditoria final

Reauditoria do sistema como ficou, procurando o que sobrou: mocks, dados estáticos, localhost, tokens sem dono, notificações sem tratamento, código morto, chamadas sem await, e falhas de segurança.

### 🔴 Achado que bloqueia o objetivo principal (NÃO corrigido — exige decisão de produto)

**Um motorista com o app FECHADO nunca é candidato ao despacho — portanto nunca recebe a push de corrida nova.**

`services/maps.service.js: getCaptainsInTheRadius` exige `socketId != null` **e** `isOnline: true`. E `socket.js`, no `disconnect`, grava exatamente o oposto quando o app fecha: `socketId: null` e `isOnline: false`.

**Verificado empiricamente** (dois motoristas idênticos no mesmo ponto, um com socket vivo e outro no estado exato que o `disconnect` grava, consultando o mesmo `getCaptainsInTheRadius` de produção):

```
Motoristas encontrados pelo despacho: [ 'aberto@test.com' ]
App ABERTO  recebe oferta de corrida? SIM
App FECHADO recebe oferta de corrida? NAO
=> Push com app fechado e alcancavel hoje? NAO — o motorista nem chega a ser candidato ao despacho
```

Ou seja: toda a infraestrutura de push corrigida nas Fases 1–7 está correta e funcionando, mas o **evento que a dispararia nunca acontece** para um motorista com o app fechado. O push só alcança, hoje, um motorista que está com o app aberto — exatamente o caso em que o Socket.IO já resolveria.

**Por que não corrigi:** isto não é um bug de notificação, é a regra de despacho de corridas — e a instrução foi explícita: *"Não altere regras de negócio existentes"*. Mudar isso altera o matching: um motorista com o app fechado passaria a receber ofertas que pode não responder, atrasando o passageiro. É uma decisão de produto, sua, não minha. As opções reais:

1. **Manter como está** — push serve só de reforço para quem está com o app aberto/em segundo plano com socket vivo. O motorista precisa deixar o app aberto para receber corridas (é o comportamento atual, e o mais simples).
2. **Separar "disponível" de "conectado"** — parar de derrubar `isOnline` no `disconnect` e passar a confiar num "ficar online/offline" explícito do motorista + um heartbeat/TTL. Aí o push com app fechado passa a fazer sentido e o fluxo de aceite pela notificação (já pronto) vira útil de verdade. É a mudança que entrega o que foi pedido, e a mais invasiva.
3. **Meio-termo** — despachar para motoristas com socket vivo (como hoje) e, se ninguém aceitar em N segundos, ampliar para os que estão `isOnline` mas sem socket, só por push.

### ✅ Corrigido nesta fase

| Achado | O que era | Correção |
|---|---|---|
| **M7 (user-facing, sobreviveu a todas as fases)** | `firebase-messaging-sw.js` mandava **todo** clique sem ação de aceite para `/captain-home`. Um passageiro tocando em "Corrida Aceita!" ia parar na tela inicial do **motorista**. | Backend passa a mandar a rota certa em `data.deepLink` (`DEEP_LINK` no dispatcher); o SW usa ela. |
| **`localhost` no Service Worker** | `const apiUrl = data.apiUrl \|\| 'http://localhost:4000'` — o SW chamaria o próprio aparelho do motorista. | Fallback removido. Sem `apiUrl`, abre o app em vez de chamar localhost. |
| **Botão que não teria como funcionar** | Em produção sem `BASE_URL`, a oferta vinha com "✅ Aceitar" que falharia em silêncio. | As ações inline são omitidas nesse caso — a notificação chega igual, só sem o botão quebrado. |
| **`deepLink` de campanha** | O painel grava nome lógico (`'promotions'`); o SW receberia isso como caminho relativo. | Traduzido para rota real (`/coupons`) no `CAMPAIGN_DEEP_LINK_ROUTE`. |
| **Código morto (M11, meio-corrigido antes)** | `sendPromotion` continuava sem nenhum chamador — só `sendRechargeApproved` tinha sido ligada na Fase 5. | Removida. Push promocional já é coberto (melhor) pelo fluxo de campanhas: `createPromotion` cria uma `NotificationCampaign` espelho quando `sendPush` está marcado, com segmentação, agendamento e métricas. |

6 testes novos cobrindo os deep links por destinatário e o caso "produção sem BASE_URL".

### Resultado das demais verificações pedidas

- **Mocks / dados estáticos:** nenhum no código de produção do sistema de push. Os únicos mocks são de teste (`tests/mocks/firebase-admin.mock.js`, `services/__mocks__/maps.service.js`) — legítimos e limitados a APIs externas. O filtro de palavrão do chat (`chat.controller.js:73`) continua sendo um mock declarado, mas é pré-existente e fora do escopo de push.
- **localhost:** as ocorrências restantes são todas legítimas — allowlist de CORS em dev (com `FRONTEND_URL` para produção), fallbacks de scripts manuais, e testes.
- **Tokens sem dono:** impossível pelo `registerToken` (sempre grava um dono). Não existe endpoint de exclusão de conta no backend, então não há a via de token órfão por conta apagada. `NotificationToken` só é tocada pelo `tokenRegistry` e pela migração — **nenhum endpoint da API devolve tokens**.
- **Chamadas sem await/catch:** varredura em `controllers/`, `services/` e `socket.js` não encontrou nenhuma chamada de notificação sem `await` ou `.catch()`.
- **Segurança:** registro de token exige autenticação + rate limit; remoção só pelo dono; token nunca aparece completo em log; chat exige prova de participação na corrida.

### Residuais conhecidos (documentados, não escondidos)

1. **Usuário bloqueado mantém o token FCM registrado** — `toggleUserBlock` revoga a sessão e derruba o socket, mas não remove o token. Na prática só afeta broadcast administrativo, e as campanhas já têm o filtro `isBlocked` para controlar isso deliberadamente.
2. **`metrics.opened` / `metrics.clicked` (M8)** — continuam sempre 0; instrumentar exige rastrear abertura/clique no cliente, funcionalidade nova que não foi pedida.
3. **`POST /api/admin/notifications` (M6)** — endpoint legado sem UI. O bug de segmentação dele (C4) foi corrigido, então não é mais perigoso, mas continua sendo superfície sem uso.
4. **Fila em memória** — um restart perde envios em voo (o registro em `Notification` já está no banco). Limitação assumida e isolada em `queue.service.js`; trocar por BullMQ/Redis é substituir um arquivo.
5. **Conteúdo da mensagem de chat no histórico** — o preview (100 chars) é persistido em `Notification`. Comportamento padrão de apps de mensagem, mas é dado de conversa em outra coleção.

### Cenários pedidos — status real

| # | Cenário | Status |
|---|---|---|
| 1 | Passageiro cria corrida com motorista offline | ✅ Motorista offline não é despachado nem notificado (correto) |
| 2 | Motorista recebe push com app fechado | ❌ **Bloqueado pelo achado acima** — não é alcançável hoje |
| 3 | Motorista aceita pelo botão da notificação | ⚠️ Caminho de código correto e testado, mas inalcançável na prática pelo mesmo motivo; a confirmação final exige navegador real + Firebase real |
| 4 | Passageiro recebe confirmação | ✅ Testado |
| 5 | Motorista muda status | ✅ Testado (A5) |
| 6 | Passageiro recebe atualização | ✅ Testado |
| 7 | Chat funciona fechado | ✅ Testado (A7) |
| 8 | Logout remove notificações | ✅ Testado (A3) |
| 9 | Admin envia notificação segmentada | ✅ Testado (C4 + Fase 7) |

### Verificação

- **Backend:** 18 suites, **136 testes**, todos passando.
- **Builds:** `frontend`, `admin-frontend` e sintaxe dos dois Service Workers — todos OK.
- **Frontend:** as mesmas 3 falhas pré-existentes já documentadas (baseline conhecida), nenhuma nova.

### Veredito

O **sistema de notificações** está corrigido e pronto: segmentação correta, sem duplicidade, resiliente a falha, com chunking, retry, limpeza de token inválido, segurança de chat e canal para o admin. O que **não** está pronto é o **fluxo de ponta a ponta prometido** ("motorista recebe e aceita corrida com o app fechado") — não por causa do push, mas porque a regra de despacho exclui quem está com o app fechado. Enquanto isso não for decidido (item acima), o push continua sendo reforço para quem está com o app aberto, não um canal para quem está fora dele.
