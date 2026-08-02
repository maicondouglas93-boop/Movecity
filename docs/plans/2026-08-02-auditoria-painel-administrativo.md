# Auditoria Técnica — Painel Administrativo (MoveCity)

**Data:** 2026-08-02
**Escopo:** `admin-frontend/` (5.822 linhas, 21 arquivos-fonte) + toda a superfície administrativa do backend (`Backend/routes/admin.routes.js`, `controllers/admin.controller.js`, `services/admin.service.js`, models relacionados).
**Método:** leitura integral do frontend admin, cruzamento de **todas** as chamadas de API contra as rotas reais do backend, e verificação por `grep` de quais campos de configuração são de fato consumidos pela lógica de negócio.
**Status:** relatório apenas. **Nenhum código foi alterado.**

---

## Sumário executivo

O painel tem uma casca visual boa — dark theme coeso, drawers, tabelas densas, timelines de auditoria. Estruturalmente parece um SaaS. Mas a auditoria encontrou um padrão que se repete em quase todos os módulos: **a interface promete operações que o backend não completa, e o backend guarda configurações que nada lê.**

Os quatro achados que definem o estado atual:

1. **O módulo Financeiro inteiro opera sobre uma coleção que nada popula.** Nenhuma linha do backend cria um `payout` — não existe endpoint de solicitação de saque para o motorista. A tela, os filtros, o drawer, a aprovação em lote e a timeline trabalham sobre um conjunto permanentemente vazio.
2. **"Aprovar e Pagar" não paga.** `approvePayout` marca `status: 'paid'` e debita um contador — sem transação, sem gateway, sem registro na carteira real. O comentário no código diz *"simulate manual instant payment for now"*.
3. **O módulo de Promoções não afeta nenhuma corrida.** O model `promotion` é referenciado **exclusivamente** dentro de `admin.controller.js`. Nenhum ponto do cálculo de tarifa ou criação de corrida o consulta.
4. **A sessão do administrador morre a cada 15 minutos.** O access token tem `expiresIn: '15m'`, o backend gera um refresh token de 7 dias — mas **não existe rota de refresh** e o frontend descarta o refresh token. Todo trabalho em formulário aberto é perdido.

**Veredito de production readiness: não está pronto.** Os módulos Financeiro e Promoções são fachadas; a sessão é inviável operacionalmente; e alterações na comissão da plataforma podem ser sobrescritas silenciosamente entre dois administradores.

---

## 1. Arquitetura

### 1.1 Organização

```
admin-frontend/src/
├── App.jsx                    52   rotas
├── main.jsx                   22   QueryClient + StrictMode
├── contexts/                  99   Auth, Socket
├── components/               ~750  5 componentes soltos + layout/
├── pages/                    3.599 11 páginas
└── services/api.js            35   axios + interceptors
```

**Padrão:** SPA por página, sem camada de domínio. Cada página faz suas próprias chamadas `api.get/post/put` inline, define seus próprios subcomponentes no mesmo arquivo, e reimplementa os mesmos padrões.

| Problema | Evidência | Classificação |
|---|---|---|
| **Sem camada de serviço/API** | As 11 páginas chamam `api.*` diretamente com URLs literais. Não há `services/captains.js`, `services/finance.js` etc. Uma mudança de contrato exige caçar strings pelo projeto. | 🟠 |
| **Páginas gigantes com múltiplas responsabilidades** | `Captains.jsx` = 805 linhas com **7 componentes** no mesmo arquivo (`Captains`, `CaptainActionMenu`, `CaptainDrawer`, `TabProfile`, `TabDocuments`, `TabRides`, `TabFinance`, `TabAudit`). `Rides.jsx` 592, `Tariffs.jsx` 562, `Finance.jsx` 535. | 🟠 |
| **Duplicação massiva de UI** | O par "tabela + filtros + seleção em massa + paginação + drawer" está reescrito do zero em `Captains.jsx`, `Rides.jsx`, `Finance.jsx` e `Users.jsx` — 4 implementações independentes do mesmo padrão. | 🟠 |
| **`exportCSV` duplicado 3×** | Função praticamente idêntica em `Captains.jsx:111`, `Finance.jsx:79`, `Rides.jsx:136`. | 🟡 |
| **Paginação duplicada 4×** | Mesmo bloco "Anterior/Próxima + Página X de Y" copiado em 4 páginas. | 🟡 |
| **`statusColors`/`statusNames` duplicados** | Mapas de cor/rótulo redefinidos em `Captains.jsx:39`, `Finance.jsx:10`, `Rides.jsx`. Em `Captains.jsx` o mesmo mapa de `approvalStatus` é reusado para pintar **status de corrida** (`TabRides`, linha 604) — vocabulários diferentes no mesmo dicionário. | 🟡 |
| **Zero hooks reutilizáveis** | Não existe `hooks/`. Nenhum `usePaginatedQuery`, `useDebounce`, `useBulkSelection`. O debounce de busca existe só em `Users.jsx:23`; as outras 3 páginas exigem submit manual — inconsistência de comportamento entre telas equivalentes. | 🟠 |
| **Dependências instaladas e nunca usadas** | `zustand` e `@hookform/resolvers` não têm nenhum import no `src/`. `zod` é importado só em `Notifications.jsx`. Peso morto no `package.json`. | 🟢 |
| **Configuração de teste duplicada** | Existem `playwright.config.js` **e** `playwright.config.ts`, além de dois diretórios de e2e (`e2e/` e `tests/e2e/`). | 🟡 |
| **Sem code splitting** | `App.jsx` importa as 11 páginas estaticamente. Recharts, Leaflet e react-leaflet entram no bundle inicial mesmo para quem só abre o Dashboard. | 🟠 |

### 1.2 Acoplamento e dependências circulares

Não há dependências circulares no frontend. No backend, `admin.controller.js` usa `require()` **dentro das funções** (`const Promotion = require('../models/promotion.model')` nas linhas 229, 269, 281; `require('../services/audit.service')` nas 94 e 242) — provável contorno de ciclo, mas mascara o grafo de dependências e impede análise estática. 🟡

---

## 2. UI (Interface)

### 2.1 O que está bom

Tokens semânticos consistentes (`bg-surface`, `text-text-muted`, `border-border`, `text-primary/danger/warning`) aplicados de forma disciplinada em todas as 11 páginas. Densidade de informação adequada para painel operacional. Drawers de 600-800px com abas são um padrão correto para CRM.

### 2.2 O que entrega aparência amadora

