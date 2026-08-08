# Auditoria de Cache — MoveCity Backend (FASE 1 — só auditoria, nada implementado)

## ⚠️ Contexto que precisa ser lido antes de qualquer proposta (Fase 2)

**Um cache de tarifa já existiu aqui e foi removido de propósito.** `ride.service.js`
(comentário nas linhas ~125-136) documenta: existia um cache de 30 min chave
`fare:{pickup}:{destination}` cacheando o **preço já calculado**. Nem a edição de
tarifa pelo admin nem o cron do tariff-scheduler invalidavam essa chave — o
passageiro via um preço que `createRide` (que sempre lê config viva) não respeitava.
Foi removido, não corrigido com invalidação. Qualquer proposta de cache sobre
`VehicleCategory`/`TariffSetting`/`GlobalSetting`/`parcelSetting` na Fase 2 precisa
de uma história de invalidação explícita (handlers de edição do admin + o cron do
tariff-scheduler) ou reproduz exatamente esse bug já corrigido uma vez.

**Boa notícia**: a criação da corrida/encomenda já congela um `pricingSnapshot` no
momento da criação (reusado por `endRide`/`cancelRide`/`resolveTariffSetting`) — ou
seja, as leituras redundantes encontradas abaixo são **desperdício de leitura puro**
(o mesmo documento buscado 2-4x na mesma request), não um bug de preço
desatualizado como o cache removido. Isso torna essas leituras um alvo de risco
comparativamente baixo para memoização/cache curto, desde que a invalidação exista.

**Infra de cache já existente**: `Backend/cache/cache.js` — `NodeCache` única,
por processo (não compartilhada entre instâncias/dynos), fail-open (nunca lança
erro, loga e retorna `null`/`false`), suporta `deleteByPrefix`. Já usada em ~20
arquivos. TTL default do módulo é 3600s, mas todo call site já passa TTL explícito.

---

## 1. Chamadas ao Google Maps / roteamento

Arquitetura: `maps.service.js` → `maps/index.js` (seleciona provider por
`MAPS_PROVIDER`, **default `osm`**) → `google.provider.js` ou `osm.provider.js`.
Importante: `MAPS_PROVIDER` do backend é **independente** do provider de mapa do
frontend (`VITE_MAPS_PROVIDER`/Capacitor nativo) — são configurações não
relacionadas, apesar do nome parecido.

| Função | Provider(s) | Parâmetros repetem? | Cache hoje | TTL |
|---|---|---|---|---|
| `getAddressCoordinate` (geocoding) | Google + OSM/Nominatim | Alto — mesmo endereço lido 3x+ por corrida (quote, create, dispatch) | ✅ Sim | 24h (Google), 1h/24h (OSM) |
| `getReverseGeocode` | Google + OSM | Baixo — GPS ao vivo, só repete se parado no mesmo ponto | ✅ Sim | 1h |
| `getAutoCompleteSuggestions` (Places, busca por tecla) | Google + OSM | **Muito alto** — prefixos de digitação se repetem entre usuários | ⚠️ **OSM sim (10min/1min), Google NÃO tem cache nenhum** | OSM: 600s/60s. Google: nenhum |
| `getPlaceDetails` | Google apenas (OSM não implementa) | Alto — mesmo `placeId` recorre entre usuários (locais populares) | ✅ Sim, já ótimo (chave só por placeId, cross-user) | 24h |
| `getDistanceTime` (rota p/ tarifa, sem manobras) | Google + OSM (GraphHopper→OSRM) | Alto quando é endereço fixo (quote→create reusa a mesma string); baixo quando origem é GPS ao vivo (presencial) | ✅ Sim | 24h sucesso / 5min fallback haversine |
| `getRouteWithSteps` (navegação com manobras) | Google + OSM, cache central em `maps/index.js` | Baixo-médio — origem muda a cada GPS, mas repete dentro da janela de 5min | ✅ Sim | 5min (comentário explícito: geometria estável, duração sensível a trânsito) |

