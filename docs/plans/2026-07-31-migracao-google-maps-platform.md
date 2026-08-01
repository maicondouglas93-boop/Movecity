# Migração do sistema de mapas/localização para Google Maps Platform

- **Data:** 2026-07-31
- **Status:** ✅ Aprovado — aguardando decisões D1/D4 antes da Etapa 1
- **Escopo:** `frontend/` (app passageiro + motorista) e `Backend/`. `admin-frontend/` fora do escopo inicial (ver §8)

---

## 1. Diagnóstico da arquitetura atual

### 1.1 Situação real (não é o que a documentação sugere)

A arquitetura **já é parcialmente Google**. A chave `GOOGLE_MAPS_API` no `Backend/.env` é uma chave real (formato `AIza…`, 39 chars), não o placeholder `dummy-google-maps-api-key`. Como todo o `maps.service.js` decide o provedor com `isGoogle = apiKey && apiKey !== 'dummy-...'`, os branches Google estão **ativos em produção hoje**.

| Capacidade | Provedor real hoje | Onde | Observação |
|---|---|---|---|
| Renderização do mapa | **Leaflet 1.9.4 + tiles OSM** | `shared/components/LiveTracking.jsx` | Único componente de mapa do app |
| Autocomplete | **Google Places (legacy)** | `maps.service.js:252` | Ativo, mas **sem lat/lng** — ver §2.1 |
| Geocoding (endereço→coord) | **Google Geocoding** | `maps.service.js:58` | Ativo |
| Geocoding reverso | **Photon/Komoot** | `Home.jsx:83,129,320` | Chamado **direto do browser**, fora do backend |
| Rotas (preço) | **OSRM público** | `maps.service.js:119` | `PRIMARY_ROUTING_ENGINE` default `graphhopper`, mas `GRAPHHOPPER_API_KEY` **não existe** → throw → fallback OSRM |
| Rotas (desenho no mapa) | **OSRM público** | `LiveTracking.jsx:336` | Chamado **direto do browser**, independente do backend |
| Busca de motoristas | Mongo (sem geo) | `maps.service.js:283` | Raio calculado e **nunca usado** — ver §2.4 |

**Conclusão:** a migração real é de **3 peças**, não 4 — renderização (Leaflet→Google JS), rotas (OSRM→Routes API) e reverso (Photon→Google). Geocoding e autocomplete já são Google, mas precisam ser corrigidos e modernizados.

### 1.2 Estrutura de armazenamento de coordenadas

Três convenções coexistem, e isso é a maior fonte de risco de inversão lat/lng:

| Local | Formato | Ordem |
|---|---|---|
| `captain.location` | `{ ltd, lng }` | — (nomeado, `ltd` = latitude) |
| `captain.locationGeoJSON` | `{ type:'Point', coordinates:[…] }` | **`[lng, lat]`** (padrão GeoJSON) |
| `ride.lastLocation` | `{ lat, lng }` | — (usa `lat`, não `ltd`) |
| `ride.pickup` / `ride.destination` | **`String`** | `"Endereço, Bairro (-20.1500, -41.6200)"` |
| Socket `update-location-captain` | `{ ltd, lng }` | — |

O campo `ride.pickup`/`destination` é uma **string com coordenadas embutidas por regex** (`maps.service.js:20`). É o contrato de fato entre frontend e backend e está persistido no Mongo. **A migração não vai alterá-lo** (ver risco R5).

### 1.3 Fluxo de criação de corrida (onde o mapa entra)

```
Home.jsx: digita destino
   └─ debounce 400ms → GET /maps/get-suggestions        [Google Places]
        └─ LocationSearchPanel: monta {address, lat, lng}
             └─ findTrip(): "endereço (lat, lng)"
                  └─ GET /rides/get-fare                 [OSRM → distância/tempo]
                       └─ PricingEngine.calculateFare()  ⚠️ PREÇO DERIVA DAQUI
                            └─ POST /rides/create
                                 └─ getAddressCoordinate(pickup)  [regex ou Google]
                                      └─ getCaptainsInTheRadius() [sem raio real]
                                           └─ socket 'new-ride'
```

### 1.4 Rastreamento em tempo real (não muda)

```
CaptainHome.jsx  ──emit 'update-location-captain' {ltd,lng}──►  socket.js
                     (10s real / 2s simulado)                      │
                                                                   ├─ persiste captain.location + locationGeoJSON
                                                                   ├─ acumula ride.actualDistance (haversine, filtro 5m–2km)
                                                                   ├─ emit 'captain-location-updated' → passageiro
                                                                   └─ emit 'admin-captain-location-updated' → admin_room
```

Conforme seu requisito, **esta camada permanece intacta**. O Google entra apenas na visualização dessas posições.

### 1.5 Componentes React que dependem de mapa

| Componente | Telas que usam | Props |
|---|---|---|
| `shared/components/LiveTracking.jsx` (687 linhas) | Home, Riding, CaptainHome, CaptainRiding | `ride`, `pickup`, `destination`, `vehicleType`, `isSelectingOnMap`, `onMapCenterChange`, `showSearchRadius` |
| `modules/passenger/components/LocationSearchPanel.jsx` | Home | consome `suggestion.lat/lng` |

`LiveTracking` é **o único componente de mapa do app** e serve passageiro e motorista simultaneamente. Toda a superfície de risco visual está nele.

### 1.6 Variáveis de ambiente

| Var | Onde | Estado |
|---|---|---|
| `GOOGLE_MAPS_API` | `Backend/.env` | ✅ chave real — **ausente no `.env.example`** |
| `GRAPHHOPPER_API_KEY` | `Backend/.env` | ❌ não existe (código a referencia) |
| `PRIMARY_ROUTING_ENGINE` | `Backend/.env` | ❌ não existe (default `graphhopper`) |
| *(nenhuma chave de mapas)* | `frontend/.env` | ❌ o frontend **não tem** chave Google |

---

## 2. Achados da auditoria (bugs que a migração precisa resolver)

### 2.1 🔴 O autocomplete Google não retorna coordenadas — quebra o endereço da corrida

`maps.service.js:260-269`, branch Google, retorna apenas `{text, title, subtitle}`. O branch Nominatim (`:223-230`) retorna **também** `lat` e `lng`. Como a chave Google é real, o branch ativo é o **sem coordenadas**.

Cadeia do defeito:
1. `LocationSearchPanel.jsx:6-10` monta `{address, lat: undefined, lng: undefined}`
2. `Home.jsx:450` monta `` `${pickup.address} (undefined, undefined)` ``
3. `getAddressCoordinate` (`:20`) tenta o regex `/\((-?\d+\.\d+),\s*(-?\d+\.\d+)\)$/` → **não casa**
4. Cai no geocoding da string inteira, **incluindo o literal `(undefined, undefined)`**, degradando a precisão do ponto de embarque

Causa raiz: a Places Autocomplete não devolve coordenadas por design — exige **Place Details** ou a Places API (New) com `fieldMask`. A migração corrige isso na origem.

### 2.2 🟠 Rotas duplicadas e desacopladas
O backend calcula a rota (para preço) e o frontend calcula **outra rota independente** direto no browser (`LiveTracking.jsx:336`). Hoje ambos são OSRM e coincidem. Se migrarmos só um dos dois, **o preço e a linha desenhada passam a divergir**. O `polyline` que o backend devolve em `getFare` **não é consumido por ninguém** no frontend.

### 2.3 🟠 `/maps/*` é público
`maps.routes.js` importa `authMiddleware` e **não aplica em nenhuma rota**. Hoje isso expõe o Nominatim/Google a abuso. Depois da migração, vira **um proxy de custo direto na sua fatura Google**. Precisa fechar junto (ver Etapa 1).

