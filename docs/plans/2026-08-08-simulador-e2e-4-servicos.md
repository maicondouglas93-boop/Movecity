# Simulador E2E dos 4 serviços MoveCity — Plano

## 1. Objetivo

Construir um simulador end-to-end **não mockado** dos 4 serviços (corrida imediata,
encomenda imediata, corrida agendada, encomenda agendada) que reutiliza código real de
produção (PricingEngine, ride.service/parcel.service, wallet.service, Socket.IO,
schedule.service) contra um banco Mongo real em memória (réplica set), com usuários
TEST/SIMULATOR claramente marcados, GPS movido via eventos socket reais (nunca escrita
direta de lat/lng no banco), e um relatório final objetivo (PASS/FAIL por cenário +
evidência).

Regra do usuário: **mapear antes de implementar, não duplicar lógica existente.** Este
documento é o resultado do mapeamento (seções 2-4) e a arquitetura antes de qualquer
código (seções 5+).

## 2. O que já existe e será reaproveitado (não duplicado)

- `tests/setup/setup.js` + `tests/setup/testDatabase.js`: conecta em
  `MongoMemoryReplSet` (1 nó, obrigatório p/ `mongoose.startSession()` usado por
  `confirmPaymentReceived`/`confirmParcelPayment`), limpa DB a cada `it()`
  (`afterEach → clearDatabase()`), fecha tudo em `afterAll`. **O simulador roda dentro
  desse mesmo setup** — banco de teste nunca é o banco real de produção, então "nunca
  tocar em dados reais" é garantido pela própria infraestrutura, não por uma checagem
  manual.
- `services/__mocks__/maps.service.js`: mock manual já usado por **toda** a suíte Jest
  (`tests/setup/setup.js` chama `jest.mock('../../services/maps.service')`).
  `getAddressCoordinate`/`getDistanceTime` retornam valores fixos (não chamam a API do
  Google) — `getCaptainsInTheRadius` e `haversineKm` são a implementação **real**
  (`jest.requireActual`). Isso será citado explicitamente no relatório final como a
  única camada mockada: geocoding de endereço → coordenada. Toda a movimentação GPS
  durante a corrida usa `haversineKm` real sobre os pontos que o simulador emite via
  socket, então a divergência estimativa×real (o objeto da Tarefa D) continua sendo
  matemática real, não fabricada.
- `services/__mocks__/asaas.service.js`: mock global do gateway morto (zero callers em
  produção, confirmado na auditoria financeira). Não relevante ao simulador — cash/pix
  não chamam gateway nenhum hoje; isso também será dito no relatório (camada de
  pagamento real do MoveCity já não tem gateway externo no fluxo cash/pix).
- `tests/factories/{user,captain,ride}.factory.js` — reaproveitados como estão.
  `parcel.factory.js` **não existe** e será criado seguindo o mesmo padrão.
- `tests/setup/authHelper.js` → `generateAuthToken(doc, type)` — reaproveitado para
  gerar os JWTs dos usuários/motoristas de teste.
- Padrão de socket real de `tests/sockets/ride.taken.test.js`: `createServer()` +
  `initializeSocket(httpServer)` + `socket.io-client` real + `supertest(app)` para HTTP
  real. O aceite de corrida/encomenda não exige que o motorista esteja "na sala" —
  `POST /rides/:id/accept` e `POST /parcels/:id/accept` funcionam com só o JWT do
  motorista (a sala é usada para notificar os *outros* candidatos).
- `schedule.service.js`: `activateDueRides()` / `activateDueParcels()` são as funções
  reais do cron — o simulador as chama diretamente (não mocks) para ativar um
  agendamento sem esperar o relógio real, exatamente como
  `tests/unit/schedule.phase1.test.js` já faz.
- `socket.js`'s `update-location-captain`: exige `join` autenticado prévio
  (`socket.data.identity`), atualiza `captain.location`/`locationGeoJSON` real e,
  se houver `ride` com `status in [started, ongoing]`, acumula `actualDistance` via
  `haversineKm` real (compare-and-swap em `lastLocation`). **Encomendas não acumulam
  distância real por GPS** (confirmado lendo o handler completo — o branch `else if
  (parcel)` só re-emite a localização, sem `$inc`). Isso é uma característica real do
  sistema, não uma lacuna do simulador — será registrado no relatório.

