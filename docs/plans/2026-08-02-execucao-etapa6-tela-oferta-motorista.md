# Execução — Etapa 6 (Tela de Oferta) — App do Motorista

**Base:** [auditoria de UX/UI de 2026-08-02](2026-08-02-auditoria-ux-motorista.md), §2.9, §2.10 e item 9 do plano ("Médio").
**Escopo:** countdown no popup de nova corrida; distância até o passageiro (não a distância da corrida); valor único em vez de faixa; categoria do veículo; corrigir o painel travado no 409.
**Status:** ✅ concluído e verificado em 2026-08-02. Nada commitado.

## Achados que mudaram o escopo, confirmados no código antes de implementar

1. **A "faixa de preço" nunca foi uma faixa.** `estimatedPriceMin` e `estimatedPriceMax` são gravados com **o mesmo valor** (`pricing.finalFare`) em `ride.service.js:createRide` — o popup sempre mostrou "R$ X - R$ X", o mesmo número duplicado. Trocado por `ride.fare` (campo real, único).
2. **Não existia nenhuma coordenada de embarque persistida na corrida** — só a distância/tempo da corrida inteira (`estimatedDistance`/`estimatedTime`), nunca "a quantos km VOCÊ está do passageiro". As coordenadas já eram calculadas no despacho (`mapService.getAddressCoordinate`), só nunca guardadas.
3. **O bug real por trás de "corrigir a corrida do painel no 409":** `RidePopUp` abre o `ConfirmRidePopUp` de forma otimista **antes** da resposta da API (pro caso de rede offline). O `catch` do 409 fechava só o `RidePopUp`, nunca o `ConfirmRidePopUp` — um motorista que perdia a corrida por concorrência via o painel "Iniciar a Corrida" pendurado aberto com a corrida zerada.

## O que muda

| Arquivo | Mudança |
|---|---|
| `Backend/models/ride.model.js` | Novo campo `pickupCoordinates: {lat, lng}`. |
| `Backend/controllers/ride.controller.js` | `dispatchRideToCaptains` passa a persistir `pickupCoordinates` (resolvidas ali mesmo para a busca por raio) via `findOneAndUpdate` — sem chamada extra de geocoding, reaproveita a mesma consulta que já existia. Vale tanto pra `createRide` quanto pro redespacho de `captainCancelRide` (mesma função). |
| `frontend/src/modules/driver/components/RidePopUp.jsx` | Countdown de 20s (barra + número, muda pra vermelho nos últimos 5s, auto-ignora ao zerar); distância até o motorista calculada localmente via haversine (`pickupCoordinates` da corrida × posição GPS real do motorista, do `LocationContext`); categoria do veículo (`vehicleLabels`); valor único (`ride.fare`) no lugar da falsa faixa. |
| `frontend/src/modules/driver/pages/CaptainHome.jsx` | Passa `open={ridePopupPanel}` pro `RidePopUp` (necessário pro countdown saber quando está de fato visível); no `catch` do 409 de `confirmRide`, fecha também `confirmRidePopupPanel` (bug real corrigido). |

**Como verifico:** build limpo, suíte do backend (mudou model + controller) e do frontend, verificação ao vivo criando uma corrida real com coordenadas conhecidas e conferindo a distância calculada.

**Nada será commitado sem pedido explícito.**

---

## Detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

Tudo implementado exatamente como mapeado. Sem desvios do plano nesta etapa.

**Build:** `vite build` limpo. **Testes:** backend `85 passes` (mesma baseline, o `ride.model.js`/`ride.controller.js` não quebrou nenhum teste existente); frontend na baseline de sempre (`3 falhas | 4 passes`).

**Verificação ao vivo (servidor de dev real, Atlas real, navegador real):** motorista posicionado a ~1,6 km de um ponto de embarque real (Avenida Paulista, 1500). Passageiro cria a corrida via API real. No Atlas, confirmado que `pickupCoordinates` foi persistido na corrida pelo despacho. Na tela do motorista, o popup mostra: countdown "20s" com barra verde decrescendo (confirmado numericamente decrescendo de verdade — 20s → 17s em 3 segundos reais de espera), "1.6 km até você" (bate com a distância real entre as coordenadas usadas), "MoveGo" como categoria, "R$ 138,68" como valor único (sem mais a faixa "R$X - R$X" idêntica). Todos os 5 testes automatizados desta verificação passaram.

**Nada foi commitado.**
