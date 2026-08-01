# Auditoria de Concorrência, Consistência e Tolerância a Falhas — MoveCity

**Data:** 2026-08-01
**Escopo:** MongoDB ↔ Express ↔ Socket.IO ↔ Frontend Passageiro ↔ Frontend Motorista ↔ Painel Admin
**Modo:** somente leitura. Nenhum código foi alterado.

---

## 0. Sumário executivo

O sistema **não está pronto para produção com múltiplas corridas simultâneas**. Existem 9 problemas 🔴 críticos, dos quais 4 causam perda de dinheiro real ou perda silenciosa de dados.

Os três achados mais graves, em ordem de gravidade:

1. **O endpoint atômico de aceite nunca é usado.** Existe um `acceptRideAtomic` correto (`findOneAndUpdate` com filtro `status:'requested'`) exposto em `POST /rides/:id/accept` — e **nenhum frontend o chama**. O app do motorista usa `POST /rides/confirm`, que faz `findOneAndUpdate({_id})` **sem filtro de status e sem verificar se já existe motorista**. Dois motoristas aceitando a mesma corrida **ambos recebem 200 OK**; o segundo sobrescreve o primeiro. Toda a proteção de concorrência de corridas está escrita, testada e desligada.

2. **A fila offline não envia nada para lugar nenhum.** `SocketContext.jsx` faz `socket.emit(action.type, ...)` com nomes como `'accept-ride'`, `'end-ride'`, `'confirm-payment'` — e o `socket.js` do backend **não tem handler para nenhum desses eventos**. Cada ação enfileirada é emitida no vazio e em seguida **deletada da fila**. O motorista vê "Pagamento Confirmado!", o backend nunca soube, e a evidência é destruída.

3. **`confirmPaymentReceived` não é idempotente e movimenta dinheiro.** É um read-then-write clássico: lê `paymentStatus`, credita carteira, debita comissão, incrementa `earnings`/`totalRides`, e **só então** marca `paid`. Duas chamadas concorrentes (duplo clique, retry de timeout) creditam o motorista duas vezes.

Um agravante transversal: **o middleware de autenticação lê o perfil de um cache de 10 minutos** (`getCaptainProfile`/`getUserProfile`), e o admin **não invalida esse cache ao bloquear**. Bloquear um motorista ou passageiro leva até 10 minutos para ter efeito.

| Severidade | Qtd |
|---|---|
| 🔴 Crítico | 9 |
| 🟡 Precisa melhorar | 12 |
| 🟢 Seguro / adequado | 6 |

---

## 1. Concorrência de corridas

### 1.1 🔴 C1 — Dupla atribuição: o caminho de aceite usado em produção não tem trava

**Causa.** `ride.service.js:219-243` (`confirmRide`):

```js
await rideModel.findOneAndUpdate({ _id: rideId }, {
    status: 'accepted',
    captain: captain._id
})
```

Sem `status: 'requested'` no filtro. Sem `captain: null`. Sem checar o retorno. Exposto em `POST /rides/confirm` com `authCaptain` (`ride.routes.js:34-38`), e é **exatamente o endpoint que `CaptainHome.jsx:160` chama**.

O irmão correto existe (`acceptRideAtomic`, `ride.service.js:186-217`), com filtro atômico e erro `RIDE_ALREADY_ACCEPTED` mapeado para HTTP 409 — e **nenhum arquivo do frontend chama `/rides/:id/accept`** (verificado por busca em `frontend/src`).

**Impacto.** Dois (ou vinte) motoristas aceitam a mesma corrida. Todos recebem 200 OK e navegam para a tela de corrida aceita. O banco guarda o último. O passageiro recebe N eventos `ride-confirmed` e vê o nome/placa mudando sozinho. Os motoristas perdedores ficam presos numa corrida que não é deles — e podem chamar `start-ride`, que só valida o OTP, não a posse.

**Risco em produção.** Altíssimo. `createRide` faz broadcast simultâneo para até 20 motoristas (`ride.controller.js:69-79`). A janela de corrida não é de milissegundos: é o tempo humano entre dois motoristas tocarem "Aceitar".

**Cenário.** Corrida em região com ≥2 motoristas online da mesma categoria.

**Como reproduzir.** Dois motoristas logados, ambos recebem o popup, ambos tocam "Aceitar" com poucos segundos de diferença. Ambos avançam para a tela de PIN. `db.rides.findOne({_id})` mostra apenas o segundo.

**Como corrigir.**
1. Trocar a chamada do frontend para `POST /rides/:id/accept` (o atômico já pronto) e tratar 409 com "Corrida já aceita por outro motorista".
2. Remover ou blindar `POST /rides/confirm` — se mantido, aplicar o mesmo filtro `{_id, status:'requested'}` e retornar 409 quando `null`.
3. Adicionar ao filtro atômico a garantia de que o motorista não tem outra corrida ativa (ver C2).

---

### 1.2 🔴 C2 — Um motorista pode estar em duas corridas ao mesmo tempo

**Causa.** Nem `confirmRide` nem `acceptRideAtomic` verificam se o motorista já possui corrida em andamento. Não existe índice ou constraint impedindo dois documentos `ride` com o mesmo `captain` em status ativo.

**Impacto.** Motorista aceita a corrida A, e enquanto se desloca aceita a corrida B. Os dois passageiros veem o mesmo carro na mesma posição. `update-location-captain` (`socket.js:62-65`) faz `findOne` das corridas ativas do motorista — **retorna só a primeira**, então uma das duas corridas para de acumular `actualDistance` e de receber posição.

**Risco em produção.** Alto, e piora com incentivos (motorista aceitando tudo).

**Cenário.** Motorista aceita A; popup de B chega antes de iniciar A; aceita B.

**Como reproduzir.** Criar duas corridas em sequência com um único motorista online; aceitar as duas. Ambas ficam `accepted` com o mesmo `captain`.

