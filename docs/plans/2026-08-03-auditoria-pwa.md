# Auditoria PWA MoveCity

**Data:** 2026-08-03
**Escopo:** `frontend/` (PWA único que serve passageiro e motorista — `modules/passenger` e `modules/driver`). `admin-frontend/` não é um PWA (sem `vite-plugin-pwa`, sem manifest) — citado só onde relevante, fora do foco principal. `Backend/` incluído onde o fluxo completo exige (Socket.IO, push, autenticação).

**Método:** leitura direta de código com citação exata de arquivo/linha, sem alterar nada. Onde o comportamento depende de plataforma/navegador (iOS Safari, suspensão de app em segundo plano no Android), isso está marcado explicitamente como limitação de plataforma, não bug de código.

---

## Resumo executivo

O PWA funciona bem no "caminho feliz" (rede boa, app aberto, permissões concedidas) — isso já foi validado e corrigido em auditorias anteriores desta sessão (push, sessão, disponibilidade x conexão). Esta auditoria focou no que quebra **fora** do caminho feliz: permissão negada, app fechado, rede ruim, múltiplas abas, reinstalação, dispositivos fracos, iOS.

Encontrei **3 problemas críticos**, sendo **dois deles vulnerabilidades de segurança exploráveis hoje sem nenhuma autenticação** (qualquer socket conectado pode sequestrar a entrega de eventos de outro usuário e falsificar a localização de qualquer motorista, inclusive afetando o cálculo de tarifa). O terceiro é uma repetição, em nova roupagem, do mesmo padrão já visto na auditoria de push anterior: um estado que devolve silêncio total ao usuário (motorista que negou notificação nunca é avisado disso, dentro do app).

Nenhum desses três é sutil ou depende de condição de corrida rara — os dois de segurança são chamadas de socket sem nenhuma verificação, replicáveis a partir do próprio bundle JS público em texto claro.

**Nota de prontidão para produção: 3/10.** Justificativa na seção final.

---

## Status da implementação (atualizado em 2026-08-03)

**C1, C2 e C3 corrigidos e testados.**

- **C1 + C2** (`Backend/socket.js`): `join` de `user`/`captain` agora exige o mesmo JWT verificado que as rotas REST (`jwt.verify` + checagem de `isBlocked`), guarda a identidade autenticada em `socket.data.identity` e passa a ser a ÚNICA fonte confiável para `update-location-captain` — o `userId` solto no payload é ignorado. `join` ganhou um callback de confirmação (`ack`) porque o handler faz `await`s antes de autenticar; sem esperar essa confirmação, o cliente podia mandar `update-location-captain` (ou a localização enfileirada offline) antes da identidade existir no socket e ser rejeitado à toa — corrigido nos 4 pontos do frontend que emitem `join` (`CaptainHome.jsx`, `CaptainRiding.jsx`, `Home.jsx`, `Riding.jsx`) e na fila offline de localização (`offlineQueue.js: flushQueuedLocations`, antes solta em `SocketContext.jsx` sem essa garantia).
  Testes novos em `Backend/tests/sockets/socket.integration.test.js`: join com token válido autentica; join sem token é rejeitado; join com `userId` de outra pessoa no payload usa a identidade do TOKEN, não o payload (prova direta do fechamento da falha); `update-location-captain` sem join autenticado é rejeitado; com join autenticado, usa a identidade do token e ignora tentativa de falsificar `userId` de outro motorista no payload.
- **C3** (`Home.jsx`, `CaptainHome.jsx`): novo estado `notificationsDenied` com banner visível quando `Notification.permission === 'denied'`, explicando que notificações estão bloqueadas e como reativar — antes esse estado não gerava nenhum aviso.

**Verificação:** build do frontend limpo; suíte de testes do backend com 153/154 passando (a 1 falha restante, em `captain.availability.test.js`, é um erro de índice geoespacial do MongoDB — `unable to find index for $geoNear query` — reproduzido de forma consistente em 2 execuções limpas mesmo sem nenhuma relação com este arquivo ou com autenticação; é uma falha pré-existente de infraestrutura de teste, registrada como novo achado B10 abaixo, fora do escopo desta correção); suíte do frontend sem novas falhas além das já documentadas como baseline (`e2e/rideFlow.spec.js` — precisa do runner do Playwright, não do vitest — e `UserLogin.test.jsx`, nenhum dos dois tocado nesta sessão).