### 2.4 🟡 `getCaptainsInTheRadius` ignora o raio
`maps.service.js:290` calcula `radiusInRadians` e nunca usa; a query filtra só `socketId` + `canReceiveRides`, com `.limit(20)`. O índice `2dsphere` existe e está ocioso. **Fora do escopo desta migração** (é matching, não mapas), mas registrado porque o índice geoespacial é pré-requisito de qualquer melhoria futura de ETA.

---

## 3. Arquitetura alvo — camada de abstração

Princípio de segurança: **a assinatura pública de `maps.service.js` não muda**. Assim `ride.service.js`, `ride.controller.js` e `socket.js` **não são tocados**.

### Backend
```
Backend/services/maps.service.js        (MANTÉM API pública: getAddressCoordinate,
                                         getDistanceTime, getAutoCompleteSuggestions,
                                         getCaptainsInTheRadius, haversineKm)
        └── maps/
            ├── index.js                (seleciona provider por env MAPS_PROVIDER)
            ├── google.provider.js      (Geocoding + Places New + Routes API)
            ├── osm.provider.js         (Nominatim + OSRM — código atual, p/ rollback)
            └── contract.js             (shape de retorno normalizado + validação)
```

### Frontend
```
frontend/src/services/maps/
            ├── index.js                (seleciona por VITE_MAPS_PROVIDER)
            ├── googleMapsProvider.js   (Maps JS API via @googlemaps/js-api-loader)
            ├── leafletProvider.js      (extraído do LiveTracking atual — rollback)
            └── mapContract.js          (init, addMarker, drawRoute, fitBounds,
                                         panTo, setCenter, destroy)

frontend/src/shared/components/LiveTracking.jsx
            └── vira orquestrador: mantém TODA a lógica de negócio
               (interpolação, poda de rota, follow mode, filtro de coords)
               e delega só o desenho ao provider
```

**Contrato normalizado** (idêntico entre providers, para o preço não mudar de shape):
```js
// getDistanceTime →
{ distance: { text, value /* metros */ },
  duration: { text, value /* segundos */ },
  polyline: [[lat, lng], ...] }

// getAutoCompleteSuggestions →
{ text, title, subtitle, lat, lng, placeId }   // ← lat/lng SEMPRE preenchidos
```

---

## 4. Arquivos que serão modificados

### Backend (6 modificados, 4 novos)
| Arquivo | Ação |
|---|---|
| `services/maps.service.js` | Refatorar em provider; **API pública inalterada** |
| `services/maps/google.provider.js` | 🆕 Geocoding + Places (New) + Routes API |
| `services/maps/osm.provider.js` | 🆕 código atual extraído (rollback) |
| `services/maps/index.js` | 🆕 seletor por env |
| `services/maps/contract.js` | 🆕 normalização + validação de shape |
| `controllers/map.controller.js` | + `getPlaceDetails`, + `getReverseGeocode` |
| `routes/maps.routes.js` | + `authUser`/`authBoth` (fecha §2.3), + 2 rotas |
| `.env` / `.env.example` | + `MAPS_PROVIDER`, documentar `GOOGLE_MAPS_API` |
| `services/__mocks__/maps.service.js` | Atualizar mock p/ novo contrato |

### Frontend (5 modificados, 5 novos)
| Arquivo | Ação |
|---|---|
| `shared/components/LiveTracking.jsx` | ⚠️ **maior risco** — trocar camada de desenho |
| `services/maps/*` (4 arquivos) | 🆕 abstração + providers |
| `services/mapsApi.js` | 🆕 cliente HTTP p/ `/maps/*` (hoje disperso em `Home.jsx`) |
| `modules/passenger/pages/Home.jsx` | Trocar 3× `photon.komoot.io` por `/maps/reverse-geocode` |
| `modules/passenger/components/LocationSearchPanel.jsx` | Passar `placeId` adiante |
| `.env` / `.env.example` | + `VITE_GOOGLE_MAPS_API_KEY`, `VITE_GOOGLE_MAPS_MAP_ID`, `VITE_MAPS_PROVIDER` |
| `package.json` | + `@googlemaps/js-api-loader`; `leaflet` **fica** até o rollback expirar |
| `vitest.setup.js` | + mock do `google.maps` |

**Não serão tocados:** `socket.js`, `ride.service.js`, `ride.controller.js`, `pricingEngine.service.js`, todos os models, `CaptainHome.jsx`/`CaptainRiding.jsx` (o emit de GPS não muda), `contexts/LocationContext.jsx`.

---

## 5. Riscos

| # | Risco | Sev | Mitigação |
|---|---|---|---|
| **R1** | **O preço das corridas muda.** `PricingEngine` deriva de `distance`+`time` do roteador. Google Routes usa duração **com trânsito**; OSRM usa fluxo livre. A duração tende a subir → **tarifas sobem sem ninguém decidir isso** | 🔴 | Etapa 0 de comparação: rodar N rotas reais nos dois motores e medir Δ%. **Decisão de negócio sua** antes de ligar em produção. Alternativa: usar `TRAFFIC_UNAWARE` no Routes p/ manter paridade |
| **R2** | **Custo/fatura.** Sem quota, um loop de autocomplete gera fatura alta. Places é cobrada por sessão | 🔴 | Session tokens obrigatórios; debounce 400ms (já existe); cache backend (já existe); **quota diária por API no console**; budget alert; `/maps/*` autenticado |
| **R3** | **Chave exposta.** A chave do Maps JS é pública por natureza | 🔴 | **Duas chaves distintas**: frontend restrita por HTTP referrer + só Maps JS; backend restrita por IP + só Geocoding/Places/Routes. **Nunca** reusar a do backend no browser |
| **R4** | `LiveTracking` serve 4 telas de 2 fluxos. Regressão quebra passageiro **e** motorista simultaneamente | 🔴 | Feature flag por env; provider Leaflet mantido; teste manual das 4 telas antes do merge |
| **R5** | Formato `"Endereço (lat, lng)"` está **persistido no Mongo** em corridas existentes | 🟠 | **Não alterar o formato.** Corrigir só o preenchimento de lat/lng na origem (§2.1). `placeId` viaja em paralelo, sem substituir |
| **R6** | Inversão lat/lng — 3 convenções coexistem (`ltd`/`lat`/GeoJSON `[lng,lat]`) | 🟠 | `contract.js` valida faixa (-90..90 / -180..180) e falha alto; testes unitários com coords do ES/BR |
| **R7** | `google.maps.Marker` está depreciado; `AdvancedMarkerElement` exige `mapId` | 🟠 | Já nascer com `AdvancedMarkerElement` + `VITE_GOOGLE_MAPS_MAP_ID` (Cloud-based Map Styling) |
| **R8** | Testes: `Home.test.jsx` **já falha** no baseline; mockar `google.maps` em jsdom é mais trabalhoso que Leaflet | 🟠 | Mock em `vitest.setup.js`; não confundir com o baseline conhecido (3 falhas) |
| **R9** | PWA/offline: script do Google não pode ser pré-cacheado pelo Workbox | 🟡 | Excluir o host do `globPatterns`/runtime caching; degradar para "mapa indisponível offline" |
| **R10** | Admin continua em `react-leaflet` → duas libs no monorepo | 🟡 | Aceito no escopo inicial; Fase 2 (§8) |

---

## 6. Plano de implementação em etapas

Cada etapa termina com build + testes verdes e é mergeável isoladamente.

### Etapa 0 — Comparação de motores (**sem código de produção**)
Script descartável que roda ~30 rotas reais (pares pickup/destination do banco) em OSRM e em Google Routes, e tabula Δdistância, Δduração e **Δpreço final** via `PricingEngine`.
**Saída:** tabela para você decidir sobre R1. **Bloqueia todas as demais etapas.**

### Etapa 1 — Segurança e chaves (pré-requisito de custo)
- Criar 2 chaves no Google Cloud com restrições (R3)
- Aplicar `authUser`/`authBoth` em `/maps/*` (§2.3)
- Configurar quotas diárias + budget alert
- Documentar vars em `.env.example`
**Verificação:** `/maps/get-suggestions` sem token → 401.