**Como corrigir.** No `findOneAndUpdate` de aceite, condicionar à ausência de corrida ativa do motorista (transação ou pré-checagem atômica com `countDocuments` dentro de uma sessão), e criar índice parcial único:
`{ captain: 1 }` unique com `partialFilterExpression: { status: { $in: [...ativos] } }`.

---

### 1.3 🔴 C3 — Aceitar × cancelar: os dois vencem e a corrida fica em estado impossível

**Causa.** `cancelRide` (`ride.service.js:519-557`) é read-then-write: `findOne` → checa status → `ride.status='cancelled'` → `ride.save()`. `startRide` (`245-291`) idem. `confirmRide` sobrescreve incondicionalmente. Nenhum usa update condicional.

**Ordens possíveis e resultado real:**

| Ordem | Resultado |
|---|---|
| Passageiro cancela → motorista aceita | `confirmRide` **reverte** a corrida cancelada para `accepted`. Corrida "morta" volta à vida com motorista a caminho de um passageiro que já desistiu. |
| Motorista aceita → passageiro cancela | Correto (cancelamento permitido em `accepted`), com taxa aplicada. 🟢 |
| Simultâneo (intercalado) | `cancelRide` leu `requested` (permite) e `confirmRide` grava `accepted`; o `save()` do cancel grava `cancelled` depois. Passageiro recebeu `ride-confirmed`, motorista está a caminho, banco diz `cancelled`. Nenhum dos dois lados é avisado da divergência. |

**Impacto.** Motorista se desloca para uma corrida cancelada (sem remuneração, sem taxa de cancelamento registrada corretamente); ou passageiro cancela e mesmo assim um motorista aparece.

**Risco em produção.** Alto — cancelamento durante a busca é altíssimo em app de mobilidade.

**Como reproduzir.** Disparar `POST /rides/cancel` e `POST /rides/confirm` da mesma corrida em paralelo (dois terminais). Repetir ~20×; o estado final alterna.

**Como corrigir.** Todas as transições de status devem ser `findOneAndUpdate` com o(s) status de origem esperado(s) no filtro, retornando 409 quando não casar. Nunca `doc.save()` para máquina de estados.

---

### 1.4 🔴 C4 — Iniciar × cancelar: corrida iniciada e cancelada ao mesmo tempo

**Causa.** `startRide` valida `['accepted','going_to_pickup','arrived'].includes(ride.status)` **em memória** e depois grava. `cancelRide` bloqueia `started` **em memória** e depois grava.

**Impacto.** Ambos passam a validação lendo `arrived`. `startRide` grava `started` e emite `ride-started` (passageiro navega para `/riding`). `cancelRide` grava `cancelled` depois. Passageiro está na tela de corrida em andamento; o banco diz cancelada; `endRide` vai recusar (`Ride not started`) e o motorista **não consegue finalizar nem receber**.

**Risco em produção.** Médio-alto. Janela é o tempo entre o motorista digitar o PIN e o passageiro tocar em cancelar.

**Como corrigir.** Idem C3 — `findOneAndUpdate` condicional em ambos.

---

### 1.5 🔴 C5 — `confirmPaymentReceived` não é idempotente (dinheiro duplicado)

**Causa.** `ride.service.js:386-468`:

```js
if (ride.paymentStatus === 'paid') throw new Error('Payment already confirmed');
// ... createTransaction(ride_payment) ...
// ... createTransaction(commission) ...
await rideModel.findOneAndUpdate({_id: rideId}, { paymentStatus: 'paid' });
await captainModel.findByIdAndUpdate(captain._id, { $inc: { totalRides: 1, earnings: finalFare }});
await userModel.findByIdAndUpdate(ride.user._id, { $inc: { totalRides: 1, totalSpent: finalFare, ... }});
```

A guarda e a escrita estão separadas por 4 operações de I/O. Não há transação.

**Impacto.** Duas chamadas concorrentes → duas transações `ride_payment`, duas `commission`, `earnings` e `totalRides` dobrados, `totalSpent` do passageiro dobrado. O extrato do motorista fica com lançamentos duplicados e `balanceBefore/balanceAfter` incoerentes.

**Risco em produção.** **Crítico — é dinheiro.** Não precisa de dois usuários: duplo clique, retry automático do axios, ou o botão "Pagamento Recebido" (`FinishRide.jsx:189`) tocado duas vezes em rede lenta já bastam, porque o `disabled` só cobre `isPending` da mutação local.

**Como reproduzir.** `for i in 1 2; do curl -X POST .../rides/confirm-payment -d '{"rideId":"..."}' & done`. Conferir `db.transactions.find({rideId})` — dois pares.

**Como corrigir.**
1. Tornar a marcação a **primeira** operação e condicional:
   `findOneAndUpdate({_id, status:'finished', paymentStatus:{$ne:'paid'}}, {$set:{paymentStatus:'paid'}})` → se `null`, retornar 409 e não movimentar nada.
2. Índice único em `transaction` por `(rideId, type)` como rede de segurança.
3. Envolver os lançamentos financeiros numa transação Mongo (replica set) ou usar chave de idempotência vinda do cliente.

---

### 1.6 🔴 C6 — Débito de carteira do passageiro com read-modify-write

**Causa.** `createRide` (`ride.service.js:130-142`):

```js
const userData = await userModel.findById(user);
...
userData.walletBalance -= walletAmountUsed;
await userData.save();
```

**Impacto.** Duas solicitações de corrida simultâneas do mesmo passageiro (duas abas, duplo toque em "Confirmar Corrida") leem o mesmo saldo e debitam cada uma o valor cheio a partir do mesmo ponto de partida → **saldo pode ficar negativo ou uma das corridas viaja de graça**.

**Risco em produção.** Alto — o botão "Confirmar Corrida" não tem trava de duplo clique.

