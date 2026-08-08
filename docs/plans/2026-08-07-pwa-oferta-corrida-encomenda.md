# Plano — Melhor experiência de oferta (Aceitar/Recusar) no PWA do motorista

**Status:** implementado (aprovado via "começa a corrigir"). Ver seção 11 (Resultado) no final.

## 0. Objetivo

Melhorar a experiência de receber/aceitar/recusar corrida e encomenda quando o
motorista usa o **PWA no navegador** (foreground e background), sem tocar na
implementação Android nativa (`frontend/android/**`), que já funciona
corretamente (Full-Screen Intent corrigido na auditoria anterior).

---

## 1. Arquitetura atual encontrada

### 1.1 Recepção da oferta

- **Socket.IO** é o único caminho real de apresentação em foreground. Único
  lugar que escuta e desenha UI a partir disso:
  [CaptainHome.jsx](frontend/src/driver/pages/CaptainHome.jsx) —
  `handleNewRide`/`handleNewParcel` (linhas ~316-459).
  [CaptainParcels.jsx](frontend/src/driver/pages/CaptainParcels.jsx#L186-L196)
  também escuta `new-parcel`/`parcel-taken`, mas só para dar `refresh()` na
  lista daquela página — **não é um segundo caminho de apresentação
  concorrente**, não desenha popup.
- **Web Push (FCM) existe de verdade** para o navegador, não é só o nativo:
  [frontend/public/firebase-messaging-sw.js](frontend/public/firebase-messaging-sw.js)
  (background) +
  [frontend/src/shared/services/fcm.js](frontend/src/shared/services/fcm.js)
  (foreground, via `onForegroundMessage`). Usa o **mesmo backend de envio** do
  Android nativo — `notificationService.sendNewRide`/`sendNewParcel`
  ([Backend/controllers/ride.controller.js:80](Backend/controllers/ride.controller.js#L80),
  [Backend/controllers/parcel.controller.js:35](Backend/controllers/parcel.controller.js#L35)) — o
  campo `device` do token (`'android'` vs `navigator.userAgent`) é só o que
  diferencia o destino.
- **Sem TTL/expiração no backend.** Não existe `offerExpiresAt` em lugar
  nenhum: nem no schema do Mongo (`Ride`/`Parcel`), nem no payload do socket
  (`toCaptainRideResponse`), nem no payload do FCM. O Android usa um valor
  **fixo e local** (`RideOfferNotifier.java`, `.setTimeoutAfter(45_000)`) sem
  relação com nada do servidor — é só quando a notificação nativa se
  autodesfaz, não uma regra de negócio.
- **Não existe re-despacho para corridas imediatas.** `dispatchAttempts` /
  `dispatchLeaseUntil` / `activatedAt` (vistos em `ride.model.js`) são só do
  worker de **corridas agendadas** ([schedule.service.js](Backend/services/schedule.service.js)) —
  ele ativa (`scheduled` → `requested`) perto do horário marcado. Uma corrida
  imediata é despachada **uma única vez**; fica `requested` até alguém
  aceitar ou o passageiro cancelar. Ou seja: **hoje não existe nenhum prazo
  real de servidor para uma oferta** — "expira" é puramente uma decisão de
  apresentação (esconder o popup/notificação), nunca cancela a corrida.

### 1.2 Apresentação — foreground

Tudo centralizado em `CaptainHome.jsx`:

- Toca `/sounds/new-ride.wav` **uma vez**, sem loop, sem nada que a pare (não
  há o que parar hoje — só um `play()`).
- Vibra (`vibrate([500, 200, 500])`).
- Mostra toast.
- Chama `presentNativeRideOffer(...)` — **no-op fora do Capacitor**
  ([nativeRideOffer.service.js](frontend/src/shared/platform/nativeRideOffer.service.js) —
  `if (!isNativePlatform()) return`), então no PWA essa chamada não faz nada.
- **Se** web + permissão concedida, chama `showBrowserNotification(...)`
  **mesmo com o modal já foreground e visível** — notificação do SO
  redundante ao lado do modal que já está na tela.
- Abre `RidePopUp.jsx` (corrida) ou `ParcelPopUp.jsx` (encomenda) dentro de um
  `BottomSheet`/inline.
  - `RidePopUp`: botão "Aceitar" chama `props.confirmRide()` **direto, sem
    guarda de duplo clique nem estado "Aceitando..."**.
  - `ParcelPopUp`: **já tem** guarda de duplo clique (`busy` state) e mostra
    "Aguarde…" — mais robusto que o de corrida hoje.
- **Sem contador regressivo.** Removido de propósito em 2026-08-03 — o
  próprio código documenta o motivo: um countdown local de 20s não tinha
  nenhum estado real do servidor para sincronizar, e escondia o popup sem
  declinar nada (corrida "fantasma"). Isso é exatamente o requisito 4 deste
  pedido: fazer certo desta vez, com uma fonte real de verdade.

### 1.3 Apresentação — background (PWA)

- `firebase-messaging-sw.js` → `onBackgroundMessage`: monta notificação real
  do SO via `self.registration.showNotification(...)`, com
  `tag: ride-<id>`/`parcel-<id>` — **dedupe nativo do próprio SO**: a mesma
  tag *substitui* a notificação anterior (não duplica); `renotify:true` faz o
  SO alertar de novo mesmo substituindo.
- **Sem ações** (Aceitar/Recusar) na notificação — decisão já tomada e
  documentada no próprio arquivo: "Ignora ações legadas... sempre só abre o
  app". Clique sempre foca/abre e navega para
  `/captain-home?rideOffer=<id>` ou `?parcelOffer=<id>`.
- `notificationclick`: `focusOrOpenWindow` foca janela existente (com
  `client.navigate()` quando suportado, fallback `postMessage`), e **só
  fecha a notificação depois de garantir o foco** — comentário no código
  explica um bug conhecido do Chrome Android que motivou essa ordem.
- `CaptainHome.jsx` consome `?rideOffer=`/`?parcelOffer=` num `useEffect` que
  **sempre revalida contra o backend** (`/rides/pending`,
  `/rides/captain-current`, `getPendingParcels`) antes de reabrir o popup —
  nunca confia cegamente no id do push. **Isso já está correto.**

### 1.4 Aceitar / Recusar

- Corrida: `POST /rides/:id/accept` → `performAcceptRide` (mesmo caminho
  atômico de `/rides/confirm`,
  [ride.controller.js:187](Backend/controllers/ride.controller.js#L187)) — já
  devolve mensagens **distintas** por 409/404
  (`RIDE_ALREADY_ACCEPTED`, `RIDE_CANCELLED`, `RIDE_NOT_FOUND`,
  `CAPTAIN_ALREADY_HAS_ACTIVE_RIDE`). **O frontend não usa essa distinção** —
  `confirmRide` em `CaptainHome.jsx` trata **qualquer 409** com a mesma
  mensagem genérica "Essa corrida já foi aceita por outro motorista", mesmo
  quando a causa real é o passageiro ter cancelado.
- Recusa: `POST /rides/:id/decline` — ACK *best-effort* (erro é ignorado de
  propósito, só fecha o popup local). Comportamento correto, mantém.
- Encomenda: `POST /parcels/:id/accept` / `/decline`
  ([parcelApi.js](frontend/src/shared/services/parcelApi.js)), chamados de
  dentro do próprio `ParcelPopUp` (guarda de duplo clique já cobre).
- `ride-taken` / `parcel-taken` (emitidos pelo backend quando outro
  motorista vence) já são tratados nos dois casos — fecha o popup certo e
  avisa. **Já está correto.**

### 1.5 Concorrência (múltiplas ofertas)

Dois problemas reais, confirmados lendo o código (não hipotéticos):

- `handleNewRide` **descarta silenciosamente** (nem entra na lista
  persistente `pendingRides`) se já existir oferta de encomenda pendente
  (`captainParcelRef.current || parcelOfferRef.current`) — e vice-versa em
  `handleNewParcel`. Só volta a aparecer no próximo `syncPendingRides()`
  (troca de aba, reconexão, volta do background) — não imediatamente.
- Duas ofertas do **mesmo tipo** em sequência: a mais nova **substitui** a
  mais antiga no modal (`setRide(data)` sobrescreve sem fila) — a primeira só
  sobra no card "Corrida disponível" da Home, não como prioridade.
- Isso é esperado do lado do backend: `findCaptainsNearPickup` só exclui do
  despacho quem já tem corrida/encomenda **aceita**
  (`excludeActiveRide`/`excludeActiveParcel`), não quem só tem uma oferta
  pendente na tela. Motoristas ociosos **podem legitimamente** receber duas
  ofertas em sequência — não vou mudar essa regra de despacho.

### 1.6 Idempotência

Nenhuma dedup explícita por `offerId` no frontend hoje. Na prática, hoje não
duplica em foreground porque `onForegroundMessage` **ignora** de propósito
`NEW_RIDE`/`NEW_PARCEL` (comentário: "socket/popup já cobrem — sem toast
duplicado") — só o socket dispara o popup em foreground. Em background, o
`tag` da notificação já deduplica no nível do SO. O risco real de duplicação
está numa reconexão de socket disparando `syncPendingRides()` enquanto uma
notificação de background com a mesma oferta ainda está pendente de clique —
caso hoje não coberto por nenhuma trava explícita.

---

## 2. Problemas encontrados (priorizados)

| # | Severidade | Problema | Onde |
|---|---|---|---|
| P1 | 🟠 Alto | Sem `offerExpiresAt` real — countdown sincronizado (requisito 4) é impossível sem uma mudança aditiva no backend | Backend: payload de despacho |
| P2 | 🟠 Alto | `RidePopUp` "Aceitar" sem trava de duplo clique / estado "Aceitando..." (`ParcelPopUp` já tem) | [RidePopUp.jsx:97-107](frontend/src/driver/components/RidePopUp.jsx#L97-L107) |
| P3 | 🟡 Médio | Oferta de corrida descartada silenciosamente se há oferta de encomenda pendente (e vice-versa) — sem fila, sem persistência imediata | [CaptainHome.jsx:320](frontend/src/driver/pages/CaptainHome.jsx#L320), [:429](frontend/src/driver/pages/CaptainHome.jsx#L429) |
| P4 | 🟡 Médio | Duas ofertas do mesmo tipo em sequência: a mais nova substitui a mais antiga no modal sem fila/aviso | [CaptainHome.jsx:322](frontend/src/driver/pages/CaptainHome.jsx#L322) |
| P5 | 🟡 Médio | 409 genérico tratado com mensagem única, ignorando que o backend já distingue `RIDE_CANCELLED` de `RIDE_ALREADY_ACCEPTED` | [CaptainHome.jsx:657-668](frontend/src/driver/pages/CaptainHome.jsx#L657-L668) |
| P6 | 🟡 Médio | Som toca uma vez, sem loop, sem stop explícito (vira obrigatório ao introduzir countdown) | [CaptainHome.jsx:333](frontend/src/driver/pages/CaptainHome.jsx#L333) |
| P7 | 🔵 Baixo | `showBrowserNotification` dispara mesmo com o modal já visível em foreground — notificação do SO redundante | [CaptainHome.jsx:360-368](frontend/src/driver/pages/CaptainHome.jsx#L360-L368) |
| P8 | 🔵 Baixo | Lógica de oferta espalhada dentro de um `CaptainHome.jsx` de ~950 linhas, misturando ride e parcel — causa raiz indireta de P3/P4/P6 | [CaptainHome.jsx](frontend/src/driver/pages/CaptainHome.jsx) |

---

## 3. Estratégia escolhida

### 3.1 Backend — mudança mínima e aditiva

Adicionar uma constante única `OFFER_TTL_MS` (proposta: **45000**, igual ao
valor já usado hoje no Android nativo — mantém a experiência "consistente"
pedida no requisito principal) e expor `offerExpiresAt` **calculado, não
persistido**:

```text
offerExpiresAt = (ride.activatedAt || ride.createdAt).getTime() + OFFER_TTL_MS
```

`activatedAt` já existe e é exatamente o momento certo para corrida agendada
recém-ativada; `createdAt` (já vem de `timestamps: true`) cobre a corrida
imediata. **Sem migração de schema** — o valor nasce igual toda vez que for
calculado a partir do mesmo documento, então pode entrar em:

- payload do `new-ride`/`new-parcel` (socket);
- payload de dados do FCM (`sendNewRide`/`sendNewParcel`) — campo novo,
  Android **ignora silenciosamente** (não lê essa chave hoje), zero risco
  para o nativo, respeita a regra "não alterar o Android";
- `GET /rides/pending`, `GET /parcels/pending`, `GET /rides/captain-current`
  — para o countdown ficar certo mesmo quando a oferta chega por
  sincronização, não só por push.

**Importante — decisão que preciso confirmar (seção 5):** "expirar" aqui
significa **só esconder o popup/notificação e desabilitar Aceitar**, igual
ao Android hoje. **Não** vou fazer o backend cancelar/recusar a corrida
sozinho quando o prazo passar — isso seria uma regra de negócio nova, que o
pedido explicitamente me instrui a não inventar sem antes confirmar. A
corrida continua existindo em `pendingRides` (card "Corrida disponível") até
o passageiro cancelar ou outro motorista aceitar, exatamente como já
funciona hoje.

### 3.2 Frontend — camada única de oferta + apresentação por plataforma

Criar `frontend/src/shared/services/rideOffer/` com:

- `rideOfferMachine.js` (ou hook `useRideOfferQueue.js`): estado único
  `received → displayed → accepting/rejecting → accepted/rejected → expired`,
  parametrizado por `kind: 'ride' | 'parcel'`. Fila simples (array,
  FIFO) — só uma oferta "em destaque" por vez; a próxima da fila assume
  quando a atual sai (aceita/recusada/expirada/tomada por outro). Dedup por
  `offerId` na entrada da fila (requisito 5).
- `CaptainHome.jsx` passa a **consumir** essa camada em vez de reimplementar
  os `useState`/`useRef` de oferta — reduz P3/P4/P8 de uma vez, já que fila +
  dedup ficam num único lugar em vez de espalhados em `handleNewRide` /
  `handleNewParcel`.
- `RidePopUp.jsx` e `ParcelPopUp.jsx` ganham: contador (`remaining =
  offerExpiresAt - Date.now()`, recalculado a cada tick — nunca um timer que
  só conta pra baixo cego), trava de duplo clique/estado "Aceitando..." (só
  falta em `RidePopUp`), e param de som/vibração ao sair do estado
  `displayed`.
- `browserNotify.js` / `showBrowserNotification`: só dispara quando o app
  **não está em foreground visível com o modal já aberto** — remove a
  notificação redundante (P7).
- 409 do accept: mapear a mensagem real vinda do backend
  (`RIDE_CANCELLED` → "O passageiro cancelou esta corrida.",
  `RIDE_ALREADY_ACCEPTED` → mensagem atual, `CAPTAIN_ALREADY_HAS_ACTIVE_RIDE`
  → mensagem própria) em vez do texto único genérico (P5).

A apresentação continua **separada por plataforma**, como pedido: Android
native (`RideOfferActivity`, intocado) e PWA (`RidePopUp`/`ParcelPopUp`,
agora alimentados pela mesma máquina de estado). Nenhum arquivo em
`frontend/android/**` é tocado.

---

## 4. Arquivos que serão modificados

**Backend:**
- `Backend/controllers/ride.controller.js` — incluir `offerExpiresAt` no
  payload de `dispatchRideToCaptains` (socket) e no data do FCM;
  `toCaptainRideResponse` passa a calcular e incluir o campo.
- `Backend/controllers/parcel.controller.js` — idem para `dispatchParcelToCaptains`/`toParcelOfferDTO`.
- Novo: `Backend/config/offerPolicy.js` (ou similar) — única fonte da
  constante `OFFER_TTL_MS` e da função de cálculo, reaproveitada pelos dois
  controllers (evita duplicar a fórmula).

**Frontend (PWA/compartilhado — nunca Android nativo):**
- `frontend/src/driver/pages/CaptainHome.jsx` — passa a usar a nova camada de
  oferta em vez da lógica inline atual.
- `frontend/src/driver/components/RidePopUp.jsx` — countdown, trava de duplo
  clique, estado "Aceitando...".
- `frontend/src/driver/components/ParcelPopUp.jsx` — countdown (o resto já
  existe).
- Novo: `frontend/src/shared/services/rideOffer/` (fila + máquina de
  estado + dedup por `offerId`).
- `frontend/src/shared/services/browserNotify.js` — evitar notificação
  redundante em foreground com modal já visível.

**Não vou tocar em nada dentro de `frontend/android/**`.**

---

## 5. Arquivos que NÃO precisam ser modificados

- Toda a árvore `frontend/android/**` (Java nativo) — regra explícita.
- `frontend/src/shared/platform/nativeRideOffer.service.js`,
  `notification.service.js` (bridge nativo) — a interface
  `presentNativeRideOffer` já é suficiente, não precisa mudar.
- `frontend/src/driver/pages/CaptainParcels.jsx` — só dá refresh de lista,
  não é um caminho de apresentação duplicado.
- `Backend` — `performAcceptRide`, `rideService.acceptRideAtomic`,
  `rideService.declineRide` e equivalentes de parcel: já corretos e
  atômicos; só vou **consumir melhor** as mensagens que já devolvem, sem
  mudar a lógica de aceite em si.
- `frontend/public/firebase-messaging-sw.js` — o comportamento de
  exibição/clique já está correto (dedupe por `tag`, foco antes de fechar);
  no máximo passa a receber `offerExpiresAt` no `data` sem mudar
  comportamento de exibição.

---

## 6. Limitações inevitáveis do PWA (não vou prometer paridade 100%)

- **Autoplay de áudio**: mesmo em foreground, alguns navegadores só liberam
  áudio depois de uma interação prévia do usuário na página nessa sessão.
  Loop de som é garantido só enquanto a aba estiver em foreground.
- **App realmente fechado**: sem gesto do usuário e sem SW ativo (Android
  mata processos agressivamente; iOS mais ainda), push pode não acordar o
  navegador — não há garantia comparável ao Full-Screen Intent nativo.
- **iOS Safari**: Web Push só funciona com o PWA instalado na tela de início
  (A2HS); nunca numa aba comum. `navigator.vibrate` não existe no iOS Safari,
  nem instalado.
- **Sem abrir sobre tela bloqueada**: nenhuma API web abre a aplicação por
  cima do lock screen automaticamente — exclusivo de app nativo.
- **Timers em segundo plano são "throttled"**: com a aba em background, um
  `setInterval` de UI perde precisão — o countdown precisa ser recalculado a
  partir de `offerExpiresAt` toda vez que a aba volta a ficar visível, nunca
  confiar no valor acumulado de um timer que ficou rodando escondido.

---

## 7. Decisões que preciso confirmar antes de implementar

1. **`OFFER_TTL_MS = 45000`** (igual ao Android nativo hoje) — ok manter esse
   valor, ou prefere outro?
2. **"Expirar" só esconde a UI** (popup + notificação) e desabilita Aceitar —
   **não** cancela/recusa a corrida no backend sozinho. A corrida continua
   disponível no card "Corrida disponível" até o passageiro cancelar ou
   outro motorista aceitar (comportamento atual mantido). Confirma esse
   entendimento?
3. **Fila de ofertas**: uma em destaque por vez, FIFO, cross-tipo (corrida e
   encomenda entram na mesma fila, dedupe por `offerId`) — concorda com essa
   política, já que o backend não impede duas ofertas simultâneas para o
   mesmo motorista ocioso?

---

## 8. Plano de testes (manual, navegador real)

**Foreground:**
- Corrida chega → modal aparece, som/vibração tocam, countdown visível e
  decrescente, Aceitar funciona com feedback "Aceitando...".
- Recusar → popup fecha, `POST /decline` disparado, sem navegação extra.
- Expiração → chega faltando ~5s no `offerExpiresAt` simulado → countdown
  zera → Aceitar desabilita → popup fecha sozinho → mensagem "Oferta
  expirada".

**Background:**
- Notificação aparece (Chrome desktop + Chrome Android) com origem/destino/
  valor. Clique foca/abre o app e leva à oferta certa (revalidada contra o
  backend, não só o id do push).

**Janela fechada:**
- Web Push chega (quando o navegador permitir) → clique abre o app → oferta
  correta é recuperada via `/rides/pending`/`/rides/captain-current`.

**Duplicação:**
- Disparar a mesma oferta duas vezes (socket + FCM quase simultâneo,
  reconexão) → 1 modal, 1 notificação, 1 timer, 1 chamada de aceite.

**Concorrência:**
- Duas corridas em sequência para o mesmo motorista ocioso → primeira fica
  em destaque, segunda entra na fila (ou aparece no card, conforme decisão
  da seção 7) — nunca dois modais sobrepostos.
- Corrida + encomenda quase simultâneas → nenhuma é descartada
  silenciosamente (corrige P3).

**Erro de rede:**
- Aceitar com rede indisponível → não considera aceite concluído, informa o
  problema, permite tentar de novo (já existe fila offline —
  `enqueueOfflineAction` — comportamento mantido/verificado, não
  reinventado).

**Regressão Android:**
- Build `assembleDebug` continua limpo, `RideOfferNotifier`/
  `MoveCityMessagingService` inalterados, campo `offerExpiresAt` extra no
  payload FCM não quebra o parsing nativo existente (ele só lê as chaves que
  já conhece).

---

## 9. Riscos

- Mudar `toCaptainRideResponse`/`toParcelOfferDTO` é um ponto usado por
  **muitas** rotas (accept, decline, status updates, etc. — 11 usos só em
  `ride.controller.js`) — preciso confirmar que adicionar um campo novo não
  quebra nenhum teste de integração existente (`Backend/tests/integration/
  ride.*.test.js`) antes de considerar concluído.
- Refatorar a extração da lógica de oferta para fora de `CaptainHome.jsx` tem
  risco de regressão comportamental se eu não preservar exatamente os
  mesmos guards (`captainParcelRef`, `rideRef`, etc.) — vou manter o
  comportamento atual como baseline e só adicionar fila/countdown em cima,
  não reescrever do zero.

## 10. Critério de verificação

- `npm run build` (PWA) e `Backend` test suite passam.
- Testes manuais da seção 8 executados e documentados com resultado.
- Nenhum arquivo em `frontend/android/**` alterado (`git diff --stat` como
  evidência).

## 11. Resultado

**Decisões da seção 7 aplicadas** (sem objeção do usuário): `OFFER_TTL_MS =
45000`; "expirar" só esconde a UI (não cancela a corrida); fila FIFO única
cross-tipo.

**Achado extra durante a implementação (não estava no diagnóstico original):**
o backend já tem um auto-cancelamento REAL de ofertas não respondidas —
`RIDE_EXPIRATION_MINUTES = 10` (`ride.service.js:1583`) e
`PARCEL_EXPIRATION_MINUTES = 10` (`parcel.service.js:47`), lazy, aplicado nos
pulls (`getPendingRidesForCaptain`/`expireStaleAwaitingParcels`). Isso não
muda a estratégia (o countdown de 45s do popup continua sendo um SLA de
destaque, mais curto e deliberadamente diferente do cancelamento real de
10 min) — só reforça que "a oferta continua disponível no card depois do
popup expirar" é literalmente verdade, não uma aproximação.

**Arquivos alterados:**

Backend (aditivo, sem migração de schema):
- `Backend/config/offerPolicy.js` (novo) — `OFFER_HIGHLIGHT_TTL_MS` +
  `computeOfferExpiresAt(doc)`.
- `Backend/controllers/ride.controller.js` — `toCaptainRideResponse` inclui
  `offerExpiresAt` quando `status === 'requested'`; payload FCM de
  `dispatchRideToCaptains` idem.
- `Backend/services/ride.service.js` — `getPendingRidesForCaptain` (pull
  `/rides/pending`) inclui `offerExpiresAt`.
- `Backend/controllers/parcel.controller.js` — payload FCM de
  `dispatchParcelToCaptains` reaproveita o `offerExpiresAt` já calculado pelo
  DTO do socket.
- `Backend/services/parcel.service.js` — `toParcelOfferDTO` inclui
  `offerExpiresAt` quando `status === 'awaiting_provider'` (cobre socket +
  pull `/parcels/pending`, mesma função nos dois).

Frontend (novo módulo compartilhado):
- `frontend/src/shared/services/rideOffer/useOfferQueue.js` (novo) — fila
  FIFO única (corrida+encomenda), dedup por `offerId` (janela 8s, mesmo valor
  do H2 nativo Android), suporte a `front: true` (deep link / card "Ver
  detalhes" pulam a fila).
- `frontend/src/shared/services/rideOffer/useOfferCountdown.js` (novo) —
  contador sempre recalculado de `offerExpiresAt`, nunca um timer cego;
  recorrige ao voltar de segundo plano.
- `frontend/src/shared/services/rideOffer/useOfferAlert.js` (novo) — som em
  loop + vibração a cada 3s enquanto a oferta em destaque não muda; para no
  cleanup do effect (aceitar/recusar/expirar/trocar).

Frontend (integração):
- `frontend/src/driver/pages/CaptainHome.jsx` — `handleNewRide`/
  `handleNewParcel`/`syncPendingParcels`/deep links agora enfileiram em vez
  de descartar (corrige P3) ou sobrescrever (corrige P4); `ride`/`parcelOffer`
  passam a ser espelhados da fila por um único effect; `confirmRide`/aceite de
  encomenda limpam a fila inteira ao aceitar (motorista fica com trabalho
  ativo); 409 usa a mensagem real do backend em vez de texto genérico (P5);
  notificação do browser só dispara com a aba oculta, com `tag` (P7).
- `frontend/src/driver/components/RidePopUp.jsx` — contador visível, trava de
  duplo clique + "Aceitando...", desabilita/oculta ao expirar (P2, P1, P6).
- `frontend/src/driver/components/ParcelPopUp.jsx` — contador visível (já
  tinha a trava de duplo clique).
- `frontend/src/shared/services/browserNotify.js` — aceita `tag` opcional
  para o SO fundir com a notificação de background em vez de empilhar.

**Nenhum arquivo em `frontend/android/**` foi tocado** — confirmado via
`git status`/`git diff --stat`.

**Verificação executada:**
- `Backend`: `npx jest tests/integration/ride.pending.test.js
  tests/integration/ride.push.accept.test.js
  tests/integration/notification.push.test.js
  tests/integration/ride.cancellation.test.js tests/integration/ride.api.test.js
  tests/unit/pushTransport.payload.test.js` — 79/81 passam; as 2 falhas
  restantes (`ride.api.test.js`, `ride.cancellation.test.js`) foram
  confirmadas **pré-existentes** rodando a mesma suíte com as mudanças
  stashed (mesmo resultado antes e depois) — não relacionadas a este trabalho.
- `frontend`: `npm run build` (PWA) e `npm run build:driver` — ambos OK, sem
  erro. `npx vitest run` — 17/17 arquivos, 88/88 testes passam.
- **Não executado**: os testes manuais em navegador real da seção 8 (clique
  em Aceitar/Recusar, contador visual, notificação de background, duplicação
  real via socket+FCM simultâneos) — verificação automática (build + testes)
  passou, mas o percurso manual completo ainda não foi validado num navegador
  de verdade.
