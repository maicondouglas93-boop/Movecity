# Execução — Etapa 1 + Etapa 2 (App do Motorista)

**Base:** [auditoria de UX/UI de 2026-08-02](2026-08-02-auditoria-ux-motorista.md)
**Escopo desta execução:** Etapa 1 ("Correções que quebram o produto") + Etapa 2 ("Remover o falso") do plano de implementação da auditoria.
**Status:** ✅ concluído e verificado em 2026-08-02 (ao vivo, contra o servidor de dev real, o Atlas real e um navegador real). Nada commitado.

---

## 0. Descoberta que muda o escopo original

A auditoria descreveu a Etapa 1 como majoritariamente frontend. Ao levantar os contratos reais do backend, três dos seis itens exigem mudança de backend:

| Item | Achado |
|---|---|
| §2.2 upload de documentos | `POST /uploads/document` existe e devolve a URL, mas **nenhum endpoint persiste essa URL** no motorista — `registerCaptain` nem aceita `documents` no corpo. |
| §2.6 reidratar corrida | Existe `GET /rides/current` (passageiro). **Não existe equivalente para o motorista.** |
| §2.4 cancelar de verdade | **Não existe nenhum conceito de "motorista cancela corrida aceita"** no backend — só cancelamento pelo passageiro. Decisão de produto necessária. |

**Decisão do usuário para §2.4:** corrida volta para `requested`, sem motorista atribuído, reentra no despacho para outro motorista aceitar (não termina a corrida, não exige o passageiro pedir de novo).

---

## 1. Backend — mudanças necessárias

### 1.1 Persistir documento enviado (§2.2)

**Novo endpoint:** `PATCH /captains/documents`, `authCaptain`.

- **`Backend/controllers/captain.controller.js`:** novo `updateDocument(req, res)` — recebe `{ docType, url }`, valida `docType ∈ ['cnhFront','cnhBack','crlv','vehicleFront','selfie']`, faz `findByIdAndUpdate(req.captain._id, { [\`documents.${docType}.url\`]: url, [\`documents.${docType}.verified\`]: false }, { new: true })`. `verified:false` explícito porque um novo envio deveria voltar a exigir conferência do admin, mesmo que o campo já estivesse `true` de um envio anterior.
- **`Backend/routes/captain.routes.js`:** `router.patch('/documents', authMiddleware.authCaptain, body('docType').isIn([...]), body('url').isURL(), captainController.updateDocument)`.

### 1.2 Corrida ativa do motorista (§2.6)

**Novo endpoint:** `GET /rides/captain-current`, `authCaptain` — espelha exatamente `GET /rides/current` do passageiro.

- **`Backend/services/ride.service.js`:** novo `getCurrentRideForCaptain({ captain })` — `rideModel.findOne({ captain, status: { $in: ['accepted','going_to_pickup','arrived','waiting_passenger','started'] } }).populate('user').populate('captain')`.
- **`Backend/controllers/ride.controller.js`:** novo `getCurrentRideForCaptain`, mesmo formato do `getCurrentRide` (404 se não houver).
- **`Backend/routes/ride.routes.js`:** `router.get('/captain-current', authMiddleware.authCaptain, rideController.getCurrentRideForCaptain)`.

### 1.3 Motorista cancela corrida aceita, sem terminar a corrida (§2.4)

**Novo endpoint:** `POST /rides/captain-cancel`, `authCaptain`.

- **`Backend/services/ride.service.js`:** novo `cancelRideByCaptain({ rideId, captain })`:
  - pré-checagem: corrida existe, pertence a esse motorista (`captain: captain._id`), status ∈ `['accepted','going_to_pickup','arrived','waiting_passenger']` (os mesmos estados em que o botão "Cancelar" aparece no `ConfirmRidePopUp`; nunca depois de `started` — aí só existe `endRide`);
  - guarda atômica: `findOneAndUpdate({ _id: rideId, captain: captain._id, status: { $in: [...] } }, { $set: { status: 'requested' }, $unset: { captain: 1, otp: 1 } }, { new: true })` — reaproveita o padrão compare-and-set já usado em `transitionRide`, mas não usa `transitionRide` diretamente porque o alvo (`requested`) não é um destino normal da máquina de estados (é uma "reversão", não avanço); fica isolado e comentado como caso especial.
  - `$unset: otp` porque o PIN antigo não deve valer para o próximo motorista.
  - devolve a corrida atualizada + os dados de pickup para o controller redespachar.
