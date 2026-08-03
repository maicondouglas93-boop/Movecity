# Auditoria de Regressão — Sistema de Notificações Push

**Data:** 2026-08-03
**Método:** comparação de código real (`git diff` contra o último estado com push comprovadamente funcional, commit `5fba884`), leitura direta com citação de arquivo/linha, e reprodução com backend real + MongoDB real (sem mocks) sempre que a máquina permitiu terminar a execução a tempo. Este documento nasceu só como diagnóstico (nenhuma alteração de código durante a auditoria em si); a seção "Correção aplicada", no final, registra o que foi implementado depois, já com a causa raiz confirmada.

## Resumo executivo

**As notificações não estão quebradas no sentido em que a pergunta foi feita.** Firebase, Service Worker, `firebase-messaging-sw.js`, `fcm.js`, `swCommunication.js` e os botões Aceitar/Recusar estão **byte-a-byte idênticos** ao último estado em que o push foi validado de ponta a ponta com testes reais passando (confirmado por `git diff 5fba884 HEAD`, sem nenhuma diferença nesses arquivos). Eles não são a causa.

A regressão está uma etapa **antes** de qualquer coisa relacionada a Firebase acontecer: o motorista está saindo silenciosamente do **raio de despacho** por causa de uma alteração de segurança feita nesta mesma sessão (commit `9b190a9`, que exige JWT válido no evento `join` do Socket.IO). O efeito: `dispatchRideToCaptains` nunca encontra aquele motorista como candidato, então o sistema de push **nunca chega a tentar enviar nada** — não é uma falha de entrega, é uma falha de elegibilidade. Do ponto de vista do motorista, a corrida simplesmente nunca chegou.

Essa correção de segurança era necessária e correta (fechava uma falha real, documentada na auditoria PWA anterior: qualquer socket conectado podia se passar por qualquer motorista/usuário). O problema não é a existência da verificação — é que ela criou uma **dependência nova e não tratada**: o evento que mantém o motorista "vivo" para efeito de despacho (`lastSeenAt`) só é atualizado dentro do mesmo handler que agora exige um token que pode estar expirado no momento exato da reconexão, e não existe nenhum mecanismo que renove esse token antes de tentar de novo.

## Fluxo completo analisado

```
Passageiro cria corrida
        │
        ▼
ride.controller.js: dispatchRideToCaptains
        │
        ▼
maps.service.js: getCaptainsInTheRadius  ← usa captainService.availabilityFilter()
        │
        ▼
captain.service.js: availabilityFilter()  ← filtra isOnline + lastSeenAt dentro do TTL (15min)
        │
        ├── lastSeenAt DENTRO do TTL → motorista é candidato → segue pro notificationDispatcher → Firebase → SW → notificação aparece ✅ (fluxo intacto, nada mudou aqui)
        │
        └── lastSeenAt FORA do TTL → motorista NUNCA é candidato → dispatchRideToCaptains nem tenta notificá-lo → nada é enviado ao Firebase, não há erro, não há log de falha de push, porque a push NUNCA FOI TENTADA ❌ ◄── É AQUI QUE QUEBRA
```

`lastSeenAt` só é escrito em dois lugares em todo o backend (confirmado por busca no repositório inteiro):

- `Backend/socket.js` — dentro do handler `join`, ramo `captain` (linha ~98-101)
- `Backend/socket.js` — dentro do handler `update-location-captain` (linha ~119-122, `Backend/services/captain.service.js:35: touchLastSeen` existe mas **não é chamado em lugar nenhum do código** — função morta, sem nenhuma rota REST que sirva de caminho alternativo)

Os dois agora **exigem** `socket.data.identity`, que só existe depois de um `join` bem-sucedido com JWT válido. Antes da mudança desta sessão, `join` gravava `lastSeenAt` incondicionalmente, só com base no `userId` que o cliente mandasse — sem checar token nenhum.

## Problemas críticos

