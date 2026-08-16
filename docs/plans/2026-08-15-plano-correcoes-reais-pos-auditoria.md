# Plano de correção — itens reais confirmados pós-auditoria Codex

## Contexto

Em 2026-08-15 chegaram um relatório de auditoria (`AUDITORIA_TECNICA_FINAL_MOVECITY.md`) e
um plano de correção (`PLANO_COMPLETO_CORRECAO_MOVECITY.md`) gerados por um agente externo,
com commit-base `2e1a08d399ad1d3cf98d6ce3c065419ac144be18`. Esse commit é ancestral direto
dos 9 PRs (COR-1001 a COR-1007, COR-2001, COR-2002) já mergeados na main na rodada anterior
— confirmado via `git merge-base --is-ancestor`. Ou seja: o relatório descreve o sistema
**antes** dessas correções. Conferi item a item no código atual e boa parte da Fase 0/1 e
metade da Fase 2 do plano original já está resolvida (contrato de pagamento, CSRF, DTOs por
ator, mapa de motoristas, revogação de compartilhamento, atomicidade de corrida/carteira,
reconciliação de cancelamento, JWT com ator/propósito, rotação atômica de refresh). Esses
itens **não entram aqui**.

Este documento cobre só os itens que confirmei reais no código atual (não apenas no texto do
relatório) e que fazem sentido corrigir agora.

## Fora de escopo (decisão de 2026-08-15)

- **Gateway de pagamento / Asaas** (item COR-3006 do relatório original: idempotência do
  webhook, `recharge.asaasInvoiceId` sem índice único). A integração está dormente
  ([[reference_motoboycity_pending_integrations]]) e a orientação foi explícita: não
  trabalhar com gateway por enquanto. Fica registrado como bloqueador **antes de ativar**
  recarga/cartão, não como tarefa desta rodada.
- COR-2003/2004/2005 (refresh fora do localStorage, Google login, revogação de socket)
  seguem pausados pelo motivo já registrado em [[project_movecity_codex_pr_merge_status]]
  (domínio same-site).

## Regras de execução

Mesmas da rodada anterior:

1. Uma branch/PR por item; nada de item financeiro/segurança dividido com funcionalidade nova.
2. Nenhuma alteração destrutiva de banco sem revisão de impacto; quando o item cria uma
   constraint nova (índice único), auditar dado existente em produção **antes** de aplicar,
   do mesmo jeito que foi feito para COR-1006.
3. Testar localmente e CI verde antes de pedir merge.
4. Merge só PR por PR, com sua confirmação explícita — dispara deploy automático em
   Render/Vercel.
5. Item marcado como "precisa decisão de produto" para no início da implementação até você
   decidir a regra; não inventar.

---

## Fase 1 — Correções pontuais, sem risco de dado ✅ concluída (2026-08-16)

PRs #73 (1.1), #74 (1.2), #75 (1.3), #76 (1.4) — mergeadas na main, CI verde em
todas, deploy automático em Render/Vercel já disparado.

Baixo risco, independentes entre si, podem ir em paralelo.

### 1.1 Refs do Mongoose quebradas

**Problema:** `models/payout.model.js`, `models/auditLog.model.js`,
`models/tariffSchedule.model.js` e `models/accountDeletionRequest.model.js` usam
`ref: 'adminUser'` ou `ref: 'admin'` (minúsculo). `models/notification.model.js` usa
`ref: 'notificationCampaign'` (minúsculo). Os models estão registrados como `'AdminUser'`
e `'NotificationCampaign'` (`mongoose.model('AdminUser', ...)` em `adminUser.model.js`,
`mongoose.model('NotificationCampaign', ...)` em `notificationCampaign.model.js`). Conferi
os 5 arquivos: hoje, `.populate()` nesses campos lança `MissingSchemaError`.

**Solução:** corrigir a string do `ref` nos 5 arquivos para bater exatamente com o nome
registrado.

**Validação obrigatória:** teste de integração que popula cada um dos 5 campos (detalhe de
saque, log de auditoria, histórico de tarifa, solicitação de exclusão de conta,
notificação de campanha) e não lança erro. Rodar suíte completa depois — checar se algum
código hoje depende do erro sendo engolido silenciosamente (try/catch ao redor do populate).

**Rollback:** reverter a string; não muda schema nem dado gravado.

### 1.2 Troca de senha autenticada quebrada