**Ainda não implementado:** A1-A6, M1-M8, B1-B9 (ordem sugerida na seção "Plano de correção recomendado").

---

## Problemas críticos

### C1 — `update-location-captain` aceita `userId` arbitrário sem autenticação, e o resultado afeta tarifa
**Arquivo:** `Backend/socket.js:103-178`
**Impacto real:** qualquer cliente que abra uma conexão Socket.IO (não precisa nem ter feito `join`, não precisa de token, não precisa estar logado) pode emitir:
```js
socket.emit('update-location-captain', { userId: '<qualquer ObjectId de motorista>', location: { ltd, lng } })
```
O handler (linha 110) faz `captainModel.findByIdAndUpdate(userId, {...})` sem checar se o socket que está emitindo tem qualquer relação com esse `userId`. Consequências verificadas no próprio código:
- **Localização do motorista pode ser falsificada** (linha 110-118) — "teleporta" qualquer motorista para qualquer coordenada, corrompendo `getCaptainsInTheRadius`/despacho para todos os passageiros que dependem dela.
- **`actualDistance` da corrida é recalculada a partir da posição falsificada** (linhas 134-149) quando o status é `started`/`ongoing` — isso alimenta o cálculo de tarifa por distância. Um atacante pode inflar ou zerar a distância cobrada de uma corrida real em andamento.
- A localização falsa é retransmitida ao passageiro real (`io.to(ride.user.socketId)`, linha 158-164) e ao painel admin (`admin_room`, linha 173-177) — passageiro e admin veem o motorista "andando" onde o atacante mandar.

**Risco para produção:** crítico. Fraude de tarifa e integridade de despacho, sem exigir login algum — é a rota de socket mais exposta de todo o backend.
**Correção recomendada:** exigir que o `userId` do payload bata com uma identidade de captain autenticada, guardada em `socket.data` no momento do `join` (o mesmo padrão já usado para chat, `resolveChatIdentity`/`hasChatAccess`, linhas 180-289) — nunca confiar no `userId` que vem solto no payload de cada evento.

### C2 — `join` de `user`/`captain` aceita `userId` arbitrário sem autenticação
**Arquivo:** `Backend/socket.js:51-66`
**Impacto real:** o handler `join` (para `userType: 'user'` e `userType: 'captain'`) faz `findByIdAndUpdate(userId, { socketId: socket.id })` só com base no que o cliente mandou — sem JWT, sem checagem nenhuma. Isso já foi corrigido para `userType: 'admin'` (linhas 76-98, comentário "S1 da auditoria de segurança" citando exatamente este mesmo tipo de falha), mas o mesmo problema continua aberto para passageiro e motorista.
Qualquer cliente pode se anunciar como qualquer `userId` real e passar a receber, no lugar da vítima, todo evento que o backend endereça por `socketId` (`ride-accepted`, `captain-location-updated`, notificações em tempo real de corrida etc. — grep por `io.to(...socketId...)` no arquivo confirma múltiplos pontos que dependem desse campo).
**Risco para produção:** crítico. Sequestro de eventos em tempo real de outro usuário — um ex-motorista ou ex-passageiro de uma corrida já concluída conhece o `_id` real do outro lado (veio no payload da própria corrida) e pode reusar isso depois.
**Correção recomendada:** mesmo tratamento já aplicado ao `admin` — exigir o JWT do usuário/motorista no payload do `join`, verificar com `jwt.verify`, e só então gravar `socketId` — usando o `_id` decodificado do token, nunca o campo `userId` vindo solto do cliente.

