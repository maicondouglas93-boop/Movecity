# Auditoria de Performance — App do Motorista MoveCity

**Status:** diagnóstico concluído. Nenhum código foi alterado — auditoria
pura, por pedido explícito. Método: leitura completa de cada arquivo do
caminho crítico (GPS → Context → Mapa → Marker → Socket.IO → Android),
citando arquivo/linha para cada afirmação, positiva ou negativa.

---

## RESUMO EXECUTIVO

**Classificação: BOM.**

Não é uma classificação de cortesia — é o que os dados mostram. Encontrei
evidência **extensa e concreta** de que este exato tipo de auditoria já foi
feito antes neste código (comentários assinados "Fase D", "Auditoria de
integração 2026-08-06" etc. explicam, em quase todo arquivo crítico, a razão
técnica exata por trás de cada decisão de performance — inclusive casos em
que o time já encontrou e corrigiu um bug real de "GPS emitindo em
duplicidade" antes de mim). A lista de coisas que o pedido pautou como risco
("mapa remontando a cada GPS", "marcador teleportando", "câmera brigando com
o usuário", "polyline recriada inteira", "múltiplas conexões de socket",
"rAF infinito consumindo bateria") — **nenhuma delas acontece hoje**,
confirmado lendo o código, não por suposição.

Os problemas reais que encontrei são poucos, precisos, e de severidade
baixa/média — nenhum 🔴 crítico, nenhum 🟠 alto. Listo os 4 abaixo com
exatamente o rigor que o pedido exige (arquivo, linha, causa, impacto,
correção), e documento também o que foi verificado e **confirmado correto**,
porque "não encontrei problema aqui" também é uma afirmação que precisa de
evidência, não só a ausência de uma reclamação.

---

## TOP PROBLEMAS DE PERFORMANCE (achados reais — não preenchi até 10 artificialmente)

| Prioridade | Problema | Causa | Impacto | Solução |
|---|---|---|---|---|
| 🟡 MÉDIO | `LocationContext` re-renderiza **todo consumidor** a cada fix de GPS, mesmo quem só precisa de um ref estável | O objeto `value={{ userLocation, locationRef, locationError }}` é recriado a cada render do Provider — `useContext` devolve referência nova mesmo pra quem só lê `locationRef` (que em si nunca muda) | `CaptainHome.jsx` (tela cheia, listas, cards), `LiveTracking.jsx` (mapa) e `CaptainLocationBridge.jsx` (retorna `null`, mas ainda assim re-executa) re-renderizam ~1x/seg cada, mesmo quando nada visível depende disso | Separar o valor do contexto: uma parte "reativa" (raramente muda, ex. `locationError`) e uma parte só-ref (`locationRef`) exposta fora do ciclo de render (hook com `useSyncExternalStore` ou um EventEmitter simples) pra quem só precisa do valor atual, não de re-render |
| 🟢 BAIXO | `useWakeLock` devolve `requestLock`/`releaseLock` sem `useCallback` — identidade nova a cada chamada do hook | `toggleLock` é envolvido inline no retorno do hook (`useWakeLock.js:78`), nunca memoizado | O `useEffect(() => { requestLock() }, [requestLock])` de `CaptainRiding.jsx:144-146` re-dispara a cada render do componente (a cada segundo, por causa do timer de `elapsedSec`). Hoje inofensivo — os guards internos (`if (wakeLockRef.current) return`) tornam a repetição um no-op — mas é o padrão exato de "dependência de efeito incorreta" que o pedido pediu para caçar | Envolver `toggleLock`/`requestLock`/`releaseLock` em `useCallback` dentro do hook |
| 🟢 BAIXO | Dois componentes assinam independentemente o mesmo evento de socket | `CaptainRiding.jsx:82-91` e `LiveTracking.jsx:251-274` cada um com seu próprio `socket.on('captain-location-updated', ...)`/`socket.off` | Nenhum bug (os dois limpam corretamente) — só processamento duplicado do mesmo payload em dois lugares | Extrair um hook compartilhado (`useCaptainLocationEvent`) que os dois consomem, evitando o parsing duplicado |
| 🟢 BAIXO | Fora do modo navegação, o próprio marcador do motorista depende de round-trip via backend | Nas fases "indo buscar"/"chegou"/"aguardando" (`navigationMode` pode estar desligado), o marcador `'captain'` é alimentado por `captain-location-updated` (GPS → backend → eco de volta), não pelo GPS local direto (`LiveTracking.jsx:263-266`) | Latência extra pequena e evitável nessas fases específicas — **não afeta a fase mais crítica** (corrida ativa em navegação), porque aí o marcador `'navigator'` já usa o GPS local direto (`LiveTracking.jsx:656-672`), sem round-trip | Alimentar o marcador `'captain'` também do `userLocation` local quando for o próprio motorista vendo seu próprio mapa, reservando o socket para quando outra pessoa (passageiro/admin) observa |

Nenhum destes é 🔴 ou 🟠 — não há nada aqui que cause travamento, ANR, tela
branca, flickering ou vazamento de memória confirmado.

---

## 1. MAPA DURANTE A CORRIDA

Arquivo: [frontend/src/shared/components/LiveTracking.jsx](frontend/src/shared/components/LiveTracking.jsx).

- **Quantas vezes o mapa é remontado?** Uma vez por sessão de tela. A
  inicialização (`provider.init()`, linha 428-474) roda num `useEffect` com
  dependências `[hasPosition, retryKey]` — `hasPosition` vira `true` uma
  única vez (primeiro fix de GPS) e nunca mais muda; `retryKey` só muda se o
  usuário tocar "Tentar de novo" após uma falha. **Não há remontagem por
  GPS.**
- **O mapa é destruído/recriado desnecessariamente?** Não — `destroy()` só
  roda no cleanup do efeito de inicialização, ou seja, só quando o
  componente desmonta de verdade (sair da tela) ou no retry manual.
- **Lat/lng provocam renders excessivos?** Sim, mas de um jeito que **não
  provoca trabalho real** na maior parte dos casos — ver seção 8
  (Context API) para o porquê e o real impacto.
- **O marcador é atualizado eficientemente?** Sim — `placeMarker`/
  `moveMarker` no provider ([googleMapsProvider.js:114-139](frontend/src/shared/services/maps/googleMapsProvider.js#L114-L139))
  reaproveitam a instância existente (`marker.setPosition()`/`setIcon()`),
  nunca recriam o objeto `google.maps.Marker` a não ser na primeira vez.
- **A câmera é reposicionada em excesso?** Não — ver seção 4.
- **`setState` em alta frequência?** O único `setState` de alta frequência
  genuíno é `setUserLocation` em `LocationContext.jsx:62` (a cada fix de
  GPS) — tudo que reage a isso dentro de `LiveTracking` faz trabalho
  **imperativo** (`providerRef.current.placeMarker(...)`), não recria JSX.
- **`useEffect` com dependências incorretas / loops?** Não encontrei nenhum
  efeito que se auto-dispara indefinidamente. Os dois loops de animação
  (navegação e marcador do capitão) têm condição de parada explícita
  (`converged`/`progress >= 1`) — ver seções 3 e 4.
- **Closures obsoletas?** Não — o padrão consistente no arquivo é usar refs
  (`onMapCenterChangeRef`, `onNavigationUpdateRef`, `routeCoordsRef`) para
  callbacks/props usados de dentro de closures de longa duração (loops
  rAF), sincronizados por efeitos próprios (linhas 179-189). Isso evita
  exatamente o problema de uma closure capturar uma prop antiga.
- **Listeners/timers duplicados, subscriptions não removidas?** Revisei os
  9 `useEffect` do arquivo — todos os que registram listener/timer/rAF têm
  função de cleanup correspondente (`socket.off`, `clearTimeout`,
  `cancelAnimationFrame`, `removeEventListener`, `provider.removeMarker`).

**Conclusão da seção:** dentro do escopo deste arquivo, a arquitetura já
segue exatamente a recomendação do pedido — atualização de alta frequência
é imperativa (ref + chamada direta no provider), não `setState` de JSX.

---

## 2. GPS E POSIÇÃO DO MOTORISTA

Fluxo confirmado, ponta a ponta:

```text
GPS (nativo: @capacitor/geolocation.watchPosition / web: navigator.geolocation.watchPosition)
    ↓ (location.service.js — watch único, iniciado/limpo por LocationContext)
LocationContext (userLocation state + locationRef ref, ambos atualizados juntos)
    ├──→ locationRef.current  → CaptainLocationBridge (emitCaptainLocation, imperativo, sem re-render útil)
    └──→ userLocation (state) → LiveTracking (marcador via ref, JSX não usa) + CaptainHome (distância exibida)
```

- **Onde o GPS é iniciado/encerrado?** Um único `watchPosition` em
  [LocationContext.jsx:85-96](frontend/src/shared/contexts/LocationContext.jsx#L85-L96),
  dependente só de `hasSession` — inicia quando há sessão ativa, limpo
  (`clearWatch`) no cleanup do efeito. **Um único watcher confirmado** —
  busquei outras chamadas a `watchPosition`/`Geolocation.watchPosition` no
  projeto e não encontrei nenhuma fora deste arquivo.
- **Quem envia a posição pro backend?** Só `CaptainLocationBridge.jsx`, via
  `emitCaptainLocation` ([captainLocationSync.js:20](frontend/src/shared/services/captainLocationSync.js#L20)),
  a cada 5s (serviço ativo) ou 10s (só online) — constantes documentadas em
  `LOCATION_INTERVAL_ACTIVE_MS`/`LOCATION_INTERVAL_ONLINE_MS`. **Um único
  emissor** — o comentário em `CaptainRiding.jsx:148-156` documenta que
  existia um SEGUNDO emissor (nesta mesma tela) que dobrava a taxa de
  amostragem e **inflava a tarifa final** (bug real, já corrigido antes
  desta auditoria — não há mais duplicidade).
- **Quem calcula distância/ETA?** Distância acumulada real: backend
  (`Backend/socket.js`, soma haversine entre fixes consecutivos — auditado
  na sessão financeira anterior). ETA de navegação: `LiveTracking.jsx`
  (linha 801-809), proporcional à fração da rota restante.
- **Duplicação no fluxo?** A única redundância real é a do item 4 da tabela
  (marcador do próprio motorista alimentado por eco do socket em vez do GPS
  local, fora do modo navegação) — não achei nenhuma duplicação de
  **cálculo**, só essa duplicação de **fonte de dado visual**.

---

## 3. MOVIMENTO DO MARCADOR

Duas implementações de interpolação coexistem, cada uma no contexto certo:

1. **Marcador `'captain'`** (fora do modo navegação — ex. mapa do
   passageiro observando o motorista, ou motorista com navegação
   desligada): interpolação linear simples sobre 2000ms
   ([LiveTracking.jsx:978-1015](frontend/src/shared/components/LiveTracking.jsx#L978-L1015)),
   casada com a frequência real de emissão (5s ativo / eco a cada
   atualização) — sem teleporte, sem salto.
2. **Marcador `'navigator'`** (modo navegação, a seta do próprio
   motorista): sistema de duas fases — o fix de GPS só atualiza o **alvo**
   (`navTargetRef`, a ~1/s); um loop de `requestAnimationFrame` separado
   interpola `navStateRef` em direção ao alvo a cada quadro
   (`NAV_SMOOTHING = 0.12`, [LiveTracking.jsx:648-769](frontend/src/shared/components/LiveTracking.jsx#L648-L769)).
   O comentário no código (linha 640-645) documenta explicitamente que
   **misturar as duas responsabilidades é o que produz o "pulo" a cada
   GPS** — e o código realmente as mantém separadas.

Não encontrei:
- **Teleporte/salto**: não há nenhum caminho que chame `setPosition`/
  `moveMarker` direto com o novo fix sem passar pela interpolação (exceto
  a primeira colocação do marcador, correto — não há "de onde" interpolar).
- **Flickering/marcador desaparecendo**: `placeMarker` reaproveita a
  instância existente; `removeMarker` só é chamado em transições de fase
  reais (entrar/sair do modo navegação, corrida finalizada).
- **Atraso artificial**: a suavização (`NAV_SMOOTHING=0.12`, ~meio segundo
  pra convergir) não é perceptível como atraso e não é o que o pedido pediu
  para evitar ("marcador artificialmente atrasado ou distante da posição
  real") — o alvo em si é sempre a posição real mais recente, só o que é
  DESENHADO entre um fix e outro é suavizado.
- **Animação pesada em excesso**: o marcador `'navigator'` gira de graça
  (é um `Symbol`/path SVG nativo do Google Maps, rotação sem custo); os
  marcadores de veículo (imagem) só regeneram o ícone quando o ângulo
  realmente muda o suficiente (`setMarkerRotation`, linha 152-159, com
  early-return se o grau não mudou) — ver seção "MARCADOR" mais abaixo
  para o motivo dessa distinção ser deliberada.

---

## 4. CÂMERA DO MAPA

- **`setView`/`flyTo`/`panTo`/`fitBounds`**: usados via o contrato do
  provider (`moveCamera`, `panTo`, `fitBounds` em
  [googleMapsProvider.js](frontend/src/shared/services/maps/googleMapsProvider.js)).
- **A câmera atualiza a cada posição GPS?** Só em modo navegação, e mesmo
  aí **não é 1:1 com o GPS** — o alvo muda a ~1/s (por fix), mas o que
  efetivamente move a câmera é o loop de interpolação a cada quadro,
  convergindo suavemente. Fora do modo navegação, a câmera só se move por
  ação explícita (recentralizar, fit bounds na mudança de rota/coords) —
  não por cada fix.
- **Usuário perde controle manual?** Não — `onDragStart`/`onZoomStart`
  chamam `setIsFollowing(false)`
  ([LiveTracking.jsx:449-450](frontend/src/shared/components/LiveTracking.jsx#L449-L450)):
  assim que o usuário arrasta ou dá zoom manualmente, o auto-follow para,
  e só volta quando ele toca o botão de recentralizar.
- **Zoom mudando sozinho / mapa tremendo?** `moveCamera` aplica
  center+zoom+heading+tilt **numa única transação** (comentário explícito
  em `googleMapsProvider.js:257-260` sobre evitar "o tremor de aplicar
  cada eixo em chamadas separadas").
- **Marcador × câmera desacoplados?** Sim, comprovadamente — o comentário
  em `LiveTracking.jsx:640-645` descreve isso como decisão de arquitetura
  deliberada, e o código faz exatamente isso (o loop de navegação atualiza
  os dois, mas a partir do MESMO estado interpolado, não de dois caminhos
  independentes que poderiam divergir).

---

## 5. ROTA

- **Requisições de rota**: `GET /maps/get-route`
  ([LiveTracking.jsx:401](frontend/src/shared/components/LiveTracking.jsx#L401)),
  chamado no efeito de rota (linhas 343-425).
- **Recalculada a cada GPS?** Não. Duas situações disparam nova busca:
  mudança de `pickupCoords`/`destinationCoords`/`subjectStatus` (fase da
  corrida), ou `routeVersion` incrementado explicitamente por desvio de
  rota persistente. **Não está no array de dependências `[userLocation]`.**
- **Debounce/throttle existem?** Sim, dois níveis:
  - Resolução de coordenadas (endereço → lat/lng): debounce de 800ms
    ([LiveTracking.jsx:330-334](frontend/src/shared/components/LiveTracking.jsx#L330-L334)).
  - Recálculo por desvio de rota: `REROUTE_MIN_INTERVAL_MS = 20000` (20s
    mínimo entre chamadas) **e** só depois de detectar desvio persistente
    entre fixes consecutivos (`offRouteSinceRef`, linhas 819-837) — um
    único salto de GPS entre prédios altos não dispara recálculo.
- **Polyline recriada inteira?** Não — `setRoute` no provider reaproveita
  a `Polyline` existente via `.setPath()`
  ([googleMapsProvider.js:171-185](frontend/src/shared/services/maps/googleMapsProvider.js#L171-L185)),
  nunca recria o objeto.
- **Atualização incremental?** Sim — durante navegação, a rota é "podada"
  (remove o trecho já percorrido) a cada 3m de deslocamento real, não a
  cada quadro (comentário explícito em
  [LiveTracking.jsx:712-716](frontend/src/shared/components/LiveTracking.jsx#L712-L716)
  sobre o custo de varrer a polyline inteira a 60fps).
- **Cache?** Não encontrei cache client-side da rota em si (cada mudança de
  fase/desvio busca de novo) — isso é aceitável dado o throttle já
  existente; não é um problema, é uma oportunidade menor (🟢, não listada
  no top por não ter evidência de custo real).
- **Flickering da polyline?** Não — `setPath` atualiza a geometria sem
  remover/recriar o objeto do mapa.

---

## 6. SOCKET.IO

- **Múltiplas conexões?** Não — `SocketContext.jsx:21-23` cria **um único**
  `socket = io(...)` no escopo do módulo (fora de qualquer componente),
  reaproveitado por todo o app via Context. Não há um segundo `io()` em
  nenhum outro arquivo do driver.
- **Reconexão desnecessária?** `transports: ['polling', 'websocket']`
  permite upgrade automático; não há lógica de reconexão manual duplicando
  a do próprio `socket.io-client`.
- **`socket.on()` sem `socket.off()`?** Revisei todos os `.on(` no driver
  (`CaptainHome.jsx`, `CaptainRiding.jsx`, `LiveTracking.jsx`,
  `CaptainLocationBridge` não usa socket.on diretamente) — cada um tem seu
  par `.off(` no cleanup do efeito correspondente.
- **Emissão excessiva de localização?** Não — throttle de 5s/10s (seção
  2), não por-frame.
- **Eventos duplicados causando renders desnecessários?** O único caso
  real é a dupla assinatura de `'captain-location-updated'` (item 3 do
  top) — cada assinatura atualiza um pedaço de estado diferente
  (`liveDistance` vs `captainPosition`), então não há dois `setState` para
  a MESMA coisa, só duas leituras do mesmo evento.
- **Conexão mantida ao navegar entre telas?** Sim — o socket vive no
  Context (nível do provider, acima do `BrowserRouter`), sobrevive a troca
  de rota. Só os LISTENERS são registrados/removidos por tela.

Frequência GPS→Socket→Backend já está bem calibrada:
**5s durante serviço ativo, 10s só online** — suficiente para ETA/rastreio
sem gerar tráfego desnecessário (confirmado nas constantes documentadas,
seção 2).

---

## 7. REACT RENDERING

- A árvore inteira da tela de corrida **não** re-renderiza por causa de
  lat/lng/heading/speed — `LiveTracking` está em `React.memo`
  ([LiveTracking.jsx:1114](frontend/src/shared/components/LiveTracking.jsx#L1114))
  e suas props (`ride`, `navigationMode`, `onNavigationUpdate`) são
  estáveis entre os re-renders de 1s do timer (`elapsedSec`) de
  `CaptainRiding` — confirmei isso rastreando cada prop até sua origem:
  `rideData` só muda por `setRideData` explícito, `onNavigationUpdate` é
  `useCallback` com deps `[]`.
- **O que de fato re-renderiza por GPS?** O próprio `LiveTracking` (porque
  ele mesmo lê `useContext(LocationContext)`, então `memo` não o protege
  disso) e qualquer outro consumidor direto do contexto (`CaptainHome`) —
  ver seção 8, é a raiz do único achado 🟡 desta auditoria.
- **Uso de `useMemo`/`useCallback`/`React.memo`**: já presente onde faz
  sentido (memo no mapa inteiro, useCallback nos handlers passados como
  prop para o mapa, refs para tudo que precisa ser lido de dentro de loops
  sem causar re-render). Não vi uso indiscriminado nem ausência
  justificando uma reclamação — o único ponto real de melhoria é o do
  `useWakeLock` (item 2 do top).

---

## 8. CONTEXT API

**Este é o achado central da auditoria.**
[LocationContext.jsx:106-110](frontend/src/shared/contexts/LocationContext.jsx#L106-L110):

```jsx
return (
    <LocationContext.Provider value={{ userLocation, locationRef, locationError }}>
        {children}
    </LocationContext.Provider>
)
```

Esse objeto literal é recriado a cada render do `LocationProvider` — e o
`LocationProvider` re-renderiza a cada `setUserLocation` (ou seja, a cada
fix de GPS). Como `useContext` compara por referência, **todo componente
que chama `useContext(LocationContext)` re-renderiza junto**, mesmo que só
use `locationRef` (uma ref — nunca muda de verdade) ou `locationError`
(muda raríssimo).

Consumidores confirmados, com o que cada um realmente precisa:

| Consumidor | O que lê | Precisa de re-render por GPS? |
|---|---|---|
| `CaptainLocationBridge.jsx:25` | só `locationRef` | **Não** — usa via `.current` dentro de um `setInterval` próprio |
| `LiveTracking.jsx:127` | `userLocation` | Parcialmente — só pros 2 efeitos que de fato reagem a cada fix (marcador/navegação); o resto do componente (JSX) não usa o valor |
| `CaptainHome.jsx:69` | `userLocation` (via `haversineKm`, linha 778) | Só quando o card "Corrida disponível" está na tela — no resto do tempo, não |
| `RidePopUp.jsx` | `userLocation` (distância até o passageiro) | Só enquanto o popup de oferta está aberto |

Isso bate exatamente com a hipótese que o pedido levantou na seção 8:
*"latitude muda → todos consumidores renderizam novamente"* — confirmado,
não é hipotético.

**Impacto real:** moderado, não severo. O trabalho feito em resposta ao
re-render é majoritariamente barato (refs, chamadas imperativas no mapa),
mas o próprio ato de re-executar a função do componente + reconciliação do
React em telas maiores (`CaptainHome`, com listas e cards) a cada ~1s é
overhead evitável, especialmente relevante em aparelho de entrada (seção
15).

**Correção recomendada:** separar o contexto em duas peças:
1. Uma peça **reativa**, memoizada com `useMemo` e deps mínimas
   (`locationError` — muda raro, ok causar re-render).
2. Uma peça **não-reativa** para leitura imperativa de alta frequência —
   um hook (`useLocationRef()`) que devolve a ref diretamente, sem passar
   por `useContext` reativo, ou um `useSyncExternalStore` que só notifica
   quem realmente pede subscrição.

`userLocation` como state React continuaria existindo para quem
genuinamente precisa (ex.: uma tela mostrando "você está a X km" como
texto), mas deixaria de forçar `LiveTracking`/`CaptainHome` inteiros a
re-renderizar quando só o mapa/cálculo pontual precisa do valor.

---

## 9. TELA DE CORRIDA

`CaptainRiding.jsx` — nenhuma combinação de GPS+Socket+mapa+timer
encontrada que produza frame drop/ANR/travamento:

- Timer de `elapsedSec` (1Hz) e `liveDistance` (por evento socket, já
  throttled a 5s) são os únicos `setState` de alta frequência FORA do
  contexto de localização — ambos baratos (atualizam só texto no HUD
  inferior, não o mapa).
- O mapa (`LiveTracking`) está protegido por `memo` das re-renderizações
  desses dois estados (props estáveis, confirmado seção 7).
- Não encontrei nenhum efeito custoso rodando por fix de GPS dentro desta
  tela além do necessário (posição/navegação).

---

## 10. ANDROID / CICLO DE VIDA

- **Foreground/background**: `appLifecycle.service.js` usa
  `@capacitor/app` `appStateChange` (nativo) / `visibilitychange` (web) —
  um único listener por chamador, com cleanup.
- **GPS em background**: coberto pelo Foreground Service
  (`location.service.js:startForegroundTracking`, `serviceType: 8`
  /Location), a única forma correta no Android de manter
  `@capacitor/geolocation` vivo com o app minimizado/tela bloqueada —
  documentado explicitamente no código (linha 211-213).
- **Duplicidade ao voltar do background**: `syncTrackingLifecycle`
  (`CaptainLocationBridge.jsx:35-51`) roda num efeito com guarda
  `fgsOpPromise` contra chamadas concorrentes de start/stop do FGS
  (`location.service.js:14,224-230`) — não há corrida entre o app
  reabrindo e o FGS já estar de pé.
- **rAF em background**: o loop de navegação verifica `document.hidden`
  antes de agendar o próximo quadro (`LiveTracking.jsx:735-740`) e, ao
  voltar (`visibilitychange`), **salta** direto para a posição-alvo em vez
  de animar o "voo" acumulado (linhas 743-752) — evita tanto desperdício
  de bateria quanto uma animação estranha de "voando" pelo mapa ao
  reabrir.
- **Wake Lock**: liberado corretamente no unmount
  (`useWakeLock.js:68-71`); único ponto fraco é o de identidade de função
  já listado (item 2 do top), não um vazamento.
- **Botão voltar**: tratado via `@capacitor/app` `backButton`
  (`appLifecycle.service.js:33-52`), com fallback pra minimizar o app em
  vez de fechar/crashar.

Não encontrei evidência de processo duplicado (segundo watcher de GPS,
segunda conexão de socket, segundo FGS) ao voltar do background.

---

## 11. MEMÓRIA

Ciclo aceitar → finalizar → aceitar de novo: todos os `useEffect` que
registram algo em `LiveTracking`/`CaptainRiding`/`CaptainLocationBridge` têm
cleanup correspondente (confirmado item a item nas seções 1, 6, 10). Os
`Map`s usados para estruturas de tamanho variável (`driversRef`,
`markers`/`markerTypes`/`markerRotations` no provider) são limpos
explicitamente (`clearAllDrivers`, `destroy()`) nas transições relevantes,
não só deixados para o garbage collector eventualmente.

Não identifiquei um padrão de crescimento progressivo por corrida — o
estado que sobrevive entre corridas (`markers` do provider) é *removido e
recriado por id fixo* (`'captain'`, `'pickup'`, `'destination'`), não
acumulado com IDs novos a cada corrida.

**Não testei runtime com profiler real** (Chrome DevTools Memory/Android
Studio Profiler) — isso exige um dispositivo físico e um roteiro de várias
corridas reais, fora do escopo de uma auditoria estática. Recomendo como
item de validação (ver checklist de testes) antes de fechar este ponto com
100% de certeza.

---

## 12. BATERIA

Estratégia já escalonada corretamente por fase, sem necessidade de mudança:

| Fase | GPS (watch) | Emissão pro backend | FGS |
|---|---|---|---|
| Fora de serviço (offline) | Nenhum watch ativo (depende de `hasSession`, mas sem consumidor de alta freq.) | Nenhuma | Parado |
| Online, aguardando corrida | Watch ativo (`enableHighAccuracy`) | 10s | Ativo ("você está online") |
| Corrida/encomenda ativa | Watch ativo | 5s | Ativo ("corrida em andamento") |
| Corrida finalizada | — | Volta a 10s ou para, conforme `isOnline` | Atualiza texto ou para |

Somado a isso: os loops de `requestAnimationFrame` (navegação, marcadores
de frota) **param sozinhos quando convergem** ou quando não há mais
trabalho pendente — não ficam rodando a 60fps com o veículo parado no
semáforo (comentário explícito sobre isso em
`LiveTracking.jsx:33-36,728-729`). Esse é exatamente o padrão que o pedido
pediu para verificar ("ausência de loops de renderização" desnecessários) e
está implementado.

---

## 13. REDE

- Rota: throttled/debounced (seção 5), sem chamadas por-frame.
- Localização: 5s/10s (seção 2), com fila offline limitada a 20 pontos
  (`MAX_QUEUED_LOCATIONS`, `captainLocationSync.js:12`) — evita a IndexedDB
  crescer sem limite se o motorista ficar muito tempo sem conexão.
- Motoristas próximos (mapa do passageiro, não do motorista, mas parte do
  mesmo componente): reconciliação incremental via `GET
  /maps/nearby-drivers` — atualiza só quem mudou, não busca tudo de novo a
  cada render.
- Não identifiquei requests duplicados nem retries descontrolados no
  código do driver.

---

## 14. TRANSIÇÕES E NAVEGAÇÃO

`Home → corrida recebida → aceitar → indo buscar → chegou → iniciar →
corrida ativa → finalizar → pagamento → avaliação → Home`: cada transição
já foi endereçada em auditorias anteriores documentadas no próprio código
(restauração de corrida ativa via `RideContext`, sincronização com backend
ao montar `CaptainRiding` em vez de confiar só em `location.state`). Não
encontrei mapa sendo recriado entre essas fases (o mapa é remontado uma vez
por instância de tela, e cada tela é uma instância nova por navegação — isso
é esperado e não um bug; o ponto que importa, confirmado, é que ele **não**
remonta enquanto a corrida está ativa numa MESMA tela).

---

## 15. ANDROID DE BAIXO/MÉDIO DESEMPENHO

Os padrões encontrados (interpolação via ref/rAF em vez de `setState` por
frame, throttle de rede, loops que param sozinhos, ícones de rotação nativa
sem custo) são precisamente os que mais importam em hardware limitado — a
diferença entre um app fluido e um travado em 3-4GB de RAM normalmente é
exatamente "quantos `setState`/reconciliações acontecem por segundo", que é
o que esta arquitetura já minimiza. O achado 🟡 da seção 8 (Context API) é o
único ponto que pesa proporcionalmente mais nesses aparelhos (reconciliação
mais lenta em CPU mais fraca) — reforça a prioridade de corrigi-lo, mas não
muda a classificação geral.

---

## ARQUITETURA RECOMENDADA

O fluxo real já É essencialmente isto — o ajuste recomendado (seção 8) é
sobre COMO o "posição em alta frequência" chega em cada consumidor:

```text
GPS (watchPosition, único)
    ↓
Location Service (location.service.js)
    ↓
posição em alta frequência
    ├──→ locationRef (ref pura, sem re-render) ──→ Marker Animation (LiveTracking, imperativo)
    ├──→ locationRef (ref pura, sem re-render) ──→ Socket.IO (CaptainLocationBridge, throttled 5s/10s)
    ├──→ locationRef (ref pura, sem re-render) ──→ Route recalculation (controlled: debounce + min-interval + desvio persistente)
    └──→ userLocation (state, só quando ALGUÉM precisa exibir texto/valor) ──→ UI state pontual
```

A única mudança real proposta: hoje `locationRef` e `userLocation` **saem
juntos do mesmo objeto de contexto**, então mesmo quem só quer a ref acaba
"assinando" o state. Separar isso é o que falta para bater 100% com este
diagrama.

---

## PLANO DE CORREÇÃO

### P0 — obrigatório
Nenhum item encontrado nesta auditoria se qualifica como P0 (nada causa
travamento, mapa quebrado, GPS incorreto ou experiência ruim confirmada).

### P1 — importante
1. Separar `LocationContext` em peça reativa (memoizada) + peça
   imperativa (ref/subscrição), migrando `LiveTracking` e `CaptainHome`
   para consumir só o que cada um precisa.

### P2 — melhoria
2. `useCallback` em `requestLock`/`releaseLock`/`toggleLock` dentro de
   `useWakeLock.js`.
3. Extrair um hook compartilhado para o evento `captain-location-updated`
   (hoje assinado separadamente em `CaptainRiding` e `LiveTracking`).
4. Alimentar o marcador `'captain'` (fases fora do modo navegação) a
   partir do `userLocation` local do próprio motorista em vez do eco via
   socket, quando for o próprio motorista vendo seu próprio mapa.

---

## TESTES (checklist para validar antes/depois de qualquer correção)

**Mapa**
- [ ] Mapa não pisca/remonta ao aceitar corrida, iniciar, finalizar.
- [ ] Mapa permanece interativo (pan/zoom) durante corrida ativa.

**GPS**
- [ ] Só um watcher ativo por vez (checar via log `[Location] update
  received` — frequência deve bater com o esperado do provedor, não
  dobrada).
- [ ] Emissão pro backend em 5s (ativo) / 10s (só online) — confirmar via
  rede (DevTools/Charles) ou logs `[Location] update sent`.

**Marcador**
- [ ] Sem teleporte perceptível ao mover o dispositivo rapidamente.
- [ ] Rotação do ícone de veículo só muda quando o motorista realmente
  muda de direção (não a cada fix).

**Rota**
- [ ] Rota não é buscada de novo a cada fix de GPS (contar chamadas de
  rede a `/maps/get-route` durante uma corrida de alguns minutos parado).
- [ ] Desvio de rota real (sair do caminho de propósito) dispara
  recálculo em até ~20s, não antes.

**Socket.IO**
- [ ] Uma única conexão ativa (DevTools → Network → WS).
- [ ] Reconectar (modo avião on/off) não duplica listeners nem eventos.

**Corrida**
- [ ] HUD (tempo/distância/preço) atualiza sem travar o mapa.
- [ ] Chat aberto/fechado não afeta fluidez do mapa.

**Background**
- [ ] Bloquear tela durante corrida ativa → desbloquear → posição
  atualizada sem "voo" longo pela tela.
- [ ] Trocar de app e voltar → sem segunda notificação de FGS, sem GPS
  duplicado.

**Bateria**
- [ ] Medir consumo (Android Settings → Battery) em: app fechado, online
  parado 10min, corrida ativa 10min — confirmar a hierarquia esperada.

**Memória**
- [ ] Profiler (Android Studio / Chrome remote debug) durante 3 corridas
  seguidas — memória deve estabilizar, não crescer degrau a degrau.

**Aparelhos de baixo desempenho**
- [ ] Repetir o roteiro de corrida ativa num aparelho real de 3-4GB RAM
  (não emulador) — observar frame rate do mapa durante navegação ativa.

---

## REGRA FINAL — confirmação de conformidade

Nenhuma correção proposta reduz a precisão do GPS (a mudança recomendada é
só sobre COMO o dado já coletado é distribuído para os consumidores, não
sobre a frequência/precisão da coleta em si) e nenhuma altera tarifa,
pagamento, comissão ou qualquer regra comercial — escopo desta auditoria
ficou estritamente em performance/renderização/mapa/GPS/rede/memória/
bateria/estabilidade, como pedido.