| Item | Evidência | Classificação |
|---|---|---|
| **Diálogos nativos do navegador em ações críticas** | 32 ocorrências de `alert()`/`confirm()`/`prompt()`. Inclui: ajuste manual de saldo (`Captains.jsx:646,652,658,659,662,665`), aprovação de repasse (`Finance.jsx:358`), rejeição com motivo via `window.prompt` (`Finance.jsx:364`), bloqueio de motorista (`Captains.jsx:375`), cancelamento de corrida (`Rides.jsx:155`). Um `prompt()` cinza do SO pedindo o motivo de uma rejeição financeira é o oposto de SaaS profissional. | 🟠 |
| **Gráfico com dados inventados no Centro Financeiro** | `Finance.jsx:96-105` — `// Mock data for the chart` com valores fixos (Seg 400, Ter 300, Qua 600…). Um gráfico de área financeiro que **nunca** reflete a realidade. | 🔴 |
| **Placeholder de funcionalidade em produção** | `Dashboard.jsx:206-213` — card "Painel de Gráficos" com texto *"esta área modular está pronta para receber gráficos… nos próximos ciclos de atualização"*. Ocupa 2/3 da largura da seção principal do dashboard. | 🟠 |
| **Imports pesados sem uso** | `Dashboard.jsx:8-10` importa `LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer` do Recharts — **nenhum é usado** no arquivo. | 🟡 |
| **Botão decorativo** | `TariffAdvancedSimulator.jsx:95` — "Traçar Rota via Google Maps" sem `onClick`. Os estados `origin`, `destination` e `useApi` são declarados e nunca consumidos. | 🟡 |
| **Item de menu para rota inexistente** | `Sidebar.jsx:21` aponta "Configurações" para `/settings`, que **não existe** em `App.jsx`. Cai no catch-all `path="*"` e redireciona para `/dashboard` — o usuário clica e "não acontece nada". | 🟠 |
| **Ícones de documentos via CDN externo** | `Captains.jsx:17-21` carrega marcadores Leaflet de `cdnjs.cloudflare.com`. Quebra offline e sob CSP restritiva. | 🟢 |

### 2.3 Estados de carregamento, vazio e erro

| Estado | Situação |
|---|---|
| Loading | 3 padrões diferentes: spinner (`Dashboard`), texto "Carregando..." em `<td>` (`Captains`, `Finance`, `Rides`, `Logs`), texto solto (`Tariffs`). **Nenhum skeleton.** |
| Vazio | Texto centralizado em `<td>`, sem ilustração nem ação. Consistente, mas mínimo. |
| Erro | `Dashboard` e `Logs` tratam `isError`. `Captains`, `Finance`, `Rides` declaram `isError` na desestruturação e **nunca usam** — em falha de rede a tabela renderiza vazia, indistinguível de "nenhum resultado". |
| **Erro de mutation** | **34 `useMutation` no projeto, apenas 9 com `onError`.** As mutations de tarifa (`Tariffs.jsx:163` e `262`) não têm `onError`: se o PUT falhar, nenhuma mensagem aparece e o `alert` de sucesso simplesmente não dispara. O admin não tem como saber que a tarifa não foi salva. 🔴 |

### 2.4 Acessibilidade

Não auditei linha a linha, mas os sinais estruturais: tabelas sem `<caption>`/`scope`, botões de ícone puro sem `aria-label` (`MoreVertical`, `X`, checkboxes de seleção), `<div onClick>` nas linhas de tabela (`Captains.jsx:246`, `Finance.jsx:245`) sem `role`/`tabIndex` — as linhas não são alcançáveis por teclado, e o drawer só abre com mouse. Modais sem focus trap nem `role="dialog"`. 🟠

---

## 3. UX

| Problema | Evidência | Classificação |
|---|---|---|
| **Sessão expira em 15 minutos, sem aviso e sem recuperação** | `adminUser.model.js:56` (`expiresIn: '15m'`) + `api.js:23-29` (401 → `localStorage.clear` + `window.location.href='/login'`). Um admin preenchendo o formulário de promoção (20+ campos) ou a tabela de tarifas perde tudo no meio do trabalho, com reload duro da página. | 🔴 |
| **Busca inconsistente entre telas** | `Users.jsx` tem debounce de 500ms (busca conforme digita). `Captains`, `Finance` e `Rides` exigem `Enter`/submit. Mesma tarefa, três comportamentos. | 🟡 |
| **Seleção em massa quase inútil em Motoristas** | `Captains.jsx:205-213` — selecionar N motoristas habilita **apenas "Exportar CSV"**. Não há bloqueio, aprovação nem mensagem em lote, embora o backend tenha `POST /admin/users/bulk-action` para passageiros. | 🟡 |
| **Exportação silenciosamente parcial** | Os 3 `exportCSV` operam sobre `data.captains`/`data.payouts`/`data.rides` — **apenas a página atual (15 registros)**. O admin filtra 800 motoristas, clica "Exportar CSV" e recebe 15 linhas sem nenhum aviso. | 🟠 |
| **Aprovação em lote sem prestação de contas** | `bulkApprovePayouts` (admin.service.js:914-950) usa `continue` para pular repasses inválidos e retorna só `approvedCount`. O admin seleciona 10, vê *"Sucesso! 3 repasses foram aprovados"* e não sabe quais 7 falharam nem por quê. | 🟠 |
| **Drawer com dados congelados** | `Captains.jsx:324` passa o objeto `captain` da linha da tabela. Após aprovar (`invalidateQueries(['captains'])`), o drawer continua exibindo o objeto antigo — o botão "Aprovar" segue visível como se nada tivesse acontecido. | 🟠 |
| **Confirmação financeira sem identificar o alvo** | `Captains.jsx:664` monta `…ao motorista ${captainName || ''}` mas `TabFinance` é invocado (linha 445) como `<TabFinance captainId={captain._id} />` — **`captainName` nunca é passado**. A confirmação de um crédito/débito de até R$ 10.000 sai como *"ao motorista "*. | 🟠 |
| **"Modo Teste" que não testa nada** | `Tariffs.jsx:24,49-58` — o toggle apenas desabilita os botões de salvar. Não simula, não usa sandbox, não muda cálculo. É um "modo somente leitura" rotulado como modo teste. | 🟡 |
| **Sem breadcrumbs, sem indicação de alterações não salvas** | Navegar para fora de `Tariffs` com o formulário `isDirty` descarta tudo sem aviso. | 🟡 |

---

## 4. Funcionalidades falsas, incompletas ou mortas

Esta é a seção mais grave do relatório.

