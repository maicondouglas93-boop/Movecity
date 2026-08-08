# Piscar do mapa ao voltar pra Home (passageiro e motorista) — Plano

## Diagnóstico (confirmado por código, não suposição)

`Home.jsx` (passageiro) e `CaptainHome.jsx` (motorista) usam o mesmo componente
compartilhado `shared/components/LiveTracking.jsx`. As rotas (`AppRoutes.jsx` →
`passengerRoutes`/`driverRoutes`) são `<Route>` chapadas, sem layout persistente —
sair da Home (qualquer tela) e voltar **desmonta e remonta tudo**, inclusive o
`LiveTracking`.

O efeito de inicialização do mapa (`useEffect(..., [hasPosition, retryKey])`) roda
do zero a cada montagem e cria uma instância NOVA do mapa:
- Google (`googleMapsProvider.js:312`): `new googleMaps.Map(domNode, ...)` — só o
  script do SDK fica em cache (promise de módulo), o objeto `Map` não.
- Leaflet (`leafletProvider.js:264`): `L.map(domNode, ...)` + `L.tileLayer(...)`
  novos — já existe ali um `setTimeout(() => map.invalidateSize())` comentado como
  "Fix gray tiles on initial render", confirmando que esse tipo de falha no
  primeiro desenho já é conhecido.

Resultado: toda volta pra Home reconstrói o mapa do zero — div em branco → mapa
novo → tiles aparecendo — o que lê como "piscar".

Adicional: `hasPosition` começa sempre `false` (`useState(false)`), então a cada
remontagem aparece por um instante o texto "Obtendo localização..." antes do mapa,
mesmo com `LocationContext` já tendo uma posição válida (o GPS roda continuamente
a nível de app, nunca para) — mais um flash curto na mesma sequência.

## Decisão do usuário

Entre suavizar a transição (baixo risco) e manter a Home sempre montada (correção
definitiva, mexe em rotas), o usuário escolheu **suavizar a transição** agora.

## Escopo desta correção

Só em `shared/components/LiveTracking.jsx` (componente único, usado pelos dois
apps — corrige os dois de uma vez):

1. `hasPosition` passa a inicializar direto de `userLocation` (lazy init do
   `useState`) em vez de sempre `false` — se o contexto já tem posição (caso comum
   numa remontagem, já que o GPS roda contínuo), pula o flash do texto
   "Obtendo localização...".
2. O `<div ref={mapRef}>` onde o provider desenha o mapa ganha uma transição de
   opacidade: `opacity-0` enquanto `mapReady` é `false`, `opacity-100` quando fica
   `true` (esse estado já existe, só não controlava nada visual). O corte seco de
   "div em branco → mapa pronto" vira um fade suave.

Não elimina a reconstrução do mapa em si (ainda recria a instância, ainda busca
tiles) — só troca o corte abrupto por uma transição suave, exatamente o que foi
pedido. A correção definitiva (manter Home sempre montada) fica registrada aqui
como possível próximo passo, não implementada agora.

## Verificação

Build (main + driver) e suíte de testes depois da mudança.

## Resultado

Implementado só em `shared/components/LiveTracking.jsx` (2 mudanças pontuais, sem
tocar rotas nem lógica de dados):

1. `hasPosition` inicializa com `useState(() => Boolean(userLocation))` em vez de
   sempre `false` — pula o flash de "Obtendo localização..." numa remontagem onde
   o GPS já tinha posição.
2. O `<div ref={mapRef}>` ganhou `transition-opacity duration-300 ease-out` +
   `opacity-0`/`opacity-100` controlado por `mapReady` (estado que já existia, só
   não tinha efeito visual) — o corte seco de "div em branco → mapa novo" virou
   fade.

`npx vitest run` (frontend) — 18/18 arquivos, 92/92 testes. `npm run build` +
`npm run build:driver` — ambos ok. Não elimina a reconstrução do mapa em si (seria
a correção definitiva, registrada acima como possível próximo passo) — só suaviza
a transição, conforme decidido.
