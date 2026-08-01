# Redesign de UI/UX — Frontend do Passageiro

**Data:** 2026-08-01
**Escopo:** `frontend/src/modules/passenger/*`, `frontend/src/shared/components/*` (LiveTracking, RideChat), telas de auth do passageiro
**Natureza:** auditoria visual + plano de redesign incremental. **Nenhum código alterado ainda.**
**Fora de escopo:** lógica de negócio, integrações (backend/mapas/socket/auth), app do motorista, painel admin.

---

## 0. Metodologia

Li o frontend inteiro do passageiro com foco visual (não lógico): `Home.jsx`, `VehiclePanel.jsx`, `ConfirmRide.jsx`, `LocationSearchPanel.jsx`, `LookingForDriver.jsx`, `WaitingForDriver.jsx`, `OptionalsPanel.jsx`, `PaymentOptionsPanel.jsx`, `ScheduleRidePanel.jsx`, `Riding.jsx`, `Activity.jsx`, `Header.jsx`, `Account.jsx` + as 10 subpáginas de conta, `UserLogin.jsx`, `UserSignup.jsx`, `Start.jsx`, `LiveTracking.jsx`. Também `tailwind.config.js` e `index.css` (para entender que sistema de tokens existe hoje — resposta: nenhum).

Para não confiar só em impressão, contei o uso real de classes no código:

| Métrica | Resultado |
|---|---|
| Variações de `shadow-*` distintas em uso | **11** (`shadow-sm`, `shadow-lg`, `shadow-md`, `shadow-xl`, `shadow-2xl`, `shadow-green-500/20`, `shadow-green-500/30`, + 4 sombras arbitrárias `shadow-[...]` escritas à mão, cada uma com valores diferentes) |
| Variações de `rounded-*` distintas | **9** (`rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-full`, `rounded-md`, `rounded-t`, `rounded-tl`, `rounded-tr`, `rounded-b`) |
| Valores de `z-*` distintos em uso simultâneo | **11** (`z-10, z-20, z-30, z-40, z-50, z-[60], z-[70], z-[100], z-[9999]`, sem nenhuma convenção de camadas) |
| Tons de verde (`bg/text/border-green-NNN`) distintos | **9** tons (`50, 100, 200, 300, 400, 500, 600, 700` + variações) usados sem regra clara de quando usar qual |
| Tokens de design customizados no `tailwind.config.js` | **0** — é o config default do Tailwind, sem `theme.extend` |

Essa dispersão não é estilo, é ausência de sistema — cada tela reinventa sombra, raio e tom de verde na hora.

---

## 1. Diagnóstico geral — "o que entrega amador primeiro"

Respondendo direto à pergunta do briefing — se esse app fosse lançado hoje, estes 6 pontos entregariam em 3 segundos que não é um produto maduro:

1. **Zero sistema de design.** Não existe um arquivo de tokens (cor, espaçamento, sombra, raio) em lugar nenhum. Toda tela escolhe sombra e verde na hora. Isso é o que mais sinaliza "protótipo" — apps como Uber/Airbnb têm uma paleta e uma escala de elevação fechadas, aplicadas sem exceção.
2. **Sombras demais, decidindo por peso e não por hierarquia.** Contei 11 variações. Botões primários, cards de sugestão, painéis inteiros e até o pino do mapa (`RidePopUp`... não, isso é motorista — no passageiro: `VehiclePanel`, `ConfirmRide`) usam sombra "porque sim". Sombra deveria significar uma coisa só: "isto está flutuando sobre o resto". Hoje significa "eu quis destacar".
3. **Divs decorativas sem função.** Cada tela do fluxo de corrida (`VehiclePanel`, `ConfirmRide`, `LookingForDriver`, `WaitingForDriver`) repete a mesma estrutura copiada e colada: alça cinza no topo (`<div className="w-12 h-1.5 bg-...">`), depois um `<div className='flex items-center gap-5 p-3 border-b'>` por linha de informação, com um `<i>` de ícone dentro de um wrapper. É a mesma UI escrita 4 vezes com pequenas variações, em vez de 1 componente reutilizado 4 vezes.
4. **Strings em inglês misturadas com português.** `LiveTracking.jsx` mostra "Captain heading to pickup" / "Ride in progress" no HUD do mapa — a única coisa em inglês no app inteiro. Isso é o tipo de detalhe que mais grita "não foi revisado antes de lançar".
5. **Imagens de terceiros hotlinkadas.** O ícone do Google no login vem de `svgrepo.com` ao vivo (`UserLogin.jsx:127`) — mesma categoria de problema já corrigido em outros lugares do app (avatares, logo do Pix) na auditoria de integração. Um app "pronto" empacota os próprios ícones.
6. **Bug funcional escondido atrás da poluição visual**: o HUD de progresso da corrida no mapa (`LiveTracking.jsx:463-467`) só aparece quando `ride.status === 'accepted'` ou `'ongoing'` — mas o status real da corrida em andamento é `'started'`, não `'ongoing'` (esse valor não existe no enum do backend). Resultado: **o card com "X km restantes" nunca aparece durante a viagem de verdade**, só durante o trajeto até o embarque. Ninguém percebeu porque a tela "parece" estar funcionando (mapa, marcador e rota continuam funcionando por fora do HUD). Vou corrigir isso junto do redesign dessa tela, já que estarei mexendo no componente de qualquer forma — é uma correção de uma linha, não uma mudança de escopo.

---

## 2. Fluxo tela a tela

### 2.1 Tela inicial (`Home.jsx`, estado fechado)

**O que existe:** saudação por horário + nome, um pill "Buscar destino" com ícone de lupa, mapa full-bleed atrás.

**Problemas:**
- A saudação (`text-2xl font-bold`) compete em peso visual com o campo de busca logo abaixo — na hierarquia real, o campo "Para onde?" é a ação primária da tela, a saudação é só contexto. Hoje os dois brigam pelo mesmo nível de atenção.
- O pill de busca (`bg-gray-50 border border-gray-200 px-5 py-4 rounded-full`) não parece clicável o suficiente — é visualmente idêntico a um card informativo. Falta um afordance mais forte de "isto é uma busca" (ex: usar o padrão de campo de input real do Uber/99 — barra branca elevada sobre o mapa, não um pill dentro de um painel branco).
- O painel branco que contém a saudação + busca (`bg-white ... rounded-t-3xl shadow-2xl`) some completo o mapa por baixo em telas pequenas, deixando pouco "ar" para o usuário ver onde está.
- Não há nenhuma indicação de localização atual em texto (bairro/rua) na tela fechada — só o pino no mapa. Apps de referência mostram "Você está em: Rua X" como parte do contexto inicial.

### 2.2 Escolha de destino (`Home.jsx` painel aberto + `LocationSearchPanel.jsx`)

**Problemas:**
- Os campos de partida/destino usam uma timeline de bolinhas + linha vertical feita com posicionamento absoluto manual (`Home.jsx:572-577`) — funciona, mas é frágil (qualquer mudança de altura de texto desalinha) e visualmente pesada para o que devia ser um detalhe fino.
- O botão de GPS ("usar minha localização") fica sobreposto dentro do campo de partida com posicionamento absoluto (`Home.jsx:594-605`) — em telas estreitas ele fica muito perto do texto digitado, risco real de sobreposição com endereços longos.
- Cada sugestão de endereço (`LocationSearchPanel.jsx:71-79`) é sólida e limpa — esse é o componente mais próximo do padrão desejado hoje. Vale usar como referência de "linha de lista" para o resto do app.
- Item "Escolher no mapa" está com o mesmo peso visual dos resultados de busca, mas é uma ação diferente (não é um resultado, é um modo alternativo) — merece separação mais clara (hoje só tem uma borda-top).

### 2.3 Visualização do mapa e seleção manual (`LiveTracking.jsx`)

**Problemas:**
- HUD do topo com bug de status (ver §1.6).
- Strings em inglês (ver §1.4).
- Botão de recentralizar (GPS) muda de cor (branco → azul) para indicar "seguindo" — mas essa é a única ocorrência de azul em todo o app, que é majoritariamente verde. Um tom fora da paleta para comunicar um único estado é inconsistência de paleta, não hierarquia.
- Pino de seleção manual no centro do mapa é o elemento mais bem executado de toda a base (ícone + sombra de "pouso" sutil) — mantido como está.

### 2.4 Escolha de veículo (`VehiclePanel.jsx`)

**Problemas:**
- 3 cards empilhados, cada um com borda + fundo cinza + ícone + texto + preço — estrutura correta, mas sem estado "selecionado" visualmente forte: o clique já dispara navegação para o próximo painel, então o usuário nunca *vê* qual categoria escolheu antes de confirmar (só descobre na tela seguinte). Um padrão mais confiável (Uber/99) é: tocar seleciona e destaca o card, um botão "Confirmar" separado avança.
- Preço mostrado como `R$X` fixo (o intervalo "R$X - R$Y" já foi removido na auditoria de integração porque era sempre igual) — hoje é só o número, o que é bom, mas está pequeno (`text-lg`) em relação ao resto do card. Preço é a informação que mais pesa na decisão do usuário e deveria ter mais destaque tipográfico, não menos.
- Cada card tem sua própria sombra/borda reinventada em vez de usar um componente `<VehicleOptionCard>` reutilizável — isso também é o que torna a tela sujeita a inconsistência quando uma 4ª categoria for adicionada (o admin já suporta categorias dinâmicas ilimitadas desde a auditoria de integração).

### 2.5 Confirmação da corrida (`ConfirmRide.jsx`)

**Problemas:**
- Boa estrutura de informação (veículo, opcionais, origem/destino, pagamento, preço) mas tudo dentro de um único bloco sem nenhuma separação de "grupos" — 5 blocos de conteúdo diferentes (veículo, trajeto, pagamento, preço, botão) com a mesma hierarquia visual de `border-b border-gray-100`. Falta um agrupamento (ex: trajeto num cartão, pagamento+preço noutro) para o olho escanear mais rápido.
- Botão "Confirmar Corrida" é bom (verde cheio, largura total) — esse é o padrão certo de CTA primário, vale replicar em todo o app (hoje cada tela escreve as classes do botão do zero, ligeiramente diferentes cada vez — ver §3).

### 2.6 Buscando motorista / Motorista a caminho (`LookingForDriver.jsx`, `WaitingForDriver.jsx`)

**Problemas:**
- Animação de busca (`LookingForDriver.jsx:22-28`, círculos com `animate-ping` sobrepostos) é o elemento mais "vivo" do app hoje — bom instinto de produto (dar feedback de que algo está acontecendo). Mantido, só ajustado à nova paleta.
- Painel "Motorista encontrado" mistura informação crítica (PIN de segurança, destacado corretamente em verde) com informação de rotina (endereço, placa) no mesmo nível de cartão — o PIN merece estar visualmente "resolvido" primeiro, o resto pode ser secundário/colapsável.
- De novo: 4 blocos com `border-b` reinventados em vez de um componente de "linha de detalhe de corrida" compartilhado entre estas duas telas + `ConfirmRide.jsx` + `Riding.jsx` (as 4 telas mostram basicamente os mesmos dados: pickup, destino, preço).

