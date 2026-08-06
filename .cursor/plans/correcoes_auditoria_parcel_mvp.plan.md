---
name: Correções auditoria Parcel MVP
overview: Corrigir achados P0/P1/P2 da auditoria hostil do serviço de Encomendas — exclusão mútua ride↔parcel, órfãos awaiting, privacidade da oferta, tracking/UX, rating/persistência, hardening de PIN/accept e pipeline de testes — sem expandir escopo do MVP (fotos reais, agendamento, pagamento digital fora).
todos:
  - id: p0-mutual-exclusion
    content: "P0: exclusão mútua user ride↔parcel (createRide BE + Home FE) + índice único parcial user ativo"
    status: completed
  - id: p0-orphan-expire
    content: "P0: auto-expire awaiting_provider + cancel quando dispatch retorna 0 captains (opcional requeue)"
    status: completed
  - id: p1-offer-pii
    content: "P1: sanitizar payload new-parcel / pending (sem telefones; PII só pós-aceite)"
    status: completed
  - id: p1-accept-guards
    content: "P1: accept revalida raio + online + vehicle; rate-limit confirm-delivery"
    status: completed
  - id: p1-tracking-parcel
    content: "P1: LiveTracking seed captainLocation + status/fase parcel + navigationMode no CaptainParcelRiding"
    status: completed
  - id: p1-rating-persist
    content: "P1: rating captain via API; skip passageiro definitivo; sync context nos sockets"
    status: completed
  - id: p1-tests-ci
    content: "P1: parcel tests compatíveis com vitest OU npm test aponta Jest para unit parcel"
    status: completed
  - id: p2-cancel-ux
    content: "P2: alinhar cancel FE↔BE; opcional captain-cancel; push cancel/status mínimos"
    status: completed
  - id: p2-compat-admin
    content: "P2: blockIncompatibleMoto default/UX admin; whitelist updateSettings; weight max"
    status: completed
  - id: p2-ops-hardening
    content: "P2: busyLock recovery; parcel-taken usa ref; oferta com som/card; delivered status opcional"
    status: completed
  - id: gates
    content: "Gates: Jest parcel+review, builds web/driver/admin, smoke checklist E2E"
    status: completed
---

# Plano completo — Correções pós-auditoria Parcel (MoveCity)

## Objetivo

Deixar o MVP de Encomendas **usável em produção controlada** (piloto), fechando bloqueadores e críticos da auditoria, sem implementar features de fase 2 (fotos reais, schedule, pagamento digital, Capacitor).

## Veredito de partida

- Núcleo saudável: accept atômico, PIN crypto, transitions, despacho real, busyLock no accept, chat/review.
- Bloqueadores: exclusão mútua assimétrica, órfãos `awaiting_provider`, privacidade da oferta, tracking parcel truncado, CI de testes.

## Princípios

1. Backend continua fonte da verdade.
2. Correções mínimas e cirúrgicas — espelhar padrões já usados em Ride.
3. Cada fase termina com testes/gates antes da próxima.
4. Não “corrigir” com mocks ou dados estáticos.

---

## Fase 0 — Preparação (curta)

- Branch: `fix/parcel-audit-p0-p1` (ou trabalhar em `main` se for o fluxo do time).
- Checklist de regressão Ride já existente: create → accept → start → finish → cancel.
- Confirmar scripts: `Backend` Jest unit parcel vs `npm test` vitest.

---

## Fase 1 — P0 exclusão mútua e órfãos

### 1.1 User não pode ter ride + parcel ativos

**Backend**
- Em [`Backend/services/ride.service.js`](Backend/services/ride.service.js) `createRide`: antes de criar, `parcelModel.exists` com os mesmos status ativos de user usados em parcel (`awaiting_provider`…`delivered` / alinhado a `USER_ACTIVE_PARCEL_STATUSES`).
- Erro tipado `USER_HAS_ACTIVE_PARCEL` → controller ride responde **409**.
- Em [`Backend/models/parcel.model.js`](Backend/models/parcel.model.js): índice único parcial `user_active_parcel_unique` espelhando a lista de status ativos do user (incluir `awaiting_provider`; decidir se inclui `delivered` legado).
- Tratar `11000` no create parcel como 409.

**Frontend**
- [`frontend/src/passenger/pages/Home.jsx`](frontend/src/passenger/pages/Home.jsx): em `findTrip` / `createRide`, se `userParcel` ativo → toast + redirect `/encomenda/ativa` (espelhar bloqueio do botão Encomenda).

**Testes**
- Unit: createRide com parcel ativa falha.
- Unit: double-create parcel race (dois creates) → um 409 / unique.

### 1.2 Expiração e órfãos `awaiting_provider`

