# Tela verde de oferta nativa — 11/09/2026

## Correção

A tela existente (`RideOfferActivity`) volta a ser solicitada em segundo plano
quando o motorista autoriza **Aparecer sobre outros apps** (`SYSTEM_ALERT_WINDOW`).
A Home explica o uso, abre o ajuste somente após um toque e reconsulta a permissão
ao voltar. A negativa é respeitada e não impede ficar online. O pacote Play
continua sem permissões de alarmes exatos, instalação de APK e full-screen intent.

A notificação Aceitar/Recusar é publicada antes de solicitar a Activity. Só a tela
retomada em `onPostResume` cancela esse fallback, para cobrir bloqueios silenciosos de OEM.
Não há mais tentativas repetidas nem agendamento de alarmes para abrir a oferta.
Uma solicitação de abertura não prova que o Android exibiu a tela.

Socket e FCM levam o mesmo `offerExpiresAt`; o prazo restante (até 45 segundos)
vale para a notificação e a tela. Ofertas vencidas/malformadas não abrem; receber
novamente a mesma janela não reinicia a apresentação. Dados legados sem prazo têm
fallback de 45 segundos. A expiração do destaque não cancela a corrida no servidor.

## Verificações automatizadas

- Frontend: 7 arquivos / 65 testes passando (Home, notificações, fila, bridge,
  onboarding e consentimento).
- Android: 8 testes JUnit da política de apresentação e prazo.
- Compilação Java da variante Play e merge do manifesto.
- Build do frontend motorista e lint dos módulos de permissão/bridge/testes alterados.
- Manifesto Play: `SYSTEM_ALERT_WINDOW` presente; `USE_FULL_SCREEN_INTENT` e
  permissões de alarmes exatos permanecem ausentes.

## Validação obrigatória em aparelho antes de publicar

Não havia aparelho conectado durante esta correção. Não foi enviado push para
motoristas reais, criado pedido, aceitada corrida ou publicado AAB.

Usar conta de teste e aparelho físico, incluindo o fabricante do relato:

1. Atualizar sem limpar dados. Abrir Home: deve explicar a sobreposição mesmo se o
   onboarding da versão antiga já tiver sido dispensado. Não abre ajustes sozinho.
2. Negar/dispensar: oferta em segundo plano chega como notificação com ações. Abrir
   o corpo deve mostrar a tela verde. Não afirmar que o banner fica expandido:
   o tempo de heads-up é controlado pelo sistema.
3. Autorizar **Aparecer sobre outros apps**, voltar e confirmar sumiço do aviso.
   Em Xiaomi/Redmi, conferir também permissões de pop-up/tela bloqueada do fabricante.
4. Com outra aplicação aberta, receber uma oferta de teste: tela verde, valor,
   rota, Aceitar/Recusar, sem depender de tocar no banner. Repetir bloqueado e
   com a tela apagada. Observar se o OEM exige ajuste adicional.
5. Repetir com MoveCity aberto: uma única tela para a entrega socket + FCM.
6. Recusar e aceitar (apenas ofertas de teste): parar o feedback, fechar a tela;
   aceite leva à corrida/encomenda correta. Testar resposta HTTP chegando logo
   após o prazo: não interromper um aceite já enviado.
7. Aguardar sem responder: fechar ao vencer o prazo original, sem reabrir por
   duplicata atrasada. Oferta recebida com 30s de atraso destaca só os 15s restantes.
8. Enviar segunda oferta durante a primeira: dados/botões atualizam via
   `onNewIntent`; durante aceite em andamento, preservar o alvo e manter a nova
   oferta na notificação/fila. Repetir corrida e encomenda.
9. Revogar sobreposição: nenhuma abertura automática em background; fallback
   continua disponível. Sem permissão não prometer tela por cima dos outros apps.
10. Repetir com bateria restrita, Não Perturbe e app removido dos recentes. Uma
    parada forçada nas configurações pode impedir FCM; isso não é resolvido por
    sobreposição. Não prometer funcionamento após parada forçada.

Logs filtrados (não guardar tokens ou dados de passageiros): `RideOfferFlow`,
`RideOfferNotifier`, `MoveCityFCM`. Procurar `OFFER_NATIVE_REQUESTED` seguido de
`OFFER_NATIVE_VISIBLE`; só o segundo confirma que a Activity foi retomada. `OFFER_EXPIRED`
e `OFFER_NOTIFICATION_FALLBACK` explicam decisões sem abertura.

## Distribuição

Exige novo AAB do motorista; deploy só do servidor não leva código Java nem a
permissão ao aplicativo instalado. Revisar a divulgação dessa permissão nas
informações da Play conforme o processo de publicação. Não foi feito deploy ou
publicação nesta correção.

Referência: [exceções autorizadas de abertura em segundo plano no Android](https://developer.android.com/guide/components/activities/secure-bal).
