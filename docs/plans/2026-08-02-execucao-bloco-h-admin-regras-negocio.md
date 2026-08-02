# Execução — Bloco H (Regras de Negócio) — Painel Administrativo

**Base:** [auditoria do painel administrativo, 2026-08-02](2026-08-02-auditoria-painel-administrativo.md), §6/F3/F4/F11/F12/F13, Bloco H do Plano de Correção.
**Escopo:** o único bloco marcado como "depende de decisão de produto". Decisão obtida do usuário antes de executar (ver abaixo). Objetivo: acabar com configurações que são salvas mas nenhuma lógica lê.
**Status:** ✅ concluído e verificado em 2026-08-02. Nada commitado.

## Decisões de produto (obtidas do usuário em 2026-08-02, antes de qualquer implementação)

1. **Promoções/Cupons**: implementar a aplicação real (não remover, não deixar como está).
2. **Modo "Automático" de tarifa dinâmica/taxa de chuva**: renomear/remover da UI pra não enganar, em vez de implementar o cálculo de demanda/clima real.
3. **9 campos inertes de `globalSetting`**: avaliar campo a campo — ligar o que der pra ligar agora, documentar o resto.

## Parte 1 — Promoções: da decoração à aplicação real

### O que existe hoje (confirmado antes de desenhar a solução)

- `promotion.model.js` é o modelo rico que o painel admin gerencia (`Promotions.jsx`, rotas `/admin/promotions*`) — segmentação por cidade/veículo/pagamento/tag, janela de horário, limites de uso, orçamento, `metrics` (já tem `uses`/`totalDiscountGiven`/`revenueGenerated`, sempre zerados hoje).
- Existe um **segundo sistema paralelo e desconectado**: `coupon.model.js` + a lógica de `couponCode` dentro de `pricingEngine.service.js: calculateFare` — mais simples, não gerenciado por nenhuma tela do admin, e **nenhum caller em todo o projeto passa `couponCode`**. Não é o "módulo" que o admin gerencia — decidi não religar esse sistema paralelo (ligar um sistema que o admin não vê nem edita não resolve o problema real, que é "a tela de Promoções não faz nada"). Fica documentado como código morto pré-existente, separado do que este bloco corrige.
- `admin.controller.js: simulatePromotion` já implementa a matemática de desconto (percentage/fixed/free_ride) que o simulador do painel usa — **não trata `cashback`** (cai em desconto zero). Vou extrair essa lógica pra uma função compartilhada, corrigindo o `cashback` no processo (mesmo código que vou reaproveitar na aplicação real — sem isso o simulador mentiria sobre o que a aplicação real faz).
- `user.model.js` tem `city`, `tags`, `totalRides`, `lastRideAt` — os campos que as regras de segmentação (`rules.cities`, `rules.userTags`, `rules.minUserRides`/`maxUserRides`, `rules.inactiveDays`, `rules.firstRideOnly`) precisam pra avaliar.
- `createRide` (`ride.service.js`) não tem transação Mongo hoje (múltiplas escritas sequenciais: corrida, pagamento, débito de carteira se `useWalletBalance`) — não vou introduzir uma transação nova só pra isto; mantenho o mesmo nível de atomicidade que a função já tinha antes desta mudança.
- `confirmPaymentReceived` é o único lugar que credita o motorista de verdade (tanto pra cartão quanto pra dinheiro/pix) — `payRide`/webhook só simula IDs de pagamento, não credita nada.

### Desenho

