# Plano de correção — Agendamento de Corrida + Encomenda (produção)

Data: 2026-08-05  
Origem: auditoria profunda de agendamento (SCH-C1…SCH-B2)  
Estado atual: **NÃO pronto para produção** (~35–50% de completude)

---

## Objetivo

Deixar agendamento de **corrida** e **encomenda** operáveis em produção controlada:

1. Ativação no horário correto sem ser morta pelo expire de `createdAt`.
2. Despacho confiável com retry / sem motorista explícito.
3. Lista do motorista sem vazamento global de PII.
4. Cancelamento, notificações e financeiro coerentes com o ciclo “agenda → ativa → roda”.
5. Testes que travem as regressões críticas.

**Fora de escopo deste plano:** redesenho completo do Pricing Engine, Capacitor nativo, agendamento recorrente, split de Pix Asaas.

---

## Princípios

1. Backend continua fonte da verdade; FE não inventa estado.
2. Cirúrgico: reutilizar despacho/accept/finish/wallet existentes após a ativação.
3. Cada fase termina com gate (teste ou checklist) antes da próxima.
4. Preferir `activatedAt` a “resetar `createdAt`” — não mentir sobre quando o pedido nasceu.

---

## Mapa do alvo (após correção)

```text
Create (scheduledAt válido)
  → status: scheduled  (sem despacho, sem liquidação financeira precoce*)
  → cron (1/min) find due: scheduledAt <= now + ACTIVATE_AHEAD
  → CAS: scheduled → activating/requested|awaiting_provider + activatedAt
  → dispatch (raio 15km) + push
  → se 0 captains: retry N vezes OU status no_driver / cancel explícito + notifica user
  → expire/pending usam activatedAt (ou scheduledAt), NÃO createdAt puro
  → aceite → fluxo normal ride/parcel
```

\* Fase 4 detalha o que fazer com payment/wallet/promo no booking.

---

## Inventário de achados → fases

| ID | Sev | Resumo | Fase |
|----|-----|--------|------|
| SCH-C1 | 🔴 | Expire/pending ride usa `createdAt` pós-activate | 1 |
| SCH-C2 | 🔴 | Expire parcel `awaiting_provider` usa `createdAt` | 1 |
| SCH-C3 | 🔴 | Captain upcoming = dump global | 1 |
| SCH-A1 | 🟠 | Falha dispatch após claim → zumbi | 1–2 |
| SCH-A2 | 🟠 | Ride sem `no_driver` / retry | 2 |
| SCH-A3 | 🟠 | Wallet/promo/payment no create agendado | 4 |
| SCH-A4 | 🟠 | UX fraca + stub ScheduleRidePanel | 5 |
| SCH-M1 | 🟡 | Índice + sort no cron | 2 |
| SCH-M2 | 🟡 | validationResult no cancel | 2 |
| SCH-M3 | 🟡 | Cancel assimétrico / lista some pós-activate | 2–5 |
| SCH-M4 | 🟡 | Ativação 10 min sem comunicar | 5 |
| SCH-B1 | 🔵 | Zero testes schedule | 6 |
| SCH-B2 | 🔵 | Código morto ScheduleRidePanel | 5 |

---

## Fase 1 — Bloqueadores críticos (impedem produção)

### 1.1 Campo `activatedAt` + clock de vida pós-ativação

**Problema:** ao virar `requested` / `awaiting_provider`, a janela de 10 min continua medida desde `createdAt` (pode ter dias).

**Backend**

1. `ride.model.js` e `parcel.model.js`: adicionar `activatedAt: Date | null`.
2. Em `schedule.service.js` no claim de ativação:
   - setar `activatedAt: new Date()` junto com a mudança de status.
3. `ride.service.js`:
   - `getCurrentRide` auto-expire de `requested`: usar  
     `const clock = ride.activatedAt || ride.createdAt`.
   - `getPendingRidesForCaptain`: filtro  
     `{ $or: [ { activatedAt: { $gte: cutoff } }, { activatedAt: null, createdAt: { $gte: cutoff } } ] }`  
     (corridas imediatas seguem com `activatedAt` null e `createdAt`).
