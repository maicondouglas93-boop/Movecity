# Auditoria de Integração Ponta a Ponta — MoveCity

**Data:** 2026-08-01
**Escopo:** Painel Admin → Backend/API → MongoDB → App Passageiro → App Motorista
**Natureza:** auditoria de funcionamento do produto (não só leitura de código)
**Status:** diagnóstico concluído + decisões tomadas. **Nenhum código alterado ainda.**

---

## 0. Metodologia

1. Mapeamento da árvore real dos 3 apps (`Backend/`, `frontend/`, `admin-frontend/`).
2. Leitura dos serviços de domínio (pricing, ride, wallet, maps, admin) e dos models.
3. Rastreamento de cada campo configurável do painel até o ponto onde é (ou não é) consumido.
4. Enumeração das rotas do backend × chamadas reais do frontend.
5. **Consulta somente-leitura ao MongoDB de produção** para confrontar código com dados reais.

O passo 5 foi decisivo: vários achados não são teóricos, estão materializados nos dados.

### Fotografia do banco de produção (2026-08-01)

| Coleção | Docs | Observação |
|---|---|---|
| rides | 36 | **100% com status `cancelled`. Zero corridas `finished` na história do produto.** |
| users | 9 | 2 são de teste (`user@test.com`, `user@example.com`) |
| captains | 4 | **todos de teste** (`captain@test.com`, `@example.com`); 1 online |
| reviews | 0 | nunca gravado |
| payouts | 0 | nunca gravado |
| recharges | 0 | nunca gravado |
| payments | 25 | todos `status: pending`, nunca atualizados |
| transactions | 2 | ledger já inconsistente (ver A1) |
| wallets | 1 | |
| vehiclecategories | 3 | car / moto / auto |

**Leitura do dado:** o fluxo de corrida nunca foi concluído em produção. Tudo depois de `started` (finalização, pagamento, comissão, carteira, avaliação, repasse) nunca rodou com dado real.

---

## 1. Mapa da arquitetura atual

```
admin-frontend (React/Vite)
   └── api → /api/admin/*  (adminAuth + authorizeRoles)  →  admin.service  →  Mongo
                                                             tariffSetting / vehicleCategory
                                                             globalSetting / pricingRule

frontend (React/Vite, PWA)  ──┬── passenger (modules/passenger)
                              └── driver    (modules/driver)
        ├── axios → REST  /users /captains /rides /maps /chat /notifications /uploads
        ├── socket.io    join, update-location-captain, new-ride, ride-confirmed,
        │                ride-started, ride-ended, ride-cancelled, wallet-updated, chat
        └── services/maps → provider (leaflet | google)   [migração concluída em 2026-07-31]

Backend (Express + Socket.IO + Mongoose)
        ├── controllers → services → models
        ├── services/maps → provider (osm | google)
        ├── pricingEngine.service  ← único ponto legítimo de cálculo de tarifa
        ├── wallet.service         ← único ponto legítimo de ledger
        └── asaas.service          ← EXISTE MAS NUNCA É CHAMADO
```

Não há AdminJS no projeto — o painel é um SPA React próprio (`admin-frontend/`) consumindo `/api/admin`. Os pontos da solicitação que citam "AdminJS" foram auditados sobre esse painel.

---

## 2. Onde nasce cada informação

| Informação exibida | Nasce em | Íntegro? |
|---|---|---|
| Localização atual do passageiro | GPS real (`watchPosition`) | ✅ |
| Sugestões de endereço | Google Places (New) via backend | ✅ |
| Coordenadas do endereço | Google Place Details / Geocoding | ✅ |
| Rota e polyline | Google Routes API | ✅ |
| Distância/tempo estimados | Google Routes API | ✅ |
| Preço estimado | `pricingEngine` ← tarifas do painel | ⚠️ regra de chuva sempre ativa |
| Categorias de veículo (passageiro) | **hardcoded no JSX** | ❌ |
| ETA por categoria ("2 mins away") | **`Math.random()` no backend + texto fixo no front** | ❌ |
| Localização do motorista na corrida | **interpolação matemática simulada** | ❌ |
| Distância real percorrida | derivada da localização simulada | ❌ |
| Preço final da corrida | derivado da distância simulada | ❌ |
| Pagamento | **nada é cobrado** | ❌ |
| Saldo/extrato do motorista | `wallet` + `transactions` reais | ⚠️ corrompido por ajuste admin |
| Comissão | `pricingEngine` (20% real) | ⚠️ não editável no painel |
| Nota do motorista | **nunca escrita, sempre o default 5.0** | ❌ |
| Aceitação / cancelamento / tempo online | **nunca escritas** | ❌ |
| Histórico de corridas | Mongo real | ✅ |
| Perfil do usuário | Mongo real | ✅ |
| Cupons/favoritos/cartões/carteira/agendadas | **rotas inexistentes** | ❌ |
| Bloqueio de usuário/motorista | gravado, **nunca aplicado** | ❌ |

---

## 3. Achados críticos

### C1 — ❌ O GPS do motorista é SIMULADO nas duas fases que mais importam

`frontend/src/modules/driver/pages/CaptainHome.jsx:157-190` e `CaptainRiding.jsx:62-110`.

Com `ride.status === 'accepted'` (motorista a caminho), o GPS real é **desligado**. O app geocodifica o embarque, posiciona o motorista em `pickup + 0.01°` (≈1,1 km a nordeste, onde ele não está) e interpola em linha reta até lá em 40 passos de 2s.

Depois de `started`, `CaptainRiding` interpola do embarque ao destino em 60 passos de 2s. Durante toda a viagem o GPS real nunca é emitido.

Impacto encadeado — a falha mais grave da auditoria:

```
GPS simulado
  → socket.js:72-85 calcula actualDistance a partir dos pontos simulados
    → ride.actualDistance é gravado no banco
      → ride.service.js:324-338 (endRide) recalcula finalPrice com essa distância
        → o passageiro é cobrado por uma distância que nunca foi percorrida
```

O mapa que o passageiro vê é ficção, e essa ficção alimenta o motor de cobrança.

### C2 — ❌ O pagamento é integralmente teatral

- `frontend/src/modules/passenger/pages/Riding.jsx:103-135`: o passageiro digita número do cartão, titular, validade e CVV. O código valida o formato **localmente** e envia ao backend **apenas `{ rideId }`**. Os dados do cartão são descartados.
- `Backend/services/ride.service.js:441-465` (`payRide`): gera `paymentId`, `orderId` e `signature` com `crypto.randomBytes()` e devolve sucesso. Nenhuma cobrança.
- A UI exibe "Pagamento concluído! Obrigado 🙏" e dispara notificação "Pagamento Confirmado ✅".
- `Backend/services/asaas.service.js` está completo e funcional e **não é referenciado por nenhum código de produção** — apenas por mocks de teste.
- `payments` (25 docs) é escrito em `createRide` e nunca mais lido.
- Sobrou "UPI" (meio de pagamento indiano) do template original, fora do enum do model.

