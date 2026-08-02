# Execução — Bloco F (Erros deixarem de ser silenciosos) — Painel Administrativo

**Base:** [auditoria do painel administrativo, 2026-08-02](2026-08-02-auditoria-painel-administrativo.md), §2.2/§2.3/§3, Bloco F do Plano de Correção.
**Escopo:** o admin nunca mais pode acreditar que salvou algo que não salvou. Cobre as 11 páginas + `UserDrawer.jsx` + `TariffSchedulerModal.jsx`.
**Status:** ✅ concluído e verificado em 2026-08-02. Nada commitado.

## Ponto de partida real (contagem exata, não a estimativa do relatório original)

A auditoria original contou "34 mutations, 9 com onError" olhando `grep -c`, que conta também a linha de import — inflando o total. Recontei pela ocorrência real de `useMutation({`:

| Arquivo | Mutations | Com `onError` hoje |
|---|---|---|
| `Captains.jsx` | 4 (approval, block, verify, adjust) | 1 (adjust) |
| `Finance.jsx` | 3 (bulkApprove, approve, reject) | 2 (approve, reject — via `alert`) |
| `Rides.jsx` | 3 (cancel, reassign, bulkAction) | 0 |
| `Tariffs.jsx` | 4 (global, category, duplicate, createCategory) | 0 |
| `Users.jsx` | 2 (block, bulkBlock) | 0 |
| `Notifications.jsx` | 3 (estimate, create, cancel) | ~2 |
| `Promotions.jsx` | 3 (create, status, simulate) | 1 |
| `UserDrawer.jsx` | 2 (addObservation, tags) | 0 |
| `TariffSchedulerModal.jsx` | 1 (schedule) | 0 |
| **Total** | **25** | **~6** |

Diálogos nativos (`alert`/`confirm`/`prompt`) confirmados por linha: 8 em `Captains.jsx`, 7 em `Finance.jsx`, 3 em `Rides.jsx`, 5 em `Tariffs.jsx`, 4 em `Users.jsx`, 1 em `Notifications.jsx`, 1 em `TariffSchedulerModal.jsx` — 29 ao todo (o relatório original contava 32; a diferença é ruído de regex, não muda a decisão).

## O que muda

**Infraestrutura nova** (`admin-frontend/src/contexts/`, `components/`):
- `ToastContext.jsx` — `useToast()` → `{ success(msg), error(msg) }`, substitui todo `alert()`.
- `ConfirmContext.jsx` — `useConfirm()` → `confirm({ message, title?, tone?, confirmLabel? }) => Promise<boolean>`, substitui todo `window.confirm()`.
- `PromptContext.jsx` — `usePrompt()` → `prompt({ message, required?, placeholder? }) => Promise<string|null>`, substitui todo `window.prompt()`. `required: true` desabilita o botão de confirmar enquanto o campo estiver vazio, em vez de deixar a validação para depois do fechamento do diálogo.
- `ErrorBoundary.jsx` — pego na raiz (`main.jsx`), evita tela branca em erro de render.

**Por página**, sistematicamente:
- Toda `useMutation` ganha `onError: (err) => toast.error(err.response?.data?.message || '<mensagem específica da ação>')`.
- Todo `alert(...)` de sucesso vira `toast.success(...)`.
- Todo `window.confirm(...)`/`confirm(...)` vira `await confirm(...)`.
- Todo `window.prompt(...)` vira `await prompt(...)`.
- Botões que disparam mutation fora do fluxo do `react-hook-form` (ex.: "Aplicar Tarifas" em `Tariffs.jsx`, que chama `updateMutation.mutate()` direto no `onClick` do modal de preview, não pelo `handleSubmit`) passam a travar por `mutation.isPending`, não só por `isSubmitting` do form — hoje aceitam clique repetido porque `isSubmitting` nunca fica `true` nesse caminho.

## Fora de escopo desta execução

- Não estou implementando o Bloco G (papéis no frontend) nem o Bloco E (concorrência/versionamento otimista) aqui — são blocos separados do plano de correção.
- Não estou mudando a *lógica de negócio* de nenhuma mutation, só a forma como sucesso/erro chegam até o admin. Onde uma validação de "motivo obrigatório" já existia (ex.: `handleVerify` em `Captains.jsx`), a regra é preservada — só a captura do texto muda de `window.prompt` para o modal novo.
- Não estou tocando `Dashboard.jsx`, `Logs.jsx` nem `Reports.jsx` — não têm `useMutation` (são só leitura).

## Como verifico

- Build do admin-frontend limpo.
- Suíte do backend na baseline conhecida (não deveria nem ser afetada — este bloco é só frontend).
- Leitura final de cada arquivo tocado confirmando: zero `alert(`/`window.confirm(`/`window.prompt(` restantes, todo `useMutation` com `onError`.

---

## Detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

### Infraestrutura nova

4 arquivos novos em `admin-frontend/src/`:
- `contexts/ToastContext.jsx` — `useToast()` → `{ success, error }`, pilha de toasts no canto inferior direito, auto-some em 6s.
- `contexts/ConfirmContext.jsx` — `useConfirm()` → `confirm(msg | {message, title, tone, confirmLabel}) => Promise<boolean>`. `tone: 'danger'` pinta o botão de confirmar e mostra ícone de alerta — usado nas ações irreversíveis (aprovar repasse, reatribuir corrida, ajustar saldo).
- `contexts/PromptContext.jsx` — `usePrompt()` → `prompt(msg | {message, title, required, placeholder}) => Promise<string|null>`. `required: true` desabilita o botão de confirmar com o campo vazio, em vez de deixar a validação para depois de fechar o diálogo (fecha a lacuna que a auditoria apontou em `Captains.jsx: handleBlock`, onde motivo vazio passava).
- `components/ErrorBoundary.jsx` — pego em `main.jsx`, ao redor de tudo.