| # | Item | Evidência | Classificação |
|---|---|---|---|
| F1 | **Nada cria repasses (`payout`)** | `grep payoutModel.create` no backend inteiro: **zero ocorrências**. `captain.routes.js` não tem rota de saque. A coleção só é lida e atualizada pelo admin. Todo o Centro Financeiro opera sobre um conjunto vazio permanente. | 🔴 |
| F2 | **"Aprovar e Pagar" não movimenta dinheiro** | `admin.service.js:850-888` — comentário literal *"Update status to paid (simulate manual instant payment for now)"*. Marca `paid`, define `paidAt`, e faz `captain.earnings -= amount`. Nenhuma chamada de gateway, nenhuma `transaction`, nenhuma escrita na `wallet`. | 🔴 |
| F3 | **Promoções nunca se aplicam** | `promotion.model` é referenciado apenas em `admin.controller.js` (linhas 229/269/281). `grep` em `ride.service.js`, `pricingEngine.service.js`, `ride.controller.js`, `ride.routes.js`: **nenhuma referência**. O admin configura orçamento, cidades, tags, janelas de horário e limites por usuário — e nada disso toca uma corrida. `metrics` fica zerado para sempre. | 🔴 |
| F4 | **Cupons: motor existe, ninguém aciona** | `pricingEngine.service.js:163-164` implementa desconto por `couponCode`, e `db.js:99-108` semeia 2 cupons. Mas `couponCode` só aparece dentro do próprio `pricingEngine.service.js` — **nenhum chamador passa o parâmetro**. Dois sistemas de desconto paralelos, ambos inertes. | 🔴 |
| F5 | **Gráfico financeiro mockado** | `Finance.jsx:96-105`. | 🔴 |
| F6 | **Rota `/settings` inexistente** | Link no `Sidebar.jsx:21`. | 🟠 |
| F7 | **"Painel de Gráficos" placeholder** | `Dashboard.jsx:206`. | 🟠 |
| F8 | **Botão "Traçar Rota via Google Maps" sem ação** | `TariffAdvancedSimulator.jsx:95`. | 🟡 |
| F9 | **`avgSearchTimeSeconds` fixo em `null`** | `admin.service.js:143` — `// To be implemented with logs`. O card "Tempo Busca Motorista" exibe "Não disp." permanentemente. (Honesto, mas é KPI morto.) | 🟢 |
| F10 | **`platformBalance` fixo em `null`** | `admin.service.js:832` — `// Not available yet`. Card "Saldo Plataforma" exibe "Não disponível" permanentemente. | 🟢 |
| F11 | **Push de promoção ignora a segmentação** | `admin.controller.js:257` — ao marcar "enviar push", cria a campanha com `targetRules: { audienceType: 'all' }` e o comentário `// Simplificado para o demo`. A promoção segmentada por cidade/tag dispara push para **toda a base**. | 🟠 |
| F12 | **"Tarifa dinâmica automática" é idêntica à manual** | `pricingEngine.service.js:134-135` — `if (status === 'manual' \|\| status === 'auto')` usa o mesmo `currentMultiplier`. Não há cálculo de demanda. A opção "Automático" no select engana o operador. | 🟠 |
| F13 | **"Taxa de chuva automática" não consulta clima** | `weatherProvider` aparece só num **comentário** (`pricingEngine.service.js:222`). `automaticRainFee` e `manualRainFee` disparam exatamente o mesmo multiplicador (linha 144). | 🟠 |

---

## 5. Integração com o Backend

### 5.1 Cruzamento de rotas

Todas as chamadas do frontend têm rota correspondente no backend — **não há URLs inexistentes**. Mas há problemas de contrato:

| Problema | Evidência | Classificação |
|---|---|---|
| **Socket do admin nunca conecta em produção** | `SocketContext.jsx:14` faz `io(import.meta.env.VITE_API_URL)`. O `.env.example` define `VITE_API_URL=https://movecity.onrender.com/api` — com sufixo `/api`. O socket.io interpreta o path da URL como **namespace**; o servidor só registra o namespace padrão. Em produção, o mapa ao vivo e os pings de GPS do admin simplesmente não funcionam. Em dev funciona por acidente (fallback sem `/api`). | 🔴 |
| **Chave Pix nunca aparece** | `admin.service.js:812,839` faz `.populate('captainId', '… pixKey …')`, mas o schema do captain define `pix: { keyType, key }` — **não existe campo `pixKey`**. O frontend lê `payout.captainId?.pixKey` (`Finance.jsx:262,436`) → sempre "Chave não informada", inclusive no CSV. O operador não consegue ver a chave para pagar. | 🟠 |
| **`keepPreviousData: true` é sintaxe da v4 num projeto v5** | `@tanstack/react-query@5.101.4`. Usado em `Captains.jsx:90`, `Finance.jsx:43`, `Logs.jsx:17`, `Rides.jsx:81`. Na v5 o correto é `placeholderData: keepPreviousData`. A opção é ignorada → a tabela pisca em estado de loading a cada troca de página. | 🟡 |
| **`invalidateQueries(['key'])` é sintaxe da v4** | Usado em ~15 pontos. Na v5 a assinatura é `invalidateQueries({ queryKey: [...] })`. Passando um array, o filtro `queryKey` fica indefinido e a invalidação **deixa de ser específica**, atingindo o cache inteiro — refetch geral desnecessário a cada mutation. | 🟡 |
| **Sem `staleTime` em nenhuma query** | `main.jsx:7-12` define apenas `refetchOnWindowFocus: false` e `retry: 1`. Com `staleTime: 0` (padrão), toda remontagem refaz a requisição. `Dashboard` e `Rides` ainda somam `refetchInterval: 60000`. | 🟡 |
| **Erros silenciosos** | Ver §2.3 — 25 das 34 mutations sem `onError`. | 🔴 |

### 5.2 O caso mais perigoso: falha silenciosa por permissão

`GET /admin/tariffs` e `GET /admin/vehicle-categories` exigem apenas `authAdmin` (qualquer papel). Mas `PUT /admin/settings/tariffs` e `PUT /admin/vehicle-categories/:id/tariffs` exigem `super_admin`.

O frontend **não tem consciência de papéis** (§8.1). Resultado, para um admin `financeiro`, `suporte` ou `operador`:

1. A tela de Tarifas abre normalmente e carrega todos os valores.
2. Ele edita a comissão da plataforma e clica em "Salvar Alterações".
3. O backend responde **403**.
4. A mutation **não tem `onError`** → nenhuma mensagem.
5. O `alert('Configurações globais atualizadas com sucesso!')` do `onSuccess` não dispara, mas nada mais acontece.
6. O formulário continua mostrando os valores digitados.

