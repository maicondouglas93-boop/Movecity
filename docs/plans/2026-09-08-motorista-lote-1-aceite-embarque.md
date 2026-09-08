# Motorista — lote 1: aceite e embarque confiáveis

Data: 08/09/2026. Implementação local sobre `0b1e41566e3fd646a32a8331cf66a3fc299f7057`.

## Escopo entregue

Primeiro lote da [auditoria](../audits/2026-09-08-experiencia-motorista.md): C01 (aceite antecipado) e C02 (avanço antes da persistência). Não é a conclusão de toda a auditoria.

- O popup não abre mais o embarque antes de o servidor confirmar a atribuição.
- Novas tentativas de aceite feitas pela Home não são enfileiradas offline nem criam uma corrida `accepted` fictícia.
- Popup e card de aceite compartilham uma trava de requisição. Outra oferta/presencial/encomenda não pode ser iniciada pelos controles da Home enquanto o aceite estiver em confirmação.
- Depois de uma resposta perdida ou conflito, a consulta autenticada `/rides/captain-current` verifica a atribuição. Um 409 não é tratado automaticamente como sucesso nem como vitória de outro motorista.
- Resultado desconhecido mantém aviso explícito e botão para tentar confirmar o mesmo ID. A nova tentativa consulta primeiro o servidor; não reenvia se a consulta falhar ou se já existir atribuição.
- Evento de cancelamento/perda da oferta invalida uma resposta HTTP atrasada. Respostas de outra conta ou de uma tela desmontada não atualizam a Home.
- A reconciliação do aceite respeita finalizações pendentes, sem reabrir uma viagem encerrada no aparelho.
- Chegada/deslocamento/início só avançam offline depois de `enqueueOfflineAction` concluir. Falha de armazenamento mantém a etapa e informa o problema.
- Durante a gravação aparece “Salvando no aparelho”. Cancelar/iniciar/atualizar não concorrem entre si.
- Timeout rígido de 12 segundos e códigos de rede são reconhecidos mesmo com `navigator.onLine` verdadeiro. Uma resposta HTTP de regra/sessão não vira sucesso offline se o aparelho perder sinal depois.
- Início local recebe `startedAt` a partir do mesmo `occurredAt` enviado/enfileirado. O contador local não usa a criação da solicitação como início da viagem.
- Novos registros de início/atualização preservam snapshot, proprietário e ambiente da API. O replay ignora ações identificadas como pertencentes a outra conta/ambiente, sem apagá-las.
- Resposta atrasada do embarque não regride uma etapa mais recente nem altera outra corrida. Resposta atrasada de cancelamento não limpa outra viagem.

## Contratos preservados

Mantidos endpoints, aceite atômico do backend, GPS, finalização existente, tarifas, comissões, validações de distância e janela de cancelamento presencial. Nenhuma migração de banco nem mudança de versão Android.

`toRideCaptainDTO` omite o campo `captain`: a atribuição desses dados é isolada pelo token nas rotas `authCaptain`. O frontend aceita esse contrato; quando um snapshot contém proprietário explícito, rejeita proprietário divergente. Isso é proteção de apresentação, não substitui autorização do backend.

Registros antigos de aceite na fila não foram apagados ou migrados neste lote. A recuperação após encerramento abrupto do processo e o replay completo de versões antigas ainda precisam de homologação em aparelho.

## Validação executada

- Antes da correção: 14 novos testes de componentes reproduziram os problemas e falharam.
- Após a correção e testes adicionais: **53 arquivos / 363 testes aprovados** (`npx vitest run`), sendo **48 testes novos** em relação à base de 315.
- Cobertura nova: componentes de oferta/embarque, Home real com serviços simulados, serviço de aceite, timeout nativo sem resposta, ACK perdido, concorrência de cliques, 4xx, armazenamento cheio, mudança de corrida, cancelamento recebido e isolamento de conta no replay.
- `npm run build:driver`: aprovado. Persistem avisos de tamanho de bundle/imports mistos.
- ESLint dos serviços/utilitários e testes tocados: aprovado. Os componentes legados continuam com pendências de `react/prop-types` e hooks; comparação com HEAD não aumentou a contagem por regra e removeu imports sem uso. Não foi desabilitada regra de lint.
- `git diff --check`: aprovado.

Não houve teste de rua, teste físico Android, acesso à conta do motorista, deploy, geração de AAB assinado ou envio à Play Store nesta etapa.

## Homologação antes da publicação

1. Em dois aparelhos, aceitar a mesma oferta: somente o vencedor deve receber controles de embarque.
2. Interromper a resposta do aceite: não aparecer “A caminho” até a consulta confirmar; tentar confirmar recupera a própria viagem.
3. Cancelar a oferta enquanto o aceite está pendente: uma resposta atrasada não reabre a corrida.
4. Com uma corrida já atribuída, perder dados móveis durante chegada/início: aguardar gravação, conferir horário do contador e reconectar.
5. Simular falha de armazenamento: não avançar nem mostrar início concluído.
6. Encerrar/reabrir o app e atualizar sem desinstalar, conferindo sessão, corrida e ações pendentes.
7. Confirmar que a sincronização não duplica ações e que a medição GPS/finalização da viagem permanece correta.

## Próximo lote

Corrigir apresentação da forma de pagamento/recibo (C03) e dar um caminho acionável às finalizações pendentes (C04). Oferta global, simplificação da Home, suporte contextual e demais melhorias permanecem no plano da auditoria.
