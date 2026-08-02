# Execução — Bloco E (Concorrência Administrativa) — Painel Administrativo

**Base:** [auditoria do painel administrativo, 2026-08-02](2026-08-02-auditoria-painel-administrativo.md), achados C1/C4/C5/C6, Bloco E do Plano de Correção.
**Escopo:** dois admins editando a mesma tarifa ao mesmo tempo (um sobrescreve o outro silenciosamente) e `reassignRide` ignorando a máquina de estados de corrida (aceitava reatribuir uma corrida `started`, com o passageiro dentro do carro, e não notificava nem redespachava nada).
**Status:** ✅ concluído e verificado em 2026-08-02. Nada commitado.

**Nota sobre o processo:** desta vez comecei a investigar e implementar direto, sem escrever o plano em `.md` antes — quebrando a própria regra que venho seguindo nos blocos anteriores. Este arquivo foi escrito depois, mas documenta com precisão o que foi investigado, decidido e feito, na mesma estrutura dos blocos anteriores.

## Ponto de partida real (confirmado no código antes de implementar)

- `Backend/services/ride.service.js` já tem uma máquina de estados madura (`VALID_ORIGINS_BY_TARGET` + `transitionRide`, construída numa auditoria de concorrência anterior) — toda transição de corrida passa por um único `findOneAndUpdate` atômico com o(s) status de origem permitidos no próprio filtro. **`started` nunca é uma origem válida para `requested`** — ou seja, a máquina de estados já impedia exatamente o C5 (reatribuir corrida em andamento) *se* `reassignRide` a estivesse usando. Não estava: fazia `ride.captain = null; ride.status = 'requested'; ride.save()` direto, ignorando a máquina inteira.
- Já existe uma função quase idêntica ao que `reassignRide` precisa: `cancelRideByCaptain` (motorista desiste de uma corrida aceita) — mesma transição (`requested`, limpa `captain`+`otp`), só que com filtro de dono (`{captain}`). Usei o mesmo padrão, sem o filtro de dono (admin pode forçar em qualquer corrida).
- `dispatchRideToCaptains` (busca motoristas no raio e emite `new-ride`) já existe em `ride.controller.js`, extraída numa auditoria de UX anterior especificamente para ser reaproveitada por fluxos de redespacho — mas não estava exportada do módulo, só usada internamente.
- Os 3 modelos relevantes (`tariffSetting`, `globalSetting`, `vehicleCategory`) usam o `__v` padrão do Mongoose (nenhum desabilita `versionKey`) — a infraestrutura para versionamento otimista já existia, só não era usada pra nada.

## O que muda

### C1 — Edição concorrente de tarifas

- `optimisticConcurrency: true` adicionado aos 3 schemas (`tariffSetting`, `globalSetting`, `vehicleCategory`). Verifiquei empiricamente (script descartável) que isso faz `.save()` usar o `__v` como filtro da escrita e lançar `VersionError` se o documento mudou desde a leitura — mas só protege chamadas que compartilham a mesma instância de documento em memória (o caso normal de dois `.save()` disputando o mesmo instante). Para o caso real de HTTP (duas requisições PUT separadas, cada uma faz seu próprio `findOne()` fresco, que sempre vê a versão mais atual), isso sozinho não bastava — confirmei isso também com o mesmo script antes de escrever a versão final.
- Por isso, a checagem real é explícita: `GET /admin/tariffs` (`getTariffs`) agora devolve `__tariffVersion`/`__globalSettingVersion` junto com os dados; o painel devolve esses valores no `PUT`; `updateGlobalSettings`/`updateVehicleCategory` comparam a versão que o admin leu contra a versão atual do banco **antes** de aplicar qualquer mudança, e recusam com 409 se divergirem. O `optimisticConcurrency` do schema fica como uma segunda camada (defesa em profundidade) para o caso raro de duas escritas colidindo no mesmo instante, entre a checagem e o `.save()`.
- `updateVehicleCategory` sempre usou `findByIdAndUpdate` direto (não `.save()`), então o `optimisticConcurrency` do schema não se aplica a ele — a checagem lá é 100% manual: pré-checagem (mensagem rápida) + `__v` no próprio filtro do `findOneAndUpdate` (garantia atômica).
- Controllers (`updateTariff`, `updateVehicleCategory`) passaram a responder 409 explicitamente para esses conflitos, em vez de `next(error)` — mesma disciplina do Bloco B (erros de regra de negócio não podem ser mascarados pelo handler global em produção).
- Frontend (`Tariffs.jsx`): `GlobalSettingsCard` e `CategorySettingsCard` devolvem a versão lida junto com o submit; em 409, o toast explica o motivo e o cache da query é invalidado — **sem** resetar o formulário que o admin está editando (perderia o trabalho em andamento sem avisar).