**Como corrigir.** `findOneAndUpdate({_id, walletBalance: {$gte: valor}}, {$inc: {walletBalance: -valor}}, {new:true})` e tratar `null` como saldo insuficiente.

---

### 1.7 🟡 C7 — Nenhum motorista perdedor é avisado

`acceptRide` emite `ride-taken` para a sala `ride_${rideId}` (`ride.controller.js:164-167`), mas **nenhum frontend escuta `ride-taken`** (verificado na matriz de eventos). Além disso, `confirmRide` — o caminho realmente usado — **nem emite** esse evento. O popup do motorista perdedor fica na tela até ele tocar em algo.

**Correção.** Emitir `ride-taken` no caminho de aceite real e adicionar listener em `CaptainHome.jsx` que fecha o popup se `rideRef.current._id === data.rideId`.

---

### 1.8 🟡 C8 — Finalização simultânea com passageiro ausente

`endRide` também é read-then-write (`status !== 'started'` em memória). Duas chamadas → dois recálculos de tarifa e duas gravações de `finished`. Não move dinheiro (isso é o `confirm-payment`), então o dano é limitado a `actualTime`/`finalPrice` recalculados duas vezes com resultados diferentes.

Se o passageiro fecha o app antes do motorista finalizar: o `ride-ended` vai para um `socketId` morto e **não há reenvio**. Ao reabrir, `getCurrentRide` **não retorna corridas `finished`** — o passageiro nunca mais vê a tela de pagamento/avaliação daquela corrida.

---

## 2. Estado do motorista

### 2.1 🔴 E1 — Motorista offline no meio da corrida: ninguém é avisado

**Causa.** `socket.js:166-185` — no `disconnect`, o motorista vira `isOnline:false`, `status:'inactive'`, `socketId:null`, e a sessão online é encerrada. **A corrida ativa não é consultada nem tocada.**

**Comportamento observado por etapa:**

| Momento da queda | Corrida continua? | Outro motorista recebe? | Passageiro é informado? | Banco consistente? |
|---|---|---|---|---|
| Recebendo (popup aberto) | — | Não há re-dispatch | — | 🟢 |
| Após aceitar | Sim, presa em `accepted` | ❌ Não | ❌ Não | ⚠️ corrida ativa com motorista offline |
| Deslocamento | Sim | ❌ | ❌ mapa congela sem aviso | ⚠️ |
| Em viagem (`started`) | Sim | ❌ | ❌ | ⚠️ `actualDistance` para de somar → **tarifa final menor que a real** |
| Pagamento | Sim | ❌ | ❌ | ⚠️ `paymentStatus:'pending'` para sempre |

**Impacto.** Corrida órfã sem timeout, sem reatribuição e sem qualquer notificação. O passageiro fica olhando um carro parado no mapa.

**Correção.** No `disconnect`, buscar corrida ativa do motorista; se existir, emitir `driver-connection-lost` para o passageiro e iniciar um timer de graça (ex.: 60–90 s) que, ao expirar, marca a corrida para reatribuição ou cancelamento automático com registro de motivo.

### 2.2 🟡 E2 — Ciclo Online → Offline → Online rápido

`toggleOnline` (`captain.controller.js:170-174`) protege contra sessão dupla comparando `req.captain.isOnline` — **mas `req.captain` vem do cache de 10 min** (`getCaptainProfile`). O `toggleOnline` invalida o cache no fim (linha 178), então na prática a leitura seguinte é fresca. Porém o `disconnect` do socket também altera `isOnline` e invalida o cache — se o toggle HTTP e o disconnect ocorrerem juntos, `startOnlineSession`/`endOnlineSession` podem intercalar e `onlineSince` fica nulo com `isOnline:true` (tempo online do dia deixa de contar) ou não-nulo com `isOnline:false` (contagem inflada na próxima sessão).

**Correção.** Tornar a troca de estado atômica: `findOneAndUpdate({_id, isOnline: !novo}, {...})` e derivar a sessão do retorno.

### 2.3 🔴 E3 — Múltiplas abas derrubam o canal do usuário

**Causa.** `socketId` é um campo escalar único por usuário (`socket.js:32-36`) e o `disconnect` limpa por `socketId` (`168-172`).

**Cenário.** Aba A conecta (`socketId=A`). Aba B conecta (`socketId=B`, sobrescreve). Usuário fecha a aba B → `findOneAndUpdate({socketId:B}, {socketId:null})` → **o usuário fica sem `socketId` mesmo com a aba A aberta e conectada**. A partir daí `ride-confirmed`, `ride-started` e `ride-ended` são emitidos para `null` e se perdem silenciosamente.

Para motorista é pior: fechar a segunda aba dispara `isOnline:false` + `endOnlineSession`, **tirando do ar um motorista que continua com o app aberto**.

**Como reproduzir.** Abrir `/home` em duas abas, fechar a segunda, pedir corrida na primeira e aceitar pelo motorista. O `ride-confirmed` não chega.

**Correção.** Migrar de `socketId` escalar para um array/coleção de sessões (`socketIds: [String]`) com `$addToSet`/`$pull`, e derivar `isOnline` de "existe ao menos uma sessão".

---

## 3. Socket.IO

### 3.1 🔴 S1 — `join` sem autenticação: qualquer cliente vira qualquer usuário

**Causa.** `socket.js:27-40` confia cegamente no `userId` do payload. Não há token no handshake (`SocketContext.jsx:10-12` cria o socket sem `auth`). O mesmo vale para `update-location-captain` (`43-59`), que grava a localização de qualquer `userId` informado.

**Impacto.** Sequestro de canal: um cliente qualquer emite `join` com o `_id` de outra pessoa e passa a **receber os eventos de corrida dela (incluindo o OTP em `ride-confirmed`)**, além de roubar o `socketId` da vítima, que deixa de receber os próprios eventos. Também permite falsificar a posição GPS de qualquer motorista.

