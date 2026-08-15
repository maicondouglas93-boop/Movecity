# COR-2003 — Migração do armazenamento de refresh token

Data: 2026-08-15  
Status: implementação concluída; aceite real em Safari/PWA e Android pendente.

## Problema e solução

O frontend web e o painel administrativo mantinham access e refresh tokens no
`localStorage`. Um XSS poderia copiar o refresh de 365 dias, e os cookies genéricos
`token`/`refreshToken` permitiam que sessões de passageiro e motorista se
sobrescrevessem no mesmo navegador.

A correção mantém o access token curto apenas em memória, entrega o refresh web em
cookie HttpOnly/Secure separado por ator e conserva o refresh do APK do motorista em
`EncryptedSharedPreferences` protegido pelo Android Keystore. A renovação e o logout
continuam rotativos e revogáveis; o corpo da requisição só aceita refresh no transporte
Android identificado, nos testes ou durante uma janela explícita de migração.

## Contrato de armazenamento

| Cliente | Access token | Refresh token |
|---|---|---|
| Web/PWA passageiro | memória da aba + cookie HttpOnly curto | `userRefreshToken`, HttpOnly |
| Web/PWA motorista | memória da aba + cookie HttpOnly curto | `captainRefreshToken`, HttpOnly |
| Painel administrativo | memória da aba + cookie HttpOnly curto | `adminRefreshToken`, HttpOnly |
| APK Android motorista | memória/espelho curto para trabalho em segundo plano | `EncryptedSharedPreferences` (AES-256/Keystore) |

Cookies de acesso: `userAccessToken`, `captainAccessToken` e `adminAccessToken`, todos
com path `/`. Cookies de refresh usam paths mínimos: `/users`, `/captains` e
`/api/admin`.

## Ordem de implantação

- [ ] Configurar um domínio de API same-site com os frontends (recomendado) ou um
  reverse proxy no mesmo site. `SameSite=None` não evita o bloqueio de cookies de
  terceiros do Safari/ITP.
- [ ] Definir `REFRESH_BODY_MIGRATION_UNTIL` com uma data ISO curta e futura apenas
  durante o rollout das versões web antigas.
- [ ] Publicar o backend com aceitação dos cookies novos e antigos dentro da janela.
- [ ] Publicar web, PWA, painel administrativo e APK motorista corrigidos.
- [ ] Confirmar login, reload, renovação após 15 minutos e logout em cada cliente.
- [ ] Verificar o evento `AUTH_LEGACY_REFRESH_ACCEPTED`; a contagem deve cair a zero.
- [ ] Esvaziar `REFRESH_BODY_MIGRATION_UNTIL` no fim da janela e confirmar que refresh
  em corpo/cookie genérico falha fechado.

O painel administrativo antigo não possuía cookie de refresh. Por isso, a primeira
abertura depois do rollout remove os tokens antigos do `localStorage` e exige um novo
login. Passageiro e motorista web fazem uma única tentativa de migração do refresh
legado; o valor é removido do storage antes da chamada.

## Validação automatizada executada

- Contrato COR-2003: 8/8.
- Contratos CSRF: 10/10.
- Contratos JWT/política: 7/7 + 8/8.
- Rotação concorrente: 5/5 + 3/3.
- Middlewares de autenticação Jest: 8/8.
- Frontend: 151/151; builds web e driver aprovados.
- Admin: 17/17; build aprovado.

Os 21 cenários de integração com MongoDB replica set permanecem bloqueados neste
sandbox: o `mongod` do `mongodb-memory-server` encerra com código 100 antes da suíte.
O wrapper Gradle também não conseguiu criar/baixar sua distribuição neste ambiente;
por isso o aceite do Java deve ser repetido no CI/Android Studio.

## Roteiro de aceite manual

1. No Chrome e Safari, entrar como passageiro, recarregar a página e aguardar/forçar a
   renovação. Confirmar que não há tokens no Local Storage e que o cookie de refresh é
   HttpOnly.
2. Repetir para motorista web e painel admin no mesmo navegador. Confirmar que as três
   sessões não se sobrescrevem.
3. No APK motorista, entrar, fechar o app, aceitar uma oferta em segundo plano e abrir
   novamente. Confirmar renovação e continuidade da sessão.
4. Fazer logout em cada cliente e verificar que o refresh anterior não renova, sem
   encerrar a sessão de outro ator.
5. Validar que um POST autenticado por cookie sem Origin/Referer permitido recebe 403.

## Rollback controlado

Se o aceite de um cliente falhar, mantenha o backend novo e restaure somente o cliente
afetado enquanto a janela `REFRESH_BODY_MIGRATION_UNTIL` ainda estiver ativa. Não
reintroduza escrita de refresh no `localStorage`. Se o problema for Safari/ITP, corrija
o domínio/proxy same-site; ampliar indefinidamente a janela de corpo não é um rollback
seguro. Depois da estabilização, encerre a janela e remova a compatibilidade legada em
uma correção posterior.