**O administrador sai convencido de que alterou a comissão da plataforma.** 🔴

---

## 6. Regras de Negócio — configurações que salvam mas nunca são usadas

Contagem obtida por `grep` do nome de cada campo em `services/` + `controllers/` + `middlewares/`, excluindo a definição do próprio model.

### 6.1 `globalSetting` — 10 de 14 campos inertes

| Campo | Usos reais | Situação |
|---|---|---|
| `platformCommission` | ✔ | usado no PricingEngine |
| `cardFeePercent` / `cardFeeFixed` | 4 / 4 | usados |
| `maximumNegativeBalance` | 2 | usado no bloqueio por saldo |
| `blockDriverOnNegativeBalance` | 2 | usado |
| `minRecharge` | **0** | 🔴 inerte |
| `minDriverBalance` | **0** | 🔴 inerte |
| `allowNegativeBalance` | **0** | 🔴 inerte (existe `maximumNegativeBalance` fazendo o papel) |
| `minimumPayout` | **0** | 🔴 inerte |
| `payoutDeadlineDays` | **0** | 🔴 inerte |
| `automaticPayout` | **0** | 🔴 inerte |
| `paymentGateway` | **0** | 🔴 inerte — o enum promete asaas/stripe/mercado_pago e nada lê |
| `platformPixKey` | **0** | 🔴 inerte |
| `promotionalHours` | **0** | 🔴 inerte |
| `vehicleTypes` | **0** | 🔴 inerte (categorias são dinâmicas via `vehicleCategory`) |

### 6.2 `tariffSetting` — 2 campos inertes + 2 enganosos

| Campo | Situação |
|---|---|
| `autoTollCharge` | **0 usos** — pedágio automático nunca é cobrado |
| `showAsEstimate` | **0 usos** — o aviso "valor é estimativa" nunca é aplicado |
| `automaticRainFee` | usado, mas idêntico ao manual (F13) |
| `dynamicPricingStatus: 'auto'` | usado, mas idêntico ao manual (F12) |

### 6.3 Armadilha silenciosa: multiplicador clampado sem aviso

`pricingEngine.service.js:138-139` limita `currentMultiplier` entre `minMultiplier` (1.0) e `maxMultiplier` (3.0). **O painel não expõe `minMultiplier`/`maxMultiplier`.** Um admin define multiplicador global `10` no campo "Multiplicador Global", salva com sucesso, e o sistema aplica silenciosamente `3`. Nenhum feedback. 🟠

### 6.4 Contabilidade divergente do saque

`approvePayout` faz `captain.earnings -= payout.amount`:
- `earnings` é o **acumulado histórico de ganhos** (usado como KPI em "Ganhos Totais" no app do motorista), não um saldo sacável. Debitá-lo corrompe a métrica.
- A carteira real (`wallet.creditBalance` / `pendingBalance`), construída na auditoria de concorrência anterior, **não é tocada**.
- Nenhuma `transaction` é criada → o saque **não aparece no extrato do motorista**.
- `wallet.service.js:43` até suporta o tipo `payout`, mas `approvePayout` não o chama.

Consequência: o dinheiro "sai" num campo, a carteira do motorista continua intacta, e o extrato não registra nada. 🔴

### 6.5 Verificação de saldo desativada

`admin.service.js:862` — `// if (captain.earnings < payout.amount) throw new Error('Saldo insuficiente');` está **comentada**. Um repasse pode ser aprovado por valor maior que o saldo, deixando `earnings` negativo. 🔴

---

## 7. Eficiência

| Problema | Evidência | Classificação |
|---|---|---|
| **Sem code splitting** | 11 páginas importadas estaticamente em `App.jsx`. Recharts (~400kB) + Leaflet + react-leaflet no bundle inicial. | 🟠 |
| **Recharts importado sem uso** | `Dashboard.jsx:8-10`. | 🟡 |
| **Zero memoização** | Nenhum `useMemo`/`useCallback`/`React.memo` no projeto inteiro. Em `Captains.jsx`, cada ping de GPS chama `setLiveDrivers` → re-render da tabela inteira (15 linhas × 7 colunas + subcomponentes). Com 50 motoristas online enviando posição a cada 5s, são ~10 re-renders completos por segundo. | 🟠 |
| **`liveDrivers` cresce indefinidamente** | `Captains.jsx:75` e `Rides.jsx:89` acumulam um objeto por motorista visto, sem expurgo. Sessão longa = vazamento de memória. | 🟡 |
| **Sem virtualização** | Tabelas renderizam todos os itens da página. Com `limit=15` é aceitável hoje, mas não há caminho para aumentar a página. | 🟢 |
| **Invalidação excessiva** | Sintaxe v4 de `invalidateQueries` invalida o cache inteiro (§5.1). | 🟡 |
| **`refetchInterval: 60000` em Dashboard + Rides** | Duas queries de agregação pesada a cada minuto por aba aberta, sem `staleTime` e sem pausa quando a aba está em background. | 🟡 |

---

## 8. Segurança

