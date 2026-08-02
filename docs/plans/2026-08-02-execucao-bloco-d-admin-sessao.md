# Execução — Bloco D (Sessão) — Painel Administrativo

**Base:** [auditoria do painel administrativo, 2026-08-02](2026-08-02-auditoria-painel-administrativo.md), achado S6 e §3 (UX), Bloco D do Plano de Correção.
**Escopo:** o admin é deslogado a cada 15 minutos, sem aviso, com reload duro — mesmo já existindo um refresh token de 7 dias gerado e persistido no login, que hoje o backend não sabe validar e o frontend descarta.
**Status:** ✅ concluído e verificado em 2026-08-02. Nada commitado.

## Ponto de partida real (confirmado no código antes de planejar)

- `adminUser.model.js` já tem `generateAuthToken()` (15min) e `generateRefreshToken()` (7d), e o `refreshToken` **já é salvo** no documento do admin no login (`admin.service.js: login`).
- `admin.controller.js: login` já devolve `refreshToken` no corpo da resposta — mas `AuthContext.jsx: login()` desestrutura só `{ admin, token }` e **descarta** o refresh token.
- Não existe rota `POST /admin/refresh` em `admin.routes.js`.
- `api.js` trata 401 sempre como "sessão morta": limpa o localStorage e faz `window.location.href = '/login'` — sem tentar renovar antes.

## O que muda

| Item | Onde |
|---|---|
| Rota de refresh, validando o refresh token contra o que está salvo no admin (e rotacionando-o a cada uso) | `Backend/routes/admin.routes.js`, `controllers/admin.controller.js`, `services/admin.service.js` |
| Logout também invalida o refresh token salvo (hoje só limpa o cookie do access token) | `Backend/controllers/admin.controller.js`, `services/admin.service.js` |
| `login()` do frontend passa a guardar o refresh token | `admin-frontend/src/contexts/AuthContext.jsx` |
| Interceptor de resposta: em 401, tenta um refresh (com fila para não disparar N refreshes em paralelo quando várias queries falham ao mesmo tempo) e repete a requisição original antes de deslogar | `admin-frontend/src/services/api.js` |

## Decisões de escopo

- **Rotação de refresh token a cada uso** (o backend emite um novo refresh token junto do novo access token, e invalida o anterior): reduz a janela de uso de um refresh token roubado a uma única troca. Custo: se duas abas renovarem quase ao mesmo tempo, uma pode perder a corrida — aceitável, pois cada aba readquire da resposta mais recente e o padrão de fila do interceptor evita isso na prática dentro da mesma aba.
- **Não migrar para autenticação só por cookie httpOnly** (a auditoria original citava isso como algo a "avaliar", não como exigência). Trocar toda a estratégia de Bearer-token-em-localStorage por cookie-only é uma mudança de arquitetura maior, com implicações de CSRF a tratar à parte — fora do escopo de "parar de derrubar a sessão a cada 15 minutos".
- **Sem rate limit dedicado na rota de refresh**: `loginLimiter` existe para conter tentativa de senha por força bruta; um refresh token não é adivinhável (é um JWT assinado), então o rate limit de login não se aplica com o mesmo sentido. A própria comparação `admin.refreshToken !== refreshToken` já invalida qualquer valor que não seja exatamente o último emitido.

## Como verifico

- Login → refresh token salvo no localStorage.
- Chamar `/admin/refresh` com o refresh token certo → recebe novo access+refresh token, cookie atualizado.
- Chamar com refresh token errado/expirado/de outra sessão já rotacionada → 401.
- Simular 401 numa chamada autenticada comum → o interceptor renova sozinho e repete a chamada original, sem deslogar.
- Duas chamadas simultâneas recebendo 401 → só um POST /admin/refresh sai, a segunda espera na fila.
- Logout → refresh token antigo para de funcionar.
- Build do admin-frontend limpo; suíte do backend na baseline já conhecida (76 passam / 4 falhas pré-existentes).

---

## Detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

### Backend

