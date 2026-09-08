# Lote 5 — Viagem em andamento, GPS, medição e ajuda

Implementado localmente em 08/09/2026 sobre `cc599be` (lotes 1–4). Escopo: I03/I06 e parte de C06/I11 da auditoria. A auditoria completa ainda tem itens pendentes.

## Entregue

- Tela de viagem organizada em barra de navegação, área livre de mapa e painel com rolagem. Finalizar corrida permanece em uma faixa própria, acessível mesmo com detalhes expandidos e fonte ampliada.
- Tempo, distância e valor continuam acessíveis; identidade, endereços completos, pagamento, telefone e chat ficam nos detalhes. O valor não é mais duplicado em vários blocos.
- Mapa ocupa o espaço que não está coberto por barras. Um ResizeObserver, habilitado somente nessa tela, informa mudanças de tamanho ao provider sem recriar mapa, rota ou coleta de GPS. Não houve mudança no cálculo da câmera nem criação de outro coletor de localização.
- Próxima manobra e previsão aproximada de chegada só aparecem com posição utilizável e destino definido. Não são exibidas para uma presencial com destino pendente, nem com GPS antigo/ruim. A previsão vem da navegação existente; não foi inventado trânsito em tempo real.
- GPS e internet tratados separadamente. Posição ausente, sem horário, antiga, com erro ou imprecisa não recebe um rótulo de GPS funcionando. Detalhes mostram idade da posição, precisão informada e ação para revisar permissões.
- Alerta visual de GPS fica antes do valor quando há problema. Posição com mais de **15 segundos** fica desatualizada para apresentação/navegação; precisão acima de **100 m** coincide com o limite já usado pelo cálculo de percurso. Não foram alterados os filtros, distâncias cobradas ou tarifas. Precisão ausente é explicitada sem rejeitar os pontos legados aceitos pelo algoritmo existente.
- Medição distingue valor atualizado pelo servidor, estimativa local, estimativa inicial, tarifa indisponível e último valor disponível após falha de leitura. Confirmação atrasada com rede ativa não é rotulada como falta de internet.
- Erro de leitura local mantém o último valor e informa que ele não está sendo atualizado. O contador tenta novamente automaticamente e há uma ação manual nos detalhes. Uma leitura antiga não substitui confirmação mais nova, nem mistura outra corrida.
- Valor/tempo/distância ficam fora dos anúncios automáticos. Regiões de status anunciam mudanças de GPS/medição, não cada centavo ou segundo. Novas ações principais usam verde escuro; não se trata de revisão global de contraste.

## Ajuda e segurança

Botão acessível durante a viagem abre um painel com distinção entre emergência e suporte comercial. Não cancela, finaliza, aciona atendimento ou compartilha localização automaticamente.

Os links de emergência abrem o discador: Polícia Militar **190** e SAMU **192**, códigos nacionais conferidos em fonte oficial da [Anatel](https://www.gov.br/anatel/pt-br/regulado/numeracao/codigos-nacionais/servicos-de-utilidade-publica-e-de-emergencia). Não há promessa de funcionamento sem sinal de telefonia, atendimento do MoveCity 24 horas ou envio automático de socorro.

Suporte usa os canais já publicados no projeto. O contexto é visível antes de sair do app e inclui apenas ID da corrida e estados de conexão/GPS/medição. Não inclui token, nome/telefone do passageiro ou coordenadas. Abrir WhatsApp/e-mail não envia a mensagem: o motorista revisa e envia no canal escolhido.

Uma interrupção depois do início não ganhou cancelamento gratuito. O cancelamento presencial por engano continua limitado ao primeiro minuto e validado pelo backend. O botão não aparece com horário de início ausente/antigo; chamadas repetidas são bloqueadas e resposta de outra conta/viagem não limpa o atendimento atual.

## Finalização e painéis

- Uma única seleção de painel coordena ajuda, chat, cancelamento e finalização.
- Diálogo operacional com altura limitada, rolagem, foco contido, retorno de foco e Voltar/Escape. Plano de fundo fica inerte durante o painel aberto.
- `open=false` mantém os filhos montados, sem capturar foco ou Voltar. Assim, recolher um painel não descarta prévia/recibo nem interrompe mutation em andamento.
- Prévia, gravação offline, finalização, confirmação de pagamento e avaliação ocupadas bloqueiam fechamento externo. A sinalização não antecipa sucesso: o contador só para depois do ACK ou da gravação durável concluída.
- Recibo finalizado não reativa a medição ao fechar; abre o histórico. Resposta tardia da restauração não o descarta automaticamente.
- Chat usa apresentação embutida no diálogo da viagem. O texto genérico “Online” foi substituído por “Conversa do atendimento”, pois status de corrida não comprova presença do passageiro. Não foi reescrito o sistema de entrega de mensagens.

## Verificação

- Suíte frontend completa: **60 arquivos / 518 testes aprovados**, 30 a mais que os 488 após o lote 4.
- Novas regressões: GPS/rede independentes, tarifa ausente, erro de armazenamento, leitura atrasada, identidade da corrida, privacidade do contexto de suporte, conteúdo preservado ao recolher diálogo, bloqueio de fechamento ocupado, contador interrompido após persistência, recibo e resposta tardia de restauração.
- **26 testes de navegador aprovados**: 14 anteriores e 12 novos para viagem confirmada/local, GPS ruim e erro de leitura, em 320×568, 360×640 com fonte raiz de 24 px, e 844×390. Verificam área livre do mapa, finalização alcançável, ausência de cobertura/overflow horizontal, ajuda, foco e retorno. Capturas foram inspecionadas e a composição ajustada para fonte ampliada.
- Fixtures usam componentes reais, mapa simulado e dados sintéticos. Requisições externas são bloqueadas. Isso não comprova GPS nativo, deslocamento real, mapas em campo ou atendimento de suporte/emergência.
- Builds de motorista e passageiro aprovados; o passageiro foi compilado como regressão de componentes compartilhados. Avisos de tamanho de bundle/imports mistos permanecem.
- ESLint selecionado dos componentes/serviço novos, medidor e testes: aprovado. Não é declaração de lint global limpo do legado.
- `git diff --check` aprovado. Sem novas dependências.

Comandos em `frontend`:

```text
npx vitest run
npm run test:e2e:driver-shell
npm run build:driver
npm run build:passenger
```

## Limites e publicação

Sem commit, push, deploy, AAB, mudança de versão, submissão à Play Store ou modificação de produção neste lote. O backend não foi alterado. Para publicar o conjunto acumulado, permanece a dependência do lote 2: backend antes de frontend/AAB.

Falta homologação Android real: GPS/rádio desligados separadamente, percurso sem internet, precisão e bateria, retorno do Google Maps/discador/WhatsApp, mapa redimensionado, teclado do chat, TalkBack e Voltar durante gravação. Não foi alterado o rastreamento nativo em segundo plano, a tarifa, a regra de finalização nem a validação de pagamentos.

Cancelamento/interrupção depois do início com novas consequências financeiras exige definição operacional; não foi implementado por inferência. Entrega/erro de mensagens, paridade offline de encomendas e recuperação de conta permanecem para lotes próprios.

Próximo lote: atualização do aplicativo e experiência da conta/ganhos, incluindo o contrato incorreto do botão Atualizar e distinção entre indisponibilidade de dados e saldo zero.