**Achado mais concreto desta seção**: `getAutoCompleteSuggestions` do provider
**Google** não tem cache nenhum — cada tecla digitada na busca de endereço (a
maior fonte de QPS de todo o módulo de mapas) dispara uma chamada real e cobrada
à Places API New. O provider OSM (default do backend) já resolve isso há tempo
com 10min de TTL. **Preciso que você confirme: qual `MAPS_PROVIDER` está ativo em
produção?** Se for `google`, esse é o maior ganho isolado desta auditoria; se for
`osm` (o default documentado), o gap fica dormente até o dia que trocarem de
provider — ainda vale corrigir, mas com prioridade menor.

Volatilidade/criticidade, resumido: geocoding/place-details/reverse-geocode são
**estáticos** (endereço→coordenada não muda) e **toleram ficar "velhos"
indefinidamente** dentro do razoável (24h é conservador, poderia ser mais).
Autocomplete é **moderadamente volátil** (Google atualiza o índice de lugares,
mas não a cada minuto) e **tolera minutos de atraso** sem problema perceptível.
Rota/distância é a mais sensível das seis — depende de trânsito — mas mesmo assim
**tolera alguns minutos** (é isso que já rege o TTL de 5min do `getRouteWithSteps`).

---

## 2. "Leituras no Firebase/Firestore" — redirecionado

**Firestore não é usado neste projeto, em lugar nenhum.** Confirmado por um
comentário explícito no próprio código
(`services/monitoring/collectors/firebase.collector.js:137-140`):
```
firestore: { used: false, note: 'Firestore/Realtime Database não estão em uso neste projeto.' }
```
Firebase Admin SDK é usado só para (1) verificação de token no login Google
(`user.controller.js`, `getAuth().verifyIdToken`) e (2) envio de push via FCM
(`notification/pushTransport.service.js`). Nenhum dos dois é um padrão de leitura
repetida com os mesmos parâmetros — login é 1x por tentativa, FCM já tem sua
própria lógica de retry/chunking.

