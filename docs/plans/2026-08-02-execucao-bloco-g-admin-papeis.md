# Execução — Bloco G (Papéis e Navegação) — Painel Administrativo

**Base:** [auditoria do painel administrativo, 2026-08-02](2026-08-02-auditoria-painel-administrativo.md), achado S2/§5.2/F6, Bloco G do Plano de Correção.
**Escopo:** `App.jsx`, `ProtectedRoute.jsx`, `Sidebar.jsx` — o painel não aplica papel nenhum nas rotas (só o backend aplica), então um admin com papel restrito navega livremente até seções onde toda ação falha, incluindo o caso mais grave já documentado (§5.2): um `operador` edita a comissão da plataforma, clica salvar, recebe 403 do backend, e — antes do Bloco F — nada acontecia na tela, dando a impressão de que salvou.
**Status:** ✅ concluído e verificado em 2026-08-02. Nada commitado.

## Ponto de partida real (confirmado no código antes de planejar)

- `ProtectedRoute.jsx` **já suporta** `allowedRoles` — só que nenhuma `<Route>` em `App.jsx` passa essa prop. O mecanismo existe, não é usado.
- `Sidebar.jsx` **já filtra parcialmente**: `Logs & Auditoria` e `Configurações` têm `role: 'super_admin'` e um filtro (`if (item.role && user?.role !== item.role && user?.role !== 'super_admin') return null`). Duas lacunas nesse filtro: (1) só aceita **um** papel por item, não uma lista — não dá pra expressar "super_admin OU financeiro" (o caso do Financeiro); (2) o bypass hardcoded é `user?.role !== 'super_admin'`, mas o backend (`adminAuth.middleware.js: authorizeRoles`) faz o bypass pra **`OWNER`**, não pra `super_admin` — um admin `OWNER` teria itens escondidos que o backend deixaria ele usar.
- `/settings` está linkado no Sidebar mas **não existe** como rota em `App.jsx` — cai no catch-all e redireciona pra `/dashboard`. `/unauthorized` é o destino do redirect do `ProtectedRoute` quando o papel não bate, mas também não existe como rota.
- `adminUserModel.role` enum real: `['super_admin', 'financeiro', 'suporte', 'operador', 'OWNER']`. Achei uma inconsistência no backend enquanto mapeava as permissões: `admin.routes.js` protege `/campaigns*` e `/promotions*` com `authorizeRoles('super_admin', 'operador', 'marketing')` — **`'marketing'` não existe no enum do schema**, é um papel que nenhum admin real pode ter. Não é bug meu pra corrigir aqui (schema de role é fora do escopo deste bloco, puramente frontend) — só não vou replicar um papel morto no mapeamento do Sidebar/rotas; uso só os papéis que realmente existem.

## Mapa de permissões por rota (derivado de `admin.routes.js`, não inventado)

| Rota | GET (leitura) exige | Rotas de escrita da seção exigem | `allowedRoles` decidido |
|---|---|---|---|
| `/dashboard` | `authAdmin` | — | nenhum (todos os papéis autenticados) |
| `/users` | `authAdmin` | `super_admin, operador, suporte` | nenhum (leitura aberta) |
| `/captains` | `authAdmin` | maioria `super_admin, operador, suporte`; ajuste de carteira `super_admin, financeiro, operador` | nenhum (leitura aberta) |
| `/rides` | `authAdmin` | `super_admin, operador` | nenhum (leitura aberta) |
| `/finance` | **`super_admin, financeiro`** (a própria listagem já exige) | `super_admin, financeiro` | **`['super_admin', 'financeiro']`** |
| `/tariffs` | `authAdmin` | `super_admin` (todas as escritas) | nenhum (leitura aberta — Bloco F já cobre o erro de escrita) |
| `/logs` | **`super_admin`** | — | **`['super_admin']`** |
| `/notifications` | `authAdmin` (campanhas) | `super_admin, operador` (`marketing` descartado — não existe no enum) | **`['super_admin', 'operador']`** |
| `/promotions` | `authAdmin` | `super_admin, operador` (idem) | **`['super_admin', 'operador']`** |
| `/reports` | **`super_admin`** (todas as rotas `/reports/*`) | — | **`['super_admin']`** |

`/finance`, `/logs`, `/reports` são os três casos onde a **leitura em si** já é restrita no backend — visitar a página sem o papel certo resulta numa tela quebrada (todo `useQuery` volta 403). `/notifications`/`/promotions` têm leitura aberta mas toda ação de verdade (criar campanha, criar cupom) é restrita — mantive a página visível só pra quem pode agir nela, já que uma tela de "criar campanha" sem poder criar campanha não serve pra nada.