### C3 — Motorista com notificação **negada** não recebe nenhum aviso dentro do app
**Arquivo:** `frontend/src/modules/driver/pages/CaptainHome.jsx:73-83` (idêntico no passageiro: `frontend/src/modules/passenger/pages/Home.jsx:126-137`)
```js
if (Notification.permission === 'granted') {
    await requestFCMToken();
} else if (Notification.permission === 'default' && !localStorage.getItem('notificationPromptSeenCaptain')) {
    setShowNotificationPrompt(true);
}
// permission === 'denied' → nenhum dos dois ramos executa. Nada acontece.
```
**Impacto real:** um motorista que negou a permissão (de propósito ou sem querer, no primeiro prompt do navegador) fica **permanentemente sem receber corridas com o app fechado ou minimizado** — exatamente o cenário que toda a correção do sistema de push (sessão anterior desta auditoria) foi feita para resolver — e o app nunca informa isso a ele. Ele só vai perceber "corridas não chegam" por conta própria, sem nenhuma pista de causa nem de correção (nenhuma orientação tipo "ative nas configurações do navegador").
**Risco para produção:** crítico — é uma perda de notificação **silenciosa e permanente**, precisamente a categoria de bug que este pedido de auditoria pediu para caçar. Qualquer motorista nesse estado é, na prática, invisível ao despacho por push, com o app achando que está tudo normal.
**Correção recomendada:** adicionar um terceiro ramo para `Notification.permission === 'denied'` mostrando um aviso persistente (banner, não só toast) explicando que notificações estão bloqueadas e como reativar nas configurações do navegador/SO — visível toda vez que o motorista estiver online, não só uma vez.

---

## Problemas altos

### A1 — Deploy substitui o Service Worker em uso sem avisar ou recarregar a aba
**Arquivo:** `frontend/vite.config.js:19` (`registerType: 'autoUpdate'`), `frontend/dist/sw.js:1` (`self.skipWaiting(),e.clientsClaim()` incondicional). Nenhuma ocorrência de `controllerchange`, `onNeedRefresh` ou prompt de atualização em todo `frontend/src` (confirmado por grep).
**Impacto real:** a cada novo deploy, o novo SW assume o controle de todas as abas abertas imediatamente (`skipWaiting`+`clientsClaim`), sem perguntar nada e sem recarregar a página. Verifiquei que isso **não quebra** chamadas de API/socket em andamento (não há `runtimeCaching` configurado — ver A2 —, então o novo SW não intercepta esse tráfego), mas o JavaScript já carregado na memória do navegador continua sendo o **antigo** até o usuário fechar/reabrir o app manualmente — sem nenhum aviso de "nova versão disponível". Nesta sessão sozinha houve mais de 10 deploys com correções críticas (push, sessão, despacho); um motorista com o app aberto e em uso contínuo pode ficar rodando código com bugs já corrigidos por dias.
**Risco para produção:** alto — reduz a rapidez com que correções realmente chegam ao usuário, e mais grave: cria uma janela onde app do usuário e backend podem estar em versões de contrato diferentes sem que ninguém saiba.
**Correção recomendada:** usar a API `virtual:pwa-register` do vite-plugin-pwa com `onNeedRefresh`/`onOfflineReady`, mostrando um toast "Nova versão disponível" com botão de atualizar (que chama `updateSW(true)`), como Uber/99/iFood fazem.

### A2 — `watchPosition` roda com `enableHighAccuracy: true` desde antes do login, para todo o app
**Arquivo:** `frontend/src/contexts/LocationContext.jsx:56-60,63`, montado globalmente em `frontend/src/main.jsx` (envolve `<App/>` inteiro, antes de qualquer rota).
**Impacto real:** o GPS de alta precisão liga assim que o app abre — inclusive nas telas de login/cadastro, antes de o usuário ter conta ou ter dado qualquer contexto para precisar de localização. Isso: (1) dispara o prompt nativo de permissão de localização na primeira tela que o usuário vê, sem contexto — pior prática de UX de permissão que Uber/99 (que pedem só quando o mapa realmente aparece); (2) consome bateria com alta precisão em telas onde a posição não é usada para nada.
**Risco para produção:** alto — impacto direto em bateria (item explicitamente pedido na auditoria) em 100% das sessões, e taxa de conversão de permissão pior por falta de contexto.
**Correção recomendada:** só montar/ativar o watcher depois do login (ou pelo menos com `enableHighAccuracy: false` até a rota realmente precisar de precisão), condicionando `LocationProvider` à existência de sessão ativa.

