# Separar disponibilidade de conexão no despacho de corridas

**Data:** 2026-08-03
**Origem:** achado da auditoria final de push (`docs/plans/2026-08-02-correcao-sistema-notificacoes-push.md`, seção 9), opção 2 — aprovada pelo usuário.
**Objetivo:** destravar os cenários 2 e 3 ("motorista recebe push com o app fechado" e "aceita pelo botão da notificação"), que hoje são inalcançáveis.

## O problema

`isOnline` hoje mistura duas coisas diferentes:
- **Intenção** do motorista ("quero receber corridas") — definida pelo botão "Ficar Online".
- **Conectividade** ("o socket está vivo") — forçada a `false` pelo `disconnect` do socket.

Como `getCaptainsInTheRadius` exige `socketId != null` **e** `isOnline: true`, fechar o app remove o motorista do despacho. Verificado empiricamente na auditoria: motorista com app fechado nunca é candidato, logo nunca recebe a push.

## O que muda

| Campo | Antes | Depois |
|---|---|---|
| `isOnline` | intenção **e** conectividade (zerado no disconnect) | **só intenção** — sobrevive ao fechamento do app; só o motorista (ou o admin) muda |
| `socketId` | conectividade | conectividade (igual — continua nulo no disconnect) |
| `lastSeenAt` (novo) | — | heartbeat: última vez que o servidor teve contato real com o motorista |

**Novo critério de despacho:** `isOnline: true` **E** `lastSeenAt` recente (dentro do TTL) — sem exigir `socketId`.

O `socketId` deixa de ser requisito porque é exatamente ele que some quando o app fecha; o envio em tempo real (`sendMessageToSocketId`) já tolera socket ausente, e o push é justamente o canal para esse caso.

### Por que um TTL, e não "para sempre"

Sem TTL, um motorista que ficou online e fechou o app há três dias continuaria recebendo ofertas — o passageiro esperaria por alguém que não vai responder. O TTL é a válvula de segurança: passado esse tempo sem nenhum contato, ele sai do despacho até reabrir o app.

`CAPTAIN_AVAILABILITY_TTL_MINUTES`, padrão **15 min**, configurável por env. Trade-off explícito: mais alto = mais alcance por push, mais risco de oferta para quem sumiu; mais baixo = o contrário. O risco é atenuado por o despacho ser **broadcast** (todos os motoristas compatíveis recebem a mesma oferta ao mesmo tempo), não uma atribuição a um só.

### Heartbeat — sem código novo no cliente

`lastSeenAt` é atualizado em pontos que já existem e já acontecem periodicamente:
- `join` do socket (abertura/reconexão do app)
- `update-location-captain` (o app do motorista já emite de tempos em tempos)
- `toggle-online` (ato explícito de ficar disponível)

### Tempo online continua correto

Hoje o `disconnect` chama `endOnlineSession()` para o tempo online não contar para sempre. Isso **continua**: no disconnect a sessão de tempo é fechada normalmente — só o `isOnline` é que não é mais mexido. No `join`, se o motorista está `isOnline` e não há sessão aberta, uma nova começa.

Ou seja: `isOnline` = intenção; tempo online = tempo realmente conectado. Deixam de ser a mesma coisa, que é o ponto.

## Arquivos alterados

- `Backend/models/captain.model.js` — campo `lastSeenAt` + índice.
- `Backend/services/captain.service.js` — `availabilityFilter()` novo (definição **única** de "disponível para receber corrida", reusada pelo despacho e pelo painel admin, para não duplicar a regra em dois lugares) e `touchLastSeen()`.
- `Backend/services/maps.service.js` — `getCaptainsInTheRadius` passa a usar `availabilityFilter()`.
- `Backend/socket.js` — `join` e `update-location-captain` atualizam `lastSeenAt`; `disconnect` para de zerar `isOnline` (mas segue fechando a sessão de tempo).
- `Backend/controllers/captain.controller.js` — `toggle-online` grava `lastSeenAt`.
- `Backend/services/admin.service.js` — contagens de "online" passam a usar a mesma definição, para o painel não mostrar como online quem sumiu há dias.
- `Backend/.env.example` — documenta `CAPTAIN_AVAILABILITY_TTL_MINUTES`.

## Riscos de regressão