**Problema:** `frontend/src/passenger/pages/account/ChangePassword.jsx` chama
`PUT /users/password`. Conferi `routes/user.routes.js`: essa rota não existe (só há
`register`, `google-login`, `login`, `PUT /profile`, `refresh`, `logout`,
`account-deletion`). Qualquer passageiro que tentar trocar a senha recebe 404. Preciso
checar se o motorista tem o mesmo problema (`captain.routes.js`).

**Solução:** criar `PUT /users/password` e o equivalente para motorista, autenticado,
exigindo senha atual + nova senha (reaproveitar a validação de mínimo 6 caracteres já usada
em registro/login), revogando os refresh tokens das outras sessões após troca bem-sucedida
(mesma política usada no logout).

**Fora desta fase:** fluxo "esqueci minha senha" sem estar logado (recuperação por
e-mail/SMS) — é item maior, precisa de decisão de canal de envio e infraestrutura que hoje
não existe no projeto. Não vou implementar isso aqui sem essa decisão.

**Validação obrigatória:** senha atual errada falha (401/403); troca correta permite novo
login com a senha nova e derruba as outras sessões; teste de integração cobrindo os dois
casos.

**Rollback:** remover a rota nova; nenhuma mudança de schema.

### 1.3 `trust proxy` não configurado

**Problema:** confirmei — nem `app.js` nem `server.js` chamam `app.set('trust proxy', ...)`.
Atrás do proxy do Render, `req.ip` pode não refletir o IP real do cliente, o que afeta
diretamente o `keyGenerator` por IP do `loginLimiter`/`rideStartPinLimiter` e qualquer log
de auditoria por IP.

**Solução:** configurar `trust proxy` com o número exato de hops do Render (documentação do
Render indica 1 proxy reverso na frente do serviço web — vou confirmar isso antes de fixar
o valor, já que configurar errado é pior que não configurar: um valor alto demais permite
que o cliente forje `X-Forwarded-For` e escolha seu próprio "IP").

**Validação obrigatória:** requisição com `X-Forwarded-For` forjado não deve conseguir se
passar por outro IP; rate limiter aplicado ao IP real do cliente em ambiente com o proxy do
Render (staging).

**Rollback:** reverter para ausência de configuração.

### 1.4 Versão do Node não fixada

**Problema:** confirmei — sem campo `engines` em nenhum dos 3 `package.json`, sem
`.nvmrc`. `firebase-admin@14.2.0` exige Node `>=22`; `.github/workflows/ci.yml` usa
`node-version: '20.x'`; Render não fixa versão.

**Solução:** adicionar `engines.node: ">=22"` nos 3 `package.json` (Backend, frontend,
admin-frontend), criar `.nvmrc` na raiz, atualizar `ci.yml` para Node 22, fixar a versão no
Render.

**Validação obrigatória:** `npm ci` sem `EBADENGINE`; build dos 3 apps; boot local em Node
22 testando especificamente os módulos nativos `bcrypt` e `sharp` (são os dois que
realmente podem quebrar numa troca de major do Node).

**Rollback:** reverter a versão se algum módulo nativo não tiver binário pronto pra Node 22.

---

## Fase 2 — Confiabilidade do boot (readiness, shutdown, migração) ✅ concluída (2026-08-16)

PRs #77-#79 (Passos 1-3) e #82 (Passo 4) — mergeadas, `/api/ready` observado
em produção (~45min, 29 checagens) antes de virar o healthcheck real do
Render.

Esses três itens são o mesmo problema de fundo, então fazem sentido numa PR/branch
coordenada, testada em staging antes de qualquer coisa ir pra produção.

### 2.1 Boot não espera o Mongo conectar

**Problema:** confirmei em `app.js:62-64` — `connectToDb()` é chamado sem `await` (fire-and-
forget) no meio do setup do Express. Em `server.js`, `server.listen(port, ...)` roda
imediatamente, sem depender dessa promise. Ou seja, o processo começa a aceitar tráfego
HTTP antes (possivelmente muito antes) do Mongo estar conectado. Como o Mongoose usa
`bufferCommands` por padrão, requisições nessa janela não falham na hora — ficam penduradas
até o `serverSelectionTimeoutMS` estourar, o que é pior que uma falha rápida e clara.

**Solução:** tornar o boot sequencial — `await connectToDb()` antes de `server.listen()`.
Isso já resolve a maior parte do problema sem precisar de arquitetura nova.

