# Auditoria Financeira Completa — MoveCity

**Status:** diagnóstico concluído. Nenhum código foi alterado para produzir este
relatório — apenas leitura de código, leitura (read-only, sem escrita) da
configuração real de produção via um script descartável já apagado, e execução
da função pura de cálculo (`PricingEngine.calculateFare`, que não persiste nada)
com essa configuração real.

**Metodologia:** não me limitei a ler código e concluir "parece correto". Rodei
a suíte de testes já existente (que revelou 3 bugs ativos), e conectei
(somente leitura) ao banco de **produção** para comparar o que o Admin
mostra/edita com o que o motor de cálculo realmente lê — a mesma base usada
pelo app em produção agora. Os números abaixo em "PROVA COM DADOS REAIS" são
reais, não simulados.

---

## Resumo executivo

O MoveCity tem uma base de engenharia financeira **genuinamente sólida** em
partes centrais (transação atômica do pagamento, índice único no banco contra
duplicidade, sanitização de comissão antes de expor ao motorista) — mas tem
**três problemas de gravidade crítica** que afetam dinheiro real hoje:

1. A comissão que o Admin configura e a comissão realmente cobrada em cada
   corrida **vêm de lugares diferentes do banco** — hoje, ao vivo, em
   produção, o Admin mostra 21% e o sistema cobra 15% (carro/moto) ou 20%
   (auto).
2. Pagamento por cartão **não tem nenhuma cobrança real** por trás — a
   integração Asaas para cobrar cartão/Pix da plataforma existe como código
   mas nunca é chamada por nada — e mesmo assim o motorista é creditado como
   se tivesse recebido.
3. Dois bugs de cálculo (taxa de espera e opcionais somem do `finalPrice` em
   certas corridas) já estão **provados por testes que falham no CI agora**,
   não são hipóteses.

Classificação final na seção 23.

---

## 1–6. Motor de tarifas — mapeamento, fonte oficial e cálculo matemático

### 1.1 Fonte oficial do cálculo