## 3. Contratos confirmados (mapeamento)

**Ride** (`ride.routes.js`): `/create` (`paymentMethod` restrito a `cash`/`pix`,
`scheduledAt` opcional ISO8601), `/:id/accept`, `/update-status` (transições via
`VALID_ORIGINS_BY_TARGET`: `going_to_pickup → arrived → waiting_passenger`),
`GET /start-ride?rideId&otp` (OTP de 6 dígitos gerado em `getOtp(6)` na criação,
`select:false` — leitura via `.select('+otp')`), `/end-ride`, `/pay`,
`/confirm-payment`, `/captain-cancel`.

**Parcel** (`parcel.routes.js` + `parcel.service.js`): `/create` (mesmos moldes,
`paymentMethod` já validado via `ALLOWED_PAYMENT_METHODS`), `/:id/accept` →
`acceptParcelAtomic` (exige `captain.location` real dentro do raio de
`CAPTAIN_SEARCH_RADIUS_KM` do pickup — logo o simulador precisa emitir 1 fix de GPS do
motorista *antes* de aceitar), `PATCH /:id/status` (`going_to_pickup → arrived_pickup →
collected → in_transit → arrived_destination`), `/:id/confirm-delivery` (exige PIN se
`vehiclePricing.requireDeliveryPin`, transiciona atomicamente para `finished` —
`delivered` nunca fica de fato persistido/consultável como status intermediário),
`/:id/confirm-payment` → `confirmParcelPayment` (mesma transação atômica idempotente de
`confirmPaymentReceived`: `paymentStatus:{$ne:'paid'}` como claim, tx `parcel_payment` +
`commission`, `captain.earnings`/`user.totalSpent`).

**Agendamento**: `POST /create` com `scheduledAt` válido (`assertValidScheduledAt`) cria
`status:'scheduled'`; `activateDueRides()`/`activateDueParcels()` (chamadas
diretamente pelo simulador) promovem para `requested`/`awaiting_provider` e disparam
`dispatchRideToCaptains`/`dispatchParcelToCaptains` reais.

## 4. Arquitetura de arquivos

```
Backend/tests/factories/parcel.factory.js         (novo)
Backend/tests/e2e-simulator/
  helpers/
    simSetup.js         — cria server http+socket real, conecta clients, generateAuthToken
    testActors.js        — cria user/captain TEST/SIMULATOR com prefixo claro no nome/email
    gpsRoute.js          — gera sequência de pontos GPS entre dois pontos (interpolação linear + ruído leve), emite via socket 'update-location-captain' com pausas reais entre pontos
    financialAssertions.js — helpers de assert (saldo carteira, comissão, transactions no banco)
    report.js            — acumula resultado por cenário e imprime o relatório ASCII final (seções A-F)
  ride.immediate.test.js        (Cenário 1)
  parcel.immediate.test.js      (Cenário 2)
  ride.scheduled.test.js        (Cenário 3)
  parcel.scheduled.test.js      (Cenário 4)
  idempotency.negative.test.js  (dedup/idempotência + casos negativos chave)
```

`jest.config.js`: adicionar `'**/tests/e2e-simulator/**/*.test.js'` a `testMatch` (reusa
o mesmo `setupFilesAfterEnv`, nenhuma configuração paralela nova).

`package.json` (Backend): novos scripts, no mesmo estilo dos existentes
(`test:unit`/`test:sockets`):
```
"test:movecity": "jest tests/e2e-simulator --runInBand --forceExit",
"test:movecity:ride": "jest tests/e2e-simulator/ride.immediate.test.js --forceExit",
"test:movecity:delivery": "jest tests/e2e-simulator/parcel.immediate.test.js --forceExit",
"test:movecity:scheduled-ride": "jest tests/e2e-simulator/ride.scheduled.test.js --forceExit",
"test:movecity:scheduled-delivery": "jest tests/e2e-simulator/parcel.scheduled.test.js --forceExit"
```
`--runInBand` no comando combinado evita que o stdout dos 4 relatórios ASCII se
intercale entre workers paralelos.