### 2.7 Durante a corrida (`Riding.jsx`)

**Problemas:**
- Mapa ocupa exatamente metade da tela (`h-1/2`) fixo — em telas mais altas (a maioria dos Android modernos) isso deixa uma faixa enorme de informação estática abaixo que poderia ceder mais espaço ao mapa, que é a informação mais importante durante o trajeto.
- Bom trabalho recente (Sprint 2 da auditoria de integração) tornando o fluxo de pagamento/avaliação honesto — vou preservar 100% dessa lógica, só reorganizar visualmente os 3 passos do modal (`payment → rating → done`) que hoje têm 3 layouts levemente diferentes entre si.
- Botões flutuantes de chat/home no canto (`fixed right-2 top-2`) usam sombra padrão do Tailwind (`shadow`) — o único lugar do app que usa essa sombra genérica em vez de uma das 11 variantes "customizadas" do resto do app. Inconsistência pontual, fácil de unificar.

### 2.8 Histórico (`Activity.jsx`)

**Problemas:**
- Tela funcionalmente completa (paginação, busca, filtro) mas cada corrida no histórico é um outro card reinventado — quarta ou quinta reimplementação do "cartão de linha com ícone + texto + valor" que já vi em `LocationSearchPanel`, `VehiclePanel`, `ConfirmRide`.
- Filtro de status em pills horizontais — correto como padrão, mas sem estado ativo visualmente forte além da cor (deveria ter peso de fonte ou fundo mais decisivo).

### 2.9 Perfil / Conta (`Account.jsx` + subpáginas)

**Problemas:**
- `Account.jsx` já foi simplificado na auditoria de integração (itens sem backend real escondidos). O que resta (Meus dados, Ajuda, Sair) está limpo — bom ponto de partida, não precisa de grande intervenção estrutural, só herdar os novos tokens.
- As subpáginas restantes (`Profile`, `PersonalData`, `ChangePassword`, `Help`, `Privacy`, `Terms`) repetem o mesmo header "seta-voltar + título" com classes escritas à mão em cada arquivo — candidato óbvio a virar 1 componente (`<AccountPageHeader title="..."/>`).

### 2.10 Autenticação (`UserLogin.jsx`, `UserSignup.jsx`, `Start.jsx`)

**Problemas:**
- Estrutura já é a mais limpa do app (poucos elementos, boa hierarquia, campos grandes fáceis de tocar). O único problema real é o ícone do Google hotlinkado (§1.5) e usar os novos tokens de botão/input.
- `Start.jsx` tem uma imagem de fundo full-bleed no mobile e volta para fundo branco só no desktop — mistura de estratégias que vale simplificar, mas é a tela de menor prioridade (é vista uma vez, antes do login).

---

## 3. Por que "trocar cor" não resolve — e o que resolve

O pedido é explícito para não ser só recolorir. O problema real não é a cor verde em si (ela é uma escolha de marca razoável, mantida), é que:

1. **Não existe vocabulário compartilhado.** Todo componente decide sozinho quanto de sombra, raio e espaçamento usar. A correção é criar esse vocabulário uma vez (tokens no Tailwind + 6-8 componentes primitivos) e fazer todo o resto do app *herdar* dele — não redesenhar tela por tela com valores soltos de novo.
2. **Repetição de estrutura sem reuso de componente.** As mesmas 4-5 "formas" de UI (linha de detalhe com ícone, card de opção selecionável, botão primário/secundário, cabeçalho de página com voltar, badge de status) aparecem dezenas de vezes copiadas manualmente. Consolidar isso é o que realmente muda a sensação de "produto" vs "protótipo" — não a paleta.
3. **Hierarquia por peso, não por decoração.** Hoje quase tudo tem sombra e borda ao mesmo tempo. Um sistema com escala de elevação (0 a 3 níveis, não 11) força a decidir *o que* realmente precisa se destacar — normalmente só o CTA primário e os cartões que flutuam sobre o mapa.

---

## 4. Sistema de design proposto

Tudo isto entra em `tailwind.config.js` (`theme.extend`) — hoje vazio — para existir num único lugar e ser consumido, não redigitado.

### 4.1 Cor
Mantendo verde como cor de marca (já reconhecível, já no logo), mas reduzindo de 9 tons soltos para uma escala com papel definido:

| Token | Uso |
|---|---|
| `brand-500` (verde atual ~#22c55e) | Ações primárias, seleção ativa, ícones de destaque |
| `brand-600` | Hover/active de botão primário |
| `brand-50` | Fundo de estado selecionado/sucesso sutil |
| `ink-900 / ink-600 / ink-400` | Texto principal / secundário / desabilitado (substitui a mistura atual de `gray-800`, `gray-700`, `gray-600`, `gray-500` usados sem critério) |
| `surface / surface-alt` | Fundo de página / fundo de cartão elevado |
| `line` | Um único tom de borda (hoje há `gray-100`, `gray-200`, `gray-300` disputando o mesmo papel) |
| `danger-500` | Cancelamento, erro, saldo negativo (já existe informalmente como `red-500`, só formalizar) |

### 4.2 Elevação (sombra) — 3 níveis, não 11
- `shadow-flat` (nenhuma — a maioria dos cards no fluxo)
- `shadow-raised` (um valor único, para o CTA primário e o painel que flutua sobre o mapa)
- `shadow-floating` (para modais/bottom sheets)

Todo `shadow-2xl`, `shadow-green-500/20`, `shadow-[0_...]` arbitrário do código atual mapeia para um desses 3.

### 4.3 Raio — 2 valores
- `rounded-md` (14px) para cards e inputs
- `rounded-full` para botões pill, avatares, badges
(Elimina `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-t*` soltos coexistindo sem motivo.)

### 4.4 Espaçamento
Sem token novo necessário — Tailwind já tem uma escala consistente (4/8/12/16/24px). O problema não é a escala, é a inconsistência de qual valor usar pra "mesma coisa" em telas diferentes (ex: padding de card varia entre `p-3`, `p-4`, `p-5`, `p-6` para o mesmo tipo de elemento). Isso se resolve nos componentes reutilizáveis (§5), não num token novo.

### 4.5 Tipografia
Sem trocar a fonte do sistema (mantém performance, sem custo de rede). Ajuste é de **escala e peso**, não de família: preço e CTA ganham mais peso/tamanho relativo; textos secundários (endereço completo, subtítulos) ganham um tom mais claro e consistente (`ink-400`) em vez da mistura atual de `text-gray-400/500/600`.

### 4.6 Camadas (z-index)
Convenção fechada de 4 níveis em vez de 11 valores soltos: `z-base(0) < z-panel(10) < z-overlay(40) < z-modal(50)`. Elimina os valores mágicos (`z-[60]`, `z-[70]`, `z-[9999]`).

---

## 5. Componentes reutilizáveis propostos

Novos, em `frontend/src/shared/components/ui/` (pasta nova, isolada — não mexe em componentes existentes até serem adotados tela por tela):

| Componente | Substitui a repetição em |
|---|---|
| `Button` (variantes primary/secondary/ghost/danger) | Botões de `Home`, `ConfirmRide`, `VehiclePanel`, `Account`, `UserLogin`, `UserSignup`, `Riding` — hoje cada um escreve `bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl ...` do zero |
| `Card` | Wrapper de painel elevado (usado em quase toda tela do fluxo) |
| `DetailRow` (ícone + título + subtítulo, com variante clicável) | `LocationSearchPanel`, `ConfirmRide`, `LookingForDriver`, `WaitingForDriver`, `Activity` |
| `SelectableOptionCard` | `VehiclePanel` (categorias), `PaymentOptionsPanel` (métodos) |
| `BottomSheet` (wrapper de painel deslizante com alça) | `VehiclePanel`, `ConfirmRide`, `OptionalsPanel`, `PaymentOptionsPanel`, `LookingForDriver`, `WaitingForDriver` — hoje cada um repete a mesma estrutura de `fixed w-full bottom-0 ... rounded-t-3xl` |
| `StatusBadge` | `Activity` (status da corrida), `WaitingForDriver` (PIN) |
| `PageHeader` (seta-voltar + título) | 6+ subpáginas de `account/` |
| `Avatar` | **já existe** (criado na auditoria de integração para M9) — só passa a ser usado nos novos componentes também |

Nenhum desses componentes contém lógica de negócio — só apresentação. Toda função (`onClick`, `onChange`, estado) continua vindo de props, exatamente como hoje.

---

## 6. Hierarquia visual (comportamental)

- **O olho não vai direto para a ação principal na Home fechada.** Saudação (`text-2xl font-bold`) e campo "Para onde?" competem no mesmo peso — já registrado em §2.1, reforçado aqui: numa tela de mobilidade, só existe uma ação certa ("Para onde vamos?"), tudo o resto é contexto e deveria pesar menos.
- **O botão "Buscar Corrida" e o botão "Confirmar Corrida" têm o mesmo peso visual que botões secundários em outras telas** (ex: "Restaurar" em formulários do admin, mas no passageiro isso se repete entre "Buscar destino" e o CTA de fato) — não há uma hierarquia clara de 1 ação primária + ações secundárias visualmente subordinadas em cada tela; quase tudo é botão verde cheio.
- **Nada fica genuinamente escondido** — pontos positivos: PIN de segurança, preço e status sempre visíveis sem precisar rolar ou abrir menu. Isso é comparável ao padrão Uber/99.
- **Excesso de informação pontual**: `ConfirmRide.jsx` mostra veículo + opcionais + trajeto + pagamento + preço + botão numa única rolagem sem nenhum agrupamento visual (já em §2.5) — o usuário precisa escanear 5 blocos de mesma hierarquia para achar o que quer conferir antes de confirmar.

## 7. Fluxo do usuário — mapa detalhado

Seguindo a sequência do briefing:

| Etapa | O que existe hoje | Achado |
|---|---|---|
| Abrir app | `Start.jsx` → redireciona automaticamente se já logado | 🟢 sem fricção extra |
| Selecionar destino | Toca "Buscar destino" → painel sobe → digita → sugestões | 🟡 ver §8 (zero loading ao buscar tarifa) |
| Escolher veículo | `VehiclePanel` abre **antes** da tarifa terminar de carregar (ver §8) | 🔴 |
| Confirmar corrida | `ConfirmRide` → botão único, direto | 🟢 fluxo correto, sem passos extras |
| Esperar motorista | `LookingForDriver` com animação de busca | 🟡 sem timeout/retry visível (ver §9) |
| Acompanhar chegada | `WaitingForDriver` + mapa com motorista | 🟢 informação certa (PIN, placa, ETA) |
| Corrida em andamento | `Riding.jsx`, mapa + chat | 🟢 |
| Pagamento | Modal em `Riding.jsx`, honesto sobre ser acerto direto (Sprint 2 da auditoria de integração) | 🟢 lógica; 🟡 visual (3 passos com layouts levemente diferentes) |
| Avaliação | Mesmo modal, passo `rating` | 🟢 |

**Não encontrei passos desnecessários, telas redundantes nem excesso de cliques** — a arquitetura de fluxo em si (painéis dentro de `Home.jsx`, sem trocar de rota a cada etapa) é uma escolha correta para um app de mobilidade: menos saltos de contexto que se cada etapa fosse uma página nova. O problema do fluxo não é a quantidade de passos, é a **falta de feedback dentro de cada passo** — detalhado a seguir.

## 8. Microinterações

Esta é a categoria com os achados mais críticos da auditoria — porque são invisíveis até o usuário parar de confiar no app.

### 🔴 `findTrip()` (botão "Buscar Corrida") não tem nenhum estado de carregamento
`Home.jsx:443-461`. O painel de veículos abre **imediatamente** (`setVehiclePanel(true)`) antes mesmo da chamada `GET /rides/get-fare` (que consulta o Google Routes API) ser disparada. Durante o tempo real da requisição, o usuário vê os cards de categoria **sem preço** — parecendo quebrado, não carregando. Não há `try/catch`: se a chamada falhar (endereço inválido, rede instável), a tela fica presa em silêncio, sem erro, sem preço, sem saída clara além de fechar manualmente o painel.

**Impacto:** este é o primeiro compromisso real de confiança no fluxo — é a transição de "estou navegando" para "estou prestes a gastar dinheiro", exatamente onde o usuário mais precisa sentir controle.

### 🔴 `createRide()` não dá feedback de erro
`Home.jsx:463-494`. O toast de "buscando motoristas" (em inglês, ver §10) dispara e desaparece sozinho em 5s independentemente do resultado. Se `POST /rides/create` falhar, o `catch` só faz `console.error` — nenhum toast, nenhuma tela de erro, nenhuma forma de tentar de novo. O usuário fica olhando para o painel de veículo sem entender se a corrida foi pedida ou não.

**Impacto:** exatamente o cenário que o briefing descreve como inaceitável — "nenhuma ação importante deve parecer que não aconteceu". Esta é a ação mais importante do app inteiro.

### 🟡 Nenhum estado "pressed" consistente em botões
A maioria dos botões usa só `hover:` (que não existe em touch) e depende de `active:scale-95`/`active:bg-...` de forma inconsistente — alguns têm, outros não (ex.: botão "Buscar Corrida" não tem nenhum estado ativo/pressionado; o card de corrida no histórico tem `active:scale-[0.98]`). Sem um padrão único, o toque às vezes "responde" e às vezes não — isso é sentido como inconsistência de qualidade mesmo que o usuário não saiba nomear o motivo.

### 🟡 Loading = spinner em quase tudo, skeleton em lugar nenhum
Nenhuma tela usa skeleton (placeholder com a forma do conteúdo). Isso é aceitável para ações rápidas (< 300ms) mas não para o carregamento inicial de listas (histórico, sugestões de endereço) onde o conteúdo final tem uma forma previsível — um skeleton do formato do card reduz a sensação de espera mais que um spinner central.

### 🟢 O que já funciona bem
- Animação de "buscando motorista" (`LookingForDriver.jsx`, círculos com `animate-ping`) é o melhor microfeedback do app hoje — comunica "algo está acontecendo" sem texto.
- Toast global (`ToastContext.jsx`) é uma boa infraestrutura — cores/ícones por tipo, empilhamento, auto-dismiss. O problema não é o componente, é a **cobertura** (muitos fluxos de erro simplesmente não o chamam, como visto acima).
- `LocationSearchPanel` mostra um spinner inline por sugestão individual ao resolver coordenadas (`resolvingKey`) — um bom padrão de "loading localizado", não bloqueia a tela inteira.

## 9. Estados da interface

Auditoria item a item dos estados pedidos:

| Estado | Existe? | Onde / como | Avaliação |
|---|---|---|---|
| Loading (busca de tarifa) | ❌ | `findTrip()` | 🔴 nenhum feedback |
| Loading (criar corrida) | ⚠️ parcial | toast fixo de 5s, não ligado ao resultado real | 🔴 |
| Loading (histórico, 1ª carga) | ⚠️ parcial | spinner existe mas abaixo da área vazia, pouco visível | 🟡 |
| Erro (criar corrida) | ❌ | nenhum | 🔴 |
| Erro (buscar tarifa) | ❌ | nenhum | 🔴 |
| Sem internet | ❌ | não existe detecção alguma no app do passageiro (existe só no app do motorista, via fila offline) | 🔴 |
| Sem GPS / permissão negada | ⚠️ parcial | toast reativo só ao tocar no campo de partida (`Home.jsx:113-116`); nada proativo se a permissão for negada no primeiro acesso | 🟡 |
| Sem motorista disponível | ⚠️ parcial | backend expira a corrida sozinho após 10 min (`getCurrentRide`), mas a tela `LookingForDriver` não comunica isso — o usuário só vê "Buscando..." indefinidamente até cancelar manualmente ou a expiração silenciosa acontecer | 🔴 |
| Sem resultados de busca de endereço | ✅ | `LocationSearchPanel.jsx:83-85` "Nenhuma sugestão encontrada" | 🟢 |
| Sem histórico | ✅ | `Activity.jsx:127-131` | 🟢 |
| Sem corridas agendadas/favoritos/cartões/cupons | ✅ | corrigido na auditoria de integração (Sprint 4, A7) — estado vazio e estado de erro agora são visualmente distintos | 🟢 |
| Sem permissões (notificação) | ⚠️ | pedida silenciosamente no mount do `Home.jsx`, sem explicar por quê antes de perguntar — no primeiro uso, o navegador pergunta sem contexto | 🟡 |
| Timeout de requisição | ❌ | nenhum `timeout` configurado no axios do passageiro, nenhuma UI de timeout | 🟡 |
| Servidor indisponível (5xx) | ❌ | mesma lacuna do "erro genérico" acima — não há tratamento diferenciado | 🔴 |
| Dados parciais (ex: motorista sem foto/placa) | ✅ | campos usam `?.` e fallback de texto, não quebra o layout | 🟢 |
| Atualização em andamento (ex: recarregando fatura/summary) | N/A no passageiro | — | — |
| Reconexão de socket | ❌ | `SocketContext.jsx` já trata reconexão **tecnicamente** (sincroniza fila offline), mas **nunca informa o usuário visualmente** — se a conexão cair durante "esperando motorista", a tela continua estática, sem indicar que os eventos em tempo real pararam de chegar | 🔴 |

**Resumo:** dos 15 estados auditados, **6 são 🔴 (ausentes)**, **4 são 🟡 (parciais)**, **5 são 🟢 (bons)**. A maior lacuna é sistemática: **o app não tem uma linguagem visual para "algo deu errado" ou "a conexão caiu"** — só para "não há dados" (que já está bem resolvido).

## 10. Consistência (comportamental, além do visual do §0)

- **Botões**: ✅ cor/raio consistentes (verde cheio = primário), mas 🟡 estado disabled/loading inconsistente (alguns desabilitam durante requisição, outros não — ex.: `handlePay`/`handleConfirmPayment` em `Riding.jsx` desabilitam corretamente com `disabled={loading}`; `findTrip`/`createRide` em `Home.jsx` não desabilitam nada).
- **Cards**: 🟡 mesma "família" visual (borda cinza clara + cantos arredondados) mas raio inconsistente entre telas (`rounded-xl` na maioria, `rounded-2xl` no histórico e wallet).
- **Modais/bottom sheets**: 🟡 dois padrões de fechar coexistindo — a maioria usa a "alça" no topo (`<i className="ri-arrow-down-wide-line">`, clicável), mas o modal de pagamento em `Riding.jsx` usa um ícone de X (`ri-close-line`) no canto — mesma função, dois afordances diferentes.
- **Ícones**: ✅ 100% Remix Icon em todo o app, nenhuma mistura de bibliotecas — ponto forte real.
- **Espaçamento**: 🟡 já quantificado em §0 — mesma "unidade" de componente (padding de card, gap entre ícone e texto) varia entre `p-3/p-4/p-5/p-6` e `gap-3/gap-4/gap-5` sem critério aparente de quando usar qual.

## 11. Navegação

- **Botão voltar do navegador/gesto do sistema**: o fluxo de solicitar corrida inteiro (`Home.jsx`) acontece dentro de uma única rota (`/home`) com painéis controlados por `useState`, não por rota/URL. Isso significa que o botão físico "voltar" do Android (ou o gesto do iOS) **não fecha o painel aberto** — ele navega para a página anterior no histórico do navegador, tirando o usuário do fluxo de corrida inteiro sem aviso. Isso é uma fonte real de "se perder" durante o fluxo mais crítico do app. 🔴
- **Fechamento de modais**: majoritariamente consistente (toque fora fecha o painel de busca de endereço; alça fecha bottom sheets) — ver inconsistência pontual em §10.
- **Retorno após refresh**: 🟢 bem resolvido — `Home.jsx` re-consulta `/rides/current` no mount e restaura corretamente o estado (`vehicleFound`/`waitingForDriver`) se havia uma corrida em andamento. Isso é um diferencial que muitos MVPs não têm.
- **Histórico de navegação**: como a maior parte do fluxo não usa rotas, o histórico do navegador não reflete o estado real do app (ex.: apertar voltar depois de abrir o painel de veículo não volta para "painel fechado", volta para a tela anterior a `/home`). Consistente com o ponto acima.

## 12. Acessibilidade

Auditoria objetiva (contagem no código, não estimativa):

| Item | Situação encontrada | Nota |
|---|---|---|
| Atributos `aria-*` | **Zero** em todo `modules/passenger` | 🔴 nenhum suporte a leitor de tela além do HTML semântico básico |
| `alt` em imagens | 14 ocorrências, presentes onde há `<img>` | 🟢 |
| Elementos clicáveis que são `<div onClick>` em vez de `<button>` | 6 ocorrências, sendo 3 genuínos itens de ação (sugestão de endereço em `LocationSearchPanel.jsx:71`, editar avatar em `Account.jsx:22`, excluir conta em `Profile.jsx:102`) — sem foco por teclado, sem `role`, sem resposta a Enter/Espaço | 🔴 |
| Tamanho de área de toque | Vários ícones de fechar/voltar são só `text-2xl` (24px) dentro de `p-1` (4px) → **~32px de área de toque**, abaixo do mínimo recomendado (44px Apple HIG / 48dp Material) | 🟡 |
| Contraste de cor | Verde de marca (`green-500`, ~#22c55e) sobre fundo branco é o tom mais usado para texto/ícone de ação — vale confirmar com uma ferramenta de contraste antes do redesign, mas tons de verde nessa faixa costumam ficar **abaixo de 4.5:1** (exigido para texto normal em WCAG AA), funcionando melhor como cor de fundo de botão (texto branco sobre ele) do que como cor de texto sobre branco | 🟡 |
| Navegação/foco por teclado | Não testável em um app mobile-first, mas relevante para o PWA rodando em desktop — nenhum `:focus-visible` customizado, depende do outline default do navegador (que várias classes `outline-none` em inputs removem sem substituto) | 🔴 |
| Cor como único significado | Status de corrida (`Activity.jsx`) usa cor + texto (não só cor) — 🟢 correto. Botão "seguindo motorista" no mapa (`LiveTracking.jsx`) muda só de cor (branco→azul) sem ícone/texto diferente — 🟡 |

**Este é o bloco com menor maturidade hoje** — não por ser um app ruim, mas porque acessibilidade tende a ser o último item endereçado em produtos em fase de validação. Vale corrigir o essencial (targets de toque, `aria-label` nos ícones-só-botão, trocar `<div onClick>` por `<button>`) junto do redesign, já que estarei reescrevendo esses componentes de qualquer forma — custo marginal baixo, ganho real.

## 13. Performance percebida

- **Padrão inteligente já em uso**: os bottom sheets do `Home.jsx` ficam sempre montados no DOM (alternam `translate-y-full`/`invisible` via classe, não `{condition && <Panel/>}`) — isso evita o custo de montar/desmontar componentes pesados (como `VehiclePanel`, que faz fetch de categorias) a cada abertura, o que dá uma sensação de abertura instantânea. 🟢 mantido como está.
- **Custo escondido do mesmo padrão**: como tudo fica montado, `Home.jsx` é um componente único muito grande (~700 linhas, ~25 `useState`) e nenhum componente filho (`LiveTracking`, `VehiclePanel`, `ConfirmRide`, etc.) usa `React.memo` — confirmado por busca no código (zero ocorrências de `memo(` em todo o app do passageiro). Cada tecla digitada em "Para onde?" atualiza o estado de `Home.jsx` e **re-renderiza a árvore inteira**, incluindo o mapa (`LiveTracking`) e todos os painéis escondidos. Hoje isso não trava porque o app é pequeno, mas é o tipo de decisão que degrada perceptivelmente assim que mais telas/painéis forem adicionados.
- **Debounce existe, mas só protege a chamada de API** — a busca de sugestões já usa `setTimeout` de 400ms corretamente antes de chamar o backend (bom), mas isso não evita o custo de re-render a cada tecla, que é um problema diferente.
- **Nenhuma animação pesada identificada** — as únicas animações contínuas (`animate-ping`, `animate-pulse`, `animate-spin`) são leves (CSS puro, GPU-friendly), sem JS custoso rodando em loop além da interpolação de posição do motorista no mapa (`requestAnimationFrame`, já otimizado com `cancelAnimationFrame` no cleanup).
- **Recomendação prática**: envolver `LiveTracking` e os painéis pesados em `React.memo`, e/ou extrair o estado de busca (pickup/destination typing) para um componente-filho isolado, para que digitar no campo de busca não force o mapa a re-avaliar props.

## 14. Comparação com apps de referência

Comparação conceitual (organização, clareza, fluxo — não visual/pixel), com base em padrões amplamente conhecidos desses produtos:

| Critério | Uber / 99 / inDrive | MoveCity hoje |
|---|---|---|
| Ação primária óbvia na home | Campo "Para onde?" domina a tela, sem concorrência | 🟡 divide atenção com saudação |
| Feedback de carregamento de preço | Skeleton nos cards de categoria enquanto calcula | 🔴 cards aparecem sem preço, sem indicação |
| Erro de rede/servidor | Banner ou modal claro, com opção de tentar de novo | 🔴 inexistente |
| Confiança durante espera do motorista | Indicação de tempo/possível demora, opção de tentar outro veículo se demorar muito | 🟡 só animação, sem tempo/expectativa |
| Quantidade de informação por tela | Progressiva — mostra só o necessário para a decisão daquele passo | 🟢 já é o padrão aqui na maioria das telas |
| Confirmação de ação crítica (pedir corrida) | Sempre com feedback imediato de sucesso/falha | 🔴 maior gap encontrado nesta auditoria |
| Consistência de componentes | Design system fechado, repetido sem variação | 🔴 já detalhado no doc de redesign visual |

**Onde o MoveCity já parece produto:** arquitetura de fluxo (painéis em vez de páginas), restauração de estado após refresh, animação de busca de motorista, tratamento de estados vazios (pós Sprint 4 da auditoria de integração), ausência de mistura de bibliotecas de ícone.

**Onde ainda parece protótipo:** feedback de carregamento/erro nas duas ações mais importantes do app (buscar preço, pedir corrida), ausência de estado de "sem conexão", navegação por gesto/botão físico não integrada ao fluxo de painéis.

## 15. Novas oportunidades de componentização

Além dos 7 componentes já propostos em §5, a auditoria comportamental revela mais 3, todos ligados a fechar as lacunas de estado acima — não são só "organização de código", são a peça que falta para os achados 🔴 virarem 🟢:

| Componente | Resolve |
|---|---|
| `LoadingButton` (botão com estado `loading`/`disabled` embutido, spinner inline) | `findTrip`, `createRide` e qualquer outro botão que dispara uma chamada assíncrona sem feedback hoje |
| `EmptyState` (ícone + título + descrição, com variante de erro vs. vazio) | Generaliza o padrão que já escrevi 5 vezes manualmente em `Coupons/Favorites/Cards/Scheduled/Wallet.jsx` na auditoria de integração — hoje é a mesma estrutura JSX copiada, não um componente |
| `ConnectionBanner` (faixa fixa "Sem conexão" / "Reconectando...") | Não existe hoje em lugar nenhum do app do passageiro — cobre a lacuna de §9 (offline, reconexão de socket) |

## 16. Relatório final classificado

Consolidação de tudo, por área, do jeito pedido — 🟢 excelente, 🟡 bom mas pode melhorar, 🔴 precisa redesenhar. Prioridade: **P0** (afeta confiança/dinheiro, corrigir na Etapa 1-2), **P1** (afeta clareza, corrigir junto da tela correspondente), **P2** (polimento, pode esperar).

| # | Item | Status | Por que prejudica | Impacto no usuário | Como corrigir | Prioridade |
|---|---|---|---|---|---|---|
| 1 | `findTrip()` sem loading | 🔴 | Painel abre com preço vazio, parece quebrado | Confusão no momento decisivo (quanto vou pagar) | `LoadingButton` + só abrir o painel após a resposta (ou skeleton nos cards) | **P0** |
| 2 | `createRide()` sem feedback de erro | 🔴 | Falha silenciosa, usuário não sabe se pediu a corrida | Pode gerar corrida duplicada (tenta de novo) ou desistência | `try/catch` com toast de erro + retry | **P0** |
| 3 | Sem detecção de "sem internet" | 🔴 | App parece travado em vez de sinalizar a causa real | Frustração, não sabe se é o app ou a rede | `ConnectionBanner` global via `navigator.onLine` + eventos `online`/`offline` | **P0** |
| 4 | Sem feedback visual de reconexão de socket | 🔴 | Durante espera do motorista, eventos param sem aviso | Ansiedade ("meu motorista sumiu?") | Ligar `ConnectionBanner` também ao `socket.on('disconnect'/'connect')` | **P0** |
| 5 | "Buscando motorista" sem expectativa de tempo | 🔴 | Espera indefinida sem sinal de quanto falta ou se vale desistir | Ansiedade, abandono | Mostrar tempo decorrido + sugestão de cancelar/tentar outro veículo após N segundos | **P1** |
| 6 | Zero sistema de design (cor/sombra/raio/z-index) | 🔴 | Cada tela reinventa o vocabulário visual | Sensação de protótipo, inconsistência sutil constante | Tokens no `tailwind.config.js` (já detalhado em §4) | **P0** (base de tudo) |
| 7 | Zero `aria-*`, `<div onClick>` em vez de `<button>` | 🔴 | Sem suporte a leitor de tela / navegação por teclado | Exclui usuários com deficiência visual/motora | Trocar por `<button>` + `aria-label` nos ícones-só-ação | **P1** |
| 8 | Botão voltar do navegador sai do fluxo de corrida | 🔴 | Painel aberto não fecha com "voltar", a tela inteira troca | Usuário se perde no passo mais crítico | Ver decisão necessária no início da Etapa 2 (abaixo) | **P1** |
| 9 | HUD do mapa nunca aparece durante a viagem real (`ongoing` vs `started`) | 🔴 | Bug funcional: informação de progresso simplesmente não existe quando mais importa | Passageiro não vê "X km restantes" durante o trajeto de verdade | Corrigir a condição de status (1 linha) | **P0** |
| 10 | Strings em inglês (`LiveTracking`, toast de `createRide`) | 🟡 | Quebra a sensação de produto acabado | Pequeno, mas perceptível | Traduzir | **P1** |
| 11 | Loading de listas (histórico) é spinner, não skeleton | 🟡 | Funciona, mas sensação de espera maior que o necessário | Leve | `Skeleton` no formato do card | **P2** |
| 12 | Estados "pressed" inconsistentes entre botões | 🟡 | Toque às vezes "não responde" visualmente | Leve, cumulativo | Padronizar `active:` no componente `Button` | **P1** |
| 13 | Dois padrões de fechar modal (alça vs. X) | 🟡 | Usuário reaprende o gesto por tela | Leve | Unificar no `BottomSheet` | **P1** |
| 14 | Áreas de toque pequenas (~32px) em ícones de ação | 🟡 | Toques errados, especialmente em uso com uma mão | Leve a moderado, mobile-first | Mínimo 44px de área de toque nos componentes novos | **P1** |
| 15 | Contraste do verde de marca como cor de texto | 🟡 | Pode ficar abaixo de AA em texto pequeno | Leitura mais difícil em sol forte/tela baixa luminosidade | Confirmar com ferramenta de contraste; reservar o verde puro para fundo de botão, não texto solto | **P2** |
| 16 | `Home.jsx` sem `React.memo` nos filhos pesados | 🟡 | Re-render da árvore inteira a cada tecla digitada | Não perceptível hoje, risco de degradar | `React.memo` em `LiveTracking` e painéis | **P2** |
| 17 | Timeout de requisição / erro 5xx sem tratamento diferenciado | 🟡 | Mesma lacuna do item 2, generalizada | Idem item 2 | Interceptor de erro no axios com mensagens por tipo de falha | **P1** |
| 18 | Permissão de notificação pedida sem contexto prévio | 🟡 | Usuário nega por reflexo sem entender o motivo | Perde push notifications de corrida | Mostrar um texto explicativo antes do prompt nativo | **P2** |
| 19 | Hierarquia visual da Home (saudação vs. busca) | 🟡 | Ação principal não domina a tela | Leve fricção na primeira interação | Já coberto no redesign visual (§2.1) | **P1** |
| 20 | Arquitetura de fluxo em painéis (não rotas) | 🟢 | — | Menos saltos de contexto que trocar de página a cada passo | Manter | — |
| 21 | Restauração de estado após refresh (`/rides/current`) | 🟢 | — | Usuário nunca "perde" uma corrida em andamento por atualizar a página | Manter | — |
| 22 | Estados vazios de listas (histórico, cupons, favoritos etc.) | 🟢 | — | Já diferencia "vazio" de "erro" desde a auditoria de integração | Manter, só herdar novos tokens visuais | — |
| 23 | Ícones 100% Remix Icon, sem mistura de biblioteca | 🟢 | — | Consistência visual real | Manter | — |
| 24 | Animação de busca de motorista | 🟢 | — | Melhor microfeedback do app hoje | Manter, só migrar paleta | — |

---

## 17. Arquivos que serão alterados (por fase)

**Novos (não tocam em nada existente até serem importados):**
- `frontend/tailwind.config.js` (adicionar tokens em `theme.extend`, sem remover nada)
- `frontend/src/shared/components/ui/Button.jsx` (inclui variante de loading — item 1, 12)
- `frontend/src/shared/components/ui/Card.jsx`
- `frontend/src/shared/components/ui/DetailRow.jsx`
- `frontend/src/shared/components/ui/SelectableOptionCard.jsx`
- `frontend/src/shared/components/ui/BottomSheet.jsx` (fechamento unificado — item 13)
- `frontend/src/shared/components/ui/StatusBadge.jsx`
- `frontend/src/shared/components/ui/PageHeader.jsx`
- `frontend/src/shared/components/ui/EmptyState.jsx` (item 15 de §15)
- `frontend/src/shared/components/ui/ConnectionBanner.jsx` (itens 3 e 4)

**Modificados, na ordem das fases abaixo:**
- `frontend/src/modules/passenger/pages/Home.jsx` (visual + itens 1, 2, 3, 4, 8, 16)
- `frontend/src/modules/passenger/components/LocationSearchPanel.jsx`
- `frontend/src/shared/components/LiveTracking.jsx` (visual + item 9 — correção do bug de status; item 10 — tradução)
- `frontend/src/modules/passenger/components/VehiclePanel.jsx`
- `frontend/src/modules/passenger/components/ConfirmRide.jsx`
- `frontend/src/modules/passenger/components/OptionalsPanel.jsx`
- `frontend/src/modules/passenger/components/PaymentOptionsPanel.jsx`
- `frontend/src/modules/passenger/components/LookingForDriver.jsx` (item 5 — expectativa de tempo)
- `frontend/src/modules/passenger/components/WaitingForDriver.jsx`
- `frontend/src/modules/passenger/pages/Riding.jsx` (item 13 — unificar fechamento do modal)
- `frontend/src/modules/passenger/pages/Activity.jsx` (item 11 — skeleton)
- `frontend/src/modules/passenger/components/Header.jsx`
- `frontend/src/modules/passenger/pages/account/Account.jsx` + subpáginas (herdam `PageHeader`/`Button`; item 7 nos itens clicáveis)
- `frontend/src/modules/passenger/pages/UserLogin.jsx`, `UserSignup.jsx`, `frontend/src/shared/pages/Start.jsx`
- `frontend/src/services/axios.js` (item 17 — interceptor de erro genérico, se ainda não tratado por uma instância própria do passageiro)

**Não alterados:** qualquer arquivo de `contexts/` (lógica), rotas, backend, app do motorista, painel admin.

---

## 18. Plano de execução em etapas

Cada etapa é independente, testável isoladamente (visualmente + `npm run build` + suíte de testes) e não quebra a anterior. Mesmo processo de sempre: aprovação → execução → verificação → registro aqui neste arquivo.

1. **Fundação** — tokens no `tailwind.config.js` + os 10 componentes de `shared/components/ui/` (inclui `LoadingButton`/variante de loading no `Button`, `EmptyState`, `ConnectionBanner`). Zero risco: nada existente é importado ainda.
2. **Home + busca de destino** — `Home.jsx`, `LocationSearchPanel.jsx`. Junto do visual: loading em `findTrip`/`createRide` (itens 1, 2 — **P0**), `ConnectionBanner` ligado ao `navigator.onLine` e ao socket (itens 3, 4 — **P0**). **Decisão necessária aqui**: como tratar o botão voltar do navegador durante um painel aberto (item 8) — duas opções, ver §19 abaixo, preciso da sua escolha antes de implementar essa parte específica.
3. **Mapa e HUD** — `LiveTracking.jsx`: visual + correção do bug de status (`ongoing`→`started`, item 9, **P0**) + tradução das strings (item 10).
4. **Fluxo de solicitação** — `VehiclePanel.jsx`, `ConfirmRide.jsx`, `OptionalsPanel.jsx`, `PaymentOptionsPanel.jsx`. Acessibilidade: `<button>` em vez de `<div onClick>` nos itens clicáveis restantes, `aria-label` em ícones-só-ação (item 7).
5. **Acompanhamento** — `LookingForDriver.jsx` (expectativa de tempo de espera, item 5), `WaitingForDriver.jsx`, `Riding.jsx` (unificar fechamento de modal, item 13).
6. **Histórico e conta** — `Activity.jsx` (skeleton, item 11), `Header.jsx`, `Account.jsx` + subpáginas.
7. **Autenticação** — `UserLogin.jsx`, `UserSignup.jsx`, `Start.jsx`.
8. **Polimento transversal** — itens 2xx (perf: `React.memo`), 15 (contraste), 18 (contexto antes do prompt de notificação), interceptor de erro genérico no axios (item 17) aplicado a todas as chamadas do passageiro de uma vez.

Em cada etapa: `npx vite build` limpo, suíte de testes do frontend rodada (baseline conhecida: 3 falhas pré-existentes/4 aprovados, não deve mudar), e conferência visual + funcional (testar o estado de erro/loading de propósito, não só o caminho feliz) antes de eu marcar a etapa como concluída aqui.

---

## 19. Decisão pendente antes da Etapa 2

O item 8 (botão voltar sai do fluxo de corrida) tem duas soluções válidas, com trade-offs diferentes:

- **Opção A — histórico sintético**: usar `window.history.pushState` ao abrir cada painel e ouvir `popstate` para fechá-lo em vez de navegar. Resolve o problema por completo, mas adiciona uma camada de gerenciamento de histórico manual dentro de `Home.jsx` (mais código, mais superfície para bugs sutis de navegação).
- **Opção B — aceitar o comportamento, só avisar**: manter a arquitetura atual (mais simples, já testada), e não fazer nada — o usuário raramente aperta "voltar" físico no meio de pedir uma corrida (o padrão mais comum é fechar o painel pela alça). Documentar como limitação conhecida.

Recomendo a **Opção B** por ora: o ganho da Opção A é real mas o risco de regressão em um componente já grande (`Home.jsx`) é desproporcional ao tamanho do problema (é uma situação rara, não o caminho principal). Posso revisitar se depois do redesign você achar que vale o investimento. Me diga qual prefere antes de eu chegar na Etapa 2.

---

## 20. O que **não** muda

- Nenhuma chamada de API, nenhum hook, nenhum estado, nenhum evento de socket (exceto adicionar *listeners* novos para o `ConnectionBanner`, que só leem estado de conexão, não alteram nenhum fluxo existente).
- Nenhuma prop de dado (`ride`, `fare`, `pickup`, etc.) muda de forma — só a apresentação visual ao redor e a camada de feedback (loading/erro) que hoje não existe.
- Fluxo de pagamento/avaliação (recém-corrigido na auditoria de integração) mantém exatamente a mesma lógica, só reorganização visual dos 3 passos.
- Nenhuma rota muda de caminho.
- App do motorista e painel admin não são tocados nesta rodada.

---

## 21. Registro de execução

_(a preencher conforme cada etapa for aprovada e executada)_

- [x] **Etapa 1 — Fundação** (executado em 2026-08-01)
- [x] **Etapa 2 — Home + busca de destino** (executado em 2026-08-01)
- [x] **Etapa 3 — Mapa e HUD** (executado em 2026-08-01)
- [x] **Etapa 4 — Fluxo de solicitação** (executado em 2026-08-01)
- [x] **Etapa 5 — Acompanhamento** (executado em 2026-08-01)
- [x] **Etapa 6 — Histórico e conta** (executado em 2026-08-01)
- [x] **Etapa 7 — Autenticação** (executado em 2026-08-01)
- [x] **Etapa 8 — Polimento transversal** (executado em 2026-08-01)

### Etapa 1 — detalhes da execução

**Tokens (`frontend/tailwind.config.js`)**: adicionados em `theme.extend`, sem sobrescrever nenhum valor padrão do Tailwind — `brand` (verde, mesmo tom de `green-500/600` já usado, agora com nome semântico), `ink` (3 tons de texto), `surface`/`surface-alt`, `line` (borda única), `danger`. Elevação: `shadow-raised`/`shadow-floating` (2 dos 3 níveis — o terceiro é "nenhuma sombra", não precisa de token). Raio: `rounded-panel` (14px) como nome **novo**, não reaproveitando `rounded-md` — decisão tomada na execução: sobrescrever o `md` padrão do Tailwind afetaria as 5 ocorrências de `rounded-md` já em uso em telas ainda não migradas, o que violaria o princípio "só adicionar, nada quebra antes de ser adotado". Camadas: `z-base/panel/overlay/modal`.

**Componentes (`frontend/src/shared/components/ui/`)**: `Button` (4 variantes + estado `loading` com spinner embutido — resolve os itens 1/2/12 do relatório), `Card`, `DetailRow` (renderiza `<button>` quando clicável, corrige o padrão `<div onClick>` — item 7), `SelectableOptionCard` (estado selecionado visualmente resolvido — achado de `VehiclePanel`), `BottomSheet` (fechamento único pela alça, sempre montado/só alterna visibilidade — preserva o padrão de performance elogiado no §13), `StatusBadge`, `PageHeader`, `EmptyState` (generaliza o padrão repetido 5x em `account/`, com variante de erro + retry), `ConnectionBanner` (detecta offline via `navigator.onLine` e desconexão de socket via `SocketContext` — ainda não montado em nenhuma tela, isso acontece na Etapa 2).

**Verificação:** `vite build` limpo (bundle JS idêntico em tamanho — nada novo é importado ainda, então nada entra no bundle; CSS cresceu ~4KB só pelas classes utilitárias novas detectadas pelo scanner do Tailwind, sem efeito visual). Suíte de testes do frontend inalterada (`3 failed | 4 passed` — mesma baseline). Lint das 9 novas peças mostra só os mesmos dois padrões já presentes em 100% dos componentes existentes do projeto (React importado sem uso direto do namespace, ausência de `prop-types` em todo o código-base) — nenhuma categoria nova de problema.

### Etapa 2 — detalhes da execução

**Comportamento (P0 do relatório):**
- `findTrip()` (`Home.jsx`): agora usa `try/catch` real. O painel de busca **fica aberto** durante toda a espera (com o botão "Buscar Corrida" usando o novo `Button` em estado `loading`) e só transiciona para o painel de veículos depois que o preço chega — antes o painel de veículo abria na hora, com preços em branco. **Achado durante a verificação ao vivo**: minha primeira versão fechava o painel de busca *antes* de esperar a resposta (só pra depois abrir o de veículos), o que fazia o spinner nunca aparecer de fato — o usuário via a tela inicial "pelada" durante a espera. Corrigido para manter o painel de busca aberto do início ao fim da chamada.
- `createRide()` (`Home.jsx`): toast traduzido pro português; `catch` agora reverte `vehicleFound` para `false` e mostra um toast de erro — antes, uma falha aqui deixava o passageiro preso na tela "Buscando motorista" pra sempre, com o botão de cancelar sem efeito (não existia corrida nenhuma pra cancelar).
- Corrigido de brinde um bug de um caractere achado na mesma função: `cancelRide` passava o objeto de erro como *tipo* do toast em vez da string `'error'` — o toast de erro nunca ficava vermelho.
- `<ConnectionBanner />` montado no topo de `Home.jsx`.
- Botão/gesto de voltar: novo hook `frontend/src/shared/hooks/useBackToClose.js` (uma entrada de histórico por "sessão" do fluxo de busca/veículo/confirmação, não uma por painel — decisão tomada na execução para evitar empilhar entradas a cada passo interno). Escopado aos 3 painéis com estado real perdível (`panelOpen`, `vehiclePanel`, `confirmRidePanel`); não aplicado a `vehicleFound`/`waitingForDriver` (uma corrida já existe no servidor nesse ponto — fechar visualmente não deveria parecer que cancelou algo que não foi cancelado).

**Visual:**
- Tela inicial: saudação reduzida de peso e passa a dividir espaço com uma linha de contexto ("Você está em: {endereço}", usando o `pickup` já resolvido por geocodificação reversa — sem nova chamada de API). Campo de busca vira a peça dominante da tela (`shadow-raised`, `rounded-panel`, texto "Para onde vamos?"). Convertido de `<div onClick>` para `<button>` — item 7 do relatório.
- Painel de busca aberto: botão de fechar convertido de `<h5>` pra `<button>` com `aria-label`; botão de GPS e botão de fechar com área de toque maior (mantendo o deslocamento vertical original do botão de GPS, só engordando o padding, pra não arriscar desalinhamento que eu não conseguiria validar visualmente sem quebrar o ajuste fino já existente); cores migradas para os tokens novos (`ink-900/600/400`, `brand-500/600`, `line`) nessa seção específica.

**Verificação ao vivo (Playwright contra o dev server real, não só build/testes automatizados):**
- Login real com usuário descartável criado direto no Mongo, removido ao final.
- Tela inicial: saudação + localização atual + campo de busca renderizando corretamente.
- Estado de loading forçado (resposta de `/rides/get-fare` atrasada artificialmente): botão fica desabilitado com spinner, painel de busca permanece visível, transição correta pro painel de veículos ao terminar.
- Estado de erro forçado (`/rides/get-fare` abortada): toast vermelho aparece, usuário permanece no painel de busca (não fica preso), botão volta a ficar clicável.
- Botão voltar: abrir o painel de busca e apertar voltar fecha o painel e mantém o usuário em `/home` (antes saía do fluxo inteiro).
- `ConnectionBanner`: aparece ao simular offline, some ao voltar — confirmado via DOM. **Observação menor não bloqueante**: num teste onde a desconexão coincide com o toast de boas-vindas ainda visível (poucos segundos após login), o toast (z-index mais alto, por design) cobre visualmente o banner nesse instante específico — os dois são elementos "fixos no topo" independentes. Baixa probabilidade no uso real (são eventos não correlacionados); não corrigido agora, registrado para revisitar se incomodar na prática.

**Build/testes:** `vite build` limpo, suíte do frontend na mesma baseline (`3 failed | 4 passed`) — confirmado que os 2 testes de `Home.test.jsx` já falhavam exatamente da mesma forma antes desta etapa (gap de setup de teste pré-existente: `LocationContext` sem Provider no wrapper do teste, não uma regressão desta etapa).

### Etapa 3 — detalhes da execução

**Bug de status (item 9, P0):** `LiveTracking.jsx` tinha o bug em DOIS lugares, não um:
1. O HUD (`ridePhaseLabel`) só cobria `'accepted'` e `'ongoing'` (inexistente) — corrigido para os status reais: `accepted`/`going_to_pickup` → "Motorista a caminho", `arrived`/`waiting_passenger` → "Motorista chegou" (sem km, já que a distância é ~0), `started` → "Corrida em andamento" (era exatamente o caso que nunca acendia antes).
2. O efeito que busca a rota no OSRM (`fetchRoute`) tinha o mesmo bug — só desenhava "motorista→embarque" quando `status==='accepted'`, então nos status intermediários (`going_to_pickup`/`arrived`/`waiting_passenger`) a rota caía errada no default "embarque→destino" mesmo com o motorista ainda a caminho. Corrigido pra cobrir os 4 status da fase de embarque. O ramo `'ongoing'` desse efeito era código morto (reatribuía os mesmos valores que já eram o default) — removido.

**Tradução:** strings do HUD (`Captain heading to pickup`/`Ride in progress` → português) e "km remaining" → "km restantes". **Achado ao vivo, fora do arquivo desta etapa**: o toast "Ride started! Enjoy your trip 🎉" em `Home.jsx` (disparado no evento `ride-started`) também estava em inglês — mesma categoria do item 10, só que numa ocorrência que eu não tinha visto na auditoria original. Corrigido também.

**Visual:** HUD, pino de seleção e botão de recentralizar migrados para os tokens novos (`shadow-raised`, `rounded-panel` onde aplicável, `ink-*`, `brand-*`, `line`). O botão de recentralizar usava `bg-blue-600` no estado "seguindo" — único azul do app inteiro fora da paleta; trocado por `brand-500`. Adicionado `aria-label` (antes só tinha `title`, que não é lido de forma confiável por leitores de tela).

**Verificação ao vivo — fluxo real ponta a ponta** (não só visual isolado, já que o bug só se manifesta com uma corrida real no status `started`): criei um passageiro e um motorista descartáveis, motorista logou e ficou online de verdade, passageiro pediu corrida real, motorista aceitou, marcou "a caminho" → "cheguei", leu o OTP direto da tela do passageiro (não do banco, pra testar como um usuário real veria), motorista iniciou a corrida com o PIN. Confirmado via Playwright: `HUD mostra "Corrida em andamento": true` — o card que antes NUNCA aparecia durante a viagem real agora aparece. Toda a base de teste (2 usuários, 1 corrida) removida ao final.

**Build/testes/lint:** `vite build` limpo, suíte na mesma baseline (`3 failed | 4 passed`). Lint de `LiveTracking.jsx`+`Home.jsx` foi de 73 problemas (baseline, confirmado via `git stash`) para 68 — leve melhora, não regressão, por causa do código morto removido junto da correção do bug.

### Etapa 4 — detalhes da execução

**`VehiclePanel.jsx`:** reescrito para o padrão "toque seleciona, botão separado avança" (achado da auditoria de UX — antes, tocar numa categoria já navegava direto pra confirmação, sem o usuário nunca ver o que tinha escolhido). Cards de categoria migrados para `SelectableOptionCard` (estado selecionado com borda/fundo `brand`, `aria-pressed`); botão "Continuar" (`Button` padrão) fica desabilitado até haver seleção.

**`ConfirmRide.jsx`:** seções agrupadas em `Card`+`DetailRow` (trajeto, pagamento, preço). Corrigido o item de preço-fake do relatório original: exibia `R$182 - R$210` (uma faixa nunca real, `fareMax` não vinha do backend) — agora mostra só `R$182,41`, o valor real de `fare.fare[vehicleType]`. Botão de fechar convertido de `<div onClick>` pra `<button aria-label>`. Ícone/cor do método de pagamento extraídos em duas variáveis simples (`paymentIconClass`/`paymentIconColor`) — a primeira versão combinava os dois numa string e usava `.split(' ')` pra separar de volta, desnecessariamente frágil; corrigido na própria execução, sem pedir.

**`OptionalsPanel.jsx`:** lista de opcionais migrada pra array de dados (`OPTIONS`) em vez de JSX repetido; checkboxes envolvidos em `<label>` (área de toque = linha inteira, não só o quadradinho). Botão final "Pronto" inicialmente replicado com a cor preta original do app + `!important` pra forçar o `Button` novo a parecer com o antigo — reavaliado na própria execução: esse preto era um valor avulso, sem nenhuma outra tela do app usando essa cor, então trocado pro `Button` `primary` (verde) padrão, com comentário no código explicando a troca.

**`PaymentOptionsPanel.jsx`:** linhas de seleção Pix/Dinheiro convertidas de `<div onClick>` pra `<button aria-pressed>` (item 7 do relatório). Duas linhas mortas removidas: "Adicionar cartão de crédito" e "Adicionar cupom" — nenhuma das duas tinha `onClick`, eram puramente decorativas. Removidas pelo mesmo critério já aplicado na auditoria de integração (Sprint 4/A7): funcionalidade sem backend real não fica visível como se funcionasse. Sinalizado aqui de forma transparente por ser uma decisão de design, não só limpeza de acessibilidade.

**Sweep de acessibilidade:** grep por `<div...onClick` nos 4 arquivos da etapa não encontrou nenhuma ocorrência restante (as únicas do módulo passageiro estão em `LocationSearchPanel.jsx` e `Header.jsx`, fora do escopo desta etapa).

**Build/testes/lint:** `vite build` limpo. Suíte na mesma baseline (`3 failed | 4 passed`). Lint dos 4 arquivos mostra só os dois padrões pré-existentes em 100% do código-base (React sem uso direto do namespace, ausência de `prop-types`) — confirmado comparando com um arquivo não tocado nesta etapa (`LocationSearchPanel.jsx`), mesmo padrão.

**Verificação ao vivo (Playwright contra o dev server real):** usuário descartável com saldo de carteira criado direto no Mongo. Fluxo completo: login → busca de destino → "Buscar Corrida" → `VehiclePanel` abre com as 3 categorias reais do banco (`car`/`moto`/`auto`) e preços reais → botão "Continuar" confirmado desabilitado antes de selecionar e habilitado depois → seleção de categoria confirmada via `aria-pressed` → `ConfirmRide` abre com trajeto, pagamento e preço únicos agrupados em cards, sem faixa de preço fake → "Opcionais" abre, checkbox "Porta-malas grande" marcável clicando na linha inteira, "Pronto" retorna pro `ConfirmRide` → linha "Forma de pagamento" abre `PaymentOptionsPanel`, saldo da carteira exibido corretamente (R$ 50,00), alternância Pix↔Dinheiro confirmada via `aria-pressed`, ausência confirmada das duas linhas removidas. Nenhum erro de console relacionado às mudanças (só um 404 de recurso não relacionado, pré-existente). Usuário de teste e screenshots removidos ao final.

### Etapa 5 — detalhes da execução

**`LookingForDriver.jsx`:** trajeto/preço/pagamento migrados pra `Card`+`DetailRow` (mesmo padrão das etapas anteriores); corrigido o mesmo tipo de preço-fake do `ConfirmRide` (`R$X - R$undefined`, já que `fareMax` nunca veio do backend) — agora mostra só o valor real. Botão de fechar convertido pra `<button aria-label>`; botão "Cancelar Corrida" migrado pro `Button` variante `danger`.

**Item 5 do relatório (🔴 — busca sem expectativa de tempo):** o achado original era que o backend expira a corrida sozinho depois de 10 minutos sem motorista aceitar, mas isso só é percebido na próxima consulta — não existe nenhum evento de socket avisando o app. Resolver isso de verdade (polling ativo ou push do backend) mudaria lógica de busca de corrida, fora do escopo de uma etapa de redesign visual. Feito o que dá pra fazer só no front, sem tocar nessa lógica: um contador de tempo decorrido (`0:05`, `1:32`...) pra tirar a sensação de tela travada, e — depois de 60s — uma mensagem honesta ("Isso está demorando mais que o normal") que não promete um retry ou cancelamento automático que não existe. Sinalizado aqui que é uma mitigação parcial, não a correção do gap de expiração silenciosa em si.

**`WaitingForDriver.jsx`:** mesma migração pra `Card`+`DetailRow` nos dados da corrida; cores para tokens (`brand-*`, `ink-*`); botão de fechar convertido pra `<button aria-label>`. Cartão do PIN mantido com destaque próprio (não virou `DetailRow`) por ser a informação de segurança mais crítica da tela — achatar junto com o resto reduziria a ênfase visual que ele precisa ter.

**`Riding.jsx` (item 13 — fechamento de modal inconsistente):** o modal pós-corrida era a única tela do fluxo inteiro fechando com um ícone de X (`ri-close-line`) no canto, enquanto todas as outras (`VehiclePanel`, `ConfirmRide`, `OptionalsPanel`, `PaymentOptionsPanel`, `LookingForDriver`, `WaitingForDriver`) usam a alça no topo. Unificado: X removido dos passos `payment`/`rating`, substituído pela mesma alça (`aria-label="Fechar"`) usada em todo o resto do app — some sozinha no passo `done`, onde fechar não faz sentido (a corrida já terminou). Detalhe de trajeto/preço migrado pra `Card`+`DetailRow`; botões de ação pro `Button` padrão (`primary`/`secondary`/`ghost`, com `loading` nos dois pontos assíncronos reais — confirmar pagamento e enviar avaliação). Botões flutuantes de início/chat ganharam `aria-label` (eram ícones sem nenhum texto acessível). Estrelas de avaliação ganharam `aria-label`/`aria-pressed` (eram só ícones clicáveis sem nome acessível). Nenhuma lógica tocada: os três `useEffect` de socket, `handleConfirmPayment`, `handleSubmitReview` e o fetch de mensagens não lidas permanecem byte-a-byte os mesmos.

**Sweep de acessibilidade:** grep por `<div...onClick` nos 3 arquivos não encontrou nenhuma ocorrência restante.

**Build/testes/lint:** `vite build` limpo. Suíte na mesma baseline (`3 failed | 4 passed`). Lint de `Riding.jsx` comparado via `git stash`: os mesmos 7 problemas pré-existentes (nenhum novo, nenhum resolvido — são padrões genéricos do arquivo, não relacionados a esta etapa). `LookingForDriver.jsx`/`WaitingForDriver.jsx` só os dois padrões pré-existentes de todo o código-base.

**Verificação ao vivo — fluxo real ponta a ponta com dois usuários simultâneos** (não dava pra verificar essas 3 telas isoladamente — cada uma só aparece com uma corrida real em andamento): passageiro e motorista descartáveis criados direto no Mongo, dois contextos de navegador em paralelo. Motorista logou e ficou online de verdade; passageiro pediu uma corrida real (fluxo completo de busca → seleção → confirmação, criando a corrida de fato) → `LookingForDriver` abriu com o timer contando (confirmado `0:05` alguns segundos depois de aberto) e sem faixa de preço fake → motorista recebeu a notificação real via socket e aceitou → passageiro transicionou sozinho pro `WaitingForDriver`, PIN lido direto da tela (não do banco) → motorista marcou "A caminho" → "Cheguei ao local" → digitou o PIN lido do passageiro e iniciou a corrida → passageiro foi redirecionado pra `/riding` com os dados corretos → motorista concluiu a corrida → passageiro recebeu o evento `ride-ended` em tempo real, modal de pagamento abriu **confirmado sem nenhum ícone de X** (`0` ocorrências de `.ri-close-line`) e com a alça padrão presente → "Já paguei o motorista" → avaliação (estrela 3 confirmada via `aria-pressed`) → "Enviar Avaliação" → tela "Tudo certo!" → "Voltar ao Início" → de volta em `/home`. Nenhum erro de console em nenhum dos dois navegadores durante todo o fluxo. Toda a base de teste (2 usuários, 1 corrida) removida ao final.

### Etapa 7 — detalhes da execução

**`UserLogin.jsx` / `UserSignup.jsx`:** ícone do Google convertido de `<img src="https://www.svgrepo.com/...">` (hotlink de terceiro, item 5/§1.5 do relatório) pra um componente novo `shared/components/ui/GoogleIcon.jsx` com o SVG oficial embutido no bundle — zero requisição de rede pra renderizar o botão. Inputs e botões migrados pros tokens/`Button`. **Adicionado, fora do escopo original mas na mesma linha do racional do `Button.loading`:** os dois formulários (login e cadastro) não desabilitavam o botão nem davam nenhum feedback durante o `axios.post` — em uma rede lenta, parecia travado, mesmo problema de fundo do item 1 (P0) já corrigido em `Home.jsx` na Etapa 2. Adicionado `loading` state real, sem alterar a lógica de autenticação em si (mesmas chamadas, mesmo tratamento de erro).

**`Start.jsx`:** a mistura de estratégias (imagem de fundo full-bleed no mobile, fundo branco liso no desktop — achado do relatório) foi unificada numa só: a imagem de capa agora aparece em todos os tamanhos de tela. Botão "Começar" e link discreto de admin migrados pra tokens; o link de admin (só um ícone de engrenagem) ganhou `aria-label`. **Autocorreção durante a execução:** a primeira tentativa envolveu um `<Button as="span">` dentro do `<Link>` — prop que não existe no componente e, pior, geraria HTML inválido (botão dentro de link, dois elementos interativos aninhados). Corrigido antes de rodar qualquer verificação: o `Link` em si ganhou as classes visuais do botão primário, sem aninhamento.

**Achado crítico durante a verificação ao vivo desta etapa, com impacto retroativo:** o botão "Entrar" apareceu *invisível* no navegador (texto branco sobre fundo transparente, sobre página branca) apesar do DOM/classes estarem corretos. Investigando, `getComputedStyle` confirmou `background-color: transparent` num elemento com `bg-brand-500` — e uma busca no CSS servido pelo Vite mostrou que **nenhuma classe usando os tokens novos (`brand-*`, `ink-*`, `surface-*`, `rounded-panel`, `shadow-raised`) existia no CSS compilado**, em nenhuma tela, não só nesta. Causa raiz: o servidor de dev do frontend estava rodando desde antes da Etapa 1 (mesmo processo Node, iniciado 09:25) e o Vite/PostCSS nunca recarregou o `tailwind.config.js` de verdade com as extensões de tema adicionadas naquela etapa — precisava de um restart completo com cache limpo (`node_modules/.vite`), HMR sozinho não bastou. Corrigido matando o processo antigo e subindo um novo com o cache apagado; confirmado via `getComputedStyle` que `bg-brand-500` passou a resolver pra `rgb(34, 197, 94)` e `rounded-panel` pra `14px` exatamente como configurado.

**Implicação para as Etapas 1–6:** todo o código e toda a lógica dessas etapas estavam corretos o tempo todo — as classes certas, no lugar certo, aplicadas do jeito certo. O que não estava correto era o CSS que o navegador realmente recebia durante minhas verificações ao vivo anteriores: cores de marca, raio de canto (`rounded-panel`) e sombras (`shadow-raised`/`floating`) nunca apareceram de fato, embora a estrutura, o comportamento, a acessibilidade e os dados exibidos (tudo que eu verifiquei via DOM/assertions, não só screenshot) estivessem certos. Refiz uma checagem visual pontual pós-fix em 3 telas de etapas anteriores (`Home.jsx` ocioso, `VehiclePanel`, `ConfirmRide`) especificamente pra confirmar que os tokens de marca agora renderizam nelas também — confirmado via screenshot e `getComputedStyle` (botão "Continuar" com `rgb(34, 197, 94)`, card selecionado com borda da mesma cor). Não foi necessário alterar nenhum código dessas etapas; o bug era inteiramente do ambiente de desenvolvimento, não do código entregue.

**Build/testes/lint:** `vite build` limpo (build de produção sempre gera CSS do zero, por isso nunca teria esse problema — o bug era específico do dev server de longa duração). Suíte na mesma baseline (`3 failed | 4 passed`) — inclusive `UserLogin.test.jsx` continua falhando pelo mesmo motivo de sempre (mock de navegação), confirmado via `git stash` que a mensagem de erro é idêntica à baseline, só as classes CSS no snapshot mudaram. Lint comparado via `git stash`: mesmos problemas pré-existentes, nenhum novo.

**Verificação ao vivo (Playwright contra o dev server real, já com o fix do cache):** `Start.jsx` → `UserLogin.jsx` (ícone do Google confirmado como SVG local via seletor `svg`, ausência confirmada de qualquer `<img src*="svgrepo.com">`; estado de loading confirmado desabilitando o botão durante um login lento simulado; toast de erro em credenciais inválidas) → `UserSignup.jsx` (mesmo ícone local confirmado). Nenhum erro de console.

### Etapa 8 — detalhes da execução

**Item 15 (contraste do verde de marca como texto solto):** adicionado `brand-700` (`#15803d`, ~4.5:1 sobre branco — passa AA pra texto normal) ao token, documentado no próprio `tailwind.config.js` o motivo de `brand-500`/`600` não servirem pra texto solto (ficam por volta de 2.6:1 e 3.4:1). Trocado `text-brand-600`/`text-brand-500` → `text-brand-700` em todo texto realmente lido como texto — links ("Criar uma conta", "Faça login aqui", "Termos de Uso"/"Política de Privacidade"), rótulos pequenos ("Partida"/"Destino" em `Home.jsx`), "Buscando motoristas próximos...", valor de transação na carteira, placa do motorista em `WaitingForDriver.jsx`, itens do menu do `Header.jsx`. **Decisão explícita de escopo:** ícones (`<i className="text-brand-500">`) não foram tocados — o item do relatório fala especificamente de "texto solto", e ícones seguem outra regra de contraste (WCAG 1.4.11, 3:1, pra componentes gráficos) que mudaria a aparência de praticamente toda tela do app se generalizada sem pedido explícito. O OTP grande (`text-3xl font-bold`) e a placa em contextos de texto grande/negrito mantiveram `brand-600` onde já qualificam como "texto grande" (limiar AA de 3:1, não 4.5:1).

**Item 16 (`React.memo` em painéis pesados):** `LiveTracking.jsx` (o mapa Leaflet/OSM, o componente mais pesado do app) envolvido em `memo()`. Em `Home.jsx`, o callback `onMapCenterChange` passado a ele foi trocado de uma arrow function nova a cada render para um `useCallback` estável — sem isso o `memo` não tem efeito nenhum (prop de função nova = comparação rasa sempre falha). **Ressalva registrada com honestidade:** digitar no campo de busca ainda re-renderiza o mapa quando o campo em edição é literalmente `pickup`/`destination` (esses states alimentam o input controlado E são props do mapa ao mesmo tempo — mudança real de prop, não desperdício). O ganho do `memo` é evitar que o mapa re-renderize por causa de qualquer *outro* estado não relacionado mudando em `Home.jsx` (toasts, painéis abrindo/fechando, loading de tarifa etc.) — que é o cenário real de desperdício descrito no relatório. Maior benefício, sem nenhuma ressalva: `Riding.jsx` passa `ride` (uma referência que nunca muda depois do mount) — ali o `memo` blinda o mapa de re-renderizar a cada mudança de contador de mensagens não lidas, passo do modal, etc.

**Item 18 (permissão de notificação sem contexto):** `Home.jsx` não chama mais `Notification.requestPermission()` direto no mount. Agora: se a permissão já foi decidida (concedida ou negada), respeita e segue o fluxo de sempre; se nunca foi perguntada (`'default'`) e o usuário nunca viu o cartão antes (flag em `localStorage`), mostra um cartão explicando o motivo ("Avisamos quando seu motorista aceitar, chegar e iniciar a corrida") com dois botões — "Ativar" (só agora dispara o prompt nativo do navegador) e "Agora não" (fecha e não pergunta de novo neste navegador). A decisão de guardar a flag em ambos os casos — não só no "Agora não" — evita repetir o cartão a cada visita depois que o usuário já decidiu via prompt nativo também.

**Item 17 (mensagens de erro diferenciadas):** novo helper `frontend/src/services/errorMessages.js` (`getFriendlyErrorMessage`) que distingue timeout, falha de rede/servidor inacessível, erro 5xx e erro 4xx-com-mensagem-do-backend — hoje a maioria dos `catch` só mostrava a mensagem crua do backend (que não existe pra falhas de infraestrutura) ou um genérico fixo. Aplicado nos pontos mais críticos e já tocados nesta sessão: `findTrip`/`createRide`/`cancelRide` em `Home.jsx`, `handleConfirmPayment`/`handleSubmitReview` em `Riding.jsx`. **Decisão explícita de escopo, com justificativa de risco:** o app tem uma instância axios compartilhada já pronta (`services/axios.js`, com interceptor de auth/401) que **nenhum dos 14 arquivos do módulo passageiro usa** — todos importam `axios` puro e montam o header manualmente. Migrar todos os call sites pra essa instância resolveria o problema de uma vez (interceptor genérico de verdade), mas os testes (`Home.test.jsx`, `UserLogin.test.jsx`, `UserSignup.test.jsx`) fazem `vi.mock('axios')` e configuram `axios.post.mockResolvedValueOnce(...)` diretamente no módulo `axios` — trocar pra uma instância via `axios.create()` quebraria esses mocks (o mock não segue pra dentro de `.create()`), convertendo falhas de teste conhecidas em crashes de teste desconhecidos. Optei por não arriscar a baseline de testes numa etapa de polimento; a instância compartilhada foi atualizada com a mesma lógica (`error.friendlyMessage`) e fica pronta pra uma migração futura deliberada, fora desta sessão.

**Sweep de acessibilidade:** grep por `<div onClick>`/`<i onClick>` nos arquivos tocados não encontrou nenhuma ocorrência nova.

**Build/testes/lint:** `vite build` limpo. Suíte na mesma baseline (`3 failed | 4 passed`). Lint comparado via `git stash`: `LiveTracking.jsx` isolado foi de 70 problemas (arquivo original, pré-redesign) pra 65 (soma das melhorias das Etapas 3 e 8, nenhuma delas introduzindo categoria nova); `Home.jsx`/`Riding.jsx`/`errorMessages.js`/`axios.js` sem nenhum problema novo.

**Verificação ao vivo (Playwright contra o dev server real):** mensagens de erro diferenciadas confirmadas forçando uma falha de rede (`route.abort`) e um 500 (`route.fulfill`) na chamada de tarifa — as duas mensagens corretas apareceram, e o fluxo normal continuou funcionando depois. Cartão de notificação: no Chromium headless, `Notification.permission` já vem `'denied'` por padrão (confirmado que o cartão corretamente NÃO aparece nesse caso); forçando `'default'` via script de inicialização do navegador, confirmado que o cartão aparece, que o prompt nativo só é chamado depois de clicar "Ativar" (não antes), que o cartão some e a flag é salva, e que não reaparece num reload da página. Nenhum erro de console. Usuário de teste e scripts removidos ao final.

---

## 20. Encerramento

As 8 etapas do plano foram executadas e verificadas ao vivo. Resumo do que mudou, de ponta a ponta:

- **Fundação** (Etapa 1): tokens de design (`tailwind.config.js`) e 9 componentes de UI reutilizáveis em `shared/components/ui/`, criados sem sobrescrever nada do sistema antigo do Tailwind.
- **Fluxo completo do passageiro redesenhado** (Etapas 2, 4, 5): busca → seleção de veículo → confirmação → acompanhamento → pagamento → avaliação, com todos os bugs de UX do relatório original corrigidos (loading ausente, preço-fake, status de corrida quebrado, fechamento de modal inconsistente) e mais alguns achados ao vivo não previstos na auditoria original.
- **Mapa e HUD** (Etapa 3): bug real de produção corrigido (`LiveTracking` nunca mostrava "corrida em andamento"), provado com um teste E2E de dois usuários reais.
- **Histórico e conta** (Etapa 6): 15 arquivos migrados pro sistema de design novo, com remoção de falsas affordances de clique em telas sem backend.
- **Autenticação** (Etapa 7): ícone de terceiro removido, e um achado crítico de ambiente (cache do Vite/Tailwind desatualizado desde o início da sessão) descoberto e corrigido, com confirmação retroativa de que o código das etapas anteriores sempre esteve correto.
- **Polimento transversal** (Etapa 8): contraste AA, performance de re-render, contexto antes de pedir permissão de notificação, e mensagens de erro diferenciadas nos fluxos mais críticos.

Nada foi commitado — todas as mudanças estão no working directory, aguardando revisão.

### Etapa 6 — detalhes da execução

**Novo componente:** `Skeleton`/`RideCardSkeleton` (`shared/components/ui/Skeleton.jsx`) — item 11 do relatório (🟡 P2, loading de lista era spinner central, não skeleton). Usado só no carregamento inicial de `Activity.jsx` (lista vazia); "carregar mais" continua com spinner pequeno no rodapé, que já era o padrão certo pra paginação.

**`Activity.jsx`:** cards de corrida convertidos de `<div onClick>` pra `<button>`; selo de status trocado pelo `StatusBadge` (cor+texto já era o padrão certo aqui, só trocando a implementação manual pelo componente compartilhado); botão de fechar do modal e "Repetir Corrida" migrados pra tokens/`Button`; estado vazio migrado pro `EmptyState`.

**`Header.jsx`** (menu flutuante do passageiro): tokens aplicados; botão do menu (☰) ganhou `aria-label="Abrir menu"` — era um ícone sozinho sem nome acessível.

**`Account.jsx` + subpáginas (13 arquivos):** aplicado o mesmo tratamento em todas — cabeçalho "seta-voltar + título" repetido à mão em 6+ arquivos substituído pelo `PageHeader` (criado na Etapa 1, não usado em lugar nenhum até agora); linhas de lista clicáveis (`<li onClick>`/`<div onClick>`) convertidas pra `DetailRow`; botões primários pro `Button`; toggle de mostrar/ocultar senha (`ChangePassword.jsx`, `DeleteAccount.jsx`) convertido de `<i onClick>` pra `<button aria-label>`.

**Achado durante a execução, fora do que o relatório original listou:** vários itens nessas telas (`Cards.jsx`, `Favorites.jsx`, `Wallet.jsx`) tinham `cursor-pointer`/estilo de hover em elementos **sem nenhum `onClick`** — "Casa"/"Trabalho" em Favoritos, os botões "Adicionar"/"Cartões"/Pix/Transferir/Comprovantes na Carteira. Isso é o mesmo problema já identificado no item 3 do relatório ("divs decorativas sem função") mas em telas que não tinham sido lidas na auditoria original porque já estavam deslinkadas do menu principal (A7). Decisão: **remover a aparência de clicável desses itens específicos, sem adicionar `onClick` nenhum** — plausível parecer clicável sem fazer nada é pior que não parecer, e adicionar a ação de verdade está fora do escopo (essas rotas de backend não existem — `/users/cards`, `/users/favorites`, `/users/wallet`, `/users/coupons`, `/users/scheduled`). As duas linhas "Sessões ativas"/"Dispositivos conectados" em `Profile.jsx` (já marcadas "Em breve" no original) foram deixadas sem `trailing` (sem seta), pelo mesmo motivo.

**`DeleteAccount.jsx`:** achei a variante `danger` do `Button` (fundo claro, usada em "Cancelar Corrida") fraca demais pra excluir conta — a ação mais irreversível do app inteiro. Em vez de forçar isso com classes `!important` sobre o `Button` (do jeito que já me corrigi antes nesta mesma tarefa, ver Etapa 4), adicionei uma variante nova e limpa ao componente compartilhado: `dangerSolid` (vermelho sólido), reservada só pra esse tipo de ação — documentado com comentário no próprio `Button.jsx` pra não virar a variante padrão de qualquer botão vermelho.

**Sweep de acessibilidade:** grep por `<div onClick>`/`<i onClick>` nos 15 arquivos da etapa não encontrou nenhuma ocorrência restante.

**Build/testes/lint:** `vite build` limpo. Suíte na mesma baseline (`3 failed | 4 passed`). Lint comparado via `git stash` num subconjunto representativo (`Header.jsx`, `Cards.jsx`, `Activity.jsx`): exatamente os mesmos problemas pré-existentes (React sem uso do namespace, `error` de `catch` sem uso, `prop-types` ausente) — nenhuma categoria nova.

**Verificação ao vivo (Playwright contra o dev server real):** usuário descartável com 2 corridas de histórico (uma finalizada, uma cancelada) criadas direto no Mongo. Fluxo: login → `/activity` mostra os 2 cards reais com status corretos → abrir modal de detalhes → fechar → menu do header (`aria-label` confirmado) → `/account` → `Profile` → `PersonalData` → `ChangePassword` (toggle de senha confirmado como botão acessível) → `Terms` → `Privacy`, todos navegando corretamente com o `PageHeader` novo → `DeleteAccount`: botão de confirmação checado desabilitado antes de digitar "EXCLUIR" + senha e habilitado depois (sem de fato clicar — evitando excluir a conta de teste no meio da verificação) → `Help`. Nenhum erro de console relacionado às mudanças (só avisos de GPS esperados, por não ter concedido permissão de geolocalização nesse teste específico). Usuário, corridas e screenshots removidos ao final.