- **Redespacho:** o `createRide` já faz busca por raio + filtro de veículo + `addSocketToRoom` + emit `new-ride` dentro do **controller** (não do service). Extraio esse bloco para um helper `dispatchRideToCaptains(ride, TRACE_ID, { excludeCaptainId })` em `ride.controller.js`, usado por `createRide` e pelo novo `captainCancel` — evita duplicar ~30 linhas de lógica de despacho já existente. `excludeCaptainId` impede que o motorista que acabou de cancelar receba a própria corrida de volta imediatamente.
- **`Backend/controllers/ride.controller.js`:** novo `captainCancelRide(req, res)` — chama o service, depois `dispatchRideToCaptains`, emite `ride-cancelled-by-captain` (ou reaproveita algo existente — decidido: novo evento, já que o significado é diferente de quando o *passageiro* cancela) para a sala do passageiro (`ride_${rideId}`) avisando que o motorista desistiu mas a busca continua.
- **`Backend/routes/ride.routes.js`:** `router.post('/captain-cancel', authMiddleware.authCaptain, body('rideId').isMongoId(), rideController.captainCancelRide)`.
- **Sem taxa de cancelamento:** o motorista desistindo não é culpa do passageiro — `cancellationFeeCharged` não se aplica aqui (diferente do cancelamento pelo passageiro).
- **Índice único `captain_active_ride_unique`:** ao fazer `$unset: captain`, o documento sai do escopo do índice parcial automaticamente — sem risco de conflito.

### 1.4 Testes de integração novos

`Backend/tests/integration/ride.api.test.js` e/ou `captain.api.test.js` (o que já existir com esse padrão):
- `PATCH /captains/documents` grava a URL e reseta `verified`.
- `GET /rides/captain-current` retorna 404 sem corrida ativa e 200 com a corrida certa.
- `POST /rides/captain-cancel`: corrida volta a `requested`, `captain` e `otp` ficam `undefined`; motorista tentando cancelar corrida de outro motorista → 404; cancelar corrida `started` → 409 (só `endRide` cobre esse estado).

---

## 2. Frontend — Etapa 1 (correções que quebram o produto)

| Item | Arquivo | Mudança |
|---|---|---|
| §2.1 hooks | `CaptainDetails.jsx` | Mover os dois `useState` para antes do `if (!captain) return null`. |
| §2.2 upload | `CaptainSignup.jsx` | Depois do 201 do `/captains/register`: para cada um dos 5 arquivos presentes, `POST /uploads/document` (`FormData` com `image` + `docType`) usando o token recém-recebido, depois `PATCH /captains/documents` com a URL. Sequencial com feedback de progresso ("Enviando documento 2 de 5..."), não paralelo — mais fácil de mostrar progresso e não sobrecarrega o Storage. Falha em um upload não deve travar o cadastro (a conta já foi criada) — registrar quais falharam e avisar que podem reenviar depois pelo Perfil. |
| §2.3 valor final | `FinishRide.jsx` | `endRideMutation.onSuccess: (data) => { setEnded(true); setEndedRide(data) }` — novo estado local guardando a corrida retornada pelo `end-ride`. A tela de pagamento passa a usar `endedRide?.finalPrice` (com fallback pro `props.ride.fare` só se por algum motivo `endedRide` não tiver chegado). |
| §2.4 cancelar de verdade | `ConfirmRidePopUp.jsx` | Botão "Cancelar" chama `POST /rides/captain-cancel`; sucesso fecha os painéis e mostra toast "Corrida liberada — buscando outro motorista para o passageiro."; loading próprio pra não deixar clicar duas vezes. |
| §2.5 aviso de GPS | `CaptainHome.jsx`, `CaptainRiding.jsx` | Consumir `locationError` do `LocationContext` (mesmo padrão do `Home.jsx` do passageiro) e mostrar toast + badge persistente "Sem sinal de GPS" enquanto durar — para o motorista entender por que não está recebendo corridas. |
| §2.6 reidratar corrida | `CaptainRiding.jsx` | Ao montar, se `location.state?.ride` vier vazio (refresh direto na rota), buscar `GET /rides/captain-current`; se não houver corrida ativa, redirecionar para `/captain-home`. |