### Etapa 2 — Camada de abstração backend (**comportamento idêntico**)
Extrair o código atual para `osm.provider.js`, criar `contract.js` e `index.js`. `MAPS_PROVIDER=osm` (default).
**Verificação:** testes de integração passam sem alteração; resposta de `/maps/*` byte-a-byte igual.

### Etapa 3 — Provider Google no backend
Implementar `google.provider.js`: Geocoding, **Places (New) com session token + lat/lng** (corrige §2.1), Routes API, e `reverse-geocode`.
**Verificação:** com `MAPS_PROVIDER=google`, autocomplete devolve `lat`/`lng` preenchidos; teste de contrato compara shape entre os dois providers.

### Etapa 4 — Frontend: eliminar chamadas diretas a terceiros
Trocar as 3 chamadas a `photon.komoot.io` em `Home.jsx` por `/maps/reverse-geocode`.
**Verificação:** nenhuma requisição a domínio de terceiros no Network tab; "usar minha localização" e "escolher no mapa" seguem funcionando.

### Etapa 5 — Camada de abstração frontend (**ainda Leaflet**)
Extrair o desenho do `LiveTracking` para `leafletProvider.js` sem mudar o visual. `VITE_MAPS_PROVIDER=leaflet`.
**Verificação:** as 4 telas visualmente idênticas — esta é a etapa de maior valor de segurança, porque isola o risco R4.

### Etapa 6 — Provider Google Maps JS
`googleMapsProvider.js` com `js-api-loader`, `AdvancedMarkerElement`, `Polyline`, `fitBounds`. Rota desenhada passa a vir do backend (`polyline` do `getFare`), eliminando a duplicação §2.2.
**Verificação:** flag ligada → mapa Google nas 4 telas; interpolação do marcador, follow mode, poda da rota e pin de seleção preservados.

### Etapa 7 — Corte e limpeza
Após período de validação: default para `google`, remover `leaflet` do `package.json`, atualizar docs.

---

## 7. Como testar antes de produção

1. **Paridade de preço (o mais importante):** o script da Etapa 0 vira teste de regressão. Critério de aceite a definir com você — sugiro **Δ preço < 5%** por rota, ou decisão explícita de aceitar o novo patamar.
2. **Teste de contrato entre providers:** mesma entrada nos dois providers → mesmo *shape*, campos obrigatórios presentes, coords na faixa válida. Roda no CI.
3. **Chave de staging separada**, com quota diária baixa (ex.: 500 req/dia) — estoura antes de virar fatura.
4. **Smoke manual das 4 telas** com a flag ligada: Home (busca, seleção no mapa, corrida), Riding (rota + posição do motorista), CaptainHome (raio de busca), CaptainRiding (navegação até destino).
5. **E2E Playwright** (`e2e/rideFlow.spec.js`) com `google.maps` mockado — valida o fluxo, não o render.
6. **Canary:** `VITE_MAPS_PROVIDER` por ambiente. Staging → conta de teste em produção → 100%.
7. **Rollback:** trocar 1 variável de ambiente e redeploy. Sem migração de dados, sem alteração de schema — **por isso o formato de endereço não muda**.

---

## 8. Decisões que preciso de você

| # | Questão | Recomendação |
|---|---|---|
| **D1** | **R1 — preço.** Aceita o novo patamar de tarifa com duração no trânsito, ou usamos `TRAFFIC_UNAWARE` para manter paridade com o OSRM? | Rodar Etapa 0 e decidir com dados na mão |
| **D2** | `admin-frontend` (`Captains.jsx`, `Rides.jsx` em `react-leaflet`) entra agora ou vira Fase 2? | **Fase 2** — não é caminho crítico e dobraria o risco |
| **D3** | Corrijo `getCaptainsInTheRadius` (§2.4) nesta migração? | **Não** — é matching, não mapas. Merece plano próprio |
| **D4** | Orçamento mensal para o budget alert do Google Cloud? | ✅ **Definido: US$ 10/mês.** ⚠️ Muito apertado para 4 APIs simultâneas (Places + Geocoding + Routes + Maps JS) — vou configurar quotas diárias conservadoras por API na Etapa 1 para evitar estouro, e isso vai limitar o volume de teste. Se a Etapa 0 ou os testes esbarrarem no teto, paro e aviso antes de continuar. |

---

## 9. Registro de execução

### Decisões registradas em 2026-07-31
- **D4:** budget alert definido em **US$ 10/mês** — teto apertado para 4 APIs, quotas diárias conservadoras obrigatórias na Etapa 1.
- **D2, D3:** adotadas as recomendações do plano (admin-frontend → Fase 2; `getCaptainsInTheRadius` fora de escopo).
- Etapa 0 reduzida de 30 para **10 rotas** por causa do teto de custo.

### Etapa 0 — 🔴 BLOQUEADA
Chamada de teste única à Routes API (`routes.googleapis.com:computeRoutes`) com a chave `GOOGLE_MAPS_API` atual retornou **403 `PERMISSION_DENIED` / `API_KEY_SERVICE_BLOCKED`**.

```json
{
  "reason": "API_KEY_SERVICE_BLOCKED",
  "consumer": "projects/1062132119424",
  "apiName": "routes.googleapis.com"
}
```

**Custo desta etapa: US$ 0** — a chamada foi rejeitada antes de qualquer cobrança.

**Causa provável (uma das duas, preciso que você verifique no Console):**
1. A **Routes API (new)** não está habilitada no projeto `1062132119424` — é um produto distinto de Geocoding/Places, precisa ser ativado separadamente em *APIs & Services → Enable APIs*.
2. A chave `GOOGLE_MAPS_API` tem **restrição de API** (*API restrictions*) que não inclui `routes.googleapis.com`.

