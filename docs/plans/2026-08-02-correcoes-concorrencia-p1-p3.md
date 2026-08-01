# Plano de Correção — Concorrência e Integridade (P1 → P3)

**Base:** [auditoria de 2026-08-01](2026-08-01-auditoria-concorrencia-consistencia.md)
**Priorização:** definida pelo usuário em 2026-08-02.
**Status:** ✅ concluído em 2026-08-02 — todas as 6 etapas (P1.1, P1.3, P1.2, P2.1, P2.2, P3.1+P3.2) implementadas e verificadas ao vivo. Nada commitado.

---

## 0. Premissas verificadas antes de planejar

Checagens feitas contra o ambiente real, porque o plano depende delas:

| Premissa | Resultado | Consequência |
|---|---|---|
| MongoDB suporta transações? | ✅ **Sim** — Atlas replica set `atlas-ic4rgt-shard-0`, MongoDB 8.0.29. Transação aberta e abortada com sucesso no teste. | A abordagem com `session` para P1.1 é viável como especificado. |
| Quem chama `POST /rides/confirm`? | `CaptainHome.jsx:160` (app real), `tests/integration/ride.api.test.js:69`, `test_ride_flow.js:102` (script manual) | Blast radius pequeno e conhecido. |
| O teste de integração de `/rides/confirm` quebra ao virar wrapper? | ❌ **Não** — ele cria a corrida com `status:'requested'` e espera 200 + `accepted`. Esse contrato se mantém no wrapper atômico. | Nenhum teste precisa ser reescrito para P1.3. |
| Quem chama `walletService.createTransaction`? | 5 chamadores de produção (`admin.service`, `webhook.controller`, 3× `ride.service`) + 5 em testes | `session` entra como parâmetro **opcional** → mudança retrocompatível. |
| Baseline de testes do backend | **1 falha \| 70 passes (71 total)** | A falha é `POST /rides/create` → 500 (pré-existente, depende de geocoding externo). É contra isso que comparo. |

---

## P1 — Integridade financeira

### P1.1 — `confirmPaymentReceived` idempotente e transacional

**Arquivos:** `Backend/services/ride.service.js`, `Backend/services/wallet.service.js`, `Backend/models/transaction.model.js`

**O que muda:**

1. **Guarda atômica primeiro, dinheiro depois.** Hoje a ordem é: lê → credita → debita → marca `paid`. Inverte para:

   ```js
   const claimed = await rideModel.findOneAndUpdate(
       { _id: rideId, captain: captain._id, status: 'finished', paymentStatus: { $ne: 'paid' } },
       { $set: { paymentStatus: 'paid' } },
       { new: true, session }
   );
   if (!claimed) → 409 e nenhuma movimentação
   ```
   Quem perder a corrida não movimenta nada. A marcação vira o *claim* da operação.

2. **Transação envolvendo tudo.** `session` abrangendo: marcação de `paid` + 2 lançamentos de carteira + `$inc` em `captain` + `$inc` em `user`. Se qualquer passo falhar, nada é aplicado.

3. **`createTransaction` aceita `session` opcional.** Assinatura `({..., session })`; repassa para `transactionModel.create([...], { session })` e para a atualização da carteira. Sem `session`, comportamento idêntico ao atual → os outros 4 chamadores não mudam.

4. **Carteira com `$inc` em vez de `save()`.** `wallet.service.js:18-62` faz read-modify-write nos saldos. Dentro de uma transação isso não é suficiente sob concorrência de writes distintos; troco por `findOneAndUpdate` com `$inc` nos campos afetados, retornando o documento novo para calcular `balanceBefore`/`balanceAfter` de forma coerente.

5. **Rede de segurança no schema:** índice único parcial em `transaction` `(rideId, type)` para `type ∈ {ride_payment, commission}`. Mesmo que uma regressão futura reintroduza o caminho duplo, o banco recusa o segundo lançamento.

**Ponto de atenção que preciso sinalizar:** `createTransaction` hoje também emite sockets (`wallet-updated`, `summary-updated`) e limpa cache **no meio** da função. Emitir socket dentro de transação é errado — se a transação abortar, o motorista já recebeu "carteira atualizada" de algo que não aconteceu. Vou mover os efeitos colaterais (socket + cache) para **depois do commit**.

**Como verifico:** 2 requisições concorrentes de `confirm-payment` para a mesma corrida → espero 1× 200 e 1× 409, e exatamente 2 documentos em `transactions` (um `ride_payment`, um `commission`), `earnings` incrementado uma vez.

---

### P1.2 — Fila offline só sai da fila com ACK

**Arquivos:** `frontend/src/contexts/SocketContext.jsx`, `frontend/src/services/db.js`, chamadores em `CaptainHome.jsx`, `ConfirmRidePopUp.jsx`, `FinishRide.jsx`

**O que muda:**

1. **Replay via HTTP, não via `socket.emit`.** Os eventos enfileirados (`accept-ride`, `start-ride`, `end-ride`, `confirm-payment`, `update-ride-status`) **não têm handler no backend** — hoje somem no vazio. Os endpoints REST equivalentes já existem e já são autenticados. Escrever handlers de socket duplicaria a lógica de negócio em dois lugares; o replay HTTP reaproveita exatamente o mesmo caminho da ação online.
   → cada item da fila passa a guardar `{ method, url, body }` em vez de um nome de evento solto.

2. **Remoção só após 2xx.** É o ACK que você pediu, na forma mais forte disponível: confirmação de que o servidor **aplicou**, não apenas de que recebeu.

3. **Taxonomia de resposta** (senão a fila trava para sempre ou repete indevidamente):

   | Resposta | Ação na fila |
   |---|---|
   | 2xx | remover — sucesso |
   | 409 (já aceita / já paga) | **remover** — o efeito desejado já existe no servidor; manter causaria retry infinito |
   | 4xx (400/403/404) | remover e registrar — pedido inválido, retry não resolve |
   | 5xx / falha de rede | **manter**, com backoff e contador de tentativas |
   | > N tentativas | mover para uma tabela `failedActions` e avisar o usuário |

4. **Ordem preservada e execução serial.** Hoje o `for` dispara em sequência mas apaga antes de saber o resultado. Passa a ser sequencial de verdade, parando no primeiro erro retentável para não aplicar `end-ride` antes de `start-ride`.