## 3. Frontend — Etapa 2 (remover o falso)

| Item | Arquivo | Mudança |
|---|---|---|
| Placeholders "Em Breve" | `CaptainDetails.jsx` | Remover a seção inteira (linhas 201-218 do arquivo original). |
| "+12% vs Ontem" | `CaptainDetails.jsx` | Remover — não há dado real por trás. |
| "Tempo médio de espera: 3 min" | `CaptainDetails.jsx` | Remover a frase; manter só "Fique online para receber corridas" / texto equivalente sem número inventado. |
| "Meta do dia" | `CaptainDetails.jsx` | Remover o bloco inteiro (meta de R$30 fixa, sem suporte no backend). |
| `'2.2'` KM fixo | `ConfirmRidePopUp.jsx` | Trocar o fallback por `'—'`, igual ao padrão já usado no resto do app quando falta dado. |
| `acceptanceRate \|\| 100` | `CaptainEarnings.jsx` | Não vou calcular a métrica de verdade agora (backend não grava esse dado — é fora do escopo combinado). Ação mínima e honesta: se o valor vier `undefined`/`null` do backend, **esconder a barra de Taxa de Aceitação** em vez de fabricar 100%. Sinalizar ao usuário que o cálculo real fica para uma etapa futura. |
| `rating \|\| '5.0'` | `CaptainDetails.jsx`, `CaptainEarnings.jsx` | Planejado inicialmente como dado falso, revertido durante a execução — ver "decisões tomadas durante a implementação" na §5, abaixo: `rating` é recalculado de verdade a cada avaliação, `5.0` é só o ponto de partida neutro. |
| 4 Ações Rápidas sem ação | `CaptainDetails.jsx` | Planejado como renomear o 4º atalho ("Corridas", que duplicava "Histórico"); na execução virou remoção — ver §5. |
| `alert()` nativo | `CaptainDetails.jsx` | Trocar as 2 chamadas por `addToast(..., 'error')`, usando o `ToastContext` já disponível no resto do app. |

---

## 4. Ordem de execução

1. Backend 1.1, 1.2, 1.3 (endpoints novos) + 1.4 (testes) — nada quebra o que já existe, tudo aditivo.
2. Frontend Etapa 1 (§2.1 a §2.6) — depende dos endpoints do passo 1.
3. Frontend Etapa 2 (remoções e correções de honestidade) — independente do passo 1, mas feito depois pra não misturar diffs de "conserta" com "remove".
4. Verificação: suíte de testes do backend (baseline atual) + build do frontend + verificação ao vivo dos fluxos críticos (cadastro com upload real no Firebase, motorista cancelando e outro motorista recebendo a corrida de volta, refresh durante corrida, GPS negado).

**Nada será commitado sem pedido explícito**, conforme a regra do projeto.

---

## 5. Detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

### Backend — os 3 endpoints novos

**`Backend/controllers/captain.controller.js` + `routes/captain.routes.js`:** `PATCH /captains/documents` (`authCaptain`) — valida `docType` contra os 5 tipos do schema, grava `documents.<docType>.url` e reseta `documents.<docType>.verified` para `false` (reenvio deve voltar a exigir conferência do admin, mesmo que o anterior já estivesse verificado).