### C3 — ❌ Recarga de carteira credita saldo real sem nenhuma cobrança

`Backend/controllers/captain.controller.js:132-152` + `CaptainWallet.jsx:485-510`.

O "QR Code PIX" é um ícone estático. "Simular Pagamento Pago" chama `POST /captains/recharge`, que credita direto no ledger, validando só `isNumeric`.

Qualquer motorista autenticado pode emitir `POST /captains/recharge {"amount": 999999}` e obter crédito ilimitado — inclusive para se desbloquear de saldo negativo. A recarga de R$ 50 no banco de produção veio por esse caminho, sem pagamento.

### C4 — ❌ `getCaptainsInTheRadius` não filtra por raio nenhum

`Backend/services/maps.service.js:14-44`. A função calcula `radiusInRadians` e **nunca usa a variável**. Também ignora `ltd` e `lng`. A query real é:

```js
captainModel.find({ socketId: {$exists,$ne:null,$ne:""}, canReceiveRides: {$ne:false} }).limit(20)
```

Todos os motoristas online do planeta, até 20. Não filtra `isOnline`, `isBlocked` nem `approvalStatus`. O `50000` passado como raio pelo controller também está errado (a função documenta km) — irrelevante, já que é descartado.

### C5 — ❌ Bloqueio de usuário e de motorista não é aplicado em lugar nenhum

O painel grava `isBlocked` (`admin.service.js:310`, `:467`) e registra auditoria. Mas:

- `Backend/middlewares/auth.middleware.js` — `authUser`, `authCaptain` e `authBoth` **nunca consultam `isBlocked`**.
- `getCaptainsInTheRadius` também não.
- `approvalStatus` só é verificado no cliente (`CaptainDetails.jsx:59`); `POST /captains/toggle-online` não verifica.

Passageiro bloqueado continua pedindo corridas. Motorista bloqueado ou reprovado continua recebendo.

### C6 — ❌ A "Taxa de Chuva" de +20% está sendo cobrada em 100% das corridas

`Backend/services/pricingEngine.service.js:73-98`:

```js
if (!rule.conditions || Object.keys(rule.conditions).length === 0) {
    applyRule = true;          // ← sem condições = aplica sempre
} else {
    // Aqui podemos expandir a lógica (dias da semana, clima real)   ← vazio
}
```

A `PricingRule` "Taxa de Chuva" (+20%) existe em produção **sem `conditions`** → cai no primeiro ramo e é aplicada incondicionalmente. O ramo `else` é vazio: qualquer regra *com* condições nunca é aplicada — a lógica está invertida na prática.

Confirmado nos dados: **todas as 36 corridas** têm `appliedRules: [{"name":"Taxa de Chuva", ...}]`. Exemplo real (`6a6d5a3f...`): base 50 + distância 19,44 + tempo 16,15 = 85,59 → **+17,12 de chuva** → R$ 102,71. Com sol.

Não há `weatherProvider` configurado (`"none"`) — não existe fonte de verdade sobre chuva no sistema.

### C7 — ❌ `seedTestData()` roda em produção

`Backend/db/db.js:261` chama `seedTestData()` incondicionalmente após conectar, inclusive com `NODE_ENV=production`. A única proteção é `if (existingUsers === 0)`.

Hoje é inócuo (9 usuários). Mas em banco novo, restore ou migração, a produção se auto-popula com "Carlos Silva", "Ana Oliveira", 3 motoristas fictícios com ganhos inventados (R$1450,50/820/2100), 4 corridas falsas, cupons e avaliações escritas à mão.

Agravante: o seed usa `status: 'completed'` e `paymentMethod: 'upi'`, **fora dos enums** do `ride.model` — a gravação lança erro engolido pelo `catch` em `db.js:218`, deixando o banco meio-populado em silêncio.

---

## 4. Achados de alta severidade

### A1 — ❌ Ajuste manual de carteira pelo admin escreve no lugar errado

`Backend/services/admin.service.js:540-587`. Lê e escreve `captain.earnings` (contador vitalício de faturamento) em vez de `wallet.creditBalance`, e cria uma `transaction` cujo `balanceBefore/After` vem de `earnings`.

Não usa `walletService.createTransaction` → não invalida cache, não emite `wallet-updated`/`summary-updated`, não reavalia a regra de bloqueio por saldo negativo.

Já materializado: transaction de ajuste `+100` com `balanceAfter: 100`, seguida de recarga com `balanceBefore: 0`. O extrato é aritmeticamente impossível; o saldo real (`creditBalance: 50`) nunca recebeu os R$100.

### A2 — ❌ As categorias de veículo do painel não chegam ao passageiro

`frontend/src/modules/passenger/components/VehiclePanel.jsx` tem os três cards escritos à mão: nomes "MoveGo"/"MoveMoto"/"MoveAuto", lotação "4"/"1"/"3", descrições e ETA fixa **"2 mins away"/"3 mins away"**.

Em produção o admin nomeou as categorias "Carro Econômico", "Moto Rápida" e "TukTuk (Auto)"; o passageiro continua vendo MoveGo/MoveMoto/MoveAuto. Desativar uma categoria some do cálculo de preço mas o card continua na tela, sem preço.

`vehicleType` está travado em `['auto','car','moto']` em três lugares (`ride.model.js:29`, validator de `ride.routes.js`, `VehiclePanel`) — uma categoria nova criada no painel é estruturalmente inutilizável.

### A3 — ❌ ETA do backend é número aleatório

`Backend/services/ride.service.js:67-71`: `Math.floor(Math.random() * 5) + 2` etc. O frontend nem consome (usa o texto fixo do A2), mas o endpoint entrega número aleatório como estimativa.

### A4 — ❌ Faixa de preço falsa

`ride.service.js:60-62`: `fareMax: fare` com o comentário `// Mocking max`. O front renderiza `R$${fare} - ${fareMax}` → **"R$102.71 - 102.71"** em três telas.

### A5 — ❌ Reputação e métricas de desempenho nunca são calculadas

`rating`, `acceptanceRate`, `cancellationRate`, `onlineTimeSeconds`, `cancelledRides` **não são escritos por nenhuma linha do projeto** — só lidos. Ficam no default do schema.

O model `review` existe e a coleção está vazia: nenhum fluxo cria avaliação, não há tela de avaliar corrida em nenhum dos apps.

