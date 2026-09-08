# Lote 4 — Home, disponibilidade e embarque

Implementado localmente em 08/09/2026, preservando os lotes 1–3. Foco nos achados I02, I03 e I05 da auditoria; não representa o encerramento da auditoria inteira.

## Mudanças entregues

- Home com mapa flexível e painel operacional rolável. Disponibilidade vem antes dos demais conteúdos.
- Removidos o GO pulsante, o seletor de modo estático e a grade de atalhos duplicados. Corrida presencial agora tem nome e finalidade explícitos: passageiro que já está com o motorista. Encomendas, carteira, histórico e demais páginas continuam acessíveis pelo menu existente.
- Ganhos do dia recolhidos por padrão, com detalhes sob demanda. Falha na consulta mostra indisponibilidade e permite repetir, sem converter erro em ganho zero. Resposta atrasada de outra conta não aparece no resumo.
- Avisos nativos de permissões preservados, após o conteúdo operacional. Agendamentos aparecem como atalho compacto quando há serviços previstos; lista completa continua no menu.
- Estados distintos de offline voluntário, confirmação em andamento, resposta pendente, reconexão, restrição de cadastro/créditos, GPS ausente e atendimento ocupado. O banner de conexão e a Home usam a mesma fonte de eventos de internet/socket.
- A apresentação de GPS exige coordenadas válidas e horário recente: até 60 segundos, verificados a cada 5 segundos e no foco. Coordenadas salvas sem horário não provam um GPS funcionando agora. Esse limiar é informativo: não modifica despacho, permissões, coleta de pontos ou cobrança.
- Botão online protegido contra clique duplo desde o pedido de permissão. Só aplica ACK com o mesmo motorista e estado solicitado. Falha de permissão não envia alteração; perda de resposta mantém a intenção, e a confirmação manual repete o mesmo booleano, sem inverter a disponibilidade.
- Troca de conta/desmontagem invalida respostas antigas. Ficar offline não encerra o rastreamento de um atendimento que tenha surgido durante a requisição.
- Enquanto a disponibilidade está sendo confirmada ou está incerta, aceite de corrida/encomenda e início presencial ficam bloqueados. O destaque da oferta não cobre a confirmação, nem recebe prazo novo. Há retorno à Home pelas páginas secundárias.
- Pré-embarque com títulos e instruções específicos para aceite, deslocamento e chegada. Endereço completo de embarque/destino, navegação externa para o embarque e ligação pelo telefone entregue no DTO autorizado após o aceite. Número ausente/inválido não gera link.
- Distância estimada da viagem é identificada como percurso da viagem, não distância até o passageiro. Na lista da Home, distância calculada por Haversine é rotulada como aproximada/em linha reta.
- Cancelamento após chegada explica que o motorista deixa o atendimento e a solicitação volta ao despacho. Não foram criadas taxas, prazos de espera ou regras de no-show.

## Segurança operacional preservada

Nenhuma alteração de disponibilidade é enfileirada para aplicação silenciosa futura. Após resposta perdida, o usuário confirma o mesmo pedido. Não há logout provocado por falta de internet.

Aceite continua exigindo confirmação real do backend. Avançar o embarque/iniciar continua exigindo ACK ou gravação durável da ação já autorizada no aparelho, conforme lote 1. Este lote não modifica finalização, tarifa, pagamento, créditos, idempotência ou regras de cancelamento do backend.

## Verificações

- Suíte frontend completa: **59 arquivos / 488 testes aprovados** (448 anteriores + 40 deste lote).
- Cobertura nova: derivação dos estados, conexão sem logout/mutação de disponibilidade, GPS antigo/ausente, erro no resumo, permissão negada/falha, clique duplo, ACK inválido/perdido, troca de conta, desmontagem, serviço que surge durante o toggle, bloqueio cruzado no coordenador, títulos por etapa, endereço completo, alvo da navegação e telefone seguro.
- Navegador: **14 testes aprovados**, sendo os 4 do shell anterior e 10 novos para offline/online/GPS/reconexão/embarque em 320×568 e 360×640 com fonte raiz ampliada para 24 px. Controles alcançáveis e sem cobertura, sem overflow horizontal; cancelamento permanece dentro do diálogo rolável.
- Fixtures usam componentes reais com dados sintéticos e mapa simulado. APIs são interceptadas; demais acessos externos são bloqueados. Não equivalem a uma corrida real ou a um teste completo da Home conectado ao despacho. Capturas de Home e embarque foram inspecionadas visualmente.
- Builds de motorista e passageiro aprovados. O passageiro foi compilado como regressão do hook/banner compartilhado. Avisos preexistentes de tamanho de bundle e imports mistos permanecem.
- ESLint selecionado dos novos serviços, hook, painel de disponibilidade e testes, seguindo a convenção JSX sem prop-types dos painéis existentes. Lint global do legado não é declarado limpo.
- Sem dependências novas; verificação de espaços com `git diff --check`.

Reproduzir em `frontend`:

```text
npx vitest run
npm run test:e2e:driver-shell
npm run build:driver
npm run build:passenger
```

## Limites e próximo lote

Sem deploy, push, AAB, mudança de versão Android, submissão à Play Store ou alteração de dados de produção. Na publicação acumulada, continua necessária a ordem do lote 2: backend antes de frontend/AAB.

Ainda exige teste no Android real: permissão nativa, voltar do Google Maps/discador, rádio/GPS desligados separadamente, background, TalkBack e restauração após fechamento do processo. A disponibilidade exibida usa o último perfil/ACK conhecido mais os sinais locais; não é garantia de recebimento de uma oferta.

Não foi criado ETA sem uma rota calculada. O contato neste lote usa o discador; integrar chat ao pré-embarque com entrega/erro de mensagem e foco corretos permanece para uma revisão específica do chat. Não foi alterado o comportamento de background do GPS neste lote.

Próximo lote sugerido pela auditoria: viagem em andamento — clareza de GPS/rede/medição, navegação e acesso contextual a ajuda/segurança, preservando finalização offline e cobrança.
