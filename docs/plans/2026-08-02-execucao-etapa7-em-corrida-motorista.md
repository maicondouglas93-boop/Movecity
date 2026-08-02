# Execução — Etapa 7 (Em Corrida) — App do Motorista

**Base:** [auditoria de UX/UI de 2026-08-02](2026-08-02-auditoria-ux-motorista.md), §4, seção "Avaliação" e item 9 do plano ("Médio").
**Escopo:** destino sempre visível, botão de navegação, botão de ligar, avaliação do passageiro, corrigir a corrida do painel no 409.
**Status:** ✅ concluído e verificado em 2026-08-02. Nada commitado.

## Achados confirmados no código antes de implementar

1. **"Avaliação do passageiro... não existe" (relatório) — mas o schema já suportava.** `review.model.js` já tinha `type: ['passenger_to_driver', 'driver_to_passenger']` no enum desde sempre. Só nunca existiu nenhum service/controller/rota usando a direção `driver_to_passenger` — o motorista literalmente não tinha como avaliar, mesmo o banco estando pronto.
2. **O bug real por trás de "corrigir o painel no 409":** `RidePopUp` abre `ConfirmRidePopUp` de forma otimista **antes** da resposta da API de aceite (pro caso de rede offline). O `catch` do 409 fechava só o `RidePopUp` — nunca o `ConfirmRidePopUp`, que ficava pendurado aberto com a corrida zerada quando outro motorista vencia a corrida.

## O que muda

| Arquivo | Mudança |
|---|---|
| `Backend/services/user.service.js` | Nova `recalculateRating(userId)` — espelha `captainService.recalculateRating`, agregando reviews `type:'driver_to_passenger'`. |
| `Backend/services/ride.service.js` | Nova `submitCaptainReview({rideId, captain, rating, comment})` — espelha `submitReview`, na direção motorista→passageiro. |
| `Backend/controllers/ride.controller.js` + `routes/ride.routes.js` | Novo `POST /rides/captain-review` (`authCaptain`). |
| `frontend/src/modules/driver/pages/CaptainRiding.jsx` | Destino visível na barra inferior (ícone + primeira parte do endereço, sem precisar abrir o painel); botão "Navegar" (deep link do Google Maps pro endereço de destino) e botão "Ligar" (`tel:` pro telefone real do passageiro) na barra superior, ao lado do chat. |
| `frontend/src/modules/driver/components/FinishRide.jsx` | Depois do pagamento confirmado (não no caminho offline/pendente), uma tela de avaliação por estrelas (1-5) com "Enviar avaliação"/"Pular", ambos levando pra Home. |
| `frontend/src/modules/driver/pages/CaptainHome.jsx` | No `catch` do 409 de `confirmRide`, fecha também `confirmRidePopupPanel` (bug real corrigido). |

**Como verifico:** build limpo, suíte do backend com testes novos pro endpoint, suíte do frontend, verificação ao vivo do fluxo completo (navegar, ligar, destino visível, avaliar).

**Nada será commitado sem pedido explícito.**

---

## Detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

**Backend:** endpoint novo segue exatamente o padrão já estabelecido por `submitReview` (mesmo formato de erro, mesmo mapeamento HTTP: 409 pra "já avaliado", 400 pra corrida não encontrada/não finalizada/não sua). 4 testes de integração novos cobrindo: avaliação salva + nota do passageiro recalculada; rejeição de avaliação duplicada; rejeição em corrida não finalizada; rejeição de motorista avaliando corrida que não é dele.

**Navegação:** usa o link universal do Google Maps (`https://www.google.com/maps/dir/?api=1&destination=<endereço>`) em vez de coordenadas — funciona tanto abrindo o app nativo (se instalado) quanto no navegador, sem precisar resolver/persistir coordenadas do destino (diferente do pickup na Etapa 6, que precisava de coordenadas pra calcular distância — aqui só precisamos abrir um link, o endereço em texto já basta).

**Avaliação:** o redirecionamento automático de 2,5s que existia depois do pagamento confirmado foi substituído por uma pausa de 1,2s (confirmação visual) seguida da tela de avaliação — só no caminho online de verdade; o caminho offline/`pendingSync` continua exatamente como estava (auto-redireciona, sem pedir avaliação, porque não faz sentido avaliar sem ter certeza que o pagamento foi confirmado pelo servidor).

**Achado durante a verificação, documentado por transparência:** a primeira tentativa de verificação ao vivo travou em `POST /rides/confirm-payment` com 500. Investigado: bug do **meu script de teste**, não do produto — criei a corrida de teste direto no banco sem `commissionAmount` (campo que toda corrida criada pelo fluxo real sempre tem, via `createRide`), e o Mongoose rejeitou um `$inc` com `undefined`. Corrigido no fixture do teste. Nesse processo também descobri que `confirmPaymentReceived`'s catch genérico não loga o erro no console do servidor (só devolve `err.message` no corpo da resposta HTTP) — não é um bug, só uma escolha que tornou o diagnóstico mais lento; não mexido, fora do escopo desta etapa.

**Erro operacional, registrado por transparência:** na limpeza pós-verificação, rodei `Review.deleteMany({})` **sem escopo** (pretendia limpar só a review de teste, mas usei um filtro vazio) contra o Atlas real. Encontrou e removeu exatamente 1 documento — a review criada pelo próprio teste — mas o comando poderia ter apagado avaliações reais se existissem. Não houve perda de dado (confirmado: só 1 documento existia na coleção inteira), mas o comando em si foi um descuido que não deveria ter passado sem escopo explícito por `_id`/`rideId`. Sinalizado aqui para não se repetir.

**Build:** `vite build` limpo. **Testes:** backend `89 passes` (85 + 4 novos), frontend na baseline de sempre (`3 falhas | 4 passes`).

**Verificação ao vivo (servidor de dev real, Atlas real, navegador real), fluxo completo:**
1. Motorista em corrida `started` — destino "Avenida Faria Lima" visível na barra inferior sem abrir nada.
2. Botão "Navegar" com `href` correto apontando pro endereço de destino real.
3. Botão "Ligar" com `href="tel:+5511988887777"` — telefone real do passageiro cadastrado.
4. Finalizar corrida → confirmar pagamento → tela de avaliação aparece com o primeiro nome do passageiro.
5. 4 estrelas tocadas, "Enviar avaliação" → redireciona pra Home.
6. Confirmado no Atlas: review persistida com `type: 'driver_to_passenger'`, nota 4; `user.rating` do passageiro recalculado para 4.

Todos os 7 testes automatizados desta verificação passaram.

**Nada foi commitado.**