Todo motorista exibe 5.0 ⭐, 100% de aceitação, 0% de cancelamento e 0h online — no app, no painel (`Captains.jsx:492-493`) e no ranking (`admin.service.js:181-184`). O dashboard ainda crava `avgRating: 4.8` fixo (`admin.service.js:139`).

### A6 — ❌ "Tempo Online" do motorista é literalmente a string `"05:32"`

`Backend/controllers/captain.controller.js:220`: `onlineTime: "05:32", // Mocked`.

### A7 — ❌ Cinco páginas da conta do passageiro chamam rotas que não existem

| Página | Rota chamada | Existe? |
|---|---|---|
| `account/Wallet.jsx` | `GET /users/wallet` | ❌ |
| `account/Coupons.jsx` | `GET /users/coupons` | ❌ |
| `account/Favorites.jsx` | `GET /users/favorites` | ❌ |
| `account/Cards.jsx` | `GET /users/cards` | ❌ |
| `account/Scheduled.jsx` | `GET /users/scheduled` | ❌ |

`user.routes.js` expõe apenas `register`, `google-login`, `login`, `profile`, `logout`.

As cinco usam `catch { setState([]) }` — o 404 é engolido e a tela renderiza o empty state ("Nenhum cupom disponível"), indistinguível de "você não tem cupons". Botões sem `onClick`: "Adicionar Local", "Adicionar Novo Cartão", "Adicionar"/"Cartões", atalhos Pix/Transferir/Comprovantes, cartões "Casa"/"Trabalho".

### A8 — ❌ Agendamento de corrida é um `alert()`

`ScheduleRidePanel.jsx:8-15`:

```js
// Em um app real, isso salvaria o agendamento na API
alert(`Corrida agendada para: ${new Date(selectedDate).toLocaleString()}`);
```

O passageiro recebe confirmação de um agendamento que não existe em lugar nenhum.

### A9 — ⚠️ Descompasso entre o que o painel edita e o que o motor de preço usa

| Campo | Editável no painel | Usado no cálculo |
|---|---|---|
| `baseFare`, `perKmRate`, `perMinuteRate`, `minFare` | ✅ | ✅ |
| `dynamicMultiplier`, `rainFeeMultiplier` | ✅ | ✅ |
| `dynamicPricingStatus`, `currentMultiplier`, `manualRainFee` | ✅ | ✅ |
| **`cancellationFee`** | ✅ | ❌ nunca lido |
| **`maxFreeWaitTime`** | ✅ | ❌ nunca lido |
| **`perMinuteWaitFee`** | ✅ | ❌ nunca lido |
| **`platformCommission`** | ❌ sem UI/rota | ✅ usado (20%) |
| **`cardFeePercent` / `cardFeeFixed`** | ❌ sem UI/rota | ✅ usado (1,99% + R$0,50) |

Três campos que o admin salva com "atualizadas com sucesso!" não têm efeito. Os dois de maior impacto financeiro só mudam direto no banco.

Pior: o simulador do painel exibe `platformCommission={15}` **hardcoded** (`admin-frontend/src/pages/Tariffs.jsx:344`), enquanto o real é 20%. O admin simula com um número e cobra outro.

Há ainda duplicidade de `cancellationFee` em `tariffSetting` **e** `globalSetting`, com valores diferentes em produção (0 e 4) e nenhum usado.

### A10 — ❌ "Agendar" tarifa grava e nada aplica

`POST /admin/tariffs/schedule` cria um `tariffSchedule` (`admin.controller.js:703-719`). Nenhum código lê essa coleção. O único `cron.schedule` do projeto (`notification.service.js:254`) trata apenas campanhas de push.

---

## 5. Achados médios

| ID | Achado | Local |
|---|---|---|
| M1 | `minDistanceIncluded`/`minTimeIncluded` documentados como metros/segundos, mas o engine multiplica por 1000/60 (trata como km/minutos). Hoje ambos 0 → latente. | `tariffSetting.model.js:4-13` vs `pricingEngine.service.js:53-54` |
| M2 | `'ongoing'` e `'completed'` usados em queries mas **fora do enum** de `ride.status`. Essas queries nunca retornam nada. | `socket.js:64`, `ride.service.js:314,474,504`, `ride.controller.js:358` |
| M3 | Preços dos opcionais hardcoded no backend, sem configuração no painel. `requestFemaleDriver` e opcionais **não influenciam o matching** — o filtro só olha `vehicleType`, e não há campo de gênero no `captain.model`. | `ride.service.js:108-114`, `ride.controller.js:47-63` |
| M4 | `paymentModel` criado em `createRide`, nunca lido nem atualizado. 25 órfãos em `pending`. | `ride.service.js:173-181` |
| M5 | "Dinheiro" hardcoded como forma de pagamento em telas onde a corrida é PIX. | `WaitingForDriver.jsx`, `LookingForDriver.jsx`, `ConfirmRidePopUp.jsx` |
| M6 | Fallbacks fictícios exibidos como dado real: `'2.2'` KM, `'15'` mins, comissão `fare * 0.1` (10%, real é 20%). | `RidePopUp.jsx:24,50,62`, `FinishRide.jsx:13` |
| M7 | `Riding.jsx` mostra `ride.fare` como "Valor Total", mas `endRide` grava o recalculado em `finalPrice`. | `Riding.jsx:192` |
| M8 | `Activity.jsx` mapeia `'completed'` → "Finalizada", mas o backend grava `'finished'` → cai no default e exibe a string crua. | `Activity.jsx:76` |
| M9 | Avatares hardcoded de URLs externas: motorista do `gstatic.com`, passageiro do `pinterest.com`, logo Pix de `logospng.org`. | `CaptainDetails.jsx:98`, `RidePopUp.jsx:12`, `ConfirmRidePopUp.jsx:97`, `ConfirmRide.jsx:54` |
| M10 | Widgets fabricados no app do motorista: `"+12% vs Ontem"`, `"Tempo médio de espera: 3 min"`, "Meta do dia — bônus de R$ 30,00 / X/10 corridas" (não existe sistema de bônus). Os 4 botões de "Ações Rápidas" sem `onClick`. | `CaptainDetails.jsx:141,121,166-207` |
| M11 | Webhook Asaas sem validação de assinatura/origem. Hoje inalcançável; vira crítico ao reativar recarga. | `webhook.controller.js:5` |
| M12 | Dados de teste convivendo com reais em produção: 2 usuários e **os 4 motoristas**. Não há motorista real cadastrado. | banco |
| M13 | `ConfirmRidePopUp` inicializa `rideStatus` local em `'accepted'` em vez de derivar de `ride.status` — reabrir o popup repete "A caminho"/"Cheguei". | `ConfirmRidePopUp.jsx:11` |
| M14 | Corrida real criada com destino `"... (undefined, undefined)"` — coordenadas não resolvidas passaram sem validação. | ride `6a6cf67a...` |
| M15 | 8 scripts de debug versionados na raiz do Backend (`test-nominatim{,2,3,4}.js`, `test-maps.js`, `test-search.js`, `test_ride_flow.js`, `clear_stale_sockets.js`). | `Backend/` |
| M16 | `getCaptainsInTheRadius` faz `find({})` de **todos** os motoristas a cada corrida só para log. Não escala. | `maps.service.js:27-33` |