### R1 — `join` com token JWT expirado impede a renovação de `lastSeenAt`, tirando o motorista do despacho sem nenhum aviso
**Arquivo:** `Backend/socket.js:64-113` (handler `join`) + `Backend/socket.js:140-153` (`update-location-captain`, mesma dependência)
**Frontend correlato:** `frontend/src/modules/driver/pages/CaptainHome.jsx:138-155` e `CaptainRiding.jsx` — `token: getAccessToken('captain')` é uma leitura **síncrona e direta** do `localStorage`, sem nenhuma verificação de validade/expiração antes de mandar.

**Causa raiz:** o access token JWT dura 15 minutos (fato já estabelecido em auditoria anterior desta sessão). A tela do motorista (`CaptainHome.jsx`) esperando corrida **não faz nenhuma chamada REST periódica** — o único tráfego contínuo é o `update-location-captain` via socket (a cada 10s) e o próprio `join` (só reemitido em reconexões). Como a renovação do token só acontece de forma **reativa**, disparada por um 401 numa chamada HTTP (`frontend/src/services/axios.js:69-152`), e nada nessa tela faz esse tipo de chamada, o token pode ficar expirado por tempo indefinido sem que nada o renove.

Se, nesse meio-tempo, o socket cair e reconectar — cenário comum em celular real: app minimizado, troca de wifi/dados móveis, Doze mode do Android suspendendo a aba em segundo plano (já documentado na auditoria PWA como limitação real de plataforma) — o `handleConnect` reemite `join` com o token **já vencido**. O backend rejeita (`jwt.verify` lança, `Backend/socket.js:71-75`), devolve `ack({ok:false})`, e o frontend **não faz nada com essa resposta** (`CaptainHome.jsx:143-148`: só age no ramo `if (response?.ok)`, o `else` é silêncio total).

Resultado: `lastSeenAt` fica congelado no último valor bem-sucedido. Assim que essa marca de tempo passa dos 15 minutos do TTL de disponibilidade (`captain.service.js:12`, `AVAILABILITY_TTL_MINUTES`), o motorista sai do filtro de despacho — mesmo com o app aberto, mesmo com o socket mostrando "conectado" do lado do cliente (a reconexão do transporte aconteceu; só o `join` de aplicação falhou).

**Por que isso não existia antes:** antes do commit `9b190a9`, `join` gravava `lastSeenAt` **incondicionalmente**, aceitando qualquer `userId` sem checar token — ou seja, TODA reconexão, mesmo com token vencido, renovava a disponibilidade. A correção de segurança fechou a falha real de spoofing, mas como efeito colateral passou a exigir, para essa renovação, exatamente o dado (token válido) que nada nessa tela garante estar em dia.

**Impacto:** motorista para de receber QUALQUER corrida nova (não só via push — nem via Socket.IO em primeiro plano, porque `dispatchRideToCaptains` filtra antes de emitir para qualquer canal), sem nenhum erro visível pra ele. Do lado do passageiro, se for o único motorista na região, a busca simplesmente não encontra ninguém.

**Como reproduzir (passo a passo, sem mock):**
1. Motorista faz login, fica online, `join` bem-sucedido, `lastSeenAt` grava agora.
2. Esperar (ou simular) o access token expirar — 15 minutos, ou gerar um JWT já expirado com o mesmo `_id`.
3. Forçar uma reconexão do socket (queda de rede simulada, ou `socket.disconnect()` seguido de reconexão automática do cliente).
4. `handleConnect` reemite `join` com o token expirado → backend rejeita, `ack.ok === false`.
5. Esperar `lastSeenAt` ultrapassar o TTL (ou já usar um `lastSeenAt` inicial antigo o suficiente para o teste).
6. Passageiro cria uma corrida com esse motorista como único candidato na região.
7. Verificar: nenhum documento `Notification` do tipo `NEW_RIDE` é criado para esse motorista — a notificação nunca foi tentada.