5. **A UI otimista precisa ser reconciliada.** Hoje `FinishRide.jsx:44` faz `setEnded(true)` no catch offline e segue como se tivesse dado certo. Vou marcar essas telas como "pendente de sincronização" em vez de "concluído", e só confirmar após o ACK.

**Dependência declarada:** o replay só é seguro depois de **P1.1**, porque um `confirm-payment` reenviado precisa ser idempotente. Por isso P1.1 vem antes na ordem de execução.

**Como verifico:** DevTools offline → finalizar corrida + confirmar pagamento → voltar online → conferir no Mongo que a corrida ficou `finished`/`paid`, que existem exatamente 2 lançamentos, e que a fila esvaziou. Depois, um caso de erro forçado (500) para confirmar que a ação **permanece** na fila.

---

### P1.3 — Aceite exclusivamente pelo endpoint atômico

**Arquivos:** `frontend/src/modules/driver/pages/CaptainHome.jsx`, `Backend/controllers/ride.controller.js`, `Backend/services/ride.service.js`

**O que muda:**

1. **Frontend passa a chamar `POST /rides/:id/accept`** (o `acceptRideAtomic`, que já existe, está correto e nunca foi usado), tratando **409 → "Corrida já aceita por outro motorista"** com fechamento do popup.

2. **`/rides/confirm` vira wrapper de `acceptRideAtomic`**, conforme sua direção. Escolho wrapper em vez de remoção porque:
   - há um app de motorista possivelmente instalado/em cache apontando para a rota antiga;
   - o teste de integração existente cobre essa rota e continua válido;
   - remover é uma quebra de contrato que não precisa acontecer agora.
   O wrapper passa a **rejeitar** o que hoje aceita silenciosamente: corrida já aceita, já iniciada, finalizada ou cancelada → 409.

3. **`ride-taken` passa a ser emitido também nesse caminho**, para os motoristas perdedores (hoje só o `/accept` emite, e ninguém escuta — o listener entra em P3.1).

**Como verifico:** dois motoristas aceitando a mesma corrida em paralelo → exatamente um 200 e um 409; no banco, um único `captain`.

---

## P2 — Consistência das corridas

### P2.1 — Máquina de estados com transição válida obrigatória

**Arquivo:** `Backend/services/ride.service.js`

Toda transição passa a ser **compare-and-set**: o status de origem entra no filtro do `findOneAndUpdate`, e `null` vira 409. Nunca mais `doc.save()` para mudar status.

| Operação | Origem permitida | Destino |
|---|---|---|
| aceitar | `requested` | `accepted` |
| a caminho | `accepted` | `going_to_pickup` |
| cheguei | `going_to_pickup`, `accepted` | `arrived` |
| iniciar (OTP) | `accepted`, `going_to_pickup`, `arrived`, `waiting_passenger` | `started` |
| finalizar | `started` | `finished` |
| cancelar (passageiro) | `requested`, `accepted`, `going_to_pickup`, `arrived`, `waiting_passenger` | `cancelled` |

Regra dura: **nenhuma transição pode partir de `finished` ou `cancelled`**. Isso elimina C3 (corrida cancelada revivendo) e C4 (iniciada+cancelada) na raiz, porque deixam de existir como sequências possíveis.

Um mapa explícito `TRANSICOES_VALIDAS` centraliza isso, em vez de espalhar `includes([...])` por cinco funções.

**Também nesta etapa:** índice parcial único `{ captain: 1 }` sobre status ativos, resolvendo C2 (motorista em duas corridas) no nível do banco.

**Como verifico:** teste de integração cobrindo cada transição inválida (esperando 409) + duas chamadas concorrentes de `cancel` e `start` na mesma corrida.

---

### P2.2 — Congelar a tarifa na criação da corrida

**Arquivos:** `Backend/models/ride.model.js`, `Backend/services/ride.service.js`

**Causa hoje:** `endRide` chama `PricingEngine.calculateFare` no momento da finalização, lendo a configuração **vigente naquele instante** e sobrescrevendo `fareBreakdown` e `commissionAmount`. Mudar tarifa no admin altera o preço de corridas já em andamento.

**O que muda:** no `createRide`, persistir um snapshot dos parâmetros usados (`pricingSnapshot`: tarifa base, por km, por minuto, multiplicadores aplicados, percentual de comissão, versão da configuração). No `endRide`, recalcular **a partir do snapshot**, variando apenas distância e tempo reais.

Efeito: tarifa e comissão ficam presas ao contrato do momento do pedido; alterações do admin valem só para corridas novas — exatamente a regra que você definiu.

**Como verifico:** criar corrida → alterar tarifa e comissão no admin → finalizar → conferir que `finalPrice` e `commissionAmount` seguem a tabela antiga.

---

## P3 — Tempo real

### P3.1 — Os três eventos sem ouvinte

**Arquivos:** `frontend/src/modules/passenger/pages/Home.jsx`, `frontend/src/modules/driver/pages/CaptainHome.jsx`

| Evento | Onde entra | Efeito |
|---|---|---|
| `ride-status-updated` | `Home.jsx` | Passageiro passa a ver "motorista a caminho" / "motorista chegou" em tempo real (hoje a tela fica congelada no momento do aceite) |
| `payment-confirmed` | `Home.jsx` / `Riding.jsx` | Passageiro sabe que o motorista confirmou o recebimento |
| `ride-taken` | `CaptainHome.jsx` | Fecha o popup do motorista que perdeu a corrida |

Como você observou, isso explica comportamentos "estranhos" já relatados: não era bug de UI, era evento chegando e sendo descartado por falta de listener.

---

### P3.2 — Bloqueio com efeito imediato

**Arquivos:** `Backend/services/admin.service.js`, `Backend/socket.js`

**Causa:** `authUser`/`authCaptain` resolvem o perfil via `getUserProfile`/`getCaptainProfile`, com **cache de 600 s**, e `toggleUserBlock`/`toggleCaptainBlock` não invalidam esse cache.

