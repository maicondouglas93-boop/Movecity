# Auditoria e Correção — Login, Autenticação e Persistência de Sessão

**Data:** 2026-08-02
**Escopo:** os 3 apps (passageiro, motorista, admin) + backend.
**Objetivo:** usuário permanece logado indefinidamente; logout só por ação explícita, sessão comprovadamente inválida, ou bloqueio administrativo.

---

## Parte 1 — Auditoria (o que foi encontrado no código)

### Backend

| # | Achado | Gravidade |
|---|---|---|
| B1 | **Passageiro e motorista não têm refresh token nenhum.** `user.model.js:97` e `captain.model.js:208` geram um único token com `expiresIn: '24h'`. Passadas 24h, a próxima chamada retorna 401 e não existe mecanismo de renovação — o usuário é forçado a logar de novo. É a causa raiz direta do problema relatado. | 🔴 |
| B2 | **Admin: refresh token de 7 dias** (`adminUser.model.js:65`). Melhor que os outros dois (foi implementado numa auditoria anterior), mas ainda expira — quem passar 8 dias sem abrir o painel perde a sessão. | 🟠 |
| B3 | **`blacklistToken` tem TTL fixo de 24h** (`blacklistToken.model.js:12`). Hoje coincide com a validade do token (24h), mas se a validade aumentar sem ajustar isto, um token deslogado voltaria a ser aceito depois de 24h — o registro de blacklist expira antes do próprio token. Vira buraco de segurança no momento em que eu estender a sessão. | 🟠 (vira 🔴 com a mudança) |
| B4 | **Cookies httpOnly existem mas são decorativos.** `COOKIE_OPTIONS` usa `sameSite: 'strict'` e o frontend **não usa `withCredentials`** (confirmado: zero ocorrências em `frontend/src`). Em produção (frontend e backend em domínios distintos) esse cookie nunca é enviado. A autenticação real é 100% Bearer via localStorage. | 🟡 |
| B5 | Middleware (`auth.middleware.js`) **já valida o usuário no banco a cada request** e já bloqueia `isBlocked` com 403. Este é o ponto forte da implementação atual — a exigência "validar usuário no backend, não confiar só no localStorage" já é atendida no nível da API. | ✅ |

### Frontend — passageiro e motorista

| # | Achado | Gravidade |
|---|---|---|
| F1 | **`UserProtectWrapper`/`CaptainProtectWrapper` apagam o token em QUALQUER erro.** O `.catch()` é genérico: timeout de 10s (o axios tem `timeout: 10000`), queda de rede, 500 do backend, ou backend hibernando no free tier do Render — todos resultam em `localStorage.removeItem('token')` + redirect pro login. **Esta é a causa mais provável do usuário ser deslogado "do nada"**, e viola diretamente a regra "não deslogar por expiração simples de frontend". | 🔴 |
| F2 | **Interceptor do axios desloga em qualquer 401**, sem nunca tentar renovar, e usa `window.location.href` (reload duro — perde a rota atual e todo estado em memória). | 🔴 |
| F3 | **`UserContext` inicializa com objeto vazio** (`{email:'', fullName:{...}}`) em vez de `null` — impossível distinguir "ainda não carregou" de "carregado". | 🟡 |
| F4 | **Splash é `<div>Loading...</div>` cru**, sem estilo. E `isLoading` nunca volta a `false` no caminho de erro (só não trava porque o catch navega pra fora). | 🟡 |

### Frontend — admin

| # | Achado | Gravidade |
|---|---|---|
| A1 | **`AuthContext` confia no localStorage no boot sem validar nada.** Lê `adminUser` e renderiza como autenticado. Se o admin foi desativado ou o refresh token revogado, a UI aparece logada até a primeira chamada falhar. Viola "não confiar apenas em dados do localStorage; validar usuário no backend". | 🟠 |
| A2 | Refresh token de 7 dias, rotativo, com fila no interceptor — implementado numa auditoria anterior, funciona. Só a duração é insuficiente. | 🟠 |

---

## Parte 2 — Estratégia de correção

**Modelo escolhido:** access token curto + refresh token de longa duração, rotativo, persistido no banco de forma revogável.

