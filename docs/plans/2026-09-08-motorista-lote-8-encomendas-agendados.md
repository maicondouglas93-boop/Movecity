# Lote 8 — Encomendas e serviços agendados

Implementado localmente em 08/09/2026, após os lotes 5–7, preservados sem commit. Escopo: recuperação de falhas e clareza da operação do motorista. Não altera preços, comissão, regras de PIN, permissões ou despacho.

## Contratos conferidos no backend

- `/parcels/captain-current` retorna encomenda ativa, finalizada com liquidação pendente ou finalizada aguardando avaliação; `null` confirma ausência. Falha de transporte não equivale a ausência.
- Atualização de status é atômica e exige transição válida. Entrega exige status `arrived_destination` e PIN conforme configuração do serviço.
- `confirmDelivery` grava `finished` antes da liquidação automática; portanto uma falha de resposta pode ocorrer depois da entrega registrada. Não é seguro afirmar que um timeout significa PIN errado ou repetir a operação sem consultar.
- `paymentStatus: paid` representa a liquidação automática da plataforma; não comprova recebimento externo em dinheiro/Pix. `confirm-payment` permanece como fallback existente, sem nova regra financeira.
- Agendados são uma prévia das próximas 24 horas compatível com região/veículo. O DTO já fornece `driverAmount`. A lista não reserva serviços e não oferece aceite antecipado.

## Correções implementadas

### Operação da encomenda

- Novo `useParcelOperation`: trava imediata compartilhada por avanço, PIN, liquidação, avaliação e pular avaliação. Teto de 12 segundos independente do transporte nativo.
- Nenhuma etapa avança sem ACK com ID/status esperado. PIN, entrega e pagamento não entram em fila offline nem são apresentados como confirmados por mera tentativa.
- Falha ou resposta inesperada mantém a encomenda e desabilita novos comandos até consultar o estado no servidor. PIN digitado é preservado para corrigir/repetir após consulta; não é persistido em disco.
- Erro de PIN só aparece quando informado pelo servidor. Erros de conexão e respostas desconhecidas recebem orientação de recuperação, sem logout nem mensagem falsa de encomenda inexistente.
- Montagem, reconexão e retorno ao aplicativo consultam o estado. Ausência só redireciona depois de resposta definitiva. Snapshot de navegação não substitui essa consulta; snapshot do contexto só é usado para exibição quando pertence à conta atual.
- Todas as atualizações confirmadas alimentam tela e contexto. Respostas após desmontagem ou mudança de proprietário são descartadas.
- Evento de cancelamento só provoca consulta se identifica a encomenda atual; eventos de outras encomendas não apagam o atendimento.
- Pular avaliação não limpa a encomenda em caso de falha. Avaliação/dispensa só saem após ACK válido ou posterior consulta que confirme ausência do atendimento pendente.
- Recibo distingue entrega confirmada, valor do cliente e ganho do motorista; informa que a liquidação não comprova dinheiro/Pix recebido. Valores ausentes não são convertidos em zero.
- Painel rolável limitado pela altura disponível, mapa com redimensionamento do contêiner, PIN com rótulo persistente, estrelas com nomes acessíveis e chat no diálogo operacional existente.

### Reconciliação compartilhada

- Consultas simultâneas de encomendas compartilham uma única leitura por tipo de sessão/proprietário. Evita que a tela receba resultado desconhecido apenas porque outra consulta simultânea a substituiu.
- Revisão local protege ACK novo contra leitura iniciada antes dele, inclusive resposta `null` atrasada.
- Status não retrocede e liquidação `paid` não volta a `pending` em snapshots antigos da mesma encomenda.
- Troca de conta limpa estado e invalida callbacks/resultados anteriores. `captainParcelOwnerId` identifica o proprietário do snapshot local, sem acrescentar informação ao DTO externo.
- Resposta 200 malformada não é interpretada como ausência nem substitui uma encomenda válida.

### Agendados

- Consulta/cache por motorista, cancelamento de leitura via signal, timeout independente e botão de atualização.
- Falha inicial distinta de lista vazia. Falha posterior preserva dados e horário da última consulta válida, com aviso explícito.
- Ganho previsto usa exclusivamente `driverAmount`, não tarifa do passageiro nem cálculo local de comissão. Valor desconhecido fica indisponível.
- Datas inválidas e endereços ausentes têm fallback legível. Endereços disponibilizados pelo DTO podem quebrar linha; categorias de veículo desconhecidas não viram automaticamente “Carro”.
- Mantida prévia informativa, sem reserva, aceite ou garantia de horário/valor final.

## Verificação

- **66 arquivos / 631 testes frontend aprovados**, 35 testes adicionais sobre o lote 7: 15 de operação, 13 de agendados e 7 de reconciliação compartilhada.
- **50 testes de navegador aprovados**, incluindo 6 novos: encomenda e agendados em 320×568, 360×640 com fonte 24 e 844×390.
- Testes novos exercitam consulta desconhecida, retry, resposta perdida, ACK incorreto, toque duplicado, PIN inválido versus rede, bloqueio offline, pagamento pendente, avaliação, cancelamento alheio, troca de proprietário, leitura concorrente e preservação de dados.
- Capturas inspecionadas: recuperação com fonte ampliada, recibo em tela pequena e agendados com fonte ampliada. Controles alcançáveis por rolagem e sem overflow horizontal nos cenários testados.
- Fixtures usam dados e transporte sintéticos; mapa substituído no teste visual e requisições externas bloqueadas. Nenhum PIN, pagamento, avaliação ou agendamento real enviado.
- Na validação inicial, a fixture de encomenda recriava o socket a cada render; foi corrigida para referência estável. Uma execução completa também teve timeout de montagem na fixture de aprovação anterior; a repetição integral, sem alterações durante a execução, passou em 50/50.
- Builds aprovados: motorista `driver-3LM-jsjO.js`; passageiro `passenger-DHvNihGo.js`.
- ESLint dos arquivos de implementação deste lote sem erros, com aviso existente de contexto/fast-refresh. `git diff --check` aprovado. Persistem avisos de tamanho/imports do build; não equivale a lint global limpo.

## Limites e publicação

Não houve commit, push, deploy, novo AAB, incremento de versão, alteração de dependências ou mudança no backend. Para publicar o conjunto acumulado, continua necessária a ordem backend antes de frontend/AAB pelo contrato financeiro do lote 2.

Sem promessa de encomenda inteiramente offline: snapshot e rascunho de PIN desta tela ficam em memória; reabrir o processo sem sinal ainda exige recuperar a encomenda pelo servidor. O timeout não cancela uma requisição nativa já enviada; por isso há reconciliação antes de nova tentativa e as proteções atômicas do backend continuam essenciais.

Ainda falta homologação em Android real: teclado/PIN, TalkBack e Voltar no chat, modo avião antes/depois de enviar confirmação, resposta perdida após entrega registrada, retorno de segundo plano, encerramento do processo, Maps/WhatsApp e operação entre duas contas. Testes web com servidor simulado não comprovam transporte, GPS ou persistência nativos.

Próxima etapa recomendada: homologação integrada dos lotes e piloto controlado em aparelho, antes da publicação. Não considerar os testes locais uma validação de produção.