**O que muda no bloqueio:**
1. `deleteByPrefix('profile:captain:<id>')` / `profile:user:<id>` → efeito imediato na próxima requisição;
2. forçar `isOnline:false` + `status:'inactive'` no motorista bloqueado, tirando-o do pool de despacho;
3. desconectar o socket ativo (`io.sockets.sockets.get(socketId).disconnect(true)`);
4. limpar `drivers:` para o cache de busca não continuar servindo o bloqueado por até 10 s.

**Decisão que preciso confirmar com você:** o que fazer com uma **corrida em andamento** quando o motorista é bloqueado. Vejo três políticas defensáveis:
- **(a)** deixar a corrida terminar normalmente e só impedir novas — mais seguro para o passageiro que está dentro do carro;
- **(b)** cancelar imediatamente e notificar os dois lados — mais rígido, mas deixa o passageiro na rua;
- **(c)** bloquear novas corridas e sinalizar a corrida atual para o admin acompanhar.

Minha recomendação é **(a)**, porque bloqueio administrativo raramente é uma emergência de segurança física imediata, e interromper uma viagem em curso cria um problema pior que o que resolve. Se for um caso de emergência real, o fluxo correto é uma ação separada e explícita ("encerrar corrida agora"), não um efeito colateral do bloqueio.

---

## Ordem de execução e verificação

Cada bloco é uma etapa com verificação antes de seguir para a próxima, no mesmo formato das etapas anteriores do projeto:

| Etapa | Conteúdo | Verificação |
|---|---|---|
| 1 | P1.1 (pagamento idempotente + transação) | Teste de concorrência real (2 requisições paralelas) + suíte backend vs baseline |
| 2 | P1.3 (aceite atômico) | Dois motoristas simultâneos → 200/409 |
| 3 | P1.2 (fila offline com ACK) | Playwright offline→online ponta a ponta |
| 4 | P2.1 (máquina de estados) | Testes de transição inválida + concorrência cancel/start |
| 5 | P2.2 (congelar tarifa) | Alterar tarifa no meio da corrida e conferir preço final |
| 6 | P3.1 + P3.2 (listeners + bloqueio) | E2E de progresso da corrida; bloqueio com efeito imediato |

**Baseline a respeitar:** backend `1 falha | 70 passes` · frontend `3 falhas | 4 passes`. Comparo com `git stash` a cada etapa, como nas anteriores.

**Nada será commitado sem pedido explícito.**

---

## Pergunta aberta antes de começar

Preciso da sua decisão em **P3.2**: política para corrida em andamento quando o motorista é bloqueado — (a) deixar terminar (minha recomendação), (b) cancelar na hora, ou (c) sinalizar para o admin.

Nos demais itens sigo exatamente as direções que você definiu.

---

## Etapa 1 (P1.1) — detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

**`Backend/services/wallet.service.js`:** `createTransaction` reescrito. Saiu o `wallet.save()` (read-modify-write); entrou `findOneAndUpdate` com `$inc` + `upsert`, `session` opcional. `balanceBefore`/`balanceAfter` deixaram de vir de uma leitura separada — são derivados do próprio resultado atômico (`balanceAfter - delta`), então não têm janela de corrida nem custam uma query a mais. A regra de bloqueio por saldo negativo passou a rodar dentro da mesma `session` quando houver uma. Os efeitos colaterais (emit de socket, invalidação de cache) foram extraídos para `applySideEffects()`: sem `session`, rodam na hora (comportamento idêntico ao de sempre para `admin.service.js` e `webhook.controller.js`, que não passam `session`); com `session`, ficam sob responsabilidade do chamador, que deve chamá-los só depois do commit — emitir "carteira atualizada" antes do commit avisaria de um dinheiro que pode nunca ter sido efetivado.

**`Backend/models/transaction.model.js`:** índice único parcial `(rideId, type)` para `type ∈ {ride_payment, commission}` — rede de segurança contra regressão futura, não é a guarda principal.

**`Backend/services/ride.service.js` — `confirmPaymentReceived`:** reescrito com `mongoose.startSession()` + `session.withTransaction()`. Fluxo: pré-checagem (not found / not finished / already paid) para mensagens de erro precisas → `findOneAndUpdate` condicional (`status:'finished', paymentStatus:{$ne:'paid'}`) como guarda atômica de verdade → lançamentos de carteira → contadores de motorista e passageiro, tudo na mesma transação. `session.withTransaction` já faz retry automático de conflitos transitórios (duas transações disputando o mesmo documento) — nesse retry, a pré-checagem roda de novo e já vê o resultado da transação vencedora, então a corrida perdedora cai na mensagem "Payment already confirmed" de forma consistente, não numa exceção genérica.

**`Backend/controllers/ride.controller.js`:** mapeamento de erro alinhado ao padrão já usado em `acceptRide` — "Payment already confirmed" → 409 (não 500), "Ride not found" → 404, "Ride not finished yet" → 409.

**`Backend/tests/setup/testDatabase.js`:** trocado `MongoMemoryServer` (standalone) por `MongoMemoryReplSet` (1 nó). Sem isso, qualquer teste que abra uma transação falha em CI com "Transaction numbers are only allowed on a replica set member or mongos" mesmo estando correto — o ambiente de teste não refletia o Atlas real (que já é replica set). Confirmado que a suíte inteira continua rodando na mesma velocidade (~11s) com a troca.

**Achado incidental, fora do escopo original mas bloqueando a verificação do caminho de sucesso:** `notificationService.sendToUser` era chamada pelo controller mas nunca tinha sido exportada pelo módulo — `TypeError` derrubava com 500 **depois** do dinheiro já ter sido corretamente movimentado. Corrigido com uma linha (`module.exports.sendToUser = sendToUser`), expondo uma função que já existia e já estava correta. Sem essa correção eu não conseguiria provar que o caminho de sucesso (200) funciona de verdade — só teria visto os dois lados caindo em erro, mascarando se a idempotência realmente funcionava.

**Novo teste:** `tests/integration/ride.api.test.js` ganhou `POST /rides/confirm-payment (concorrência)` — duas requisições reais em paralelo (`Promise.all` contra o `app` via supertest) na mesma corrida `finished`. Verifica: exatamente um 200 e um 409; exatamente 2 documentos em `transaction` (não 4); `wallet.totalEarned`/`creditBalance` refletindo uma única aplicação; `captain.totalRides`/`earnings` sem duplicar.