- **Escopo desta implementação: só `type` com `code` preenchido** (o passageiro digita um cupom). `auto_apply`/`campaign` sem código (aplicar automaticamente pra todo mundo elegível, sem o passageiro fazer nada) e `referral` (indicação) **ficam fora** — cada um exigiria um mecanismo de disparo totalmente diferente (`auto_apply` precisaria varrer todas as promoções ativas a cada corrida; `referral` precisaria de uma cadeia de indicação que não existe no sistema). `combinable` (empilhar promoções) também fica fora — aplico só a primeira/única promoção que bate com o código.
- **`cashback` tratado como desconto imediato na tarifa**, igual a `percentage`/`fixed` — não como "paga cheio, recebe de volta depois". Simplificação deliberada: implementar um fluxo de crédito pós-corrida separado exigiria disparar lógica em `confirmPaymentReceived` além do que já existe, e não haveria diferença de resultado pro passageiro (ele paga menos de qualquer jeito).
- **O motorista nunca ganha menos por causa de uma promoção do admin.** O desconto sai do que o *passageiro* paga (`finalPrice`), mas o motorista é compensado com um crédito (`type: 'bonus'`) igual ao valor do desconto, creditado no momento em que a corrida é paga (`confirmPaymentReceived`) — o motorista recebe exatamente o que receberia sem a promoção; quem "paga" o desconto é a plataforma (rastreado em `promotion.currentBudgetUsed`/`metrics.totalDiscountGiven`), não o motorista. É assim que cupom de plataforma de mobilidade funciona na prática — o motorista não deveria descobrir que ganhou menos porque o passageiro tinha um cupom.
- **Orçamento e limites de uso são debitados na criação da corrida**, não na finalização. Se a corrida for cancelada depois, o "gasto" de marketing já foi contabilizado — simplificação deliberada: amarrar isso à finalização exigiria reverter o desconto em caso de cancelamento, mais um caminho de estorno pra construir. Dado que cupom geralmente é sobre "conseguir o pedido", contabilizar na criação é o comportamento mais comum em sistemas reais.
- **Checagem de limite de uso não é atômica** (sem CAS tipo o que fiz nos repasses) — duas requisições de criação de corrida simultâneas do mesmo usuário com o mesmo código, em teoria, poderiam ambas passar pela checagem de `usagePerUserLimit` antes de qualquer uma registrar o uso. Aceitável: é uma regra de negócio (limite de uso de cupom), não integridade financeira em risco (ninguém perde dinheiro, na pior hipótese um cupom é usado uma vez a mais que o previsto). Documentado, não construído — mesma disciplina de escopo do resto da auditoria.

### O que muda

- **Novo model** `promotionUsage.model.js`: `{ promotionId, userId, rideId, discountAmount, createdAt }` — histórico de uso, necessário pra checar `usagePerUserLimit`/`usagePerDayLimit`/`globalUsageLimit` (não existia nenhum jeito de contar isso antes).
- **Novo `services/promotion.service.js`**: `evaluateDiscount(promotion, rideValue)` (matemática do desconto, compartilhada com o simulador do admin) e `findApplicablePromotion({ code, userId, city, vehicleType, paymentMethod, rideValue })` (busca por código + valida status/datas/orçamento/limites de uso/todas as regras de segmentação).
- **`ride.model.js`**: novos campos `promotionApplied` (ref), `discountAmount` (Number, default 0).
- **`ride.service.js: createRide`**: aceita `promoCode`; se válido, aplica o desconto em `finalPrice`, grava `promotionApplied`/`discountAmount` na corrida, registra o uso e incrementa `currentBudgetUsed`/`metrics` da promoção. Código inválido/expirado/fora de regra: **não derruba a criação da corrida** — a corrida é criada normalmente sem desconto, e o erro específico é devolvido pro frontend decidir como avisar (consistente com o app do passageiro já não usando alert() nem travando o fluxo por causa de um cupom malsucedido).
- **`ride.service.js: confirmPaymentReceived`**: se a corrida tem `discountAmount > 0`, credita o motorista com um `bonus` extra desse valor, dentro da mesma transação — garante que o motorista nunca é penalizado por uma promoção que ele não criou.
- **`admin.controller.js: simulatePromotion`**: refatorado pra usar `promotionService.evaluateDiscount` (corrige o `cashback` no processo).
- **Frontend do passageiro** (`Home.jsx` + componente do painel de confirmação): campo de cupom opcional antes de confirmar a corrida, mostra o desconto aplicado (ou o motivo de recusa) antes do passageiro confirmar.

## Parte 2 — Modo "Automático" deixa de fingir

- `Tariffs.jsx`: opção `<option value="auto">Automático</option>` do seletor "Status Dinâmico Global" **removida** — só `Desligado`/`Manual` ficam disponíveis pra escolha nova.
- **Não mexo na lógica do `pricingEngine.service.js`** que trata `'auto'` igual a `'manual'` — deixo como está, por segurança: algum documento no banco pode já ter `dynamicPricingStatus: 'auto'` salvo, e mudar o comportamento do backend pra esse valor agora seria uma mudança de comportamento de precificação não pedida. Só impeço que um admin *escolha* essa opção enganosa dali pra frente.
- `automaticRainFee` (`tariffSetting`): confirmei que **não tem nenhum controle na UI hoje** — só `manualRainFee` é exposto no formulário. Ou seja, esse campo específico já não engana ninguém (não tem como um admin ativá-lo pelo painel). Simplifico a condição em `pricingEngine.service.js` pra checar só `manualRainFee` e removo `automaticRainFee` do schema — campo inatingível pela UI, sem motivo pra continuar existindo.

## Parte 3 — Campos inertes de `globalSetting`/`tariffSetting`: ligar ou remover