| Decisão | Valor | Por quê |
|---|---|---|
| Access token | **15 min** (todos os 3 tipos) | Janela pequena de dano se vazar. O usuário nunca percebe: a renovação é silenciosa. |
| Refresh token | **365 dias**, rotativo | Atende "ficar dias sem abrir". Não é "infinito" literal porque um token sem expiração alguma é indefensável em segurança — 1 ano é o padrão de apps do porte citado (Uber/iFood), e cada uso renova a validade, então quem usa o app regularmente nunca expira de fato. |
| Armazenamento do refresh | **Hash SHA-256 no banco** (nunca o valor cru) | Vazamento do banco não entrega sessões utilizáveis. |
| Transporte do refresh | **Cookie httpOnly + fallback no corpo da resposta** | O backend aceita o refresh token do cookie **ou** do body. Onde o cookie funciona, o token nunca fica exposto ao JS (atende à preferência do usuário). Onde não funciona (cross-site com bloqueio de cookie de terceiros — Safari/ITP), cai no localStorage e a sessão continua funcionando. Não vou entregar só cookie e deixar parte dos usuários sem conseguir logar. |
| Detecção de reuse | Sim | Refresh token já rotacionado sendo reapresentado ⇒ **revoga a família inteira de sessões daquele usuário**. É o sinal clássico de token roubado. |
| Blacklist TTL | Alinhado à validade real do access token | Fecha B3. |

### Regras de logout — o que muda

Encerra a sessão **apenas**:
1. Clique explícito em "Sair" (revoga o refresh token no banco).
2. Refresh token comprovadamente inválido/revogado/expirado (401 do endpoint de refresh, não de uma chamada qualquer).
3. Usuário bloqueado/desativado (403 do middleware, que já existe).

**Nunca mais** encerra por: erro de rede, timeout, 500, 401 numa chamada qualquer antes de tentar renovar, ou qualquer `.catch()` genérico.

---

## Parte 3 — O que será implementado

### Backend

1. **Novo model `refreshToken.model.js`**: `{ tokenHash, userId, userType ('user'|'captain'|'admin'), expiresAt, revokedAt, replacedBy, createdByIp }` + índice TTL.
2. **Novo `services/auth.service.js`**: `issueTokenPair`, `rotateRefreshToken` (com detecção de reuse), `revokeRefreshToken`, `revokeAllForUser`.
3. **Endpoints novos**: `POST /users/refresh`, `POST /captains/refresh`. Reescrever `POST /admin/refresh` pra usar o mesmo serviço.
4. **Login de user/captain/admin** passa a emitir o par (access 15min + refresh 365d), com o refresh também em cookie httpOnly (`sameSite: 'none'`, `secure` em produção).
5. **Logout** revoga o refresh token no banco (não só blacklist do access).
6. **Bloqueio administrativo revoga todos os refresh tokens** do usuário/motorista — fecha o requisito "usuário bloqueado: sessão invalidada corretamente" de forma real, não só no próximo request.
7. `blacklistToken` TTL alinhado a 15min (validade do access token).

### Frontend (os 3 apps)

8. **Interceptor com renovação silenciosa e fila** (o padrão já usado no admin, estendido a passageiro/motorista): em 401, tenta renovar uma vez; só desloga se a renovação falhar. Requisições concorrentes esperam uma única renovação.
9. **`.catch()` genérico dos ProtectWrappers eliminado**: distingue 401/403 (sessão inválida → logout) de erro de rede/timeout/5xx (**mantém a sessão**, mostra estado de erro com opção de tentar de novo).
10. **Restauração de sessão no boot** com splash decente, sem piscar a tela de login: enquanto verifica, mostra splash; só mostra login depois de confirmar que não há sessão.
11. **Admin: validar sessão no boot** contra o backend em vez de confiar no localStorage.
12. **Rota atual preservada** na renovação (nada de `window.location.href`).

### Testes reais (não mocks de comportamento)