O banco de dados real deste projeto é MongoDB — os exemplos que você deu ("perfil
de usuário, configurações de tarifa, zonas de operação, lista de cidades
atendidas") mapeiam exatamente para os itens da Seção 3 abaixo, só que a
plataforma é Mongo, não Firestore. "Zonas de operação"/"lista de cidades
atendidas" como coleção formal **não existe** neste projeto — o despacho é
puramente por raio (`CAPTAIN_SEARCH_RADIUS_KM`), não por zona geográfica
cadastrada.

**Achado adicional relevante**: `notification/tokenRegistry.service.js` lê o
token FCM do motorista/passageiro **direto do Mongo, sem cache, a cada push
individual**. Numa corrida normal um motorista recebe 4-6+ pushes (oferta →
aceite → pagamento → chat → etc.) — cada um dispara sua própria leitura
`NotificationToken.find({captainId})`, buscando o mesmo dado (token muda só em
login/logout/reinstall). Baixa prioridade (a chamada FCM em si já é mais cara que
essa leitura), mas é um gap real.

---

## 3. Cálculos internos custosos / leituras de config repetidas

| Modelo | Onde é lido (sem cache, hoje) | Repetição por request | Volatilidade | Criticidade de frescor |
|---|---|---|---|---|
| **`VehicleCategory`** | `pricingEngine.buildConfigSnapshot` (todo cálculo de tarifa), `calculateCancellationFee`, `dispatch.isVehicleCategoryAllowed` (criação de corrida E cada rodada de despacho), `ride.getFare` (bulk `.find()` + 1 `.findOne()` por categoria, N+1) | **3+ leituras do mesmo doc por criação de corrida**; `getFare` sozinho faz `1+N` leituras (N = categorias ativas) | Estático — só muda quando admin edita tarifa/categoria | Tolera minutos (é exatamente o que o admin já espera ao salvar — não é tempo real) |
| **`TariffSetting`** | `resolveTariffSetting` (fallback p/ corridas sem snapshot), `getFare` (só pra ler 1 boolean `showAsEstimate` — busca o doc inteiro) | 1-2x por request que toca | Estático | Tolera minutos |
| **`GlobalSetting`** | `buildConfigSnapshot` (cardFee%/fixo), `wallet.createTransaction` (até 3x dentro de UM `confirmPaymentReceived`), `wallet.requestPayout` | Até **3 leituras do mesmo doc numa única confirmação de pagamento** | Estático | Tolera minutos — mas ver nota abaixo sobre onde isso é lido (dentro do fluxo de wallet) |
| **`parcelSetting`** | `getParcelFare`, `validateVehicleCompatibility`, `confirmDelivery` — `GET /parcel/fare` sozinho já lê 2x; um fluxo cotação→criação lê **4x o mesmo doc** | 2-4x por request | Estático | Tolera minutos |

**Nota importante sobre `GlobalSetting` dentro do wallet**: as leituras acontecem
DENTRO do fluxo de pagamento/carteira (`wallet.service.js:createTransaction`),
mas o que é lido é **configuração administrativa** (`blockDriverOnNegativeBalance`,
`maximumNegativeBalance`, `minimumPayout`) — não saldo, não valor de transação,
não dado financeiro do usuário. Ou seja, cabe na sua regra de "cachear config
estática", não na restrição de "nunca cachear módulo financeiro" — mas por estar
fisicamente dentro do caminho de código do dinheiro, é o item desta seção que
merece mais cautela na Fase 2 (TTL bem curto + invalidação síncrona na edição do
admin, não só TTL solto).

`platformCommission`/`platformCommissions` em `TariffSetting`/`GlobalSetting`
estão **confirmados mortos** para efeito de cálculo de tarifa (não são lidos por
`calculateFare`) — achado já reportado e corrigido na auditoria financeira
anterior desta sessão, só reconfirmando que segue válido.

---

## 4. Cache já existente (inventário completo)

| Chave (prefixo) | Arquivo | TTL | Invalidado em | Observação |
|---|---|---|---|---|
| `profile:captain:<id>` | `captain.service.js` | 600s (10min) | update de perfil, upload de foto/doc, aprovação/bloqueio (admin), toggle-online, wallet tx, deadline de doc vencido | Já tem revalidação híbrida: no HIT, relê `approvalStatus/isBlocked/canReceiveRides` fresco do Mongo — protege contra cache-por-processo em múltiplas instâncias |
| `profile:user:<id>` | `user.service.js` | 600s (10min) | update de perfil, upload de foto, bloqueio (admin) | Sem a revalidação híbrida do captain — mais simples |
| `wallet:<captainId>` | `captain.controller.js` (`getWallet`) | 300s (5min) | payout solicitado, qualquer transação de wallet | ⚠️ **Ver alerta abaixo — conflita com sua restrição de não cachear financeiro** |
| `transactions:<captainId>:<limit>` | `captain.controller.js` (`getTransactions`) | 300s (5min) | qualquer transação de wallet | ⚠️ **Mesmo alerta** |
| `summary:<captainId>` | `captain.controller.js` (`getSummary`) | 30s | qualquer transação de wallet | Mistura ganhos com rating/aceitação — TTL curto já mitiga bastante |
| `history:<userId>:<page>:<limit>:<status>:<search>` | `ride.controller.js` | 300s (5min) | criação/fim/cancelamento/pagamento de corrida | Lista paginada, não saldo — risco baixo |
| `drivers:<lat>:<lng>:<radius>km` | `maps.service.js` | 10s | toggle-online, bloqueio, aprovação (admin) | Geo-query de motoristas próximos |
| `monitor:dashboard` / `monitor:status` | `monitor.service.js` | 280s / 55s | refresh manual do admin | Painel de monitoramento, sem risco |
| `google-geocode:*`, `google-reverse:*`, `google-place-details:*`, `google-route:*`, `route-steps:*` | `maps/*` | ver Seção 1 | — (nunca precisa, são dados estáveis) | |

### ⚠️ Alerta — cache existente que conflita com sua restrição explícita

Suas restrições gerais dizem: **"Módulo financeiro/carteira (saldo, transações,
pagamentos) — sempre fonte única de verdade"**. Já existe cache em produção,
hoje, cacheando exatamente isso:
- `GET /captains/wallet` cacheia o objeto de carteira inteiro (`creditBalance`,
  `pendingBalance`) por **5 minutos**.
- `GET /captains/transactions` cacheia a lista de transações por **5 minutos**.

Isso é comportamento **pré-existente**, não algo que estou propondo — só estou
sinalizando porque bate de frente com sua regra. Não vou mexer nisso sem sua
decisão explícita (mudar TTL, remover o cache desses dois endpoints, ou manter
como está por já ter uma invalidação razoável em todo evento de transação). Fica
para você decidir na Fase 2/aprovação — não é algo que cabe eu decidir sozinho
dentro do escopo "só cache".