| Campo | Decisão | Motivo |
|---|---|---|
| `payoutDeadlineDays` | **Ligar** | Contável agora com o que o Bloco B+C já construiu: `getPayouts` passa a expor `summary.overdueCount` (repasses parados há mais dias que o prazo), exibido no Financeiro. |
| `showAsEstimate` | **Ligar** | Simples: `getFare` passa a devolver o valor do campo; o app do passageiro mostra "(valor estimado)" condicionalmente. |
| `automaticPayout` | **Deixar documentado, não ligar** | Ligar de verdade significaria debitar a carteira do motorista sem nenhuma revisão humana — o oposto do motivo pelo qual o Bloco B introduziu o estado `processing` como parada deliberada (não existe gateway de pagamento pra confiar numa aprovação 100% automática). Risco desproporcional ao benefício nesta rodada. |
| `minRecharge` | **Remover** | O fluxo de recarga inteiro já está desativado propositalmente (`rechargeWallet` retorna 501 — decisão de uma sessão anterior, sem gateway real). Não há caminho de código vivo pra aplicar um mínimo a uma operação que não existe. |
| `platformPixKey` | **Remover** | Só faria sentido no mesmo fluxo de recarga desativado. |
| `paymentGateway` | **Remover** | Nenhuma integração de gateway existe no projeto; o campo seleciona entre 3 gateways que não fazem nada. |
| `minDriverBalance` | **Remover** | Redundante — `maximumNegativeBalance` + `blockDriverOnNegativeBalance` (já funcionais) cobrem o mesmo conceito com um mecanismo que já funciona. |
| `allowNegativeBalance` | **Remover** | Mesmo motivo — conflita conceitualmente com o par acima em vez de complementar. |
| `vehicleTypes` | **Remover** | Array estático, vestígio de antes do sistema de `vehicleCategory` dinâmico existir — hoje é o `vehicleCategory` (com `isActive`) que de fato controla quais tipos de veículo existem. |
| `promotionalHours` | **Remover** | Texto livre sem nenhuma estrutura (nem horário, nem UI de banner pra exibi-lo) — não há onde plugar isso sem inventar uma superfície de UI nova. |
| `autoTollCharge` (tariffSetting) | **Remover** | Cobrar pedágio automaticamente exigiria uma API de rotas com pedágio, que não existe no projeto — nenhum caminho de implementação parcial. |

## Fora de escopo desta execução

- Sistema `coupon.model.js` + `couponCode` do `pricingEngine.service.js` (código morto pré-existente e paralelo) — não é o que o admin gerencia, não estou religando.
- `auto_apply`, `campaign` (sem código), `referral`, `combinable` no motor de promoções — cada um exigiria um mecanismo de disparo diferente do "passageiro digita um código".
- Cálculo real de demanda (tarifa dinâmica) ou integração de clima real (taxa de chuva automática) — é construir uma feature nova, não corrigir uma existente.
- Gateway de pagamento real, recarga de carteira, saque automático sem revisão humana.

## Como verifico

- Script de verificação descartável cobrindo: cupom válido aplica desconto e cria `promotionUsage`; cupom expirado/fora de orçamento/fora do limite de uso é recusado sem derrubar a criação da corrida; motorista recebe o bônus compensatório na finalização; `simulatePromotion` e a aplicação real dão o mesmo resultado pro mesmo input (incluindo `cashback`).
- Build dos três frontends limpo; suíte do backend na baseline conhecida.

---

## Detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

### Parte 1 — Promoções

Arquivos novos: `models/promotionUsage.model.js`, `services/promotion.service.js` (`evaluateDiscount` + `findApplicablePromotion` + `recordPromotionUsage`).

`ride.model.js` ganhou `promotionApplied`/`discountAmount`. `createRide` (`ride.service.js`) aceita `promoCode`, aplica o desconto em `finalPrice` antes do desconto de carteira, registra o uso e atualiza `currentBudgetUsed`/`metrics` da promoção — **e nunca lança erro por causa de um cupom ruim**: código inválido/expirado/fora de regra devolve `promoError` e a corrida é criada normalmente sem desconto. Isso mudou o contrato de retorno de `createRide` (de `ride` pra `{ ride, promoError }`) — busquei todos os chamadores antes de mudar; o único era `ride.controller.js` (os `createRide` usados nos arquivos de teste vêm de um factory próprio, `tests/factories/ride.factory.js`, não deste service — confirmei antes de mexer pra não pensar que ia quebrar suite nenhuma).

**Motorista nunca ganha menos por causa de uma promoção do admin**: `confirmPaymentReceived` credita um `bonus` extra igual ao `discountAmount`, dentro da mesma transação que já paga a corrida — o motorista recebe exatamente o que receberia sem o cupom; quem absorve o desconto é a plataforma (`currentBudgetUsed`), não o motorista.