**Risco em produção.** Crítico — é uma falha de autorização com efeito colateral de consistência.

**Correção.** Passar o JWT no handshake (`io(url, { auth: { token } })`), validar em `io.use()` e derivar `userId`/`userType` do token, ignorando o payload do cliente.

### 3.2 🟡 S2 — Salas de corrida se perdem em qualquer reconexão

`addSocketToRoom(captain.socketId, 'ride_'+id)` (`ride.controller.js:71`) usa o adapter em memória. Reconexão do motorista, refresh ou restart do backend → sai da sala e **nunca reentra** (nenhum código faz rejoin). `ride-cancelled` (`ride.controller.js:419`) e `ride-taken` deixam de chegar. O motorista continua indo buscar um passageiro que cancelou.

**Correção.** Reentrar nas salas dentro do handler `join` (consultando as corridas ativas do usuário) em vez de só no momento da criação da corrida.

### 3.3 🟡 S3 — `transports: ['polling']` no cliente

`SocketContext.jsx:11` força long-polling, embora o servidor aceite websocket (`socket.js:16`). Cada motorista mantém um ciclo de requisições HTTP; com `update-location-captain` a cada 5–10 s, o custo por conexão é várias vezes maior que WebSocket. É um teto artificial de escalabilidade.

### 3.4 🟡 S4 — Listeners globais sem cleanup no `SocketContext`

`socket.on('connect')` e `socket.on('disconnect')` são registrados em um `useEffect([])` cujo cleanup remove **apenas** o listener de `window`. Em remontagem (StrictMode, hot reload, re-render do provider) os handlers acumulam e `syncOfflineQueue` roda N vezes em paralelo.

**Nota:** os listeners de *domínio* (`Home.jsx`, `CaptainHome.jsx`, `Riding.jsx`, `CaptainRiding.jsx`) **têm cleanup correto** com `socket.off` das mesmas referências — 🟢 nesse ponto.

### 3.5 🟢 S5 — Um handler por evento nas telas de domínio

Verificado: cada `socket.on` nas páginas tem `socket.off` correspondente com a mesma referência de função no cleanup, e as dependências dos efeitos são estáveis (`[user]`, `[captain, socket]`, `[captain?._id, rideData?._id]`). Não há duplicação de handlers de corrida.

---

## 4. Refresh da página

### 4.1 🔴 R1 — Passageiro perde tudo ao atualizar durante a corrida

**Causa dupla:**

1. `Home.jsx:205-215` reconstrói o estado para `requested` e para `accepted/going_to_pickup/arrived/waiting_passenger` — **mas não trata `started`**. Refresh com a corrida em andamento deixa o passageiro na tela inicial ociosa.
2. `Riding.jsx:14` lê a corrida de `useLocation().state`. Refresh em `/riding` → `location.state` é `null` → `ride` fica `undefined`. A tela renderiza vazia, `LiveTracking` sem corrida, e o handler de `ride-ended` lê `ride?.paymentMethod` de `undefined`. **Não há nenhuma consulta ao backend para reconstruir.**

**Impacto.** O passageiro perde a tela da corrida ativa, o valor, o chat e o fluxo de pagamento/avaliação. Só volta ao normal quando a corrida acaba — e mesmo aí `getCurrentRide` não retorna `finished`, então o pagamento fica órfão.

**Como reproduzir.** Corrida iniciada → F5 em `/riding`.

**Correção.** `Riding.jsx` deve buscar `GET /rides/current` no mount quando `location.state` estiver vazio; e `Home.jsx` deve tratar `started` navegando para `/riding`. `getCurrentRide` precisa também devolver corridas `finished` com `paymentStatus !== 'paid'`.

### 4.2 🔴 R2 — Motorista perde a corrida ao atualizar (e o GPS para)

`CaptainRiding.jsx:22` — `rideData = location.state?.ride`. Refresh → `undefined`. O efeito de GPS tem guarda `if (!captain?._id || !rideData) return` (linha 49), então **o envio de localização para de acontecer de vez**.

**Impacto financeiro direto:** `actualDistance` deixa de acumular no backend (`socket.js:70-91`), e `endRide` recalcula a tarifa final justamente por `actualDistance` (`ride.service.js:349-357`). **Um refresh do motorista no meio da viagem reduz o valor final cobrado.** Além disso o mapa do passageiro congela.

Não existe endpoint de recuperação para o motorista — não há `/captains/current-ride` (verificado nas rotas).

**Correção.** Criar `GET /rides/current` equivalente para motorista (por `captain` + status ativo) e usá-lo como fallback em `CaptainRiding` e `CaptainHome`.

### 4.3 🟡 R3 — Popup de nova corrida não sobrevive ao refresh

`CaptainHome` só popula `ride` via evento `new-ride`. Refresh durante o popup → a solicitação some da tela do motorista, embora a corrida continue `requested` no banco e ele continue elegível.

---

## 5. Reinício do backend

### 5.1 🔴 B1 — Sem rotina de recuperação; todo mundo fica com socket morto

**Causa.** `server.js` só faz `initializeSocket(server)` e `listen`. Existe um `Backend/clear_stale_sockets.js` que zera `socketId` — **mas é um script avulso, não é chamado no boot** (verificado em `server.js`, `app.js` e `db/db.js`).

**Estado logo após um restart:**

| Item | Estado |
|---|---|
| `socketId` de todos | apontando para sockets mortos |
| `isOnline` dos motoristas | `true` (nunca houve `disconnect`) |
| Salas `ride_*` | vazias (adapter em memória) |
| Corridas ativas | continuam `accepted`/`started` |