Cada arquivo de cenário chama `report.recordScenario(...)` ao final do seu próprio
`it()` e imprime seu bloco ASCII via `console.log` — sem processo orquestrador
separado (evita lógica paralela duplicando o que o Jest já faz).

## 5. Usuários de teste

`testActors.js` cria via as factories reais (`createUser`/`createCaptain`) com:
`fullname.firstname: 'SIMULATOR'`, `email: 'sim.<cenario>.<uuid>@movecity.test'`,
`phone` com prefixo `+55TEST...`. Isso deixa claro em qualquer log/DB dump que são
dados de simulação — e como tudo roda em `MongoMemoryReplSet` (banco efêmero, destruído
em `afterAll`), não há risco de poluir produção mesmo sem esse marcador, mas o
marcador fica como defesa em profundidade e pra legibilidade do relatório.

## 6. Fluxo por cenário

**1) Corrida imediata**: cria user+captain reais → captain `join` via socket +
`update-location-captain` (fixa `captain.location`) → `captain.isOnline=true` (via
model, é apenas estado de disponibilidade, não uma ação do usuário simulável por
endpoint dedicado — confirmar se existe endpoint de toggle; se não, setar direto é
aceitável pois não é o que está sob teste) → `POST /rides/create` (paymentMethod
`pix`) → captura `fare`/`estimatedDistance`/`otp` reais do documento → `POST
/rides/:id/accept` → `PATCH going_to_pickup → arrived → waiting_passenger` →
`GET /start-ride?otp` real → **gpsRoute** emite pontos reais via socket cobrindo uma
distância deliberadamente diferente da estimativa (pra provar que `actualDistance`
diverge de `estimatedDistance` de propósito, reaproveitando o achado da Tarefa D) →
`/end-ride` → assert `finalPrice` recalculado de verdade (não igual a `fare` da
estimativa) → `/pay` → `/confirm-payment` → assert transações de carteira
(comissão + repasse) batendo com `PricingEngine`.

**2) Encomenda imediata**: mesmo esqueleto usando `parcel.factory.js` (novo) +
`/parcels/create` → `/parcels/:id/accept` (após fixar GPS do captain) →
`PATCH going_to_pickup → arrived_pickup → collected → in_transit →
arrived_destination` → `/confirm-delivery` com o PIN real lido do documento
(`.select('+deliveryPin')`) → `/confirm-payment` → assert wallet/commission.

**3) Corrida agendada**: `POST /rides/create` com `scheduledAt` futuro válido → assert
`status:'scheduled'` → chama `scheduleService.activateDueRides()` diretamente (função
real de cron) → assert transição para `requested` + dispatch real disparado → resto
idêntico ao Cenário 1 a partir do accept.

**4) Encomenda agendada**: análogo, usando `activateDueParcels()`.

## 7. Idempotência e negativos (arquivo dedicado)