Cobrindo exatamente os 7 cenários pedidos, com Mongo em memória e tokens reais:
1. Login emite par de tokens.
2. "Fechar o navegador" → refresh token persiste no banco.
3. "Abrir dias depois" → access token expirado (gerado com expiração no passado, tempo real, não mock) + refresh válido ⇒ renova.
4. Continua autenticado após a renovação.
5. Access token expirado renova automaticamente e a requisição original é repetida.
6. Logout revoga: o mesmo refresh token deixa de funcionar.
7. Usuário bloqueado: sessão invalidada.
8. (extra) Detecção de reuse: refresh token já rotacionado revoga a família.

---

## Fora de escopo (registrado, não esquecido)

- **Migrar 100% para cookie httpOnly sem fallback**: exigiria frontend e backend no mesmo domínio (ou proxy reverso). Sem isso, o bloqueio de cookies de terceiros deixaria parte dos usuários sem login. O desenho híbrido acima é o que dá pra fazer com honestidade nesta infra.
- **Sessão literalmente sem expiração**: 365 dias rotativos é a escolha; um refresh token eterno e irrevogável seria indefensável.
- **Reescrever o fluxo de Google Login** além de emitir o novo par de tokens.

---

## Detalhes da execução

**Status: ✅ concluído e verificado em 2026-08-02. Nada commitado.**

### Backend

**Novos:** `models/refreshToken.model.js` (hash SHA-256, nunca o token cru; `replacedBy` liga a cadeia de rotação; índice TTL) e `services/auth.service.js` (`issueTokenPair`, `rotateRefreshToken` com detecção de reuse, `revokeRefreshToken`, `revokeAllForUser`).

**Access token: 24h → 15min** para passageiro e motorista; refresh token de 365 dias rotativo para os três tipos. Novos endpoints `POST /users/refresh` e `POST /captains/refresh` (sem middleware de auth, de propósito — o ponto do refresh é justamente funcionar com o access token já expirado). O admin migrou do refresh de 7 dias guardado em texto puro no próprio documento para o mesmo serviço compartilhado; efeito colateral positivo: **o admin agora pode ter várias sessões simultâneas** (antes, como só cabia um `refreshToken` no documento, logar num segundo dispositivo derrubava o primeiro — coberto por teste).

**Logout revoga o refresh token** nos três apps. Antes só o access token entrava na blacklist: quem tivesse uma cópia do refresh token podia gerar um access token novo depois do "Sair". Como as rotas de logout de user/captain são GET (contrato pré-existente), o backend também aceita o refresh token por query string, além de cookie e body.

**Bloqueio administrativo revoga todas as sessões** do usuário/motorista (`toggleUserBlock`/`toggleCaptainBlock`). Sem isso, com refresh token de longa duração, o bloqueado continuaria renovando indefinidamente — o middleware barraria cada request (403), mas a sessão em si sobreviveria.

**Cookies:** `sameSite` era `'strict'` e o frontend não usava `withCredentials` — o cookie httpOnly existia mas **nunca era enviado** em produção (domínios distintos). Agora é `none`+`secure` em produção (`lax` em dev, porque `none` sem `secure` é rejeitado pelos navegadores) e o axios envia credenciais. O refresh token vai no cookie **e** no corpo: onde o cookie funciona ele nunca fica exposto ao JS; onde não funciona (Safari/ITP bloqueando cookie de terceiros), o fallback mantém a sessão viva.

**`blacklistToken` TTL: 24h → 30min** (2× a validade do access token). Antes coincidia por acaso com o token de 24h; mantê-lo em 24h com access token de 15min só acumularia lixo — e, pior, se alguém aumentasse a validade do token sem mexer no TTL, um token deslogado voltaria a ser aceito quando o registro de blacklist expirasse antes dele.

Corrigi também um `res.clearCookie` que passava `maxAge` (deprecation warning do Express) — código meu, apareceu na primeira rodada de testes.

### Frontend — passageiro e motorista

**Novo `services/session.js`**: um único lugar decide o que é "salvar" e "encerrar" uma sessão. Antes, `localStorage.setItem('token', ...)` estava espalhado por 6 arquivos e o refresh token nem existia.

