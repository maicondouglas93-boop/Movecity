# Execução — Etapa 3 (Adotar o Design System no App do Motorista)

**Base:** [auditoria de UX/UI de 2026-08-02](2026-08-02-auditoria-ux-motorista.md), item 9 do plano de implementação.
**Escopo:** migrar as telas do motorista pra usar os tokens (`brand/ink/surface/line/danger`, `shadow-raised/floating`, `rounded-panel`, `z-panel/overlay/modal`) e os componentes do UI kit (`Button`, `Card`, `PageHeader`, `DetailRow`, `StatusBadge`, `BottomSheet`) já criados no redesign do passageiro. Padronizar raio/sombra/z-index. Apagar `App.css` (resíduo do template do Vite, não usado). **Sem mudar nenhuma lógica, API ou regra de negócio** — risco classificado como baixo na auditoria original.
**Fora de escopo aqui (Etapa 4):** `EmptyState`, `Skeleton`, `ConnectionBanner` — ficam pra próxima etapa.
**Status:** ✅ concluído e verificado em 2026-08-02. Nada commitado.

## Mapeamento de tokens

| Antes (ad-hoc) | Depois (token) |
|---|---|
| `bg-green-500` / `hover:bg-green-600` (botão primário) | `Button variant="primary"` (já é `bg-brand-500`/`hover:bg-brand-600` — mesmo tom de verde, é o mesmo token) |
| `bg-white border-2 border-gray-200` (botão secundário) | `Button variant="secondary"` |
| `text-gray-800` / `text-gray-900` | `text-ink-900` |
| `text-gray-500` / `text-gray-600` | `text-ink-600` |
| `text-gray-400` | `text-ink-400` |
| `bg-white` (cartões) | `bg-surface` ou `<Card>` |
| `bg-gray-50` (fundo de página/input) | `bg-surface-alt` |
| `border-gray-100` / `border-gray-200` | `border-line` |
| `shadow-sm` / `shadow-lg` (cartões e elevação) | `shadow-raised` / `shadow-floating` conforme a escala de 2 níveis |
| `rounded-xl` / `rounded-2xl` (cartões e painéis) | `rounded-panel` |
| `z-10` / `z-20` / `z-50` / `z-[60]` / `z-[70]` | `z-panel` (10) / `z-overlay` (40) / `z-modal` (50), conforme a camada real |
| Painel GSAP + ref manual | `<BottomSheet open={} onClose={}>` |
| Cabeçalho de página escrito à mão | `<PageHeader title="..." />` |

`rounded-full` (avatares, badges, botão pill de status) e `text-red-*`/`bg-red-*` em contextos que não são "erro de formulário" (ex.: pino de mapa) ficam como estão — não fazem parte do sistema de tokens novo, e forçá-los não muda nada pro usuário.

## Arquivos e o que muda em cada um

| Arquivo | Mudança |
|---|---|
| `CaptainLogin.jsx` | inputs/botão → tokens; botão primário → `Button` |
| `CaptainSignup.jsx` | inputs/seções/botão → tokens; botão de envio → `Button` (mantendo o texto dinâmico de progresso) |
| `CaptainHeader.jsx` | tokens de cor/borda; `z-[60]` → `z-panel` |
| `CaptainDetails.jsx` | cartões → `Card`; textos → `ink-*`; botão "Ficar Online/Offline" mantém estilo próprio (não é um botão de formulário padrão, é um toggle de estado com cor dinâmica) |
| `RidePopUp.jsx` | remove a alça de fechar manual (fica a cargo do `BottomSheet` que o envolve); cartões/textos → tokens; botões → `Button` |
| `ConfirmRidePopUp.jsx` | idem RidePopUp; botão "Cancelar" → `Button variant="secondary"`; botão "Iniciar"/"A caminho"/"Cheguei" → `Button` |
| `CaptainHome.jsx` | troca os dois painéis GSAP+ref por `BottomSheet` (remove `useGSAP`/`gsap` deste arquivo) |
| `FinishRide.jsx` | remove alça manual; cartões/textos → tokens; botões → `Button` |
| `CaptainRiding.jsx` | troca o painel GSAP+ref por `BottomSheet`; `z-[70]`/`z-50`/`z-20`/`z-10` → escala nova |
| `CaptainWallet.jsx` | cabeçalho → mantém preto (é uma escolha de marca pro contexto "carteira", não parte do sistema neutro) mas cartões/textos/botões → tokens; modal de recarga → tokens |
| `CaptainEarnings.jsx` | cabeçalho → `PageHeader`; cartões → `Card`; textos → tokens |
| `CaptainRidesHistory.jsx` | cabeçalho → `PageHeader`; cartões de corrida → `Card` |
| `CaptainProfile.jsx` | cabeçalho → `PageHeader` (com botão "Sair" no `rightSlot`); cartões → `Card`; linhas de info → `DetailRow` onde fizer sentido |
| `App.css` | apagado (resíduo do template Vite, não importado por ninguém) |