**Validação obrigatória:** derrubar o Mongo propositalmente em staging e confirmar que o
processo não sobe / não aceita conexão até reconectar; teste de boot local com Mongo
indisponível.

### 2.2 `/api/health` sempre responde 200

**Problema:** confirmei em `app.js:77-84` — o handler não olha `mongoose.connection.readyState`,
só devolve `status: 'OK'` com uptime/memória. Combinado com o item 2.1, o Render pode
considerar o serviço saudável mesmo com o banco fora do ar.

**Solução:** manter `/api/health` como liveness (processo vivo — usado por quem só quer
saber se o processo não travou) e criar `/api/ready` checando `mongoose.connection.readyState
=== 1`, devolvendo 503 caso contrário. Apontar o health check do Render para `/api/ready`.

**Validação obrigatória:** com Mongo desconectado, `/api/ready` responde não-2xx e o Render
para de rotear tráfego (testar em staging); `/api/health` continua 200 independente do Mongo
(processo está vivo mesmo que o banco não esteja).

### 2.3 `syncIndexes` + `updateMany` no boot, sem versionamento

**Problema:** confirmei em `db/db.js:263-277` — toda subida do processo roda
`transactionModel.syncIndexes()` e dois `updateMany` (limpando `rideId`/`parcelId` nulos
legados). É idempotente e tem try/catch que só loga aviso, mas roda em **toda** instância a
cada deploy, sem log de quando foi aplicado, sem controle de versão, e escaneia a coleção
inteira toda vez.

**Solução:** extrair para um script de migration numerado (`scripts/migrations/0001-
transaction-indexes.js`, seguindo o padrão que já existe em `scripts/`), rodado manualmente/
via CI antes do deploy — não automaticamente no boot. Antes de remover do boot, confirmar
que o índice já está sincronizado em produção (rodar o script uma vez, manualmente, e
validar) para não reintroduzir o `E11000` que motivou o `syncIndexes` original.

**Validação obrigatória:** migration roda uma vez, é idempotente na segunda execução; boot
não altera índice nem dado; suíte financeira (`test:critical:*`, `test:integration:*`)
continua verde sem o `syncIndexes` automático.

**Rollback (para os 3 itens da Fase 2):** reverter para o comportamento anterior é seguro —
nenhum deles muda dado, só sequência de boot e semântica do health check.

---

## Fase 3 — Integridade financeira interna (sem gateway) ✅ concluída (2026-08-16)

PRs #83 (3.1 saque duplicado), #84 (3.2 promoção no valor final — decisão de
produto: recalculado sobre o valor final) e #85 (3.3 multiplicador noturno
tratado como percentual). 3.3 investigado a fundo: não era "três fontes de
tarifa divergentes" como a auditoria original sugeria — era uma fonte
(GlobalSetting) morta e não usada, mais um bug de unidade no multiplicador
noturno. Corrigido sem precisar da tabela de cenários originalmente prevista.

### 3.1 Saque duplicado (payout)

**Problema:** confirmei em `services/wallet.service.js:201-239` (`requestPayout`) — o
padrão é check-then-create: `payoutModel.findOne({ captainId, status: {$in:[...]} })` e,
se não achar nada pendente, `payoutModel.create(...)`. Não há transação nem índice único
entre as duas operações. `payout.model.js` não declara nenhum índice. Duas requisições
simultâneas do mesmo motorista podem passar pelo `findOne` antes de qualquer `create`
existir, gerando dois payouts para o mesmo saldo pendente.

**Solução:** índice único parcial em `payout.model.js` — `{ captainId: 1 }` com
`partialFilterExpression: { status: { $in: ['requested','in_analysis','approved','processing'] } }`
— e criação via `create` protegida por esse índice (capturar erro `E11000` e devolver a
mesma mensagem amigável já existente: "Você já tem uma solicitação de saque em andamento").
Mesmo padrão já usado em COR-1006 para corrida ativa.

**Validação obrigatória:** antes de aplicar o índice em produção, rodar um script de
auditoria read-only (mesmo modelo do `scripts/audit-ride-creation-duplicates.js` usado na
COR-1006) contando payouts duplicados/ativos por motorista hoje — só aplicar o índice se
vier zero, senão parar e reportar. Teste de concorrência: 10 chamadas simultâneas de
`requestPayout` para o mesmo motorista resultam em exatamente 1 payout criado.