**Interceptor (`services/axios.js`) reescrito.** O comportamento antigo era o achado mais grave da auditoria: qualquer 401 apagava o token e fazia `window.location.href` (reload duro, perdendo a rota atual). Agora:
- **Sem resposta HTTP (rede caiu, timeout, backend hibernando) nunca desloga** — não dá para afirmar que a sessão é inválida sem o servidor dizer.
- 401 dispara **uma** renovação silenciosa e repete a requisição original; só encerra se a renovação também falhar.
- Fila (`isRefreshing` + `refreshQueue`) garante um único refresh quando várias requisições falham juntas.
- 401 no login (credenciais erradas) e 403 de conta bloqueada são tratados separadamente — nenhum dos dois é "sessão expirada".

**ProtectWrappers**: o `.catch()` genérico que apagava o token em qualquer erro foi eliminado nos dois. Timeout/rede/5xx agora mostram "Sem conexão com o servidor — você continua logado" com botão de tentar de novo, em vez de deslogar. Também ganharam um splash de verdade (`SessionSplash`) no lugar do `<div>Loading...</div>` cru, e só vão direto ao login quando não há vestígio nenhum de sessão (sem piscar interface autenticada).

**Telas de logout**: rodavam a chamada no corpo do componente (dispara em todo render e duas vezes em StrictMode) e não tinham `.catch()` — se o request falhasse, o usuário ficava preso numa tela escrita "UserLogout", ainda logado. Agora estão em `useEffect` com `.finally()`: **sair funciona mesmo se o servidor não responder**. Também passaram a enviar o refresh token para revogação. `DeleteAccount` passou a limpar a sessão inteira.

### Frontend — admin

`AuthContext` agora confirma a sessão contra `GET /admin/me` (endpoint novo) antes de liberar a interface, em vez de confiar no localStorage. Mostra o usuário em cache primeiro para não piscar a tela de login, e substitui pelo dado do servidor — mas **só descarta a sessão em 401/403**; erro de rede mantém o que está em cache. Logout passou a enviar o refresh token, revogando só a sessão daquele dispositivo em vez de todas.

### Testes

`tests/integration/auth.session.test.js`, **17 casos, todos passando**, cobrindo os 7 cenários obrigatórios:

| Cenário pedido | Como foi testado |
|---|---|
| 1. Login | Emite o par; confirma que o refresh **não** está em texto puro no banco (só o hash). |
| 2 + 3 + 4. Fechar o navegador, abrir dias depois, continuar autenticado | Access token real já expirado (`expiresIn: '-1h'`, verificado pelo `jsonwebtoken` de verdade — um token expirado há 1h é indistinguível de um expirado há 5 dias) + refresh válido ⇒ renova e o token novo funciona em rota protegida. |
| 5. Expirar access token e renovar | Rotação: cada renovação devolve um refresh novo, e o novo continua funcionando. |
| 6. Clicar em sair | Logout ⇒ o mesmo refresh token passa a ser recusado. |
| 7. Usuário bloqueado | Refresh recusado com 403 e sessões revogadas (passageiro e motorista). |
| (extra) Detecção de reuse | Reapresentar um refresh já rotacionado derruba **a sessão legítima também** — comportamento correto diante de roubo. |
| (extra) Isolamento | Revogar sessões de `captain` com um dado id não derruba a sessão de `user` com o mesmo id. |
| (extra) Admin | `/admin/me`, renovação, múltiplas sessões simultâneas, logout e admin desativado. |

Um teste falhou na primeira rodada (logout do admin retornando 401). Antes de mexer no código, **verifiquei empiricamente** com um script descartável: o `loginLimiter` permite 5 logins por janela e bloqueia o 6º — meu arquivo fazia 7 logins de admin, então os últimos recebiam 429 e o teste usava um token vazio. Era o rate limiter funcionando corretamente e o **teste** mal desenhado, não um bug do código de produção. Reescrevi para usar o endpoint de login só nos casos em que o login é o objeto do teste (3 chamadas) e emitir a sessão direto pelo serviço nos demais. Script removido depois.

### Verificação final

- Suíte do backend: **93 passam** (76 de antes + 17 novos), 4 falham — exatamente as mesmas falhas pré-existentes e não relacionadas de todas as auditorias anteriores. Nenhum teste existente quebrou.
- Build do `frontend` (passageiro/motorista) e do `admin-frontend`: limpos.
- `git status` confirma que nenhum arquivo temporário sobrou.

**Nada foi commitado.**