**Política proposta (igual espírito do Ride ~10min)**
- Constante compartilhada `PARCEL_EXPIRATION_MINUTES = 10`.
- Em `getCurrentParcelForUser` / `getPendingParcelsForCaptain` / create path: se `awaiting_provider` e `createdAt` < cutoff → `cancelParcelSystem(id, 'expired')` + socket `parcel-cancelled` se possível.
- Em `createParcel` controller: se `dispatchParcelToCaptains` retorna `0` captains, **não** deixar órfão eterno:
  - Opção A (recomendada MVP): cancel imediato `no_providers` + 503/409 com mensagem clara.
  - Opção B: manter 2–3 min e cron; mais complexo — só se produto exigir “esperar motorista”.

**Recomendação:** Opção A no create (0 captains = falha clara) + expire lazy no getCurrent/pending para docs já existentes.

**Testes:** create com 0 captains → cancelled; getCurrent de awaiting velho → cancelled/null.

### Gates Fase 1
- Jest parcel + novo teste ride create vs parcel.
- Smoke mental: user com parcel não cria ride; awaiting expira.

---

## Fase 2 — P1 segurança e aceite

### 2.1 Sanitizar oferta (PII)

Arquivo: [`Backend/controllers/parcel.controller.js`](Backend/controllers/parcel.controller.js)

- Função `toParcelOfferDTO(parcel)`:
  - Inclui: `_id`, fare, pickup/destination (+ coords), vehicleType, itemName, size, weightKg, category, status, estimated*.
  - **Exclui:** `deliveryPin`, `sender.phone`, `recipient.phone`, e preferencialmente nomes completos até o aceite (ou só primeiro nome).
- Usar no `new-parcel`, e em `getPending` (service map to DTO).
- Pós-aceite (`accept` response + `parcel-confirmed` ao user; tela captain riding): liberar sender/recipient completos para o captain dono.

### 2.2 Accept com prova de elegibilidade

Em `acceptParcelAtomic`:
1. Captain `isOnline`, não blocked, `canReceiveRides`, `approvalStatus === 'aprovado'` (já parcial).
2. Recarregar `location` do captain; haversine vs `pickupCoordinates` ≤ `CAPTAIN_SEARCH_RADIUS_KM`.
3. Se parcel sem `pickupCoordinates`, geocode ou rejeitar.
4. Manter busyLock + findOneAndUpdate + unique index.

Mensagens de erro distintas: `OUT_OF_RANGE`, `CAPTAIN_OFFLINE`, etc.

### 2.3 PIN — rate limit

- `express-rate-limit` (já no projeto) em `POST /parcels/:id/confirm-delivery`: ex. 5 tentativas / 10 min por captain+parcelId (key custom) ou por IP+captain.
- Resposta 429 sem revelar se PIN existe.
- Opcional P2: delay incremental — não obrigatório na primeira leva.

### 2.4 Pipeline de testes

Escolher **uma** estratégia (evitar dual quebrado):

- **Preferida:** migrar `parcel.service.test.js` / `parcel.review.test.js` para API vitest (`vi.mock`) **ou**
- Fazer `npm test` / CI rodar `jest tests/unit/parcel*.test.js` explicitamente.

Incluir upload ImageKit no mesmo runner que funciona hoje (Jest).

### Gates Fase 2
- Teste: offer DTO sem phone.
- Teste: accept fora do raio falha.
- `npm test` (ou script CI documentado) verde para parcel.

---

## Fase 3 — P1 frontend tracking, rating, sync

### 3.1 LiveTracking parcel-aware

Arquivo: [`frontend/src/shared/components/LiveTracking.jsx`](frontend/src/shared/components/LiveTracking.jsx)

- Seed inicial: usar `props.captainLocation` **ou** `props.ride?.captain?.location` (unificar).
- Aceitar `props.status` / `props.parcelStatus` (ou `subjectStatus`) para `headingToPickup`:
  - Parcel: `provider_accepted | going_to_pickup | arrived_pickup` → rota captain→pickup.
  - Depois: pickup→destination / captain→destination.
- HUD de fase: labels para status parcel (espelhar ride chips de forma mínima).
- [`ParcelActive.jsx`](frontend/src/passenger/pages/parcel/ParcelActive.jsx): passar `status={parcel.status}` + `captainLocation`.
- [`CaptainParcelRiding.jsx`](frontend/src/driver/pages/CaptainParcelRiding.jsx): `navigationMode={true}` como `CaptainRiding` (mínimo viável).

### 3.2 Rating / skip / context

**Passageiro**
- Skip definitivo: backend `POST /parcels/:id/skip-review` (ou flag `reviewSkippedAt` no parcel / review placeholder type) **ou** `getCurrent` deixa de devolver finished se query `?includeFinished=0` e FE grava `localStorage` `parcel-review-skipped:<id>` **e** RideContext respeita.
- **Recomendado BE:** campo `passengerReviewSkippedAt` no parcel; getCurrent retorna null se finished && (reviewed || skipped).

**Motorista**
- `getCurrentParcelForCaptain` (ou endpoint `captain-current-review`): devolver finished sem `driver_to_passenger` review (espelhar user).
- Não zerar `captainParcel` até skip/review; restore inclui finished pendente de review.