**Verificação:**
- Suíte completa do backend: **1 falha \| 71 passes (72 total)** — baseline (`1 falha \| 70 passes`) + 1 teste novo passando. A falha é a mesma de sempre (`POST /rides/create` → 500, depende de geocoding externo, confirmado idêntico via comparação de mensagem/linha).
- **Verificação ao vivo contra o servidor de dev real e o MongoDB Atlas real** (não só Jest): script descartável criou usuário, motorista e corrida `finished` reais, disparou 2 requisições HTTP concorrentes de verdade contra `localhost:3000`, e conferiu o resultado direto no Atlas. Resultado: `[200, 409]`, 2 transações (`ride_payment` R$100, `commission` R$20), `wallet.creditBalance = -20`, `totalEarned = 100`, `captain.totalRides = 1`, `earnings = 100` — nenhum valor duplicado em nenhum campo. Dados de teste removidos ao final.

**Nada commitado.** Arquivos modificados: `wallet.service.js`, `ride.service.js`, `ride.controller.js`, `transaction.model.js`, `notification.service.js`, `tests/setup/testDatabase.js`, `tests/integration/ride.api.test.js`.

---

## Etapa 2 (P1.3) — detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

**`Backend/services/ride.service.js`:** removida a função `confirmRide` (o `findOneAndUpdate({_id})` sem checar status, que conseguia rebaixar até corridas `finished`/`cancelled` de volta pra `accepted`). Não virou wrapper dentro do service — o wrapper vive no controller, porque a lógica de negócio real é uma só (`acceptRideAtomic`) e não fazia sentido duplicá-la em duas funções de serviço que fariam a mesma coisa.

**`Backend/controllers/ride.controller.js`:** `confirmRide` e `acceptRide` agora delegam pra uma única função interna (`performAcceptRide`), diferindo só em de onde tiram o `rideId` (`req.body.rideId` vs `req.params.id`). Isso eliminou a duplicação que existia antes (dois blocos try/catch quase idênticos, um deles sem tratamento de 409/404) e garante que `/rides/confirm` — mantida como alias de compatibilidade, conforme sua direção — se comporta exatamente igual ao endpoint atômico: 409 quando já aceita/não está mais `requested`, 404 quando não existe. `ride-taken` passou a ser emitido também neste caminho.

**`frontend/src/modules/driver/pages/CaptainHome.jsx`:** `confirmRide()` (o handler do botão "Aceitar" do motorista) trocou de `POST /rides/confirm` para `POST /rides/:id/accept`. Novo tratamento explícito de 409: em vez de cair no `catch` genérico ("Falha ao confirmar corrida. Pode já ter sido aceita." — um chute), agora mostra "Essa corrida já foi aceita por outro motorista" com certeza (o servidor confirmou via status code) e fecha o popup, em vez de deixar o motorista tentando de novo numa corrida que não existe mais pra ele. O branch de fila offline (upload quando sem rede) não foi tocado aqui — é escopo da próxima etapa (P1.2), que reformula todo o mecanismo de fila.

**Build/testes:** suíte do backend na mesma baseline (`1 falha \| 71 passes`) — a mesma falha pré-existente de sempre. Um novo warning de console ("Cannot log after tests are done", vindo do cron do `tariffScheduler`) apareceu no output, mas é o mesmo vazamento de handle já observado na Etapa 1 (cron job global que roda a cada minuto independente do estado dos testes) — não é uma regressão, confirmado que os números de teste não mudaram.

**Verificação ao vivo contra o servidor de dev real e o Atlas real:**
- Dois motoristas descartáveis, um passageiro descartável, uma corrida `requested` real. Dois `POST /rides/:id/accept` disparados em paralelo de verdade: `[200, 409]`, e o banco mostra exatamente um dos dois motoristas como `captain` da corrida — nunca os dois, nunca nenhum.
- Corrida criada já `finished`, e um motorista tentando `POST /rides/confirm` nela: `409`, e o status no banco continua `finished` — confirmado que o bug de "reviver" corrida finalizada foi eliminado (antes, esse mesmo request teria retornado 200 e rebaixado a corrida pra `accepted`).
- Dados de teste removidos ao final.

**Nada commitado.**

---

## Etapa 3 (P1.2) — detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

**Reordenação de providers (`frontend/src/main.jsx`, `App.jsx`):** `ToastProvider` estava dentro de `App.jsx`, como filho de `SocketProvider`. Como a fila offline agora precisa avisar o motorista via toast quando uma ação sincroniza ou falha de vez, e contexto React só flui pra baixo, o `SocketContext` precisava conseguir chamar `useToast()` — então `ToastProvider` subiu pro `main.jsx`, envolvendo o `SocketProvider`. Conferido que os testes existentes não dependiam da posição antiga: eles montam `ToastProvider` diretamente ao redor do componente testado, sem depender de `App.jsx`.

**Novo módulo `frontend/src/services/offlineQueue.js`:** substitui o `socket.emit(action.type, ...)` que emitia no vazio (item O1 da auditoria original) por replay via HTTP contra os mesmos endpoints REST que o app já chama online. `buildRequestConfig` mapeia cada um dos 5 tipos de ação (`accept-ride`, `start-ride`, `update-ride-status`, `end-ride`, `confirm-payment`) pro método/URL/corpo reais. `replayOfflineActions` processa a fila **em ordem cronológica e sequencialmente** (nunca em paralelo — `end-ride` reexecutado antes de `start-ride` confirmar corromperia a máquina de estados do lado do servidor) e classifica a resposta:
- 2xx → remove da fila, sucesso de verdade;
- 409 → remove da fila (o servidor já tem o efeito desejado — essa é exatamente a garantia de idempotência que as Etapas 1 e 2 construíram; sem elas, tratar 409 como sucesso aqui seria arriscado);
- 4xx (400/403/404) → remove da fila e registra em `failedActions` com o motivo — repetir não muda o resultado;
- 5xx / falha de rede → mantém na fila com contador de tentativas, **para o processamento** (preserva a ordem) até a próxima reconexão; depois de 5 tentativas, move pra `failedActions`.