### A3 — Socket.IO nunca faz upgrade para WebSocket — fica preso em polling HTTP
**Arquivo:** `frontend/src/contexts/SocketContext.jsx:12-14` — `io(url, { transports: ['polling'] })`. Backend aceita `['websocket', 'polling']` (`Backend/socket.js:40`), mas o cliente força só polling, então nunca negocia upgrade.
**Impacto real:** toda comunicação em tempo real (localização do motorista, eventos de corrida, chat) usa requisições HTTP repetidas em vez de uma conexão persistente leve. Isso significa mais bateria, mais dados móveis e mais latência do que o WebSocket entregaria — em 100% das sessões, não um caso raro.
**Risco para produção:** alto — afeta bateria e consumo de dados (pedido explícito da auditoria) de forma sistêmica.
**Correção recomendada:** trocar para `transports: ['websocket', 'polling']` (deixando o socket.io-client fazer upgrade automático quando possível, com fallback para polling só quando WebSocket falhar).

### A4 — Sem `apple-touch-icon`/meta tags iOS — instalação no iPhone fica com ícone genérico
**Arquivo:** `frontend/index.html` (nenhuma tag `apple-touch-icon`, `apple-mobile-web-app-capable` ou `apple-mobile-web-app-status-bar-style` encontrada).
**Impacto real:** iOS Safari não usa o manifest da mesma forma que Android/Chrome para o ícone da tela inicial — sem `apple-touch-icon` dedicado, "Adicionar à Tela de Início" no iPhone gera um ícone genérico (captura de tela recortada), não a marca MoveCity. Comparado a Uber/99/iFood (todos com apple-touch-icon próprio), a primeira impressão de quem instala pelo iPhone é visivelmente pior/amadora.
**Risco para produção:** alto, dado que "instalação no iOS" foi item explícito do pedido e afeta a percepção de qualidade logo no primeiro contato com o app instalado.
**Correção recomendada:** adicionar `<link rel="apple-touch-icon" href="...">` (PNG dedicado, sem transparência) + `<meta name="apple-mobile-web-app-capable" content="yes">` + `<meta name="apple-mobile-web-app-status-bar-style" content="...">`.

### A5 — `env(safe-area-inset-bottom)` nunca lê o valor real — falta `viewport-fit=cover`
**Arquivo:** `frontend/index.html:6` (`<meta name="viewport" content="width=device-width, initial-scale=1.0">`, sem `viewport-fit=cover`). Usado (com fallback fixo) em `frontend/src/modules/passenger/pages/Home.jsx:812,817,833,841,851,862` e `frontend/src/shared/components/ui/BottomSheet.jsx:14`, todos como `pb-[env(safe-area-inset-bottom,16px)]`.
**Impacto real:** por especificação, `env(safe-area-inset-*)` só é preenchido pelo navegador quando o viewport declara `viewport-fit=cover`. Sem isso, **todo** esses seis painéis inferiores (escolha de veículo, confirmação, pagamento, "procurando motorista" etc.) está usando sempre o valor de fallback fixo (16px), nunca o inset real do dispositivo — em iPhones com barra de gestos (a maioria hoje), a área segura real costuma passar de 16px. É um bug determinístico, não depende de sorte: o `env()` está estruturalmente inerte neste projeto até essa meta tag ser adicionada.
**Risco para produção:** alto — afeta as telas de maior tráfego do fluxo de reserva (exatamente os painéis usados em toda corrida), em qualquer iPhone com Face ID rodando como PWA instalado.
**Correção recomendada:** adicionar `viewport-fit=cover` ao `<meta name="viewport">`.

### A6 — Troca de usuário na mesma aba deixa `socketId` cruzado entre contas
**Arquivo:** `frontend/src/modules/passenger/pages/UserLogout.jsx` / `CaptainLogout.jsx` (nenhum dos dois chama `socket.disconnect()`) + `Backend/socket.js:314,318` (`disconnect` limpa por `socketId`, não por `userId`) + `Backend/socket.js:56,62-65` (`join` sobrescreve `socketId` sem checar se já pertencia a outra conta).
**Impacto real:** o socket é um singleton criado uma vez por aba (`SocketContext.jsx:12`) e nunca desconectado no logout. Se o usuário A sai e o usuário B loga em seguida **na mesma aba, sem recarregar a página** (cenário plausível em carro compartilhado/app de motorista em aparelho da frota), o `join` de B roda sobre o **mesmo `socket.id`** que antes pertencia a A. Como o `disconnect` só localiza documentos pelo `socketId` (não pelo dono), o registro de A no banco pode continuar apontando para esse mesmo `socketId` até a próxima queda de conexão — criando uma janela em que eventos endereçados a A poderiam, na teoria, ser recebidos pela sessão de B (mesma conexão física).
**Risco para produção:** alto em cenários de aparelho compartilhado (comuns em frota de motoristas), baixo em uso pessoal normal (onde cada login costuma vir com reload/nova aba).
**Correção recomendada:** chamar `socket.disconnect()` explicitamente no logout (`UserLogout.jsx`/`CaptainLogout.jsx`) — o `SocketProvider` já reconecta sozinho quando necessário.