*Nota de transparência: escrevi um teste (`Backend/tests/sockets/_diagnostic_regression.test.js`) reproduzindo exatamente esses passos contra o MongoDB real de teste, seguindo a mesma etapa 1-7. A máquina ficou com contenção severa de recursos (20+ processos Node acumulados de execuções anteriores nesta sessão) e a execução não terminou a tempo de eu conseguir capturar o resultado antes de fechar este relatório — o arquivo de teste foi apagado (não deixei nenhum resíduo no repositório, conforme pedido de "não implementar nada"). A conclusão acima está fundamentada 100% na leitura direta do código (a cadeia de chamadas `dispatchRideToCaptains → getCaptainsInTheRadius → availabilityFilter → lastSeenAt`, e a confirmação de que `join`/`update-location-captain` são os ÚNICOS pontos que escrevem `lastSeenAt` em todo o backend), não em execução automatizada confirmada. Recomendo rodar esse teste (ou algo equivalente) num ambiente limpo antes de aplicar qualquer correção, para converter isso de "evidência de código" em "evidência empírica".*

## Problemas altos

### R2 — Nenhum tratamento de falha de `join` no frontend
**Arquivo:** `CaptainHome.jsx:143-148`, `CaptainRiding.jsx` (mesmo padrão), `Home.jsx`, `Riding.jsx` (lado passageiro, mesma exposição em menor grau — ver R4)
```js
socket.emit('join', {...}, (response) => {
    if (response?.ok) {
        flushQueuedLocations(socket).catch(e => console.error(e))
    }
    // response.ok === false: nada acontece
})
```
**Impacto:** mesmo que o backend avise claramente que o `join` falhou (`ack.ok:false` + evento `unauthorized`), o cliente não faz nada — não tenta renovar o token, não avisa o motorista, não tenta de novo. É o ponto exato onde uma correção pequena resolveria o R1 sem reverter nada da segurança (ver "Menor correção recomendada").

### R3 — Renovação de token 100% reativa, sem nenhum gatilho proativo
**Arquivo:** `frontend/src/services/axios.js:69-152` (toda a lógica de refresh vive dentro do interceptor de resposta, só dispara em 401 de uma chamada HTTP real)
**Impacto:** combinado com R1, é a peça que torna o cenário do R1 não apenas possível, mas **garantido de acontecer** em qualquer sessão longa de motorista esperando corrida, porque não há nenhuma chamada HTTP regular nessa tela que sirva de gatilho de renovação.

### R4 — O mesmo padrão de risco existe (com impacto menor) no lado do passageiro
**Arquivo:** `Home.jsx`, `Riding.jsx` — mesmo `token: getAccessToken('user')` síncrono no `join`.
**Impacto:** menor severidade porque o passageiro normalmente está olhando a tela ativamente durante uma corrida (mais chances de já ter feito alguma chamada REST recente que renovou o token), mas o mesmo mecanismo pode, em teoria, deixar o passageiro sem receber atualizações em tempo real (motorista aceitou, chegou etc.) se o socket cair e reconectar com token vencido — nesse caso ele não sai de nenhum "raio de despacho" (não existe esse conceito pro lado passageiro), mas fica sem `socketId` atualizado no banco, então eventos endereçados a ele (`io.to(socketId)`) se perdem até a próxima reconexão bem-sucedida.

## Problemas médios

### R5 — `touchLastSeen()` é código morto que sugere uma correção parcial nunca finalizada
**Arquivo:** `Backend/services/captain.service.js:35`
Existe uma função pronta pra atualizar `lastSeenAt` fora do fluxo de socket, mas nada no backend a chama. Não é a causa da regressão, mas é um indício de que talvez já existisse a intenção de ter um caminho alternativo (ex.: um heartbeat via REST) que nunca foi conectado a nenhuma rota.

### R6 — Nenhum log de "candidatos = 0 por causa do TTL" facilmente distinguível de "candidatos = 0 por não haver motorista nenhum na região"
**Arquivo:** `Backend/controllers/ride.controller.js` / `Backend/services/maps.service.js`
Quando `dispatchRideToCaptains` não encontra ninguém, o log (`[AUDIT] 0 motoristas encontrados num raio de Xkm`) não diferencia "não há motorista fisicamente perto" de "há motorista perto, mas fora do TTL de disponibilidade". Isso torna o diagnóstico deste tipo de regressão mais lento em produção — só descobri a causa lendo código, não pelos logs.

## Problemas baixos