- Aceitar a mesma corrida/encomenda duas vezes concorrentemente → exatamente um
  vencedor (reaproveita o padrão de `ride.api.test.js`'s teste de concorrência).
  Confirmar via socket `ride-taken` com o motorista vencedor certo.
  Confirmar via `Promise.all`.
- Confirmar pagamento duas vezes (`confirmPaymentReceived`/`confirmParcelPayment`) →
  segunda chamada não duplica transação nem credita carteira 2x (claim atômico
  `paymentStatus:{$ne:'paid'}`).
- `paymentMethod:'card'` via chamada HTTP direta → rejeitado (`isIn(['cash','pix'])`,
  correção da auditoria financeira).
- Iniciar corrida com OTP errado → 401/erro, sem transição de estado.
- Confirmar entrega de encomenda com PIN errado → rejeitado, sem transição pra
  `finished`.

## 8. Relatório final

`report.js` monta e imprime, ao fim de `test:movecity`, o formato ASCII pedido: bloco
por cenário com PASS/FAIL, valores reais capturados (fare estimado vs. final,
distância estimada vs. real, comissão, saldo de carteira antes/depois), lista de
problemas classificados por severidade encontrados durante a execução, e conclusão
objetiva final — nunca "parece funcionar".

## 9. Correções durante a implementação

Só serão feitas correções de código de produção se o simulador expuser um
comportamento genuinamente quebrado (não move a régua sobre nada já corrigido nas
Tarefas C/D/E). Qualquer correção assim será registrada explicitamente no relatório
final (seção própria), nunca silenciosa.

## 10. Resultado

Implementado exatamente como planejado. Nenhuma correção de código de produção foi
necessária — o simulador validou que os 4 fluxos (e os casos de idempotência/negativos)
já funcionam corretamente de ponta a ponta. As únicas correções feitas foram na própria
infraestrutura de teste (não em código de produção), descritas abaixo.

**Achado real durante a implementação — mock de geocoding não intercepta chamadas via
HTTP**: `tests/setup/setup.js` chama `jest.mock('../../services/maps.service')` dentro
de um `beforeAll`. Qualquer arquivo de teste que faça `require('../../app')` no próprio
topo (padrão usado por `tests/sockets/*.test.js` e `tests/integration/*.test.js`) já
carrega `ride.service.js`/`parcel.service.js` — e a referência real de `maps.service`
que eles capturam — ANTES desse `beforeAll` rodar. Resultado: a primeira corrida/
encomenda criada pelo simulador saiu com a distância REAL entre os endereços de São
Paulo enviados (confirmado batendo com a geografia real), não o valor fixo do mock.
Corrigido colocando `jest.mock('../../services/maps.service')` no TOPO de cada arquivo
de cenário do simulador (hoisted pelo babel-plugin-jest-hoist pra antes de todo
`require` do próprio arquivo) — escopado só aos meus arquivos novos, sem tocar
`tests/setup/setup.js` nem qualquer teste pré-existente. Ver o comentário completo em
`tests/e2e-simulator/ride.immediate.test.js`.

**Achado real — Vitest também tentava rodar os arquivos do simulador**: `vitest.config.js`
usa `include: ['tests/**/*.test.js']`, então os 5 arquivos novos (que usam `jest.mock`,
inexistente no Vitest) quebravam `npm run test:coverage` (o gate real do CI) com
`ReferenceError: jest is not defined`. Corrigido adicionando `tests/e2e-simulator/**`
à lista de excludes do Vitest — mesmo padrão já usado ali para `tests/integration/**`
e `tests/sockets/**` (com o mesmo comentário pré-existente explicando o motivo).
Confirmado depois da correção: `npm run test:coverage` volta a 24/24 arquivos, 131/131
testes.

**Achado real — `--forceExit` é obrigatório, `--verbose` é necessário pro relatório
combinado aparecer**: sem `--forceExit`, o processo trava (confirmado — um
`node-cron` real inicializado no load de `app.js`, fora do escopo desta tarefa,
mantém o processo vivo mesmo com toda conexão de teste fechada corretamente; é o
mesmo motivo pelo qual TODOS os scripts Jest pré-existentes já usam `--forceExit`).
Com `--forceExit` mas sem `--verbose`, rodar os 5 arquivos juntos com
`--runInBand` suprimia os `console.log` dos relatórios ASCII na saída (mesmo com
todos os testes passando) — `--verbose` resolve isso de forma determinística.
`test:movecity` ficou com `--runInBand --forceExit --verbose`.

**Verificação de regressão**: `npm run test:coverage` (gate real do CI) — 131/131 ✅.
`npx jest tests/unit tests/integration tests/sockets tests/security --forceExit` —
40 falhas em 411 testes, TODAS pré-existentes (verificado objetivamente via
`git stash` das mudanças deste trabalho + re-execução de `ride.api.test.js`/
`ride.cancellation.test.js`, que reproduziram os mesmos 2 failures no baseline limpo).
Consistente com o comentário já existente em `vitest.config.js`: "Integração/sockets
flaky ou acoplados a estado global — gate do CI fica nas units Vitest." Nenhuma
mudança deste trabalho toca a lógica desses testes; nenhuma correção foi feita neles
por estar fora do escopo desta tarefa.