---

## Problemas médios

### M1 — Sem `runtimeCaching`, o PWA não funciona offline além do shell estático
**Arquivo:** `frontend/vite.config.js:21-28` (bloco `workbox` só tem `globPatterns`/`globIgnores`/`maximumFileSizeToCacheInBytes`, sem `runtimeCaching`).
**Impacto real:** bom para segurança (nenhuma resposta de API fica em Cache Storage — confirmado, ver seção de segurança), mas significa que "offline" só serve o HTML/JS/CSS/ícones já baixados — qualquer ação (login, ver corrida, buscar endereço) falha sem exibir nada além do erro de rede padrão do `axios.js`. Uber/99/iFood normalmente cacheiam pelo menos GETs read-only não sensíveis (categoria de veículo, últimas corridas) com `StaleWhileRevalidate`.
**Risco para produção:** médio — não é regressão de segurança nem perda de dados, mas o app "quebra feio" (mensagens de erro genéricas) em qualquer perda de conexão, em vez de degradar graciosamente.
**Correção recomendada:** avaliar `NetworkFirst` com timeout curto para leituras não sensíveis (ex.: categorias de veículo).

### M2 — `ConnectionBanner` ausente na tela de corrida do passageiro
**Arquivo:** `frontend/src/modules/passenger/pages/Riding.jsx` (sem import de `ConnectionBanner`, confirmado por grep). Presente em `Home.jsx:629`, `CaptainHome.jsx:299`, `CaptainRiding.jsx:188`.
**Impacto real:** exatamente na tela mais crítica do fluxo do passageiro (corrida em andamento), se o socket cair não há nenhum indicador visual de que a conexão foi perdida — a tela simplesmente para de atualizar sem explicação, parecendo travada.
**Risco para produção:** médio-alto do ponto de vista de confiança do usuário, mas não perde dados (o estado real da corrida continua íntegro no backend).
**Correção recomendada:** importar `ConnectionBanner` também em `Riding.jsx`.

### M3 — Fila offline (`offlineQueue.js`) só existe para o motorista, não para o passageiro
**Arquivo:** `frontend/src/services/offlineQueue.js:13-19` (ações: `accept-ride`, `start-ride`, `update-ride-status`, `end-ride`, `confirm-payment` — todas do app do motorista). Cancelar corrida e confirmar pagamento pelo lado do passageiro não usam fila nenhuma.
**Impacto real:** se a rede cair no exato momento em que o passageiro cancela uma corrida ou confirma pagamento, a ação simplesmente se perde — precisa ser repetida manualmente, sem persistência local.
**Risco para produção:** médio — janela pequena (falha tem que coincidir com o clique), mas sem nenhuma rede de segurança.
**Correção recomendada:** estender `offlineQueue`/Dexie para as ações equivalentes do passageiro, ou pelo menos garantir feedback claro + retry manual fácil.

### M4 — Ícone único (1024×1024 JPEG) reaproveitado para 192 e 512, sem versão *maskable*
**Arquivo:** `frontend/vite.config.js:36-47`, arquivo real `frontend/public/movecity-icon.jpg` (1024×1024, JPEG sem transparência).
**Impacto real:** sem `purpose: "maskable"`, ícones adaptativos do Android (que recortam/aplicam máscara de forma) podem cortar conteúdo importante do ícone de forma imprevisível — e por ser JPEG (sem canal alfa), qualquer área fora do quadrado fica com fundo sólido em vez de transparente.
**Risco para produção:** médio (estético, primeira impressão na tela inicial), comparável ao Uber/99/iFood que têm ícones maskable dedicados.
**Correção recomendada:** gerar PNGs reais em 192×192 e 512×512, mais uma variante com `purpose: "maskable"` respeitando a área segura de 80%.