### R7 — `ack` do `join` não distingue "token ausente/inválido" de "usuário/motorista bloqueado" para quem for tratar a resposta no futuro
**Arquivo:** `Backend/socket.js` (função `reject`, dentro do handler `join`)
A mensagem (`message`) já diferencia motivos (`'Token ausente'`, `'Token inválido'`, `'Motorista inválido'`), mas não há um código de erro estruturado — hoje é só texto livre. Não bloqueia a correção do R1/R2, mas vale considerar ao implementá-la (retry só faz sentido pra "token ausente/inválido", não pra "motorista bloqueado").

## Causa raiz da regressão

**Commit `9b190a9`** (`fix(security): exige JWT no join do Socket.IO e alerta sobre notificacao bloqueada`), aplicado nesta mesma sessão como parte da correção dos achados críticos C1/C2 da auditoria PWA. A mudança em si — exigir autenticação real no `join` — era necessária e está correta; o problema é que ela acoplou a **elegibilidade de despacho** (`lastSeenAt`) à validade momentânea de um token de 15 minutos, num fluxo (tela de espera de corrida do motorista) que não tem nenhum outro gatilho de renovação de token. O sintoma relatado ("notificações pararam de chegar") é uma consequência de segunda ordem: a notificação nunca chega a ser **tentada**, então parece um problema do sistema de push, mas o sistema de push em si (Firebase, SW, botões) está intacto e não mudou uma linha desde a última verificação com testes passando.

## Menor correção recomendada

**Não reverter a exigência de JWT no `join`** — isso reabriria a vulnerabilidade de spoofing de identidade documentada na auditoria PWA (C1/C2).

A correção mínima fica inteiramente no frontend, sem tocar em nada da arquitetura de segurança:

1. Quando o `ack` do `join` vier com `{ok: false}` (ou o evento `unauthorized` disparar), tentar renovar o access token e reemitir `join` **uma vez** com o token novo — reaproveitando exatamente a mesma lógica de refresh que `axios.js` já usa pra 401 de REST (`POST /captains/refresh` / `POST /users/refresh` + `saveSession`), só que disparada a partir do socket em vez de a partir de uma resposta HTTP.
2. Isso pode ficar centralizado em `SocketContext.jsx` (um único lugar) ou replicado nos quatro `handleConnect` (`CaptainHome.jsx`, `CaptainRiding.jsx`, `Home.jsx`, `Riding.jsx`) — centralizar é preferível, evita repetir a lógica quatro vezes.
3. Nenhuma mudança no backend é necessária — `Backend/socket.js` já devolve tudo que o frontend precisa pra decidir (`ack.ok`, `message`).

Isso fecha o buraco sem abrir mão de nenhum ganho de segurança da correção original.

---

## Respostas às 10 perguntas obrigatórias

**1. Em qual etapa do fluxo as notificações deixam de funcionar?**
Antes de qualquer coisa relacionada a Firebase acontecer — na seleção de candidatos ao despacho (`dispatchRideToCaptains → getCaptainsInTheRadius → availabilityFilter`). O motorista afetado nunca entra na lista de quem recebe a notificação; o sistema de push nunca é acionado pra ele.

**2. Qual alteração introduziu a regressão?**
Commit `9b190a9` desta sessão, especificamente a exigência de JWT no handler `join` de `Backend/socket.js`, combinada com a ausência de qualquer renovação de token antes de reemitir `join` no frontend (`CaptainHome.jsx`/`CaptainRiding.jsx`).

**3. Os botões "Aceitar" e "Recusar" realmente causaram o problema?**
Não. `firebase-messaging-sw.js` (onde os botões e o `notificationclick` estão implementados) está byte-a-byte idêntico ao último estado com testes passando — zero diferença no `git diff`. O endpoint REST que o botão "Aceitar" chama (`POST /rides/:id/accept`) usa middleware de autenticação HTTP (`authCaptain`), que não foi alterado.

**4. Existe conflito entre o Service Worker do PWA e o Firebase Messaging?**
Não encontrado. `fcm.js` registra o worker do Firebase em escopo próprio (`/firebase-cloud-messaging-push-scope`), separado do worker do vite-plugin-pwa — mecanismo inalterado nesta sessão. A mudança que houve no registro do SW principal (`vite.config.js: injectRegister`, correção A1 da auditoria PWA) afeta só o `sw.js` gerado pelo Workbox, não o `firebase-messaging-sw.js`.