`main.jsx` foi reescrito para encadear `ErrorBoundary > QueryClientProvider > ToastProvider > ConfirmProvider > PromptProvider > App`.

### Por página

Todas as 8 páginas/componentes com `useMutation` foram migrados: `Captains.jsx`, `Finance.jsx`, `Rides.jsx`, `Tariffs.jsx` + `TariffSchedulerModal.jsx`, `Users.jsx`, `Notifications.jsx`, `Promotions.jsx`, `UserDrawer.jsx`. Em cada uma:
- Todo `useMutation` sem `onError` ganhou um, com `err.response?.data?.message` como mensagem preferencial e um fallback específico da ação (não um "Erro ao processar" genérico).
- Todo `window.confirm`/`confirm` virou `await confirm(...)`.
- Todo `window.prompt` virou `await prompt(...)`.
- Todo `alert(...)` de sucesso virou `toast.success(...)`.

### Achados extras corrigidos durante a migração (justificados, não pedidos explicitamente)

1. **`captainName` nunca chegava em `TabFinance`** (`Captains.jsx`) — a mensagem de confirmação do ajuste de saldo dizia *"...ao motorista "* (nome vazio) porque `<TabFinance captainId={captain._id} />` nunca passava `captainName`, apesar do componente já esperar essa prop. Corrigido no mesmo commit lógico porque eu estava movendo exatamente essa string para o novo modal de confirmação — deixá-la quebrada no modal novo seria pior do que a versão antiga.
2. **Botão "Aplicar Tarifas" (`Tariffs.jsx`) não travava durante o envio.** Ele chama `updateMutation.mutate()` direto no `onClick`, fora do `handleSubmit` do react-hook-form — então `disabled={isSubmitting}` nunca refletia a mutation de verdade (`isSubmitting` do RHF só rastreia o `onSubmit` passado pro `handleSubmit`). Troquei para `updateMutation.isPending` em 3 pontos de `Tariffs.jsx` (tarifas globais, categoria, nova categoria) e 1 em `TariffSchedulerModal.jsx`. Esse era exatamente o exemplo citado no plano de correção original.
3. **`handleSubmit(mutation.mutate)` não é um erro, mas também não faz o que parece** — em vários formulários o `mutate` (não `mutateAsync`) era passado direto pro `handleSubmit`; como `mutate` não devolve promise, o `isSubmitting` do RHF nunca ficava `true` de verdade nesse caminho. Troquei os pontos onde isso importava (o botão realmente dependia de `isSubmitting`) para usar `mutation.isPending`.
4. **`Notifications.jsx` e `Promotions.jsx` tinham cada uma sua própria reimplementação local de toast** (`useState({show,message,type})` + `showToast()` + o mesmo bloco de JSX repetido). Substituí pelas duas pelo `useToast()` compartilhado — elimina duplicação e unifica a aparência com o resto do painel (antes, essas duas páginas tinham um toast visualmente diferente das outras 9, que não tinham toast nenhum).
5. **`Users.jsx`: "Exportando CSV..." era uma mentira.** O botão de exportar da lista de passageiros só tinha um comentário `// Real implementation would trigger download...` — o `alert` afirmava que uma exportação estava em andamento quando nada acontecia. Troquei a mensagem para `toast.error('Exportação de CSV ainda não implementada nesta lista.')`: não implementei a exportação (fora de escopo), mas parei de fingir que ela existe — isso está diretamente dentro do objetivo do bloco ("o admin nunca mais pode acreditar que algo aconteceu quando não aconteceu").

### Decisão consciente de não adicionar onError

`estimateMutation` em `Notifications.jsx` (estimativa de audiência da campanha, recalculada automaticameante 800ms depois de qualquer mudança nas regras de segmentação) ficou sem `onError`. Diferente das outras 24 mutations, essa não é uma ação que o admin dispara clicando em algo — é uma atualização de fundo que roda a cada tecla digitada. Colocar um toast de erro toda vez que ela falhar (ex.: rede instável por um instante) seria mais perturbador do que ajudar, e a falha não finge sucesso nenhum — o contador de audiência simplesmente não atualiza, o que é visível por si só.

### Verificação

- `npm run build` do `admin-frontend`: limpo em todas as passagens (incremental por arquivo e no final).
- Varredura final por regex em `pages/*.jsx` e `components/*.jsx`: zero ocorrências de `window.alert`/`alert(`/`window.confirm`/`confirm(`/`window.prompt`/`prompt(` fora das minhas próprias chamadas a `await confirm(...)`/`await prompt(...)`.
- Varredura por `useMutation` sem `onError`: só o `estimateMutation` citado acima, por decisão documentada.
- Suíte do backend (`npm test`): 76 passam, 4 falham — mesma baseline dos blocos A e D (este bloco não tocou backend).
- Suíte do **frontend do admin** (`npm test` do `admin-frontend`, não rodada nos blocos anteriores): 2 falhas em `tests/integration/Login.test.jsx` (busca por placeholder que não bate mais com o texto real do campo) e os 2 arquivos `.spec` do Playwright sendo indevidamente coletados pelo Vitest (erro de configuração pré-existente, `vitest` não deveria rodar arquivos de e2e). Confirmei que são pré-existentes: `git stash` → mesmas 2 falhas exatas nos mesmos arquivos → `git stash pop` para restaurar. Nenhuma regressão introduzida por este bloco.

**Nada foi commitado.**