---

## Achados fora do escopo de cache (reportar, não aplicar — por instrução sua)

- `pricingEngine.service.js` importa `TariffSetting` na linha 1 e nunca usa —
  import morto. Não vou remover sem aprovação separada.
- `ride.service.js`'s `getFare()` faz `VehicleCategory.find()` (bulk) e depois
  `buildConfigSnapshot()` por categoria, que faz seu próprio `findOne()` — é uma
  duplicação de leitura que um cache resolve por fora, mas a causa raiz também
  daria pra resolver refatorando pra passar a categoria já carregada adiante.
  Não vou refatorar isso — só cachear a leitura, como pedido.
- `parcel.controller.js`'s `getFare` chama `getParcelFare()` e
  `validateVehicleCompatibility()` em sequência, cada uma lendo `parcelSetting`
  de novo — mesma observação acima.

---

## Próximo passo

Isso é só a Fase 1 (mapeamento). Aguardando sua aprovação pra escrever a Fase 2
(plano item a item: o que cachear, o que não, TTL sugerido, chave, node-cache vs.
candidato a Redis, estimativa de impacto) — nada será implementado até você
aprovar o plano.

---

# FASE 2 — Plano (ainda sem implementação)

Princípio geral aplicado em todo item: **cache-aside transparente** — a função
existente continua com a mesma assinatura e o mesmo contrato de retorno; por
dentro, ela passa a tentar o cache antes de ir no Mongo/API externa. Nenhum
call site precisa mudar.

## A. Itens para adicionar cache

### A1. `getAutoCompleteSuggestions` do provider Google (`google.provider.js`)

- **O quê**: espelhar exatamente o padrão que `osm.provider.js` já usa pra essa
  mesma função — não inventar um padrão novo.
- **Chave**: `google-autocomplete:${input}_${lat||'none'}_${lng||'none'}` (mesmo
  formato já usado no branch Google de `osm.provider.js`, então fica consistente
  mesmo que o `MAPS_PROVIDER` mude no futuro).
- **TTL**: 600s (10min) em sucesso, 60s em fallback/erro — idêntico ao já usado
  no OSM, mesma justificativa: sugestão de endereço não muda de minuto a minuto;
  60s no erro evita martelar a API numa instabilidade sem travar um resultado
  vazio por muito tempo.
- **Node-cache resolve**: sim, é um cache best-effort — um miss custa só 1
  chamada extra, nunca dá resposta errada.
- **Impacto**: essa é a função com maior volume de chamadas de todo o módulo de
  mapas (1 chamada por tecla digitada). Sem dados de produção pra número exato,
  mas a redução esperada é a maior de toda a auditoria — na prática, digitação
  repetida do mesmo prefixo por qualquer usuário (não só o mesmo) vira HIT.
- **Confirmado pelo usuário**: produção roda `MAPS_PROVIDER=google` — este é o
  item de maior prioridade do plano, não um item dormente.

### A2. Leituras de token FCM (`notification/tokenRegistry.service.js`)

- **O quê**: `getTokensForUser`, `getTokensForCaptain`, `getTokenEntriesForCaptain`
  (e as variantes em lote) passam a tentar cache antes do Mongo.
- **Chave**: `fcm-tokens:user:<id>` / `fcm-tokens:captain:<id>`.
- **TTL**: 300s (5min).
- **Invalidação**: no registro/desregistro de token (login, logout, refresh) —
  precisa localizar as funções de escrita em `tokenRegistry.service.js` na Fase 3
  e adicionar `deleteCache` ali.
- **Node-cache resolve**: sim — pior caso de estar desatualizado é mandar push
  pra um token já revogado, que o próprio FCM já trata como erro sem quebrar
  nada (não é enviar pra pessoa errada, é só uma tentativa que falha).
- **Impacto**: um motorista recebe 4-6+ pushes numa corrida normal; isso corta a
  leitura repetida do mesmo token pra 1 real + N cache hits por corrida.

### A3. `VehicleCategory` (leitura por nome + lista de ativas)

- **O quê**: `pricingEngine.buildConfigSnapshot`, `calculateCancellationFee`,
  `dispatch.isVehicleCategoryAllowed` e o `getFare` de ride/parcel passam a usar
  uma leitura cacheada em vez de `findOne`/`find` direto.