**Rollback:** remover o índice reverte ao comportamento anterior (ainda com o bug, mas sem
quebrar nada); não apaga payout já criado.

### 3.2 Promoção não preservada no preço final — **precisa decisão de produto**

**Problema (relatado, ainda não confirmei a fundo no código):** o desconto aplicado na
estimativa/criação da corrida pode não sobreviver até a finalização, cobrando valor
diferente do que foi mostrado ao passageiro.

**Por que para aqui:** a correção depende de uma regra que só você pode definir: quando o
valor final diverge da estimativa (corrida ficou mais longa/curta que o previsto), o
desconto deve (a) ser aplicado como percentual sobre o valor final, (b) ser um valor fixo
travado na estimativa, ou (c) ter um teto diferente disso? Não vou inventar essa regra.

**Próximo passo:** quando você quiser seguir com este item, confirmo primeiro no código
exatamente onde a promoção se perde (snapshot na criação vs. recálculo na finalização) e
te trago as opções concretas de regra antes de codar.

### 3.3 Fonte de tarifa/pricing inconsistente — **precisa decisão de produto + maior escopo**

**Problema (relatado, ainda não confirmei a fundo):** comissão e preço vivem em fontes
divergentes (`PricingEngine`, `VehicleCategory`, `GlobalSetting`, `TariffSetting`);
multiplicador noturno supostamente interpretado como percentual em vez de multiplicador;
chuva/dinâmica/mínimo/arredondamento aplicados de forma inconsistente entre simulador,
criação e finalização.

**Por que para aqui:** é o item de maior escopo desta lista — exige escolher uma fonte
canônica de tarifa e criar uma tabela de cenários "dourados" (golden tests) antes de mexer,
senão corre o risco de mudar o preço de corridas em andamento. Não é do tamanho de uma PR
isolada como os outros itens da Fase 3.

**Próximo passo:** tratar como uma fase própria, só depois de 3.1 estar em produção e
validado — nesse momento eu levanto o código real do `pricingEngine.service.js` e volto com
um plano específico, com a tabela de cenários antes de qualquer alteração de cálculo.

---

## Fase 4 — Reais, prioridade menor, sequenciar depois da Fase 1-3

Não mexem com dinheiro nem dado sensível diretamente. Vou investigar/detalhar cada um só
quando chegarmos nele, pra não gastar tempo validando algo que ainda está longe na fila:

- **Cancelamento em massa do admin** — confirmar se `adminService.bulkActionRides`
  (`services/admin.service.js:1425`, ação `bulk_cancel_rides`) passa pela mesma
  reconciliação financeira que a COR-1007 já implementou para cancelamento individual, ou
  se é um caminho paralelo que ainda pula carteira/promoção/gateway.
- **RBAC granular do admin** — leitura sensível (documentos, finanças, GPS) hoje liberada
  pra qualquer admin ativo, sem matriz de permissão por recurso.
- **Seeds com credenciais padrão** — scripts de seed não bloqueiam produção nem exigem
  variável forte (a leitura em `db/db.js:281` já impede rodar em `NODE_ENV=production`, mas
  o conteúdo do seed em si — senha padrão de admin etc. — ainda merece revisão).
  Ligado a [[reference_motoboycity_audit_artifact]] — checar se já foi tratado lá.
- **Deadlock de refresh no painel admin** — fila de requisições pode nunca resolver quando
  o refresh falha, painel fica carregando pra sempre.
- **Fila offline do motorista** — confirma ação antes do servidor confirmar; 409 tratado
  genericamente como "já aplicado", podendo mascarar conflito real.

---

## Checklist de liberação desta rodada

- [x] 1.1 a 1.4 mergeados e validados individualmente (PRs #73-#76, 2026-08-16).
- [x] 2.1 a 2.4 mergeados e validados em produção real a cada passo, incluindo observação
      de ~45min do /api/ready antes de virar o healthcheck (PRs #77-#79, #82, 2026-08-16).
- [x] 3.1 com auditoria de duplicidade zerada antes do índice único ir pra produção
      (PR #83, 2026-08-16).
- [x] 3.2 e 3.3 com decisão de produto registrada antes de começar a implementação
      (PRs #84-#85, 2026-08-16).
- [ ] Fase 4 revisitada e priorizada depois que 1-3 estiverem no ar.