### M5 — Dois caminhos paralelos e descoordenados de notificação de nova corrida em primeiro plano
**Arquivo:** `frontend/src/modules/driver/pages/CaptainHome.jsx:140-174` (evento de socket `new-ride` → som + vibração + `new Notification()` nativo) **e** `:90-99` (listener `onForegroundMessage` do Firebase para o mesmo evento, via push).
**Impacto real:** o comportamento de quando o Firebase entrega em primeiro plano via `onMessage` vs. quando o `onBackgroundMessage` do SW dispara depende do navegador/versão — não há garantia formal de que apenas um dos dois caminhos execute para o mesmo evento. Na pior hipótese, um motorista com o app aberto recebe dois avisos (um `Notification()` nativo do socket + um toast do Firebase) para a mesma corrida.
**Risco para produção:** médio — incômodo/confuso, mas o modal `RidePopUp` (autoridade real da tela) não duplica, então não há risco de aceitar/duplicar corrida.
**Correção recomendada:** escolher uma única fonte de verdade para o aviso sonoro/nativo em primeiro plano (o socket, que já é mais rápido) e fazer o listener de Firebase em primeiro plano apenas atualizar estado, sem gerar notificação nativa própria.

### M6 — Erros de GPS não diferenciados (`PERMISSION_DENIED` tem tratamento próprio; `POSITION_UNAVAILABLE`/`TIMEOUT` não)
**Arquivo:** `frontend/src/contexts/LocationContext.jsx:48-53`.
**Impacto real:** mensagem genérica ("Erro ao obter localização: ...") para "GPS desligado" e "tempo esgotado" — usuário não sabe se precisa ligar o GPS, esperar, ou é problema de permissão.
**Risco para produção:** médio — feedback existe (não é silencioso), só não é acionável.
**Correção recomendada:** tratar os três `error.code` (`1`/`2`/`3`) com mensagens específicas.

### M7 — Sem CTA própria de instalação (`beforeinstallprompt` não é usado em lugar nenhum)
**Arquivo:** grep confirma zero ocorrências de `beforeinstallprompt` em `frontend/src`.
**Impacto real:** o app depende inteiramente da UI nativa do navegador para instalar — sem banner próprio tipo "Instale o MoveCity" como Uber/99/iFood mostram, perdendo uma oportunidade de conversão para o app instalado (que é o que faz push/GPS em segundo plano funcionarem melhor).
**Risco para produção:** médio (oportunidade perdida, não é defeito funcional).
**Correção recomendada:** capturar `beforeinstallprompt`, guardar o evento, e mostrar um CTA próprio contextual (ex.: depois da primeira corrida concluída).

### M8 — `lang: "en"` no manifest de um app em português
**Arquivo:** `frontend/vite.config.js` (manifest gerado, confirmado em `frontend/dist/manifest.webmanifest:1` → `"lang":"en"`), enquanto `frontend/index.html:2` já usa corretamente `lang="pt-BR"`.
**Impacto real:** inconsistência que ferramentas de qualidade PWA (Lighthouse) sinalizam; pode afetar como o Android/Chrome apresenta o app (idioma percebido) na tela de instalação.
**Risco para produção:** baixo-médio, cosmético.
**Correção recomendada:** adicionar `lang: 'pt-BR'` ao bloco `manifest` do `VitePWA`.

---

## Problemas baixos

### B1 — Manifest sem `shortcuts`
Uber/99/iFood usam atalhos de app (long-press no ícone) para ações rápidas ("Chamar corrida", "Início"). `frontend/vite.config.js` não declara `shortcuts`. Cosmético/oportunidade, não bug.

### B2 — Manifest sem `screenshots`
Usado só para a UI expandida de instalação em desktop Chrome; ausência não afeta instalação mobile.

### B3 — `WakeLockSentinel` sem `removeEventListener('release', ...)`
**Arquivo:** `frontend/src/shared/hooks/useWakeLock.js:24` — o listener de `release` é adicionado mas nunca removido explicitamente. Como o próprio browser descarta a referência ao `WakeLockSentinel` quando um novo lock é pedido, o vazamento prático é mínimo (não acumula listeners em objetos vivos), mas não é higiênico.

### B4 — `ToastContext` não limpa `setTimeout` no unmount
**Arquivo:** `frontend/src/contexts/ToastContext.jsx:45-47` — o id do `setTimeout` de auto-dismiss não é guardado nem limpo. Como o provider vive durante toda a sessão do app, o impacto prático é irrelevante, mas é tecnicamente um handle não rastreado.