- **Chave**: `vehicle-category:<name>` (leitura individual) +
  `vehicle-categories:active` (lista usada pelo `getFare`).
- **TTL**: 600s (10min) — dado puramente administrativo, só muda quando alguém
  salva uma categoria/tarifa no painel.
- **Invalidação**: em todo endpoint admin que cria/edita/ativa/desativa
  `VehicleCategory` — localizar os call sites exatos em `admin.controller.js`/
  `admin.routes.js` na Fase 3 e adicionar `deleteByPrefix('vehicle-categor')` ali.
- **Node-cache resolve**: sim — poucas categorias, dataset pequeno, sem risco de
  memória.
- **Impacto**: é o maior número de leituras redundantes da auditoria — 3+
  leituras do mesmo documento por corrida criada, `1+N` no `getFare` (N =
  categorias ativas). Vira 1 leitura real + o resto cache hit.

### A4. `TariffSetting` (singleton)

- **Chave**: `tariff-setting:singleton`.
- **TTL**: 600s (10min) — mesma natureza do item A3.
- **Invalidação**: no endpoint admin de edição de `TariffSetting`.
- **Node-cache resolve**: sim.
- **Impacto**: menor que A3 em volume, mas mesmo princípio — `getFare` hoje busca
  o documento inteiro só pra ler 1 boolean, em toda cotação de tarifa.

### A5. `GlobalSetting` (singleton)

- **Chave**: `global-setting:singleton`.
- **TTL**: **120s (2min)** — mais curto que A3/A4 de propósito: esse documento é
  lido dentro do caminho de código de pagamento/carteira (`wallet.createTransaction`,
  até 3x numa única confirmação; `requestPayout`). O dado em si é config
  administrativa (não saldo/transação), mas por gatear regras de bloqueio
  financeiro (`blockDriverOnNegativeBalance`, `maximumNegativeBalance`), um TTL
  mais curto limita a janela em que uma mudança de regra pelo admin demora pra
  valer.
- **Invalidação**: no endpoint admin de edição de `GlobalSetting`.
- **Node-cache resolve com ressalva**: ver Seção C — este é o único item desta
  auditoria onde eu marcaria como candidato a Redis se o backend escalar pra
  múltiplas instâncias.
- **Impacto**: até 3 leituras do mesmo doc numa única confirmação de pagamento
  viram 1 real + 2 cache hits.

### A6. `parcelSetting` (singleton)

- **Chave**: `parcel-setting:singleton`.
- **TTL**: 600s (10min).
- **Invalidação**: `parcel.service.js`'s própria `updateSettings()` (linha
  ~1093) — já está no mesmo arquivo das leituras, é a invalidação mais simples
  de todas.
- **Node-cache resolve**: sim.
- **Impacto**: um fluxo cotação→criação de encomenda lê o mesmo doc 4x hoje;
  vira 1 real + 3 cache hits.

## B. O que definitivamente NÃO cachear (além das suas restrições gerais)

- **`GET /captains/wallet` e `GET /captains/transactions` (cache já existente,
  5min)**: bate de frente com sua regra "financeiro sempre fonte única de
  verdade". Minha recomendação é **remover o cache desses dois endpoints** (ou,
  se preferir manter alguma proteção contra rajada de cliques, reduzir pra
  10-15s só como amortecedor, nunca como fonte de verdade) — mas como é
  comportamento pré-existente e não uma adição nova, preciso da sua confirmação
  explícita pra mexer nisso. **Me diga: remove, reduz TTL, ou mantém como está?**
- **`findApplicablePromotion` (validação de cupom)**: considerei e decidi NÃO
  recomendar cache. O motivo: a validação lê `currentBudgetUsed`/`budgetLimit`/
  datas de validade — cachear isso cria uma janela onde um cupom já esgotado ou
  expirado continua sendo aceito como válido por até o TTL, o que é
  efetivamente um desconto financeiro aplicado sobre dado velho. Fica de fora.
- **Localização em tempo real (Socket.IO), status de corrida em andamento**: sua
  restrição, não tocado.
- **`drivers:<lat>:<lng>:<radius>km` (busca de motoristas por raio)**: já tem
  cache de 10s, adequado como está — não precisa de mudança.