### C4/C5/C6 — Reatribuição de corrida

- Nova `rideService.reassignRideByAdmin(rideId)` em `ride.service.js`, reaproveitando a transição já existente de `cancelRideByCaptain` (sem filtro de dono). Como `VALID_ORIGINS_BY_TARGET.requested` nunca incluiu `started`, essa transição sozinha já barra reatribuir uma corrida em andamento (C5) — não precisei adicionar uma checagem nova, só parar de contornar a que já existia.
- `dispatchRideToCaptains` exportada de `ride.controller.js` para poder ser chamada por `admin.controller.js`.
- `admin.controller.js: reassignRide` agora, depois de reatribuir: emite `ride-reassigned-by-admin` na sala da corrida (mesmo mecanismo de `ride-cancelled-by-captain`, usado quando o motorista desiste) e chama `dispatchRideToCaptains` excluindo o motorista removido — a corrida volta a ser oferecida a outros motoristas de verdade, em vez de ficar travada em `requested` pra sempre (C6).
- `admin.service.js: reassignRide` ganhou o parâmetro `ip` que a função sempre devia ter tido — usava `'0.0.0.0'` fixo (achado R48 do relatório, "IP fixo em logs"). Como eu já estava reescrevendo a função inteira e o `admin.controller.js` já tem `req.ip` disponível, corrigi isso também: baixo risco, direto no código que eu já estava tocando, alinha a função com o padrão que toda outra função de `admin.service.js` já segue.

## Fora de escopo desta execução

- Não toquei em nenhuma outra rota de update do admin além de `updateGlobalSettings`/`updateVehicleCategory` — outras (ex.: `updateCaptainDocument`, `toggleCaptainBlock`) não foram citadas no achado C1 e não fazem sentido para versionamento otimista (são ações de estado binário, não edição de formulário longo onde a janela de conflito importa).
- Não construí uma UI de "mesclar mudanças" — só "avisar e permitir recarregar", que é o que o plano original já qualificava como suficiente ("oferecendo recarregar/mesclar" — implementei a parte de recarregar).
- Não mexi na lógica de `bulkActionRides` (ação em lote de corridas) — fora do escopo dos achados C4/C5/C6, que são especificamente sobre `reassignRide`.

## Como verifico

Escrevi um script de verificação descartável (`_verify_bloco_e.js`, no padrão dos blocos B+C e D — supertest não era necessário aqui, então chamei os services diretamente) cobrindo:
- Edição concorrente de tarifas globais: primeira gravação com a versão certa funciona e incrementa `__tariffVersion`; segunda gravação com a versão antiga é recusada com 409 e **não** aplica por cima do que a primeira gravou.
- Mesmo teste para categoria de veículo, incluindo confirmar que uma terceira gravação com a versão atual (pós-conflito) volta a funcionar normalmente.
- Reatribuição de corrida `accepted`: muda para `requested`, remove `captain` e `otp`, devolve o `previousCaptain` correto.
- Reatribuição de corrida `started`: recusada, corrida permanece intacta (C5 fechado).
- Reatribuição de corrida `finished`: recusada.
- Reatribuição de corrida inexistente: erro claro.

18 asserções, todas passando. Removido depois — `git status` confirma que não sobrou.

Build do `admin-frontend`: limpo. Suíte do backend (`npm test`): 76 passam, 4 falham — mesma baseline de todos os blocos anteriores, nenhuma regressão (nenhum teste existente exercita tarifas ou reatribuição de corrida).

**Nada foi commitado.**
