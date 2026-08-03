# Auditoria — persistência de login (usuário deslogado após tempo sem usar o sistema)

**Data:** 2026-08-03
**Pedido:** auditar exclusivamente a persistência de login; identificar por que o usuário é deslogado após algum tempo sem usar o sistema; corrigir só essa causa.

## Premissa verificada e corrigida

O pedido apontava para Firebase Auth (`setPersistence`, `browserLocalPersistence`, `onAuthStateChanged`, `onIdTokenChanged`) como possível mecanismo de sessão. Busquei essas quatro APIs em todo o repositório: **zero ocorrências**. `getAuth`/`signInWithPopup` do `firebase/auth` só existem em dois arquivos (`UserLogin.jsx`, `UserSignup.jsx`) e só para o botão "Entrar com Google" — pegam um `idToken` e mandam pro backend uma vez; depois disso o Firebase Auth não tem papel nenhum na sessão.

Quem mantém a sessão é um sistema próprio: access token JWT (15 min) + refresh token rotativo de longa duração (365 dias, hash SHA-256 no banco), construído na auditoria de 2026-08-02. Foi esse sistema que auditei.

## O que foi revisado (tudo consistente, nada alterado além do achado abaixo)

- `frontend/src/services/session.js` — armazenamento em localStorage.
- `frontend/src/services/axios.js` — interceptors de request/response, renovação silenciosa com fila (`isRefreshing`/`refreshQueue`).
- `UserProtectWrapper.jsx` / `CaptainProtectWrapper.jsx` — só desloga em 401/403; erro de rede mantém a sessão.
- `Backend/models/refreshToken.model.js`, `blacklistToken.model.js` — TTLs corretos.
- `Backend/controllers/user.controller.js` — cookies, logout, refresh.
- Todos os chamadores de `revokeAllForUser`/`revokeRefreshToken` — só logout, bloqueio administrativo e reuso (nenhum cron ou gatilho inesperado).

## Causa raiz encontrada e confirmada empiricamente

`Backend/services/auth.service.js: rotateRefreshToken` — a detecção de reuso de refresh token (mecanismo antirroubo) não distinguia **roubo de verdade** de **duas requisições legítimas do mesmo usuário renovando quase ao mesmo tempo**.

Isso acontece exatamente no padrão relatado: depois de "algum tempo sem usar o sistema", o access token (15 min) expira. Quando o usuário volta — reabre o app, ou tinha uma segunda aba aberta — múltiplos componentes disparam requisições que recebem 401 e tentam renovar quase simultaneamente. Se uma dessas chamadas chega ao backend um instante depois de outra já ter rotacionado o mesmo token, a segunda encontra um token "já usado" e a detecção de reuso conclui que é roubo — revogando **todas** as sessões do usuário, inclusive o token que a primeira chamada tinha acabado de receber legitimamente.

**Verificado com um script real contra `MongoMemoryReplSet`** (não hipótese): duas chamadas de `rotateRefreshToken`, uma logo depois da outra, com o mesmo token original — a segunda falhava com `REFRESH_TOKEN_REUSE`, e o token que a primeira tinha acabado de receber também parava de funcionar em seguida. Sessão inteira destruída sem nenhum roubo.

## Correção — janela de tolerância a reuso (única mudança)

`rotateRefreshToken`: quando o token apresentado já foi rotacionado (tem `replacedBy`) há menos de 30 segundos, em vez de derrubar tudo, o servidor segue a cadeia de rotação até o elo atualmente válido e emite **mais um elo novo** a partir dele — não pode devolver de volta o mesmo token que a outra chamada já recebeu (só o hash fica guardado, nunca o token em texto claro). Fora da janela, ou quando não há `replacedBy` (logout, bloqueio administrativo, reuso já detectado), o comportamento é **idêntico ao de antes**: reuso derruba tudo.

Trade-off de segurança explícito: a janela de detecção de roubo passa de "qualquer reuso, sempre" para "reuso mais de 30s depois da rotação". Mesmo padrão recomendado por implementações de referência de rotação de refresh token (Auth0, OIDC) para tolerar concorrência legítima sem abrir mão de detectar roubo de verdade.

### Por que só 30s, e por que isso não é uma porta aberta
Um atacante com uma cópia de um token já rotacionado continua sendo pego — só não nos primeiros 30 segundos depois da rotação legítima, janela pequena demais para ser útil a um ataque real (que tipicamente reaparece minutos, horas ou dias depois, não milissegundos). A troca é puramente "concorrência entre abas do mesmo dispositivo", não "roubo lento".

## Verificação

- **Teste existente reescrito** (`auth.session.test.js`, teste 8 → 8a/8b): 8a prova que a corrida legítima entre abas não derruba nada; 8b prova que reuso fora da janela continua derrubando tudo — preservando a detecção de roubo original.
- **Script de verificação** (descartável, contra banco em memória) confirmou os quatro comportamentos: corrida tolerada, token do vencedor da corrida continua válido, roubo de verdade (fora da janela) ainda derruba tudo, e logout continua definitivo sem nenhuma tolerância.
- **Suíte completa do backend:** 19 suites, **145 testes**, todos passando.
- **Frontend/admin-frontend:** build OK; nenhuma regressão nova nos testes (a única falha é a baseline pré-existente já documentada, sem relação com este trabalho — nenhum arquivo de frontend foi tocado nesta correção).

## Escopo

Só `Backend/services/auth.service.js` foi alterado (mais os testes que codificavam o comportamento antigo). Nenhuma refatoração geral, nenhuma mudança em `session.js`, `axios.js`, `ProtectWrapper`, cookies, ou qualquer outro ponto do fluxo de autenticação — todos já estavam corretos.