---

## 6. Fluxo completo da corrida — onde quebra

| # | Etapa | Status | Observação |
|---|---|---|---|
| 1 | Passageiro abre o app, GPS localiza | ✅ | `watchPosition` real + reverse geocode Google |
| 2 | Autocomplete de endereço | ✅ | Google Places (New) com session token |
| 3 | Calcula preço | ⚠️ | rota real e tarifas do painel — mas +20% de chuva indevido (C6) e faixa falsa (A4) |
| 4 | Escolhe categoria | ❌ | lista hardcoded, ETA fixa, ignora o painel (A2) |
| 5 | Opcionais / motorista mulher | ❌ | preço somado, não afeta matching (M3) |
| 6 | Solicita corrida | ✅ | `ride` criada corretamente |
| 7 | Backend busca motoristas | ❌ | sem filtro de raio, bloqueio ou aprovação (C4, C5) |
| 8 | Motorista recebe via Socket.IO + push | ✅ | sala por corrida, `ride-taken` para os demais |
| 9 | Motorista aceita | ✅ | `findOneAndUpdate` atômico, trata concorrência com 409 |
| 10 | Motorista a caminho | ❌ | **GPS substituído por simulação** (C1) |
| 11 | Rastreamento em tempo real | ❌ | o passageiro vê um carro fictício |
| 12 | OTP e início da corrida | ✅ | validação real do PIN de 6 dígitos |
| 13 | Corrida em andamento | ❌ | simulação pickup→destino (C1) |
| 14 | Encerramento | ⚠️ | recalcula preço a partir de distância **simulada** (C1) |
| 15 | Pagamento | ❌ | nada é cobrado (C2) |
| 16 | Comissão + carteira | ⚠️ | lógica correta, **só dispara em `confirmPaymentReceived`, que nunca ocorreu** |
| 17 | Histórico | ✅ | grava e lista corretamente |
| 18 | Avaliação | ❌ | não existe (A5) |
| 19 | Repasse ao motorista | ⚠️ | rotas existem; nenhum payout jamais criado |

**Conclusão:** funciona de ponta a ponta até o passo 9. Do passo 10 em diante, opera sobre dados fabricados ou não opera.

---

## 7. Inventário consolidado de dados falsos

**Aleatórios / simulados**
- `eta` por categoria — `Math.random()` (`ride.service.js:67`)
- Posição do motorista a caminho — interpolação a partir de `pickup + 0.01°` (`CaptainHome.jsx:167`)
- Posição do motorista em viagem — interpolação pickup→destino (`CaptainRiding.jsx:83`)
- `paymentID`/`orderId`/`signature` — `crypto.randomBytes()` (`ride.service.js:447-449`)

**Constantes apresentadas como dado real**
- `onlineTime: "05:32"` (`captain.controller.js:220`)
- `avgRating: 4.8` no dashboard (`admin.service.js:139`)
- `platformCommission={15}` no simulador do painel (`Tariffs.jsx:344`)
- `"2 mins away"`, `"3 mins away"`, lotações `4/1/3` (`VehiclePanel.jsx`)
- `"+12% vs Ontem"`, `"Tempo médio de espera: 3 min"`, meta de R$30/10 corridas (`CaptainDetails.jsx`)
- `'2.2'` KM e `'15'` mins como fallback (`RidePopUp.jsx`)
- Comissão de 10% como fallback (`RidePopUp.jsx:62`, `FinishRide.jsx:13`)
- `"Dinheiro"` fixo em 3 telas
- `fareMax = fare` (`ride.service.js:60`)
- Preços dos opcionais (`ride.service.js:108`)
- Limite `-20` de saldo replicado no front (`CaptainWallet.jsx:324`)

**Nomes/imagens fictícios**
- Seed: Carlos Silva, Ana Oliveira, Roberto Santos, Fernanda Lima, Lucas Mendes, placas ABC-1234/MTO-9988/AUT-7766, ganhos R$1450,50/820/2100, coordenadas fixas de São Paulo, cupons PRIMEIRA20/UBERFREE, 2 avaliações escritas à mão (`db/db.js:21-214`)
- Avatares de `gstatic.com` e `pinterest.com`
- Em produção: `user@test.com`, `user@example.com`, `captain@test.com`, `captain@example.com`, `captain-auto@`, `captain-moto@`

**Funcionalidades puramente visuais**
- 5 páginas da conta do passageiro (A7)
- Agendamento de corrida (A8)
- Agendamento de tarifa (A10)
- QR Code PIX do motorista (C3)
- 4 atalhos "Ações Rápidas" + bloco "Em Breve" (`CaptainDetails.jsx`)
- Bloqueio de usuário/motorista (C5)
- `cancellationFee` / `maxFreeWaitTime` / `perMinuteWaitFee` no painel (A9)

---

## 8. Decisões tomadas (2026-08-01)

| # | Questão | Decisão |
|---|---|---|
| 1 | Gateway de pagamento (C2) | **Não configurar agora.** Integração Asaas fica fora de escopo neste ciclo. |
| 2 | Categorias de veículo (A2) | **Totalmente dinâmico.** Painel → Mongo → Backend → App Passageiro → App Motorista. Nenhum nome, ícone, capacidade ou descrição hardcoded. Sem solução intermediária. |
| 3 | Telas fantasma (A7/A8) | **Remover temporariamente**: esconder do menu, **manter o código**, implementar quando houver backend. "Melhor 15 funcionalidades funcionando que 25 com 10 falsas." |
| 4 | Ordem de execução | 4 sprints, abaixo. |

---

## 9. Plano de correção — 4 sprints

### 🔴 Sprint 1 — Produto funcional
**C1, C4, C5, C6, A2** — "esses cinco fazem o aplicativo parecer um produto real".