| # | Item | Evidência | Classificação |
|---|---|---|---|
| S1 | **Sala de admin do socket sem autenticação** | `Backend/socket.js` — `socket.on('join', ...)` faz `if (userType === 'admin') socket.join('admin_room')` **sem verificar token algum**. Qualquer cliente que alcance o servidor pode entrar na sala e receber `admin-captain-location-updated` — **a posição GPS em tempo real de toda a frota**. | 🔴 |
| S2 | **Papéis não são aplicados no frontend** | `ProtectedRoute.jsx:14` implementa `allowedRoles`, mas **nenhuma rota em `App.jsx` passa a prop** (o comentário na linha 34 admite: *"Rotas restritas podem usar Wrapper de Roles depois"*). Todo admin autenticado vê e navega em todas as telas. Mitigado pelo backend (que aplica `authorizeRoles`), mas produz a falha silenciosa da §5.2. | 🟠 |
| S3 | **Rota `/unauthorized` não existe** | `ProtectedRoute.jsx:15` redireciona para `/unauthorized`, que não está em `App.jsx` → cai no catch-all → volta para `/dashboard`. Se os papéis fossem ativados, geraria um laço confuso. | 🟡 |
| S4 | **Identidade e papel vêm do `localStorage` sem validação** | `AuthContext.jsx:11-17` lê `adminUser` do localStorage e confia no `role` sem nenhuma verificação contra o servidor no boot. O próprio teste e2e do projeto (`e2e/admin.spec.js:23-26`) demonstra: injeta `adminToken: 'fake-token-123'` e `role: 'super_admin'` e a UI completa renderiza. | 🟠 |
| S5 | **Token em `localStorage` apesar de já existir cookie httpOnly** | `admin.controller.js:12-16` define `res.cookie('adminToken', …, { httpOnly: true })` **e** devolve o token no corpo; o frontend guarda no localStorage e usa via Bearer. O `authAdmin` aceita ambos. A cópia em localStorage é exposição desnecessária a XSS. Cookie sem `sameSite` explícito. | 🟠 |
| S6 | **Refresh token gerado, armazenado e inutilizável** | `adminUser.model.js:61` gera refresh de 7 dias; `admin.controller.js:27` devolve no login. **Não existe rota de refresh** em `admin.routes.js` e o frontend descarta o valor. Infraestrutura morta que cria a falsa impressão de sessão longa. | 🔴 |
| S7 | **Injeção de CSV nas 3 exportações** | `Captains.jsx:117`, `Finance.jsx:85`, `Rides.jsx:142` interpolam valores crus. Um passageiro chamado `=HYPERLINK(...)` executa fórmula ao abrir no Excel. Vírgulas em nomes/endereços também quebram as colunas. | 🟠 |
| S8 | **PII financeira em CSV sem controle** | A exportação do Financeiro inclui a chave Pix (`Finance.jsx:84`) — hoje vazia pelo bug da §5.1, mas o código está pronto para vazar assim que o campo for corrigido. | 🟡 |
| S9 | **Documentos de identidade em URLs públicas** | `upload.service.js` salva com `public: true` e devolve URL do Google Storage; `Captains.jsx:557` renderiza `<img src={docData.url}>`. CNH, CRLV e selfie ficam acessíveis por link direto, **sem autenticação**, a quem tiver a URL. | 🔴 |
| S10 | **Mass assignment em promoções** | `admin.controller.js:238` — `new Promotion(req.body)` sem allow-list. Campos como `currentBudgetUsed`, `metrics` e `status` são graváveis diretamente. | 🟡 |
| S11 | **Rate limiting só no login** | `admin.routes.js:8` aplica `loginLimiter` apenas em `/login`. Endpoints de escrita financeira (`wallet/adjust`, `payouts/*/approve`) não têm limite. | 🟡 |

---

## 9. Concorrência Administrativa

Todos os cenários levantados pelo usuário se confirmam. Nenhuma escrita administrativa usa transação, versionamento ou compare-and-set — em contraste com o fluxo de corridas, que foi endurecido na auditoria de concorrência anterior.

| # | Cenário | Mecânica | Classificação |
|---|---|---|---|
| C1 | **Dois admins editando tarifas** | `updateGlobalSettings` (admin.service.js:1001) faz `Object.assign(tariff, tariffFields); await tariff.save()` — leitura, modificação e escrita separadas, com o **objeto inteiro**. Admin A muda a comissão, Admin B (com a tela carregada antes) muda a taxa de cancelamento e salva → a mudança de A é sobrescrita silenciosamente. Sem ETag, sem `updatedAt` check, sem aviso. | 🔴 |
| C2 | **Dois admins aprovando o mesmo repasse** | `approvePayout` lê, checa `status`, escreve. Duas requisições simultâneas passam ambas pela checagem antes de qualquer escrita → **duplo débito** de `captain.earnings`. | 🔴 |
| C3 | **Ajuste de carteira concorrente** | `adjustCaptainWallet` usa `createTransaction`, que **é** atômico (`$inc`) — este caminho está correto, herdado da auditoria anterior. | 🟢 |
| C4 | **Reatribuição de corrida ignora a máquina de estados** | `reassignRide` (admin.service.js) faz `ride.captain = null; ride.status = 'requested'; await ride.save()` — **não usa `transitionRide`**, o compare-and-set atômico usado por todo o resto do fluxo. Corre contra o motorista aceitando/iniciando no mesmo instante. | 🔴 |
| C5 | **Reatribuição pode arrancar uma corrida em andamento** | O mesmo `reassignRide` só bloqueia `finished` e `cancelled`. Uma corrida em `started` — **com o passageiro dentro do carro** — pode ser devolvida para `requested`. | 🔴 |
| C6 | **Reatribuição não notifica nem redespacha** | Não emite socket para o motorista nem para o passageiro (ambos os apps continuam exibindo a corrida ativa), e **não redespacha** — não há emissão de `new-ride`. A corrida volta para `requested` e fica parada. O diálogo promete *"voltar esta corrida para a fila de busca"*; a fila nunca é notificada. | 🔴 |
| C7 | **Sem optimistic update nem rollback** | Nenhuma mutation usa `onMutate`/`setQueryData` otimista (exceto `TabFinance`, que faz `setQueryData` **após** o sucesso). Não há rollback porque não há update otimista — as telas simplesmente ficam desatualizadas até o refetch. | 🟢 |

---

## 10. Dashboard

| Item | Situação |
|---|---|
| KPIs de receita, motoristas e corridas | ✔ agregações reais no backend, com comparativo período anterior |
| Ranking de motoristas | ✔ real |
| Alertas do sistema | ✔ reais — **exceto** "pagamentos pendentes" (`admin.service.js:161`), que conta `payout`s que nada cria → sempre 0 |
| Health (API/DB/Socket) | ✔ real via `/admin/health` |
| `avgSearchTimeSeconds` | ✖ `null` fixo (F9) |
| Área de gráficos | ✖ placeholder textual (F7) |
| Tempo real | ✖ o dashboard **não usa socket** — só `refetchInterval: 60000`. O título "Métricas em tempo real" é impreciso; a granularidade é de 1 minuto. |

---

## 11. Escalabilidade

| Volume | Situação |
|---|---|
| **100 motoristas** | ✔ funciona |
| **1.000** | 🟡 exportação CSV parcial vira problema real; sem memoização, a tabela com ping de GPS já pesa |
| **10.000** | 🟠 `Tariffs.jsx` cria **uma aba por categoria** (linha 89) — quebra o layout com muitas categorias. `getVehicleCategories` retorna `find()` sem paginação. Logs sem filtro nem busca ficam inúteis. |
| **100.000+** | 🔴 `Logs.jsx` só pagina (sem filtro por admin, ação, data ou alvo) — auditoria não navegável. Exportações client-side impraticáveis. Sem índices verificados nas queries de agregação do dashboard. |

Não há importação de dados em lugar nenhum. Ordenação existe apenas em `Users.jsx` (`sortBy`/`sortOrder`); as outras 3 tabelas não são ordenáveis.

---

## 12. Observabilidade