**`frontend/src/services/db.js`:** versão 2 do schema Dexie — `offlineActions` ganhou o campo `attempts`; nova tabela `failedActions` para ações que esgotaram as tentativas (antes, uma ação que falhasse pra sempre simplesmente não deixava rastro nenhum).

**`frontend/src/contexts/SocketContext.jsx`:** `syncOfflineQueue` (disparado em `connect` do socket e no evento `online` da janela, igual antes) agora chama `replayOfflineActions` com callbacks que disparam toast: confirmação de sucesso, aviso de "já confirmado" (409), e erro definitivo com a mensagem do servidor quando disponível.

**Os 5 pontos de enfileiramento** (`CaptainHome.jsx`, `ConfirmRidePopUp.jsx` ×2, `FinishRide.jsx` ×2) migrados de `db.offlineActions.add({...})` direto pra `enqueueOfflineAction({...})`, unificando o formato e garantindo `attempts: 0` desde o início.

**Reconciliação de UI (item 5 do plano original):** decisão consciente de **não bloquear** a navegação otimista offline — um motorista em campo precisa continuar usando o app mesmo sem rede, e travar a tela até um ACK que pode nunca chegar rápido seria pior produto. Em vez disso:
- `CaptainHome.jsx`: 409 no aceite (outro motorista venceu) agora tem tratamento dedicado — fecha o popup com uma mensagem certeira, em vez de cair no catch genérico de "pode já ter sido aceita" (um chute).
- `FinishRide.jsx`: novo estado `pendingSync`. A tela "Pagamento Confirmado!" só comemora de verdade quando a confirmação foi (ou já era) real; no caminho otimista offline, mostra "Pagamento registrado" com ícone de relógio, deixando claro que ainda não foi confirmado com o servidor — sem impedir o motorista de seguir usando o app. A confirmação definitiva (sucesso ou falha) chega depois via toast, de qualquer tela em que o motorista estiver.

**Build/testes:** `vite build` limpo. Suíte do frontend na mesma baseline (`3 falhas \| 4 passes`) — os testes existentes montam `SocketContext.Provider` com um mock direto (não o componente `SocketProvider` real), então não foram afetados pela mudança de `useToast()` dentro dele. Nenhum arquivo do backend tocado nesta etapa.

**Verificação ao vivo — fluxo real ponta a ponta com dois usuários simultâneos e falha de rede real:** passageiro e motorista reais, corrida completa até `started` (aceite, a caminho, chegada, PIN). Com o motorista em `/captain-riding`, bloqueei via `page.route().abort('failed')` especificamente as chamadas de `end-ride` e `confirm-payment` (abort de rede de verdade, não só devtools visual — `context.setOffline()` chegou a ser tentado primeiro, mas trava a requisição em vez de rejeitá-la rápido no Chromium/CDP, então troquei pela abordagem já validada em etapas anteriores desta sessão). Confirmado:
- o motorista consegue finalizar a corrida e confirmar o pagamento mesmo com as chamadas falhando — UI otimista preservada;
- a tela mostra "Pagamento registrado" (pendente), não "Pagamento Confirmado!" prematuro;
- exatamente 2 itens na fila (IndexedDB) enquanto offline;
- ao voltar online (rotas liberadas + evento `online` disparado), a fila sincronizou sozinha e esvaziou;
- **no banco real:** a corrida está `finished`, `paymentStatus: paid`, e existem exatamente 2 transações (`ride_payment: R$182.41`, `commission: R$36.48`) — nem zero (perdidas, o bug original) nem duplicadas.
- Toda a base de teste (2 usuários, 1 corrida, transações, wallet) removida ao final.

**Nada commitado.**

---

## Etapa 4 (P2.1) — detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

**`Backend/services/ride.service.js`:** centralizada a máquina de estados num único mapa, `VALID_ORIGINS_BY_TARGET`, exatamente com as origens por destino que você especificou (aceitar: `requested→accepted`; a caminho: `accepted→going_to_pickup`; cheguei: `[going_to_pickup, accepted]→arrived`; iniciar: `[accepted, going_to_pickup, arrived, waiting_passenger]→started`; finalizar: `started→finished`; cancelar: `[requested, accepted, going_to_pickup, arrived, waiting_passenger]→cancelled`). Um helper único, `transitionRide(rideId, toStatus, extraFilter, extraSet)`, faz o `findOneAndUpdate` atômico com o status de origem no próprio filtro — nunca mais `doc.save()` pra mudar status. Todas as funções que transicionam corrida passaram a usar esse helper: `acceptRideAtomic`, `startRide`, `updateRideStatus`, `endRide`, `cancelRide`. Em cada uma, mantive uma pré-checagem (leitura simples) só pra mensagens de erro precisas (ex.: distinguir "OTP errado" de "corrida no estado errado") — a garantia real de concorrência é sempre o `findOneAndUpdate` atômico depois.

**`updateRideStatus` ganhou uma restrição nova:** só aceita `going_to_pickup`, `arrived` e `waiting_passenger` como destino — os únicos que o app do motorista realmente envia por essa rota genérica. Antes, o endpoint aceitava **qualquer** string do enum de status, inclusive `finished`/`cancelled`, o que permitiria contornar `endRide`/`cancelRide` (e a validação de OTP, cálculo de tarifa e efeitos de carteira que eles fazem) só chamando essa rota genérica diretamente. Não achei nenhum caller real usando essa brecha (busquei no frontend inteiro), mas era uma porta aberta sem necessidade.

**Limpeza incidental:** `endRide` verificava `ride.status !== 'started' && ride.status !== 'ongoing'` — `'ongoing'` nunca existiu no enum do schema (`Backend/models/ride.model.js`), então essa metade da checagem era morta. Removida.

**`Backend/models/ride.model.js`:** novo índice único parcial `{ captain: 1 }` (nome explícito `captain_active_ride_unique`, pra não colidir com o índice de performance pré-existente no mesmo campo) restrito aos status ativos — garante no nível do banco que um motorista nunca tem duas corridas simultâneas, mesmo se algum caminho futuro esquecer de checar isso em código. `acceptRideAtomic` agora captura o erro de chave duplicada (código `11000`) e traduz pra uma mensagem clara (`CAPTAIN_ALREADY_HAS_ACTIVE_RIDE` → 409), em vez de deixar vazar um erro cru do Mongo como 500.

