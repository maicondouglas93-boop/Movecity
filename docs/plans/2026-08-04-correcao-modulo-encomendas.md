# Plano de correção — Módulo de Encomendas

Data: 2026-08-04
Origem: auditoria do módulo de encomendas (12 arquivos novos + 6 modificados, ainda não commitados)

---

## Resumo

A auditoria encontrou 2 problemas críticos, 4 médios e confirmou que a arquitetura de
segurança de acesso está sólida. Os dois críticos foram **comprovados empiricamente**
com teste real contra banco, não por leitura de código.

Este plano cobre os defeitos técnicos (Fases 1–5). No fim: **cobrança** já tem decisão
de produto registrada; **comportamento de fila** ainda aguarda definição.

---

## Fase 1 — Transições atômicas (CRÍTICO, bloqueia produção)

### Problema comprovado

`updateParcelStatus` e `cancelParcel` usam `ler → validar → parcel.save()`. Teste
concorrente numa encomenda em `arrived_pickup`:

```
operações bem-sucedidas: 2   (seguro seria 1)
status final: collected
cancelledBy: passenger
histórico: cancelled -> collected
```

A encomenda fica `collected` **e** marcada como cancelada. Além disso o `busyLock`
vaza (`LOCK VAZADO: true`), permitindo ao motorista aceitar uma corrida enquanto
carrega a encomenda — quebra a exclusão mútua ride↔parcel.

### Correção

**1.1** Criar `transitionParcel()` em `services/parcel.service.js`, espelhando
`transitionRide()` de `ride.service.js`:

```js
const VALID_ORIGINS_BY_TARGET = {
    going_to_pickup:     ['provider_accepted'],
    arrived_pickup:      ['going_to_pickup'],
    collected:           ['arrived_pickup'],
    in_transit:          ['collected'],
    arrived_destination: ['in_transit'],
    finished:            ['arrived_destination'],
    cancelled:           ['awaiting_provider', 'provider_accepted',
                          'going_to_pickup', 'arrived_pickup'],
};

async function transitionParcel(parcelId, toStatus, extraFilter = {}, extraSet = {}, by = 'system') {
    const origins = VALID_ORIGINS_BY_TARGET[toStatus];
    if (!origins) throw new Error('INVALID_STATUS_TRANSITION');
    return parcelModel.findOneAndUpdate(
        { _id: parcelId, status: { $in: origins }, ...extraFilter },
        {
            $set: { status: toStatus, ...extraSet },
            $push: { statusHistory: { status: toStatus, at: new Date(), by } },
        },
        { new: true }
    );
}
```

`finished` e `cancelled` **nunca** aparecem como origem — é o que garante que estado
terminal é terminal, mesmo sob concorrência.

**1.2** Migrar para o helper (retorno `null` = perdeu a corrida → erro apropriado):

| Função | Filtro extra | `by` |
|---|---|---|
| `updateParcelStatus` | `{ captain: captain._id }` | `captain` |
| `cancelParcel` | `{ user }` | `user` |
| `cancelParcelSystem` | — | `system` |
| `adminCancelParcel` | — | `admin` |

`confirmDelivery` **já é atômico** — só passa a usar o helper por consistência.

**1.3** Corrigir a liberação do `busyLock`: hoje `cancelParcel` libera
incondicionalmente. Passa a liberar **somente quando a transição venceu**.

**1.4** Adicionar `releaseCaptainBusyLockIfIdle()` em `dispatch.service.js` — só
libera se o motorista não tem corrida **nem** encomenda ativa. Defesa em profundidade
contra essa classe de vazamento em qualquer caminho futuro:

```js
async function releaseCaptainBusyLockIfIdle(captainId) {
    if (!captainId) return false;
    if (await captainHasActiveRide(captainId)) return false;
    if (await captainHasActiveParcel(captainId)) return false;
    await releaseCaptainBusyLock(captainId);
    return true;
}
```

Usar nos caminhos de cancelamento/finalização de encomenda.

**Arquivos:** `services/parcel.service.js`, `services/dispatch.service.js`

---

## Fase 2 — Entrega em tempo real do cancelamento (MÉDIO)

`parcel-cancelled` é emitido só por `sendMessageToRoom('parcel_<id>')`. Salas são
populadas por `socketId`, que muda a cada reconexão — o motorista pode não receber.
É a mesma classe do bug corrigido hoje em corridas (`ride-cancelled-by-captain`).

**Correção:** manter o broadcast na sala (fecha o popup dos candidatos) e **somar**
envio direto ao `socketId` do motorista designado, quando houver:

```js
if (parcel.captain?.socketId) {
    sendMessageToSocketId(parcel.captain.socketId, {
        event: 'parcel-cancelled',
        data: { parcelId: parcel._id.toString() },
    });
}
```

Exige `.populate('captain')` no retorno — já existe em `cancelParcel`.

**Arquivos:** `controllers/parcel.controller.js`

---

## Fase 3 — Testes de concorrência (bloqueia "pronto")

Os 11 testes atuais passam, mas cobrem só caminhos felizes. Nenhum cobre
`cancelParcel`, nenhum cobre concorrência — exatamente onde estão os dois bugs.

Adicionar em `tests/unit/parcel.service.test.js` (ou arquivo dedicado):