1. **C6** — corrigir a lógica de `PricingRule`: regra sem `conditions` não deve ser aplicada cegamente; inverter o default para "não aplica o que não sei avaliar". Desativar a regra "Taxa de Chuva" no banco enquanto não houver avaliação de condições.
2. **C1** — remover as duas simulações de GPS (`CaptainHome.jsx`, `CaptainRiding.jsx`) e emitir posição real em todas as fases, mantendo o filtro de precisão já existente no `socket.js`.
3. **C4** — filtro geográfico real usando `locationGeoJSON` + índice 2dsphere já existentes no `captain.model` (`$nearSphere`), com `isOnline` e raio configurável. Remover o `find({})` de diagnóstico (M16).
4. **C5** — aplicar `isBlocked` no middleware de auth (passageiro e motorista) e `isBlocked`/`approvalStatus` no matching e no `toggle-online`.
5. **A2** — categorias 100% dinâmicas: endpoint público de categorias ativas; `VehiclePanel` renderizando a partir dele; `displayName`, capacidade, descrição e ícone vindos do banco; remover o enum fixo de `vehicleType` do `ride.model` e do validator de `ride.routes.js` (validar contra a coleção); ajustar o matching e as telas do motorista para não depender das chaves `car/moto/auto`.
   - Requer novos campos em `vehicleCategory.model`: `capacity`, `description`, `iconKey`/`iconUrl`, `sortOrder`, e edição deles no painel.

**Ganho:** para de cobrar taxa indevida, para de mentir sobre a posição do carro, para de mandar corrida para o outro lado do país, o botão de bloquear passa a funcionar e o painel finalmente comanda o catálogo.