| Item | Situação | Classificação |
|---|---|---|
| **Três trilhas de auditoria paralelas** | `adminLog` (exibida em Logs + timelines), `auditLog` (escrita em 2 pontos — `admin.controller.js:94,242` — e **nunca exibida em nenhuma tela**), `tariffHistory` (exibida só no componente `TariffHistory`). Histórico fragmentado em 3 coleções com 2 leitores. | 🟠 |
| **Ações administrativas sem registro** | Verificado no nível do controller: `scheduleTariff`, `updatePromotionStatus`, `createCampaign`, `cancelCampaign`, `updateUserTags`, `addUserObservation`, `bulkActionRides` — **nenhum grava auditoria**. Pausar uma promoção, disparar uma campanha para toda a base ou cancelar corridas em lote não deixa rastro de quem fez. | 🔴 |
| **Ações registradas** | `updateTariff` (via controller), `updateVehicleCategory` (via `tariffHistory`), `createVehicleCategory`, `duplicateCategory`, bloqueios, aprovações, repasses, ajuste de carteira. ✔ |
| **IP falsificado no log** | `reassignRide` grava `ipAddress: '0.0.0.0'` fixo, e `approvePayout`/`rejectPayout` usam `ip \|\| '0.0.0.0'`. | 🟡 |
| **Sem Sentry / telemetria no admin** | O app do passageiro usa `@sentry/react`; o `admin-frontend` **não tem Sentry** nem nenhum rastreamento de erro. Erros de JS em produção são invisíveis. | 🟠 |
| **Sem rollback** | Nenhuma tela oferece desfazer. `tariffHistory` guarda `oldValue`, mas não há UI nem endpoint para restaurar. | 🟡 |

---

## 13. Qualidade de Código

| Item | Evidência |
|---|---|
| **DRY** | Violado em 4 eixos (tabela+filtros+seleção+paginação, exportCSV ×3, statusColors ×3, paginação ×4). |
| **SRP** | `Captains.jsx` acumula 7 componentes e 5 responsabilidades de domínio (perfil, documentos, corridas, financeiro, auditoria). |
| **Nomes** | Inconsistência PT/EN dentro do mesmo arquivo (`fetchDashboardStats` + `Motoristas`; `handleBlock` + `Motivo do bloqueio`). Menu diz "Cupons", a página se chama "Promoções", a rota é `/promotions`. |
| **Tipagem** | `@types/react` instalado, mas **zero arquivos TS/TSX** no `src/`. Nenhuma validação de props. `zod` presente e usado só em `Notifications.jsx`. |
| **Duplicação de lógica de precificação** | `TariffAdvancedSimulator.jsx:13-39` reimplementa o cálculo de tarifa em JS no cliente. Já **diverge** do motor real: não aplica `minDistanceIncluded`/`minTimeIncluded`, `roundingRule`, taxas de cartão nem `PricingRule`. O admin toma decisão de preço olhando um número que o sistema não vai cobrar. 🟠 |
| **Default enganoso** | `TariffAdvancedSimulator.jsx:4` — `platformCommission = 15` como default, enquanto o padrão real do sistema é 20 (e `Tariffs.jsx:136` passa `?? 0`). O simulador pode exibir comissão de 0% ou 15% quando a real é 20%. 🟠 |
| **Cobertura de testes** | 1 teste de integração (Login) + 2 arquivos e2e superficiais — o e2e nem chega a clicar em "entrar" (*"O clique real faria a requisição de rede, aqui apenas verificamos se os inputs aceitam valor"*). **Zero cobertura** de tarifas, financeiro, promoções, permissões. |

---

## 14. Production Readiness

| Critério | Status |
|---|---|
| Tratamento global de erros | ✖ sem Error Boundary; 25/34 mutations sem `onError` |
| Sessão utilizável | ✖ 15 minutos sem refresh |
| Fallbacks / offline | ✖ nenhum indicador de conexão; `retry: 1` global |
| Loading states | 🟡 existem, mas em 3 padrões e sem skeleton |
| Cache | 🟡 sem `staleTime`; invalidação com sintaxe da v4 |
| Build | ✔ Vite padrão, sem análise de bundle nem code splitting |
| Variáveis de ambiente | 🟡 só `.env.example`; `VITE_API_URL` com `/api` quebra o socket (§5.1) |
| Responsividade | ✔ breakpoints presentes; drawers e tabelas adaptam |
| Observabilidade | ✖ sem Sentry, sem telemetria |
| Segurança | ✖ S1, S6 e S9 são bloqueadores |

---

## 15. Roadmap

### 🔴 Críticos — perda financeira, corrupção de dados ou vazamento

| ID | Problema | Ref. |
|---|---|---|
| R1 | Sala `admin_room` do socket sem autenticação — GPS de toda a frota exposto | S1 |
| R2 | Documentos de identidade (CNH/CRLV/selfie) em URLs públicas sem auth | S9 |
| R3 | "Aprovar e Pagar" marca como pago sem pagar, sem transação e sem tocar a carteira | F2, §6.4 |
| R4 | Verificação de saldo comentada — saque acima do disponível | §6.5 |
| R5 | Aprovação concorrente de repasse causa duplo débito | C2 |
| R6 | Edição concorrente de tarifas sobrescreve silenciosamente | C1 |
| R7 | Reatribuição de corrida ignora a máquina de estados, aceita corrida em `started`, não notifica e não redespacha | C4, C5, C6 |
| R8 | Falha silenciosa ao salvar tarifas (403 sem `onError`) | §5.2 |
| R9 | Sessão de 15 min sem refresh; refresh token existe mas não tem rota | S6, §3 |
| R10 | Socket do admin não conecta em produção (`VITE_API_URL` com `/api`) | §5.1 |
| R11 | Módulo de Promoções não afeta nenhuma corrida | F3 |
| R12 | Cupons: motor implementado, nenhum chamador | F4 |
| R13 | Nada cria repasses — Centro Financeiro sem fonte de dados | F1 |
| R14 | Gráfico com dados mockados no Centro Financeiro | F5 |
| R15 | Ações administrativas sensíveis sem auditoria (campanhas, promoções, lote) | §12 |

### 🟠 Altos — antes de produção

R16 papéis não aplicados no frontend (S2) · R17 token em localStorage com cookie httpOnly já disponível (S5) · R18 injeção de CSV (S7) · R19 identidade/papel confiados ao localStorage (S4) · R20 exportação silenciosamente parcial (§3) · R21 aprovação em lote sem prestação de contas (§3) · R22 drawer com dados congelados (§3) · R23 confirmação financeira sem nome do motorista (§3) · R24 simulador de tarifa divergente do motor real (§13) · R25 push de promoção ignora segmentação (F11) · R26 "auto" de tarifa dinâmica e chuva são falsos (F12, F13) · R27 clamp silencioso do multiplicador (§6.3) · R28 sem Sentry (§12) · R29 sem code splitting (§7) · R30 rota `/settings` inexistente no menu (F6) · R31 placeholder de gráficos no Dashboard (F7) · R32 chave Pix nunca exibida (§5.1) · R33 sem memoização com socket de alta frequência (§7) · R34 acessibilidade de tabelas e modais (§2.4) · R35 diálogos nativos em ações críticas (§2.2)