**Ação necessária antes de eu continuar:**
- Acessar [console.cloud.google.com](https://console.cloud.google.com), projeto do `GOOGLE_MAPS_API`
- **APIs & Services → Library** → buscar "Routes API" → Enable (se não estiver habilitada)
- **APIs & Services → Credentials** → abrir a chave → conferir se *API restrictions* inclui Routes API (se a chave usa restrição por API)
- Avisar quando pronto, ou pedir para eu tentar de novo

**Bloqueado:** Etapa 0 (e por consequência D1 e toda a Etapa 3+, que dependem do resultado da comparação de preço).

**Decisão registrada:** aguardar o usuário habilitar a Routes API / ajustar restrições da chave no Console, em vez de adiantar Etapas 1-2 em paralelo. Trabalho pausado até novo aviso.

**Atualização:** usuário habilitou a Routes API no projeto (`API ativada` confirmado via Console). Reteste da chamada única retornou **o mesmo erro** `403 API_KEY_SERVICE_BLOCKED`. Conclusão: a causa é a **segunda hipótese** — a chave `GOOGLE_MAPS_API` tem *API restrictions* configuradas que não incluem `routes.googleapis.com`. Habilitar o produto no projeto não basta; é preciso liberar a API especificamente na chave, em *Credentials → [a chave] → API restrictions*.

**Desbloqueio:** usuário criou uma credencial nova no Google Cloud (chave sem papel definido ainda — usada só para este teste, não gravada em `.env`). Chamada de teste teve sucesso (`3898m / 795s` em rota de referência SP). Confirmado que **não é a mesma chave** do `.env` atual.

### Etapa 0 — ✅ EXECUTADA

Script descartável (`Backend/_tmp_etapa0_comparacao.js`, removido após a execução) comparou **10 corridas reais do banco** (regex extraiu coordenadas já embutidas nos campos `pickup`/`destination`) nos três cenários: OSRM (motor atual em produção), Google Routes `TRAFFIC_AWARE`, Google Routes `TRAFFIC_UNAWARE`. Preço final calculado via `PricingEngine.calculateFare` real, mesma lógica de produção.

**Resultado — 10 de 10 amostras válidas:**

| id | veículo | dist OSRM/G (km) | dur OSRM (min) | dur G aware/unaware (min) | preço OSRM | preço G aware | Δ% |
|---|---|---|---|---|---|---|---|
| fae527 | car | 2.33 / 1.95 | 4.6 | 8.4 / 8.5 | 178.50 | 185.31 | +3.8% |
| fae565 | car | 0.63 / 0.66 | 1.6 | 3.1 / 3.1 | 137.14 | 143.20 | +4.4% |
| fae69b | moto | 0.63 / 0.66 | 1.8 | 3.1 / 3.1 | 77.64 | 83.01 | +6.9% |
| d9660d | moto | 1.62 / 1.22 | 2.9 | 5.8 / 5.8 | 99.54 | 102.74 | +3.2% |
| d9664c | moto | 0.64 / 0.67 | 1.6 | 3.1 / 3.1 | 77.25 | 83.27 | +7.8% |
| d9669c | moto | 0.59 / 0.62 | 1.5 | 3.0 / 3.0 | 76.10 | 82.04 | +7.8% |
| d96739 | moto | 0.76 / 0.78 | 2.0 | 3.5 / 3.5 | 80.99 | 86.84 | +7.2% |
| d9677e | moto | 0.41 / 0.41 | 1.2 | 1.8 / 1.8 | 71.84 | 73.92 | +2.9% |
| 71c33f | moto | 1.61 / 1.24 | 2.8 | 5.9 / 5.9 | 99.03 | 103.63 | +4.6% |
| 71c3a6 | moto | 1.61 / 1.24 | 2.8 | 5.9 / 5.9 | 99.03 | 103.63 | +4.6% |

**Médias:** `TRAFFIC_AWARE` vs OSRM = **+5,3%** | `TRAFFIC_UNAWARE` vs OSRM = **+5,3%** (idêntico) | faixa +2,9% a +7,8%.

**Achado que revisa o plano original:** `AWARE` e `UNAWARE` deram resultados praticamente idênticos em todas as 10 amostras — são trajetos curtos e locais (bairro Lajinha/ES), onde o trânsito não é o fator relevante. A divergência de preço vem de **duração base**: o Google estima consistentemente ~1,7–2× mais tempo que o OSRM público para o mesmo trajeto curto (ex.: 1,6min → 3,1min), provavelmente por perfil de velocidade urbana mais realista. Distância ficou comparável entre os motores.

**Conclusão para D1:** a mitigação `TRAFFIC_UNAWARE` proposta no plano **não resolve** a paridade de preço — o gap não é de trânsito. As opções reais são: (a) aceitar o aumento médio de ~5% nas tarifas como o preço "mais correto" de duração real; (b) recalibrar `perMinuteRate`/`baseFare` das categorias de veículo para compensar; (c) manter OSRM só para o cálculo de preço e usar Google apenas para visualização/rota desenhada (quebra a intenção original de centralizar tudo no Google, mas elimina o risco de preço).

### ✅ D1 — Decidido em 2026-07-31: aceitar o novo patamar de preço
Usuário optou por **aceitar o aumento médio de +5,3%** nas tarifas. **Nenhuma alteração na `PricingEngine`** é necessária por causa disso — `routingPreference: TRAFFIC_AWARE` é o padrão a usar no `google.provider.js` (Etapa 3), sem lógica de compensação. Consequência prática: no dia em que `MAPS_PROVIDER=google` for ativado (Etapa 6/7), as tarifas de corridas curtas em áreas como Lajinha/ES sobem ~3-8% de uma vez. Vale considerar avisar os usuários/motoristas dessa mudança de patamar antes do rollout final — decisão de comunicação fica com o usuário, fora do escopo técnico deste plano.

---

## Status das decisões (D1–D4): ✅ todas resolvidas
| # | Decisão | Resultado |
|---|---|---|
| D1 | Divergência de preço (+5,3%) | ✅ Aceitar o novo patamar, sem mudança na PricingEngine |
| D2 | admin-frontend nesta migração? | ✅ Não — Fase 2 |
| D3 | Corrigir `getCaptainsInTheRadius`? | ✅ Não — fora de escopo |
| D4 | Budget alert Google Cloud | ✅ US$ 10/mês — quotas conservadoras na Etapa 1 |

---

### Etapa 1 — 🟡 EM ANDAMENTO (parte código concluída, parte Console pendente)

**Feito (código):**
| Arquivo | Mudança | Verificação |
|---|---|---|
| `Backend/routes/maps.routes.js` | + `authMiddleware.authBoth` nas 3 rotas (`/get-coordinates`, `/get-distance-time`, `/get-suggestions`) | Sem token → `401 {"message":"Unauthorized"}` nas 3 rotas. Com token válido (usuário de teste descartável, criado e removido do banco) → `200`, resposta é array. Confirmado que os 7 pontos do frontend que chamam essas rotas (Home, LiveTracking, CaptainHome, CaptainRiding) **já enviavam** `Authorization: Bearer`, então nada quebra |
| `Backend/.env.example` | Documentado `GOOGLE_MAPS_API` com nota de restrição (IP + 3 APIs, nunca usar no frontend) | — |

**Regressão:** suíte `vitest run` comparada byte-a-byte (baseline via `git stash` vs com a mudança) — **mesma lista de testes passando e falhando**, só variação de milissegundos. As 4 falhas + 2 suítes quebradas (`auth.test.js`, `ride.api.test.js`, `auth.middleware.test.js`, `socket.integration.test.js`) são **pré-existentes**, sem relação com `/maps/*` ou com esta mudança.

**Achado à parte (não corrigido, fora de escopo):** `Backend/.gitignore` tem uma regra `.env*` que ignora até `.env.example` — o arquivo nunca foi versionado nesse repo. Minha edição está em disco mas não aparece em `git status`. Registro para você decidir separadamente se quer versionar o `.env.example`.

**Pendente — requer ação sua no Google Cloud Console (não posso fazer por aqui):**
1. **Duas chaves restritas** (R3): uma para o backend (restrição por IP do servidor + só Geocoding/Places/Routes), outra para o frontend (restrição por HTTP referrer + só Maps JavaScript API). A chave de teste que você gerou hoje (`AIzaSy...ZB2Sg`) não tem papel definido — não deve virar nenhuma das duas sem antes aplicar as restrições.
2. **Quotas diárias por API** em *APIs & Services → [cada API] → Quotas* — essencial com o teto de US$ 10/mês.
3. **Budget alert de US$ 10/mês** em *Billing → Budgets & alerts*.

Avise quando tiver as chaves/quotas/alert configurados (ou se quiser que eu gere um roteiro passo a passo mais detalhado para cada item) — isso fecha a Etapa 1 e libera a Etapa 2.

### Etapa 1 — ✅ CONCLUÍDA em 2026-07-31

**Chaves criadas pelo usuário e aplicadas:**
| Chave | Restrição aplicada | Onde foi gravada |
|---|---|---|
| Backend | Geocoding + Places + Routes API. **Sem restrição de IP** (Render não garante IP estático) | `Backend/.env` → `GOOGLE_MAPS_API` (substituiu a anterior) |
| Frontend | HTTP Referrer + Maps JavaScript API apenas | `frontend/.env` → `VITE_GOOGLE_MAPS_API_KEY` (nova entrada; **nenhum código ainda lê essa variável** — só custódia segura até a Etapa 6) |

**Nota de risco aceita:** a chave do backend não tem restrição de IP. Isso é uma decisão consciente do usuário (Render sem IP estático), documentada aqui como aceita — mitigada pelas quotas diárias por API e pelo `authBoth` já aplicado em `/maps/*` (Etapa 1, parte 1), que impede uso não-autenticado da própria API do MoveCity. Se o Render passar a oferecer IP estático (planos pagos), recomendo revisar essa restrição depois.

**Validação contra os 5 itens pedidos pelo usuário:**

| # | Item pedido | Resultado |
|---|---|---|
| 1 | Mapa carrega no frontend | ⚠️ **Não aplicável ainda** — não existe nenhum código de Google Maps JS no frontend (`VITE_GOOGLE_MAPS_API_KEY` está guardada mas não consumida). O mapa continua Leaflet. Isso só é construído nas Etapas 5-6 |
| 2 | Autocomplete funciona | ✅ Testado end-to-end via `/maps/get-suggestions` com a chave nova → `200`, 5 sugestões reais retornadas. **Bug pré-existente confirmado ao vivo** (§2.1 do diagnóstico): a resposta não traz `lat`/`lng` — sem regressão minha, é o comportamento atual do código, corrigido na Etapa 3 |
| 3 | Geocoding funciona | ✅ Testado end-to-end via `/maps/get-coordinates` com a chave nova → `200`, coordenadas corretas para "Avenida Paulista, São Paulo" |
| 4 | Cálculo de rotas funciona | ⚠️ **Parcial.** Confirmado que a chave do backend TEM permissão para a Routes API (chamada direta de teste → sucesso, `3454m/1666s`). Mas o cálculo de rota que alimenta o preço das corridas (`/maps/get-distance-time`) **continua usando GraphHopper→OSRM**, não Google — isso só muda na Etapa 3, quando o `google.provider.js` for construído e ligado |
| 5 | Nenhuma requisição usa a chave errada | ✅ Confirmado nos dois sentidos: chave do backend tem acesso a Geocoding/Places/Routes (testado); chave do frontend foi **corretamente rejeitada** ao tentar chamar Geocoding diretamente (`REQUEST_DENIED — API keys with referer restrictions cannot be used with this API`) — a restrição por referrer está funcionando como esperado |

**Regressão:** suíte de testes não foi re-executada para a troca de `.env` (mudança de valor de variável, não de código; a suíte já usa mocks de `maps.service` na maioria dos casos — confirmado no `services/__mocks__/maps.service.js`). A verificação de regressão de código (`maps.routes.js`) já havia sido feita byte-a-byte contra o baseline.

**Conclusão:** nenhuma incompatibilidade encontrada no que já é executável hoje. Os itens 1 e parte do 4 (mapa Google, rota Google) não são bugs — são funcionalidades que **ainda não foram construídas**, conforme o plano de etapas aprovado (Etapa 2: abstração backend → Etapa 3: provider Google backend, incluindo Routes → Etapa 5: abstração frontend, extrair Leaflet → Etapa 6: provider Google Maps JS no frontend).

---

### Etapa 2 — ✅ CONCLUÍDA em 2026-07-31

**Arquivos criados:**
| Arquivo | Conteúdo |
|---|---|
| `Backend/services/maps/osm.provider.js` | Cópia exata da lógica atual de `getAddressCoordinate`, `getDistanceTime`, `getAutoCompleteSuggestions` (mesmo branching Google/Nominatim/GraphHopper/OSRM de hoje) |
| `Backend/services/maps/geo.util.js` | `haversineKm` extraído — é matemática pura, não depende de provider nenhum |
| `Backend/services/maps/contract.js` | Validação **não-bloqueante** (só `console.warn`, nunca lança erro nem altera o retorno) do formato de coordenada/distance-time/sugestões. Detecta em produção, sem mudar comportamento, os riscos R6 (inversão lat/lng) e o achado §2.1 (autocomplete sem coords) |
| `Backend/services/maps/index.js` | Seletor de provider via `MAPS_PROVIDER` (default `osm`). Se `MAPS_PROVIDER=google` for setado agora, falha alto e explícito no boot (`google.provider.js` ainda não existe — chega na Etapa 3) |

**Arquivo modificado:**
| Arquivo | Mudança |
|---|---|
| `Backend/services/maps.service.js` | Virou um repasse fino para `./maps/index.js`. `getCaptainsInTheRadius` ficou aqui diretamente (não é provider-específico — só consulta Mongo, nem usa geo de verdade, achado §2.4) |
| `Backend/.env` / `.env.example` | + `MAPS_PROVIDER=osm` documentado |

**Decisão de design tomada durante a implementação:** `haversineKm` e `getCaptainsInTheRadius` foram tirados de dentro do provider (onde estavam originalmente misturados com o código OSM) porque não têm nenhuma dependência de Google vs OSM — deixá-los dentro de `osm.provider.js` obrigaria `google.provider.js` (Etapa 3) a duplicá-los sem motivo, ou index.js precisaria de um caso especial. Comportamento idêntico, só reorganização.

**Verificação — 3 camadas, todas confirmando zero regressão:**
1. **Byte-a-byte:** capturei respostas reais de `/maps/get-coordinates`, `/maps/get-suggestions` e `/maps/get-distance-time` (mesmos inputs) com o código antigo (via `git stash`) e com o novo. `diff` → **idêntico, nenhuma linha de diferença**.
2. **Suíte de testes completa:** comparação teste a teste contra o baseline estabelecido na Etapa 1 → **idêntico** (mesmos 4 failed, 23 passed, 1 skipped; mesmos nomes e status, só variação de milissegundos).
3. **Log ao vivo do `contract.js`:** disparou o aviso esperado (`5/5 sugestões sem lat/lng — ver achado §2.1`) durante o teste, confirmando que a camada de validação está ativa e não altera o dado retornado.

**Conclusão:** camada de abstração criada, comportamento 100% preservado, infraestrutura pronta para a Etapa 3 (implementar `google.provider.js` de verdade, incluindo a correção do bug §2.1 e a troca do motor de rotas para a Routes API).

---

### Etapa 3 — 🟡 EM ANDAMENTO (código completo, validação parcialmente bloqueada)

**Decisão de design importante, revisando o que o plano original previa:** a Places API — legada e "New" — **não devolve `lat`/`lng` no autocomplete em nenhuma versão**, por design. Só o endpoint de Place Details devolve coordenadas. Backfillar coordenadas em cada uma das ~5 sugestões a cada tecla digitada custaria 6 chamadas por busca, incompatível com o orçamento de US$ 10/mês (D4). Implementei o padrão correto e mais barato que o próprio Google recomenda: autocomplete devolve `placeId` + `sessionToken` (sem coords); um novo `getPlaceDetails` resolve `lat`/`lng` só quando o usuário seleciona uma sugestão, fechando a sessão (cobrança combinada). Isso corrige a seção 3 do plano original ("Contrato normalizado"), que previa lat/lng sempre preenchidos no autocomplete — não é viável dentro do orçamento definido.

**Consequência arquitetural:** o `sessionToken` viaja por um **header HTTP** (`X-Maps-Session-Token`), não no corpo da resposta — assim `/maps/get-suggestions` continua devolvendo exatamente o mesmo array de sempre (contrato preservado, byte-a-byte, para o frontend atual que ainda não foi atualizado). Frontend antigo ignora o header sem erro.

**Arquivos criados:**
| Arquivo | Conteúdo |
|---|---|
| `Backend/services/maps/google.provider.js` | `getAddressCoordinate` (Geocoding), `getReverseGeocode` (Geocoding reverso), `getAutoCompleteSuggestions` (Places New Autocomplete, com sessionToken), `getPlaceDetails` (Places New Details), `getDistanceTime` (Routes API, `TRAFFIC_AWARE` conforme D1, polyline via GeoJSON com flip lng/lat→lat/lng) |

**Arquivos modificados:**
| Arquivo | Mudança |
|---|---|
| `Backend/services/maps/osm.provider.js` | + `getReverseGeocode` (Nominatim reverso) — função **nova**, não existia antes; adicionada por simetria com o provider Google, sem alterar nenhum export existente |
| `Backend/services/maps/index.js` | Branch `google` habilitado (antes lançava erro proposital). + `getAutoCompleteSuggestionsWithSession`, `getPlaceDetails`, `getReverseGeocode`. A função pública original `getAutoCompleteSuggestions` continua devolvendo array puro, inalterada |
| `Backend/services/maps.service.js` | Repassa as 3 funções novas |
| `Backend/controllers/map.controller.js` | `getAutoCompleteSuggestions` agora usa a versão com sessão e expõe o token via header. + `getPlaceDetails`, + `getReverseGeocode` |
| `Backend/routes/maps.routes.js` | + `GET /maps/place-details`, + `GET /maps/reverse-geocode` (ambas com `authBoth`) |

**Verificação:**
1. **Regressão com `MAPS_PROVIDER=osm` (default):** suíte completa comparada contra o baseline → **idêntica** (mesmos 4 failed / 23 passed / 1 skipped). As funções novas não tocaram nada do caminho já verificado na Etapa 2.
2. **`MAPS_PROVIDER=google`, testado via HTTP real:**

| Capacidade | Resultado |
|---|---|
| Geocoding | ✅ `200`, coordenadas corretas |
| Reverse Geocoding | ✅ `200`, endereço formatado correto |
| Routes API (distance/time + polyline) | ✅ `200`, 4.2km / 21min, polyline com 79 pontos, primeiro ponto `[-23.56, -46.65]` — ordem lat/lng confirmada correta (sem o risco R6 de inversão) |
| Places Autocomplete (New) | ❌ `places.googleapis.com` bloqueado — `AutocompletePlaces` |
| Place Details (New) | ❌ `places.googleapis.com` bloqueado — `GetPlace` |

**Causa provável:** "Places API" e "Places API (New)" são produtos **separados** no Google Cloud — habilitar/permitir um não libera o outro. A chave provavelmente tem só "Places API" (legada) na lista de restrição, faltando "Places API (New)".

**Ação necessária do usuário:** no Console, em *APIs & Services → Library*, confirmar que **"Places API (New)"** (não confundir com "Places API") está *Enabled*; em *Credentials → [chave backend] → API restrictions*, confirmar que "Places API (New)" está marcada.

**Bloqueado:** verificação completa de `getAutoCompleteSuggestions`/`getPlaceDetails` do provider google. **Não bloqueado:** todo o resto do código está escrito, sem erro de sintaxe, e 3 das 4 capacidades já validadas end-to-end.

**Atualização — usuário ajustou a restrição da chave (Places API New). Reteste:**

| Capacidade | Resultado |
|---|---|
| Places Autocomplete (New) | ✅ `200`, 5 sugestões reais com `text`/`title`/`subtitle`/`placeId`, header `X-Maps-Session-Token` presente |
| Place Details (New) | ✅ `200`, resolveu o `placeId` da primeira sugestão em `{ltd: -23.566, lng: -46.650, address: "Av. Paulista - Bela Vista, São Paulo - SP, Brazil"}`, coordenadas dentro da faixa válida |

**Teste de contrato (shape) entre os dois providers**, mesmos inputs (`getAddressCoordinate` e `getDistanceTime`):
- `getAddressCoordinate`: osm e google retornam exatamente as mesmas chaves (`ltd`, `lng`), ambos válidos pelo `contract.checkCoordinate`. Coordenadas idênticas neste caso (mesmo endereço, ambos resolvidos via Google Geocoding por baixo — osm cai no branch Google interno quando a chave é real).
- `getDistanceTime`: osm e google retornam exatamente as mesmas chaves em todos os níveis (topo, `distance{}`, `duration{}`), ambos válidos pelo `contract.checkDistanceTime`. Valores diferem como esperado (Google estimou mais tempo que o OSRM para o mesmo par, consistente com o achado da Etapa 0) — é diferença de dado, não de formato.

### Etapa 3 — ✅ CONCLUÍDA em 2026-07-31

Todas as 5 capacidades do `google.provider.js` validadas end-to-end via HTTP real: Geocoding, Reverse Geocoding, Places Autocomplete (New) com sessionToken, Place Details (New), Routes API (distance/time + polyline com orientação lat/lng correta). Contrato de shape idêntico entre os dois providers. Regressão com `MAPS_PROVIDER=osm` (default atual, ainda ativo em produção) permanece idêntica ao baseline — nada em produção mudou de comportamento até aqui, só a infraestrutura para trocar ficou pronta.

**Importante — não ligar `MAPS_PROVIDER=google` em produção ainda:** o backend está pronto, mas o frontend (`LocationSearchPanel.jsx`, `Home.jsx`) ainda espera o contrato antigo (sugestões com `lat`/`lng` diretos, sem passo de seleção). Ligar o provider google agora quebraria a busca de endereço no app — a sugestão teria `placeId` mas não coordenadas, e o frontend atual não sabe chamar `/maps/place-details`. Isso só fica seguro depois da Etapa 6 (wiring do frontend).

---

### Etapa 4 — ✅ CONCLUÍDA em 2026-07-31

**Arquivo criado:**
| Arquivo | Conteúdo |
|---|---|
| `frontend/src/services/mapsApi.js` | `reverseGeocode(lat, lng)`, usando a instância `axios` compartilhada de `services/axios.js` (já injeta token automaticamente, já trata 401) em vez do padrão disperso de `axios` cru + headers manuais |

**Arquivo modificado:**
| Arquivo | Mudança |
|---|---|
| `frontend/src/modules/passenger/pages/Home.jsx` | As 3 chamadas diretas a `https://photon.komoot.io/reverse` (mount inicial, seleção no mapa, "usar minha localização") trocadas por `reverseGeocode()`. Import `axios` cru mantido — ainda usado por outras 6 chamadas fora do escopo desta etapa (rides, get-suggestions) |

**Regressão encontrada e corrigida (no teste, não no app):** `src/tests/pages/Home.test.jsx` usa `vi.mock('axios')` (automock). Antes, `Home.jsx` nunca chamava `axios.create()` no carregamento do módulo. Ao importar `mapsApi.js` → `services/axios.js`, que roda `axios.create(...)` no topo do arquivo, o automock devolve `undefined` e quebra `api.interceptors.request.use(...)` — o arquivo de teste inteiro parava de carregar (`0 test`, `Failed Suites 1`). Corrigido mocando `@/services/mapsApi` diretamente no teste (mesmo padrão já usado ali para `services/fcm`), sem tocar em `services/axios.js`. Após a correção, suíte voltou **exatamente** ao baseline: `3 failed | 4 passed (7)`.

**Mudança de comportamento aceitável, não é bug:** o endereço reverso agora vem do backend (Nominatim via `osm.provider.js`, provider ativo hoje) em vez do Photon. O formato do texto muda — Photon compunha `"nome, rua, cidade"` (3 partes curtas); o backend devolve o endereço formatado completo (`display_name` do Nominatim ou `formatted_address` do Google, mais verboso, pode incluir CEP). A funcionalidade (mostrar um endereço legível para a coordenada) é preservada; só o texto exibido fica mais longo/detalhado.

---

### Etapa 5 — ✅ CONCLUÍDA em 2026-07-31

**A etapa de maior risco do plano inteiro (R4)** — `LiveTracking.jsx` (687 linhas) serve 4 telas em ambos os fluxos (passageiro e motorista) simultaneamente. Tratada com o nível mais alto de verificação de toda a migração: build + testes + lint + **verificação visual real em navegador**.

**Arquivos criados:**
| Arquivo | Conteúdo |
|---|---|
| `frontend/src/services/maps/mapContract.js` | Documentação JSDoc da interface que qualquer provider deve implementar (`init`, `placeMarker`, `moveMarker`, `setMarkerIcon`, `removeMarker`, `setRoute`, `removeRoute`, `setCircle`, `removeCircle`, `fitBounds`, `panTo`, `invalidateSize`, `destroy`) |
| `frontend/src/services/maps/leafletProvider.js` | Implementação Leaflet — cópia fiel de todos os ícones (`vehicleIcons`, `userPositionIcon`, `pickupIcon`, `destinationIcon`), cores, tamanhos e comportamento de desenho do arquivo original |
| `frontend/src/services/maps/index.js` | Seletor por `VITE_MAPS_PROVIDER` (default `leaflet`), espelhando o padrão do backend — `google` falha alto até a Etapa 6 |

**Arquivo modificado:**
| Arquivo | Mudança |
|---|---|
| `frontend/src/shared/components/LiveTracking.jsx` | Vira orquestrador puro: mantém 100% da lógica de negócio (`sanitizeCoord`, `getRemainingRoute`, `calculateRouteDistance`, interpolação por `requestAnimationFrame`, follow mode, fetch de rota/coords, debounce) e delega todo desenho ao provider via `providerRef.current.xxx()`. Nenhuma chamada `L.xxx` direta restante no componente |

**Decisão de design importante:** separei `placeMarker` (cria OU atualiza posição+ícone) de `moveMarker` (só posição, sem tocar ícone) porque o código original chama `setIcon` **uma vez por atualização de posição do capitão**, e `setLatLng` **a cada frame da animação** (~60fps por 2 segundos). Se eu tivesse uma única função fazendo as duas coisas, o ícone seria re-setado a cada frame — didático, mas geraria manipulação de DOM desnecessária 60x mais frequente que o original, com risco de jank visual. A separação preserva a frequência exata de cada operação.

**Bug pré-existente encontrado e não replicado (correção incidental):** o cleanup do efeito de inicialização do mapa original tinha uma ordem de código que, em teoria, chamava `mapInstanceRef.current.removeLayer(...)` **depois** de já ter setado `mapInstanceRef.current = null` — um null-pointer latente que só não explodia sempre por sorte de ordem de execução. O novo `destroy()` do provider chama só `map.remove()` (que já limpa todas as layers internamente, incluindo o círculo de raio) — o bug não pode mais ocorrer, como consequência natural do design mais simples, não como uma correção buscada à parte.

**Verificação:**
1. **Build:** ✅ sem erros
2. **Testes:** ✅ idêntico ao baseline (3 failed | 4 passed | 7 total) — o mock `vi.mock('leaflet', ...)` em `Home.test.jsx` continua funcionando porque intercepta o módulo `'leaflet'` globalmente, não importa quem o importa
3. **Lint:** comparação exata contra o arquivo original (extraído do commit inicial) → **70 problemas em ambos** (67 erros de `react/prop-types` + 3 avisos de `exhaustive-deps`) — 100% dívida técnica pré-existente (o componente nunca teve PropTypes declarado), confirmada byte-a-byte igual, nada introduzido por esta mudança
4. **Verificação visual real** (Playwright headless, já que `chromium-cli` não estava disponível neste ambiente): subi backend + frontend reais, registrei um usuário descartável, injetei o token, concedi permissão de geolocalização e abri `/home` de verdade:
   - `.leaflet-container` apareceu no DOM ✅
   - Tiles do OpenStreetMap carregaram visualmente (screenshot confirma: Praça da Sé, São Paulo, exatamente a coordenada injetada) ✅
   - Marcador de posição do usuário (`.user-position-icon`) presente ✅
   - Bônus: o marcador de pickup também apareceu, confirmando que o pipeline `reverseGeocode` (Etapa 4) → `pickup` state → `LiveTracking` → `placeMarker` funciona ponta a ponta em produção real, não só isoladamente
   - Único erro de console: `404` em `/rides/current` — comportamento **esperado e pré-existente** (usuário de teste sem corrida ativa; o backend responde 404 de propósito e o frontend já trata esse caso). **Zero erro relacionado a leaflet/map/provider/TypeError**
   - Usuários de teste, servidores e scripts temporários todos limpos ao final

---

### Etapa 6 — ✅ CONCLUÍDA em 2026-07-31

**Decisão de design (perguntada e respondida pelo usuário):** marcadores customizados usam `google.maps.Marker` (API legada, ainda funcional) em vez de `AdvancedMarkerElement`, para não depender de um Map ID do Console. Ícones são SVG data-URI: pickup/destination reaproveitam o **path SVG exato** do design original (não dependiam de fonte de ícone, então ficaram quase idênticos); veículos usam emoji simples (🚗🏍🚕) dentro de um círculo colorido — aproximação visual aceita explicitamente pelo usuário em troca de não precisar de nenhum passo extra no Console.

**Arquivos criados:**
| Arquivo | Conteúdo |
|---|---|
| `frontend/src/services/maps/googleMapsProvider.js` | Implementação Google Maps JS do mesmo contrato do `leafletProvider.js` — `google.maps.Map`, `Marker`, `Polyline`, `Circle`, `LatLngBounds` |

**Arquivos modificados:**
| Arquivo | Mudança |
|---|---|
| `frontend/package.json` | + `@googlemaps/js-api-loader` |
| `frontend/src/services/maps/index.js` | Branch `google` habilitado (antes lançava erro proposital) |
| `frontend/src/services/maps/leafletProvider.js` | `init()` virou `async` — sem mudança de lógica, só contrato (ver achado abaixo) |
| `frontend/src/services/maps/mapContract.js` | Documentado que `init()` sempre retorna `Promise<void>` |
| `frontend/src/shared/components/LiveTracking.jsx` | Efeito de inicialização do mapa agora aguarda `provider.init()` (pode ser assíncrono), com proteção contra desmontagem durante o carregamento |
| `frontend/src/services/mapsApi.js` | + `getPlaceDetails(placeId, sessionToken)` |
| `frontend/src/modules/passenger/components/LocationSearchPanel.jsx` | `handleSuggestionClick` virou assíncrono: sugestão com `lat`/`lng` usa direto (osm, comportamento original); sugestão só com `placeId` chama `/maps/place-details` para resolver as coordenadas (google, Etapa 3) |
| `frontend/src/modules/passenger/pages/Home.jsx` | Captura o header `X-Maps-Session-Token` das respostas de `/maps/get-suggestions` e repassa pro `LocationSearchPanel` |

**Por que `init()` precisou virar assíncrono:** o provider Leaflet cria o mapa de forma síncrona (biblioteca já importada estaticamente); o provider Google precisa **carregar a API JS pela rede** antes de criar qualquer coisa (`importLibrary('maps')`, uma Promise). Como `LiveTracking.jsx` não pode saber qual provider está ativo, o contrato precisa assumir que `init()` é sempre potencialmente assíncrono — ajuste necessário no `leafletProvider.js` da Etapa 5, não escopo novo.

**3 bugs reais encontrados e corrigidos durante a implementação** (nenhum era esperado pelo plano original):
1. **`Loader` removido da biblioteca instalada.** `npm install @googlemaps/js-api-loader` puxou a versão mais recente (2.1.1), que **removeu a classe `Loader`** (breaking change), só restando a API funcional `setOptions()`/`importLibrary()`. O `build` (`vite build`) não pegou isso porque só empacota, não executa o módulo — só o `vitest` (que roda de verdade em jsdom) travou com `Loader is no longer available`. Corrigido trocando para a API nova.
2. **`Size`/`Point` não vêm do retorno de `importLibrary('maps')`.** Só `Map` vem nesse objeto — `Size`, `Point`, `LatLngBounds`, `Marker`, `Polyline`, `Circle` ficam no namespace global `window.google.maps`, populado como efeito colateral de qualquer `importLibrary()` resolvido. Corrigido usando `window.google.maps` para essas classes.
3. **Ambiente de teste com processos zumbis.** Duas rodadas de teste visual foram invalidadas por servidores anteriores ainda escutando nas portas esperadas (o Vite silenciosamente subiu em outra porta, e o script testou a porta errada, mostrando o mapa Leaflet antigo em vez do Google). Corrigido matando processos por PID explicitamente e lendo a porta real do log antes de cada teste.

**Verificação — build, testes, lint (idêntico ao padrão das etapas anteriores) + navegador real com API paga:**
1. **Build:** ✅ com `VITE_MAPS_PROVIDER=leaflet` (default) e com `=google` — ambos sem erro
2. **Testes:** ✅ idêntico ao baseline (3 failed | 4 passed | 7 total)
3. **Lint:** `LocationSearchPanel.jsx` comparado contra o original → 12 problemas antes, 13 depois — delta de exatamente +1, a prop `sessionToken` nova, mesma categoria de aviso pré-existente (`react/prop-types`, componente nunca teve PropTypes). `services/maps/*.js` (não são componentes React) → **zero problema**
4. **Verificação visual completa** (Playwright, backend E frontend com `MAPS_PROVIDER=google` nos dois lados):
   - `.gm-style` apareceu no DOM — Google Maps inicializou de verdade, com requisições reais para `maps.googleapis.com` (tiles, script, fontes)
   - Marcador de pickup (SVG customizado) renderizado corretamente, visualmente muito próximo do Leaflet original
   - Fluxo completo do autocomplete testado ponta a ponta: digitou "Avenida Paulista" → `/maps/get-suggestions` retornou 5 sugestões com `placeId` + header `X-Maps-Session-Token` presente → clicou na primeira → `/maps/place-details` resolveu `{ltd:-23.566, lng:-46.6508, address:"Av. Paulista - Bela Vista, São Paulo - SP, Brazil"}` → campo Destino atualizado com o endereço completo resolvido
   - Rota (polyline) desenhada no mapa entre os dois pontos, confirmando que o `getDistanceTime` do backend (Routes API, Etapa 3) chega até o desenho no frontend
   - Único erro de console: `404` em `/rides/current`, esperado e pré-existente
   - Usuários de teste, servidores e scripts temporários todos limpos ao final; `.env` de ambos os lados confirmados inalterados (testes usaram variáveis de ambiente inline, não editaram os arquivos reais)

**Estado final:** `VITE_MAPS_PROVIDER` (frontend) e `MAPS_PROVIDER` (backend) **continuam nos defaults `leaflet`/`osm`** — nada mudou em produção. O caminho Google está implementado, testado ponta a ponta e pronto, mas só ativa com as duas variáveis de ambiente setadas explicitamente. Ativar em produção é decisão da Etapa 7.

**Verificação:**
1. `grep` confirma zero referência a `photon.komoot.io` no código-fonte (só sobra no comentário do próprio `mapsApi.js`, explicando o que foi substituído)
2. `npm run build` → ✅ sem erros
3. `vitest run` → ✅ idêntico ao baseline (3 failed | 4 passed | 7 total) após a correção do mock
4. `eslint` nos arquivos tocados → 0 erro novo introduzido (o único erro em `Home.jsx` e os 14 em `Home.test.jsx` são pré-existentes, ligados a padrões do projeto — import `React` não utilizado e globais do Vitest não configurados no ESLint — nenhum dos dois criado por esta mudança)

---

### Etapa 7 — ✅ CONCLUÍDA em 2026-08-01 (cutover em produção)

**Resumo:** `MAPS_PROVIDER=google` (Render) e `VITE_MAPS_PROVIDER=google` (Vercel) ativados em produção. Mapa Google renderizando de verdade para usuários reais, validado via Playwright contra as URLs de produção reais (não mais localhost).

**Cronologia real (com os desvios, porque valem o registro):**

1. Usuário configurou as variáveis nos dois dashboards (Render: `MAPS_PROVIDER=google` + `GOOGLE_MAPS_API` atualizado para a chave nova; Vercel: `VITE_MAPS_PROVIDER=google` + `VITE_GOOGLE_MAPS_API_KEY`).
2. **Incidente de produção não relacionado, descoberto no caminho:** ao verificar se o deploy tinha ido ar, encontramos `Backend/db/db.js` importando `mongodb-memory-server` (devDependency) incondicionalmente no topo do arquivo — isso derrubava o processo em produção (`Cannot find module`, crash loop) porque devDependencies não são instaladas lá. Bug pré-existente, nunca tocado nesta migração, só ficou exposto porque foi o primeiro redeploy do backend em um tempo. Corrigido movendo o `require` para dentro do fallback de dev/teste que efetivamente usa o pacote (commit `a05719f`).
3. `MAPS_PROVIDER=google` confirmado funcionando no backend real (Geocoding, Reverse Geocoding, Places New, Routes API — todos com dados reais, sem fallback mockado).
4. **Frontend quebrado em produção:** mapa não carregava, `ApiNotActivatedMapError` no console.
5. Investigação percorreu, nessa ordem, três hipóteses — as duas primeiras descartadas com evidência, só a terceira era a causa real:
   - **Hipótese 1 (descartada): restrição de HTTP Referrer errada.** O padrão configurado era `https://movecity-six.vercel.app/` (sem asterisco) — pelas regras do Google isso libera só a URL raiz, não `/home`. Corrigido para `.../*`. Não resolveu sozinho, mas era uma correção real e necessária de qualquer forma.
   - **Hipótese 2 (descartada após investigação extensa): cache de borda do Vercel preso.** O bundle publicado (`index-BNk94rv5.js`) não mudava de hash mesmo após: Redeploy manual, purga completa de cache CDN+ISR+imagens (confirmada pelo usuário), e um commit novo com bump de versão (`6c55cf6`) que gerou um build novo e bem-sucedido segundo o dashboard do Vercel. Essa persistência era o sinal de que não era cache — mas só ficou claro depois.
   - **Hipótese 3 (confirmada com evidência direta, a causa real):** o usuário questionou a teoria de cache e pediu prova objetiva. Extraindo o bundle publicado e localizando a linha exata da chamada `setOptions({key:..., v:"weekly"})` (a assinatura do `@googlemaps/js-api-loader`), o valor gravado era `AIzaSyBR8Kw7...` — a chave do **Firebase**, não a do Maps. A variável `VITE_GOOGLE_MAPS_API_KEY` no Vercel continha, por engano, o valor errado. Como o Vite grava env vars em tempo de build, **todo rebuild gerava o mesmo arquivo byte a byte** (mesmo hash) porque a entrada nunca mudava — não havia cache nenhum travado, o build sempre esteve correto para o valor que realmente estava salvo.
6. Usuário corrigiu o valor da variável no Vercel (não deu para conferir o valor anterior — variáveis "Confidenciais" no Vercel são só-escrita, não expõem o valor salvo) e redeployou.
7. **Teste decisivo:** hash do bundle mudou (`BNk94rv5` → `BxVjSjiS`) e a chave extraída do novo bundle já é a correta (`AIzaSyDRlpz...`). Confirma a hipótese 3 de forma conclusiva.

**Verificação final em produção (Playwright, URLs reais):**
- `.gm-style` presente — Google Maps renderizando
- 6 marcadores SVG customizados no DOM
- Zero erro de console relacionado a maps/API — só o `404` esperado de `/rides/current` (usuário de teste sem corrida ativa, mesmo padrão já visto durante toda a migração)
- Screenshot confirma visualmente: mapa completo, pin de pickup correto, mesma UI validada localmente na Etapa 6

**Limpeza:** revertida uma mudança de CORS (`FRONTEND_URL_ALT` em `app.js`/`socket.js`) que tinha sido preparada para um plano B (domínio alternativo) que acabou não sendo necessário — não fazia sentido manter código para um workaround que não foi usado.

**Pendente, fora do escopo técnico:** remover `leaflet` do `package.json` — decisão de quando fazer o corte final fica com o usuário, após um período de observação real em produção.
