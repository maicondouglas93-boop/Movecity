# Execução — Blocos B+C (Integridade Financeira do Repasse) — Painel Administrativo

**Base:** [auditoria do painel administrativo, 2026-08-02](2026-08-02-auditoria-painel-administrativo.md), achados F1/F2/§6.4/§6.5/C2, Blocos B e C do Plano de Correção.
**Escopo:** o Centro Financeiro do painel administra uma coleção (`payout`) que nada no sistema cria, e "Aprovar e Pagar" marca como pago sem mover dinheiro de verdade. Este bloco corrige os dois lados: cria o pedido de saque (motorista) e corrige a aprovação para debitar a carteira real, atomicamente, sem fingir um pagamento que não aconteceu.
**Status:** ✅ concluído e verificado em 2026-08-02. Nada commitado.

## Ponto de partida real (confirmado no código antes de planejar)

- `Backend/services/wallet.service.js` já tem um `createTransaction` correto e atômico (`$inc` via `findOneAndUpdate`, nunca read-modify-write), já suporta `type: 'payout'` (debita `pendingBalance`), e já aceita uma `session` opcional para participar de uma transação Mongo maior — o mesmo padrão usado em `confirmPaymentReceived` (`ride.service.js:441`), que vou replicar aqui.
- `captain.pix.key` **é** persistido corretamente no cadastro (`captain.service.js: createCaptain`) — verifiquei antes de assumir, porque `captain.controller.js` passa os campos como `pixKeyType`/`pixKey` soltos e eu suspeitava que o remapeamento pra `pix: {keyType, key}` pudesse estar quebrado. Não está: `captainService.createCaptain` remonta certo.
- `captain.controller.js: rechargeWallet` já está desativado (HTTP 501) por decisão de uma sessão anterior, com o comentário explícito: *"Bloqueado propositalmente: este endpoint creditava saldo real sem nenhuma cobrança de fato acontecer... Fica desativado até existir integração real com gateway de pagamento"*. Esse é o precedente direto do que estou fazendo aqui — a mesma disciplina aplicada ao lado do saque.
- Nada no backend cria um documento `payout` — `grep payoutModel.create` no projeto inteiro retorna zero. O Centro Financeiro do admin sempre esteve vazio por design incompleto, não por falta de motoristas usando o sistema.

## O que muda

### Bloco B — `approvePayout` / `rejectPayout` / `bulkApprovePayouts` (`Backend/services/admin.service.js`)

- **Novo estado terminal real.** Como não existe gateway de pagamento integrado (`paymentGateway` do `globalSetting` nunca é lido por nada), o clique em "Aprovar e Pagar" não pode mais resultar em `status: 'paid'` — vai para `status: 'processing'`: o valor **já foi debitado de verdade** da carteira do motorista (via `walletService.createTransaction`, dentro de uma transação Mongo), mas o sistema não tem como confirmar que o PIX efetivamente chegou ao motorista, porque isso acontece fora dele (banco/gateway real).
- **Nova ação `confirmPayoutPaid`**: um segundo passo deliberado, para quando o financeiro confirmar manualmente (fora do sistema, olhando o extrato do banco) que o PIX realmente saiu. Só então `status: 'paid'`.
- **Débito atômico e contábil de verdade**: substituí `captain.earnings -= payout.amount` (métrica de ganhos vitalícios, não saldo sacável — corrompia o KPI) por `walletService.createTransaction({ type: 'payout', ... })`, que debita `wallet.pendingBalance` e cria um registro em `transaction` — o que faz o repasse **aparecer no extrato do motorista** pela primeira vez (o ícone/rótulo pra `type: 'payout'` já existia em `CaptainWallet.jsx`, só nunca tinha sido usado).
- **Checagem de saldo reativada**: a linha comentada (`// if (captain.earnings < payout.amount) throw...`) referenciava o campo errado. A nova checagem lê `wallet.pendingBalance` de verdade, dentro da mesma transação que vai debitá-lo.
- **Corrida de dupla aprovação fechada (C2)**: a transição de estado agora é um `findOneAndUpdate` condicional (`status: {$in: [...]} → 'processing'`) dentro de `session.withTransaction`, no mesmo padrão de `confirmPaymentReceived`. Duas aprovações simultâneas do mesmo repasse: só uma ganha a corrida; a outra recebe erro em vez de debitar duas vezes.
- **`rejectPayout` só permitido antes do débito** (status `requested`/`in_analysis`/`approved`). Depois que o repasse entra em `processing`, o dinheiro já saiu da carteira do motorista — rejeitar nesse ponto exigiria um mecanismo de estorno que não existe hoje e que não está no escopo deste bloco (a auditoria original não pediu isso; decidi não inventar a funcionalidade). Mensagem de erro explica o motivo em vez de simplesmente barrar.
- **`bulkApprovePayouts`** reescrito para usar a mesma transação por item (extraída pra uma função interna compartilhada com `approvePayout`), preservando o comportamento de "pular os inválidos, seguir com o resto" — mas agora "pular" também cobre saldo insuficiente, e cada aprovação bem-sucedida realmente debita a carteira.
- **`getPayoutDetails`** passa a incluir o `wallet` real do motorista na resposta. O drawer do admin mostrava `captain.earnings` como "Saldo Atual do Motorista" — o número errado, ao lado de um botão que vai debitar o saldo certo. Troquei para `wallet.pendingBalance`.