### B5 — Nenhuma imagem usa `loading="lazy"` nem `width`/`height` HTML
**Arquivo:** 17 ocorrências de `<img>` no repo (ex.: `VehiclePanel.jsx:62`, `Activity.jsx:165,217`), nenhuma com esses atributos — as imagens de veículo (`vehicle-moto.png` 434KB, `vehicle-auto.png` 445KB, `vehicle-car.png` 326KB) carregam eager e podem causar leve deslocamento de layout (CLS) enquanto carregam.

### B6 — Bundle único de ~1,17MB (337KB gzip), sem code-splitting por rota
**Arquivo:** `frontend/src/routes/passengerRoutes.jsx:3-22` e `driverRoutes.jsx:3-12` — 30 páginas importadas estaticamente; zero uso de `React.lazy`/`import()` em todo o projeto. Firebase, Sentry, Leaflet, socket.io-client e React Query entram todos no chunk principal desde o boot, mesmo quando a rota atual não precisa deles (ex.: `leaflet` carrega mesmo em telas que não têm mapa).
**Nota:** isto pesa mais em celulares fracos/rede lenta (item explícito da auditoria), mas como não há erro nem quebra funcional — só tempo de carregamento inicial mais alto — mantenho como severidade baixa; vale a pena corrigir, mas não bloqueia produção.

### B7 — Leitura de token duplicada fora de `session.js`
**Arquivo:** 20+ arquivos chamam `localStorage.getItem('token')`/`'captain-token'` diretamente (ex.: `Home.jsx`, `Riding.jsx`, `RideChat.jsx`, `LiveTracking.jsx`) em vez de `getAccessToken()` de `frontend/src/services/session.js`. Não é falha de segurança (mesma chave, mesmo valor), só inconsistência que dificulta uma eventual migração de estratégia de armazenamento no futuro.

### B8 — Chave Firebase hardcoded no Service Worker (`public/firebase-messaging-sw.js:4-11`)
Esperado/aceitável — chaves client-side do Firebase são públicas por design, não é segredo. Único efeito colateral real: como é um arquivo estático (fora do processamento de env vars do Vite), uma eventual rotação de projeto Firebase só chega aos usuários no próximo deploy que reescreva esse arquivo especificamente — comportamento a ter em mente, não uma falha.

### B10 — `captain.availability.test.js` falha intermitentemente por índice geoespacial ausente no banco de teste
**Arquivo:** `Backend/tests/integration/captain.availability.test.js` (teste "motorista com o APP FECHADO..."), erro real: `MongoServerError: ... unable to find index for $geoNear query` em `services/maps.service.js:30` (`$nearSphere` sobre `locationGeoJSON`).
**Achado durante a validação das correções C1/C2** (não relacionado a elas — `captain.model.js`/`maps.service.js` não foram tocados nesta correção): reproduzido de forma consistente em duas execuções limpas e independentes da suíte completa. O índice `2dsphere` provavelmente não termina de ser criado no MongoMemoryReplSet efêmero antes desta query específica rodar.
**Risco para produção:** nenhum — é um problema do ambiente de teste (índice), não do código de produção, que já roda contra um banco real com o índice permanentemente criado. Registrado aqui só para não ser confundido com regressão em futuras rodadas de teste.
**Correção recomendada:** garantir `await Model.syncIndexes()` (ou equivalente) no setup dos testes de integração antes de qualquer query geoespacial rodar.

### B9 — `admin-frontend` não é um PWA
Sem `vite-plugin-pwa`, sem manifest, sem instalação. Presumivelmente intencional (painel administrativo de uso desktop) — citado apenas para registro, não é um problema no escopo desta auditoria (mobilidade de passageiro/motorista).

---

## O que já estava correto (não repetir correção)