4. `parcel.service.js` `expireStaleAwaitingParcels`:
   - mesmo critério com `activatedAt || createdAt`.

**Gate**

- Teste integração: criar ride com `scheduledAt` no passado recente forçado via DB + `createdAt` antigo → activate → ainda aparece em pending e **não** é expirada no `getCurrentRide` nos primeiros 10 min após `activatedAt`.

**Arquivos:** `ride.model.js`, `parcel.model.js`, `schedule.service.js`, `ride.service.js`, `parcel.service.js`, novos testes.

---

### 1.2 Lista captain sem vazamento (SCH-C3)

**Problema:** qualquer motorista autenticado vê todos os agendamentos das próximas 24h com endereço/fare.

**Backend — `listCaptainUpcoming(captain)`**

1. Exigir captain online/aprovado (ou pelo menos não bloqueado); se offline, retornar `[]` ou só contagem ofuscada (decisão: retornar `[]` se offline).
2. Filtrar por `vehicleType` do captain.
3. Filtrar por proximidade: geocode já em `pickupCoordinates` **ou** geocode lazy no create agendado (preferir persistir `pickupCoordinates` já no create schedule, espelhando despacho).
4. Raio: mesmo `CAPTAIN_SEARCH_RADIUS_KM` (15) via haversine / `$nearSphere` se houver GeoJSON; senão haversine sobre lat/lng salvos.
5. DTO ofuscado pré-despacho (igual espírito de `toParcelOfferDTO`):  
   - rua curta / bairro, sem telefone, sem nome de cliente, fare ok, horário ok, kind ok.
6. Limite 20, sort `scheduledAt` asc.

**Frontend**

- `CaptainScheduled.jsx` / card Home: adaptar a campos do DTO (não quebrar se faltar endereço longo).

**Gate**

- Teste: captain A longe do pickup não vê o item; captain B no raio + mesmo vehicle vê; resposta sem PII de user/recipient.

**Arquivos:** `schedule.service.js`, `schedule.controller.js`, opcionalmente create ride/parcel para gravar `pickupCoordinates` cedo, FE captain.

---

### 1.3 Claim + despacho à prova de falha (SCH-A1)

**Problema:** após CAS para `requested`/`awaiting_provider`, se `dispatch*` falha, o doc fica zumbi.

**Backend — `activateDueRides` / `activateDueParcels`**

Opção recomendada (simples e segura):

1. Em falha de despacho (exception):  
   - **não** deixar órfão silencioso;  
   - setar `dispatchLastError`, `dispatchAttempts++`;  
   - se `dispatchAttempts < MAX` (ex.: 5): **reverter** para `status: 'scheduled'` mantendo `scheduledAt` (e limpar `activatedAt`) **ou** manter status intermediário `dispatch_pending` (ver 2.1).  
2. Preferência MVP: campo opcional `status: 'scheduled'` + `activatedAt: null` + `dispatchAttempts`, e próxima rodada do cron tenta de novo enquanto `scheduledAt <= cutoff` **ou** `dispatchAttempts > 0 && status scheduled`.  
3. Alternativa mais limpa (Fase 2): status `activating` / `dispatch_pending` com TTL.

Para Fase 1 mínima aceitável:

- try/catch: se dispatch lança → `findOneAndUpdate` de volta para `scheduled` + `activatedAt: null` + log; cron retenta.
- Se dispatch retorna 0 captains: **não** reverter eternamente — ir para política Fase 2 (`no_driver` / cancel após N tentativas).

**Gate**

- Mock `dispatchRideToCaptains` throw → documento volta `scheduled` e é retentado.

---

### Gate Fase 1

- [ ] Testes C1/C2 passam  
- [ ] Upcoming filtrado + DTO  
- [ ] Retry/revert em falha de dispatch  
- [ ] `npm test` Backend (suíte schedule + parcel/ride unit relevantes)

---

## Fase 2 — Integridade de estados e jobs

### 2.1 Estados explícitos (opcional mas recomendado)

Mínimo viável sem explodir a máquina atual:

| Status | Uso |
|--------|-----|
| `scheduled` | Aguardando janela |
| `requested` / `awaiting_provider` | Já no pool (como hoje) |
| `cancelled` + `cancellationReason: no_drivers` | Esgotou tentativas |
| (opcional) `no_driver` | Se quiser UI distinta; senão `cancelled` basta |

**Ride activate com 0 captains**

Hoje parcel cancela; ride fica `requested`. Alinhar:

1. Contador `dispatchAttempts` no ride/parcel.  
2. A cada activate/cron: se 0 captains, `dispatchAttempts++`, manter `requested`/`awaiting_provider` por até `MAX_DISPATCH_ROUNDS` (ex. 6 ≈ 6 min se cron 1/min) **desde `activatedAt`**.  
3. Ao esgotar: cancel system + notificar user (Fase 3).  
4. Expire de pending continua baseado em `activatedAt` (Fase 1), alinhado a essa janela (ex. 10–15 min).

### 2.2 Índices e cron

```js
// ride + parcel
{ status: 1, scheduledAt: 1 }
{ status: 1, activatedAt: 1 } // opcional
```

Cron:

```js
.find({ status: 'scheduled', scheduledAt: { $lte: cutoff } })
.sort({ scheduledAt: 1 })
.limit(20)
```

### 2.3 Cancel unificado

1. `VALID_ORIGINS_BY_TARGET.cancelled` da ride: incluir `'scheduled'`.  
2. `POST /rides/cancel` e `POST /schedules/mine/cancel` podem coexistir; schedules continua sendo a API da lista.  
3. Controller cancel schedule: chamar `validationResult`.  
4. Após activate, lista “Agendamentos” do user deve incluir:
   - `scheduled`, **e**
   - `requested`/`awaiting_provider` com `scheduledAt != null` até aceite ou cancel  
   (senão o user “perde” o pedido na UI).

### 2.4 Persistência de coordenadas no booking

No `createRide` / `createParcel` quando `scheduledAt`:

- Resolver `pickupCoordinates` (e dest se barato) e gravar — alimenta upcoming por raio e acelera despacho.

### Gate Fase 2

- [ ] Índices sync nos testes  
- [ ] Ride 0 captains → cancel/no_driver após N rounds  
- [ ] Cancel `scheduled` via `/rides/cancel`  
- [ ] Lista user mostra pós-activate pré-aceite  

---

## Fase 3 — Operação (notificações, sockets, recuperação)

### 3.1 Notificações mínimas

| Evento | Destinatário | Tipo sugerido |
|--------|--------------|---------------|
| Agendamento criado | User | push/in-app (opcional toast FE já existe) |
| Lembrete T−30 min | User | push (`SCHEDULE_REMINDER`) — pode ser fase 3b |
| Ativação / buscando | User | push “Estamos buscando motorista” |
| 0 motoristas / cancel system | User | push obrigatório |
| Oferta | Captain | já existe NEW_RIDE / NEW_PARCEL |

Implementar helpers em `notificationDispatcher.service.js` + enum em `notification.model.js` (`SCHEDULE_REMINDER`, `SCHEDULE_ACTIVATED`, `SCHEDULE_NO_DRIVER` ou reusar `ADMIN`/`RIDE_CANCELLED` com cuidado — **preferir tipos novos** para não confundir analytics).

### 3.2 Socket (opcional MVP)

- `schedule-activated` / `schedule-cancelled` para o user room se conectado.  
- Não depender de socket para persistência (já no DB).

### 3.3 Observabilidade

Logs estruturados já parciais (`[SCHEDULE]`). Acrescentar:

- `activated`, `dispatch_count`, `reverted`, `no_drivers_final`.  
- Contador métrica simples (log) por tick do cron.

### 3.4 Multi-instância (se Render scale > 1)

MVP aceitável: CAS por documento (já previsto).  
Se scale-out agressivo: lock Redis `schedule:cron` TTL 50s — **só se** já houver Redis em prod; senão documentar “single web dyno” como restrição operacional.

### Gate Fase 3

- [ ] Push no_driver / cancel system coberto por teste de dispatcher (padrão NEW_PARCEL)  
- [ ] Activate emite notificação user  

