# Motorista — lote 2: pagamento e recuperação de pendências

Data: 08/09/2026. Continuação local do lote 1, sem publicação.

## Entrega

Implementados C03 e C04 da [auditoria](../audits/2026-09-08-experiencia-motorista.md), mantendo tarifas, comissões e regras de finalização/cancelamento.

### Pagamento

- Rótulo compartilhado para dinheiro, Pix, carteira e cartão em oferta, embarque e finalização. Método desconhecido não vira dinheiro.
- Carteira/cartão nunca orientam pagamento externo, inclusive na finalização offline. Não oferecem confirmação manual de recebimento em mãos.
- Para dinheiro/Pix, `paymentStatus=paid` não é apresentado como prova de recebimento: o backend liquida contabilmente esses métodos ao finalizar.
- Resumo separa total da corrida, valor a receber diretamente e ganho informado pelo servidor. Não calcula nem expõe comissão no frontend.
- API passa a fornecer `collectionAmount` para corrida finalizada em dinheiro/Pix: total menos parcela já utilizada no aplicativo. O DTO continua omitindo saldo, débito interno de carteira e comissão.
- Quando uma API antiga não fornece esse valor, o app mostra “A confirmar no sistema”, sem assumir que todo o total deve ser cobrado novamente.
- Offline: valor local claramente identificado como estimativa, sem ganho líquido ou pagamento confirmado. Uma prévia indisponível não reutiliza um zero antigo como preço final.
- Resumo fica disponível até o motorista sair ou escolher avaliar; avaliação não desapareceu. Painel tem rolagem limitada à tela.
- Resposta de encerramento sem o mesmo ID e status `finished` não anuncia sucesso: preserva o pedido para confirmação.

### Pendências

Cada registro visível tem “Ver detalhes e resolver”, com referência local/ID quando válido, horário original do toque, gravação, última tentativa, tentativas sem confirmação, método de pagamento e última resposta.

- “Tentar sincronizar” usa o pedido original da mesma conta/ambiente. Não muda ID, horário, localização ou valor; não cria nova corrida.
- Retoma apenas a finalização selecionada e suas etapas anteriores seguras do mesmo serviço. Não executa outras viagens ou pagamentos.
- Tentativa manual e sincronização automática compartilham a mesma fila serializada.
- GPS precisa sincronizar antes do encerramento. Sem ACK, o ponto continua salvo.
- Pendência só é removida após confirmação coerente do mesmo ID. Mudança de conta durante a requisição mantém o registro local.
- Erros 400/409/5xx preservam trabalho e registram diagnóstico. Erros 403/404 também ficam visíveis, mas bloqueiam repetição e direcionam ao suporte.
- Sem ID, dono/horário confiáveis, ou com etapas anteriores incoerentes, não há reenvio manual. Nenhum vínculo é inferido por data, preço ou endereço.
- Suporte por WhatsApp/e-mail usa os contatos já existentes, com resumo revisável e botão de cópia. O resumo não contém passageiro, endereço, GPS, credenciais ou mensagem bruta do servidor. O envio depende do usuário.
- Cache do histórico separado por motorista; invalidadores por prefixo continuam compatíveis.

## Verificação

- Quatro testes novos reproduziram as mensagens incorretas antes da correção.
- Suíte frontend final: **55 arquivos / 415 testes aprovados**; **52 testes novos** neste lote, além dos 363 existentes após o lote 1.
- Backend: **10 testes do contrato de DTO/privacidade** e **19 testes de finalização/transação/privacidade financeira** aprovados.
- `npm run build:driver`: aprovado. Avisos existentes de tamanho de bundle/imports mistos permanecem.
- ESLint dos serviços/utilitários e testes selecionados do lote: aprovado. Isso não significa que o lint de todos os componentes legados esteja limpo.
- `git diff --check`: aprovado.

## Publicação e limites

Ainda não houve deploy, geração de AAB, envio à Play Store, contato externo com suporte ou alteração de dados de produção.

Publicar **backend antes do novo frontend/AAB**, para disponibilizar `collectionAmount`. Não é migração financeira: trata-se de informação derivada de dados já existentes. Até o backend atualizar, o novo frontend evita inventar o valor de cobrança direta.

Necessária homologação em aparelho: dinheiro, Pix, carteira/cartão pendentes e confirmados; pagamento parcialmente coberto pelo aplicativo; perda de sinal; reabertura; retry simultâneo à reconexão; tela pequena/fonte ampliada; abertura e cópia do resumo de suporte.

Registros históricos já removidos por versões antigas não são recriados. Registros antigos sem vínculo seguro não são automaticamente associados a uma conta. O suporte deve investigar o ID real, sem criar cobranças para compensar a falta de dados.

Próximo lote: camada global de ofertas e navegação operacional, mantendo as correções de aceite/embarque dos lotes anteriores.