**`Backend/services/ride.service.js` + `controllers/ride.controller.js` + `routes/ride.routes.js`:**
- `getCurrentRideForCaptain` / `GET /rides/captain-current` — espelha `getCurrentRide` do passageiro, restrito aos status ativos de motorista (`accepted` a `started`).
- `cancelRideByCaptain` / `POST /rides/captain-cancel` — nova entrada no mapa `VALID_ORIGINS_BY_TARGET`: `requested: ['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger']`, a única *reversão* da máquina de estados (todo o resto é progressão ou término). `transitionRide` ganhou um quarto parâmetro opcional, `extraUnset`, pra suportar `$unset` de `captain` e `otp` no mesmo `findOneAndUpdate` atômico — sem isso o PIN antigo continuaria valendo pro próximo motorista que aceitasse. Sem taxa de cancelamento (diferente do cancelamento pelo passageiro): a desistência é responsabilidade do motorista.
- **Redespacho:** a lógica de busca por raio + filtro de veículo + `addSocketToRoom` + emit `new-ride`, que só existia dentro do controller de `createRide`, foi extraída para `dispatchRideToCaptains(ride, {pickup, vehicleType, TRACE_ID, excludeCaptainId})` — reaproveitada por `createRide` (comportamento idêntico ao de antes) e por `captainCancelRide` (com `excludeCaptainId` pra não devolver a corrida pro mesmo motorista que acabou de desistir).

**Achado incidental corrigido, fora do escopo original mas bloqueando a verificação:** `services/__mocks__/maps.service.js` (mock global de testes) nunca incluiu `getCaptainsInTheRadius` — toda chamada quebrava com `TypeError` dentro dos testes. Essa era a causa raiz da falha crônica de `POST /rides/create` arrastada desde a auditoria de concorrência (2026-08-02, fase anterior). Corrigido delegando essa função específica pro `jest.requireActual` (ela é uma query pura no Mongo, sem API externa — só as outras 3 funções do mock precisam de fake por dependerem do Google Maps de verdade). Um segundo bug, agora no próprio teste de `POST /rides/create` (`paymentMethod: 'Pix'`, capital, quando o enum do schema é `'pix'` minúsculo), também foi corrigido. **Resultado: a suíte do backend saiu de `1 falha crônica | 77 passes` para `0 falhas | 85 passes`** (77 + 8 testes novos desta etapa, todos passando) — uma falha que persistia desde o início da fase de auditoria de concorrência foi eliminada como efeito colateral de consertar a infraestrutura de teste necessária para verificar o redespacho.

**Novos testes:** `tests/integration/ride.api.test.js` ganhou `GET /rides/captain-current` (3 casos: 404 sem corrida, 200 com a corrida certa, 404 pra corrida de outro motorista) e `POST /rides/captain-cancel` (4 casos: devolve pra `requested` sem captain/otp; rejeita cancelar corrida de outro motorista; rejeita cancelar corrida já `started`; confirma que o redespacho não derruba a request mesmo sem `io` inicializado no processo de teste).

### Frontend — Etapa 1 (correções que quebram o produto)

- **§2.1 (`CaptainDetails.jsx`):** os dois `useState` que viviam depois do `if (!captain) return null` subiram pra antes — elimina o crash de "Rendered more hooks than during the previous render" no instante em que o perfil termina de carregar.
- **§2.2 (`CaptainSignup.jsx` + backend):** depois do 201 do registro, sobe sequencialmente cada documento presente via `POST /uploads/document` (com o token recém-emitido) e persiste a URL via `PATCH /captains/documents`. Falha em um documento não derruba o cadastro (a conta já existe) — só entra numa lista e o motorista é avisado por toast, com o botão mostrando "Enviando documento X de Y..." durante o processo.
- **§2.3 (`FinishRide.jsx`):** a tela de "Confirmar Pagamento" passou a usar `finalPrice` (devolvido pelo `end-ride`, já com distância/tempo reais e taxa de espera somada) em vez de `props.ride.fare` (a estimativa pré-corrida). Sem essa troca, o motorista cobrava sistematicamente a menos toda vez que a corrida real fosse mais longa ou demorada que a estimativa.
- **§2.4 (`ConfirmRidePopUp.jsx` + backend):** "Cancelar" agora chama `POST /rides/captain-cancel` de verdade, com loading próprio e toast de confirmação — em vez de só fechar os painéis deixando a corrida presa no motorista.
- **§2.5 (`CaptainHome.jsx` + `CaptainDetails.jsx`):** toast de erro (edge-triggered, só quando o GPS falha) em `CaptainHome.jsx`, e banner persistente + card de status mudando pra "Online, sem GPS" (vermelho) em vez de "Procurando corridas..." (verde, mentiroso nesse estado) em `CaptainDetails.jsx` — ambos consumindo `locationError` do `LocationContext` já existente.
- **§2.6 (`CaptainRiding.jsx` + backend):** `rideData` virou estado (antes era `const` fixo em `location.state?.ride`). Se vier vazio na montagem, busca `GET /rides/captain-current`; sem corrida ativa, redireciona pra Home com aviso. Tela de loading simples enquanto a busca acontece, em vez de renderizar com dados `undefined`.

