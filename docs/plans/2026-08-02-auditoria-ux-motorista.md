# Auditoria de UI/UX — App do Motorista (MoveCity)

**Data:** 2026-08-02
**Escopo:** todo o frontend do motorista (`frontend/src/modules/driver/`) + componentes compartilhados que ele consome.
**Método:** leitura integral dos 15 arquivos do módulo driver + UI kit compartilhado, com verificação cruzada contra o backend (models, rotas, services) sempre que a suspeita era de dado falso ou fluxo quebrado.
**Status:** relatório apenas. **Nenhum código foi alterado.**

---

## Sumário executivo

O app do passageiro passou por um redesign completo (commit `fd142b0`) que criou um design system em `tailwind.config.js` e um UI kit em `shared/components/ui/`. **O app do motorista não recebeu nada disso.** Ele é, literalmente, o código de antes do redesign.

Números que resumem a auditoria:

| Métrica | Motorista | Passageiro |
|---|---|---|
| Tokens do design system usados | **0** | 549 |
| Componentes do UI kit usados | **0** | 52 |
| Atributos `aria-*` | **0** | 104 |
| `htmlFor` em labels | **0** | 4 |
| Indicador de offline (`ConnectionBanner`) | **não** | sim |
| `EmptyState` / `Skeleton` | **não** | sim |

Mas o problema mais grave não é visual. São **três fluxos que não funcionam** e que o app apresenta como se funcionassem:

1. **Os documentos do cadastro são jogados fora.** O motorista fotografa CNH, CRLV e selfie, envia o cadastro, recebe "está em análise" — e nada disso sai do navegador.
2. **A tela de cobrança mostra o valor errado.** O motorista cobra do passageiro a estimativa, não o valor final recalculado.
3. **Sem GPS, o motorista fica invisível e o app não avisa.** Ele fica "Online, procurando corridas..." para sempre, sem receber nada.

Nenhum desses três é um problema de estética. São falhas de produto que custam dinheiro ao motorista e credibilidade à plataforma.

---

## 1. Primeira impressão

