# Diagnóstico e correção — push de corrida nova

**Data:** 2026-08-03
**Pedido:** transformar a notificação de corrida numa experiência profissional (Uber/99) — alerta chamativo, aceite direto pela notificação, sem perder chamadas.

## Diagnóstico (fase 1, sem alterações — apresentado e aprovado antes de codificar)

### Já funcionava de verdade
- Aceite atômico no backend (`ride.service.js: acceptRideAtomic`) — `findOneAndUpdate` filtrando `status:'requested'`, comprovado por teste de concorrência já existente.
- Botão "Aceitar" real: SW pega JWT do IndexedDB, chama `POST /rides/:id/accept`, trata 200/409/401, com lock contra duplo clique.
- `requireInteraction: true`, ícone, ações (Aceitar/Recusar/Abrir App) já existiam.

### Lacunas reais corrigidas
1. Mensagem sem preço — `fare` nunca chegava ao payload da notificação.
2. Sem `vibrate`/`badge` em nenhum `showNotification()`.
3. Sem prioridade explícita de entrega (`Urgency`).
4. Mensagem enganosa: corrida cancelada mostrava "outro motorista aceitou".
5. ~~Expiração automática de corrida~~ — **usuário decidiu não implementar.**
6. ~~Registrar recusa~~ — **usuário decidiu manter como está (só fecha a notificação).**
7. Notificações do mesmo fluxo empilhavam na bandeja em vez de se substituir.

### Limitação de plataforma (não corrigível em código)
- "Canal Android nativo com importância alta": API nativa (Kotlin/Java) ou de wrapper TWA/Capacitor — **confirmado que não existe nenhum wrapper nativo neste repositório**, é uma PWA pura. Equivalente web real: `Urgency: high` + `requireInteraction` + `vibrate` + `badge` — é isso que foi implementado.
- Som customizado: a Web Notifications API não tem essa propriedade em nenhum navegador — o SO toca o som padrão dele.
- iOS: Web Push só funciona com o PWA instalado na tela de início; no Safari em aba, não funciona.
- Heads-up banner: depende do SO/permissões do usuário — nenhum app consegue garantir, nem o Uber.

## Correções implementadas

| # | Arquivo | Mudança |
|---|---|---|
| 1 | `Backend/notification/notificationDispatcher.service.js` | `sendNewRide`: título `"🚗 Nova corrida disponível"`, mensagem `"Passageiro próximo • R$ XX,XX"` (formatada a partir de `data.fare`); `webpush.headers.Urgency: 'high'`; `vibrate`, `badge`, `tag: 'ride-'+rideId` no payload (documentado que só têm efeito real se o SW deixar de interceptar via `onBackgroundMessage` — ver linha abaixo) |
| 1 | `Backend/controllers/ride.controller.js` | `dispatchRideToCaptains` passa `fare: ride.fare` pra `sendNewRide` |
| 2, 7 | `frontend/public/firebase-messaging-sw.js` | `onBackgroundMessage`: adiciona `badge` sempre, e `vibrate`/`tag` só na oferta (`NEW_RIDE`) — é aqui que as opções realmente valem, porque o handler intercepta e monta a notificação na mão (o `webpush.notification.*` do backend nunca chega no `payload` deste handler) |
| 4 | `Backend/services/ride.service.js` | `acceptRideAtomic`: checa `existingRide.status === 'cancelled'` antes de assumir "já aceita"; lança `RIDE_CANCELLED` |
| 4 | `Backend/controllers/ride.controller.js` | `performAcceptRide`: trata `RIDE_CANCELLED` com mensagem própria ("O passageiro cancelou esta corrida.") |
| 4, 3, 7 | `frontend/public/firebase-messaging-sw.js` | Fluxo de aceite: `tag` compartilhada substitui a notificação anterior em vez de empilhar; 409 agora lê a mensagem real do `response.json()` em vez de texto fixo — mostra a causa certa (cancelada vs. já aceita) |
| item 3 do pedido | `frontend/public/firebase-messaging-sw.js` | Aceite com sucesso (200) chama `focusOrOpenWindow('/captain-riding')` direto — antes só mostrava uma notificação passiva pedindo mais um toque. `CaptainRiding.jsx` já se recupera sozinho via `GET /rides/captain-current`, então é seguro abrir direto nela |

### Achado técnico durante a implementação
`webpush.notification.actions/vibrate/badge/tag` setados no backend **nunca chegam** ao handler `onBackgroundMessage` do Service Worker — o objeto `payload` que esse handler recebe só tem `{notification, data, fcmOptions}`. Quem de fato desenha a notificação na tela é o próprio SW, reconstruindo tudo manualmente. Por isso a correção real dos itens 2 e 7 ficou no `firebase-messaging-sw.js`, e o que foi adicionado no backend serve por completude de especificação (não é usado hoje, mas não atrapalha e documenta a intenção caso a interceptação do SW mude no futuro).

## Testes (sem mocks de negócio — só Firebase, documentado)

Novo `Backend/tests/integration/ride.push.accept.test.js`, um `describe` por cenário pedido:

1. **App fechado recebe push** — motorista com `socketId: null`, fluxo real de criação de corrida, notificação gravada com título e `"Passageiro próximo • R$ XX,YY"` no formato exato.
2. **Aceitar pela notificação** — chama o mesmo endpoint que o SW chama (`POST /rides/:id/accept`), confirma 200, corrida `accepted`, PIN nunca vaza na resposta, passageiro notificado.
3. **Dois motoristas ao mesmo tempo** — `Promise.all` de dois `POST /rides/:id/accept` diferentes na mesma corrida: exatamente um 200 e um 409, banco com só um motorista.
4. **Token expirado** — JWT real expirado (`expiresIn: '-1h'`, verificado de verdade pelo `jsonwebtoken`, não mock de relógio) → 401, corrida continua `requested`.
5. **Cancelada antes do clique** — passageiro cancela, motorista tenta aceitar depois → 409 com `"O passageiro cancelou esta corrida."`, não mais a mensagem de "outro motorista".

**Único mock desta suíte inteira:** nenhum novo. O envio real ao Firebase falha neste ambiente por falta de credenciais (já documentado desde a Fase 1 da correção anterior) — isso não é mockado, é a ausência real de configuração, e os testes verificam que o sistema se comporta corretamente mesmo assim (não é o alvo destes 5 cenários, que são sobre o fluxo de aceite, não sobre entrega ao Firebase).

Três testes de arquivos anteriores tinham o título antigo (`'Nova Corrida Disponível!'`) fixado como asserção — atualizados para o novo formato, não revertidos.

### Resultado
- **Backend:** 20 suites, **150 testes**, todos passando.
- **Frontend:** build OK; suíte com a mesma falha pré-existente já documentada (não relacionada), nenhuma nova.

## O que fica de fora, por decisão do usuário
- Expiração automática de corrida sem resposta (achado 5) — corrida fica `requested` indefinidamente até aceite ou cancelamento manual, como já era.
- Registro de recusa (achado 6) — "Recusar" continua só fechando a notificação, sem chamada ao backend.