**5. O token FCM está sendo gerado corretamente?**
Sim, pelo que o código mostra (`fcm.js` inalterado) — mas isso é irrelevante pro sintoma relatado, porque o motorista nunca chega a ser selecionado como destinatário antes de qualquer coisa relacionada a token FCM entrar em ação.

**6. O backend está enviando a notificação ao Firebase?**
Para os motoristas afetados pela regressão, não — `sendPush`/`notificationDispatcher` nunca são chamados pra eles, porque `dispatchRideToCaptains` já os filtrou antes.

**7. O Firebase está aceitando ou rejeitando o envio?**
Não se aplica — a chamada ao Firebase nunca acontece pros motoristas afetados.

**8. O Service Worker recebe a mensagem?**
Não se aplica, pelo mesmo motivo.

**9. A notificação chega ao dispositivo?**
Não, mas não por falha de entrega — por falta de tentativa de envio.

**10. Qual é a menor correção possível pra restaurar o funcionamento, preservando toda a arquitetura implementada?**
Ver seção "Menor correção recomendada" acima: auto-renovação de token no frontend quando o `join` falhar, sem tocar em nada do backend nem reverter a exigência de autenticação.

---

## Correção aplicada (2026-08-03, após confirmação da causa raiz)

Implementada exatamente a "menor correção recomendada" (R1/R2/R3), centralizada em um único lugar, sem nenhuma alteração no backend:

- **`frontend/src/services/axios.js`** — a lógica de renovação de token, que só existia dentro do interceptor de resposta (disparada por um 401 de REST), foi extraída para uma função exportada `refreshAccessToken(kind)`. Mantém a mesma fila (`isRefreshing`/`refreshQueue`) de antes, então uma renovação disparada pelo socket e uma disparada por uma chamada REST concorrente nunca fazem duas chamadas simultâneas ao backend — o interceptor agora só chama essa função em vez de repetir a lógica.
- **`frontend/src/services/socketAuth.js`** (novo) — `joinWithRetry(socket, {userId, userType}, onSuccess)`: emite `join` com o token atual; se o `ack` vier `{ok:false}`, chama `refreshAccessToken` e reemite `join` **uma única vez** com o token novo. Se a renovação também falhar (sessão realmente morta), desiste — `refreshAccessToken` já desloga nesse caso, mesmo comportamento que uma sessão morta já teria numa chamada REST comum.
- **`CaptainHome.jsx`, `CaptainRiding.jsx`, `Home.jsx`, `Riding.jsx`** — os quatro `handleConnect` que emitiam `join` diretamente passaram a chamar `joinWithRetry`.
- **`frontend/src/tests/services/socketAuth.test.js`** (novo) — 3 testes cobrindo exatamente os três caminhos: join bem-sucedido de primeira (não renova nada), join rejeitado por token vencido → renova → reemite com sucesso (o cenário real da regressão), e join rejeitado + renovação também falha (desiste sem quebrar).
- Ajuste de teste: `Home.test.jsx` precisou de um mock novo pra `@/services/axios` — `Home.jsx` passou a puxar esse módulo transitivamente (via `socketAuth.js`), e como o teste já mocka o pacote `axios` cru sem um `create()` de verdade, o carregamento do arquivo quebrava; mockado pelo mesmo motivo que os outros serviços já mockados nesse arquivo.

**Verificação:** build do frontend limpo; suíte completa do frontend sem novas falhas (mesmo baseline de sempre: `e2e/rideFlow.spec.js` e `UserLogin.test.jsx`, nenhum dos dois relacionado); backend em 154/154 (não foi tocado — a correção é 100% frontend, o backend já devolvia tudo que era necessário).

**O que ainda não foi confirmado empiricamente:** a reprodução completa contra Firebase real (dispositivo físico recebendo a notificação depois do `join` se recuperar sozinho) não foi possível neste ambiente, pela mesma limitação já documentada em auditorias anteriores desta sessão (sem credenciais reais do Firebase configuradas para teste). O que foi verificado é o mecanismo de auto-renovação em si (testes unitários) e a ausência de regressão no restante da suíte.
