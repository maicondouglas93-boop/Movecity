# Auditoria — Estimativa × Valor Final da Corrida

**Status:** concluído (auditoria + correção pontual + testes). Segue a ordem
pedida: primeiro mapeei a arquitetura existente (PricingEngine, endRide,
pagamento, comissão, carteira, GPS, modelos, histórico) antes de tocar em
qualquer código.

---

## 1. Como o sistema calculava antes

A boa notícia, confirmada lendo o código e depois provada por 8 testes reais:
**o princípio central já estava implementado corretamente.** `endRide`
([ride.service.js:1084](Backend/services/ride.service.js#L1084)) nunca usava
`finalPrice = fare` (estimativa) de propósito — ele recalcula via
`PricingEngine.calculateFare()` usando `actualDistance` (GPS real, acumulado
ponto a ponto durante a corrida) e `actualTimeSeconds` (tempo real decorrido).

O que faltava: quando a corrida terminava numa distância diferente da
pesquisada, o sistema já cobrava certo, mas **não registrava separadamente
onde ela realmente terminou** — só existia o destino pesquisado
(`destination`/`destinationCoordinates`). O campo `destinationMeta` (que já
existia no schema, pensado exatamente pra essa distinção) só era preenchido
no caso de presencial sem destino — nunca para corrida normal.

## 2. Como ficou depois

Sem mudar a arquitetura: `endRide` agora também grava `destinationMeta`
(`source: 'gps_at_finish'`, coordenadas do último GPS conhecido) para
corridas normais, sem tocar em `destination`/`destinationCoordinates` (que
continuam sendo o que foi pesquisado). Isso é só um registro adicional —
**o cálculo do valor final não mudou**, porque já estava certo.

## 3. Arquivos modificados

- [Backend/services/ride.service.js](Backend/services/ride.service.js) —
  `endRide`: novo bloco `else if (isValidGpsCoord(...))` que popula
  `destinationMeta` pro caso de corrida normal (antes só existia pro
  presencial sem destino).
- [Backend/tests/unit/rideEstimateVsActual.service.test.js](Backend/tests/unit/rideEstimateVsActual.service.test.js)
  (novo) — os 8 testes obrigatórios.

Nenhum outro arquivo precisou mudar — `PricingEngine`, `confirmPaymentReceived`,
`wallet.service.js` e o modelo `Ride` já suportavam tudo que a regra de
negócio pede.

## 4. Campos adicionados/alterados

Nenhum campo novo no schema. Mapeamento entre a nomenclatura sugerida no
pedido e o que já existe no projeto (mantive os nomes existentes, como
pedido — não renomeei nada):

| Sugerido no pedido | Campo real no projeto | Observação |
|---|---|---|
| `estimatedOrigin` | `pickup` + `pickupCoordinates` | já existe |
| `estimatedDestination` | `destination` + `destinationCoordinates` | já existe; nunca sobrescrito numa corrida normal |
| `estimatedDistance` | `estimatedDistance` | já existe, nome idêntico |
| `estimatedDuration` | `estimatedTime` | já existe (nome diferente, mesmo conceito) |
| `estimatedFare` | `fare` | já existe — é a estimativa congelada na criação, nunca alterada depois |
| `estimatedRoute` | — | não existe (não há polyline/rota salva, só distância/tempo). Fora de escopo — não construí isso sem pedido explícito |
| `actualStartLocation` | `pickupCoordinates` | a corrida sempre começa no embarque — não há um "início real" diferente |
| `actualEndLocation` | `destinationMeta.coordinates` (+ `lastLocation`) | **populado agora também pra corrida normal** (única mudança real) |
| `actualDistance` | `actualDistance` | já existe, nome idêntico, GPS real (ver seção 5) |
| `actualDuration` | `actualTime` | já existe (nome diferente, mesmo conceito) |
| `finalFare` | `finalPrice` | já existe, sempre recalculado, nunca copiado da estimativa |

## 5. Fluxo completo (confirmado no código, ponta a ponta)

```text
Passageiro pede X → Y
    ↓
createRide: PricingEngine.calculateFare(estimatedDistance, estimatedTime)
    → fare (estimativa), pricingSnapshot congelado (tarifa/comissão do momento)
    ↓
Corrida aceita, iniciada (startRide)
    ↓
GPS do motorista atualiza a cada ~5s (socket.js, update-location-captain)
    → cada ponto novo soma em actualDistance via haversine, com filtro de
      ruído (ignora saltos <5m ou >2km) e compare-and-swap atômico (evita
      contar o mesmo trecho duas vezes em updates concorrentes)
    ↓
Motorista toca "Finalizar corrida" — A QUALQUER MOMENTO, sem checagem de
proximidade com Y (nem no backend, nem no frontend — confirmado nos dois)
    ↓
endRide captura: actualDistance (GPS real acumulado até agora, ex.: X→Z),
actualTime (Date.now() - startedAt)
    ↓
destinationMeta grava ONDE terminou de fato (source: gps_at_finish) — NOVO
    ↓
PricingEngine.calculateFare(actualDistance, actualTime, pricingSnapshot
CONGELADO da criação) → finalPrice, commissionAmount, commissionPercent
    ↓
Aplica tarifa mínima/adicionais/comissão — mesmo motor único, sem duplicar
    ↓
Payment criado/atualizado com amount = finalPrice
    ↓
confirmPaymentReceived (motorista confirma recebimento): transação atômica,
sessão Mongo, índice único no banco contra duplicidade
    ↓
Carteira: ride_payment (finalPrice) + commission (finalPrice × %) — NUNCA a
estimativa
    ↓
Corrida finalizada, extrato/histórico consultável
```

**Confirmado por leitura de código, não suposição**: `destination`/
`destinationCoordinates`/`estimatedDistance`/`fare` (a "fotografia" da
estimativa) nunca são sobrescritos em `endRide` para corrida normal — só
`finalPrice`, `actualDistance`, `actualTime`, `commissionAmount`,
`fareBreakdown` e agora `destinationMeta` mudam.

### Cancelamento × finalização antecipada (seção 21 do pedido)

Já são estruturalmente separados na máquina de estados
(`VALID_ORIGINS_BY_TARGET` em
[ride.service.js:20-33](Backend/services/ride.service.js#L20-L33)):
`cancelled` **não** aceita `'started'` como origem — a única transição
possível a partir de `'started'` é para `'finished'`. Ou seja, uma corrida
já iniciada **nunca** pode virar "cancelada" no banco, não importa em que
ponto pare — o código já impede fisicamente essa confusão, não é preciso
nenhuma correção aqui.

### Limitação documentada (seção 10 do pedido)

O MoveCity **não permite alterar o destino durante a corrida** hoje — não
existe nenhum endpoint de "trocar destino em andamento". Não implementei
essa funcionalidade (mudança de escopo grande, não pedida explicitamente) —
só confirmo que ela não existe.

## 6. Testes executados

Arquivo novo: `Backend/tests/unit/rideEstimateVsActual.service.test.js`,
categoria de teste com `baseFare=10, perKm=2, perMinute=0.5, minimumFare=15,
comissão=20%`.

| # | Teste | Resultado |
|---|---|---|
| 1 | Termina no destino original (10km/25min = estimado) → `finalPrice = R$42,50`, igual à estimativa quando a execução bate exatamente | ✅ PASSOU |
| 2 | Termina antes (Z a 4km em vez de 10km) → `finalPrice = R$23,00`, **menor** que a estimativa (R$42,50); estimativa preservada | ✅ PASSOU |
| 3 | Percorre distância maior (15km em vez de 10km) → `finalPrice ≈ R$56,67`, **maior** que a estimativa | ✅ PASSOU |
| 4 | Tarifa mínima: distância real de 200m → `finalPrice = R$15,00` (piso), nunca abaixo do mínimo configurado | ✅ PASSOU |
| 5 | Comissão sobre o valor final: `R$23,00 × 20% = R$4,60`, nunca sobre os R$42,50 estimados | ✅ PASSOU |
| 6 | Pagamento (`confirmPaymentReceived`) registra `Transaction.amount = R$23,00` (final), não R$42,50 | ✅ PASSOU |
| 7 | Carteira do motorista debitada em `R$4,60` (comissão sobre o valor final) | ✅ PASSOU |
| 8 | Auditoria: `destination`/`estimatedDistance`/`fare` continuam intactos (X→Y original); `destinationMeta` grava separadamente onde terminou de fato (Z) | ✅ PASSOU |

Suíte completa do backend rodada depois: **385 testes, 345 passando** (337
de antes + os 8 novos) — **zero regressão**; as 40 falhas restantes já
existiam antes desta tarefa e não têm relação com este fluxo (confirmado na
auditoria financeira anterior).

## 7. Confirmação final

**Pergunta:** *Se o passageiro pesquisar X → Y, mas terminar a corrida em Z,
o MoveCity cobra pelo serviço efetivamente realizado e mantém a estimativa
original X → Y preservada para auditoria?*

**Resposta, baseada em código e nos 8 testes reais acima: SIM.**

- O valor cobrado (`finalPrice`) é sempre recalculado a partir da distância
  e do tempo **reais** (GPS acumulado ponto a ponto durante a corrida),
  nunca copiado da estimativa — provado nos testes 1–4.
- Comissão, pagamento e carteira usam esse mesmo valor final — provado nos
  testes 5–7.
- A estimativa original (`fare`, `estimatedDistance`, `destination`,
  `destinationCoordinates`) continua intacta no banco depois da corrida
  terminar num ponto diferente — provado no teste 8.
- O único ponto que precisou de correção (não de reconstrução) foi
  registrar **onde** a corrida terminou de fato quando diferente do
  pesquisado — antes esse dado só existia para o caso presencial, agora
  existe para toda corrida, reaproveitando um campo (`destinationMeta`) que
  já existia no schema exatamente para isso.