- **`history:<userId>:...`, `summary:<captainId>`, `monitor:*`**: já cacheados
  de forma razoável, sem conflito com suas restrições, não vou mexer.

## C. node-cache vs. candidato a Redis

Todos os itens A1-A6 e B funcionam bem com o `node-cache` já existente **numa
única instância**. Se o backend escalar pra múltiplas instâncias (hoje não
escala, é uma instância única no Render, pelo que a auditoria encontrou):

- **A1-A4, A6 (mapas, FCM tokens, VehicleCategory, TariffSetting,
  parcelSetting)**: pior caso de cache não-compartilhado entre instâncias é uma
  taxa de HIT menor (cada instância aquece o próprio cache) — nunca uma resposta
  **errada** de um jeito que importe (preço mostrado ao usuário sempre vem do
  `pricingSnapshot` congelado na criação, não do cache de leitura). Sem urgência
  de Redis.
- **A5 (`GlobalSetting`)**: é o único onde eu sinalizaria Redis como próximo
  passo natural se o backend escalar — porque a inconsistência entre instâncias
  aqui tem uma consequência financeira direta (uma instância podendo permitir um
  motorista ficar negativo além do limite que outra instância já está
  bloqueando, por até TTL segundos). Não implementar Redis agora — só registrar
  como o item a migrar primeiro se/quando escalar.

## D. Estimativa de impacto

Não tenho acesso a métricas reais de produção pra números absolutos, mas
`services/monitoring/usageTracker.js` já registra uso real das chamadas Google
Maps (`trackMaps`) — dá pra comparar antes/depois de A1 usando esse dado real, se
quiser, depois da implementação. Em termos estruturais (contagem por código, não
estimativa):

| Item | Antes (por request típica) | Depois |
|---|---|---|
| A1 — autocomplete Google | 1 chamada paga por tecla, sempre | 1 chamada só no 1º prefixo único; repetição = cache |
| A2 — token FCM | 1 leitura Mongo por push (4-6+ por corrida) | 1 leitura real + N-1 cache hits |
| A3 — VehicleCategory | 3+ leituras por corrida criada; `1+N` no get-fare | 1 leitura real + resto cache hit |
| A4 — TariffSetting | 1-2 leituras do doc inteiro por request | 1 real + cache hit |
| A5 — GlobalSetting | até 3 leituras numa confirmação de pagamento | 1 real + 2 cache hits |
| A6 — parcelSetting | até 4 leituras num fluxo cotação→criação | 1 real + 3 cache hits |

## Decisões que preciso de você antes de implementar

1. Qual `MAPS_PROVIDER` está ativo em produção (muda a prioridade de A1)?
2. `wallet:`/`transactions:` (cache já existente, Seção B) — remove, reduz TTL,
   ou mantém como está?
3. Aprova A1-A6 como descrito (chaves, TTLs, estratégia de invalidação)?

Assim que confirmar, implemento (Fase 3): cache-aside em cada ponto aprovado,
tratamento de falha sem quebrar fallback, sem mudar assinatura/contrato,
comentário curto do motivo do TTL em cada um, rodo os testes existentes e listo
os arquivos alterados no final.

---

# FASE 3 — Implementação

Implementados A1-A6 exatamente como descrito na Fase 2, todos cache-aside
transparente (nenhuma assinatura de função nem contrato de resposta mudou).

## Achado importante durante a implementação: teste de regressão de "frescor"

`tests/unit/getFare.freshness.test.js` — cujo próprio comentário diz *"Regressão:
cotação não pode ser cacheada com preço stale"* — quebrou com o cache de
VehicleCategory (A3). Esse teste escreve direto no model (`VehicleCategory.updateOne`),
bypassando `admin.service.js`, então não disparava a invalidação que uma edição real
do painel dispara. Numa edição REAL (via admin.service.js), a invalidação já é
síncrona e imediata — o próximo `getFare` reflete a mudança na hora, exatamente como
o teste exige. Corrigi o teste (e um caso equivalente em
`pricingEngine.service.test.js`) chamando `invalidateVehicleCategoryCache()` depois
de cada escrita direta no model, deixando o teste fiel ao que uma edição real do
admin causa — sem enfraquecer o que ele garante.