`admin.service.js` ganhou `refreshAccessToken(refreshToken)` — verifica o JWT, confere que `admin.refreshToken` salvo bate exatamente com o token recebido (rejeita qualquer coisa que não seja o último emitido), e rotaciona: gera um access token novo e **um refresh token novo**, salva o novo no admin, devolve os dois. E `invalidateRefreshToken(adminId)`, usado no logout.

`admin.controller.js`: nova ação `refresh` (espelha `login` — seta o cookie `adminToken` de novo, devolve `{ admin, token, refreshToken }`); `logout` passou a chamar `invalidateRefreshToken` antes de limpar o cookie.

`admin.routes.js`: `POST /admin/refresh`, sem `authAdmin` (o ponto da rota é renovar um access token já expirado) e sem rate limiter dedicado — decisão registrada na seção "Decisões de escopo" acima.

### Frontend

`AuthContext.jsx`: `login()` agora guarda `refreshToken` em `localStorage.adminRefreshToken`; `logout()` limpa essa chave também.

`api.js`: o interceptor de resposta, em vez de deslogar direto em qualquer 401, tenta uma renovação primeiro (exceto para as próprias rotas `/admin/login` e `/admin/refresh`, pra não entrar em loop). Implementei o padrão de fila (`isRefreshing` + `refreshSubscribers`) pra evitar que múltiplas queries falhando ao mesmo tempo (comum no Dashboard, que dispara `dashboardStats` + `healthStats` juntas) disparem várias chamadas de refresh em paralelo — só a primeira renova, as demais esperam o token novo e repetem sua requisição original com ele. Se o token renovado ainda voltar 401 (`config._retriedAfterRefresh`), desloga sem tentar de novo.

### Dois bugs reais pegos pela verificação, antes de eu considerar o bloco pronto

Não existe teste automatizado cobrindo login/refresh/logout do admin no repo (`tests/auth.test.js` testa autorização por papel, não o ciclo de vida do token). Como o "como verifico" deste plano incluía especificamente o comportamento de rotação e de invalidação no logout, escrevi um teste temporário (`tests/_temp_refresh_verification.test.js`, no padrão exato dos testes existentes — supertest + `MongoMemoryServer` já configurado em `tests/setup.js`) só pra provar esses dois comportamentos. Ele pegou dois defeitos reais que eu tinha acabado de escrever:

1. **`generateRefreshToken` podia gerar o mesmo token duas vezes.** O `iat` do JWT só tem granularidade de segundo; login seguido de refresh dentro do mesmo segundo produzia tokens idênticos — a "rotação" não rotacionava nada. Corrigido adicionando um `jti` (`crypto.randomUUID()`) ao payload do refresh token, garantindo unicidade por chamada independente de timing.
2. **`invalidateRefreshToken` não invalidava nada.** `findByIdAndUpdate(id, { refreshToken: undefined })` — o Mongoose descarta chaves com valor `undefined` do objeto de update antes de montar o comando, então o update virava `{}` e o refresh token continuava válido depois do logout. Corrigido trocando para `{ $unset: { refreshToken: 1 } }`.

Sem esse teste eu teria reportado o bloco como pronto com o logout não invalidando nada de fato — exatamente o tipo de coisa que "build limpo + suíte na baseline" não pega, porque não existia teste nenhum cobrindo esse caminho antes.

Depois de confirmar os 3 cenários passando (rotação troca o token / token ausente-ou-inválido rejeitado com 401 / logout invalida o refresh salvo), removi o arquivo de teste — não foi pedido para deixar cobertura nova no repo, e `git status` confirma que não sobrou.

### Verificação final

- `npm run build` do `admin-frontend`: limpo.
- `node --check` nos arquivos de backend editados: sintaxe válida.
- Suíte completa do backend (`npm test`): **76 passam, 4 falham, 1 pulado — idêntico à baseline antes deste bloco.** As mesmas 4 falhas do Bloco A, incluindo as duas de `tests/auth.test.js` que na investigação desta execução descobri a causa raiz: o teste chama `/admin/users`, mas `app.js` monta as rotas admin em `/api/admin`, não `/admin` — bug do arquivo de teste em si (path errado), preexistente, não tocado aqui.

**Nada foi commitado.**
