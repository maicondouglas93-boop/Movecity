# Execução — Bloco I (Auditoria Unificada) — Painel Administrativo

**Base:** [auditoria do painel administrativo, 2026-08-02](2026-08-02-auditoria-painel-administrativo.md), §12, Bloco I do Plano de Correção.
**Escopo:** ações administrativas sem registro nenhum, IP fixo em `'0.0.0.0'` em várias, e a tela de Logs sem filtro nem busca — inutilizável em qualquer volume real.
**Status:** ✅ concluído e verificado em 2026-08-02. Nada commitado.

## Ponto de partida real (recontado no código antes de planejar — os números do relatório original mudaram por causa dos blocos anteriores)

Recontei `logAction` (controller + service, já que algumas ações logam numa camada e outras na outra) em todas as rotas de escrita de `admin.routes.js`. Ações **sem nenhum registro hoje**:

| Ação | Rota |
|---|---|
| `sendNotification` | `POST /admin/notifications` (legado, mas ainda roteável) |
| `createCampaign` | `POST /admin/campaigns` |
| `cancelCampaign` | `POST /admin/campaigns/:id/cancel` |
| `updatePromotionStatus` | `PUT /admin/promotions/:id/status` |
| `addUserObservation` | `POST /admin/users/:id/observations` |
| `scheduleTariff` | `POST /admin/tariffs/schedule` |

(O relatório original contava 7; a diferença é porque `createVehicleCategory`/`duplicateCategory` — que eu tinha marcado como sem log numa contagem anterior — na verdade logam via `tariffHistoryModel.create` no controller, e não achei um sétimo caso genuíno nesta recontagem.)

**IP hardcoded em `'0.0.0.0'`** (função nem recebe o parâmetro `ip`, não é só um fallback): `updateUserTags`, `updateCaptainDocument`, `cancelRide` (admin), `bulkActionRides`.

**Bug real encontrado ao investigar (não estava no relatório original)**: `getCaptainTimeline` (usado pela aba "Auditoria" do CRM de motoristas, `TabAudit` em `Captains.jsx` — um dos achados *positivos* da auditoria original) chama `module.exports.getLogs(1, 50, '', { targetId: captainId.toString() })`, mas a assinatura real de `getLogs` hoje é só `(page, limit)` — os dois últimos argumentos são descartados silenciosamente. **A aba de auditoria de um motorista mostra os logs administrativos inteiros do sistema, não os desse motorista.** Corrigido no mesmo bloco, já que é exatamente o `getLogs` que estou reescrevendo pra suportar filtro de verdade.

## O que muda

- **`getLogs` reescrito** pra aceitar filtros de verdade: `adminName` (busca parcial), `action`, `targetModel`, `targetId`, período (`startDate`/`endDate`). `getCaptainTimeline` corrigido pra realmente filtrar por `targetId` com a assinatura nova.
- **6 ações ganham `logAction`**: `sendNotification`, `createCampaign`, `cancelCampaign`, `updatePromotionStatus`, `addUserObservation`, `scheduleTariff`.
- **4 funções passam a receber `ip` de verdade** (`updateUserTags`, `updateCaptainDocument`, `cancelRide` admin, `bulkActionRides`), com os controllers passando `req.ip` — mesmo padrão que toda outra função de `admin.service.js` já usa (`ip || '0.0.0.0'`).
- **`Logs.jsx`**: filtros de admin (busca por nome), ação, alvo (`targetModel`) e período, mais paginação já existente — a tela deixa de ser só uma lista sem filtro nenhum.

## Fora de escopo desta execução

- **Não migrei `tariffHistory` pra dentro de `adminLog`** — o plano original dava a opção de manter `tariffHistory` como "visão especializada", e é isso que fiz: ela continua existindo separada (é exibida num componente próprio, `TariffHistory.jsx`, com uma UI de diff antes/depois que uma linha genérica de log não replica bem). Consolidar as duas coleções numa migração de dados é uma mudança maior, sem necessidade clara — o objetivo do bloco (rastrear quem alterou o quê) já fica atendido com as duas trilhas existindo em paralelo, cada uma logando de verdade.
- **`auditLog` model** (a terceira trilha mencionada no relatório original, usada só por `createPromotion`): não consolidei nem removi — outra migração de dados sem necessidade clara pro objetivo deste bloco. Documentado como redundância que continua existindo.

## Como verifico

- Script de verificação descartável: cada uma das 6 ações sem log passa a gravar um `adminLog` com IP real; `getLogs` filtra corretamente por admin/ação/alvo/período; `getCaptainTimeline` volta só os logs do motorista certo (o bug encontrado).
- Build do admin-frontend limpo; suíte do backend na baseline conhecida.

---

## Detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

`getLogs` (`admin.service.js`) reescrito para aceitar `adminName` (regex case-insensitive), `action`, `targetModel`, `targetId` e período (`startDate`/`endDate`). Controller (`getLogs`) repassa os query params. `Logs.jsx` ganhou a barra de filtros (busca por admin, ação, alvo, período) mais uma coluna de IP na tabela — corrigi de passagem a sintaxe `keepPreviousData: true` (v4) pra `placeholderData: keepPreviousData` (v5) nesta mesma tela, já que estava reescrevendo a query mesmo.

**Bug real encontrado ao investigar, não estava no relatório original**: `getCaptainTimeline` (a aba "Auditoria" do CRM de motoristas — um dos achados *positivos* da auditoria) chamava `getLogs(1, 50, '', { targetId: ... })`, mas a assinatura antiga de `getLogs` era só `(page, limit)` — os dois últimos argumentos eram descartados silenciosamente. A timeline de auditoria de um motorista mostrava os logs administrativos do sistema **inteiro**, não os desse motorista. Corrigido junto, já que é o mesmo `getLogs` que eu estava reescrevendo.

6 ações ganharam `logAction`: `sendNotification`, `createCampaign`, `cancelCampaign`, `updatePromotionStatus` (mantive o `auditLogs` embutido no próprio documento da promoção, que já existia — só adicionei o registro na trilha unificada também), `addUserObservation`, `scheduleTariff`. (O relatório original contava 7 ações sem registro; recontei antes de planejar e não achei um sétimo caso — `createVehicleCategory`/`duplicateCategory`, que eu tinha marcado como sem log numa contagem anterior, na verdade já logam via `tariffHistoryModel`.)

4 funções que tinham `ipAddress: '0.0.0.0'` hardcoded (sem sequer receber o parâmetro `ip`) passaram a recebê-lo de verdade: `updateUserTags`, `updateCaptainDocument`, `cancelRide` (admin), `bulkActionRides` — com os controllers agora passando `req.ip`.

**Fora de escopo, confirmado**: não consolidei `tariffHistory` nem o `auditLogs` embutido em `promotion` dentro de `adminLog` — decisão já registrada no plano antes de começar, mantida.

### Verificação

Script descartável (`_verify_bloco_i.js`, `MongoMemoryServer` padrão — nenhuma dessas mudanças usa transação) cobrindo: IP real chega no log nas 4 funções corrigidas; sem IP informado cai no fallback sem quebrar; `getLogs` filtra corretamente por administrador, ação, alvo e período; e o bug do `getCaptainTimeline` — confirmei que a timeline de um motorista específico só mostra logs desse motorista, não do sistema inteiro. 12 asserções, todas passando na primeira rodada. Removido depois — `git status` confirma que não sobrou.

Build do `admin-frontend`: limpo. Suíte do backend: 76 passam, 4 falham — mesma baseline de todos os blocos anteriores.

**Nada foi commitado.**
