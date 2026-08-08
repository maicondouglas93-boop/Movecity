# Responsividade do painel admin (admin-frontend) — Plano

## Objetivo

Tornar o painel admin utilizável em telas menores (tablet/mobile, ~375px–768px),
**sem alterar nenhuma lógica** — só classes Tailwind/CSS/markup de layout. Nada de
fetch, contexto, permissões, regras de negócio ou comportamento de dados muda.

## Levantamento (via agente de exploração, somente leitura)

Auditoria completa das 14 páginas de `src/pages/` + componentes compartilhados.
Resumo:

- **`Sidebar.jsx`/`Layout.jsx`**: shell inteiro sem nenhuma classe responsiva —
  sidebar fixa `w-64` sempre visível, sem hambúrguer/drawer. Bloqueia tudo o resto
  em telas estreitas (~119px sobra pro conteúdo num celular de 375px). Prioridade 1.
- **Padrão de clipping de tabela** repetido em 5 lugares: a tabela fica dentro de um
  wrapper `overflow-hidden` (que corta o conteúdo) em vez do wrapper
  `overflow-x-auto` que `Users.jsx`/`Logs.jsx` já usam corretamente —
  `GlobalTariffsSection.jsx`, `Tariffs.jsx` (tabela de Adicionais),
  `Promotions.jsx`, `Notifications.jsx` (2 tabelas).
- **`Finance.jsx` L408**: o esqueleto de loading do `PayoutDrawer` tem
  `w-[500px]` fixo sem fallback `w-full` — quebra abaixo de 500px. A versão já
  carregada (L442) já está certa (`w-full md:w-[500px] lg:w-[600px]`) — só
  copiar.
- **Grids de formulário sem breakpoint** com 2-3 colunas fixas, mais apertados em
  `Promotions.jsx` (L171, `grid-cols-3`) e `Notifications.jsx` (L100 e L255,
  `grid-cols-3`).
- **O resto do app já está bem resolvido**: Dashboard, Reports, DriverAppUpdate,
  ServicesMonitoring e a maioria dos modais/drawers já usam breakpoints
  (`md:`/`lg:`/`xl:`) de forma consistente. `Tariffs.jsx` já tem o melhor padrão
  do repo — troca de tab-strip por `<select>` abaixo de `md:` (L134/146) — vale
  reaproveitar esse padrão onde fizer sentido.

Padrões já estabelecidos no código a reaproveitar (não inventar um novo):
modal `w-full max-w-{sm,md,lg,2xl}`; drawer `w-full md:w-[Npx] lg:w-[Mpx]`;
tabela `overflow-x-auto` (variante com wrapper duplo ou single-div, ambas já em
uso); header `flex flex-col md:flex-row md:items-center justify-between gap-4`;
painel só-desktop `hidden lg:flex`/`hidden md:block`; tab-strip horizontal
`flex overflow-x-auto no-scrollbar`.

## Escopo desta passada

1. **Shell** (`Layout.jsx` + `Sidebar.jsx`): sidebar vira off-canvas/drawer abaixo
   de `md:` com botão hambúrguer + overlay pra fechar (mesmo padrão de
   `menuOpen` já usado em `frontend/src/passenger/components/Header.jsx` — único
   estado local novo desta tarefa, é a interação inerente ao próprio padrão
   responsivo, não lógica de negócio). Padding do `<main>` vira `p-4 md:p-8`.
2. **Fix do clipping de tabela** nos 5 pontos listados — troca mecânica de
   wrapper, mesmo padrão já usado em `Users.jsx`/`Logs.jsx`.
3. **`Finance.jsx` L408** — copiar as classes responsivas do L442.
4. **Grids de formulário apertados** — `Promotions.jsx` L171,
   `Notifications.jsx` L100/L255 (e os `grid-cols-2` sem prefixo nos mesmos
   arquivos) ganham `grid-cols-1 sm:grid-cols-2`/`sm:grid-cols-3`.
5. Ajustes pontuais de baixo risco encontrados no caminho (larguras fixas menores,
   paddings) — só quando triviais e sem tocar estrutura/lógica.

**Fora do escopo** (fica só documentado, não implementado): converter as tabelas
densas de `Captains.jsx`/`Rides.jsx`/`Finance.jsx` em layout de cards por linha
abaixo de `sm:` — mudaria a estrutura de renderização por linha, risco maior pra
uma passada "só CSS"; o scroll horizontal já as deixa utilizáveis. O botão "Mapa"
em `Rides.jsx` que fica sem efeito abaixo de `lg:` (o painel do mapa é
`hidden lg:flex` incondicionalmente) é uma inconsistência de comportamento, não
de CSS — fica só registrado aqui, não corrigido nesta tarefa.

## Verificação

`npm run build` (admin-frontend) + `npm run test` (vitest) depois das mudanças,
mais checagem visual via dev server em larguras simuladas (375px/768px/1024px).

## Resultado

Implementado como planejado, nenhuma lógica tocada — só classes Tailwind e a marcação
mínima de layout necessária (a sidebar off-canvas precisa de um estado local
aberto/fechado, mesmo padrão já usado no header do passageiro).

- `Layout.jsx`/`Sidebar.jsx`: sidebar virou drawer off-canvas abaixo de `md:`
  (hambúrguer no topo + overlay + botão X + fecha ao navegar), padding do
  conteúdo `p-4 md:p-8`.
- 5 tabelas que cortavam conteúdo (`overflow-hidden` sem scroll interno) corrigidas
  com o mesmo wrapper `overflow-x-auto` já usado em `Users.jsx`/`Logs.jsx`:
  `GlobalTariffsSection.jsx`, `Tariffs.jsx` (Adicionais), `Promotions.jsx`,
  `Notifications.jsx` (2 tabelas).
- `Finance.jsx` L408: esqueleto de loading do `PayoutDrawer` ganhou o mesmo
  `w-full md:w-[500px] lg:w-[600px]` que a versão carregada já tinha.
- Grids de formulário sem breakpoint (`grid-cols-2`/`grid-cols-3` fixos) em
  `Promotions.jsx` e `Notifications.jsx` viraram `grid-cols-1 sm:grid-cols-{2,3}`.

**Verificação**: `npm run build` ok (precisou `npm install` antes — `@sentry/react`
estava no `package.json` mas não instalado no `node_modules`, gap de ambiente
pré-existente, não relacionado a esta tarefa). `npx vitest run` — 3/3 arquivos,
11/11 testes (7 pré-existentes + 4 novos em `tests/integration/ResponsiveSidebar.test.jsx`
provando que o drawer abre no hambúrguer, fecha no overlay, fecha ao navegar e fecha
no X). Servidor dev real + Playwright confirmaram zero overflow horizontal em
375px. Não foi possível capturar screenshot autenticado da sidebar num navegador
real dentro desta sessão (exigiria credenciais reais de admin) — a prova funcional
ficou no teste de interação, que exercita as mesmas classes/eventos reais.