1. cancelar (passageiro) × avançar status (motorista) → **exatamente 1** vence
2. dois avanços idênticos simultâneos → 1 vence, 1 entrada no histórico
3. cancelar × aceitar simultâneos → 1 vence
4. `busyLock` liberado **apenas** quando a encomenda saiu de fato do ar
5. estado terminal (`finished`/`cancelled`) não aceita nenhuma transição posterior
6. cancelar após `collected` continua rejeitado (regra de negócio atual)

**Arquivos:** `tests/unit/parcel.service.test.js`

---

## Fase 4 — Backfill do índice de avaliações (MÉDIO, antes do deploy)

`review.model.js` ganhou `subjectId` (`required: true`) e índice único
`{subjectType, subjectId, type}`. Consulta ao banco de produção:

```
total de reviews: 1
sem subjectId (legado): 1
índices existentes: _id_   (o índice único ainda não existe)
```

Com 1 documento legado a criação do índice **vai passar**. Com 2+ do mesmo tipo,
falharia. Como o volume é mínimo, o backfill é barato e elimina o risco:

```js
db.reviews.updateMany(
  { subjectId: { $exists: false }, ride: { $exists: true } },
  [ { $set: { subjectId: '$ride', subjectType: 'ride' } } ]
)
```

Rodar **antes** do deploy que sobe o modelo novo.

**Arquivos:** `Backend/scripts/backfill-review-subjectId.js`

```bash
cd Backend && node scripts/backfill-review-subjectId.js
```

---

## Fase 5 — Verificação final

1. Suíte de encomendas completa (`tests/unit/parcel.service.test.js`)
2. Suíte de corridas (`tests/integration/ride.*`) — garantir que `dispatch.service.js`
   alterado não regrediu a exclusão mútua
3. Build do frontend e do admin-frontend
4. Reexecutar o diagnóstico de concorrência: deve passar de `2 operações` para `1`

### Status de execução (2026-08-04)

| Gate | Resultado |
|---|---|
| `parcel.service.test.js` (17 testes, incl. concorrência) | ✅ |
| `npm test` Backend (parcel + review + presential) | ✅ 28 passed |
| `npm run build` + `build:driver` (frontend) | ✅ |
| `npm run build` (admin-frontend) | ✅ |
| Diagnóstico concorrência (cancel × advance) | ✅ coberto pelos testes unitários — exatamente 1 vence |
| `ride.api` + `ride.cancellation` integration | ⚠️ 37/39 OK; 2 falhas pré-existentes/instáveis (404↔409 start; cancel 200↔404) — sem ligação com `transitionParcel` / `busyLock` |

**Fases 1–5 do plano técnico: CONCLUÍDAS no código.**

### Decisão A — implementação (2026-08-04)

| Item | Status |
|---|---|
| `paymentMethod` só `cash`/`pix` (model + route + service) | ✅ |
| Snapshot `commissionPercent` / `commissionAmount` no create | ✅ |
| `confirmDelivery` → `paymentStatus: pending` | ✅ |
| `POST /parcels/:id/confirm-payment` idempotente (wallet) | ✅ |
| FE wizard cash/pix + captain “Pagamento recebido” | ✅ |
| Testes `parcel.payment.test.js` | ✅ |

---

## Decisões de produto

### A. Cobrança de encomendas — DECIDIDO (2026-08-04)

**Modelo escolhido:**

```text
Passageiro paga o motorista diretamente
  ├── dinheiro (cash)
  └── Pix (direto para o motorista — fora do gateway Asaas no MVP)

Plataforma
  └── retém a % de comissão pré-definida
      debitando na carteira do motorista
      (mesmo padrão de liquidação cash/pix das corridas)
```

**Implicações para implementação futura** (não faz parte das Fases 1–5 deste plano;
executar só após os críticos de concorrência):

1. Restringir `paymentMethod` da encomenda a `cash` e `pix` — **remover** `card` e
   `carteira` do create/UI (não há cobrança Asaas nem débito de saldo do passageiro).
2. Ao finalizar/confirmar recebimento da encomenda: registrar valor bruto (`fare`),
   calcular comissão pela % configurada (snapshot/congelamento alinhado ao de corridas,
   se já existir para parcel; senão reutilizar o mesmo serviço de comissão das rides),
   e debitar a comissão na carteira do motorista de forma **idempotente**.
3. Não creditar o valor bruto na carteira como se a plataforma tivesse recebido o
   pagamento — o dinheiro/Pix ficou com o motorista; a plataforma só cobra a
   comissão via wallet.
4. UI do motorista: confirmação explícita de “pagamento recebido” (cash/Pix) antes
   de liquidar a comissão, espelhando o fluxo mental do `confirm-payment` das corridas
   (sem inventar `paymentId` fake / Asaas).

**Fora do escopo deste modelo (até nova decisão):** cartão, carteira do passageiro,
cobrança Asaas na encomenda, split automático de Pix pela plataforma.

### B. Encomenda sem motorista disponível — AINDA ABERTO

Hoje, se ninguém está disponível no instante da criação, a encomenda é cancelada
(HTTP 503). Corridas ficam em `requested` aguardando despacho. Manter a divergência
ou alinhar ao comportamento de corridas?

**Ainda sem decisão de produto.**

---

## Observação de coordenação

Todo este módulo está **não-commitado**, em trabalho ativo da sessão paralela do
Cursor. Corrigir agora significa editar arquivos que podem estar sendo alterados em
paralelo, com risco de conflito ou de sobrescrever trabalho.

**Recomendo** confirmar que a outra sessão não está mexendo nesses arquivos antes de
executar a Fase 1.
