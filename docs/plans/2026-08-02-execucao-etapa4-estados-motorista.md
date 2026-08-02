# Execução — Etapa 4 (Estados: vazio, carregando, erro) — App do Motorista

**Base:** [auditoria de UX/UI de 2026-08-02](2026-08-02-auditoria-ux-motorista.md), item 9 do plano.
**Escopo:** `EmptyState`/`Skeleton` nas telas do motorista; separar erro de vazio no histórico; `ConnectionBanner`; erro com retry no mapa. Risco baixo, sem mudar API/regra de negócio.
**Status:** ✅ concluído e verificado em 2026-08-02. Nada commitado.

## O que muda

| Arquivo | Mudança |
|---|---|
| `shared/components/LiveTracking.jsx` | Novo estado `mapError` — se `provider.init()` falhar, mostra `EmptyState` (variant `error`) com botão "Tentar de novo" em vez de deixar o mapa em branco sem explicação. **Componente compartilhado** com o passageiro — o benefício vale pros dois lados, sinalizado aqui por transparência mesmo não sendo pedido pro módulo do passageiro especificamente. |
| `modules/driver/pages/CaptainHome.jsx` | Monta `<ConnectionBanner />` — motorista fica horas nesta tela esperando corrida; hoje não há nenhum aviso de queda de conexão. |
| `modules/driver/pages/CaptainRiding.jsx` | Monta `<ConnectionBanner />` — mesma razão, ainda mais crítico com passageiro no carro. |
| `modules/driver/pages/CaptainRidesHistory.jsx` | Loading vira `RideCardSkeleton` × 3 (formato já existe no UI kit, mesmo shape do card real). Erro de rede deixa de cair no mesmo `EmptyState` de "sem corridas" — vira `EmptyState variant="error"` com retry, resolvendo o achado do relatório (§2.13: erro de rede era relatado como "você nunca dirigiu"). |
| `modules/driver/pages/CaptainWallet.jsx` | "Nenhuma transação encontrada" vira `EmptyState`. |

**Como verifico:** build limpo, suíte na baseline, e verificação ao vivo forçando os 3 cenários nomeados (histórico com erro de rede real, mapa com falha de init, banner de conexão com socket derrubado).

**Nada será commitado sem pedido explícito.**

---

## Detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

**`CaptainRidesHistory.jsx`:** o `.catch(() => null)` que existia dentro do `queryFn` do react-query foi removido — ele convertia qualquer falha de rede/servidor num resultado silencioso (`[]`), fazendo o `EmptyState` de "sem corridas" aparecer também nos casos de erro real (achado §2.13 do relatório). Agora o `queryFn` deixa o erro propagar, e a tela decide entre 3 estados de verdade: `RideCardSkeleton` × 3 durante o carregamento, `EmptyState variant="error"` com botão de retry (chamando `refetch()` do react-query) quando a requisição falha, e o `EmptyState` neutro só quando a lista realmente veio vazia do servidor.

**`CaptainWallet.jsx`:** "Nenhuma transação encontrada" (texto solto) virou `EmptyState`; o spinner central de carregamento virou 3 blocos `Skeleton` do tamanho de uma linha de transação.

**`CaptainHome.jsx` e `CaptainRiding.jsx`:** `<ConnectionBanner />` montada nas duas telas onde o motorista passa mais tempo (esperando corrida, dirigindo) — antes o app não tinha nenhum aviso visual de internet caída ou socket desconectado em lugar nenhum do lado do motorista.

**`shared/components/LiveTracking.jsx` (compartilhado com o passageiro):** novo estado `mapError` + `retryKey` — se `provider.init()` rejeitar, mostra `EmptyState variant="error"` com "Tentar de novo" (que força o efeito de inicialização a rodar de novo) em vez de deixar um mapa em branco sem nenhuma explicação. Como o componente é compartilhado, o benefício também vale pro app do passageiro — não pedido especificamente pra lá, mas decidi não duplicar a lógica só pra restringir ao motorista.

**Achado durante a verificação, documentado por transparência:** o provider de mapa ativo por padrão neste projeto é o Leaflet (`VITE_MAPS_PROVIDER=leaflet` no `.env`), cujo `init()` é síncrono e não depende de rede (`L.map(...)` + `L.tileLayer(...)`, sem `await` nem fetch que possa rejeitar) — então, na configuração atual, o novo branch de erro é código correto mas inalcançável na prática (só dispara de fato se o provider Google Maps estiver ativo, cujo `init()` carrega a API JS do Google de forma assíncrona e pode falhar de verdade). Não é um bug: o contrato (`mapContract.js`) trata os dois providers de forma uniforme de propósito, e a proteção fica pronta para quando/se o provider Google for usado, sem custo adicional. Tentei forçar a falha via `page.route().abort()` bloqueando `maps.googleapis.com` — confirmou exatamente essa hipótese (nenhum efeito, porque o Leaflet nunca chama esse domínio).

**Build:** `vite build` limpo. **Testes:** suíte do frontend na mesma baseline (`3 falhas | 4 passes`).

**Verificação ao vivo (Playwright, servidor de dev real, 3 cenários forçados via `page.route().abort('failed')` e eventos `online`/`offline` reais):**
1. `POST/GET /rides/captain-history` abortado de propósito → depois do backoff do react-query (`retry:2`, alguns segundos), a tela mostra "Não foi possível carregar seu histórico" com botão "Tentar de novo" — confirmado por screenshot, não mais o texto genérico de "sem corridas".
2. `window.dispatchEvent(new Event('offline'))` disparado de verdade no navegador → `ConnectionBanner` aparece imediatamente com "Sem conexão com a internet"; `online` reverte.
3. Tentativa de forçar erro no mapa via bloqueio de `maps.googleapis.com` → sem efeito, pelo motivo já descrito (Leaflet é o provider ativo, não depende desse domínio) — comportamento esperado, não uma falha da verificação.

Todos os dados de teste descartáveis removidos ao final.

**Nada foi commitado.**