### 🟡 Médios

R36 sintaxe v4 do react-query (§5.1) · R37 três trilhas de auditoria (§12) · R38 páginas gigantes (§1) · R39 duplicação de tabela/CSV/paginação (§1) · R40 busca inconsistente (§3) · R41 seleção em massa inútil em Motoristas (§3) · R42 `liveDrivers` sem expurgo (§7) · R43 mass assignment em promoções (S10) · R44 rate limiting só no login (S11) · R45 Logs sem filtros (§11) · R46 "Modo Teste" que não testa (§3) · R47 config de teste duplicada (§1) · R48 IP fixo em logs (§12) · R49 sem rollback de tarifa (§12) · R50 10 campos inertes em `globalSetting` (§6.1)

### 🟢 Baixos

R51 imports Recharts sem uso · R52 dependências não usadas (`zustand`, `@hookform/resolvers`) · R53 botão "Traçar Rota" morto · R54 ícones Leaflet via CDN · R55 `autoTollCharge`/`showAsEstimate` inertes · R56 KPIs `null` fixos · R57 nomenclatura PT/EN misturada · R58 sem virtualização de tabela

---

## Plano de Correção

Blocos independentes, ordenados por risco. Nenhum depende de outro salvo onde indicado.

### Bloco A — Fechar vazamentos de segurança
**Objetivo:** eliminar exposição de dados de terceiros.
**Arquivos:** `Backend/socket.js`, `Backend/services/upload.service.js`, `Backend/controllers/upload.controller.js`, `Backend/routes/admin.routes.js`.
**Estratégia:** autenticar o `join` do socket (verificar JWT e papel antes de `socket.join('admin_room')`); trocar `public: true` por URLs assinadas de curta duração servidas por endpoint autenticado (`GET /admin/captains/:id/documents/:docType/url`).
**Risco:** médio — muda o contrato de exibição de documentos no painel.
**Dependências:** nenhuma.
**Impacto:** alto (privacidade, LGPD).
**Testes:** cliente socket sem token não recebe `admin-captain-location-updated`; URL de documento expira; painel continua exibindo as imagens.
**Dificuldade:** média.

### Bloco B — Integridade financeira do repasse
**Objetivo:** parar de marcar como pago o que não foi pago; tornar o débito atômico e contábil.
**Arquivos:** `Backend/services/admin.service.js` (`approvePayout`, `bulkApprovePayouts`), `Backend/services/wallet.service.js`.
**Estratégia:** introduzir estado `processing` distinto de `paid`; debitar via `walletService.createTransaction({ type: 'payout' })` dentro de `session.withTransaction()` (mesmo padrão de `confirmPaymentReceived`); reativar a checagem de saldo; só marcar `paid` após confirmação do gateway. Enquanto não houver gateway, o estado final honesto é `approved`/`processing`, **nunca `paid`**.
**Risco:** alto — mexe em dinheiro.
**Dependências:** decisão de produto sobre gateway.
**Impacto:** crítico.
**Testes:** duas aprovações concorrentes debitam uma vez; saldo insuficiente rejeita; extrato do motorista mostra o saque.
**Dificuldade:** alta.

### Bloco C — Fluxo de saque ponta a ponta
**Objetivo:** dar origem aos repasses que o painel administra.
**Arquivos:** `Backend/routes/captain.routes.js`, `Backend/controllers/captain.controller.js`, `Backend/services/` (novo), `frontend/src/modules/driver/pages/CaptainWallet.jsx`.
**Estratégia:** endpoint `POST /captains/payouts` respeitando `minimumPayout` e `payoutDeadlineDays` (hoje inertes), criando o `payout` com `bankDetailsSnapshot` preenchido a partir de `captain.pix`.
**Risco:** médio. **Dependências:** Bloco B. **Impacto:** alto — sem isto o módulo financeiro não tem razão de existir.
**Testes:** motorista solicita, aparece no painel, aprovação debita corretamente. **Dificuldade:** média.

### Bloco D — Sessão administrativa utilizável
**Objetivo:** acabar com o logout a cada 15 minutos.
**Arquivos:** `Backend/routes/admin.routes.js`, `Backend/controllers/admin.controller.js`, `admin-frontend/src/services/api.js`, `contexts/AuthContext.jsx`.
**Estratégia:** rota `POST /admin/refresh` validando o refresh token já persistido; interceptor de resposta que, ao receber 401, tenta o refresh uma vez e repete a requisição (com fila para chamadas concorrentes) antes de deslogar. Avaliar remover o token do localStorage e usar apenas o cookie httpOnly já existente.
**Risco:** baixo. **Dependências:** nenhuma. **Impacto:** alto (UX + risco de perda de trabalho).
**Testes:** token expirado renova de forma transparente; refresh inválido desloga; duas requisições simultâneas em 401 disparam um único refresh. **Dificuldade:** média.

### Bloco E — Concorrência administrativa
**Objetivo:** impedir sobrescrita silenciosa e estados impossíveis.
**Arquivos:** `Backend/services/admin.service.js` (`updateGlobalSettings`, `reassignRide`), `Backend/controllers/admin.controller.js`.
**Estratégia:** versionamento otimista (`__v` ou `updatedAt`) nas tarifas — o PUT envia a versão lida e o servidor responde 409 se divergir, com o painel oferecendo recarregar/mesclar. `reassignRide` passa a usar `transitionRide`, restringe as origens válidas (nunca a partir de `started`), remove `otp`, emite socket para as duas pontas e chama `dispatchRideToCaptains`.
**Risco:** médio. **Dependências:** nenhuma. **Impacto:** alto.
**Testes:** dois PUTs concorrentes de tarifa → um 200 e um 409; reatribuir corrida `started` → 409; reatribuição real notifica e redespacha. **Dificuldade:** média.