**Se um motorista abrisse este app hoje, a primeira coisa que ele veria seria a palavra `Loading...`** — em inglês, sem estilo, no canto superior esquerdo da tela branca ([CaptainProtectWrapper.jsx:40](../../frontend/src/modules/driver/pages/CaptainProtectWrapper.jsx#L40)). É o texto padrão de um `<div>` sem CSS. Isso aparece em toda abertura do app, antes de qualquer coisa.

> Nota de precisão: esse `Loading...` é idêntico no `UserProtectWrapper` do passageiro. É uma dívida compartilhada, não exclusiva do motorista — o redesign do passageiro também não a resolveu.

Depois disso, na Home, o que entrega amadorismo:

| O que ele vê | Por que parece protótipo |
|---|---|
| Seção **"Em Breve"** com 3 cards vazios de borda tracejada ([CaptainDetails.jsx:202-218](../../frontend/src/modules/driver/components/CaptainDetails.jsx#L202-L218)) | Nenhum app profissional entrega placeholders de funcionalidade não construída. É a definição visual de "obra em andamento". |
| **"+12% vs Ontem"** ao lado dos ganhos | Número inventado, fixo no código. Nunca muda. |
| **"Tempo médio de espera: 3 min"** | Idem — string fixa. |
| **"Meta do dia: ganhe bônus de R$ 30,00 · x/10 corridas"** | Meta inteira fabricada. Não existe no backend. O motorista pode bater a "meta" e não receber bônus nenhum. |
| 4 botões de **Ações Rápidas** (Carteira, Histórico, Corridas, Suporte) | **Nenhum tem `onClick`.** São decoração. O motorista toca e nada acontece. |
| `alert()` nativo do navegador ao tentar ficar online sem aprovação | Caixa cinza do sistema operacional, em um app que tem sistema de toast. |

**Transmite confiança?** Não. **Profissionalismo?** Não. **Estabilidade?** A Home tem um bug de React que pode derrubar a tela (§ 2.1). **Qualidade?** Os três números mais visíveis da tela principal — variação vs ontem, tempo de espera, meta do dia — são todos falsos.

---

## 2. Bugs que quebram a experiência

Estes não são questões de gosto. São defeitos verificados no código.

### 2.1 🔴 Violação das Regras dos Hooks na Home — risco de crash

[CaptainDetails.jsx:47-50](../../frontend/src/modules/driver/components/CaptainDetails.jsx#L47-L50):

```jsx
if (!captain) return null;          // ← early return

const [isOnline, setIsOnline] = useState(captain.isOnline || false);   // ← hooks DEPOIS
const [loadingToggle, setLoadingToggle] = useState(false);
```

Há dois `useState` **depois** de um `return` condicional. Quando `captain` vai de `null` para preenchido (exatamente o que acontece quando o perfil termina de carregar), o React renderiza mais hooks do que na render anterior e lança `Rendered more hooks than during the previous render`, derrubando a árvore.

- **Impacto:** tela branca na Home, no carregamento — o momento mais crítico.
- **Correção:** mover os dois `useState` para antes do `if (!captain)`.

### 2.2 🔴 Os documentos do cadastro nunca são enviados

[CaptainSignup.jsx:48](../../frontend/src/modules/driver/pages/CaptainSignup.jsx#L48) declara os 5 arquivos com o comentário `// Uploads (UI only)`, e [linha 68](../../frontend/src/modules/driver/pages/CaptainSignup.jsx#L68) confirma: *"Future integration note: Here we would typically upload the files"*.

Verificação cruzada:

- O frontend inteiro (`frontend/src/`) tem **zero** ocorrências de `FormData`, `multipart` ou `/uploads`.
- O backend **já tem tudo pronto**: `POST /uploads/document` e `POST /uploads/vehicle` autenticados como motorista ([upload.routes.js](../../Backend/routes/upload.routes.js)), e o model tem `documents.{cnhFront, cnhBack, crlv, selfie}` com `url` e `verified` ([captain.model.js:69-74](../../Backend/models/captain.model.js#L69-L74)).

Ou seja: o motorista tira as fotos, o app aceita, mostra "Selecionado: cnh.jpg", envia o cadastro e diz **"Cadastro enviado! Sua conta está em análise 🚀"** — e os arquivos morrem na memória do navegador. `documents.*.url` fica `''` para sempre.

- **Impacto:** **o onboarding do motorista não funciona.** Nenhum motorista consegue ser aprovado pelo fluxo do próprio app. O `approvalStatus` nunca sai de `iniciado` legitimamente.
- **Risco:** o motorista espera dias por uma aprovação que não pode acontecer. É o pior tipo de falha: silenciosa, e do lado de quem ainda nem começou a confiar na plataforma.
- **Prioridade:** máxima. É a porta de entrada do produto.

### 2.3 🔴 A tela de cobrança mostra o valor errado

[FinishRide.jsx](../../frontend/src/modules/driver/components/FinishRide.jsx) exibe `props.ride.fare` e `props.ride.commissionAmount` — os valores **estimados**, capturados antes da corrida.

Mas o backend, ao finalizar, recalcula e grava campos **diferentes** ([ride.service.js:394-413](../../Backend/services/ride.service.js#L394-L413)):

- grava `finalPrice` (não `fare` — `fare` permanece a estimativa);
- atualiza `commissionAmount`;
- **soma `waitTimeFeeCharged`** (taxa de espera) ao `finalPrice`.

E a mutation do frontend descarta a resposta: `onSuccess: () => { setEnded(true) }` — o `data` retornado, que traz a corrida atualizada, é ignorado.

- **Impacto financeiro direto:** o motorista cobra do passageiro o valor estimado. Se a distância real foi maior, ou se houve taxa de espera, **ele recebe menos do que deveria** e a diferença não aparece em lugar nenhum. O resumo "Você fica com R$ X" é calculado sobre números errados.
- **Correção:** usar a corrida devolvida pelo `end-ride` (`onSuccess: (data) => ...`) e exibir `finalPrice`, com linha explícita para taxa de espera quando houver.

### 2.4 🔴 "Cancelar" na corrida já aceita não cancela nada

[ConfirmRidePopUp.jsx:191-198](../../frontend/src/modules/driver/components/ConfirmRidePopUp.jsx#L191-L198): o botão "Cancelar" apenas fecha os dois painéis. Não chama endpoint nenhum.

Nesse ponto a corrida **já está aceita** e atribuída a esse motorista no banco.

- **Impacto:** o motorista acha que desistiu; o passageiro continua esperando um carro que não vem; a corrida fica pendurada no motorista (e, com o índice único de corrida ativa criado na auditoria de concorrência, **ele fica impedido de aceitar qualquer outra corrida** até que aquela seja resolvida).
- **Risco:** o motorista fica travado sem entender por quê, e o passageiro é abandonado sem aviso.

### 2.5 🔴 Sem GPS, o motorista fica invisível — e o app não avisa

O `LocationContext` detecta `PERMISSION_DENIED` e popula `locationError` ([LocationContext.jsx:46-52](../../frontend/src/contexts/LocationContext.jsx#L46-L52)). Esse estado é lido **exclusivamente** pelo `Home.jsx` do passageiro. O módulo do motorista nunca o consome.

O que acontece na prática quando o GPS é negado ou perdido:

1. `locationRef.current` fica `null`;
2. `updateLocation()` retorna cedo em silêncio ([CaptainHome.jsx:147](../../frontend/src/modules/driver/pages/CaptainHome.jsx#L147));
3. a posição do motorista para de ser atualizada no servidor;
4. ele deixa de aparecer no raio de despacho;
5. **a tela continua exibindo "Procurando corridas..." com o pontinho verde pulsando.**

- **Impacto:** o motorista fica horas online, sem receber nada, achando que não há demanda — enquanto o app mente ativamente sobre o estado dele.
- **Prioridade:** máxima. Para um app de mobilidade, GPS é a função vital.

### 2.6 🔴 Recarregar a página durante a corrida perde a corrida

[CaptainRiding.jsx:22](../../frontend/src/modules/driver/pages/CaptainRiding.jsx#L22): `const rideData = location.state?.ride`. É a **única** fonte da corrida. Não há busca da corrida ativa no servidor.

- **Impacto:** um refresh, uma queda do app, ou o sistema operacional matando a aba (comum em celular com o app em segundo plano por muito tempo) → `rideData` vira `undefined`, e a tela de corrida em andamento fica sem passageiro, sem destino, sem valor, com o mapa vazio. O motorista está com alguém no carro e o app perdeu a corrida.
- **Correção:** buscar a corrida ativa do motorista ao montar a tela, usando `location.state` apenas como otimização inicial.

### 2.7 🔴 Status de aprovação nunca é exibido corretamente

[CaptainProfile.jsx:63](../../frontend/src/modules/driver/pages/CaptainProfile.jsx#L63) compara `approvalStatus === 'approved'` (inglês). O enum do backend é em português e tem **7 estados** ([captain.model.js:55](../../Backend/models/captain.model.js#L55)):

```
['iniciado', 'documentos_enviados', 'em_analise', 'aprovado', 'reprovado', 'suspenso', 'bloqueado']
```

`'approved'` não casa com nenhum. Consequências:

- motorista **aprovado** vê "Pendente" (laranja) para sempre;
- motorista **reprovado**, **suspenso** ou **bloqueado** também vê apenas "Pendente" — o app nunca lhe diz que foi recusado ou suspenso, nem por quê.

### 2.8 🔴 Carteira: o motorista bloqueado não tem saída

Quando os créditos ficam negativos além do limite, o motorista é bloqueado para corridas. A tela oferece o CTA principal **"Adicionar Crédito (PIX)"** — que abre um modal dizendo *"Recarga temporariamente indisponível... Fale com o suporte"* ([CaptainWallet.jsx:201-204](../../frontend/src/modules/driver/pages/CaptainWallet.jsx#L201-L204)).

- **Impacto:** o motorista está impedido de trabalhar e o único caminho de volta que o app oferece é um beco sem saída. É honesto na mensagem, mas desonesto na hierarquia: o botão mais destacado da tela não faz o que promete.
- Além disso, a regra de bloqueio está **duplicada e fixa no frontend** (`creditBalance <= -20`, com o próprio comentário admitindo "threshold provisório no front"). Se o backend mudar o limite, a UI passa a mentir sobre o status.

### 2.9 🔴 O popup de corrida não tem contador de tempo

[RidePopUp.jsx](../../frontend/src/modules/driver/components/RidePopUp.jsx) — o momento mais importante do app inteiro — **não tem countdown, não tem barra de tempo, não expira sozinho.**

Em Uber, 99 e inDrive existe um anel/barra de contagem regressiva. Aqui o popup fica aberto indefinidamente. O motorista não tem noção de urgência, e se outro motorista aceitar antes, ele só descobre pelo evento `ride-taken` (que passou a ser tratado só agora, na auditoria de concorrência).

### 2.10 🔴 Falta a informação que decide o aceite; e há um "2.2 KM" inventado

No `RidePopUp`, a distância exibida é `estimatedDistance` — a distância **da corrida**. Ela aparece **duas vezes** (canto superior direito e de novo entre parênteses no tempo estimado).

**A distância até o passageiro — o número que de fato decide se vale a pena aceitar — não é exibida em lugar nenhum.** É a primeira informação que Uber e 99 mostram ("3 min · 1,2 km de você").

Pior: no `ConfirmRidePopUp`, a distância vem de `props.ride?.distance` com fallback `: '2.2'` ([linha 101](../../frontend/src/modules/driver/components/ConfirmRidePopUp.jsx#L101)). Verifiquei no backend: `distance` está marcado como **"Deprecated"** no schema e **nunca é escrito** por nenhum service. Portanto a condição é sempre falsa e **todo motorista, em toda corrida, vê o número fixo "2.2 KM"**.

O mesmo campo morto é usado em [CaptainRiding.jsx:217](../../frontend/src/modules/driver/pages/CaptainRiding.jsx#L217), onde cai no texto genérico "A caminho".

### 2.11 🔴 Ações Rápidas são botões falsos

Os 4 atalhos da Home (Carteira, Histórico, Corridas, Suporte) não têm handler nenhum ([CaptainDetails.jsx:175-198](../../frontend/src/modules/driver/components/CaptainDetails.jsx#L175-L198)). As rotas existem. Os botões simplesmente não navegam.

### 2.12 🟡 `FileInput` declarado dentro do componente

[CaptainSignup.jsx:119](../../frontend/src/modules/driver/pages/CaptainSignup.jsx#L119) define o componente `FileInput` **dentro** de `CaptainSignup`. A cada tecla digitada em qualquer campo do formulário, o React recria o tipo do componente e **desmonta/remonta os 5 inputs de arquivo**, perdendo foco e podendo limpar a seleção. Anti-padrão clássico de React com impacto real de uso.

### 2.13 🟡 Histórico transforma erro de rede em "você não tem corridas"

[CaptainRidesHistory.jsx:13](../../frontend/src/modules/driver/pages/CaptainRidesHistory.jsx#L13): `.catch(() => null)` engole qualquer falha e o componente cai no estado vazio — *"Você ainda não realizou nenhuma corrida."*

Um motorista com 300 corridas, offline ou com o servidor fora, lê que nunca dirigiu. Não há estado de erro nem botão de tentar de novo.

### 2.14 🟡 Métrica de desempenho fabricada

[CaptainEarnings.jsx:40](../../frontend/src/modules/driver/pages/CaptainEarnings.jsx#L40) exibe "Taxa de Aceitação" com `captain?.acceptanceRate || 100`.

Busquei no backend inteiro: `acceptanceRate` existe no model e é **lido** com fallback `|| 100` no controller, mas **nunca é calculado nem gravado por nenhum service**. A barra mostra permanentemente **100%**.

(Por contraste, `cancellationRate` **é** calculado de verdade em [captain.service.js:102](../../Backend/services/captain.service.js#L102) — então o problema é específico e pontual.)

O mesmo padrão aparece em `rating?.toFixed(1) || '5.0'`: motorista sem nenhuma avaliação exibe **5,0 estrelas**.

### 2.15 🟡 Barra de navegação por cima do modal

`CaptainHeader` é `z-[60]`; o modal de recarga da Carteira é `z-50` e cobre a tela com `bg-black/60`. Resultado: **a barra de navegação fica flutuando por cima do escurecimento do modal**, e continua clicável.

---

## 3. Hierarquia visual

A Home do motorista tem **seis blocos competindo pelo mesmo nível de atenção**: cabeçalho de perfil, card de status online, card de ganhos, card de meta, grade de atalhos e a faixa "Em Breve".

Problemas concretos:

- **O card de ganhos usa `text-4xl font-black`** — a maior tipografia da tela. Mas a ação principal do motorista offline é **ficar online**, não conferir ganhos. O elemento mais pesado visualmente não é o mais importante.
- **Três cores fortes disputam:** verde (status), azul (meta + carteira), amarelo (borda do avatar). Sem hierarquia semântica — o azul da "Meta" (dado fabricado) tem o mesmo peso visual da Carteira (dado real e crítico).
- **Emojis como ícones** (💰 🎯) misturados com Remix Icons — duas linguagens de ícone na mesma tela.
- **Sombra em quase tudo:** `shadow-lg`, `shadow-sm`, `shadow-md`, `shadow-inner`, `shadow-green-200`, `shadow-gray-200`. Quando tudo tem elevação, nada se destaca.
- A faixa **"Em Breve"** ocupa espaço nobre abaixo da dobra com `opacity-60` — o app dedica área a algo que não existe.

**O botão principal parece principal?** Não. "Ficar Online" é um botão pequeno, encaixado à direita dentro do card de status, competindo com o texto ao lado. Deveria ser o elemento dominante da tela quando offline.

---

## 4. Fluxo do motorista

Auditando a jornada pedida, etapa por etapa:

| Etapa | Estado | Observação |
|---|---|---|
| Login | 🟡 | Sem "esqueci a senha", sem mostrar/ocultar senha, sem estado de carregamento no botão. Limpa e-mail **e** senha mesmo quando o login falha — o motorista redigita tudo. |
| Cadastro | 🔴 | Formulário único com ~25 campos + 5 uploads, sem etapas, sem progresso, sem salvar rascunho. **Documentos descartados** (§2.2). Sem máscara de CPF/telefone/placa. Sem confirmação de senha. Sem aceite de termos da MoveCity. Declara proteção por **reCAPTCHA que não existe** no código. |
| Aprovação | 🔴 | **Não existe tela.** O motorista com cadastro pendente entra direto na Home completa e só descobre a restrição ao tocar em "Ficar Online" e receber um `alert()`. Os 7 estados de aprovação são reduzidos a "Pendente" (§2.7). |
| Ficar Online | 🟡 | Funciona, mas o estado é local e nunca ressincroniza com o contexto. Sem feedback de GPS ausente (§2.5). |
| Esperar corrida | 🟡 | "Procurando corridas..." pode ser mentira (§2.5). Sem indicador de conexão. |
| Receber corrida | 🔴 | Sem contador (§2.9), sem distância até o passageiro (§2.10), preço em faixa (`min - max`) em vez de valor, sem categoria do veículo. |
| Aceitar | 🟡 | O botão dispara `setConfirmRidePopupPanel(true)` **antes** da resposta da API. Num 409 (outro motorista pegou), o `catch` fecha o popup de oferta mas **não fecha o painel de confirmação já aberto** → o motorista vê a tela de confirmação com a corrida zerada. |
| Ir até o passageiro | 🔴 | **Sem botão de navegação** (Waze/Google Maps) e **sem botão de ligar** para o passageiro. Só existe chat, e só depois de iniciar a corrida. |
| Chegada / PIN | 🟡 | O progresso (`rideStatus`) é estado local iniciado em `'accepted'`: se a tela remontar, volta para "A caminho" mesmo que o servidor já registre "cheguei". Mensagens de erro em **inglês** ("Invalid OTP. Please try again."). |
| Corrida em andamento | 🔴 | **O destino não aparece na barra inferior** — só passageiro, veículo e valor. Para ver para onde está indo, o motorista precisa abrir o painel. Sem navegação, sem ligar. Refresh perde tudo (§2.6). |
| Finalizar | 🔴 | Valor errado (§2.3). Linguagem de dinheiro em espécie ("Receba o dinheiro do passageiro") exibida **mesmo quando o pagamento é cartão, PIX ou carteira**. |
| Avaliação | 🔴 | **Não existe.** O motorista nunca avalia o passageiro, embora `reviewApi.js` exista no projeto. |
| Nova corrida | 🟡 | Redireciona por `setTimeout` de 2,5 s sem possibilidade de pular. |

**Cliques desnecessários:** para ver o destino durante a corrida são 2 toques (abrir painel + ler); para chegar à Carteira pela Home, os atalhos não funcionam (§2.11), então é preciso usar a barra superior.

---

## 5. Sistema de design e componentização

O design system **já existe** — foi criado na auditoria anterior e está em [tailwind.config.js](../../frontend/tailwind.config.js): tokens `brand`, `ink`, `surface`, `line`, `danger`, elevação em 3 níveis (`raised`, `floating`), raio `panel`, escala de `z-index` (`base/panel/overlay/modal`).

E o UI kit existe: `Button`, `Card`, `PageHeader`, `EmptyState`, `Skeleton`, `StatusBadge`, `DetailRow`, `BottomSheet`, `ConnectionBanner`, `SelectableOptionCard`.

**O módulo do motorista não usa nada disso.** Consequências medidas:

- **9 reimplementações** do botão verde primário, com `shadow-lg shadow-green-500/20` copiado em 6 arquivos;
- **6 raios de borda diferentes** em uso (`rounded-xl` 52×, `rounded-full` 29×, `rounded-2xl` 22×, além de `md`, `lg`, `t`);
- **7 valores de z-index**, incluindo `z-[60]` e `z-[70]` que furam a escala do sistema (cujo topo é `z-modal: 50`) e causam o bug §2.15;
- **3 bottom sheets feitos à mão** com GSAP, enquanto o componente `BottomSheet` compartilhado existe e **não é usado por ninguém** — nem pelo passageiro. É código morto.
- **2 padrões de loading diferentes dentro do mesmo arquivo** (`ConfirmRidePopUp` troca o texto do botão em um caso e mostra um SVG spinner em outro).

Componentes que deveriam existir e não existem (todos derivados de repetição real encontrada no módulo):

`RideOfferCard` (com countdown) · `RideProgressBar` · `MoneyRow` · `StatCard` · `TransactionRow` · `DocumentUploadField` · `OnlineToggle` · `ApprovalGate` · `NavigateButton` · `CallButton`

Além disso, [App.css](../../frontend/src/App.css) ainda é o **CSS padrão do template do Vite** (logo girando, `.read-the-docs`), não importado por ninguém — resíduo que deveria ser removido.

---

## 6. Estados vazios, carregamento e erro

| Estado | Situação |
|---|---|
| Sem corridas no histórico | 🟡 existe, mas feito à mão e **também usado para erro de rede** (§2.13) |
| Sem transações na carteira | 🟡 texto solto, sem ilustração ou ação |
| Sem ganhos | 🔴 não existe — mostra R$ 0,00 e barras zeradas como se fosse dado real |
| Sem internet | 🔴 **não existe** no motorista (`ConnectionBanner` só no passageiro) — apesar de ser justamente ele quem tem fila offline |
| Sem GPS | 🔴 **não existe** (§2.5) |
| Aguardando aprovação | 🔴 **não existe** (§2.7) |
| Conta bloqueada/reprovada | 🔴 **não existe** — nem no perfil, nem como bloqueio de acesso |
| Sem notificações | 🔴 não há tela de notificações |
| Carregando (geral) | 🔴 `Loading...`, `Carregando...`, `'...'` e um spinner — quatro tratamentos diferentes, nenhum usando o `Skeleton` disponível |
| Erro de servidor/rede | 🔴 nenhuma tela tem estado de erro com retry; o mapa registra 3 tipos de falha apenas em `console.error` |

O `LiveTracking` — componente central da experiência — trata falha de geocoding, de rota e de inicialização do provider **só com `console.error`**. Para o motorista, o mapa simplesmente fica vazio, sem explicação e sem botão de tentar de novo.

---

## 7. Acessibilidade

| Critério | Resultado |
|---|---|
| Atributos `aria-*` | **0 em todo o módulo** (passageiro: 104) |
| Labels associados a inputs | **0 `htmlFor`** — no login, os rótulos são `<h3>` soltos; leitores de tela não anunciam o campo |
| `type="button"` em botões | 1 de 21 — os outros 20 assumem `type="submit"`, risco de submit acidental dentro de formulários |
| Elementos interativos não-semânticos | 3 (`<h5 onClick>`, `<div onClick>`) — não recebem foco por teclado |
| Tipografia abaixo de 12px | **26 ocorrências** (20× `10px`, 4× `11px`, 2× `9px`) |
| Alvos de toque < 44px | 8 (`h-10 w-10` = 40px, `h-8 w-8` = 32px, checkbox `w-5 h-5` = 20px) |
| Contraste | `text-gray-400` sobre branco (≈2.8:1) e `text-gray-500` em 9-10px reprovam no AA |
| `autoComplete` em login | ausente — quebra gerenciadores de senha |

Para um público que frequentemente tem 40+ anos e opera o app **dentro de um carro, sob sol, em movimento**, textos de 9px e alvos de 32px não são detalhe: são a diferença entre usar e não usar.

---

## 8. Comparação com Uber Driver, 99 e inDrive

| Dimensão | MoveCity hoje | Padrão do mercado |
|---|---|---|
| Decisão de aceite | Sem contador, sem distância até o passageiro, preço em faixa | Countdown visível, "X min de você", valor único e destacado |
| Navegação | **Inexistente** | Botão dedicado abrindo Waze/Google Maps em 1 toque |
| Contato com passageiro | Só chat, só após iniciar | Ligar + mensagem desde o aceite, com número mascarado |
| Destino durante a corrida | Escondido atrás de um toque | Sempre visível na barra inferior |
| Ganhos | Um total acumulado, sem recorte temporal | Dia/semana/mês, gráfico, detalhe por corrida |
| Onboarding | Formulário único, documentos descartados | Multi-etapas, progresso salvo, status de cada documento |
| Recuperação de falha | Refresh perde a corrida | Estado sempre reidratado do servidor |
| Modo noturno | Não existe | Padrão (motorista dirige à noite) |

Onde ainda parece protótipo: **placeholders "Em Breve" em produção, métricas fabricadas, botões sem ação, documentos que não sobem, e um `Loading...` sem estilo como cartão de visitas.**

---

## 9. Plano de implementação sugerido

Etapas independentes, incrementais, sem tocar em API, backend ou regra de negócio (salvo onde marcado), cada uma testável isoladamente:

| # | Etapa | Conteúdo | Risco |
|---|---|---|---|
| **1** | **Correções que quebram o produto** | §2.1 hooks, §2.2 upload de documentos, §2.3 valor final, §2.4 cancelar de verdade, §2.5 aviso de GPS, §2.6 reidratar corrida | Médio — §2.2 e §2.4 tocam integração; os demais são frontend puro |
| **2** | **Remover o falso** | Excluir "Em Breve", "+12% vs Ontem", "3 min", "Meta do dia", `'2.2'`, `|| 100`, `|| '5.0'`; ligar os 4 atalhos; trocar `alert()` por toast | Baixo — só remoção e ligação de rotas |
| **3** | **Adotar o design system** | Migrar as 15 telas para tokens + UI kit; padronizar raio, sombra e z-index; adotar `BottomSheet`; apagar `App.css` | Baixo — visual, sem lógica |
| **4** | **Estados** | `EmptyState`/`Skeleton` em todas as telas; separar erro de vazio no histórico; `ConnectionBanner`; erro com retry no mapa | Baixo |
| **5** | **Aprovação e perfil** | Tela de aprovação com os 7 estados; gate de acesso; status por documento; edição de perfil/foto | Médio |
| **6** | **Tela de oferta** | Countdown, distância até o passageiro, valor único, categoria; corrigir a corrida do painel no 409 | Médio |
| **7** | **Em corrida** | Destino sempre visível, botão de navegação, botão de ligar, avaliação do passageiro | Médio |
| **8** | **Ganhos** | Recorte diário/semanal/mensal, detalhe por corrida com comissão e líquido | Médio — pode exigir endpoint novo |
| **9** | **Acessibilidade** | `aria-*`, `htmlFor`, `type="button"`, mínimo de 12px, alvos de 44px, contraste | Baixo |

Recomendo executar **1 e 2 juntas e primeiro**: são as que separam "protótipo" de "produto", e a etapa 2 é quase toda subtração — o melhor retorno por risco de todo o plano.

---

## 10. Notas

| Área | Nota | Justificativa |
|---|---|---|
| Visual | **4,5** | Base competente (verde consistente, cards limpos), destruída por placeholders, emojis, 6 raios e sombra em tudo |
| UX | **3,0** | Fluxos centrais quebrados: onboarding, cancelamento, valor final, GPS silencioso |
| Clareza | **4,0** | Boa redação em pontos isolados (carteira), mas jargão ("Ledger", "Saldo Ant") e dados falsos corroem a confiança |
| Consistência | **2,5** | 9 botões reimplementados, 4 padrões de loading, 2 idiomas, 7 z-index |
| Performance percebida | **4,0** | GSAP fluido e React Query bem usados; derrubado por `Loading...` cru e ausência de skeletons |
| Acessibilidade | **1,5** | 0 `aria`, 0 `htmlFor`, 26 textos < 12px, 8 alvos < 44px |
| Organização | **5,0** | Estrutura de pastas boa (herdada da refatoração modular); o conteúdo é que não acompanhou |
| Design System | **2,0** | Existe e é bom — e o motorista usa **0%** dele |
| Componentização | **2,0** | Nenhum componente compartilhado; duplicação medida em 9 botões e 3 bottom sheets |
| Escalabilidade da interface | **3,0** | Adicionar uma tela hoje significa recopiar classes; sem base comum não escala |

**Média: 3,15 / 10**

---

## 11. Resposta final

> **"Eu colocaria esta experiência de motorista para competir com Uber e 99 hoje?"**

**Não.**

E o motivo não é estética — é que **três fluxos essenciais não funcionam**, e o app não admite nenhum deles:

1. **Um motorista não consegue se cadastrar de verdade.** Os documentos são descartados silenciosamente; a aprovação é impossível pelo fluxo do próprio app.
2. **Um motorista pode cobrar o valor errado** ao final de cada corrida, perdendo a diferença de distância real e a taxa de espera.
3. **Um motorista sem GPS fica invisível** e o app segue afirmando que está procurando corridas.

Somando: um motorista que consiga entrar não tem como navegar até o passageiro, não tem como ligar para ele, não vê o destino enquanto dirige, não sabe quanto ganhou hoje, perde a corrida se recarregar a tela, e vê "Pendente" no perfil mesmo aprovado.

**O que impede o nível profissional, em ordem:**

1. Documentos do cadastro descartados (§2.2)
2. Valor final incorreto na cobrança (§2.3)
3. GPS negado sem aviso (§2.5)
4. Bug de hooks na Home (§2.1)
5. "Cancelar" que não cancela (§2.4)
6. Corrida perdida no refresh (§2.6)
7. Sem navegação e sem ligar para o passageiro (§4)
8. Sem contador e sem distância até o passageiro na oferta (§2.9, §2.10)
9. Dados fabricados na tela principal (§1, §2.14)
10. Zero adoção do design system existente (§5)

**A boa notícia:** a fundação está pronta e paga. O design system existe, o UI kit existe, a arquitetura modular existe, o backend de upload existe, o `reviewApi` existe, o `BottomSheet` existe. O trabalho aqui é majoritariamente **conectar e adotar o que já foi construído** — e **remover o que é falso**. As etapas 1 e 2 do plano, sozinhas, tiram o app da categoria "protótipo".