Enquanto o cliente não reconecta e reemite `join`, todo `sendMessageToSocketId` cai no vazio. Pior: `getCaptainsInTheRadius` filtra por `socketId != null` e `isOnline: true` — os registros ainda satisfazem isso, então **novas corridas são despachadas para sockets mortos** e ninguém recebe.

**Mitigação parcial existente.** Passageiro e motorista reemitem `join` no evento `connect` (`Home.jsx:226-238`, `CaptainHome.jsx:57-67`, `CaptainRiding.jsx:51-59`), e o passageiro ainda chama `fetchCurrentRide()`. Isso reconstrói o `socketId` — mas **não a sala da corrida** (S2) e **não o estado do motorista** (R2).

**Correção.** Chamar a limpeza de sockets órfãos no boot (`socketId:null`, `isOnline:false` para todos), e reconstruir as salas dentro do handler `join`.

---

## 6. GPS

`socket.js:43-114` e `LiveTracking.jsx:131`.

| Cenário | Comportamento | Nota |
|---|---|---|
| GPS atrasado | Aceito como se fosse atual | 🟡 |
| Fora de ordem | **Aceito e somado à distância** — não há timestamp nem verificação de sequência | 🔴 D1 |
| Duplicado | Salto < 5 m é descartado pelo filtro (`distMeters > 5`) | 🟢 |
| Perdido | Distância simplesmente não soma; sem interpolação | 🟡 |
| Precisão ruim | Nenhum uso de `accuracy` do `Geolocation` — pontos ruins entram | 🟡 |
| Salto grande | Descartado acima de 2 000 m | 🟢 |

### 6.1 🔴 D1 — `actualDistance` sofre lost update e aceita eventos fora de ordem

**Causa.**

```js
let currentDistance = ride.actualDistance || 0;      // leitura
...
currentDistance += distMeters;
await rideModel.findByIdAndUpdate(ride._id, { actualDistance: currentDistance, ... });  // escrita absoluta
```

Duas atualizações de GPS concorrentes (o app envia a cada 5 s, e a fila offline pode despejar um lote de uma vez) leem o mesmo `actualDistance` e gravam valores absolutos — **a última sobrescreve a outra**. E como não há timestamp, um pacote antigo que chega depois soma distância como se fosse deslocamento novo.

**Impacto.** `actualDistance` é a base do `finalPrice` recalculado em `endRide`. Erro aqui é erro de cobrança nos dois sentidos.

**Correção.** Usar `$inc: { actualDistance: distMeters }` com filtro de status, incluir `timestamp` no payload e descartar pacotes mais antigos que `lastLocation.at`. Usar `accuracy` para descartar pontos ruins.

### 6.2 🟡 D2 — A fila offline de GPS descarta o trajeto inteiro

`SocketContext.jsx:37-46`: pega **apenas a última** posição do buffer (`locations[locations.length - 1]`) e limpa a tabela. Todo o trajeto percorrido offline vira um único ponto — e como o salto resultante provavelmente excede 2 000 m, o filtro o **descarta por completo**. Motorista que fica 10 minutos sem sinal tem esse trecho zerado na distância cobrada.

---

## 7. Eventos fora de ordem

| Cenário | Comportamento atual |
|---|---|
| `ride-started` antes de `ride-confirmed` | `Home.jsx:259` navega para `/riding` com o payload recebido. Funciona por acaso (o payload de `ride-started` é completo). O `ride-confirmed` tardio cai no vazio (Home desmontado). 🟡 |
| `ride-ended` antes de `ride-started` | Passageiro ainda está em `Home`, que **não escuta `ride-ended`** (só `Riding.jsx` escuta). O evento se perde e a tela de pagamento nunca aparece. 🔴 (mesma raiz de C8/R1) |
| `ride-status-updated` | **Nenhum frontend escuta.** Ver F1 abaixo. |

### 7.1 🔴 F1 — Três eventos do backend não têm ouvinte em lugar nenhum

Matriz construída comparando `event: '...'` no backend com `socket.on('...')` no frontend:

| Evento emitido | Ouvinte | Consequência |
|---|---|---|
| `ride-status-updated` | ❌ nenhum | O passageiro **nunca vê** "motorista a caminho" / "motorista chegou" em tempo real. A tela `WaitingForDriver` mostra dados congelados do momento do aceite. |
| `payment-confirmed` | ❌ nenhum | Passageiro nunca sabe que o motorista confirmou o recebimento. |
| `ride-taken` | ❌ nenhum | Motoristas perdedores não são avisados (C7). |

**Impacto.** O principal feedback de progresso da corrida — que é o coração da experiência de mobilidade — não existe do lado do passageiro. Isso não é apenas UX: é divergência de estado entre backend e frontend por ausência de canal.

**Correção.** Adicionar os três listeners e derivar o texto de status a partir do `ride.status` recebido.

---

## 8. Idempotência

| Operação | Idempotente? | Análise |
|---|---|---|
| `acceptRide` (`/:id/accept`) | 🟢 Sim | Filtro atômico por `status:'requested'`; 2ª chamada → 409. **Mas não é usada.** |
| `confirmRide` (`/confirm`) | 🔴 Não | Sobrescreve sempre. Rebaixa `finished`/`cancelled` de volta para `accepted`. |
| `startRide` | 🔴 Não | Read-then-write; recalcula `waitTimeFeeCharged` a cada chamada, sobrescrevendo o valor anterior. |
| `endRide` | 🟡 Parcial | Guarda `status !== 'started'` protege a 2ª chamada **sequencial**, mas não a concorrente. |
| `cancelRide` | 🟡 Parcial | Guarda em memória; mesma falha sob concorrência. |
| `payRide` | 🟡 | Gera novo `paymentID`/`orderId`/`signature` a cada chamada, sobrescrevendo os anteriores. Não movimenta dinheiro, mas destrói a trilha de auditoria. |
| `confirmPayment` | 🔴 **Não** | **Duplica dinheiro.** Ver C5. |
| `toggleOnline` | 🟡 | Ver E2. |
| `walletRecharge` | 🟢 | Desativado por design (HTTP 501, `captain.controller.js:137-145`). |
| `submitReview` | 🟡 | `findOne` → `create` sem transação e **sem índice único** em `review` (`review.model.js` não tem `index`). Dois envios concorrentes criam duas avaliações e a nota do motorista é recalculada com peso duplo. |