### Bloco F — Erros deixarem de ser silenciosos
**Objetivo:** o admin nunca mais acreditar que salvou algo que não salvou.
**Arquivos:** todas as páginas do `admin-frontend`, + novo `components/ui/Toast.jsx` e `ErrorBoundary.jsx`.
**Estratégia:** `onError` em todas as 34 mutations; substituir `alert`/`confirm`/`prompt` por toast e modal de confirmação padronizados; Error Boundary na raiz; usar `isPending` da mutation (não `isSubmitting` do form) para desabilitar botões — hoje "Aplicar Tarifas" (`Tariffs.jsx:456`) não trava e aceita cliques repetidos.
**Risco:** baixo. **Dependências:** nenhuma. **Impacto:** alto.
**Testes:** simular 403/500 em cada mutation e confirmar mensagem visível. **Dificuldade:** baixa (volume alto, risco baixo).

### Bloco G — Papéis e navegação coerentes
**Objetivo:** o admin só ver o que pode usar.
**Arquivos:** `admin-frontend/src/App.jsx`, `components/ProtectedRoute.jsx`, `components/layout/Sidebar.jsx`.
**Estratégia:** aplicar `allowedRoles` em cada rota espelhando `admin.routes.js`; criar a página `/unauthorized`; filtrar o Sidebar pelo mesmo mapa; remover ou implementar `/settings`; desabilitar (não esconder) controles de escrita quando o papel não permite, com tooltip explicativo.
**Risco:** baixo. **Dependências:** nenhuma. **Impacto:** médio-alto (elimina a falha silenciosa da §5.2 na origem).
**Testes:** login como `suporte` não vê Financeiro/Relatórios; acesso direto por URL redireciona. **Dificuldade:** baixa.

### Bloco H — Regras de negócio: ligar ou remover
**Objetivo:** acabar com configurações que não fazem nada.
**Arquivos:** `Backend/services/pricingEngine.service.js`, `ride.service.js`, `models/globalSetting.model.js`, `admin-frontend/src/pages/Tariffs.jsx`, `Promotions.jsx`.
**Estratégia:** decisão explícita campo a campo — **ligar** (`minRecharge`, `minimumPayout`, `autoTollCharge`, `showAsEstimate`, promoções, cupons) ou **remover** do model e do painel. Para promoções: implementar a aplicação em `createRide`/`calculateFare` ou retirar o módulo. Expor `minMultiplier`/`maxMultiplier` no painel. Renomear "auto" para "manual" enquanto não houver cálculo de demanda; idem taxa de chuva.
**Risco:** médio (mexe em precificação). **Dependências:** decisão de produto. **Impacto:** alto — é o que separa "configurável" de "teatro de configuração".
**Testes:** cada campo ligado precisa de teste provando que alterá-lo muda o resultado do cálculo. **Dificuldade:** alta.

### Bloco I — Auditoria unificada
**Objetivo:** rastrear quem alterou o quê.
**Arquivos:** `Backend/controllers/admin.controller.js`, `services/admin.service.js`, `admin-frontend/src/pages/Logs.jsx`.
**Estratégia:** consolidar em `adminLog` (mantendo `tariffHistory` como visão especializada); cobrir as 7 ações hoje sem registro; usar `req.ip` real; adicionar filtros (admin, ação, alvo, período) e busca na tela de Logs.
**Risco:** baixo. **Dependências:** nenhuma. **Impacto:** alto (compliance). **Dificuldade:** média.

### Bloco J — Arquitetura e performance
**Objetivo:** sustentar crescimento.
**Arquivos:** todo o `admin-frontend`.
**Estratégia:** camada `services/` por domínio; hooks `usePaginatedQuery`/`useBulkSelection`/`useDebounce`; componentes `DataTable`, `Pagination`, `ExportButton` (com escape de CSV e exportação server-side); `React.lazy` por rota; memoização nas tabelas com socket; migrar sintaxe do react-query para v5; adicionar Sentry.
**Risco:** baixo por bloco, alto se feito de uma vez — fazer página a página.
**Dependências:** Bloco F (o `DataTable` já nasce com os estados corretos). **Impacto:** médio. **Dificuldade:** alta (volume).

---

## Notas

| Dimensão | Nota |
|---|---|
| Arquitetura | **4,0** — estrutura plana, sem camadas, muita duplicação; mas coesa e legível |
| UI | **6,5** — tokens consistentes e densidade correta; derrubada por mocks, placeholders e diálogos nativos |
| UX | **4,0** — sessão de 15 min e falhas silenciosas dominam a experiência |
| Funcionalidades reais | **3,0** — Financeiro e Promoções são fachadas |
| Integração com backend | **5,0** — rotas corretas, contratos com furos, erros engolidos |
| Regras de negócio | **3,0** — 12+ configurações inertes; alterar não muda comportamento |
| Eficiência | **5,0** — funciona no volume atual, sem preparo para crescer |
| Segurança | **3,0** — 3 vazamentos reais (socket, documentos, sessão) |
| Concorrência | **2,5** — nenhuma proteção nas escritas administrativas |
| Observabilidade | **4,0** — 3 trilhas, 2 leitores, 7 ações sem registro, sem Sentry |
| Qualidade de código | **4,5** — legível, mas sem tipagem, sem testes e com lógica de preço duplicada |
| Production readiness | **3,0** |

**Média: 3,96 / 10**

---

## Resposta final

> **Este painel está pronto para operar um negócio real hoje?**

**Não.**

E o motivo não é a interface — visualmente ele já se parece com um SaaS. O motivo é que **as três operações mais críticas de um painel de mobilidade não fazem o que dizem fazer**:

1. **Pagar um motorista não paga.** Marca como pago, debita o contador errado, não registra no extrato, e pode ser executado duas vezes em paralelo pelo mesmo valor.
2. **Configurar preço pode não configurar nada.** Um admin sem `super_admin` recebe 403 e vê exatamente o mesmo que veria em caso de sucesso; dois admins simultâneos sobrescrevem um ao outro sem aviso.
3. **Criar uma promoção não cria promoção nenhuma.** O módulo inteiro — 459 linhas de UI, model com segmentação avançada, orçamento e métricas — não é consultado por uma única linha do fluxo de corrida.

Somando: a sessão cai a cada 15 minutos levando o trabalho junto, a posição GPS de toda a frota está exposta a qualquer cliente de socket, e os documentos de identidade dos motoristas estão em URLs públicas.

**A ordem de correção que eu seguiria:** Bloco A (vazamentos) → Bloco D (sessão) → Bloco F (erros silenciosos) → Bloco B+C (financeiro) → Bloco E (concorrência) → Bloco G (papéis) → Bloco H (regras de negócio) → I → J.

Os blocos A, D e F sozinhos já mudam a percepção do painel de "protótipo convincente" para "ferramenta em que dá para confiar" — e são, os três, de risco baixo a médio.