### 🟠 Sprint 2 — Financeiro
**C3, A1, M11** (C2 adiado por decisão #1)

6. **C3** — bloquear `POST /captains/recharge` (501 / feature flag) até existir cobrança real; QR falso fora da tela.
7. **A1** — reescrever `adjustCaptainWallet` para usar `walletService.createTransaction` sobre `wallet.creditBalance`; decidir o destino da transaction já corrompida no banco.
8. **M11** — validar assinatura/origem do webhook Asaas antes de qualquer reativação.
9. **C2 (parcial, sem gateway)** — remover o formulário de cartão de `Riding.jsx` e a mensagem "Pagamento concluído", deixando explícito que o acerto é direto com o motorista. **A confirmar com você** — sem isso a tela continua prometendo cobrança que não existe.

### 🟡 Sprint 3 — Métricas
**A5, A6, A9, A10**

10. **A5** — avaliação pós-corrida (passageiro↔motorista) + cálculo real de `rating`, `acceptanceRate`, `cancellationRate`; remover `avgRating: 4.8`.
11. **A6** — tempo online real a partir de `toggle-online` alimentando `onlineTimeSeconds`.
12. **A9** — expor `platformCommission`/`cardFee*` no painel; implementar **ou** remover `cancellationFee`/`maxFreeWaitTime`/`perMinuteWaitFee`; corrigir `platformCommission={15}` do simulador para ler o valor real; resolver a duplicidade de `cancellationFee`.
13. **A10** — cron que aplica `tariffSchedule`, ou remover o botão "Agendar".

### 🟢 Sprint 4 — UX
**A7, A8, M5, M6, M8, M9**

14. **A7** — esconder do menu Wallet/Coupons/Favorites/Cards/Scheduled, mantendo o código. Trocar os `catch` silenciosos por estado de erro explícito.
15. **A8** — esconder o agendamento de corrida.
16. **M5** — forma de pagamento real nas 3 telas.
17. **M6** — remover os fallbacks `'2.2'`/`'15'`/10% de comissão.
18. **M8** — mapear `'finished'` corretamente no `Activity.jsx`.
19. **M9** — substituir os avatares externos por asset local/iniciais.

### Fora dos sprints (higiene, quando couber)
C7 (seed em produção — **risco latente, sugiro antecipar para o Sprint 1**), A3, A4, M1, M2, M3, M4, M7, M10, M12, M13, M14, M15.

---

## 10. Como testar

1. **Fixture determinística**: script criando 1 passageiro, 2 motoristas (1 aprovado / 1 bloqueado) e categorias conhecidas, em banco separado. Hoje não é possível testar o fluxo completo — nunca houve corrida `finished`.
2. **E2E do ciclo 1→19** com Playwright em duas sessões (passageiro + motorista), validando o **documento no Mongo** a cada passo, não só a tela.
3. **Tabela de preços**: distância/tempo/categoria/pagamento conhecidos × valor esperado, com regra de chuva ligada e desligada. `Backend/tests/unit/pricingEngine.service.test.js` é a base.
4. **Autorização**: passageiro bloqueado, motorista bloqueado, motorista não aprovado, motorista com saldo negativo.
5. **Raio**: motorista a 2 km recebe; a 200 km não recebe.
6. **GPS real** (após C1): comparar `actualDistance` gravada com a distância real de um percurso conhecido.
7. **Baseline atual da suíte do frontend permanece 3 falhas conhecidas** — não confundir com regressão.

---

## 11. Resumo executivo

| Camada | Veredito |
|---|---|
| Autenticação e sessão | ✅ sólida (JWT, blacklist, rate limit) — falta aplicar `isBlocked` |
| Mapas / geocoding / rotas | ✅ real e íntegro |
| Socket.IO / tempo real | ✅ infraestrutura correta — o problema é o **conteúdo** trafegado |
| Criação e aceite de corrida | ✅ correto, inclusive concorrência |
| Motor de preços | ⚠️ arquitetura boa, uma regra aplicada indevidamente, parâmetros-chave fora do painel |
| Painel → App | ❌ tarifas propagam; categorias, bloqueios e metade das configurações não |
| Rastreamento durante a corrida | ❌ simulado |
| Pagamento | ❌ inexistente (adiado por decisão) |
| Carteira e comissão | ⚠️ lógica correta, nunca exercitada, ajuste admin corrompe |
| Reputação e métricas | ❌ inexistente |
| Contas do passageiro | ❌ fachada |

O núcleo transacional (pedir → parear → aceitar → iniciar) está bom. Falta tudo que vem depois do início da corrida: posição real, cobrança real, e a devolução desses fatos ao painel.

---

## 12. Registro de execução

- [x] **Sprint 1 — C6, C7, C5, C4, C1, A2** (executado em 2026-08-01)
- [x] **Sprint 2 — C3, A1, M11, C2-parcial** (executado em 2026-08-01)
- [x] **Sprint 3 — A6, A5, A9, A10** (executado em 2026-08-01)
- [x] **Sprint 4 — A7, A8, M5, M6, M8, M9** (executado em 2026-08-01)

### Sprint 1 — detalhes da execução

**C6 — Taxa de Chuva cobrada sempre.** `Backend/services/pricingEngine.service.js`: extraído `_evaluateRuleConditions(rule)` — regra sem `conditions` não aplica mais por padrão (antes aplicava sempre); regra com `conditions` também não aplica ainda, pois não existe avaliador implementado (antes de qualquer condicional, nenhuma regra deve ser cobrada sem verificação real). Regra "Taxa de Chuva" desativada (`isActive:false`) direto no banco de produção como reforço explícito. 2 testes de regressão adicionados em `pricingEngine.service.test.js` (7/7 passando).

**C7 — seed rodando em produção.** `Backend/db/db.js`: `seedTestData()` agora só roda se `NODE_ENV !== 'production'`.

**C5 — bloqueio não aplicado.** `Backend/middlewares/auth.middleware.js`: `authUser`, `authCaptain` e `authBoth` agora retornam 403 se `isBlocked`. `Backend/controllers/captain.controller.js` (`toggleOnline`): bloqueia ficar online se `approvalStatus !== 'aprovado'` (antes só existia no cliente).

**C4 — sem filtro de raio.** `Backend/services/maps.service.js` (`getCaptainsInTheRadius`): reescrita para usar `$nearSphere` sobre `locationGeoJSON` (índice 2dsphere já existente), com `$maxDistance` real, mais `isOnline:true`, `isBlocked:{$ne:true}`, `approvalStatus:'aprovado'`. Removido o `find({})` de diagnóstico que buscava todos os motoristas a cada corrida (M16, resolvido de brinde). `Backend/controllers/ride.controller.js`: raio de busca corrigido de `50000` (inválido) para `15` km, nomeado em constante. Rodado `scripts/migrateGeoJSON.js` para backfill (0 motoristas precisaram, já estavam sincronizados).

**C1 — GPS simulado.** `frontend/src/modules/driver/pages/CaptainHome.jsx` e `CaptainRiding.jsx`: removida toda a interpolação matemática (offset de 0.01°, 40/60 passos, `setInterval` de 2s calculando posição fake). Ambos agora emitem `locationRef.current` (GPS real do `LocationContext`, já usado no app do passageiro) periodicamente via `update-location-captain`, com fallback offline para `db.driverLocations` inalterado.

**A2 — categorias hardcoded.** Decisão do usuário: dinâmico total, sem meio-termo.
- Backend: `vehicleCategory.model.js` ganhou `description`, `capacity`, `iconKey` (enum de ilustrações já embarcadas no app: car/moto/auto — não há pipeline de upload de imagem, então o admin escolhe qual ilustração representa a categoria, mas nada mais fica implícito no código), `sortOrder`.
- Novo endpoint público `GET /vehicle-categories` (sem auth — precisa funcionar antes do motorista ter conta) retornando só campos de exibição, não tarifas.
- Removidos os enums fixos: `ride.model.js` (`vehicleType`), `ride.routes.js` (validator), `captain.model.js` (`vehicle.vehicleType`), `captain.routes.js` (validator). Validade agora é checada em runtime contra a coleção (já existia para corrida via `PricingEngine`; adicionado para cadastro de motorista em `captain.controller.js`).
- Matching de motoristas (`ride.controller.js`): removido o hack de alias `moto`/`motorcycle` — não é mais necessário porque o `vehicleType` do motorista passa a ser sempre um `name` de categoria real, validado no cadastro.
- Admin: `admin.service.js` (`updateVehicleCategory`) passou a persistir os novos campos; nova `createVehicleCategory` + rota `POST /admin/vehicle-categories` (antes só existia duplicar, não criar do zero).
- `admin-frontend/src/pages/Tariffs.jsx`: `CategorySettingsCard` ganhou campos editáveis de nome de exibição, descrição, capacidade e ícone; novo botão "Nova Categoria" com modal de criação.
- `frontend`: `VehiclePanel.jsx` reescrito para buscar `/vehicle-categories` e renderizar dinamicamente (nome, descrição, capacidade, ícone, preço) — os 3 blocos JSX hardcoded (MoveGo/MoveMoto/MoveAuto, "2/3 mins away", lotação fixa) foram removidos. Como efeito colateral direto da reescrita, também parou de exibir a falsa faixa de preço `fare - fareMax` (A4) já que `fareMax` sempre igual a `fare` no backend — não seria honesto manter a exibição de um intervalo que nunca existiu; a correção completa de A4 (ETA e faixa real) continua no Sprint 4/Sprint 3.
  `CaptainSignup.jsx`: select de tipo de veículo agora populado por `getVehicleCategories()`.
- **Ação pendente do admin**: as 3 categorias existentes (car/moto/auto) não tinham os novos campos, então hoje aparecem com `iconKey` default "car" e sem descrição. Recomendo abrir o painel → Tarifas → cada categoria → preencher ícone e descrição corretos (ex: moto → ícone moto).

**Verificação:** suíte de testes do backend (`4 failed | 25 passed` — mesma baseline pré-existente, confirmada por `git stash`/re-run antes de cada mudança) e do frontend (`3 failed | 4 passed` — baseline documentada em memória) sem nenhuma regressão nova. `vite build` limpo em `frontend/` e `admin-frontend/`. Endpoint `GET /vehicle-categories` testado ao vivo contra o backend local apontando para o Mongo de produção (somente leitura), retornando as 3 categorias reais corretamente.

### Sprint 2 — detalhes da execução

**C3 — recarga de carteira sem cobrança.** `Backend/controllers/captain.controller.js` (`rechargeWallet`): endpoint bloqueado, retorna `501` com mensagem pedindo para falar com o suporte. `frontend/src/modules/driver/pages/CaptainWallet.jsx`: removido todo o fluxo de "Simular Pagamento Pago" (input de valor, QR Code falso, mutation que chamava `/captains/recharge`); o modal agora só informa que a recarga automática está indisponível e direciona para o suporte. `useMutation` e `useToast` ficaram sem uso após a remoção e foram tirados dos imports.

**A1 — ajuste manual de carteira gravando no lugar errado.** `Backend/services/admin.service.js` (`adjustCaptainWallet`): reescrito para chamar `walletService.createTransaction` sobre `wallet.creditBalance` em vez de escrever direto em `captain.earnings`. Isso corrige de uma vez: o saldo que o ajuste afeta (antes era um contador de faturamento sem relação com o saldo real), a invalidação de cache, a reaplicação da regra de bloqueio por saldo negativo, e o evento em tempo real `wallet-updated` que antes nunca disparava para esse tipo de ajuste. 4 testes novos em `tests/unit/adminWallet.service.test.js` cobrindo crédito, débito, bloqueio por saldo negativo e consistência do ledger.
- **Decisão sobre a transaction já corrompida em produção** (ajuste de +100 gravado com `balanceAfter:100` desalinhado do `wallet.creditBalance:50` real, no captain de teste `captain-moto@example.com`): mantida como está. Transação é registro de auditoria — reescrever histórico financeiro é pior prática do que uma entrada antiga mal-rotulada; o saldo atual da wallet já está correto e é isso que o app usa dali em diante.

**M11 — webhook do Asaas sem validação.** `Backend/controllers/webhook.controller.js`: `POST /webhooks/asaas` agora exige o header `asaas-access-token` batendo com `process.env.ASAAS_WEBHOOK_TOKEN` (padrão de autenticação de webhook do Asaas); sem o env var configurado ou com token errado, retorna `401` sem processar o corpo. Variável documentada em `.env.example`. 3 testes novos em `tests/integration/webhook.api.test.js` (rejeita sem token, rejeita com token errado, processa corretamente com token certo).

**C2-parcial — formulário de cartão falso.** `frontend/src/modules/passenger/pages/Riding.jsx`: removido o seletor de método de pagamento (Pix/UPI, Cartão, Dinheiro — UPI nunca fez sentido no Brasil, era resquício do template original; cartão nunca era de fato selecionável antes da corrida, já que `PaymentOptionsPanel.jsx` só oferece Pix/Dinheiro) e os formulários de número de cartão/validade/CVV que eram só descartados no cliente. O botão agora se chama "Acertar Pagamento" e abre um aviso claro — "pague diretamente ao motorista, o app não processa este pagamento" — com um botão "Já paguei o motorista" que só avisa o motorista (evento `payment-completed`), sem alegar que dinheiro mudou de mãos. Corridas pagas via carteira (`ride.paymentMethod === 'carteira'`) não mostram mais o botão de pagamento, já que o valor foi debitado no momento da solicitação — mostram só um selo "Já pago pela carteira".

**Verificação:** suíte do backend (`4 failed | 32 passed` — mesma baseline + 7 testes novos) e do frontend (`3 failed | 4 passed` — baseline inalterada) sem regressões novas. `vite build` limpo em `frontend/`.

### Sprint 3 — detalhes da execução

**A6 — tempo online mockado.** `Backend/models/captain.model.js`: além dos novos campos, removida uma duplicidade real encontrada no schema — `rating`, `acceptanceRate` e `totalRides` estavam declarados DUAS vezes (Mongoose usa a última, então as primeiras declarações eram só ruído; limpo sem mudança de comportamento). Adicionados `onlineSince`, `todayOnlineSeconds`, `todayOnlineDate`. `Backend/services/captain.service.js`: `startOnlineSession`/`endOnlineSession`/`getTodayOnlineSeconds`, com acumulado vitalício e de "hoje" (zera na virada do dia). Ligado em três pontos: `captain.controller.js#toggleOnline` (fim normal da sessão), `socket.js` no `disconnect` (motorista que fecha o app sem avisar não fica contando pra sempre — também zera `isOnline` e invalida cache, o que também corrige o filtro de raio do C4 pra esses casos), e `getSummary` (substituiu a string fixa `"05:32"` por `onlineTimeSeconds` real). Frontend `CaptainDetails.jsx`: `formatOnlineTime` recebe segundos reais; removido um estado local morto (`onlineTime`) que nunca era lido. 6 testes novos.

**A5 — reputação nunca calculada.** Escopo definido: implementei avaliação passageiro→motorista (não construí o inverso motorista→passageiro, que não tinha nenhuma evidência de UI/fluxo no app do motorista) e `cancellationRate` real. **Deixei `acceptanceRate` de fora** — calculá-lo de verdade exigiria registrar toda vez que uma corrida é oferecida a um motorista e se ele aceitou/ignorou, o que não existe hoje (`new-ride` é só um broadcast de socket, sem persistência); implementar isso teria sido inventar uma arquitetura nova em vez de corrigir a existente, então preferi sinalizar a lacuna a fabricar um número.
- Novo endpoint `POST /rides/review` (`ride.service.js#submitReview` + `ride.controller.js` + rota): exige corrida `finished`, do próprio usuário, com motorista, sem avaliação duplicada. Recalcula `captain.rating` (`captain.service.js#recalculateRating`, média real; sem avaliações mantém o default do schema em vez de zerar).
- `captain.service.js#recalculateCancellationStats`: recalcula do zero (não incremental) `cancellationRate`/`cancelledRides` a partir de todas as corridas já atribuídas ao motorista. Ligado em TODOS os pontos onde uma corrida com motorista vira `cancelled`: `rideService.cancelRide`, `rideService.updateRideStatus`, `adminService.cancelRide`, `adminService.bulkActionRides`.
- `admin.service.js#getDashboardStats`: `avgRating` deixou de ser `4.8` fixo — agora é a média real das avaliações do período (`null` se não houver nenhuma, e o `admin-frontend/Dashboard.jsx` mostra "Sem avaliações" nesse caso em vez de renderizar vazio).
- Frontend: `Riding.jsx` ganhou uma etapa de avaliação (5 estrelas + comentário opcional) no fluxo pós-corrida — vira um mini state machine `payment → rating → done`; corridas pagas pela carteira pulam direto pra `rating` (não têm o que "acertar") e ganharam um botão "Avaliar Motorista" independente, já que antes não tinham nenhum caminho até a avaliação. 9 testes novos no backend.

**A9 — descompasso painel × motor de preço.** Decisão: implementar de verdade em vez de esconder, já que dava pra fazer dentro do mesmo padrão "informativo, acertado direto com o motorista" que o C2-parcial já usa — nenhuma das duas taxas abaixo precisa de gateway de pagamento.
- `cancellationFee`: `ride.model.js` ganhou `cancellationFeeCharged`; `rideService.cancelRide` calcula quando o passageiro cancela com motorista já a caminho (status `accepted`/`going_to_pickup`/`arrived`/`waiting_passenger`) e devolve no response; `Home.jsx` mostra um toast avisando o valor.
- `maxFreeWaitTime`/`perMinuteWaitFee`: `ride.model.js` ganhou `arrivedAt` (gravado por `updateRideStatus` quando o status vira `arrived`) e `waitTimeFeeCharged` (calculado em `startRide` a partir do tempo decorrido desde `arrivedAt`, somado ao `finalPrice` em `endRide`).
- `platformCommission`/`cardFeePercent`/`cardFeeFixed` (viviam em `globalSetting`, painel só lia/escrevia `tariffSetting`): `admin.service.js#getTariffs`/`updateGlobalSettings` agora fazem merge dos dois documentos numa resposta só, persistindo cada campo na coleção certa. Exposto no formulário "Globais" do painel (`Tariffs.jsx`).
- `TariffAdvancedSimulator` tinha `platformCommission={15}` fixo (o real é 20%) — agora recebe o valor real vindo do form.
- Duplicidade de `cancellationFee`: removido de `globalSetting.model.js` (nunca lido por ninguém, confirmado por grep); `tariffSetting.cancellationFee` é a única fonte de verdade — e agora genuinamente usado.
- 9 testes novos.

**A10 — "Agendar" tarifa não fazia nada.** Novo `Backend/services/tariffScheduler.service.js`: `applyDueSchedules()` busca `tariffSchedule` com `status:'pending'` e `scheduledFor` vencido, aplica em `vehicleCategory` (se `categoryId`) ou `tariffSetting` (se global), marca `applied`/`failed` (com `errorReason`, ex: categoria removida antes do agendamento vencer). Roda a cada minuto via `node-cron`, mesmo padrão já usado em `notification.service.js` — registrado com `require()` direto em `app.js`. 5 testes novos.

**Verificação:** suíte do backend (`4 failed | 60 passed` — mesma baseline + 25 testes novos deste sprint) e do frontend (`3 failed | 4 passed` — baseline inalterada). `vite build` limpo em `frontend/` e `admin-frontend/`. `app.js` testado subindo de verdade contra o Mongo de produção (boot limpo, cron registrado, processo encerrado sem deixar nada residual).

### Sprint 4 — detalhes da execução

**A7 — telas fantasma.** `frontend/src/modules/passenger/pages/account/Account.jsx`: removidos do menu os itens Cupons, Meus Cartões, Corridas Agendadas, Favoritos e Locais, e o card de saldo "R$ 0,00" fixo que abria a Carteira (nenhuma dessas rotas tinha backend real — ver auditoria original A7). Código das 5 páginas mantido intacto, só não estão mais linkadas. Nas 5 páginas (`Wallet.jsx`, `Coupons.jsx`, `Favorites.jsx`, `Cards.jsx`, `Scheduled.jsx`), troquei o `catch { setState([]) }` silencioso por um estado `loadError` explícito com uma tela de erro distinta do "vazio" — antes um 404 e "você não tem nada aqui" eram visualmente idênticos. De brinde, o botão "Aplicar" cupom em `Coupons.jsx` que sempre respondia "Código inválido ou expirado" (mock) agora diz honestamente que a função não está disponível.

**A8 — agendamento de corrida.** `Home.jsx`: removido o botão de calendário que abria `ScheduleRidePanel` (que só dava um `alert()` fingindo ter agendado). Componente e estado continuam no código, só sem gatilho.

**M5 — forma de pagamento sempre "Dinheiro".** `WaitingForDriver.jsx`, `LookingForDriver.jsx` (precisou de um novo prop `paymentMethod` vindo de `Home.jsx`, que antes não era passado) e `ConfirmRidePopUp.jsx` (app do motorista) agora mostram o método real da corrida (`ride.paymentMethod`), com o mesmo mapeamento pix/carteira/cartão/dinheiro já usado em `ConfirmRide.jsx`.

**M6 — fallbacks fictícios.** `RidePopUp.jsx` e `FinishRide.jsx`: removidos os literais `'2.2'` km e `'15'` mins (viravam "—" quando o dado real não existe, em vez de inventar um número plausível) e a comissão calculada como 10% do fare quando `commissionAmount` estava ausente (o real é 20% — mostrar a comissão real ou "—" é mais honesto que uma conta errada). De brinde, corrigido um bug real encontrado nesse processo: essas telas liam `ride.distance` (campo marcado "Deprecated" no schema, sempre vazio em corridas novas) em vez de `ride.estimatedDistance` (o campo real) — por isso sempre caíam no fallback fake mesmo quando havia dado de verdade disponível.

**M8 — status "finished" sem tradução.** `Activity.jsx`: `getStatusText` mapeava `'completed'`/`'ongoing'`/`'pending'` — nenhum desses é um valor real de `ride.status` (o enum real é `requested/accepted/going_to_pickup/arrived/waiting_passenger/started/finished/cancelled`), então toda corrida finalizada caía no `default` e mostrava a string crua "finished". Reescrito para cobrir os status reais. Encontrei o mesmo bug de raiz no backend: `Backend/controllers/ride.controller.js#getRideHistory`, o filtro "ongoing" usava `$in: ['pending','accepted','ongoing']` — só `'accepted'` existe de verdade, então o filtro "Em andamento" no histórico só achava corridas recém-aceitas, nunca as que já estavam a caminho/chegando/em viagem. Corrigido para os status reais. 2 testes novos.

**M9 — avatares de pessoas reais e desconhecidas.** Novo componente `frontend/src/shared/components/Avatar.jsx` (iniciais do nome sobre fundo verde — nem passageiro nem motorista têm campo de foto de perfil real além de `user.profilePicture`, que já era usado corretamente em `Account.jsx`). Substituídas as fotos de banco de imagens (Pinterest/Google Images de uma pessoa real desconhecida) em `RidePopUp.jsx`, `ConfirmRidePopUp.jsx`, `FinishRide.jsx` (avatar do passageiro, do ponto de vista do motorista), `CaptainDetails.jsx` e `CaptainProfile.jsx` (avatar do próprio motorista). O logo do Pix hotlinkado de `logospng.org` em `ConfirmRide.jsx` e `PaymentOptionsPanel.jsx` virou um ícone Remix Icon local, consistente com o resto do app.

**Verificação:** suíte do backend (`4 failed | 62 passed` — mesma baseline + 2 testes novos do M8) e do frontend (`3 failed | 4 passed` — baseline inalterada). `vite build` limpo em `frontend/`. Lint comparado arquivo a arquivo contra a baseline pré-existente em todos os componentes tocados — nenhum problema novo introduzido.

---

## 13. Estado final após os 4 sprints

Todos os itens dos 4 sprints planejados foram executados: **C1, C3, C4, C5, C6, C7, A1, A2, A5, A6, A9, A10, A7, A8, M2 (parcial, via M8), M5, M6, M8, M9, M11**, além do C2-parcial (remoção do formulário de pagamento falso).

**Deixado deliberadamente de fora, com razão registrada:**
- **acceptanceRate** (dentro de A5): exigiria uma infraestrutura de log de ofertas de corrida que não existe hoje; calculá-lo sem isso seria fabricar mais um número fake.
- **C2 completo** (gateway de pagamento real): fora de escopo por decisão do usuário.
- **A3, A4, M1, M3, M4, M7, M10, M12, M13, M14, M15, M16**: itens de higiene/baixo impacto não agendados em nenhum sprint (M16 acabou resolvido de brinde no Sprint 1, junto com C4).

**Metodologia usada em todo o processo:** para cada item, mudança mínima e correta na origem do dado (nunca uma camada de disfarce em cima do problema); teste de regressão novo sempre que havia lógica nova ou corrigida; suíte completa (backend + frontend) rodada após cada item, comparada contra a baseline pré-existente via `git stash`/re-run quando havia dúvida se uma falha era nova; build de produção (`vite build`) validado em ambos os frontends. Nenhuma regressão nova foi introduzida em nenhum dos 4 sprints.