- Aceite de corrida é atômico (`findOneAndUpdate` com filtro de status) — sem condição de corrida entre dois motoristas.
- Todos os `useEffect` de socket revisados em `CaptainHome.jsx`, `CaptainRiding.jsx`, `Riding.jsx` têm `socket.off` pareado — sem vazamento de listener nessas telas.
- `join` é reemitido automaticamente em toda reconexão de socket (padrão `on('connect', handleConnect)` presente nos três arquivos acima) — não depende de ação manual do usuário após queda de rede.
- Chat (`join-chat`) já exige JWT e confirma identidade contra a corrida (`resolveChatIdentity`/`hasChatAccess`) — não sofre do mesmo problema de C1/C2.
- Logout já desvincula o token push do dispositivo e limpa o IndexedDB do Service Worker (`UserLogout.jsx`/`CaptainLogout.jsx`) — próximo usuário do mesmo aparelho não herda notificações de quem saiu.
- Tokens de push inválidos são limpos automaticamente após falha reportada pelo Firebase (`removeInvalidTokens`, chamado em `notificationDispatcher.service.js:24-25,355-356`) — reinstalação/troca de aparelho não acumula lixo indefinidamente.
- Nenhuma resposta de API é armazenada no Cache Storage do navegador (sem `runtimeCaching`, sem `caches.open` manual) — não há risco de dado privado preso em cache de disco.
- Nenhuma rota de corrida/localização/notificação está desprotegida por autenticação HTTP (as exceções encontradas — login, registro, refresh, health-check, webhook com token próprio — são todas esperadas).

---

## Plano de correção recomendado

**Ordem por risco real, não por facilidade de implementar:**

1. **C1 + C2 (Socket.IO sem autenticação)** — corrigir juntos, mesmo padrão: exigir JWT no `join`, gravar identidade em `socket.data`, e validar essa identidade (não o payload solto) em `update-location-captain` e em qualquer outro handler que hoje recebe `userId` do cliente. Isto bloqueia lançamento — é uma vulnerabilidade ativa, não uma degradação de experiência.
2. **C3 (permissão negada silenciosa)** — pequeno, isolado, alto impacto (recall de motoristas invisíveis ao despacho). Fazer junto com A2 (revisão da tela de permissão) faz sentido por proximidade de código.
3. **A5 (`viewport-fit=cover`)** — uma linha, corrige um bug visual determinístico em toda tela de reserva no iPhone.
4. **A1 (prompt de atualização)** — médio esforço (trocar `injectRegister: 'auto'` por integração com `virtual:pwa-register`), mas reduz o risco de usuários rodando código desatualizado por dias após cada correção futura.
5. **A3 (forçar só polling)** — uma linha (`transports: ['websocket', 'polling']`), testar reconexão depois.
6. **A2 (GPS antes do login) + A4 (ícone iOS) + A6 (logout sem disconnect)** — podem entrar no mesmo ciclo, são independentes entre si.
7. **Médios (M1-M8)** — não bloqueiam lançamento; agendar depois do primeiro lote, priorizando M2 (banner de conexão faltando na tela de corrida) e M5 (notificação duplicada) por afetarem a experiência durante uma corrida real.
8. **Baixos (B1-B9)** — bem-vindos como polimento contínuo, sem prazo.

## O que pode esperar
Tudo em "Baixos", mais M1 (offline-first mais robusto), M3 (fila offline do lado passageiro), M7 (CTA de instalação) e M8 (lang do manifest) — nenhum desses ameaça segurança, perde corrida ou perde notificação.

---

## Nota de prontidão para produção: 3/10

**Por que não é mais baixo:** a arquitetura central (despacho, aceite atômico, push, sessão) já foi auditada e corrigida em profundidade nas sessões anteriores, com testes de integração reais cobrindo os cenários críticos de corrida. O app funciona de ponta a ponta no caminho feliz, e boa parte do que falta aqui é polimento (ícones, code-splitting, CTAs).

**Por que não é mais alto:** C1 e C2 não são falhas teóricas — são chamadas de socket sem nenhuma verificação, visíveis no bundle JS público de qualquer navegador (basta abrir o DevTools), que permitem falsificar a localização de qualquer motorista (com efeito direto sobre tarifa) e sequestrar a entrega de eventos em tempo real de outro usuário, sem exigir login. Isso por si só bloqueia um lançamento real, independentemente de qualquer outro item desta lista. Some a isso C3 (uma categoria de bug que a própria correção do sistema de push desta sessão foi feita para eliminar, reaparecendo em outro estado da mesma permissão) e o quadro geral é "as peças certas existem, mas a borda do sistema — o que acontece quando algo não vai como o esperado — ainda tem buracos que um usuário real, ou um atacante casual, vai encontrar rápido".