### Frontend — Etapa 2 (remover o falso)

Removidos de `CaptainDetails.jsx`: a seção "Em Breve" (3 cards de funcionalidade inexistente), "+12% vs Ontem" (número fixo no código), "Tempo médio de espera: 3 min" (idem), e o bloco inteiro de "Meta do dia" (meta de R$30 sem nenhum suporte no backend). O `'2.2'` KM fixo em `ConfirmRidePopUp.jsx` (fallback de um campo `distance` que o schema já marca como deprecated e nenhum service escreve) virou `'—'`, com o campo real (`estimatedDistance`) no lugar quando disponível. Em `CaptainEarnings.jsx`, a barra "Taxa de Aceitação" foi removida — `acceptanceRate` nunca é calculado por nenhum service (fica travado no default do schema, 100%, pra sempre); "Taxa de Cancelamento" ficou, porque essa **é** recalculada de verdade em `captainService`. Os 3 atalhos com destino real (Carteira, Histórico, Ganhos) ganharam `onClick`/navegação de verdade; `alert()` nativo virou `addToast`.

**Duas decisões tomadas durante a implementação, divergindo do que o plano original previa, sinalizadas aqui:**
1. **`rating` não foi tratado como dado falso.** O plano original agrupou `rating || '5.0'` junto com `acceptanceRate || 100`, mas na prática são diferentes: `rating` **é** recalculado de verdade a cada avaliação (`captainService.recalculateRating`, chamado em `submitReview`) — `5.0` é só o ponto de partida neutro de um motorista sem avaliações ainda, não um número nunca calculado. Reverti a mudança planejada pra esse campo específico.
2. **O atalho "Suporte" foi removido, não redirecionado.** Não existe nenhuma tela de suporte no módulo do motorista (nem no passageiro — `Help.jsx` do passageiro é conteúdo estático sem ações reais, e fica atrás de um wrapper de autenticação de passageiro, não de motorista). Apontar o atalho pra qualquer lugar seria recriar o mesmo problema que a Etapa 2 existe pra resolver (botão que promete algo que não entrega). Ficaram 3 atalhos reais em vez de 4.

### Verificação

**Suíte do backend:** `0 falhas | 85 passes` (subiu de `1 falha crônica | 77 passes` — a falha pré-existente foi eliminada, ver achado incidental acima).

**Build do frontend:** `vite build` limpo, sem erros novos. Suíte do frontend na mesma baseline de sempre (`3 falhas | 4 passes`, conforme [[baseline-testes-frontend-quebrado]]).