**Antes de criar o índice, verifiquei o Atlas real de produção/dev** por violações pré-existentes (motorista com 2+ corridas ativas simultâneas) — **zero encontradas**, então a criação do índice não teve risco de falhar por dados já inconsistentes. Isso importa porque o `autoIndex` do Mongoose roda em background a cada boot do servidor: se já existisse uma violação, a criação do índice falharia silenciosamente (só um log de erro, sem derrubar o app) e a constraint nunca entraria em vigor. Confirmei depois que o índice foi criado com sucesso no Atlas real (nodemon reiniciou o servidor e sincronizou sozinho).

**`Backend/controllers/ride.controller.js`:** mapeamento de erro pra status HTTP em `startRide`, `updateRideStatus`, `endRide`, `cancelRide` e no aceite — antes, qualquer falha nessas rotas (inclusive as agora esperadas, como tentar iniciar uma corrida cancelada) caía em 500 genérico. Agora: 404 pra "não encontrada", 409 pra "corrida não está mais nesse estado" (o desfecho normal de uma corrida perdida numa condição de corrida), 400 pra entrada inválida do próprio cliente (OTP errado, status desconhecido).

**Achado transversal durante os testes, corrigido por necessidade:** ao chamar `mongoose.model('ride').syncIndexes()` no setup global dos testes (`tests/setup/setup.js`) — necessário pra o índice único parcial existir de fato antes dos testes rodarem, já que `syncIndexes()` é assíncrono e não roda automaticamente no `connect()` — descobri dois problemas de ambiente, ambos consertados:
1. Um índice novo sem nome explícito gerava o mesmo nome automático (`captain_1`) do índice de performance pré-existente no mesmo campo, causando conflito. Resolvido dando nome explícito ao novo.
2. Chamar `syncIndexes()` pra **todos** os models expôs uma declaração de índice duplicada pré-existente em `user.model.js` (`unique:true` no campo `email` + um `schema.index({email:1})` separado — já eram avisados como warning do Mongoose em todo teste desta sessão, mas nunca tinham causado falha real). Escopei a chamada só ao model `ride` — resolve exatamente o que esta etapa precisa, sem tocar num problema pré-existente e não relacionado em `user.model.js`. Deixo registrado aqui como algo que vale corrigir depois, mas não fiz por estar fora do escopo combinado.

**Build/testes:** suíte completa do backend **1 falha \| 77 passes** (baseline de 71 + 6 testes novos, todos passando). A falha é a mesma de sempre (`POST /rides/create` → 500). Novos testes de integração cobrindo: iniciar corrida `requested` (nunca aceita) → 409; cancelar corrida `finished` → 409, sem alterar o status; finalizar corrida ainda não iniciada → 409; `update-status` tentando pular pra `finished` → 400, rejeitado antes de chegar no banco; cancelar + iniciar concorrentes na mesma corrida → exatamente um 200 e um 409, nunca os dois OK; e o índice único rejeitando um motorista tentando aceitar uma segunda corrida ativa.

**Verificação ao vivo contra o servidor de dev real e o Atlas real (3 cenários, todos via requisições HTTP reais, não só Jest):**
1. `/rides/confirm` numa corrida `finished` → 409, corrida continua `finished` (o bug C3 original — "reviver" corrida — confirmado eliminado).
2. Cancelar (passageiro) e iniciar com PIN (motorista) disparados em paralelo de verdade na mesma corrida `arrived` → `[200, 409]`, corrida termina em `started` OU `cancelled`, nunca em ambos nem em nenhum.
3. Motorista com uma corrida `accepted` tentando aceitar uma segunda corrida `requested` → 409 pelo índice único, segunda corrida permanece `requested`.
- Toda a base de teste (2 usuários, 1 motorista, 4 corridas) removida ao final.

**Nada commitado.**

---

## Etapa 5 (P2.2) — detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

**`Backend/services/pricingEngine.service.js`:** `calculateFare` ganhou um parâmetro opcional `configSnapshot`. Quando presente, usa a configuração congelada em vez de consultar `TariffSetting`/`GlobalSetting`/`VehicleCategory`/`PricingRule` no banco de novo; ausente (padrão), comportamento de sempre — consulta a configuração vigente, usado por `getFare` (cotação antes do pedido, onde faz sentido mostrar o preço atual) e para montar o snapshot inicial. Novo método `buildConfigSnapshot({vehicleType})` faz essa consulta uma vez e devolve um objeto plano (`.toObject()`) pronto pra ser guardado na corrida e reutilizado depois.

**`Backend/models/ride.model.js`:** novo campo `pricingSnapshot` (a configuração inteira — tarifa, comissão, regras ativas, categoria — capturada no momento do pedido).

**`Backend/services/ride.service.js`:**
- `createRide` monta o snapshot com `buildConfigSnapshot` **antes** de calcular a tarifa inicial, e passa esse mesmo snapshot pro `calculateFare` que gera o preço mostrado ao passageiro na confirmação — e persiste o snapshot na corrida.
- `endRide` passa `ride.pricingSnapshot` (em vez de nada, que antes significava "busca a config atual") pro recálculo final — só distância e tempo reais variam; tarifa base, taxa por km/minuto, multiplicadores e percentual de comissão continuam exatamente os que o passageiro viu ao pedir.
- **Retrocompatibilidade deliberada:** `configSnapshot: ride.pricingSnapshot || null` — corridas criadas antes desta mudança não têm o campo, e caem de volta pro comportamento antigo (config vigente) em vez de quebrar.

**Decisão que não estava no plano original, sinalizada aqui:** não removi `pricingSnapshot` das respostas da API (`ride.toObject()` continua incluindo o snapshot inteiro — tarifa, comissão, categoria, regras — em toda resposta de corrida, do mesmo jeito que já inclui `fareBreakdown`). Isso deixa o payload de cada resposta um pouco mais pesado (a config de tarifa completa, tipicamente poucos KB). Não é um problema de segurança (configuração de tarifa não é segredo do passageiro/motorista), só uma questão de tamanho de payload — decidi não mexer nisso sem que você pedisse, já que envolveria tocar em vários pontos de serialização da resposta só por uma otimização, não uma correção.