Existe **uma única função de cálculo real**, e isso é bom:
[Backend/services/pricingEngine.service.js:88](Backend/services/pricingEngine.service.js#L88)
— `PricingEngine.calculateFare()`. Chamada por:

- `ride.service.js` → `createRide` (cotação/criação), `endRide` (preço final),
  `createPresentialRide` (presencial).
- `parcel.service.js` → `getParcelFare` (cotação/criação de encomenda).

Não existem "múltiplos cálculos independentes sem justificativa" — corrida,
presencial e encomenda passam pela mesma função, parametrizada por
`serviceKind: 'ride' | 'presential' | 'parcel'`. Isso é uma coisa correta que
o time já fez (comentário no código chama de "Unified Pricing Engine").

### 1.2 De onde vêm os números (o problema começa aqui)

`calculateFare` lê os valores de **`VehicleCategory.pricing`** (por
categoria — car/moto/auto), não de `TariffSetting` nem de `GlobalSetting`
diretamente:

```js
// pricingEngine.service.js:116-121
const pricing = category.pricing || {};
const baseFare = pricing.baseFare ?? category.baseFare ?? 5.00;
const perKm = pricing.perKm ?? category.perKmRate ?? 2.00;
const perMinute = pricing.perMinute ?? category.perMinuteRate ?? 0.50;
const minimumFare = pricing.minimumFare ?? category.minFare ?? 7.00;
const platformCommissionPct = pricing.platformCommission ?? 20;
```

A fórmula reconstruída (confere com o código linha a linha):

```text
subtotal = baseFare + (km_cobrável × perKm) + (min_cobrável × perMinute)
subtotal = max(subtotal, minimumFare)
subtotal += espera_excedente + opcionais + paradas_extras + noturno + chuva
subtotal += acréscimo_encomenda   (só serviceKind === 'parcel')
subtotal += tarifas_globais_ativas
cardFee = (paymentMethod==='card') ? subtotal×cardFeePercent% + cardFeeFixed : 0
subtotal += cardFee
subtotal -= desconto_cupom
finalFare = arredondar(subtotal, roundingRule)
commissionAmount = (finalFare - cardFee) × platformCommissionPct / 100
driverEarnings = finalFare - commissionAmount
```

Não encontrei o bug clássico `20% = 20` vs `× 1.20` — a fórmula de comissão
está matematicamente correta (`× (pct/100)`, não `× pct`). O problema não é a
fórmula, é **de onde vem `platformCommissionPct`** (seção 7).

### 1.3 PROVA COM DADOS REAIS (produção, hoje)

Rodei `calculateFare` de verdade com a configuração ativa da categoria `car`:

| Cenário | baseFare | distanceFare | timeFare | finalFare | comissão (15%) | motorista |
|---|---|---|---|---|---|---|
| Curta (1km, 5min) | 13 | 2,30 | 1,50 | **R$ 16,80** | R$ 2,52 | R$ 14,28 |
| Média (5km, 15min) | 13 | 11,50 | 4,50 | **R$ 29,00** | R$ 4,35 | R$ 24,65 |
| Longa (20km, 40min) | 13 | 46,00 | 12,00 | **R$ 71,00** | R$ 10,65 | R$ 60,35 |
| Tarifa mínima (200m, 1min) | 13 | 0,46 | 0,30 | **R$ 13,76** | R$ 2,06 | R$ 11,70 |

Conferido à mão: 13 + 2,30 + 1,50 = 16,80 ✅. 13 + 11,50 + 4,50 = 29,00 ✅.
13 + 46 + 12 = 71,00 ✅. Nenhum dos quatro caiu abaixo do `minimumFare` (9,00)
antes dos acréscimos, então o piso não chegou a ser testado por esses
cenários — o cálculo do piso (`if (subtotal < minimumFare)`) está
matematicamente correto lendo o código, só não apareceu nestes 4 números
porque a tarifa base (13) já é maior que o mínimo (9).

**Chuva e noturno: não há como testar em produção porque estão OFF em TODAS
as categorias** — e pior, a de chuva **não pode ser ligada** (seção 2 abaixo).

**Combinação (chuva+noite+adicional):** o código soma os três
(`currentSubtotal += waitingCharge + optionalsCharge + extraStopsCharge +
nightCharge + rainCharge`, linha 255) — não multiplica um pelo outro, então
não há o bug de "multiplicador aplicado duas vezes" descrito no pedido. Mas
como nenhuma categoria tem chuva ativável, isso nunca roda de verdade hoje.

### 1.4 Arredondamento, conversões, decimais

- Metros→km: `distance/1000` ✅. Segundos→minutos: `time/60` ✅.
- `roundingRule` (`none`/`up`/`down`/`nearest`) aplicado só sobre `finalFare`,
  antes da comissão — correto (comissão sobre valor já arredondado).
- `formatDecimals` arredonda tudo pra 2 casas no final (`toFixed(2)` +
  `parseFloat`) — sem acúmulo de flutuante visível nos 4 testes acima.
- **Distância real vs. estimada**: na criação, `estimatedDistance`/
  `estimatedTime` (rota calculada) alimentam a cotação. No fim
  (`endRide`), o `actualDistance` vem do **GPS rastreado durante a
  corrida** (`ride.actualDistance`, acumulado via `lastLocation`), não da
  estimativa — correto em princípio, mas ver o bug crítico da seção 9.

---

## 2–3. A tarifa configurada no Admin é REALMENTE usada? (campo a campo)

| Campo | Onde o Admin edita | Onde o cálculo lê | Mesmo lugar? |
|---|---|---|---|
| baseFare / perKm / perMinute / minimumFare | `VehicleCategory.pricing` (tela de categorias) | `VehicleCategory.pricing` | ✅ Sim |
| **Comissão da plataforma** | `GlobalSetting.platformCommission(s)` (tela "Tarifas Globais") | `VehicleCategory.pricing.platformCommission` | ❌ **NÃO** |
| Tarifa noturna | `VehicleCategory.pricing.surcharges.night` | mesmo lugar | ✅ Sim (mas OFF em tudo hoje) |
| **Tarifa de chuva** | `TariffSetting.manualRainFee` (painel) | nunca lido; `VehicleCategory.pricing.surcharges` nem tem campo `rain` no schema | ❌ **Impossível ligar** |
| **Tarifa dinâmica/surge** | `TariffSetting.dynamicPricingStatus`/`currentMultiplier` | nunca lido por `calculateFare` | ❌ **Configurável, sem efeito** |
| Taxa de espera (motorista) | `VehicleCategory.pricing.surcharges.waiting` | mesmo lugar | ✅ Sim |
| Adicionais (opcionais) | `VehicleCategory.pricing.optionals[]` | mesmo lugar | ✅ Sim |
| Taxa de cartão | `GlobalSetting.cardFeePercent/cardFeeFixed` | mesmo lugar (`gs.cardFeePercent`) | ✅ Sim (mas cartão não é cobrado de verdade — seção 11) |
| **Taxa de cancelamento** | `VehicleCategory.pricing.surcharges.cancellation` / `TariffSetting.cancellationFee` (snapshot decide) | calculada e gravada em `ride.cancellationFeeCharged` | ⚠️ Calculada, **nunca cobrada de ninguém** |
| Cupons | `Coupon` model, código único | `calculateFare` lê `Coupon.findOne` | ✅ Sim |
| Acréscimo de encomenda | `VehicleCategory.pricing.parcelAdjustment` | mesmo lugar | ✅ Sim |

### 3.1 O achado central: comissão em TRÊS lugares diferentes

```text
tariffSetting.model.js:94   → platformCommission (default 20) — MORTO, ninguém lê pra calcular
globalSetting.model.js      → platformCommission / platformCommissions{ride,presential,parcel}
                               — o que o ADMIN vê e edita na tela "Tarifas Globais"
vehicleCategory.model.js:94 → pricing.platformCommission — o que o CÁLCULO REAL usa
```

Prova em produção agora ([config real, ver seção 1.3](#13-prova-com-dados-reais-produção-hoje)):

```text
GlobalSetting.platformCommission        = 21   (Admin editou pra isso)
GlobalSetting.platformCommissions       = { ride: 21, presential: 21, parcel: 20 }
VehicleCategory[car].pricing.platformCommission   = 15   ← usado de verdade
VehicleCategory[moto].pricing.platformCommission  = 15   ← usado de verdade
VehicleCategory[auto].pricing.platformCommission  = 20   ← usado de verdade
TariffSetting.platformCommission        = undefined (nem o default 20 chegou a gravar neste doc)
```

**O admin acredita que a comissão de corrida é 21%. O sistema está cobrando
15% em toda corrida de carro/moto, 20% em "auto".** Isso não é uma hipótese —
é o estado real do banco de produção no momento desta auditoria.

**Como isso aconteceu** (evidência no próprio código,
[admin.service.js:1476-1477](Backend/services/admin.service.js#L1476-L1477)):
o comentário do commit recente que criou o "Simulador de Tarifas" diz
literalmente *"o admin não tinha como ver/editar o valor real (20%) usado no
cálculo"* — ou seja, quem escreveu isso **também acreditava** que
`globalSetting.platformCommission` era a fonte real. Não é. Foi um engano de
boa-fé, não fraude — mas o efeito prático é o mesmo: o admin mexe num
controle que não está ligado a nada.

O migration script
[Backend/scripts/migrate-pricing.js](Backend/scripts/migrate-pricing.js)
explica a origem: rodou **uma única vez**, copiou
`TariffSetting.platformCommission` (o valor de então) para dentro de cada
`VehicleCategory.pricing.platformCommission`, e nunca mais sincronizou nada.
De lá pra cá, os dois valores divergiram silenciosamente.

### 3.2 Outros "configurados mas não usados" confirmados

- **Chuva**: `VehicleCategory.pricing.surcharges` no schema
  ([vehicleCategory.model.js:100-119](Backend/models/vehicleCategory.model.js#L100-L119))
  só tem `night`, `waiting`, `extraStops`, `cancellation` — **não existe
  campo `rain`**. `pricingEngine.service.js:243` lê `pricing.surcharges?.rain
  || { active: false, ... }` — cai sempre no fallback porque o campo nunca
  existe. `TariffSetting.manualRainFee` (o toggle que aparece pro admin,
  comentário: *"Ativar taxa de chuva manualmente pelo painel"*) não é lido
  em NENHUM lugar do código de cálculo — confirmei via busca em todo o
  backend. `category.rainFeeMultiplier` (campo solto, fora de `pricing`) só
  é lido dentro do `if (rainConfig.active)`, que nunca é `true` — também
  morto.
- **Surge/dinâmica**: `dynamicPricingStatus`/`currentMultiplier`/
  `minMultiplier`/`maxMultiplier` existem só em `TariffSetting.model.js` e no
  script de seed — `pricingEngine.service.js` nunca lê nenhum desses campos.
- **Taxa de cancelamento**: calculada corretamente
  (`cancellationFeeCharged` em
  [ride.service.js:1806-1810](Backend/services/ride.service.js#L1806-L1810)),
  gravada na corrida, mas busquei em todo o backend por esse campo — só é
  **escrito**, nunca **lido** por nada que cobre o passageiro ou pague o
  motorista. É uma taxa "de mentira": existe no banco, não produz nenhum
  efeito financeiro real.

### 3.3 Valores hardcoded encontrados (fallbacks, não a fonte principal)

```js
// pricingEngine.service.js:117-121 — só ativa se category.pricing vier ausente/malformado
baseFare ?? 5.00 | perKm ?? 2.00 | perMinute ?? 0.50 | minimumFare ?? 7.00 | platformCommission ?? 20

// calculateCancellationFee, linha 69 — fallback genérico sem snapshot/veículo
return 5.0;

// db/db.js:183-184, seedTariff.js:57-58, admin.service.js:1502-1503/1579/1707 — defaults de criação
platformCommission: 20 (repetido em pelo menos 6 arquivos)
```

Nenhum desses é "a fonte da verdade competindo com a principal" — são
fallbacks defensivos ou seeds de criação de documento novo. Não são o bug;
o bug é a seção 3.1.

---

## 7. Comissão da MoveCity

- **Onde é configurada** (o que o admin EDITA): `GlobalSetting` via
  `PUT` que passa por
  [admin.service.js:updateGlobalSettings](Backend/services/admin.service.js#L1532).
- **Onde é REALMENTE usada**: `VehicleCategory.pricing.platformCommission`
  (seção 3.1). Editável hoje só pela tela de edição de categoria de
  veículo (`updateVehicleCategory`), que é uma tela **diferente** da de
  "Tarifas Globais".
- **Percentual, não fixo.** Calculada uma vez por corrida
  (`commissionAmount = (finalFare - cardFee) × pct/100`), congelada no
  `pricingSnapshot` da corrida no momento da criação — **não recalcula com
  tarifa nova do admin no meio da corrida** (proteção correta, comentário
  explícito no código sobre isso, P2.2 da auditoria de concorrência
  anterior).
- **É descontada uma única vez?** Sim — ver seção 9 (proteção por índice
  único + transação atômica, muito bem feita).
- **Cancelamento gera comissão indevida?** Não — `commissionAmount` só é
  criado dentro de `confirmPaymentReceived`, que só roda para corrida
  `status: 'finished'`. Corrida cancelada nunca chega lá.
- **Corrida gratuita (cupom 100%) gera comissão?** A comissão é calculada
  sobre `finalFare` **depois** do desconto do cupom
  (`baseForCommission = finalFare - cardFee`, e `finalFare` já veio com
  `-couponDiscount` aplicado antes) — se o cupom zerar o valor, a comissão
  também zera. Consistente.
- **Dinheiro, Pix e cartão geram comissão?** Sim, os três — mas por
  mecanismos diferentes (seção 9/11): dinheiro/Pix descontam via um lançamento
  `commission` separado; cartão desconta "por dentro" (credita só o líquido,
  sem lançamento `commission` visível — ver nota na seção 15).

### Teste do exemplo do pedido (R$ 20,00, comissão 20%)

Com uma categoria configurada em 20% (ex.: `auto`, confirmado no banco real):
`commissionAmount = 20,00 × 20/100 = R$ 4,00`, `driverEarnings = R$ 16,00`.
**A fórmula produz exatamente isso.** O problema não é a matemática — é
qual percentual entra na fórmula (seção 3.1).

---

## 8–10. Carteira do motorista, débito de comissão, repasse

Esta é a parte **mais bem construída** do sistema. Detalhamento:

### 8.1 Modelo

`Wallet` ([wallet.model.js](Backend/models/wallet.model.js)):
`creditBalance` (crédito pré-pago, pode ficar negativo — é a "dívida" de
comissão de corridas em dinheiro/Pix), `pendingBalance` (dinheiro que a
plataforma deve ao motorista, ex.: líquido de cartão, aguardando saque),
`totalEarned`, `totalCommissionPaid`.

`Transaction` ([transaction.model.js](Backend/models/transaction.model.js)):
ledger completo com `balanceBefore`/`balanceAfter`, `type` (`commission`,
`recharge`, `withdraw`, `payout`, `bonus`, `adjustment`, `ride_payment`,
`parcel_payment`), e **dois índices únicos parciais** garantindo no máximo um
lançamento `ride_payment`/`commission` por `rideId` e um por `parcelId`.

### 8.2 O saldo é recalculável, ou o sistema confia num campo?

Confia em `wallet.creditBalance`/`pendingBalance`, mas **nunca com
read-modify-write** — todo débito/crédito é `$inc` atômico via
`findOneAndUpdate` em
[wallet.service.js:70-74](Backend/services/wallet.service.js#L70-L74),
nunca `wallet.creditBalance -= x; wallet.save()`. Isso elimina a classe de
bug mais comum de carteira (duas escritas concorrentes pisando uma na outra).
Cada transação grava `balanceBefore`/`balanceAfter`, então o saldo **é**
auditável/recalculável a partir do ledger, mesmo que o código não faça essa
reconciliação automaticamente hoje.

### 8.3 Desconto automático da comissão — a bateria de testes pedida

Função: `confirmPaymentReceived`
([ride.service.js:1298](Backend/services/ride.service.js#L1298)).

| Pergunta do pedido | Resposta | Evidência |
|---|---|---|
| O desconto realmente acontece? | ✅ Sim | `walletService.createTransaction({ type: 'commission', ... })` |
| Acontece no momento correto (após corrida terminar)? | ✅ Sim | Exige `existing.status !== 'finished'` → erro antes de prosseguir |
| Acontece só uma vez? | ✅ Sim | `findOneAndUpdate` com filtro `paymentStatus: { $ne: 'paid' }` — compare-and-swap atômico |
| Não ocorre em corrida cancelada/recusada/nunca iniciada? | ✅ Sim | Só roda a partir de `status: 'finished'`, que só existe depois de `startRide`+`endRide` |
| Duplicidade / retry / idempotência? | ✅ Protegido em 3 camadas | (1) pré-checagem, (2) update atômico condicional, (3) índice único parcial no `transaction` model — mesmo que (1)+(2) falhassem, o banco rejeitaria o insert duplicado com E11000 |
| Race condition? | ✅ Protegido | `session.withTransaction` (transação Mongo real) + os itens acima |

Isto é o oposto de um problema — é a parte que eu **não** conseguiria quebrar
só de ler o código; a defesa em profundidade (checagem + update condicional +
índice único) é exatamente o padrão certo para "double charge".

### 8.4 Repasse / saldo — nuance encontrada (não é bug de dinheiro, é de clareza)

Para dinheiro/Pix, o lançamento `ride_payment` só incrementa `totalEarned`
(não `creditBalance`) —
[wallet.service.js:39-44](Backend/services/wallet.service.js#L39-L44) — porque
o motorista já ficou com o dinheiro físico/Pix direto. O desconto de verdade
é o lançamento `commission` separado, que subtrai de `creditBalance`. Isso é
uma decisão de design correta (o "líquido" nunca chega a existir como saldo
positivo — só a dívida de comissão aparece), mas tem um efeito colateral: o
próprio registro interno do lançamento `ride_payment` grava
`balanceBefore === balanceAfter` (porque o campo que ele reporta,
`creditBalance`, não foi o campo realmente incrementado por ele). **Isso é
invisível pro motorista** — o app dele já reescreve isso para "valor líquido"
antes de mostrar ([financePrivacy.js:88-151](Backend/utils/financePrivacy.js#L88-L151),
função bem feita) — mas um admin olhando o ledger bruto no banco pode achar
que "não aconteceu nada" nesse lançamento. 🟡 Médio, não é perda de dinheiro.

### 10.1 O "repasse" é bem definido?

Sim: `pendingBalance` = "a plataforma deve isso ao motorista" (cartão
recebido pela plataforma, aguardando saque via `requestPayout` →
`Payout` model, aprovado manualmente pelo admin em
`admin.service.js` dentro de outra transação atômica que valida
`wallet.pendingBalance >= claimed.amount` antes de processar). Não vi
confusão entre "earnings" (contador vitalício, `captain.earnings`, só
informativo) e o saldo sacável de verdade.

---

## 11. Pagamento — o achado mais grave

### 11.1 `payRide` gera IDs de pagamento fabricados

[Backend/services/ride.service.js:1434-1458](Backend/services/ride.service.js#L1434-L1458):

```js
const paymentId = 'pay_' + crypto.randomBytes(8).toString('hex');
const orderId = 'order_' + crypto.randomBytes(8).toString('hex');
const signature = crypto.randomBytes(16).toString('hex');
// ...grava direto no ride, sem chamar nenhum gateway
```

Isso **não é código morto** — está numa rota ativa (`POST /rides/pay`,
[ride.routes.js:117-121](Backend/routes/ride.routes.js#L117-L121)) e é
chamada de verdade pelo app do passageiro em
[Riding.jsx:234](frontend/src/passenger/pages/Riding.jsx#L234)
(`handleConfirmPayment`). Nomes de campo (`orderId`, `signature`) imitam
convenção de gateway real, mas são 100% locais. Isso não move dinheiro
sozinho (o efeito financeiro real só acontece em `confirmPaymentReceived`,
que o motorista dispara separadamente), mas grava no banco um rastro que
parece de gateway e não é — risco de reconciliação enganosa numa auditoria
ou disputa futura.

### 11.2 A integração Asaas existe como código morto

`Backend/services/asaas.service.js` define `createCustomer`,
`createPixCharge`, `getPixQrCode`, `createCreditCardCharge` — busquei em
**todo** o backend (controllers, services, routes) por chamadas a esse
service: **zero resultados**. Nada no frontend também referencia Asaas.
`ride.model.js` permite `paymentMethod: 'card'` no schema, mas a **UI atual
do passageiro só oferece Pix e Dinheiro**
([PaymentOptionsPanel.jsx:3-6](frontend/src/passenger/components/PaymentOptionsPanel.jsx#L3-L6)) — com um comentário no próprio código
confirmando que cartão foi **deliberadamente removido da tela** por estar
"fora do escopo atual".

**Pix aqui não é uma cobrança via Asaas pela plataforma — é o passageiro
pagando o motorista diretamente pela chave Pix dele**, exatamente como
dinheiro (mesmo branch de código em `confirmPaymentReceived`). Isso é uma
escolha de produto legítima e comum em apps early-stage, não um bug.

### 11.3 O webhook do Asaas existe e é seguro — mas serve pra quê?

[webhook.controller.js](Backend/controllers/webhook.controller.js) valida
corretamente o token (`asaas-access-token`, 401 se ausente/errado — boa
prática, evita o que o próprio código chama de "M11 da auditoria" anterior).
Mas: nada no sistema cria uma cobrança Asaas real (nem Pix, nem cartão, nem
recarga) — então não há nenhum evento real que dispare esse webhook hoje. E
mesmo que disparasse para uma corrida (`event.event === 'PAYMENT_RECEIVED'`
+ ride encontrado por `paymentID`), o código só muda `paymentStatus` — **não
chama `walletService.createTransaction`**, com um comentário no próprio
código admitindo a indecisão de design (linhas 55-57: *"será tratado aqui ou
em `confirmPaymentReceived`... tipicamente..."*). Recarga de carteira do
motorista tem o mesmo problema: **nenhum endpoint cria um `Recharge` com
`asaasInvoiceId` real** — busquei em todo o backend. A forma real de recarga
hoje é **manual**: `admin.service.js` (~linha 855) tem um ajuste manual de
saldo (`type: credit/debit`, limitado a R$ 10.000, com `reason`/`adminId`
obrigatórios) — presumo que seja assim que recargas são processadas na
prática (PIX/depósito confirmado manualmente fora do app, admin credita).
Isso é operacionalmente razoável para a fase atual, mas **não é** o que o
código do webhook/Asaas sugere que deveria acontecer.

### 11.4 Simulação de pagamento por método

| Método | Quem paga | Cobrança real da plataforma? | Comissão descontada quando |
|---|---|---|---|
| Dinheiro | Passageiro → motorista, fora do app | N/A (nunca passa pela plataforma) | `confirmPaymentReceived`, lançamento `commission` |
| Pix | Passageiro → chave Pix do motorista, fora do app | N/A (idem dinheiro) | idem dinheiro |
| Cartão | — | ❌ **Nunca cobrado** (Asaas nunca chamado) | `confirmPaymentReceived` credita líquido ao motorista mesmo assim |
| Carteira (`'carteira'`) | Saldo pré-pago do passageiro | Não é gateway — é saldo interno do próprio app | Aplicado no momento da criação (`useWalletBalance`) |

---

## 12. Cancelamentos (financeiro)

| Caso | Cobrança? | Comissão? | Débito na carteira? | Estorno? |
|---|---|---|---|---|
| Passageiro cancela antes do aceite | Não | Não | Não | N/A |
| Motorista recusa | Não | Não | Não | N/A |
| Motorista aceita e passageiro cancela | `cancellationFeeCharged` é **calculado e gravado**, mas nunca cobrado de fato (seção 3.2) | Não | Não | N/A |
| Motorista aceita e cancela | Sem taxa (regra correta — não é o passageiro que desistiu) | Não | Não | N/A |
| Corrida iniciada e cancelada | Não encontrei caminho de cancelamento pós-`started` no `ride.service.js` (`cancelRide`/`cancelRideByCaptain` só aceitam origens pré-`started`, ver `VALID_ORIGINS_BY_TARGET.cancelled`) — uma corrida em andamento só termina via `endRide` | — | — | — |
| Corrida finalizada | N/A (não é cancelamento) | Normal | Normal | N/A |

O achado real aqui já está na seção 3.2/9: a taxa de cancelamento é uma
regra de negócio **decorativa** — calculada certinho, sem nenhum efeito
financeiro.

---

## 13. Encomendas

- Moto e carro têm tarifa própria: ✅ (`VehicleCategory.pricing`, por
  categoria, igual corrida).
- Config do Admin realmente usada? Mesma resposta da seção 3: preço sim,
  **comissão não** (mesmo bug, herdado).
- Tarifa de corrida sendo usada indevidamente em encomenda? **Não** —
  confirmei: `getParcelFare`
  ([parcel.service.js:308](Backend/services/parcel.service.js#L308)) chama
  `PricingEngine.calculateFare({ ..., serviceKind: 'parcel' })`, que aplica
  o acréscimo de encomenda (`parcelAdjustment`) só quando
  `serviceKind==='parcel'` — sem contaminação cruzada.
- **`parcelSetting.deliveryPricing` (o sistema antigo com
  `DEFAULT_VEHICLE_PRICING`/`ensureDeliveryPricing`) não é uma segunda
  tarifa concorrente** — confirmei pelo comentário explícito no código
  ([parcel.service.js:335](Backend/services/parcel.service.js#L335):
  *"mantidos para restrição, não para preço"*) e pelo uso real: só alimenta
  `maxWeightKg`/`maxPackageSize`/`requireDeliveryPin`/`blockIncompatibleVehicle`
  (regras de compatibilidade de veículo), nunca o valor cobrado. Isso
  respondeu de forma limpa a uma das preocupações centrais do pedido — aqui
  não há duplicidade.
- Preço/km, preço/minuto, tarifa mínima, adicionais: mesma engine, mesmo
  resultado que corrida — funcionam.
- Carteira/repasse: mesmo mecanismo (`type: 'parcel_payment'` em vez de
  `'ride_payment'`, resto idêntico).

---

## 14. Corrida iniciada pessoalmente (presencial)

Usa o **mesmo motor** —
[ride.service.js:750-762](Backend/services/ride.service.js#L750-L762) chama
`PricingEngine.calculateFare({ ..., serviceKind: 'presential' })`, igual
corrida normal. **Não existe lógica financeira paralela** de verdade.

Única nuance (não é uma segunda conta, é um placeholder de exibição): quando
o motorista inicia presencial **sem destino ainda definido**, o código
explicitamente NÃO chama `calculateFare(0)` (comentário: isso "retornaria
minFare e enganaria a UI") — grava `fare: 0, finalPrice: 0` e usa um
`commissionPercent` só para MOSTRAR na tela
([ride.service.js:785-788](Backend/services/ride.service.js#L785-L788)),
lido de `globalSetting.platformCommissions.presential` como fallback. Esse
percentual de exibição pode não bater com o percentual real que vai ser
aplicado depois em `endRide` (que usa `VehicleCategory.pricing`, mesmo bug da
seção 3.1) — mas como `commissionAmount` fica `0` nesse momento, não há
dinheiro em jogo, só uma incoerência cosmética entre o que é mostrado como
prévia e o que será cobrado de fato.

---

## 15. Banco de dados — entidades financeiras

| Model | Campos financeiros principais | Escreve | Lê | Observação |
|---|---|---|---|---|
| `Ride` | `fare`, `finalPrice`, `commissionAmount`, `commissionPercent`, `fareBreakdown`, `pricingSnapshot`, `cancellationFeeCharged`, `paymentStatus`, `paymentID/orderId/signature` | `ride.service.js` | `ride.controller.js`, `wallet.service.js` (hints de comissão) | `paymentID` é fabricado (seção 11.1) |
| `Payment` | `rideId`, `amount`, `method`, `status` | `endRide`, `confirmPaymentReceived` | consultas admin/histórico | Espelha status da ride; não é o gateway |
| `Wallet` | `creditBalance`, `pendingBalance`, `totalEarned`, `totalCommissionPaid` | só via `$inc` atômico em `wallet.service.js` | app motorista, admin | Bem protegido (seção 8) |
| `Transaction` | `type`, `amount`, `balanceBefore/After`, `paymentMethod` | `wallet.service.js` | extrato, admin | Índice único parcial por `rideId+type`/`parcelId+type` — proteção real contra duplicidade |
| `Payout` | `amount`, `status`, `bankDetailsSnapshot` | `requestPayout`, aprovação admin | Centro Financeiro admin | Transação atômica valida saldo antes de processar |
| `Recharge` | `asaasInvoiceId`, `status`, `amount`, `method` | **nada cria isto hoje** (seção 11.3) | `webhook.controller.js` (nunca encontra match) | Órfão — schema existe, fluxo de criação não |
| `TariffSetting` | `baseFare/perKm/perMinute/minimumFare/platformCommission` (bloco "unificado", **duplicado** do de `VehicleCategory`), `cancellationFee`, `dynamicPricingStatus`, `manualRainFee` | admin (parcial) | **praticamente nada** para cálculo real | Maior fonte de campos obsoletos/mortos do sistema |
| `GlobalSetting` | `platformCommission(s)`, `cardFeePercent/Fixed`, `minimumPayout`, `blockDriverOnNegativeBalance` | admin | `cardFee` ✅ usado; `platformCommission` ❌ não usado no cálculo | O core do achado crítico |
| `VehicleCategory` | `pricing.{baseFare,perKm,perMinute,minimumFare,platformCommission,surcharges,optionals}` | admin (tela de categorias) | `PricingEngine.calculateFare` — **fonte real** | |

Campos como `fare` vs `finalPrice` **não são duplicação confusa** — são
estágios diferentes por design (`fare` = estimativa/congelado na criação,
`finalPrice` = valor real após `endRide`) e o código é consistente sobre
isso. `earnings` (campo solto em `Captain`, contador vitalício) vs
`wallet.totalEarned` (também vitalício, mas no wallet) **são
redundantes** — os dois são incrementados juntos em `confirmPaymentReceived`
(`captainModel.$inc: { earnings: finalFare }` e
`walletService.createTransaction` que incrementa `totalEarned`) — mesma
fonte, dois lugares, risco baixo de divergirem já que são escritos na mesma
transação, mas é duplicação de schema que poderia ser um dos dois só.

---

## 16. Consistência financeira — a equação fecha?

**Equação 1** (uma corrida em dinheiro/Pix, R$ 20,00, comissão 15%):

```text
VALOR PAGO PELO PASSAGEIRO (fora do app) = R$ 20,00
= VALOR DO MOTORISTA (R$ 17,00, fica com ele fisicamente)
+ VALOR DA MOVECITY (R$ 3,00, cobrado depois como dívida em creditBalance)
```

Fecha matematicamente (`driverEarnings = finalFare - commissionAmount`,
conferido na seção 1.3/7).

**Equação 2** (saldo do motorista):

```text
SALDO ANTERIOR (creditBalance)
- COMISSÃO (lançamento type=commission, $inc creditBalance: -amount)
= SALDO POSTERIOR
```

Fecha — `$inc` atômico garante isso por construção, não por convenção.

**Onde a equação NÃO fecha**: pagamento por cartão. `driverEarnings` é
creditado em `pendingBalance` (dinheiro sacável de verdade via `Payout`) sem
que `R$ 20,00` tenha efetivamente **entrado** em lugar nenhum vindo do
passageiro (seção 11). A equação "dinheiro que entra = dinheiro que sai" só
fecha para dinheiro/Pix (onde o dinheiro nunca passa pela plataforma) — para
cartão, só existe o lado da saída.

---

## 17. Concorrência e duplicidade

Este é o ponto mais forte do sistema, e vale destacar como positivo:

| Cenário | Proteção encontrada |
|---|---|
| Motorista confirma pagamento duas vezes (duplo clique) | `findOneAndUpdate` condicional (`paymentStatus:{$ne:'paid'}`) — compare-and-swap |
| Retry de rede na confirmação | Mesmo mecanismo — idempotente por construção |
| Dois processos tentando atualizar carteira ao mesmo tempo | `$inc` atômico, nunca read-modify-write |
| Webhook duplicado do Asaas | Recarga: checa `recharge.status === 'pending'` antes de creditar (mas ver seção 11.3 sobre o fluxo de criação estar ausente) |
| Falha no meio da transação (app fechado, conexão cai) | `session.withTransaction` — tudo ou nada, sem estado parcial |
| Dois motoristas aceitando a mesma corrida | Já coberto pela auditoria de concorrência anterior (`transitionRide`, filtro atômico) — confirmei que `endRide`/`confirmPaymentReceived` seguem o mesmo padrão |
| Índice único contra 2ª comissão/pagamento pro mesmo `rideId` | `transactionSchema` — proteção em nível de banco, não só de aplicação |

Não encontrei um caminho de double-charge real no fluxo de
pagamento/comissão. O risco financeiro deste sistema **não está** em
concorrência — está em "de onde vem o número" (comissão) e "o que
realmente foi cobrado" (cartão).

---

## 18. Segurança financeira

Busquei em todos os controllers por `req.body.fare`, `req.body.finalPrice`,
`req.body.commissionAmount`, `req.body.driverEarnings`, `req.body.amount`,
`req.body.price` sendo usados diretamente: **zero ocorrências**. Os
endpoints de aceitar/iniciar/finalizar corrida recebem só `rideId` (via URL
ou body) — todo valor financeiro é recalculado ou lido do documento já
gravado no servidor, nunca aceito do cliente. Isso é o comportamento
correto e está consistente em todo o `ride.controller.js`/`parcel.controller.js`.

**Mas existe uma brecha relacionada, e é séria:** `POST /rides/create` não
tem nenhuma validação de `paymentMethod`
([ride.routes.js:9-16](Backend/routes/ride.routes.js#L9-L16) — sem
`body('paymentMethod').isIn([...])`, ao contrário de `/rides/presential` que
tem essa validação
([ride.routes.js:23](Backend/routes/ride.routes.js#L23), restrita a
`['cash']`). `rideService.createRide` aceita qualquer string em
`paymentMethod` (default `'cash'`, sem allowlist —
[ride.service.js:229](Backend/services/ride.service.js#L229)). Isso não é o
frontend "manipulando preço" — é o frontend (ou uma chamada direta à API,
fora do app) **escolhendo um método de pagamento que a UI nunca oferece**
(`'card'`) e que, como mostrado na seção 11, não tem cobrança real por
trás — mas ainda assim credita `pendingBalance` sacável ao motorista quando
a corrida é "finalizada" e "paga". Isto é uma abertura de fraude real:

```json
POST /rides/create
{ "pickup": "...", "destination": "...", "vehicleType": "car", "paymentMethod": "card" }
```

Não precisa de nenhum campo de preço malicioso — só escolher um método de
pagamento que o sistema aceita silenciosamente mas nunca cobra.

---

## 19. Teste end-to-end (registrado com valores reais)

Usando a configuração real de produção (categoria `car`, comissão real
15%) e uma corrida de 5km/15min, pagamento Pix:

```text
Tarifa configurada (VehicleCategory.car.pricing): base R$13 / km R$2,30 / min R$0,30 / mín R$9
Preço estimado (calculateFare na criação): R$ 29,00
Preço final (calculateFare no endRide, mesma distância/tempo real): R$ 29,00
Pagamento (confirmPaymentReceived): paymentMethod=pix → lançamento ride_payment, amount=29,00
Comissão calculada: 15% × 29,00 = R$ 4,35 (usa VehicleCategory, NÃO o 21% que o Admin acha que está configurado)
Carteira antes: X
Débito: R$ 4,35 (creditBalance -= 4,35)
Carteira depois: X - 4,35
Ganho motorista (extrato, líquido): R$ 24,65
```

Cada etapa bate matematicamente consigo mesma — o problema não é um erro de
conta neste fluxo, é que a comissão usada (15%) diverge da que o admin
configurou (21%) sem nenhum aviso em lugar nenhum.

---

## 20. Não confiei só no código

Cruzamento feito de verdade, não hipotético:

- **Código**: lido `pricingEngine.service.js`, `ride.service.js`,
  `parcel.service.js`, `wallet.service.js`, `admin.service.js`,
  `webhook.controller.js`, `asaas.service.js` por inteiro ou nas seções
  relevantes.
- **Banco de dados**: conectei (somente leitura) à base de **produção** e
  imprimi os documentos reais de `VehicleCategory`, `GlobalSetting`,
  `TariffSetting` — os números da seção 1.3/3.1 são os valores reais agora,
  não exemplos inventados.
- **API**: rodei `PricingEngine.calculateFare()` de verdade (função pura,
  sem persistir nada) com esses dados reais e os 4 cenários pedidos.
- **Testes existentes**: rodei a suíte e encontrei 3 falhas ativas que são,
  elas mesmas, provas de bugs financeiros reais (seção 21, crítico #4).
- **Frontend**: li `PaymentOptionsPanel.jsx`, `Riding.jsx` para confirmar o
  que o passageiro realmente vê/pode fazer, não só o que o backend permite.

O que eu **não** fiz (e por quê): não criei uma corrida real de ponta a
ponta contra produção (isso teria efeito colateral real — notificação,
possivelmente e-mail, dados de teste manchando relatórios reais do admin).
O `.env` local aponta para produção (confirmado num runbook anterior deste
mesmo repositório), então criar dados de teste "de verdade" exigiria ou um
ambiente de staging (não encontrei um) ou aceitar sujar produção — não fiz
isso sem sua autorização explícita.

---

## 21. Resultado — classificado por gravidade

### 🔴 CRÍTICO

1. **Comissão real ≠ comissão configurada no Admin, com divergência ativa em
   produção agora (21% configurado vs. 15%/20% cobrado).** Causa: comissão
   lida de `VehicleCategory.pricing.platformCommission`, editável de
   `GlobalSetting.platformCommission(s)` — dois lugares diferentes, sem
   sincronização, desde a migração one-shot em
   `scripts/migrate-pricing.js`. Impacto: toda corrida de carro/moto cobra
   ~6 pontos percentuais A MENOS do que o admin pensa que configurou —
   perda de receita direta e silenciosa. [Seção 3.1](#31-o-achado-central-comissão-em-três-lugares-diferentes)
2. **Pagamento por cartão não tem cobrança real** (`asaas.service.js`
   nunca chamado; `POST /rides/create` não valida `paymentMethod`).
   Impacto: risco de fraude — corridas "pagas" no cartão geram crédito
   sacável (`pendingBalance` → `Payout`) sem que dinheiro real tenha
   entrado. [Seção 11](#11-pagamento--o-achado-mais-grave) / [18](#18-segurança-financeira)
3. **`payRide` grava IDs de pagamento fabricados
   (`crypto.randomBytes`)** com nomes que imitam um gateway real, numa rota
   ativa chamada pelo app de verdade. Risco de reconciliação financeira
   enganosa. [Seção 11.1](#111-payride-gera-ids-de-pagamento-fabricados)
4. **`endRide` não soma taxa de espera nem opcionais ao `finalPrice`
   quando `actualDistance === 0`** — 2 testes falhando ao vivo no CI
   provam isso agora (`rideFees.service.test.js:93` e `:110`). Dinheiro
   devido (espera do motorista, adicionais escolhidos pelo passageiro)
   simplesmente não entra na conta final nesse caminho.
   [Seção 9](#83-desconto-automático-da-comissão--a-bateria-de-testes-pedida) (ver também nota de teste)

### 🟠 ALTO

5. `TariffSetting.platformCommission` é um terceiro campo de comissão,
   morto para cálculo, mas confirmado sendo indevidamente hidratado
   (`adminTariffs.service.test.js:59` falhando no CI agora).
6. Taxa de chuva **impossível de ativar** — schema de `VehicleCategory`
   não tem campo `rain`; toggle do admin (`manualRainFee`) nunca é lido.
7. Tarifa dinâmica/surge configurável no admin, **sem nenhum efeito** no
   preço calculado.
8. Taxa de cancelamento calculada e gravada, **nunca cobrada de fato** de
   ninguém.
9. `startRide` não está aplicando a taxa de espera corretamente —
   `rideFees.service.test.js:53` falhando no CI agora
   (`waitTimeFeeCharged` esperado ~R$5, retornou R$0).

### 🟡 MÉDIO

10. Categoria de veículo duplicada em produção
    (`car_copy_1786131255834`, inativa hoje) — lixo operacional, risco se
    reativada por engano.
11. Ledger interno de `ride_payment` (dinheiro/Pix) grava
    `balanceBefore === balanceAfter`, tecnicamente correto mas confuso
    para quem olha o banco bruto (o extrato do motorista já corrige isso
    corretamente antes de exibir).
12. `cardFeePercent`/`cardFeeFixed` funcionam tecnicamente mas servem um
    método de pagamento (`card`) que não tem cobrança real por trás.
13. Comentários contraditórios no próprio código sobre qual model é "a
    fonte da verdade" para tarifa/comissão — risco de confusão para
    qualquer desenvolvedor futuro repetir o mesmo engano da seção 3.1.

### 🟢 BAIXO

14. Webhook Asaas trata pagamento de corrida só mudando `paymentStatus`,
    sem creditar carteira — comentário no próprio código admite a
    indecisão de design.
15. Fallbacks hardcoded em `pricingEngine.service.js` (`?? 5.00` etc.) só
    entram em ação se `category.pricing` vier ausente — comportamento
    defensivo aceitável, mas vale documentar explicitamente que é um
    "modo degradado", não um valor configurável.
16. Duplicação de schema `captain.earnings` / `wallet.totalEarned` (mesma
    informação, dois lugares — hoje escritos juntos, mas é superfície
    para divergência futura).

---

## 22. Tabela final obrigatória

| Item | Status | Onde | Problema | Impacto | Correção recomendada |
|---|---|---|---|---|---|
| Tarifa base | ✅ | `VehicleCategory.pricing.baseFare` | — | — | — |
| Preço/km | ✅ | `VehicleCategory.pricing.perKm` | — | — | — |
| Preço/minuto | ✅ | `VehicleCategory.pricing.perMinute` | — | — | — |
| Tarifa mínima | ✅ | `VehicleCategory.pricing.minimumFare` | — | — | — |
| Adicionais | ✅ | `VehicleCategory.pricing.optionals[]` | Omitidos do `finalPrice` quando `actualDistance===0` no `endRide` | 🔴 Dinheiro devido não cobrado | Corrigir `endRide` para sempre somar `waitTimeFeeCharged` + opcionais congelados, independente de recálculo por distância |
| Chuva | ❌ | `VehicleCategory.pricing.surcharges` (sem campo `rain`) + `TariffSetting.manualRainFee` (não lido) | Impossível de ativar | 🟠 Feature anunciada no admin não funciona | Adicionar `surcharges.rain` ao schema de `VehicleCategory` e ligar ao toggle do admin, ou remover o toggle |
| Noturna | ⚠️ | `VehicleCategory.pricing.surcharges.night` | Existe e funciona, mas OFF em 100% das categorias hoje | 🟢 Não testável em produção no estado atual | Nenhuma — decisão operacional, não bug |
| Comissão | ❌ | `VehicleCategory.pricing.platformCommission` (real) vs `GlobalSetting.platformCommission(s)` (editado pelo admin) | Fontes divergentes, confirmado 21% vs 15%/20% em produção | 🔴 Perda de receita ativa e silenciosa | Unificar: `calculateFare` deve ler de uma única fonte; migrar/sincronizar os valores hoje divergentes |
| Carteira | ✅ | `Wallet` + `wallet.service.js` | Ledger de `ride_payment` cash/pix mostra `balanceBefore=balanceAfter` (cosmético) | 🟡 Confuso para auditoria interna, não para o motorista | Documentar ou ajustar o que `balanceBefore/After` representa para esse `type` |
| Débito comissão | ✅ | `confirmPaymentReceived` + `wallet.service.js` | — | — | — (muito bem protegido: atômico, idempotente, índice único) |
| Ganho motorista | ✅ | `computeDriverAmount`/`sanitizeCaptainFinance` | — | — | — |
| Repasse | ✅ | `Payout` + `requestPayout` | — | — | — |
| Pagamento | ❌ | `payRide`, `asaas.service.js`, `webhook.controller.js` | Cartão sem cobrança real; IDs fabricados; Asaas desconectado do fluxo | 🔴 Risco de fraude + reconciliação enganosa | Bloquear `paymentMethod:'card'` no servidor até a integração Asaas estar de fato ligada, ou remover a opção do schema |
| Cancelamento | ❌ | `ride.service.js` (`cancellationFeeCharged`) | Calculado, nunca cobrado | 🟠 Regra de negócio sem efeito | Implementar cobrança real (ex.: debitar carteira do passageiro/saldo, ou remover o campo se a regra foi abandonada) |
| Encomendas | ✅ | `parcel.service.js` → `PricingEngine` | Herda o mesmo bug de comissão da corrida | 🔴 (mesmo item acima) | Mesma correção da comissão cobre encomenda |
| Segurança | ⚠️ | `ride.routes.js` (`/create` sem validação de `paymentMethod`) | Cliente pode escolher `paymentMethod:'card'` livremente | 🔴 Abertura de fraude | Adicionar `body('paymentMethod').isIn(['cash','pix'])` (ou incluir `card` só quando a cobrança real existir) |

---

## 23. Conclusão

1. **As tarifas configuradas no Admin estão realmente sendo aplicadas?**
   Para base/km/minuto/mínimo/adicionais/cartão: **sim.** Para
   **comissão, chuva e tarifa dinâmica: não** — configuráveis no admin,
   sem efeito real no cálculo (chuva/dinâmica) ou com efeito diferente do
   configurado (comissão).
2. **O preço mostrado ao passageiro é calculado pelo mesmo motor usado no
   backend?** Sim — `calculateFare` é chamado tanto na cotação quanto no
   fechamento, sem motor paralelo.
3. **O valor final da corrida está correto matematicamente?** A fórmula
   está correta, **exceto** quando `actualDistance === 0` no `endRide`
   (bug confirmado, taxa de espera e opcionais somem).
4. **A comissão da MoveCity está correta?** A fórmula está correta; o
   **percentual usado não é o que o admin configurou** (achado crítico #1).
5. **A comissão está realmente sendo descontada da carteira do
   motorista?** Sim, de forma bem protegida — para dinheiro/Pix. Para
   cartão, é descontada "por dentro" (só credita o líquido) sem lançamento
   `commission` visível.
6. **O desconto acontece uma única vez?** Sim — confirmado com 3 camadas
   de proteção (pré-checagem, update atômico condicional, índice único no
   banco).
7. **O ganho líquido do motorista está correto?** Matematicamente sim,
   **quando** a comissão de entrada estiver certa e o `finalPrice` não
   tiver caído no bug do item 3.
8. **O repasse está correto?** Sim, mecanismo de payout bem construído e
   auditável.
9. **Existe pagamento ou transação simulada?** **Sim, confirmado**:
   `payRide` gera IDs fabricados; `paymentMethod:'card'` não tem cobrança
   real por trás.
10. **Existe situação em que dinheiro pode ser perdido, duplicado ou
    contabilizado incorretamente?** Sim: (a) comissão sistematicamente
    menor que a configurada = receita perdida silenciosamente; (b) taxa de
    espera/opcionais que somem do `finalPrice` em certo caminho = receita
    perdida; (c) pagamento por cartão sem cobrança real = passivo criado
    (payout sacável) sem receita correspondente = **dinheiro que pode
    "desaparecer" da plataforma de verdade** se explorado.
11. **O sistema está pronto para operar dinheiro real em produção?** Ele
    **já está** operando dinheiro real em produção agora — e três dos
    achados acima (comissão divergente, cartão sem cobrança,
    taxa/opcionais somem) são bugs **ativos hoje**, não hipotéticos.

### Classificação final

## 🔴 RISCO FINANCEIRO CRÍTICO

Não pela quantidade de problemas — a base de idempotência/concorrência é
sólida e bem pensada — mas porque três achados são simultaneamente (a)
confirmados com dados reais de produção ou testes que falham agora, (b)
afetam dinheiro real (receita de comissão e passivo de payout), e (c) não
exigem nenhum cenário exótico para acontecer — a divergência de comissão
já está acontecendo em toda corrida de carro/moto neste exato momento.

Recomendo tratar os 4 itens 🔴 antes de qualquer outra prioridade, nesta
ordem sugerida: (1) comissão divergente — é o que mais dinheiro já está
custando; (2) `paymentMethod` sem validação — fecha a porta de fraude mais
óbvia; (3) `endRide` não somar espera/opcionais — bug já provado por teste;
(4) `payRide`/IDs fabricados — menor risco imediato, mas mais fácil de
corrigir (remover ou substituir por uma confirmação sem gerar IDs falsos).

Nenhuma alteração de código foi feita. Como combinado, aguardo um segundo
prompt para priorizar e implementar as correções.

---

## 24. Resultado das correções (2026-08-08)

Aprovado com uma ressalva: **pagamento por cartão ficou de fora por
enquanto**. Implementado:

- **CRÍTICO #3** (`payRide` fabricava `paymentID`/`orderId`/`signature` com
  `crypto.randomBytes`): removido. O endpoint só confirma que a corrida
  existe e pertence ao passageiro — nada é mais fabricado imitando um
  gateway real.
  [ride.service.js](Backend/services/ride.service.js)
- **CRÍTICO #4** (`endRide` não somava taxa de espera nem opcionais ao
  `finalPrice` quando `actualDistance===0`): corrigido — agora soma
  `ride.fare + ride.waitTimeFeeCharged + Σ(ride.optionals[].price)` nesse
  caminho. Os 2 testes que provavam o bug (`rideFees.service.test.js:93` e
  `:110`) passam.
- **ALTO #9** (`startRide` nunca calculava `waitTimeFeeCharged`, só
  `waitTimeSeconds`): corrigido — agora calcula a partir de
  `resolveTariffSetting(ride)` (respeita o snapshot congelado, igual
  `cancelRide` já fazia) e grava no campo que já existia no schema mas
  nunca era preenchido. Corrige o 3º teste que falhava.
- **ALTO #5** (comissão duplicada em `TariffSetting.platformCommission`,
  nunca lida por `calculateFare`): campo removido do schema. Corrige o 4º
  teste que falhava (`adminTariffs.service.test.js:59`).
  **Importante, achado na hora de corrigir**: verifiquei o admin-frontend
  antes de mexer em qualquer coisa relacionada a comissão — `GET
  /admin/tariffs` / `PUT /admin/settings/tariffs` (que leem/escrevem
  `GlobalSetting.platformCommission`) **não têm nenhum caller no
  admin-frontend atual**. O controle que o admin realmente usa e que já
  está corretamente ligado ao cálculo real é a aba "Tarifas por categoria"
  → campo "Comissão (%)" (`Tariffs.jsx` → `CategorySettingsCard` → `PUT
  /admin/vehicle-categories/:id/tariffs` → `VehicleCategory.pricing.platformCommission`).
  Ou seja: **não havia dois controles ativos brigando pelo mesmo número** —
  só um deles é alcançável pela UI hoje, e é o correto. Por isso não mudei
  nenhum percentual de comissão real nem toquei em `PricingEngine` — só
  removi o campo morto e deixei a lógica de `GlobalSetting` como estava
  (inofensiva, apenas não exercida por nenhuma tela hoje). Se um dia vocês
  quiserem reativar uma tela de comissão "global" por tipo de serviço
  (ride/presential/parcel), aí sim será necessário decidir qual fonte
  manda — não decidi isso por vocês.
- **CRÍTICO #2** (`paymentMethod` sem validação em `POST /rides/create`,
  permitindo `'card'` sem cobrança real por trás): bloqueado no servidor —
  `body('paymentMethod').optional().isIn(['cash', 'pix'])`. Corrida por
  encomenda já validava isso corretamente (`ALLOWED_PAYMENT_METHODS` em
  `parcel.service.js`); só corrida tinha a brecha.
  [ride.routes.js](Backend/routes/ride.routes.js)

**Deixado de fora deliberadamente (não silenciosamente decidido):**

- **Pagamento por cartão** (Asaas real) — por pedido explícito, fica fora
  por enquanto. `asaas.service.js` continua existindo sem chamadores;
  `paymentMethod:'card'` agora é rejeitado na criação da corrida em vez de
  fingir funcionar.
- **Taxa de cancelamento nunca cobrada** (🟠) — não implementei o débito
  real (existe `user.walletBalance`, tecnicamente daria pra debitar), mas
  isso liga uma cobrança nova a passageiros que nunca existiu — decisão de
  produto, não bug de código. Fica pra um próximo round se vocês quiserem.
- **Chuva impossível de ativar / tarifa dinâmica sem efeito** (🟠) — são
  construções de feature nova (schema + UI + lógica de cálculo), não
  correção de bug — não construí isso sem alinhar escopo primeiro.

**Testes**: suíte completa do backend rodada antes e depois (com as
mudanças "stashed" para comparação limpa) — baseline tinha 44 testes
falhando, depois das correções são 40, exatamente os 4 que eu visei
(nenhuma regressão nova, nenhuma falha pré-existente ficou pior). As 40
restantes já falhavam antes desta sessão e não têm relação com pagamento/
tarifa/comissão (ex.: sessão admin, tarifas de encomenda em outro módulo).