## O que muda

- `App.jsx`: cada `<Route>` da tabela acima ganha `allowedRoles={[...]}` conforme decidido.
- `ProtectedRoute.jsx`: bypass corrigido de `super_admin` (errado) pra `OWNER` (o que o backend realmente faz).
- `Sidebar.jsx`: `navItems` passa a usar `roles: [...]` (array, não mais um papel só) espelhando exatamente o mapa acima; filtro corrigido com o mesmo bypass de `OWNER`; item `/settings` **removido** (não implementar uma página nova está fora do escopo deste bloco — a opção que o plano original já dava como aceitável).
- Nova página `Unauthorized.jsx`, registrada em `/unauthorized`: mensagem clara + link de volta pro Dashboard, em vez de cair no catch-all.

## Fora de escopo desta execução

- **Desabilitar controles de escrita individualmente dentro de páginas de leitura aberta** (ex.: esconder/desabilitar o botão "Salvar" em Tarifas para quem não é `super_admin`, com tooltip). O Bloco F já resolveu a falha *silenciosa* desse caso (agora aparece um toast de erro claro dizendo "verifique se você tem permissão de super_admin"); ir além disso — checar papel por botão em 7+ páginas — é um escopo bem maior que o "Arquivos" que o plano original lista pra este bloco (`App.jsx`, `ProtectedRoute.jsx`, `Sidebar.jsx`). Fica como trabalho futuro se for decidido.
- **Corrigir o papel `'marketing'` inexistente** no `admin.routes.js` do backend — é uma inconsistência real, mas está no schema/rotas do backend, fora do escopo (puramente frontend) deste bloco.
- **Implementar `/settings`** — removido do menu em vez de construído; não há especificação do que essa tela deveria conter.

## Como verifico

- Login como cada papel (`suporte`, `operador`, `financeiro`, `super_admin`) e conferir o menu lateral mostrado.
- Acesso direto por URL a uma rota fora do papel → redireciona pra `/unauthorized`, não pra uma tela quebrada.
- `OWNER` continua vendo tudo (bypass correto, testado explicitamente — é o caso que o filtro antigo do Sidebar já teria acertado por acidente pro papel errado).
- Build do admin-frontend limpo.

---

## Detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

`ProtectedRoute.jsx`: bypass corrigido de `super_admin` pra `OWNER`.

`App.jsx`: `/dashboard`, `/users`, `/captains`, `/rides`, `/tariffs` continuam sob o `ProtectedRoute` sem `allowedRoles` (leitura aberta, igual o backend). Três grupos novos de rota, cada um com seu próprio `<ProtectedRoute allowedRoles={[...]}>`: `/finance` (`super_admin, financeiro`), `/notifications` + `/promotions` (`super_admin, operador`), `/logs` + `/reports` (`super_admin`). Nova rota `/unauthorized`.

`Sidebar.jsx`: `navItems` ganhou `roles: [...]` (array) espelhando exatamente os mesmos grupos de `App.jsx`; o item "Configurações" foi removido (linkava pra `/settings`, que nunca existiu como rota — F6 do relatório original).

Nova página `Unauthorized.jsx`: mensagem explicando que o papel atual não tem acesso, com o papel do usuário exibido e um link de volta ao Dashboard — em vez do comportamento anterior (`ProtectedRoute` redirecionava pra uma rota inexistente, que caía no catch-all e voltava silenciosamente pro Dashboard, sem nenhuma explicação do que tinha acontecido).

### Verificação

Escrevi um teste temporário (`tests/integration/_temp_bloco_g.test.jsx`, no padrão do `Login.test.jsx` já existente — React Testing Library + `vi.mock` do `useAuth`, sem precisar do MSW já configurado no projeto porque não há chamada de API nesta lógica) cobrindo 8 cenários: menu correto para `suporte`, `financeiro`, `operador` e `super_admin`; `OWNER` vendo tudo mesmo fora das listas de `allowedRoles`; `ProtectedRoute` redirecionando pra `/unauthorized` quando o papel não bate, deixando passar quando bate, e deixando `OWNER` passar sempre. Todos os 8 passaram. Removido depois — `git status` confirma que não sobrou.

Build do `admin-frontend`: limpo.

**Nada foi commitado.**