### Bloco C — Fluxo de solicitação de saque (motorista)

- Novo `walletService.requestPayout(captainId)`: valida chave Pix cadastrada, valor mínimo (`globalSetting.minimumPayout`, hoje sem nenhum leitor — primeiro uso real), e que não exista outra solicitação em aberto para o mesmo motorista. Cria o `payout` com `amount = wallet.pendingBalance` (o saldo pendente inteiro — a tela já descreve esse valor como "aguardando transferência bancária para você", então a solicitação move o valor inteiro, não um valor parcial escolhido à mão) e `bankDetailsSnapshot.pixKey` a partir de `captain.pix.key`.
- Novo endpoint `POST /captains/payouts` (`captain.routes.js`/`captain.controller.js`).
- `frontend/src/modules/driver/pages/CaptainWallet.jsx`: o card "Repasses Pendentes" ganha um botão "Solicitar Saque" (antes só exibia o número, sem nenhuma ação). Segue o padrão de feedback já usado no resto do app do motorista (sem `alert()`, sem toast global — banner inline de sucesso/erro, como o app já faz em outros pontos).

## Fora de escopo desta execução

- **Nenhuma integração real com gateway de pagamento.** `paid` continua sendo um estado alcançado só por confirmação manual do financeiro — não existe automação de pagamento de verdade neste projeto, e não é este bloco que vai criá-la.
- **Estorno de repasse já em `processing`.** Ver acima — decisão consciente, não um esquecimento.
- **Escolha de valor parcial no saque.** O motorista solicita o saldo pendente inteiro; não há campo de valor customizado.
- **`automaticPayout`, `payoutDeadlineDays`** continuam sem leitor — ligar saque automático agendado é uma funcionalidade nova, não uma correção de bug, e fica pra um bloco de regras de negócio à parte se for decidido implementar.

## Como verifico

- Teste de verificação temporário (supertest + Mongo em memória, como fiz no Bloco D): fluxo completo *solicitar saque → aprovar (debita carteira, cria transaction, vai pra `processing`) → confirmar pagamento (`paid`)*; aprovação concorrente do mesmo repasse só debita uma vez; saldo insuficiente bloqueia aprovação; rejeitar um repasse já em `processing` é recusado.
- Build do admin-frontend e do frontend (driver) limpos.
- Suíte do backend na baseline conhecida (76 passam / 4 falhas pré-existentes).

---

## Detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

### Backend — Bloco B (`admin.service.js`, `admin.controller.js`, `admin.routes.js`)

Extraí a lógica compartilhada de aprovação para `claimAndDebitPayout(payoutId, admin)`, usada tanto por `approvePayout` quanto por `bulkApprovePayouts`:
1. Valida motorista (bloqueado, aprovação, chave Pix) — falha rápido, fora da transação.
2. `mongoose.startSession()` + `session.withTransaction()`, no mesmo padrão de `confirmPaymentReceived` (`ride.service.js`): CAS via `findOneAndUpdate({status: {$in: [...]}}, {$set: {status: 'processing'}})` — só uma chamada concorrente ganha a corrida.
3. Lê o `wallet` real dentro da sessão e recusa se `pendingBalance < amount`.
4. Debita via `walletService.createTransaction({type: 'payout', session})` — atômico, cria o registro que aparece no extrato do motorista.
5. Efeitos colaterais (socket, cache) só depois do commit.

`approvePayout` agora termina em `processing`, nunca em `paid`. Nova `confirmPayoutPaid`: segundo passo manual (CAS `processing → paid`) para quando o financeiro confirmar, fora do sistema, que o PIX saiu de verdade — não existe gateway pra automatizar isso, e não fabriquei uma confirmação automática. `rejectPayout` agora só aceita `requested`/`in_analysis`/`approved` — rejeitar um `processing` (dinheiro já debitado) exigiria estorno, que não é o escopo deste bloco; a mensagem de erro explica o motivo em vez de só barrar. `bulkApprovePayouts` reescrito para chamar `claimAndDebitPayout` por item dentro de um try/catch, preservando o "pula os inválidos, segue com o resto".

`getPayoutDetails` agora também retorna o `wallet` do motorista — o drawer usava `captain.earnings` (ganhos vitalícios) como se fosse o saldo que o repasse ia debitar; troquei para `wallet.pendingBalance`, o número real.