| Risco | Mitigação |
|---|---|
| Oferta para motorista que sumiu → passageiro espera | TTL + despacho em broadcast (não atribuição única). |
| Painel admin mostrando frota "online" inflada | Contagens usam a mesma `availabilityFilter()` do despacho. |
| Tempo online contando para sempre | `endOnlineSession` continua no disconnect; só o `isOnline` deixa de ser tocado. |
| Motorista reabre o app e se vê "online" sem ter tocado em nada | É o comportamento pretendido (a escolha dele persiste) e é o que já acontece em apps do setor. A UI já lê `captain.isOnline` do perfil, então reflete sozinha. |
| Motorista bloqueado pelo admin | `admin.service.js` já força `isOnline: false` ao bloquear — continua valendo. |

---

## Detalhes da execução

Implementado conforme o plano. Um ponto **não previsto** apareceu e virou parte da entrega (ver "Migração" abaixo).

- `models/captain.model.js` — `lastSeenAt` + índice composto `{isOnline, lastSeenAt}`.
- `services/captain.service.js` — `availabilityFilter()` (definição única, sem `socketId`), `touchLastSeen()`, `AVAILABILITY_TTL_MINUTES` (env `CAPTAIN_AVAILABILITY_TTL_MINUTES`, padrão 15).
- `services/maps.service.js` — `getCaptainsInTheRadius` usa `availabilityFilter()`.
- `socket.js` — `join` grava `lastSeenAt` e reabre a sessão de tempo se o motorista continua disponível; `update-location-captain` grava `lastSeenAt` (heartbeat, sem código novo no cliente); `disconnect` **para de zerar `isOnline`** mas segue fechando a sessão de tempo.
- `controllers/captain.controller.js` — `toggle-online` grava `lastSeenAt`.
- `services/admin.service.js` — as duas contagens de "online" usam a mesma `availabilityFilter()`.
- `.env.example` — `CAPTAIN_AVAILABILITY_TTL_MINUTES` documentado.

### Migração (achado durante a execução, não estava no plano)

A suíte quebrou num teste e expôs um risco real de produção: `{ lastSeenAt: { $gte: <data> } }` **não casa com `null`**, e todo motorista já cadastrado tem esse campo vazio. Sem tratar, **todos os motoristas online sairiam do despacho no momento do deploy** e parariam de receber corridas até reabrir o app.

`scripts/backfill-captain-last-seen.js` (novo) resolve: marca `lastSeenAt = agora` só em quem está `isOnline: true` e ainda não tem o campo. Quem realmente está lá renova em segundos (join/localização); quem sumiu sai sozinho quando o TTL vencer. Idempotente.

**Verificado contra banco em memória:** 2 motoristas online receberam `lastSeenAt`, o offline não foi tocado, e a segunda execução reportou `modifiedCount: 0`.

> **Passo obrigatório de deploy:** rodar `node Backend/scripts/backfill-captain-last-seen.js` uma vez, junto com a subida do código.

### Verificação feita

Novo `tests/integration/captain.availability.test.js` — 8 testes reais, com o mesmo `getCaptainsInTheRadius` e os mesmos endpoints de produção:

1. **Motorista com o app fechado (sem socket) é despachado** — o caso que era impossível antes.
2. **CENÁRIO 2 ponta a ponta:** passageiro cria corrida e o motorista com o app fechado recebe a notificação push gravada.
3. Motorista sem contato além do TTL sai do despacho.
4. Motorista que escolheu ficar offline não é despachado, mesmo com socket vivo.
5. Motorista bloqueado não é despachado, mesmo disponível e recém-visto.
6. `toggle-online` grava `lastSeenAt`.
7. `endOnlineSession` fecha a contagem de tempo **sem** derrubar a disponibilidade.
8. Tempo online não conta enquanto o motorista está disponível porém desconectado.

- **Backend:** 19 suites, **144 testes**, todos passando — sem regressão em corridas, pagamentos, sessão ou painel.
- **Builds:** `frontend` e `admin-frontend` OK.

### Efeito nos cenários que estavam bloqueados

| # | Cenário | Antes | Agora |
|---|---|---|---|
| 2 | Motorista recebe push com app fechado | ❌ inalcançável | ✅ testado ponta a ponta |
| 3 | Motorista aceita pelo botão da notificação | ⚠️ inalcançável na prática | ✅ alcançável — o aceite pelo SW já estava pronto desde a Fase 1 e agora tem como ser exercitado (confirmação final exige navegador + Firebase reais) |