**Sockets**
- `ParcelActive`: em updates, também `setUserParcel(data)`.
- `CaptainHome` `handleParcelTaken`: usar `parcelOfferRef` (padrão ride).

### 3.3 Oferta UX (mínimo P1/P2)

- Som/vibração em `handleNewParcel` espelhando `handleNewRide`.
- Card “Encomenda disponível” se popup fechado (opcional na mesma fase ou Fase 4).

### Gates Fase 3
- Builds frontend + driver.
- Checklist: refresh na ativa mostra captain após seed; F5 na rating captain recupera; skip passageiro não reabre após reload.

---

## Fase 4 — P2 alinhamento produto / ops

### 4.1 Cancel

- FE `ParcelActive`: botão cancel até `in_transit` (igual BE) **ou** restringir BE aos status pré-coleta — **escolher uma política** e documentar.
  - Recomendado produto MVP: cancel user só até `arrived_pickup` (antes de coletar); BE e FE iguais.
- Opcional: `POST /parcels/:id/captain-cancel` nos mesmos status pré-coleta + release lock + socket.

### 4.2 Push

- Mínimo: push cancel ao captain (`sendParcelCancelled`) e aceite ao user (se ainda não houver).
- Status intermediários: P4 / fase futura.

### 4.3 Compatibilidade e admin

- Default `blockIncompatibleMoto: true` **ou** manter false mas expor toggle + `motoMaxSize` na UI admin [`Parcels.jsx`](admin-frontend/src/pages/Parcels.jsx).
- `updateSettings`: whitelist de campos (`baseFare`, `perKm`, …).
- `weightKg` max razoável (ex. 100) no validator + schema.

### 4.4 busyLock recovery

- Em accept falho já libera; adicionar: se `busyLock===true` mas `!captainHasActiveRide && !captainHasActiveParcel` → auto-release no acquire ou job leve no getPending/accept.

### 4.5 Status `delivered`

- Decisão: (A) manter jump finished + history, documentar; ou (B) set `delivered` então `finished` em um update (já quase) com status final `finished`. Documentar no código que `delivered` no enum é histórico/legado.

### 4.6 Chat push deep link

- Dispatcher: se `subjectType===parcel'` → `/captain-parcel` / `/encomenda/ativa`.

---

## Fase 5 — Gates finais e smoke E2E

### Automatizado
```text
cd Backend && npx jest tests/unit/parcel.service.test.js tests/unit/parcel.review.test.js --forceExit
# + novos testes exclusão / expire / DTO / accept range
cd frontend && npm run build && npm run build:driver
cd admin-frontend && npm run build
```

### Smoke manual (2 devices / 2 browsers)
1. Passageiro cria encomenda moto → motorista recebe oferta (sem telefone) → aceita.
2. Segundo motorista → 409 / parcel-taken.
3. Fluxo status até PIN → finished → reviews.
4. Com parcel ativa, passageiro tenta corrida → bloqueado FE+BE.
5. Create com 0 motoristas online → erro claro, sem parcel presa.
6. Refresh passageiro mid-flow e motorista mid-flow.
7. Cancel nos status acordados.
8. Ride feliz path (regressão).

---

## Ordem de implementação sugerida

```text
Fase 1 (P0) → Fase 2 (P1 BE/segurança) → Fase 3 (P1 FE) → Fase 4 (P2) → Fase 5 (gates)
```

Não paralelizar Fase 1 com features novas. Fase 2 e 3 podem em paralelo após 1.1 (mutua exclusão) estável.

---

## Fora de escopo (explícito)

- Upload real de fotos pickup/delivery
- Agendamento (`schedule.at`)
- Pagamento digital / carteira na encomenda
- Capacitor nativo
- Histórico Activity de parcels
- Turn-by-turn perfeito além do `navigationMode` já existente no ride
- Troca ImageKit (já migrado)

---

## Matriz ID auditoria → tarefa

| ID auditoria | Fase | Todo |
| ------------ | ---- | ---- |
| Exclusão mútua user / createRide | 1 | p0-mutual-exclusion |
| awaiting eterno / 0 captains | 1 | p0-orphan-expire |
| Telefones na oferta | 2 | p1-offer-pii |
| Accept sem raio; PIN rate limit | 2 | p1-accept-guards |
| LiveTracking / nav parcel | 3 | p1-tracking-parcel |
| Rating/skip/context | 3 | p1-rating-persist |
| vitest/jest CI | 2 | p1-tests-ci |
| Cancel FE/BE; push | 4 | p2-cancel-ux |
| Compat/admin/settings | 4 | p2-compat-admin |
| busyLock, parcel-taken ref, som | 4 | p2-ops-hardening |

---

## Critério de “pronto”

```text
✅ APROVADO PARA MVP (piloto)
```

quando:
- Nenhum P0 aberto
- P1 de exclusão, PII, expire, tracking seed, rating persist, testes CI fechados
- Smoke E2E + regressão Ride OK
- P2 restantes documentados como backlog aceito