**Erros de regra de negócio meus (não do `next(error)` genérico).** `approvePayout`, `rejectPayout` e a nova `confirmPayoutPaid` passaram a responder `res.status(400).json({message: error.message})` em vez de `next(error)`. Motivo: o handler global (`app.js`) mascara `err.message` com "Internal Server Error" quando `NODE_ENV=production` — todas as mensagens específicas que escrevi ("Saldo insuficiente...", "Este repasse já foi processado...") teriam sumido em produção exatamente onde o Bloco F provou que a transparência de erro importa. Segui o padrão que o próprio `login` já usa (captura erros esperados e responde direto, em vez de deixar cair no handler global).

### Backend — Bloco C (`wallet.service.js`, `captain.controller.js`, `captain.routes.js`)

`walletService.requestPayout(captainId)`: valida chave Pix cadastrada, valor mínimo (`globalSetting.minimumPayout` — primeiro leitor real desse campo, que a auditoria original listou como um dos 10 campos de `globalSetting` sem nenhum efeito), e ausência de solicitação em aberto para o mesmo motorista. Cria o `payout` com `amount = wallet.pendingBalance` inteiro (não um valor parcial escolhido à mão) e `bankDetailsSnapshot` a partir de `captain.pix`/`captain.bankDetails`. Nova rota `POST /captains/payouts`.

Antes de escrever isso, verifiquei uma suspeita (registrada no plano): `captain.controller.js` monta o payload de cadastro com `pixKeyType`/`pixKey` soltos, não com o formato aninhado `pix: {keyType, key}` do schema — parecia um bug de mapeamento que deixaria `captain.pix.key` sempre vazio. Não é: `captainService.createCaptain` remonta os campos soltos de volta pro formato aninhado corretamente. Bom ter checado antes de escrever `requestPayout` assumindo que o campo estaria sempre populado.

### Frontend

`admin-frontend/src/pages/Finance.jsx`: a barra de ações do drawer agora depende do status — `requested`/`in_analysis`/`approved` mostram Aprovar+Rejeitar; `processing` mostra só "Confirmar Pagamento Realizado", com uma nota explicando que o valor já foi debitado. A seção "Conferência Financeira" trocou `captain.earnings` por `wallet.pendingBalance`, e passou a mostrar "Saldo Restante Após o Débito" em vermelho quando insuficiente (só antes da aprovação — depois disso o número não faz mais sentido mostrar).

`frontend/src/modules/driver/pages/CaptainWallet.jsx`: o card "Repasses Pendentes" ganhou um botão "Solicitar Saque" com uma mutation e um banner de feedback inline (sem `alert()`, sem toast global — o app do motorista não tem um sistema de toast; segui o padrão já usado no próprio arquivo, o banner "Conta Suspensa").

### Verificação

Não existia teste algum cobrindo o ciclo de vida de um payout (nem antes, nem depois). Escrevi um script de verificação standalone (`_verify_payout_flow.js`, **não** um arquivo de teste da suíte) porque o `session.withTransaction()` que este bloco depende **não funciona** no `MongoMemoryServer` padrão usado em `tests/setup.js` (é standalone, sem replica set — o que, percebi ao investigar, é provavelmente a causa raiz de uma das 4 falhas pré-existentes da suíte: o teste de concorrência em `ride.api.test.js` espera `[200,409]` e recebe `[500,500]`, exatamente a assinatura de "transação não suportada"). Usei `MongoMemoryReplSet` no script avulso pra ter transações de verdade.

10 cenários, 24 asserções, todas passando na segunda rodada (a primeira pegou dois bugs no próprio fixture do script — CPF duplicado entre motoristas de teste e uma asserção com valor hardcoded desatualizado — não no código de produção):
1. Solicitar saque cria o payout com o saldo pendente inteiro e a chave Pix certa; segunda solicitação simultânea é bloqueada.
2. Saldo abaixo do mínimo bloqueia a solicitação.
3. Aprovar debita a carteira de verdade e cria a `transaction`.
4. Aprovar de novo um repasse já em `processing` é recusado.
5. Rejeitar um repasse já em `processing` é recusado, com mensagem explicando o motivo.
6. Confirmar pagamento leva a `paid`; confirmar de novo é recusado.
7. Rejeitar **antes** do débito funciona e não mexe na carteira.
8. Saldo insuficiente na hora de aprovar (caiu depois da solicitação) bloqueia e não deixa o payout em estado inconsistente.
9. **Duas aprovações concorrentes do mesmo repasse**: exatamente uma vence, a carteira é debitada uma única vez (não fica negativa), só uma `transaction` é criada — a corrida que causava duplo débito (C2 da auditoria) está fechada.
10. Aprovação em lote debita cada motorista corretamente.

Depois de confirmar os 24 checks, removi o script — `git status` confirma que não sobrou.

Build do `admin-frontend` e do `frontend` (driver): limpos. Suíte do backend: 76 passam, 4 falham — mesma baseline dos blocos anteriores (nenhuma regressão; a suíte real não roda transação nenhuma do meu código porque usa Mongo standalone, então nem chega a exercitar esse caminho — coerente com a falha pré-existente do `ride.api.test.js` ter a mesma causa).

**Nada foi commitado.**