---

## Fase 4 — Financeiro

### 4.1 Política (decisão de produto — registrar no PR)

**Recomendado para produção:**

```text
No create com scheduledAt:
  - calcula e CONGELA fare + commission snapshot (já feito)
  - NÃO debita carteira
  - NÃO marca payment approved
  - NÃO recordPromotionUsage (ou reserva cupom sem consumir)

Na ativação OU no finish (escolher um):
  - consumir cupom / wallet conforme regra das corridas imediatas
```

**MVP mais seguro e menor diff:**

1. Se `parsedSchedule`: forçar `useWalletBalance = false` no create; não criar `payment` ainda **ou** criar `payment` `status:'scheduled'` sem capturar.  
2. Promo: não chamar `recordPromotionUsage` no booking; reaplicar na ativação com o mesmo código salvo em campo `promoCodeScheduled` (se houver).  
3. Parcel: já não liquida no create — OK; só garantir que cancel agendado não tente wallet.

### 4.2 Cancelamento e estorno

- Cancel `scheduled` antes de activate: sem taxa, sem comissão.  
- Cancel após activate + captain assigned: reutilizar regras atuais de `cancelRide` / parcel.  
- Se wallet foi debitada por bug antigo em docs legados: script one-off de auditoria (não no hot path).

### Gate Fase 4

- [ ] Create scheduled ride com `useWalletBalance:true` → 400 ou ignora sem debitar  
- [ ] Finish após schedule → commission idempotente (teste existente de confirm-payment + um caso schedule)  

---

## Fase 5 — UX

### 5.1 Passageiro

1. Remover ou desconectar de vez `ScheduleRidePanel` (alert stub) da Home.  
2. `ScheduleRide.jsx`:  
   - autocomplete de endereço (reusar Home/maps suggestions se viável; senão manter texto mas mostrar **get-fare** preview).  
   - texto: “Começamos a buscar motorista cerca de 10 minutos antes do horário.”  
3. `Scheduled.jsx`:  
   - mostrar itens activated (`requested`/`awaiting_provider` + `scheduledAt`);  
   - CTA “Acompanhar” → `/home` ou `/encomenda/ativa` quando aplicável;  
   - cancel conforme status.  
4. Parcel: após activate, garantir que `getCurrent` devolve e PIN aparece (já com `activatedAt` fix).  
5. Account já linka Agendamentos — manter.

### 5.2 Motorista

1. Card Home: badge só com count do upcoming **filtrado**.  
2. `CaptainScheduled`: empty state claro; sem dados sensíveis.  
3. Não permitir “aceitar” da lista de agenda (só informativo até virar oferta real) — documentar na UI.

### Gate Fase 5

- [ ] Build frontend + driver  
- [ ] Checklist manual smoke (abaixo)  

---

## Fase 6 — Testes

### 6.1 Unit (`tests/unit/schedule.service.test.js`)

1. `assertValidScheduledAt` too soon / too far / ok  
2. `cancelUserScheduled` ownership  
3. `activateDueRides` CAS: dois activates → 1  
4. activate + dispatch throw → volta `scheduled`  
5. `listCaptainUpcoming` filtra raio/vehicle (mock location)

### 6.2 Integration

1. POST create ride scheduled → 201, status scheduled, **sem** dispatch (spy)  
2. Force activate → pending vê captain no raio; createdAt antigo não expira  
3. Parcel schedule → activate → 0 captains → cancelled reason  
4. GET captain upcoming isolation  
5. Cancel mine + validation 400  

### 6.3 Matriz E2E manual (smoke pré-prod)

| # | Passo | Esperado |
|---|--------|----------|
| 1 | Agendar corrida +20 min | Aparece em /scheduled |
| 2 | Cancelar | Some; status cancelled |
| 3 | Agendar +16 min; esperar activate | Push motorista; pending; user notificado |
| 4 | Aceitar → finish → confirm-payment | Wallet/comissão ok |
| 5 | Agendar encomenda; activate sem motorista | Cancel + aviso user |
| 6 | Captain longe | Não vê na lista agendados |
| 7 | Restart API no meio da espera | Ainda ativa no horário |