**`CaptainLogout.jsx` e `CaptainProtectWrapper.jsx`:** sem UI relevante pra migrar (redirecionam sem renderizar nada visível) — fora do escopo.

## Verificação

Build do frontend limpo + suíte de testes na baseline (`3 falhas | 4 passes`) + verificação visual ao vivo no navegador (login, home online/offline, popup de corrida, tela de corrida em andamento, carteira, ganhos, histórico, perfil) — comparando screenshots antes/depois pra confirmar que nada quebrou visualmente além da limpeza pretendida.

**Nada será commitado sem pedido explícito.**

---

## Detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

Migração aplicada exatamente como mapeada acima nos 13 arquivos (12 telas/componentes + `App.css` apagado). Pontos que exigiram decisão durante a execução, não previstos em detalhe no mapeamento original:

- **`RidePopUp`/`ConfirmRidePopUp`/`FinishRide`:** a alça de fechar manual (`<h5 onClick=...><i className="ri-arrow-down-wide-line"/></h5>`) foi removida dos três — o `BottomSheet` que passou a envolvê-los (em `CaptainHome.jsx` e `CaptainRiding.jsx`) já renderiza a própria alça via `onClose`, então a alça antiga virou duplicata morta.
- **`CaptainHome.jsx` e `CaptainRiding.jsx`:** os dois painéis GSAP (`useGSAP` + `useRef` + `gsap.to(...)`) viraram `<BottomSheet open={} onClose={}>`. Import de `gsap`/`@gsap/react` removido de `CaptainHome.jsx` (não sobrou nenhum uso). Em `CaptainRiding.jsx`, um `@keyframes slideDown` declarado mas nunca referenciado por nenhuma classe (confirmado por busca no arquivo inteiro) foi removido junto — código morto que só existia ao lado do painel GSAP que saiu.
- **`CaptainWallet.jsx`, `CaptainEarnings.jsx`:** o cabeçalho/cartão de destaque preto foi mantido preto de propósito (`bg-black`/`bg-ink-900`, conforme o plano já previa) — é uma escolha de ênfase visual pro contexto financeiro, não um resíduo do sistema antigo.
- **`rating` (`CaptainDetails.jsx`, `CaptainEarnings.jsx`):** mantido como estava — já discutido e decidido na Etapa 2 que não é dado fabricado.
- **`captain?.approvalStatus === 'approved'` (`CaptainProfile.jsx`):** o bug conhecido (compara com o valor errado; o enum real é em português) foi **deliberadamente preservado**, sem tocar na lógica — só a casca visual foi trocada por `StatusBadge`. Corrigir esse bug é escopo da Etapa 5 ("Aprovação e perfil"), não desta etapa.
- **`CaptainEarnings.jsx`, `CaptainRidesHistory.jsx`, `CaptainProfile.jsx`:** ganharam `PageHeader` (com seta de voltar) no lugar do título escrito à mão — não estava explicitamente pedido, mas é o padrão já estabelecido para essas subtelas e adiciona uma forma de navegação que não existia antes, sem custo. `CaptainProfile.jsx` usa o `rightSlot` do `PageHeader` pro botão "Sair".
- **`DetailRow` não foi usado em `CaptainProfile.jsx`:** avaliei encaixar as linhas "Tipo/Cor/Placa/Capacidade" no componente, mas a hierarquia visual de `DetailRow` (título em negrito à esquerda, texto secundário embaixo) é invertida em relação ao padrão "rótulo claro à esquerda, valor em negrito à direita" que essas linhas já usavam — forçar o componente trocaria o que é enfatizado visualmente sem necessidade. Mantidas como `flex justify-between` direto, só com os tokens novos.
- **Badges de status:** `CaptainWallet.jsx` (ATIVO/BLOQUEADO) e `CaptainProfile.jsx` (Aprovado/Pendente, Motorista Parceiro) passaram a usar `<StatusBadge tone="success|warning|danger">` no lugar de `<span>` com cor escrita à mão — encaixe direto, já que é exatamente o caso de uso que o componente foi feito para cobrir.

**Build:** `vite build` limpo, sem erros novos. **Testes:** suíte do frontend na mesma baseline de sempre (`3 falhas | 4 passes`).

**Verificação visual ao vivo** (Playwright, servidor de dev real, Atlas real, screenshots capturadas e inspecionadas uma a uma): login, cadastro (formulário completo, 4 seções), Home (online/offline, banner de GPS ausente com `Card`/tokens novos), carteira (badge `ATIVO`, modal de recarga), ganhos (`PageHeader` com seta de voltar, cartões `Card`), histórico, perfil (`PageHeader` com `rightSlot`, `StatusBadge` "Pendente" confirmando que o bug conhecido continua intacto), tela de corrida em andamento e o `BottomSheet` de finalizar corrida abrindo — a animação de abertura/fechamento do painel funciona de forma idêntica à versão GSAP anterior, confirmada visualmente (alça, transição suave, conteúdo correto).

**Nada foi commitado.**