---

## 9. Painel Administrativo durante corrida ativa

### 9.1 🔴 A1 — Bloqueio de usuário/motorista demora até 10 minutos

**Causa.** `authUser`/`authCaptain` (`auth.middleware.js:27,64`) resolvem o perfil via `getUserProfile`/`getCaptainProfile`, que **cacheiam o documento por 600 s** (`user.service.js:34`, `captain.service.js:59`). `toggleUserBlock` (`admin.service.js:315-318`) e `toggleCaptainBlock` (`472-473`) fazem `findByIdAndUpdate` e **não invalidam `profile:user:*` / `profile:captain:*`**.

**Impacto.** Um motorista bloqueado por fraude ou incidente de segurança continua aceitando e realizando corridas por até 10 minutos. Nenhum socket é derrubado, `isOnline` não é alterado e a corrida em andamento não é interrompida.

**Como reproduzir.** Autenticar como motorista, bloquear pelo admin, repetir a chamada autenticada — continua 200 OK.

**Correção.** Invalidar `profile:captain:${id}` / `profile:user:${id}` no bloqueio; forçar `isOnline:false` + desconectar o socket; e decidir explicitamente o destino da corrida em andamento.

### 9.2 🔴 A2 — Mudança de tarifa/comissão altera o preço de corrida já em andamento

**Causa.** `endRide` (`ride.service.js:349-363`) chama `PricingEngine.calculateFare` **no momento da finalização**, lendo a configuração vigente naquele instante — e sobrescreve `fareBreakdown` e `commissionAmount`.

**Impacto.** O passageiro aceitou R$ 24,50 na confirmação; o admin ajusta a tarifa durante a viagem; ao finalizar, o valor cobrado é outro. O motorista tem a comissão recalculada com um percentual que não era o vigente quando aceitou. Não há snapshot de tarifa por corrida.

**Regra correta.**

| Mudança do admin | Deve afetar |
|---|---|
| Tarifa base / por km / por minuto | Apenas **novas** corridas |
| Percentual de comissão | Apenas **novas** corridas |
| Taxa de cancelamento / espera | Apenas **novas** corridas |
| Desativar categoria de veículo | Apenas **novas** corridas |
| Bloquear motorista/passageiro | **Imediato** (inclusive encerrando a corrida com regra definida) |

**Correção.** Persistir na corrida, no momento da criação, o snapshot dos parâmetros de precificação (já existe `fareBreakdown`) e usá-lo no `endRide`, variando apenas distância/tempo reais.

### 9.3 🟡 A3 — Desativar categoria com corridas em voo

`getFare` filtra `isActive:true`. Se a categoria for desativada entre a criação e o `endRide`, o recálculo pode lançar exceção — que é **engolida** pelo `try/catch` (`ride.service.js:364-366`) e a corrida mantém `ride.fare`. Falha silenciosa, mas sem prejuízo grave. Resolvido junto com A2.

---

## 10. Consistência do banco

| Cenário | Possível hoje? | Origem |
|---|---|---|
| Corridas órfãs (`requested` para sempre) | 🔴 Sim | Expiração só ocorre se o **passageiro** chamar `GET /rides/current` (`ride.service.js:507-513`). Se ele fechar o app, a corrida fica `requested` indefinidamente. Não há job. |
| Motorista em duas corridas | 🔴 Sim | C2 |
| Passageiro em duas corridas | 🔴 Sim | `createRide` não verifica corrida ativa do passageiro. Duas abas → duas corridas `requested` simultâneas; `getCurrentRide` mostra só uma, a outra fica órfã. |
| Carteira inconsistente | 🔴 Sim | C5 + `createTransaction` read-modify-write (`wallet.service.js:18-62`) |
| `payment` sem `ride` | 🟢 Não | Sempre criado com `rideId` |
| `ride` sem `payment` | 🟡 Sim | `createRide` só cria `payment` se `paymentAmount > 0 \|\| walletAmountUsed > 0` |
| `review` sem `ride` | 🟢 Não | Validado |
| `review` duplicada | 🟡 Sim | Sem índice único |
| Corrida `finished` sem motorista | 🟡 Sim | `confirmRide` pode gravar `captain` e depois outro fluxo alterar; sem constraint |
| Corrida `started` sem OTP validado | 🟡 Sim | `startRide` valida OTP, mas `confirmRide` pode rebaixar o status depois e permitir novo `start` |
| Motorista `isOnline` sem socket | 🔴 Sim | B1 (restart) e E3 (múltiplas abas) |
| Socket sem motorista | 🟡 Sim | `join` não valida existência do `userId` (S1) |

### 10.1 🔴 G1 — Não existe expiração ativa de corridas

A única expiração é passiva (dentro de `getCurrentRide`). Sem um job periódico, corridas `requested` abandonadas se acumulam e continuam sendo consideradas "ativas" pelo `getCurrentRide` do passageiro, impedindo-o de pedir outra até que ele mesmo abra o app e dispare a limpeza.

Existe um `tariffScheduler.service.js` no projeto — ou seja, **já há infraestrutura de agendamento** que poderia hospedar essa rotina.

---

## 11. Onde faltam transações / locks