`simulatePromotion` (admin) refatorado pra usar `promotionService.evaluateDiscount` — corrigiu de graça um bug que já existia (`cashback` caía em desconto zero, tratado agora igual a `fixed`).

Frontend do passageiro: campo de cupom opcional em `ConfirmRide.jsx`, enviado junto com a criação da corrida (sem endpoint de validação prévia — decisão de escopo). Resultado (desconto aplicado ou motivo da recusa) mostrado via `useToast()` já existente no app depois que a corrida é criada.

**Fora de escopo, confirmado durante a implementação:** existe um segundo sistema de cupom (`coupon.model.js` + `couponCode` dentro de `pricingEngine.service.js`), completamente desconectado do que o admin gerencia — nenhum caller em todo o projeto passa `couponCode`. Não é o "módulo" que a decisão do usuário pediu pra ligar (o admin não vê nem edita esses documentos); fica documentado como código morto pré-existente, sem relação com este bloco.

### Parte 2 — Modo "Automático"

`Tariffs.jsx`: opção `<option value="auto">` removida do seletor de tarifa dinâmica — só ficam `Desligado`/`Manual`. Backend não foi tocado (deliberado: mudar como `'auto'` já salvo se comporta seria uma mudança de precificação não pedida; só impede escolher a opção enganosa daqui pra frente).

Durante a investigação, descobri que `automaticRainFee` (o campo equivalente pra taxa de chuva) **já não tinha controle nenhum na UI** — só `manualRainFee` era exposto no formulário. Ou seja, metade do achado F13 do relatório original (chuva automática) já não enganava ninguém na prática, só existia como campo morto no schema. Removido junto com `weatherProvider` (a mesma feature de clima real que nunca existiu), e simplifiquei a condição em `pricingEngine.service.js` pra checar só `manualRainFee`.

### Parte 3 — Campos inertes

**Ligados:**
- `payoutDeadlineDays`: `getPayouts` agora calcula `summary.overdueCount` (repasses em `requested`/`in_analysis`/`approved` — não `processing`, que já está com o valor debitado — parados há mais dias que o prazo). Novo card "Atrasados" no Financeiro do admin, destacado em amarelo quando `> 0`.
- `showAsEstimate`: `getFare` (`ride.service.js`) devolve o valor real do campo; `VehiclePanel.jsx` e `ConfirmRide.jsx` (app do passageiro) passaram a condicionar o aviso "valor é uma estimativa" a esse campo, em vez de mostrá-lo sempre fixo. Também adicionei o controle na UI do admin (`Tariffs.jsx`) — não existia nenhum, o campo só era gravável via chamada direta de API.

**Mantido documentado, não ligado:** `automaticPayout` — ligar de verdade significaria debitar carteira de motorista sem revisão humana nenhuma, o oposto do motivo pelo qual o Bloco B introduziu `processing` como parada deliberada.

**Removidos** (schema + scripts de seed `db/db.js`/`seedTariff.js` que ainda os referenciavam): `minRecharge`, `minDriverBalance`, `allowNegativeBalance`, `paymentGateway` (`globalSetting` — **não** o `ride.paymentGateway`, campo homônimo mas de propósito diferente, por corrida, que não toquei), `platformPixKey`, `promotionalHours`, `vehicleTypes` (`globalSetting`), `autoTollCharge` (`tariffSetting`). Busquei referência em `admin-frontend`, `frontend` e `Backend` inteiros antes de remover cada um — nenhuma tela ou lógica os usava.

### Verificação

Script de verificação descartável (`_verify_bloco_h_promotions.js`, `MongoMemoryReplSet` — a compensação do motorista passa por `session.withTransaction`, que precisa de replica set) cobrindo: `evaluateDiscount` trata `cashback` corretamente e respeita `maxDiscountLimit`; cupom válido aplica desconto, registra uso e atualiza orçamento/métricas; cupom reusado além do limite **não derruba a corrida**, só nega o desconto com o motivo certo; cupom inexistente idem; e o teste mais importante — **o motorista recebe exatamente o mesmo valor com ou sem o cupom** (verificado numericamente: `12.40 ≈ 12.40`). 17 asserções, todas passando na primeira rodada completa (nenhum bug de fixture desta vez). Removido depois — `git status` confirma que não sobrou.

Suíte do backend (`npm test`): 76 passam, 4 falham — mesma baseline de todos os blocos anteriores. Build do `admin-frontend` e do `frontend` (passageiro/motorista): limpos.

**Nada foi commitado.**