**Build/testes:** suíte completa do backend inalterada em relação à Etapa 4 — **1 falha \| 77 passes**, mesma falha pré-existente de sempre. Os 7 testes unitários de `pricingEngine.service.test.js` (que chamam `calculateFare` diretamente) continuam passando sem alteração — a assinatura nova é aditiva (`configSnapshot` opcional), não quebra nenhum chamador existente.

**Verificação ao vivo — exatamente o cenário que você descreveu ("criar corrida → alterar tarifa e comissão no admin → finalizar → conferir que finalPrice e commissionAmount seguem a tabela antiga"), contra o servidor real e o Atlas real:**
1. Registrei a configuração real vigente (`baseFare=100, perKmRate=15, platformCommission=20%`).
2. Criei uma corrida real via `POST /rides/create` — o snapshot ficou gravado com esses valores.
3. Aceitei e iniciei a corrida via API (motorista real, OTP real).
4. Com a corrida já `started`, alterei a categoria e a comissão global pra valores bem diferentes (`baseFare=150, perKmRate=25, platformCommission=50%`) — simulando o admin mexendo na tarifa no meio da corrida.
5. Finalizei via `POST /rides/end-ride`.

Resultado: **R$195,30 (comissão R$39,06)** — meu cálculo paralelo confirmou que esse é exatamente o valor esperado usando a configuração **antiga** (a do snapshot). Se o freeze não existisse, o valor teria sido **R$295,30 (comissão R$147,65)** — calculei os dois lado a lado pra deixar a diferença inequívoca. A configuração real foi restaurada ao final (bloco `finally` garantido mesmo em caso de falha do teste), e o usuário/motorista/corrida de teste removidos.

**Nada commitado.**

---

## Etapa 6 (P3.1 + P3.2) — detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

### P3.1 — Os três eventos sem ouvinte

**`frontend/src/modules/passenger/pages/Home.jsx`:** novo handler `handleRideStatusUpdated` no efeito de socket já existente, escutando `ride-status-updated`. Atualiza o `ride` local e mostra um toast quando o status vira `going_to_pickup` ou `arrived` — antes o evento chegava e era descartado, e a tela do passageiro ficava congelada no momento do aceite até o próximo evento que ela já escutava.

**`frontend/src/modules/passenger/components/WaitingForDriver.jsx`:** novo componente `statusInfo(status)` + `StatusBadge`, renderizando acima do card do motorista um selo que reflete o status em tempo real (aceito / a caminho / chegou), alimentado pelo estado que `Home.jsx` agora mantém atualizado.

**`frontend/src/modules/passenger/pages/Riding.jsx`:** novo handler `handlePaymentConfirmed` no efeito de socket já existente (o mesmo que já tratava `ride-ended`/`receive-message`), escutando `payment-confirmed`. Mostra um toast avisando que o motorista confirmou o recebimento — fecha o item da auditoria original sobre o passageiro nunca saber se o pagamento foi de fato confirmado do lado do motorista.

**`frontend/src/modules/driver/pages/CaptainHome.jsx`:** novo handler `handleRideTaken`, escutando `ride-taken` (emitido desde a Etapa 2/P1.3 nos dois caminhos de aceite, mas sem ouvinte até agora). Fecha o popup e avisa "Essa corrida já foi aceita por outro motorista" pro motorista que perdeu a corrida — antes ele ficava com o popup aberto indefinidamente, sem saber que a corrida já não existia mais pra ele.

**Achado durante a verificação, não um bug de produto — bug no próprio teste:** o primeiro teste E2E de `ride-taken` (dois motoristas reais, dois `BrowserContext` distintos, ambos recebendo `new-ride`, um aceitando primeiro) deu falso-negativo repetidamente. Hipótese inicial: condição de corrida no join da sala do socket (o mesmo padrão do achado S2 da auditoria original). Investiguei adicionando log de depuração temporário em `sendMessageToRoom` (tamanho da sala no momento do emit) e em `handleRideTaken` (dump do payload recebido) — ambos confirmaram que o evento chegava certo: a sala tinha os 2 sockets esperados, e o segundo motorista recebia `ride-taken` com o `rideId` batendo exatamente com a corrida que tinha no popup. A causa real era do teste: a asserção esperava o painel do popup sumir do DOM (`waitForSelector({state:'detached'})`), mas `RidePopUp` segue o mesmo padrão já estabelecido no app inteiro — painel sempre montado, visibilidade controlada por `transform` animado via GSAP, nunca desmonta. Isso estourava o timeout de 8s esperando por um estado que nunca ia acontecer, e por causa disso o teste só ia checar o toast **depois** do timeout — quando o toast (de duração finita) já tinha sumido sozinho. Corrigido checando o texto do toast logo após a ação (dentro de uma janela curta) e validando o `transform` CSS do painel como confirmação secundária, em vez de esperar desmontagem. Toda a instrumentação de depuração foi removida de `socket.js` e `CaptainHome.jsx` depois — confirmado que ambos os arquivos voltaram ao estado limpo (sem os `console.log('[DEBUG]...')` temporários).

**Verificação ao vivo (2 `BrowserContext` reais, servidor de dev real):** dois motoristas logados simultaneamente, um passageiro pede uma corrida real. Ambos os motoristas recebem `new-ride` e o popup abre nos dois. Motorista A aceita (`POST /rides/:id/accept` real) → 200 pra ele, popup fecha e abre a tela de "corrida confirmada". Motorista B recebe `ride-taken` em menos de 1s, vê o toast "Essa corrida já foi aceita por outro motorista." e o painel volta pra fora da tela (`transform: matrix(1,0,0,1,0,546)`, confirmando visualmente escondido). Também confirmado ao vivo: passageiro em `WaitingForDriver` vendo o selo de status mudar de "Aceito" → "A caminho" → "Chegou" conforme o motorista avança real pelas telas, e o toast de "pagamento confirmado" aparecendo em `Riding.jsx` no momento exato em que o motorista confirma na tela dele.

---

### P3.2 — Bloqueio com efeito imediato