### Gate Fase 6

- [ ] Suíte schedule no `npm test`  
- [ ] Smoke checklist assinada  

---

## Ordem de execução recomendada (sprints)

| Sprint | Escopo | Duração guia |
|--------|--------|----------------|
| S1 | Fase 1 completa | 1–2 dias |
| S2 | Fase 2 | 1 dia |
| S3 | Fase 3 (pushes essenciais) | 0,5–1 dia |
| S4 | Fase 4 financeiro booking | 0,5–1 dia |
| S5 | Fase 5 UX + remover stub | 0,5–1 dia |
| S6 | Fase 6 testes + smoke | 1 dia |

**Não abrir produção** até S1 + S2 + smoke 1–3 e 6.  
S3–S5 podem entrar no mesmo release se o tempo permitir; S4 é obrigatória se carteira/promo estiverem ligados no create.

---

## Critérios de “pronto para produção”

1. SCH-C1 e SCH-C2 fechados com teste automatizado.  
2. SCH-C3 fechado (upcoming filtrado + DTO).  
3. Activate com falha de dispatch não deixa zumbi permanente.  
4. Ride/parcel sem motorista após N tentativas: estado terminal + user avisado.  
5. Cancel pré-activate confiável; lista user coerente pós-activate.  
6. Sem débito de carteira no booking (ou feature flag documentada).  
7. Stub `ScheduleRidePanel` removido/desligado.  
8. Testes schedule no CI (`npm test`).  
9. Smoke E2E manual OK em staging.

---

## Riscos da correção

| Mudança | Risco | Mitigação |
|---------|-------|-----------|
| Trocar clock de expire | Regredir expire de ride imediata | Branch `activatedAt \|\| createdAt` |
| Upcoming com raio | Lista vazia se sem coords | Gravar coords no create schedule |
| Reverter activate em erro | Loop de activate | `dispatchAttempts` + backoff / max |
| Atrasar payment/wallet | Mudança de comportamento | Feature flag `SCHEDULE_DEFER_PAYMENT=true` |
| Novos tipos FCM | Enum notification | Igual fix NEW_PARCEL |

---

## Decisões de produto ainda abertas (bloquear só se afetar S1)

1. **Antecedência de busca:** manter 10 min ou tornar configurável (`globalSetting.scheduleActivateAheadMinutes`)?  
2. **Upcoming offline:** esconder tudo vs mostrar count opaco?  
3. **Preço:** congelado no booking (atual) vs recalcular na ativação?  
4. **Sem motorista:** cancel automático vs manter `scheduled` e remarcar?

**Default deste plano se não houver resposta:**  
(1) 10 min configurável depois; (2) esconder se offline; (3) congelar no booking; (4) cancel após N rounds + notificar.

---

## Arquivos principais a tocar

| Área | Paths |
|------|--------|
| Models | `Backend/models/ride.model.js`, `parcel.model.js`, `notification.model.js` |
| Schedule | `Backend/services/schedule.service.js`, `controllers/schedule.controller.js`, `routes/schedule.routes.js` |
| Ride/Parcel | `Backend/services/ride.service.js`, `parcel.service.js`, creates nos controllers |
| Dispatch/Notify | `notificationDispatcher.service.js` |
| FE pass | `ScheduleRide.jsx`, `ScheduleHub.jsx`, `Scheduled.jsx`, `ParcelWizard.jsx`, `Home.jsx`, remover stub panel |
| FE driver | `CaptainScheduled.jsx`, `CaptainHome.jsx` |
| Tests | `Backend/tests/unit/schedule.service.test.js`, integration schedule.* |

---

## Veredito do plano

Este plano fecha os **três bloqueadores de produção** (expire×createdAt, vazamento upcoming, zumbi pós-dispatch) e depois alinha estados, ops, financeiro e UX.

**Ordem de merge sugerida:** S1 → S2 → (S4 se wallet em uso) → S3/S5 → S6 → release.

Quando autorizar a execução, começar pela **Fase 1.1 (`activatedAt`)** — sem ela o resto do agendamento continua fundamentalmente quebrado.