| Local | Mecanismo recomendado |
|---|---|
| Aceite de corrida | **Compare-and-set** — `findOneAndUpdate({_id, status:'requested', captain:null})`. Já implementado em `acceptRideAtomic`; basta usá-lo. |
| Transições de status (`start`, `end`, `cancel`, `update-status`) | **Compare-and-set** com status de origem no filtro |
| `confirmPaymentReceived` | **Transação Mongo** (ledger + carteira + contadores) + marcação de `paid` como primeira operação |
| Débito de carteira do passageiro | **Atomic update** `$inc` com guarda `$gte` |
| `createTransaction` (carteira do motorista) | **Atomic update** `$inc` nos campos de saldo, em vez de `wallet.save()` |
| `actualDistance` | **Atomic update** `$inc` + versionamento por timestamp |
| Unicidade motorista/corrida | **Índice parcial único** |
| `review` | **Índice único** `(ride, user, type)` |
| Sessão online do motorista | **Compare-and-set** em `isOnline` |

O Mongoose já expõe `__v`; **nenhum fluxo usa optimistic locking** hoje.

---

## 12. Recuperação automática

| Situação | Recuperação | Status |
|---|---|---|
| Queda de internet (passageiro) | `connect` → `join` + `fetchCurrentRide` | 🟡 não cobre `started` |
| Queda de internet (motorista) | `connect` → `join` | 🔴 não recupera corrida nem sala |
| Refresh | Ver seção 4 | 🔴 |
| Fechamento do navegador | `disconnect` limpa socket | 🟡 sem tratamento da corrida ativa |
| Troca de aba | Sem impacto | 🟢 |
| Hibernação do celular | `useWakeLock` mitiga durante corrida | 🟢 |
| Retorno ao app | Depende do `connect` do socket | 🟡 |
| Reconexão Socket.IO | `join` reemitido; salas não | 🔴 |
| Ações offline | **Emitidas para handlers inexistentes e apagadas** | 🔴 O1 |

### 12.1 🔴 O1 — A fila offline destrói as ações em vez de executá-las

**Causa.** `SocketContext.jsx:31-34`:

```js
for (const action of actions) {
    socket.emit(action.type, action.payload);   // 'accept-ride' | 'start-ride' | 'end-ride' | 'confirm-payment' | 'update-ride-status'
    await db.offlineActions.delete(action.id);  // apaga incondicionalmente
}
```

O backend (`socket.js`) registra handlers **apenas** para: `join`, `update-location-captain`, `join-chat`, `leave-chat`, `send-message`, `message-delivered`, `message-read`, `typing-start`, `typing-stop`, `disconnect`. Nenhum dos tipos enfileirados existe.

**Impacto por ação perdida:**

| Ação enfileirada | UI otimista mostrada | Realidade no backend |
|---|---|---|
| `accept-ride` (`CaptainHome.jsx:177`) | "Corrida aceita", vai para tela de PIN | Corrida continua `requested`, outro motorista pode pegar |
| `update-ride-status` (`ConfirmRidePopUp.jsx:30`) | Status avança | Nada muda |
| `start-ride` (`ConfirmRidePopUp.jsx:71`) | Navega para `/captain-riding` | Corrida nunca inicia |
| `end-ride` (`FinishRide.jsx:38`) | "Corrida finalizada" | Corrida presa em `started` |
| `confirm-payment` (`FinishRide.jsx:76`) | "Pagamento Confirmado!" + redireciona | **Motorista nunca é creditado; comissão nunca cobrada** |

**Risco em produção.** Crítico. É o pior tipo de falha: silenciosa, confirmada ao usuário, com destruição da evidência. Um motorista pode completar uma corrida inteira em túnel/área sem sinal e terminar sem receber, sem nenhum rastro no servidor.

**Como reproduzir.** DevTools → Network Offline → finalizar corrida e confirmar pagamento → voltar online. Conferir `db.rides.findOne({_id})`: continua `started`/`pending`. `db.offlineActions` está vazia.

**Correção.**
1. Reexecutar as ações via **HTTP** (os endpoints REST já existem), não via `socket.emit`.
2. Só remover da fila **após confirmação de sucesso** (2xx); manter em caso de erro, com backoff e limite de tentativas.
3. Enviar chave de idempotência por ação para que o replay seja seguro (depende de C5 corrigido).
4. Tratar 409 (corrida já aceita/paga) como "resolver e remover", distinguindo de falha de rede.

---

## 13. Escalabilidade

### 13.1 🔴 X1 — A arquitetura não suporta mais de uma instância

Dois bloqueios absolutos:

1. **Socket.IO sem adapter externo** (`server.js`, `socket.js`). Com 2+ processos, `sendMessageToSocketId` só alcança sockets do próprio processo. Um passageiro conectado na instância A **não recebe** o `ride-confirmed` disparado pela requisição do motorista atendida na instância B. Exige `@socket.io/redis-adapter`.
2. **Cache em processo** (`node-cache`, `cache/cache.js`). `deleteByPrefix` limpa apenas a instância local; as outras seguem servindo dados velhos — inclusive `profile:captain:*`, que controla bloqueio (A1).

Enquanto isso não for resolvido, o teto é uma única instância — e com `transports: ['polling']` (S3), esse teto chega cedo.

### 13.2 🟡 X2 — Consultas e broadcasts

| Ponto | Análise |
|---|---|
| `getCaptainsInTheRadius` | 🟢 `$nearSphere` com índice `2dsphere` + `limit(20)`. Correto. |
| Cache de motoristas | 🟡 Chave `drivers:${ltd}:${lng}:${raio}` com coordenadas exatas → praticamente nunca acerta; cacheia `socketId` por 10 s, podendo despachar para socket morto. |
| `update-location-captain` | 🔴 A cada ping: 1 update de motorista + 1 `findOne` de corrida com `populate('user')` + 1 update de corrida + 2 emits + 1 broadcast para `admin_room`. Com 1 000 motoristas a 5 s → **~600 operações/s só de GPS**, cada uma com populate. É o gargalo dominante. |
| `admin-captain-location-updated` | 🔴 Broadcast global da posição de **todos** os motoristas para a sala admin, mesmo sem nenhum admin conectado e sem filtro geográfico. |
| `getSummary` | 🟡 `find()` de todas as corridas do dia e soma em JS; deveria ser `aggregate`. Mitigado por cache de 30 s. |
| `deleteByPrefix` | 🟡 Percorre **todas** as chaves do cache a cada chamada; é invocado em cada transação de carteira. |
| `getRideHistory` | 🟢 Paginado com índices adequados. |