**Verificação ao vivo contra o servidor de dev real, o Atlas real e o Firebase Storage real** (script descartável, depois removido):
- Upload de documento: a chamada chegou certinho até o Firebase (multer + sharp processaram o arquivo real), mas **o bucket do Storage retornou 404** — achado de infraestrutura pré-existente, não um bug do meu código: nenhum lugar do app (nem passageiro, nem motorista) jamais chamou qualquer endpoint de upload antes desta etapa, então esse subsistema inteiro nunca tinha sido exercitado de verdade. Confirmado isoladamente que `PATCH /captains/documents` (o endpoint que eu criei) persiste corretamente no Atlas real quando recebe uma URL — a lacuna está inteiramente na configuração do bucket do Firebase (`FIREBASE_STORAGE_BUCKET=movecity-12a8d.firebasestorage.app`), fora do meu alcance corrigir sem acesso ao console do Firebase/GCP.
- `GET /rides/captain-current`: 404 sem corrida ativa, 200 com a corrida certa.
- `POST /rides/captain-cancel`: corrida volta pra `requested`, `captain` e `otp` limpos no Atlas; **um segundo motorista real, conectado via socket de verdade (não um script), recebeu o evento `new-ride`** em menos de 1 segundo depois do cancelamento.

**Verificação ao vivo via navegador real (Playwright, 2-3 abas simultâneas, servidor de dev + Atlas reais):**
- Motorista loga, chega na Home sem crash, sem nenhum dos placeholders/números falsos removidos na Etapa 2.
- Atalho "Carteira" navega de verdade pra `/captain-wallet`.
- **§2.6:** navegação direta pra `/captain-riding` sem passar pelo fluxo normal (equivalente a um refresh no meio de uma corrida `started`) recupera a corrida real do servidor — passageiro, endereços e valor aparecem corretos, sem tela quebrada.
- **§2.4, ponta a ponta:** passageiro cria uma corrida real via API → motorista recebe o popup via socket real → aceita pela UI (endereço real aparece no `ConfirmRidePopUp`) → cancela pela UI → toast de confirmação aparece → corrida confirmada como `requested` no Atlas → **um segundo motorista, numa aba de navegador real e independente, recebe o popup da corrida redespachada** (mesmo teste do bloco anterior, mas fechando o ciclo inteiro por cliques reais em vez de chamadas HTTP diretas).

**Achado de metodologia de teste durante esta verificação (não um bug de produto), documentado para não repetir:** o primeiro teste de aceitar+cancelar deu falso-negativo com "Element is outside of the viewport" ao clicar em "Aceitar". Investigado com bounding box: o botão estava genuinamente fora da tela (y=1854 numa viewport de 1400px) porque meu `waitFor(texto do heading "Nova Corrida Disponível!")` — um heading estático, sempre presente no DOM porque o painel nunca desmonta (mesmo padrão "always mounted, GSAP anima transform" já documentado nesta sessão desde o bug de `ride-taken` da auditoria de concorrência) — resolvia instantaneamente, antes do evento `new-ride` real ter chegado (que depende de geocoding de verdade, mais lento que um mock). Corrigido esperando por conteúdo condicional de verdade (o endereço real da corrida) em vez do heading fixo. Um segundo problema, encontrado ao tentar reaproveitar o mesmo motorista pra dois cenários seguidos: fechar a aba do motorista desconecta o socket dele, e o handler de disconnect (comportamento **correto** do produto, auditado antes nesta sessão) marca `isOnline:false` — corrigido usando um terceiro motorista dedicado só pro segundo cenário, em vez de reaproveitar o primeiro.

**Achado de ambiente durante a verificação final (não relacionado ao código desta etapa):** a suíte do backend, ao rodar de novo pra confirmar o resultado final, retornou uma quantidade grande de falhas (`MongoNetworkError: ECONNRESET`, depois `Mongod internal error`). Diagnosticado como acúmulo de processos: 12 processos Jest de fases anteriores desta sessão (antes da compactação da conversa) que nunca terminaram — o mesmo problema de não-saída do Jest já documentado (cron job do `tariffScheduler` mantém o processo vivo) — continuavam rodando havia horas, cada um com seu próprio MongoDB em memória, disputando recursos com a suíte nova. Encerrados os processos órfãos (identificados com precisão via `wmic ... get CommandLine` antes de qualquer ação, pra não tocar em nada do usuário) e limpo o cache temporário do `mongodb-memory-server` (`%TEMP%/mongo-mem-*`, corrompido pelo encerramento abrupto anterior). Depois da limpeza, suíte voltou a `0 falhas | 85 passes` de forma consistente.

**Nada foi commitado.**