Política de corrida em andamento durante o bloqueio: adotada a opção **(a)** recomendada (deixar terminar normalmente, só impedir novas) — você não pediu uma alternativa quando resinalizei a pergunta antes de começar esta etapa, então segui minha própria recomendação. Nenhuma lógica de corrida ativa foi tocada nesta etapa; o bloqueio afeta apenas cache de perfil, pool de despacho e socket.

**`Backend/services/admin.service.js`:**
- `toggleUserBlock`: agora sempre invalida `profile:user:<id>` no cache (bloqueio e desbloqueio) — antes o cache de 600s continuava servindo o perfil antigo até expirar sozinho, então um usuário bloqueado continuava autenticado por até 10 minutos.
- `toggleCaptainBlock`: reescrito. Ao bloquear, força `isOnline:false` e `status:'inactive'` no mesmo update (tira o motorista do pool de despacho imediatamente, não só na próxima vez que ele abrir o app), invalida `profile:captain:<id>` e `drivers:` (o cache de busca geográfica usado no despacho), e desconecta o socket ativo dele via `disconnectSocket(captain.socketId)` — sem isso, o motorista bloqueado continuaria recebendo `new-ride` em tempo real até fechar o app sozinho.
- `bulkActionUsers`: mesma invalidação de cache por usuário aplicada nos branches de bloqueio/desbloqueio em massa. Decisão sinalizada e não implementada: **não** estendi o disconnect de socket pro fluxo em massa — é um caminho administrativo secundário (usado por poucos admins, em lote, não o fluxo principal de bloqueio individual) e adicionar isso significaria iterar sockets ativos por uma lista potencialmente grande de IDs numa única requisição HTTP; achei desproporcional ao escopo combinado sem confirmar com você primeiro.

**`Backend/socket.js`:** novo export `disconnectSocket(socketId)` — busca o socket pelo ID no registro do `io` e chama `.disconnect(true)` se encontrado.

**Achado repetido durante a verificação — mesmo padrão de bug de teste da Etapa anterior, desta vez em duas frentes ao mesmo tempo:** a primeira versão do script de verificação (`Backend/e2e_p32_verify.js`) chamava `adminService.toggleCaptainBlock(...)` **diretamente via `require()`**, dentro do próprio processo Node do script — não via HTTP contra o servidor real. Isso reproduziu exatamente o mesmo problema de isolamento de processo já visto e documentado nesta sessão: o script tem seu **próprio** `node-cache` (independente do cache do servidor real) e sua **própria** variável `io`, que nunca é inicializada nesse processo (só `initializeSocket()` no `index.js` do servidor real faz isso) — ou seja, `disconnectSocket` virava um no-op silencioso e a invalidação de cache acontecia num cache que ninguém além do próprio script lia. Resultado da primeira rodada: Teste 4 (perfil deveria ser rejeitado imediatamente após bloqueio) voltou 200 em vez de 403, e Teste 7 (socket deveria desconectar) falhou — nenhum dos dois por bug de produto.

Corrigido reescrevendo o script pra usar exclusivamente a API HTTP real: um admin descartável (`AdminUser.create(...)`, senha hasheada automaticamente pelo hook `pre('save')` do model) gera um JWT de verdade via `generateAuthToken()`, e o script chama `PUT /api/admin/captains/:id/block` (rota real, `Backend/routes/admin.routes.js:45` → `Backend/controllers/admin.controller.js:431`) tanto pra bloquear quanto pra desbloquear — agora rodando dentro do processo do **servidor real**, com o cache e o `io` de verdade.

Uma segunda instância do mesmo padrão apareceu no próprio Teste 6 ("não aparece mais no despacho"): o script também chamava `mapService.getCaptainsInTheRadius(...)` diretamente, e o Teste 2 (antes do bloqueio) já tinha aquecido o cache local **deste script** pra essa combinação de coordenadas/raio (TTL de 10s) — cache esse que o bloqueio no servidor real nunca poderia invalidar, porque vive num processo diferente. Corrigido fazendo o Teste 6 repetir a mesma query que `getCaptainsInTheRadius` faz internamente, direto contra o Mongo e sem cache — testando a invariante de elegibilidade de despacho em si, em vez de um detalhe de implementação de cache que não é o que a rota HTTP realmente exercitaria em produção.

**Resultado final da verificação ao vivo, 8 sub-testes, todos via HTTP real contra o servidor de dev real e o Atlas real:**

| # | Teste | Resultado |
|---|---|---|
| 1 | Login do motorista funciona | PASS |
| 2 | Aparece no despacho antes do bloqueio | PASS |
| 3 | Perfil acessível antes do bloqueio | PASS |
| 4 | Perfil rejeitado com 403 **imediatamente** após bloqueio (sem esperar os 10min de cache) | PASS |
| 5 | `isOnline:false` e `status:'inactive'` forçados pelo bloqueio | PASS |
| 6 | Não aparece mais no pool de despacho geográfico | PASS |
| 7 | Socket ativo é desconectado de verdade | PASS |
| 8 | Perfil acessível imediatamente após desbloqueio | PASS |

Todos os dados descartáveis (motorista, admin, entradas de log administrativo) foram removidos ao final pelo próprio `finally` do script, e o script (`Backend/e2e_p32_verify.js`) foi apagado depois de confirmado — era um artefato de verificação, não parte do produto.

**Build/testes:** suíte completa do backend confirmada na mesma baseline de sempre — **1 falha \| 77 passes (78 total)**, a mesma falha pré-existente (`POST /rides/create` → 500, depende de geocoding externo). Nenhuma mudança desta etapa (frontend puro em P3.1, cache/socket/admin em P3.2) alterou esse número.

**Nada commitado.**

---

## Fechamento

As 6 etapas (P1.1, P1.3, P1.2, P2.1, P2.2, P3.1+P3.2) estão implementadas e verificadas — cada uma ao vivo contra o servidor de dev real e o MongoDB Atlas real, não só contra a suíte Jest. Baseline do backend preservada do início ao fim (**1 falha pré-existente \| 77 passes**, a falha é sempre a mesma `POST /rides/create` → 500 por geocoding externo). Baseline do frontend preservada (**3 falhas \| 4 passes**, conforme [[baseline-testes-frontend-quebrado]]). Nenhum commit foi feito em nenhuma etapa, conforme a regra do projeto.