**Projeção.** 100 motoristas: aceitável. 1 000: o pipeline de GPS satura um processo. 10 000: inviável sem particionar o fluxo de localização (canal dedicado, escrita em lote, `$inc` sem populate) e sem múltiplas instâncias com Redis.

---

## 14. Relatório final consolidado

### 🔴 Críticos

| # | Problema | Área | Impacto |
|---|---|---|---|
| C1 | Endpoint de aceite sem trava é o usado em produção (`/rides/confirm`) | Corridas | Dupla atribuição |
| C2 | Motorista pode ter duas corridas ativas | Corridas | Estado inválido |
| C3 | Aceitar × cancelar sem atomicidade | Corridas | Corrida cancelada "revive" |
| C4 | Iniciar × cancelar sem atomicidade | Corridas | Corrida impossível de finalizar |
| C5 | `confirmPayment` não idempotente | **Financeiro** | Crédito e comissão em dobro |
| C6 | Débito de carteira read-modify-write | **Financeiro** | Saldo negativo / corrida grátis |
| E1 | Motorista offline não libera nem avisa a corrida | Estado | Corrida órfã sem timeout |
| E3 | Múltiplas abas zeram o `socketId` | Socket | Usuário para de receber eventos |
| S1 | `join` sem autenticação | **Segurança** | Sequestro de canal e vazamento de OTP |
| F1 | 3 eventos emitidos sem nenhum ouvinte | Sincronização | Passageiro não vê progresso da corrida |
| R1 | Passageiro perde estado ao atualizar | Recuperação | Corrida ativa some da tela |
| R2 | Motorista perde estado ao atualizar; GPS para | Recuperação + **Financeiro** | Distância subcontada |
| B1 | Sem recuperação no restart do backend | Infra | Despacho para sockets mortos |
| D1 | `actualDistance` com lost update | **Financeiro** | Erro de cobrança |
| G1 | Sem expiração ativa de corridas | Consistência | Corridas órfãs acumulando |
| A1 | Bloqueio demora 10 min (cache de auth) | **Segurança** | Bloqueado continua operando |
| A2 | Mudança de tarifa altera corrida em andamento | **Financeiro** | Preço muda depois do aceite |
| O1 | Fila offline emite no vazio e apaga a ação | Tolerância a falhas | Perda silenciosa, motorista não recebe |
| X1 | Sem Redis adapter e cache em processo | Escalabilidade | Teto de 1 instância |

### 🟡 Precisa melhorar

C7 (perdedor não avisado) · C8 (finalização concorrente / passageiro ausente) · E2 (ciclo online-offline) · S2 (salas perdidas na reconexão) · S3 (`polling` forçado) · S4 (listeners globais sem cleanup) · R3 (popup não sobrevive ao refresh) · D2 (fila de GPS descarta trajeto) · A3 (categoria desativada em voo) · `submitReview` sem índice único · `payRide` sobrescreve trilha de auditoria · X2 (gargalos de consulta e broadcast)

### 🟢 Adequado

- `acceptRideAtomic` — implementação correta de compare-and-set (só precisa ser usada)
- `getCaptainsInTheRadius` — geoquery real com `2dsphere`, filtros de elegibilidade corretos
- Filtro de precisão de GPS (descarte de saltos > 2 km e ruído < 5 m)
- Cleanup de listeners de socket nas telas de domínio
- Paginação e índices de `getRideHistory`
- `walletRecharge` desativado por design enquanto não há gateway real

---

## 15. Ordem de correção sugerida

Sequência pensada por **risco decrescente e dependência técnica** — não é um plano de execução aprovado, apenas a ordem que eu recomendaria.

**Bloco 1 — Parar a perda de dinheiro e de dados (antes de qualquer outra coisa)**
1. C5 — tornar `confirmPayment` idempotente (marcar `paid` primeiro, condicional)
2. O1 — fila offline via HTTP, remoção só após 2xx (depende de C5 para ser segura)
3. C6 — débito de carteira com `$inc` condicional
4. C1 — apontar o frontend para `/rides/:id/accept` e blindar `/rides/confirm`

**Bloco 2 — Integridade da máquina de estados**
5. C3, C4 — todas as transições por compare-and-set
6. C2 — índice parcial único + guarda no aceite
7. D1 — `$inc` + timestamp na distância

**Bloco 3 — Segurança e efeito imediato**
8. S1 — autenticar o handshake do socket
9. A1 — invalidar cache no bloqueio + derrubar socket
10. A2 — snapshot de tarifa por corrida

**Bloco 4 — Recuperação**
11. R1, R2 — recuperar estado por backend em ambos os apps (+ endpoint de corrida atual do motorista)
12. B1 — limpeza de sockets no boot; rejoin de salas no `join`
13. E1, E3 — sessões múltiplas por usuário e tratamento de queda com corrida ativa
14. G1 — job de expiração de corridas

**Bloco 5 — Sincronização e escala**
15. F1 — adicionar os três listeners ausentes
16. S2, C7 — salas e aviso ao perdedor
17. X1 — Redis adapter + cache compartilhado
18. S3, X2 — WebSocket e otimização do pipeline de GPS

---

**Nenhum código foi alterado nesta auditoria.** As correções acima estão descritas apenas como recomendação; aguardo aprovação para executar, preferencialmente bloco a bloco com verificação ao vivo entre eles.