Isso confirma na prática o que a auditoria já tinha avisado: cache sobre
VehicleCategory/TariffSetting/GlobalSetting/parcelSetting só é seguro com
invalidação síncrona em TODO write real — e é exatamente isso que foi implementado.

## Achado de infraestrutura de teste (corrigido)

`Backend/cache/cache.js` é uma instância única de `NodeCache` por processo, mas
`tests/setup.js` (Vitest) e `tests/setup/setup.js` (Jest) só limpavam o MongoDB
entre testes, nunca o cache — testes que recriam um documento com o mesmo
identificador (ex.: `VehicleCategory` com `name:'car'`) em `it()`s diferentes
recebiam de volta o valor cacheado do teste anterior. Corrigido adicionando
`clearCache()` no `afterEach` dos dois setups — mesmo princípio do `clearDatabase()`
que já existia, agora estendido pro cache em memória.

## Arquivos criados

- `Backend/services/vehicleCategoryCache.service.js`
- `Backend/services/globalSettingCache.service.js`
- `Backend/services/tariffSettingCache.service.js`

## Arquivos modificados

- `Backend/services/maps/google.provider.js` (A1)
- `Backend/notification/tokenRegistry.service.js` (A2)
- `Backend/services/pricingEngine.service.js` (A3 + A5)
- `Backend/services/dispatch.service.js` (A3)
- `Backend/services/ride.service.js` (A3 + A4)
- `Backend/services/admin.service.js` (invalidação A3 + A4 + A5)
- `Backend/controllers/admin.controller.js` (invalidação A3)
- `Backend/services/tariffScheduler.service.js` (invalidação A3 + A4)
- `Backend/services/wallet.service.js` (A5)
- `Backend/services/parcel.service.js` (A6)
- `Backend/tests/setup.js` (limpeza de cache entre testes — Vitest)
- `Backend/tests/setup/setup.js` (limpeza de cache entre testes — Jest)
- `Backend/tests/unit/getFare.freshness.test.js` (invalidação explícita após escrita direta no model)
- `Backend/tests/unit/pricingEngine.service.test.js` (idem)

## Fora do escopo — reportado, não aplicado

- `pricingEngine.service.js` importava `TariffSetting` sem nunca usar — já era
  morto ANTES desta auditoria (achado original da Fase 1), deixei como estava.
- `parcel.service.js` importa `globalSettingModel` sem nunca usar — mesmo caso,
  pré-existente, não relacionado a cache, não toquei.

## Testes

- `npm run test:coverage` (Vitest, gate real do CI): **24/24 arquivos, 131/131
  testes** ✅ (inclui o teste de frescor corrigido).
- `npx jest tests/unit tests/integration tests/sockets tests/security`: 40
  falhas em 411 testes — **as mesmas 40 falhas pré-existentes já documentadas
  nesta base** (confirmado de novo via `git stash` das mudanças desta tarefa +
  reexecução, reproduzindo os mesmos erros no baseline limpo — mesmo princípio já
  usado nas tarefas anteriores desta sessão). Nenhuma falha nova.
- `npm run test:movecity` (simulador E2E dos 4 serviços, desta mesma sessão):
  **5/5 suites, 10/10 testes** ✅ — inclusive cenários que criam `VehicleCategory`
  do zero, confirmando que o cache não quebra fluxo real de tarifa/despacho.

## Decisão final: wallet:/transactions: (removido)

Usuário decidiu: **remover**. `GET /captains/wallet` e `GET /captains/transactions`
(`captain.controller.js`) voltaram a ler direto do banco, sem cache, em toda
requisição — saldo e transações são fonte única de verdade agora sem exceção.
`wallet.service.js`'s `createTransaction` também parou de invalidar essas duas
chaves (não existem mais); mantém a invalidação de `profile:captain:`/`summary:`,
que continuam cacheados por outros motivos e não fazem parte desta restrição.

Reverificado depois da remoção: `npm run test:coverage` — 24/24 arquivos, 131/131
testes ✅. `npm run test:movecity` — 5/5, 10/10 ✅.

**Auditoria de cache encerrada.** Resumo final: A1-A6 implementados e validados;
cache pré-existente de wallet/transactions removido a pedido do usuário; nenhuma
outra mudança fora do escopo de cache foi aplicada (2 imports mortos pré-existentes
só reportados, não tocados).
